#!/usr/bin/env python3
"""kg_adapter.py — W2 单文件 KG → v3 KGLoader 目录布局适配器。

输入：knowledge_graph/paper_kg.json（{papers, nodes, edges}）
输出：<out>/nodes/{problems,methods,papers,datasets_benchmarks,metrics,limitations,assumptions_constraints}.json
      <out>/edges/{edge_type}.json（每类一文件）

字段契约：两边同构（node_id/node_type/canonical_name/description/origin_paper_id；
source_id/target_id/edge_type/confidence/evidence），无需改名——papers 列表
升格为 paper 节点（node_id=paper_id, canonical_name=title, description=summary）。
断点友好：输出已存在且非空则跳过（幂等）。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

# node_type（KG 原生存法）→ v3 节点文件名
_NODE_FILES = {
    "Problem": "problems.json",
    "Method": "methods.json",
    "DatasetBenchmark": "datasets_benchmarks.json",
    "Metric": "metrics.json",
    "Limitation": "limitations.json",
    "AssumptionConstraint": "assumptions_constraints.json",
}


def main() -> int:
    ap = argparse.ArgumentParser(description="W2 KG → v3 目录布局")
    ap.add_argument("--kg", required=True, help="paper_kg.json 路径")
    ap.add_argument("--out", required=True, help="输出根目录（kg_v3）")
    args = ap.parse_args()

    kg_path = Path(args.kg)
    if not kg_path.exists():
        raise SystemExit(f"[kg_adapter] KG 不存在: {kg_path}（先跑 W2）")
    out = Path(args.out)
    marker = out / "nodes" / "papers.json"
    if marker.exists() and marker.stat().st_size > 2:
        print(f"[kg_adapter] 已存在，跳过: {out}")
        return 0

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    nodes_out = out / "nodes"
    edges_out = out / "edges"
    nodes_out.mkdir(parents=True, exist_ok=True)
    edges_out.mkdir(parents=True, exist_ok=True)

    # 概念节点按类型分文件（节点 dict 原样直通）
    by_type: dict[str, list[dict]] = {}
    for n in kg.get("nodes", []):
        by_type.setdefault(n.get("node_type", ""), []).append(n)

    # 论文列表升格为 paper 节点
    paper_nodes = [{
        "node_id": p.get("paper_id"),
        "node_type": "Paper",
        "canonical_name": p.get("title") or p.get("paper_id"),
        "description": (p.get("summary") or "")[:2000],
        "origin_paper_id": p.get("paper_id"),
    } for p in kg.get("papers", []) if p.get("paper_id")]

    counts: dict[str, int] = {"Paper": len(paper_nodes)}
    for ntype, fname in _NODE_FILES.items():
        items = by_type.get(ntype, [])
        (nodes_out / fname).write_text(
            json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        counts[ntype] = len(items)
    (nodes_out / "papers.json").write_text(
        json.dumps(paper_nodes, ensure_ascii=False, indent=1), encoding="utf-8")
    # 未识别类型不丢弃，落 unknown_type.json 留痕
    unknown = [n for t, ns in by_type.items() if t not in _NODE_FILES for n in ns]
    if unknown:
        (nodes_out / "unknown_type.json").write_text(
            json.dumps(unknown, ensure_ascii=False, indent=1), encoding="utf-8")
        counts["<unknown>"] = len(unknown)

    # 边按 edge_type 分文件（原样直通）
    by_edge: dict[str, list[dict]] = {}
    for e in kg.get("edges", []):
        et = e.get("edge_type") or e.get("relation") or "related"
        by_edge.setdefault(et, []).append(e)
    for et, items in by_edge.items():
        safe = "".join(c if c.isalnum() or c in "_-" else "_" for c in et)
        (edges_out / f"{safe}.json").write_text(
            json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    n_edges = sum(len(v) for v in by_edge.values())
    print(f"[kg_adapter] 节点 {sum(counts.values())}（{counts}）")
    print(f"[kg_adapter] 边 {n_edges}（{len(by_edge)} 类: {sorted(by_edge)}）→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
