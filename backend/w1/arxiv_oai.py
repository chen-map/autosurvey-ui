"""arXiv 合规采集层（OAI-PMH + 退避 + 合规 UA + 日限额）。

来源：用户提供的 arXiv 合规最佳实践（docs/arxiv-compliance.md），要点：
  1. 大规模元数据用 OAI-PMH（ListRecords + resumptionToken 分页 + 增量时间戳），
     代替高频 REST 调用，显著降低请求频率；
  2. 合规 User-Agent（含联系方式）；
  3. 429 时按 Retry-After / 指数退避等待；
  4. 每日请求上限（防意外超限），本地状态文件记录当日用量。

用法（W1-P2 补充源，产出与 raw_results 同 schema CSV，经 P3 归一去重自然合流）：
  python arxiv_oai.py --set cs.CR --from 2023-01-01 --out retrieval_workspace/raw_results/arxiv_oai_results.csv \
                      --max-records 800 --contact-email you@example.com
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

OAI_BASE = "https://oaipmh.arxiv.org/oai"
STATE_FILE = "oai_daily_state.json"  # 放在 out 同目录：记录当日请求数
DAILY_CAP = 2000                      # 最佳实践：每日最大请求数上限
MIN_INTERVAL = 1.1                    # ≥1 req/s
FIELD_ORDER = ["title", "authors", "year", "doi", "abstract", "venue", "url", "source_db"]


def load_daily_count(state_path: Path) -> int:
    today = date.today().isoformat()
    if state_path.exists():
        try:
            d = json.loads(state_path.read_text(encoding="utf-8"))
            if d.get("date") == today:
                return int(d.get("count", 0))
        except Exception:
            pass
    return 0


def save_daily_count(state_path: Path, count: int) -> None:
    state_path.write_text(
        json.dumps({"date": date.today().isoformat(), "count": count}, ensure_ascii=False),
        encoding="utf-8")


def request_with_backoff(url: str, user_agent: str, state_path: Path,
                         max_backoff: int = 8) -> bytes:
    """GET + 指数退避；429 优先按 Retry-After 等待；计入每日限额。"""
    global _daily
    attempt = 0
    while True:
        if _daily >= DAILY_CAP:
            raise RuntimeError(f"arXiv OAI 每日请求上限 {DAILY_CAP} 已达（合规熔断），明日自动恢复")
        req = urllib.request.Request(url, headers={"User-Agent": user_agent})
        try:
            _daily += 1
            save_daily_count(state_path, _daily)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", 0) or 0) or min(2 ** attempt, max_backoff) * 30
                print(f"[arxiv_oai] 429 → 等待 {wait}s（Retry-After 优先）", flush=True)
                time.sleep(wait)
                attempt += 1
                continue
            raise
        except urllib.error.URLError:
            wait = min(2 ** attempt, max_backoff)
            print(f"[arxiv_oai] 网络异常 → 退避 {wait}s", flush=True)
            time.sleep(wait)
            attempt += 1
            continue


_daily = 0


def parse_resumption_token(xml_bytes: bytes) -> str | None:
    m = re.search(rb"<resumptionToken[^>]*>([^<]+)</resumptionToken>", xml_bytes)
    return m.group(1).decode("utf-8").strip() if m else None


def extract_records(xml_bytes: bytes) -> list[dict]:
    """从 OAI-PMH 响应提取 arXiv 元数据（容错解析，不依赖命名空间细节）。"""
    text = xml_bytes.decode("utf-8", errors="replace")
    records = []
    for chunk in re.findall(r"<arXiv:x?arXiv[ >].*?</arXiv:x?arXiv>", text, re.S) or \
            re.findall(r"<arXiv:arXiv[^>]*>.*?</arXiv:arXiv>", text, re.S):
        def pick(tag: str) -> str:
            m = re.search(rf"<arXiv:{tag}[^>]*>(.*?)</arXiv:{tag}>", chunk, re.S)
            return re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else ""
        arxiv_id = pick("id")
        title = re.sub(r"\s+", " ", pick("title"))
        abstract = re.sub(r"\s+", " ", pick("abstract"))
        authors = "; ".join(re.findall(r"<arXiv:authors>(.*?)</arXiv:authors>", chunk, re.S)[0].split(","))[:400] \
            if re.findall(r"<arXiv:authors>(.*?)</arXiv:authors>", chunk, re.S) else ""
        year = (pick("created") or pick("updated"))[:4]
        if not arxiv_id or not title:
            continue
        records.append({
            "title": title,
            "authors": authors,
            "year": year,
            "doi": f"10.48550/arXiv.{arxiv_id}",  # 注入官方 DOI：全链路 DOI 锚定
            "abstract": abstract,
            "venue": "arXiv (OAI-PMH)",
            "url": f"https://arxiv.org/abs/{arxiv_id}",
            "source_db": "arxiv_oai",
        })
    return records


def harvest(sets: list[str], from_date: str, out_csv: Path, *,
            max_records: int, contact: str, until: str = "") -> dict:
    global _daily
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    state_path = out_csv.parent / STATE_FILE
    _daily = load_daily_count(state_path)
    ua = f"AutoSurvey-SLR-Bot/1.0 ({contact}; supports OAI-PMH)"

    rows: list[dict] = []
    seen: set[str] = set()
    for set_spec in sets:
        params = {"verb": "ListRecords", "metadataPrefix": "arXiv", "from": from_date, "set": set_spec}
        if until:
            params["until"] = until
        url = f"{OAI_BASE}?{urllib.parse.urlencode(params)}"
        pages = 0
        while url and len(rows) < max_records:
            xml_bytes = request_with_backoff(url, ua, state_path)
            if b"<error code" in xml_bytes:
                m = re.search(rb'<error code="[^"]+">([^<]+)<', xml_bytes)
                print(f"[arxiv_oai] set={set_spec} OAI 错误: {m.group(1).decode() if m else '?'}", flush=True)
                break
            for rec in extract_records(xml_bytes):
                if rec["title"].lower() not in seen:
                    seen.add(rec["title"].lower())
                    rows.append(rec)
            pages += 1
            print(f"[arxiv_oai] set={set_spec} page={pages} 累计 {len(rows)} 条", flush=True)
            token = parse_resumption_token(xml_bytes)
            if token and len(rows) < max_records:
                time.sleep(MIN_INTERVAL)
                url = f"{OAI_BASE}?{urllib.parse.urlencode({'verb': 'ListRecords', 'resumptionToken': token})}"
            else:
                url = None

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELD_ORDER, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    stats = {"sets": sets, "from": from_date, "records": len(rows), "requests_today": _daily,
             "daily_cap": DAILY_CAP}
    (out_csv.parent / "arxiv_oai_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="arXiv OAI-PMH 合规采集（W1-P2 补充源）")
    ap.add_argument("--set", default="cs", help="arXiv OAI set（如 cs；子集形如 physics:astro-ph）")
    ap.add_argument("--from", dest="from_date", required=True, help="增量起始 YYYY-MM-DD")
    ap.add_argument("--until", dest="until_date", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-records", type=int, default=800)
    ap.add_argument("--contact-email", default="researcher@example.com")
    args = ap.parse_args()

    stats = harvest([x.strip() for x in args.set.split(",") if x.strip()],
                    args.from_date, Path(args.out),
                    max_records=args.max_records, contact=args.contact_email,
                    until=args.until_date)
    print(f"[arxiv_oai] {json.dumps(stats, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
