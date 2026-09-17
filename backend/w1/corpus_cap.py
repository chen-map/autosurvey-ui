"""corpus_cap.py — 最终保留上限截断（W1-P4 收尾步骤）。

按质量总分（total_score）降序保留 top-N，其余标记 excluded_by_cap。
用法：
    python corpus_cap.py --input stage6_final.csv --cap 500
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="按 corpusCap 截断最终语料")
    parser.add_argument("--input", required=True, help="stage6_final.csv")
    parser.add_argument("--cap", type=int, default=500)
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"输入不存在: {path}")
        return 1

    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) <= args.cap:
        print(f"{len(rows)} 篇 ≤ 上限 {args.cap}，无需截断")
        return 0

    def score(row: dict) -> float:
        try:
            return float(row.get("total_score", "") or 0)
        except ValueError:
            return 0.0

    rows.sort(key=score, reverse=True)
    keep = rows[: args.cap]
    drop = rows[args.cap :]

    for r in drop:
        r["qa_decision"] = "excluded_by_cap"
        r["cap_note"] = "超出 corpusCap 上限，按质量分排序截断"

    fields = list(keep[0].keys()) if keep else []
    for r in drop:
        for f in r:
            if f not in fields:
                fields.append(f)

    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(keep + drop)

    print(f"截断完成：保留 {len(keep)} 篇，移除 {len(drop)} 篇（标记 excluded_by_cap）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
