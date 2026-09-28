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


def fetch(url: str) -> bytes:
    """拉取一页；406/429 = arXiv 反滥用限流——指数退避重试，仍败则抛错（区别于正常的空结果）。
    AS_ARXIV_PROXY 环境变量非空时经该 HTTP 代理出站（绕过共享出口 IP 封禁）。"""
    import subprocess
    proxy = os.environ.get("AS_ARXIV_PROXY", "").strip()
    cmd = ["curl", "-sS", "-g", "-L", "--max-time", "60", "-w", "%{http_code}", "-A",
           "AutoSurvey-W1-search/0.1 (contact: researcher@example.com)"]
    if proxy:
        cmd += ["-x", proxy]
    for attempt in range(4):
        proc = subprocess.run(cmd + [url], capture_output=True)
        if proc.returncode != 0:
            raise OSError(proc.stderr.decode("utf-8", errors="replace")[:200])
        body, code = proc.stdout[:-3], proc.stdout[-3:].decode()
        if code in ("200", "20"):
            return body
        if code in ("406", "429"):
            wait = 60 * (3 ** attempt)  # 60s/180s/540s/1620s——实测配额窗口冷却约 3 分钟
            print(f"[arxiv_search] HTTP {code}（arXiv 限流/封禁信号），退避 {wait}s 后重试（第 {attempt+1} 次）", flush=True)
            time.sleep(wait)
            continue
        raise OSError(f"HTTP {code}: {body[:150]}")
    raise OSError("arXiv 连续限流 4 次——出口 IP 配额耗尽（共享 IP 常见，冷却约 3-10 分钟），"
                  "稍后重试即可；已配 AS_ARXIV_PROXY 时仍出现说明代理出口 IP 也到限额")


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
