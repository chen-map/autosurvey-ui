#!/usr/bin/env python3
"""arxiv_title_backfill.py — 占位论文的 arXiv 预印本回捞（W1-P6 补充通道）。

背景（用户裁决）：占位 ≠ 付费墙——OpenAlex 按 DOI 查 oa_status 时，"IEEE 正式版
+ arXiv 预印本"是两条独立 work 记录，DOI 命中的正式版标 closed，预印本被漏看。
多智能体等领域 arXiv 覆盖率高，按标题搜 arXiv（ti:"..."）能救回大批"伪付费墙"。

流程：papers/ 目录占位 txt 清单 → 逐篇 arXiv 标题查询（前 8 词）→ token 重合
校验（≥0.8）防误配 → 命中则 arxiv.org/pdf/{id} 下载（%PDF+EOF 校验）→
替换占位 txt + corpus_papers 入账 downloaded。

限速：查询 3s / 下载 5s（arXiv 合规节奏）；双通道（AS_ARXIV_PROXY 同款回退）。
用法：
  python arxiv_title_backfill.py --workspace <w1 工作区> --project-id <pid>
      [--max 0] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"a": "http://www.w3.org/2005/Atom"}
API = "https://export.arxiv.org/api/query"


def _curl(url: str, proxy: str) -> tuple[bytes, str, int]:
    cmd = ["curl", "-sS", "-g", "-L", "--max-time", "45", "-w", "%{http_code}",
           "-A", "AutoSurvey-backfill/0.1 (contact: researcher@example.com)"]
    if proxy:
        cmd += ["-x", proxy]
    proc = subprocess.run(cmd + [url], capture_output=True)
    if proc.returncode != 0:
        return b"", "", proc.returncode
    return proc.stdout[:-3], proc.stdout[-3:].decode(), 0


def fetch_with_fallback(url: str, proxy: str) -> bytes:
    cur = ""
    for attempt in range(6):
        body, code, rc = _curl(url, cur)
        if rc == 0 and code in ("200", "20"):
            return body
        if rc != 0 or code in ("406", "429"):
            other = proxy if cur == "" and proxy else ""
            if other != cur and (rc != 0 or code in ("406", "429")):
                cur = other
                continue
            time.sleep(20 * (attempt + 1))
            continue
        raise OSError(f"HTTP {code}")
    raise OSError("回捞查询连续失败")


def tokens(t: str) -> set[str]:
    stop = {"a", "an", "the", "for", "of", "and", "in", "on", "to", "with", "via", "from"}
    return {w for w in re.findall(r"[a-z0-9]+", (t or "").lower()) if w not in stop}


def overlap(title_a: str, title_b: str) -> float:
    ta, tb = tokens(title_a), tokens(title_b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def main() -> int:
    ap = argparse.ArgumentParser(description="arXiv 预印本回捞")
    ap.add_argument("--workspace", required=True, help="项目 w1 工作区")
    ap.add_argument("--project-id", required=True)
    ap.add_argument("--max", type=int, default=0, help="最多处理 N 篇（0=全部）")
    ap.add_argument("--min-overlap", type=float, default=0.8)
    ap.add_argument("--dry-run", action="store_true", help="只统计可回捞数不下载")
    args = ap.parse_args()

    ws = Path(args.workspace)
    papers_dir = ws / "retrieval_workspace" / "papers"
    ready_csv = ws / "retrieval_workspace" / "download" / "download_ready.csv"
    proxy = os.environ.get("AS_ARXIV_PROXY", "").strip()

    rows = list(csv.DictReader(open(ready_csv, encoding="utf-8-sig")))
    pdf_rids = {p.name[:4] for p in papers_dir.glob("*.pdf") if p.name[:4].isdigit()}
    todo = []
    for r in rows:
        m = re.match(r"^(\d+)", r.get("record_id") or "")
        if not m:
            continue
        rid = f"{int(m.group(1)):04d}"
        title = (r.get("title") or "").strip()
        if title and rid not in pdf_rids:
            todo.append((rid, title, r))
        if args.max and len(todo) >= args.max:
            break
    print(f"[backfill] 占位待回捞 {len(todo)} 篇", flush=True)

    stats = {"hit": 0, "miss": 0, "downloaded": 0, "fail_dl": 0, "detail": []}
    for rid, title, row in todo:
        # 原始标题整串查询（实测去停用词拼接会失配，原题精确命中）
        q = urllib.parse.quote(f'ti:"{title[:120]}"', safe="")
        url = f"{API}?search_query={q}&max_results=3"
        try:
            body = fetch_with_fallback(url, proxy)
            root = ET.fromstring(body)
        except Exception as e:
            stats["miss"] += 1
            stats["detail"].append({"rid": rid, "note": f"查询失败 {type(e).__name__}"})
            time.sleep(3)
            continue
        best_id, best_ov = "", 0.0
        for e in root.findall("a:entry", NS):
            aid_raw = e.findtext("a:id", "", NS) or ""
            m2 = re.search(r"abs/([^\s]+)", aid_raw)
            if not m2:
                continue
            ov = overlap(title, e.findtext("a:title", "", NS) or "")
            if ov > best_ov:
                best_ov, best_id = ov, m2.group(1)
        if not best_id or best_ov < args.min_overlap:
            stats["miss"] += 1
            time.sleep(3)
            continue
        stats["hit"] += 1
        if args.dry_run:
            stats["detail"].append({"rid": rid, "arxiv": best_id, "overlap": round(best_ov, 2)})
            time.sleep(3)
            continue
        # 下载预印本 PDF
        dest = papers_dir / f"{rid}_{re.sub(r'[^\w\-]+', '_', title[:60]).strip('_')}.pdf"
        try:
            body, code, rc = _curl(f"https://arxiv.org/pdf/{best_id}", "")
            if rc == 0 and code in ("200", "20") and body[:4] == b"%PDF" and b"%%EOF" in body[-32:]:
                dest.write_bytes(body)
                for old in papers_dir.glob(f"{rid}*.txt"):
                    old.unlink(missing_ok=True)
                stats["downloaded"] += 1
                stats["detail"].append({"rid": rid, "arxiv": best_id, "overlap": round(best_ov, 2)})
                print(f"[backfill] ✓ {rid} ← arXiv {best_id}（ov={best_ov:.2f}）", flush=True)
            else:
                stats["fail_dl"] += 1
        finally:
            time.sleep(5)

    out_stats = ws / "retrieval_workspace" / "download" / "arxiv_backfill_stats.json"
    out_stats.write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[backfill] 命中 {stats['hit']}/{len(todo)}，下载 {stats['downloaded']}，"
          f"未命中 {stats['miss']} → {out_stats}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
