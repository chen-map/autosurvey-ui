#!/usr/bin/env python3
"""W1-P2 arXiv 主题检索（官方 export API，检索式查询——区别于 OAI 的全量增量 feed）。

痛点（会议质询 2026-09-23）：OAI-PMH 是增量同步工具，set=cs 拉的是与查询无关的
全量切片，翻页从旧到新 + 截断 → 语料全是老论文且混入大量不相关主题。
本脚本用检索式真正"查论文"：
  search_query = all:"关键词" 的 AND 组合（来自 P1 检索式/领域词）
  + submittedDate:[from TO until] 年份硬过滤
  + sortBy=submittedDate 降序（新文优先）
合规：export.arxiv.org 官方 API，3s 限速，curl 三级通道复用（TLS 指纹教训）。
输出与 OAI 同 schema CSV，注入官方 DOI，经 P3 归一合流。
"""
from __future__ import annotations

import argparse
import os
import csv
import json
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys_path = str(HERE)
if sys_path not in __import__("sys").path:
    __import__("sys").path.insert(0, sys_path)

API = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom"}
FIELD_ORDER = ["title", "authors", "year", "doi", "abstract", "venue", "url", "source_db"]
MIN_INTERVAL = 10.0  # arXiv 官方 ≥3s；共享出口 IP（VPS/教育网 NAT）配额友好取 10s


def build_query(kws: list[str], year_from: int, year_to: int) -> str:
    """关键词 OR 并集（宽召回，相关性交给 P4 筛选打分）+ 提交日期硬区间。"""
    terms = [f'all:"{k}"' for k in kws if k.strip()][:5]
    if not terms:
        terms = ['all:"graph neural network"', 'all:"explainability"']
    date = f"submittedDate:[{year_from}0101000000 TO {year_to}1231235959]"
    return "(" + " OR ".join(terms) + ") AND " + date


def _curl_once(url: str, proxy: str) -> tuple[bytes, str, int]:
    """单次请求。返回 (body, http_code, curl_rc)。"""
    import subprocess
    cmd = ["curl", "-sS", "-g", "-L", "--max-time", "60", "-w", "%{http_code}", "-A",
           "AutoSurvey-W1-search/0.1 (contact: researcher@example.com)"]
    if proxy:
        cmd += ["-x", proxy]
    proc = subprocess.run(cmd + [url], capture_output=True)
    if proc.returncode != 0:
        return b"", "", proc.returncode
    body, code = proc.stdout[:-3], proc.stdout[-3:].decode()
    return body, code, 0


def fetch(url: str) -> bytes:
    """双通道自动回退：直连优先 → 406/429 或链路失败且配了 AS_ARXIV_PROXY 时切代理 →
    代理链路失败回直连。两通道都限流则指数退避交替重试。
    背景：直连快但共享出口 IP 配额会被人群烧光；VPS 独立配额但国际链路偶发超时。"""
    proxy = os.environ.get("AS_ARXIV_PROXY", "").strip()
    direct = ""  # 直连=空 proxy
    cur = direct
    attempt = 0
    while attempt < 5:
        body, code, rc = _curl_once(url, cur)
        if rc == 0 and code in ("200", "20"):
            return body
        # 链路失败（curl rc≠0，如代理超时 000）→ 切另一通道立即重试（不计入退避次数）
        if rc != 0:
            other = proxy if cur == direct and proxy else direct
            if other != cur:
                print(f"[arxiv_search] {'直连' if cur == direct else '代理'}链路失败（rc={rc}），"
                      f"切{'VPS 代理' if other else '直连'}重试", flush=True)
                cur = other
                continue
            attempt += 1
            time.sleep(5)
            continue
        # HTTP 层限流 → 优先换通道（直连↔代理），换无可换再退避
        if code in ("406", "429"):
            other = proxy if cur == direct and proxy else direct
            if other != cur:
                print(f"[arxiv_search] HTTP {code}（限流），"
                      f"切{'VPS 代理' if other else '直连'}通道", flush=True)
                cur = other
                continue
            wait = 60 * (3 ** attempt)  # 双通道都限流：60s/180s/540s/1620s/4860s
            print(f"[arxiv_search] HTTP {code} 双通道均限流，退避 {wait}s（第 {attempt+1} 次）", flush=True)
            time.sleep(wait)
            attempt += 1
            continue
        raise OSError(f"HTTP {code}: {body[:150]}")
    raise OSError("arXiv 双通道（直连+VPS 代理）均连续失败——出口配额耗尽或链路异常，"
                  "稍后重试；持续失败请检查 AS_ARXIV_PROXY 指向的代理是否存活")


