"""把 P3 规范化产物灌入论文标识符级缓存（DOI/arXiv/标题键）。
用法：python cache_ingest.py --normalized unified_records.csv --cache-db paper_cache.sqlite3
由执行器在 W1-P3 完成后自动调用（runner 状态机的 W1 收尾步骤）。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from paper_cache import PaperCache


def main() -> int:
    parser = argparse.ArgumentParser(description="灌入论文缓存")
    parser.add_argument("--normalized", required=True, help="unified_records.csv 路径")
    parser.add_argument("--cache-db", default="paper_cache.sqlite3", help="缓存 SQLite 路径（默认相对工作目录）")
    args = parser.parse_args()

    cache = PaperCache(args.cache_db)
    added = 0
    with open(args.normalized, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if cache.upsert({
                "paperIdx": None,
                "source": "corpus",
                "source_db": row.get("source_db", ""),
                "title": row.get("title", ""),
                "authors": [a for a in (row.get("authors") or "").split(";") if a],
                "year": int(row["year"]) if row.get("year", "").isdigit() else None,
                "doi": row.get("doi", ""),
                "venue": row.get("venue", ""),
                "url": row.get("url", ""),
                "abstract": row.get("abstract", ""),
            }):
                added += 1
    total = cache.count()
    print(f"缓存灌入完成：新增 {added}，总计 {total} 篇")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
