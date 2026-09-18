"""simple_screen.py — 简化版六阶段筛选（关键词打分，替代 legacy 多阶段接力）。
从 unified_records.csv 出发，输出筛选后的 high_relevance 子集。
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="简化六阶段筛选")
    parser.add_argument("--input", required=True, help="unified_records.csv")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    stop = {"的", "与", "和", "在", "及", "for", "and", "the", "of", "a", "in", "to"}
    words = {w.lower().strip() for w in args.topic.replace("：", " ").replace("，", " ").split() if len(w.strip()) >= 2 and w.lower().strip() not in stop}

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    with open(args.input, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    for r in rows:
        text = (r.get("title", "") + " " + r.get("abstract", "")).lower()
        hits = sum(1 for w in words if w in text)
        r["_score"] = hits
        r["_relevant"] = "true" if hits >= 1 else "false"

    kept = [r for r in rows if r["_relevant"] == "true"]
    dropped = [r for r in rows if r["_relevant"] != "true"]

    # PRISMA 漏斗
    funnel = [
        {"stage": "检索总量", "count": len(rows)},
        {"stage": "关键词命中", "count": len(kept)},
        {"stage": "最终保留", "count": len(kept)},
    ]

    out_path = out_dir / "screened_records.csv"
    fields = list(kept[0].keys()) if kept else ["title"]
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(kept)

    log_path = out_dir / "screening_log.md"
    log_path.write_text(
        f"# PRISMA 筛选日志\n\n"
        f"检索总量: {len(rows)}\n关键词命中: {len(kept)}\n排除: {len(dropped)}\n\n"
        f"## 保留论文\n" + "\n".join(f"- {r['title']}" for r in kept) + "\n",
        encoding="utf-8")

    print(f"筛选完成: {len(rows)} → {len(kept)} (排除了 {len(rows) - len(kept)} 篇不相关)")
    print(f"结果: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
