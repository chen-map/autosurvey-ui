"""simple_screen.py — 简化版六阶段筛选（关键词打分，替代 legacy 多阶段接力）。
从 unified_records.csv 出发，输出筛选后的 high_relevance 子集。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
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

    # IDF 加权打分：通用词（graph/neural）几乎篇篇命中、无区分度，
    # 区分词（explain-）少见、才是主题信号。weight = log(N/df)，df=命中篇数。
    # 词干归并：explainability/explainable/explanation 归并为 explain 家族，
    # 否则 XAI 论文大多用 explainable/explanation 而漏检。
    import math

    def stem(w: str) -> str:
        for suf in ("ability", "ments", "ment", "ation", "tion", "sion", "ing", "ies", "ed", "es", "s"):
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                return w[: len(w) - len(suf)]
        return w

    stems = {stem(w) for w in words}
    texts = [(r.get("title", "") + " " + r.get("abstract", "")).lower() for r in rows]
    n = max(1, len(rows))
    # 词边界前缀匹配：graph 能命中 graphs/graphical，但不能命中 cryptography；
    # explain 能命中 explainable/explanation，但不误伤无关词
    pat = {s: re.compile(rf"\b{s}") for s in stems}
    df = {s: sum(1 for t in texts if pat[s].search(t)) for s in stems}
    idf = {s: math.log(n / max(1, df[s])) for s in stems}

    # 概念词自动识别：主题里最稀有（df 最低）的词干是核心概念（如 explain-），
    # 其余（graph/neural/network 这类领域背景词）只做次级排序——
    # 否则宽语料上背景词会把真 XAI 论文挤出 Top-N
    df_min = min(df.values()) if df else 0
    concept = {s for s in stems if df_min and df[s] <= max(2 * df_min, 1)}

    for r, text in zip(rows, texts):
        title_low = r.get("title", "").lower()
        present = [s for s in stems if pat[s].search(text)]
        # 标题是强信号：命中再加一次权重
        score = sum(idf[s] * (10 if s in concept else 1) * (2 if pat[s].search(title_low) else 1)
                    for s in present)
        r["_score"] = round(score, 3)
        r["_relevant"] = "true" if present else "false"

    kept = [r for r in rows if r["_relevant"] == "true"]
    dropped = [r for r in rows if r["_relevant"] != "true"]

    # 评分降序（同分按年份新→旧）：下游 download_prep --limit N 截断的是
    # 得分最高的 Top-N，而非输入顺序的前 N
    def year_key(r: dict) -> int:
        y = str(r.get("year", "")).strip()
        return int(y) if y.isdigit() else 0

    kept.sort(key=lambda r: (-int(r["_score"]), -year_key(r)))

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
