#!/usr/bin/env python3
"""W5-P1 工作台装配：把本项目的 W3/W4 产物映射到 run_workflow5 期望的 workspace 布局。

期望布局（GUIDE/源码契约）：
  <staging>/workflow_3/analyze_report/{survey_outline.json, rq_evidence_matrix.json, design_report.md}
  <staging>/workflow_4/working_memory/{rq_*/..., WORKING_MEMORY_INDEX.json}
  <staging>/knowledge_graph/structured_papers.jsonl
  <staging>/paper_cards/index/PAPER_INDEX.csv   ← 由解析卡生成（paper_id/title/authors/year/venue/url）

装配为复制而非链接（Windows 符号链接需特权），全量体量 ~几十 MB 可接受。
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="W5 工作台装配")
    ap.add_argument("--workspace", default=".", help="项目 w1 工作区（含 analyze_report/knowledge_graph/paper_cards/working_memory）")
    ap.add_argument("--staging", default="retrieval_workspace/w5_workspace")
    args = ap.parse_args()

    ws = Path(args.workspace)
    st = Path(args.staging)
    if st.exists():
        shutil.rmtree(st)

    # 目录映射
    maps = {
        ws / "analyze_report": st / "workflow_3" / "analyze_report",
        ws / "working_memory": st / "workflow_4" / "working_memory",
        ws / "knowledge_graph" / "structured_papers.jsonl": st / "knowledge_graph" / "structured_papers.jsonl",
    }
    for src, dst in maps.items():
        if not src.exists():
            print(f"[stage] 缺少 {src}，跳过")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # PAPER_INDEX.csv：run_workflow5 的 bib 元数据源（paper_id/title/authors/year/venue/url）
    cards_dir = ws / "paper_cards" / "parsed"
    idx_dir = st / "paper_cards" / "index"
    idx_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for f in sorted(cards_dir.glob("*.json")):
        try:
            c = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        authors = c.get("authors")
        if isinstance(authors, list):
            authors = "; ".join(map(str, authors))
        rows.append({
            "paper_id": str(c.get("paper_id") or f.stem),
            "title": str(c.get("title") or ""),
            "authors": str(authors or ""),
            "year": str(c.get("year") or ""),
            "venue": str(c.get("venue") or ""),
            "url": str(c.get("url") or ""),
        })
    with open(idx_dir / "PAPER_INDEX.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["paper_id", "title", "authors", "year", "venue", "url"])
        w.writeheader()
        w.writerows(rows)

    print(f"[stage] 装配完成 → {st}")
    print(f"[stage] PAPER_INDEX: {len(rows)} 篇")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