def main() -> int:
    ap = argparse.ArgumentParser(description="arXiv 主题检索（检索式 + 年份过滤 + 新文优先）")
    ap.add_argument("--keywords", required=True, help="逗号分隔的关键词（来自 P1 检索式）")
    ap.add_argument("--year-from", type=int, default=2020)
    ap.add_argument("--year-to", type=int, default=2026)
    ap.add_argument("--max-records", type=int, default=1000)
    ap.add_argument("--out", required=True)
    ap.add_argument("--contact-email", default="researcher@example.com")
    ap.add_argument("--stats-out", default="")
    args = ap.parse_args()

    kws = [k.strip() for k in re.split(r"[,;，；]", args.keywords) if k.strip()]
    query = build_query(kws, args.year_from, args.year_to)
    out, seen, year_hist = [], set(), {}
    t0 = time.time()

    for start in range(0, args.max_records, 100):
        # 相关性优先（用户裁决）： sortBy=relevance；年份只做 submittedDate 区间硬过滤
        enc = urllib.parse.quote(query, safe="")
        url = (f"{API}?search_query={enc}"
               f"&start={start}&max_results=100&sortBy=relevance")
        try:
            xml_bytes = fetch(url)
        except OSError as exc:
            print(f"[arxiv_search] 拉取失败 start={start}: {exc}", flush=True)
            break
        root = ET.fromstring(xml_bytes)
        entries = root.findall("a:entry", NS)
        if not entries:
            break
        for e in entries:
            aid_raw = e.findtext("a:id", "", NS) or ""
            m = re.search(r"abs/([^\s]+)", aid_raw)
            aid = m.group(1) if m else ""
            if not aid or aid in seen:
                continue
            seen.add(aid)
            title = re.sub(r"\s+", " ", (e.findtext("a:title", "", NS) or "")).strip()
            published = (e.findtext("a:published", "", NS) or "")[:10]
            year = published[:4]
            year_hist[year] = year_hist.get(year, 0) + 1
            authors = "; ".join(a.findtext("a:name", "", NS) or "" for a in e.findall("a:author", NS))[:400]
            doi = ""
            for d in e.findall("{http://arxiv.org/schemas/atom}doi"):
                doi = (d.text or "").strip()
            out.append({
                "title": title, "authors": authors, "year": year,
                "doi": doi or f"10.48550/arXiv.{aid}",  # 官方 DOI 注入
                "abstract": re.sub(r"\s+", " ", (e.findtext("a:summary", "", NS) or "")).strip(),
                "venue": "arXiv (search)",
                "url": f"https://arxiv.org/abs/{aid}",
                "source_db": "arxiv_search",
            })
        print(f"[arxiv_search] start={start} 累计 {len(out)} 条", flush=True)
        if len(out) >= args.max_records:
            break
        time.sleep(MIN_INTERVAL)

    out = out[: args.max_records]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELD_ORDER, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    stats = {"query": query, "records": len(out), "year_hist": dict(sorted(year_hist.items())),
             "elapsed_sec": round(time.time() - t0, 1)}
    stats_path = args.stats_out or str(Path(args.out).with_name("arxiv_search_stats.json"))
    Path(stats_path).write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[arxiv_search] {json.dumps(stats, ensure_ascii=False)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
