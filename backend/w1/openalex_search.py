#!/usr/bin/env python3
"""openalex_search.py — OpenAlex works 主题检索（W1-P2 不限流主力源）。

OpenAlex 是完全开放的学术元数据 API（~2.5 亿 works），礼貌池（带 mailto）
限流极其宽松——官方基准 100k req/天，本脚本 1s 间隔远低于此，无退避烦恼。
作为 arXiv 检索的对冲源：arXiv 出口配额耗尽时 OpenAlex 依然稳定供给。

用法：
  python openalex_search.py --keywords "federated learning security,data poisoning" \
      --year-from 2020 --year-to 2026 --max-records 1000 \
      --out retrieval_workspace/raw_results/openalex_results.csv \
      --mailto 858641291@qq.com

输出与 arxiv_search 同一 FIELD_ORDER（P3 归一直接合流）：
  title, authors, year, doi, abstract, venue, url, source_db
abstract 由 OpenAlex 的 abstract_inverted_index 还原；DOI 取 authoritative
（OpenAlex 是 DOI 权威源，无需 arXiv 式合成 10.48550）。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import time
import urllib.parse
from pathlib import Path
import os

API = "https://api.openalex.org/works"
FIELD_ORDER = ["title", "authors", "year", "doi", "abstract", "venue", "url", "source_db"]
MIN_INTERVAL = 1.0  # 礼貌池下完全够用（上限 ~10 rps，我们 1 rps）


def _curl_json(url: str, max_attempts: int = 5) -> dict:
    """GET + search 端点限流处理：高峰期匿名 search 会临时限流，
    响应体带 retryAfter 秒数——按它睡（实测 32s 级），冷却后重试。"""
    import time as _t
    for attempt in range(max_attempts):
        proc = subprocess.run(["curl", "-sS", "-g", "-L", "--max-time", "60", url],
                              capture_output=True)
        if proc.returncode != 0:
            raise OSError(proc.stderr.decode("utf-8", errors="replace")[:200])
        try:
            data = json.loads(proc.stdout.decode("utf-8", errors="replace"))
        except json.JSONDecodeError as e:
            raise OSError(f"OpenAlex 返回非 JSON: {e}") from e
        if "error" in data and "rate limit" in str(data.get("error", "")).lower():
            wait = int(data.get("retryAfter", 30) or 30)
            print(f"[openalex_search] search 端点临时限流，睡 {wait}s 重试"
                  f"（第 {attempt + 1} 次）", flush=True)
            _t.sleep(wait + 2)
            continue
        return data
    raise OSError("OpenAlex 连续限流 5 次（高峰期 search 集群过载，稍后再跑或申请免费 API key）")


def invert_abstract(idx: dict | None) -> str:
    """OpenAlex 摘要存为 {word: [positions]}，按位置重排成文本。"""
    if not idx:
        return ""
    pos: dict[int, str] = {}
    for word, positions in idx.items():
        for p in positions:
            pos[p] = word
    return " ".join(pos[i] for i in sorted(pos))


def build_filter(year_from: int, year_to: int) -> str:
    return (f"from_publication_date:{year_from}-01-01,"
            f"to_publication_date:{year_to}-12-31,has_abstract:true")


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenAlex 主题检索（礼貌池，宽松限流）")
    ap.add_argument("--keywords", required=True, help="逗号分隔关键词")
    ap.add_argument("--year-from", type=int, default=2020)
    ap.add_argument("--year-to", type=int, default=2026)
    ap.add_argument("--max-records", type=int, default=1000)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mailto", default="858641291@qq.com", help="礼貌池标识（官方推荐）")
    args = ap.parse_args()

    kws = [k.strip() for k in re.split(r"[,;，；]", args.keywords) if k.strip()]
    out, seen = [], set()
    t0 = time.time()
    # 逐关键词检索再合并（比一个长 OR 串稳；search 端点实测对短语敏感）
    per_kw = max(50, args.max_records // max(len(kws), 1))
    for kw in kws:
        cursor = "*"
        page = 0
        while len(out) < args.max_records and page * 100 < per_kw:
            q = urllib.parse.urlencode({
                "search": kw,
                "filter": build_filter(args.year_from, args.year_to),
                "per-page": 100,
                "cursor": cursor,
                "mailto": args.mailto,
            })
            data = _curl_json(f"{API}?{q}")
            page += 1
            works = data.get("results", [])
            if not works:
                break
            for w in works:
                doi = (w.get("doi") or "").replace("https://doi.org/", "")
                oa_id = w.get("id", "").rsplit("/", 1)[-1]
                key = doi or oa_id
                if not key or key in seen:
                    continue
                seen.add(key)
                loc = (w.get("primary_location") or {})
                venue = ((loc.get("source") or {}).get("display_name")
                         or (w.get("host_venue") or {}).get("display_name") or "")
                authors = "; ".join(a.get("author", {}).get("display_name", "")
                                    for a in (w.get("authorships") or []) if a.get("author"))
                out.append({
                    "title": re.sub(r"\s+", " ", w.get("display_name") or "").strip(),
                    "authors": authors[:400],
                    "year": w.get("publication_year") or "",
                    "doi": doi,
                    "abstract": invert_abstract(w.get("abstract_inverted_index")),
                    "venue": venue[:200],
                    "url": w.get("id") or "",
                    "source_db": "openalex_search",
                })
            print(f"[openalex_search] 「{kw}」第 {page} 页累计 {len(out)} 条", flush=True)
            cursor = (data.get("meta") or {}).get("next_cursor") or ""
            if not cursor:
                break
            time.sleep(MIN_INTERVAL)
        if len(out) >= args.max_records:
            break

    out = out[: args.max_records]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELD_ORDER, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    stats = {"keywords": kws, "records": len(out),
             "elapsed_sec": round(time.time() - t0, 1)}
    Path(str(Path(args.out)).replace(".csv", "_stats.json")).write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[openalex_search] {json.dumps(stats, ensure_ascii=False)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
