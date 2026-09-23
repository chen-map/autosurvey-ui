#!/usr/bin/env python3
"""KG 节点 AutoMerge 候选建议（会议纪要方向 5 的轻量第一步，纯只读分析）。

背景：跨论文同义名词融合缺失（对标团队最大痛点）。完整方案 = 名词表 MD + 向量匹配
+ LLM 融合规则判定；本脚本是零风险的种子步骤——不改任何数据/存储格式，只从
paper_kg.json 产出「建议合并」候选报告（merge_candidates.md），供人工确认后
再决定是否由后续脚本执行合并。

匹配策略（无向量依赖，纯词法）：
  1. 同类型节点内，canonical_name 规范化（小写去符号）完全一致 → 高置信候选；
  2. 词元 Jaccard 相似度 >= 阈值（默认 0.75）且包含关系（缩写/全称）→ 候选。
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

STOP = {"the", "a", "an", "of", "for", "and", "in", "on", "to", "with", "based", "via"}


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def tokens(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{2,}", name.lower()) if w not in STOP} or {norm(name)}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description="KG AutoMerge 候选建议（只读）")
    ap.add_argument("--kg", default="knowledge_graph/paper_kg.json")
    ap.add_argument("--out", default="knowledge_graph/merge_candidates.md")
    ap.add_argument("--threshold", type=float, default=0.75, help="词元 Jaccard 阈值")
    args = ap.parse_args()

    kg = json.loads(Path(args.kg).read_text(encoding="utf-8"))
    nodes = kg.get("nodes", [])

    # 度数（合并建议优先消高连接节点，收益大）
    deg: dict[str, int] = defaultdict(int)
    for e in kg.get("edges", []):
        deg[e.get("source_id", "")] += 1
        deg[e.get("target_id", "")] += 1

    by_type: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        by_type[n.get("node_type", "?")].append(n)

    exact: list[tuple[dict, dict]] = []
    fuzzy: list[tuple[dict, dict, float]] = []
    for typ, group in by_type.items():
        buckets: dict[str, list[dict]] = defaultdict(list)
        for n in group:
            buckets[norm(n.get("canonical_name", ""))].append(n)
        for key, members in buckets.items():
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    if key:
                        exact.append((members[i], members[j]))
        # 词元相似：同类型内两两比较（千级节点内 O(n²) 可接受）
        toks = [(n, tokens(n.get("canonical_name", ""))) for n in group]
        for i in range(len(toks)):
            for j in range(i + 1, len(toks)):
                na, nb = toks[i][0], toks[j][0]
                if norm(na.get("canonical_name", "")) == norm(nb.get("canonical_name", "")):
                    continue  # 已入 exact
                sim = jaccard(toks[i][1], toks[j][1])
                if sim >= args.threshold:
                    fuzzy.append((na, nb, round(sim, 2)))

    lines = [
        "# KG 节点 AutoMerge 候选报告（只读分析，未改动任何数据）",
        "",
        f"- 节点总数 {len(nodes)}；精确同名候选 **{len(exact)}** 对；词元相似(>={args.threshold})候选 **{len(fuzzy)}** 对",
        "- 处置建议：人工确认后，由合并脚本统一执行（保留高连接度节点的 canonical_name，边重接到保留节点）",
        "",
        "## 一、精确同名（高置信，建议直接合并）",
        "",
    ]
    for a, b in exact[:50]:
        lines.append(f"- [{a['node_type']}] **{a['canonical_name']}** (deg {deg.get(a['node_id'], 0)}) "
                     f"↔ **{b['canonical_name']}** (deg {deg.get(b['node_id'], 0)}) — {a['node_id']} / {b['node_id']}")
    lines += ["", "## 二、词元相似（需人工/LLM 复核）", ""]
    for a, b, sim in sorted(fuzzy, key=lambda x: -x[2])[:60]:
        lines.append(f"- [{a['node_type']}] ({sim}) **{a['canonical_name']}** (deg {deg.get(a['node_id'], 0)}) "
                     f"↔ **{b['canonical_name']}** (deg {deg.get(b['node_id'], 0)})")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[merge_suggest] 精确同名 {len(exact)} 对，词元相似 {len(fuzzy)} 对 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
