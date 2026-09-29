#!/usr/bin/env python3
"""oa_download.py — 合法 OA 直链下载器（W1-P6 第三通道）。

对 download_ready.csv 中带 oa_pdf_url（download_prep 经 OpenAlex
best_oa_location 批量解析）且 PDF 尚未落盘的记录直接下载：
出版社官方 OA 版 / 机构仓库版 / arXiv 仓库版——完全合规，无需订阅。

落盘契约与 arxiv_batch 一致：papers/{record_id:04d}.pdf，
corpus_ingest 按 download_ready + papers/ 目录落账。

用法：
  python oa_download.py --input download/download_ready.csv --out-dir papers/
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import time
from pathlib import Path

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def dest_name(record_id: str, title: str = "") -> str:
    """与其他通道统一：{rid:04d}_{title slug}.pdf（纯数字名曾致同 rid 双文件，
    回捞器/arxiv_batch 认不出 OA 版已下过 → 重复下载 20 篇，实测教训）。"""
    rid = re.sub(r"\D", "", record_id) or "0"
    slug = re.sub(r"[^\w\-]+", "_", (title or "").strip())[:60].strip("_")
    return f"{int(rid):04d}_{slug}.pdf" if slug else f"{int(rid):04d}.pdf"


def pdf_ok(path: Path) -> bool:
    try:
        head = path.open("rb").read(4)
        tail = path.open("rb").read()[-32:]
    except OSError:
        return False
    return head == b"%PDF" and (b"%%EOF" in tail)


def main() -> int:
    ap = argparse.ArgumentParser(description="OA 直链下载器")
    ap.add_argument("--input", required=True, help="download_ready.csv")
    ap.add_argument("--out-dir", required=True, help="papers/ 目录")
    ap.add_argument("--min-interval-sec", type=float, default=2.0)
    ap.add_argument("--max", type=int, default=0, help="0=不限")
    ap.add_argument("--stats-out", default="")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.input, encoding="utf-8-sig")))
    title_of = {r.get("record_id") or "": (r.get("title") or "") for r in rows}
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # 断点：已有合法 PDF 的跳过（arxiv_batch 可能已下）
    todo = []
    for r in rows:
        url = (r.get("oa_pdf_url") or "").strip()
        if not url:
            continue
        dest = out / dest_name(r.get("record_id") or "0", title_of.get(r.get("record_id") or "", ""))
        if dest.exists() and pdf_ok(dest):
            continue
        todo.append((r, dest))
    if args.max:
        todo = todo[: args.max]
    print(f"[oa-dl] 待下载 {len(todo)} 条（OA 直链）", flush=True)

    stats = {"total": len(todo), "downloaded": 0, "failed": 0, "fail_list": []}
    for r, dest in todo:
        url = (r.get("oa_pdf_url") or "").strip()
        if not url:
            continue
        rc = subprocess.run(
            ["curl", "-sS", "-L", "--max-time", "120",
             "--connect-timeout", "15", "-A", UA, "-o", str(dest) + ".part", url],
            capture_output=True)
        ok = rc.returncode == 0 and Path(str(dest) + ".part").exists() and pdf_ok(Path(str(dest) + ".part"))
        if ok:
            Path(str(dest) + ".part").replace(dest)
            stats["downloaded"] += 1
        else:
            Path(str(dest) + ".part").unlink(missing_ok=True)
            stats["failed"] += 1
            stats["fail_list"].append({"record_id": r.get("record_id"), "doi": r.get("doi"),
                                       "url": url, "err": rc.stderr.decode("utf-8", "replace")[:120]})
        n = stats["downloaded"] + stats["failed"]
        if n % 20 == 0:
            print(f"[oa-dl] 进度 {n}/{len(todo)}（成功 {stats['downloaded']}）", flush=True)
        time.sleep(args.min_interval_sec)

    stats_path = Path(args.stats_out or (Path(args.input).parent / "oa_download_stats.json"))
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[oa-dl] 完成：成功 {stats['downloaded']} / 失败 {stats['failed']} → {stats_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
