#!/usr/bin/env python3
"""W5 真实数据图：从语料与 KG 统计生成综述标准统计图（年份分布 / KG 结构分布）。

替换 run_workflow5 的流水线自评图（fig_rq_evidence / fig_claim_quality）——
那些图是流水线自我欣赏，真实综述的图应来自语料本身的数据。
输出 PNG 到 figures/ 并重写 latex_includes.tex。
matplotlib 缺失时优雅跳过。
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def load_years(download_ready: Path) -> Counter:
    years: Counter = Counter()
    if download_ready.exists():
        for row in csv.DictReader(open(download_ready, encoding="utf-8-sig")):
            y = str(row.get("year") or "").strip()
            if y.isdigit():
                years[int(y)] += 1
    return years


def load_kg(kg_json: Path):
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    nodes = Counter(n.get("node_type", "?") for n in kg.get("nodes", []))
    edges = Counter(e.get("edge_type", "?") for e in kg.get("edges", []))
    n_papers = sum(1 for n in kg.get("nodes", []) if n.get("node_type") == "Paper")
    return nodes, edges, n_papers


def style_axes(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.25)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="W5 真实数据统计图")
    ap.add_argument("--workspace", default=".")
    args = ap.parse_args(argv)  # argv=None 走 sys.argv；被 compile_pdf 内嵌调用时传 [] 用默认值

    ws = Path(args.workspace)
    download = ws / "retrieval_workspace" / "download" / "download_ready.csv"
    kg_json = ws / "knowledge_graph" / "paper_kg.json"
    fig_dir = ws / "survey_paper" / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)

    if not kg_json.exists():
        print("[real_figures] KG 缺失，跳过")
        return 0

    plt.rcParams.update({"font.size": 9, "figure.dpi": 200})

    # 图 1：语料年份分布（下载就绪池 = 综述覆盖范围）
    years = load_years(download)
    if years:
        xs = sorted(years)
        fig, ax = plt.subplots(figsize=(5.2, 2.6))
        ax.bar([str(x) for x in xs], [years[x] for x in xs], color="#2b2b2b", width=0.62)
        for i, x in enumerate(xs):
            ax.text(i, years[x] + max(years.values()) * 0.02, str(years[x]), ha="center", fontsize=8)
        ax.set_xlabel("Publication year")
        ax.set_ylabel("Papers in corpus")
        style_axes(ax)
        fig.tight_layout()
        fig.savefig(fig_dir / "fig_years.png", bbox_inches="tight")
        plt.close(fig)

    # 图 2/3：KG 六类对象与关系边分布
    nodes, edges, n_papers = load_kg(kg_json)
    if nodes:
        items = nodes.most_common()
        fig, ax = plt.subplots(figsize=(5.2, 2.6))
        ax.barh([k for k, _ in items][::-1], [v for _, v in items][::-1], color="#2b2b2b", height=0.6)
        for i, (_, v) in enumerate(reversed(items)):
            ax.text(v + max(nodes.values()) * 0.01, i, str(v), va="center", fontsize=8)
        ax.set_xlabel(f"Entities in KG (from {n_papers} papers)")
        style_axes(ax)
        fig.tight_layout()
        fig.savefig(fig_dir / "fig_kg_nodes.png", bbox_inches="tight")
        plt.close(fig)

    if edges:
        items = edges.most_common(8)
        fig, ax = plt.subplots(figsize=(5.2, 2.6))
        ax.barh([k for k, _ in items][::-1], [v for _, v in items][::-1], color="#2b2b2b", height=0.6)
        for i, (_, v) in enumerate(reversed(items)):
            ax.text(v + max(edges.values()) * 0.01, i, str(v), va="center", fontsize=8)
        ax.set_xlabel("Relation edges in KG")
        style_axes(ax)
        fig.tight_layout()
        fig.savefig(fig_dir / "fig_kg_edges.png", bbox_inches="tight")
        plt.close(fig)

    # 重写 latex_includes.tex：真实数据图替换流水线自评图
    inc = ["% Figure includes rewritten by W5 real-data figures.\n"]
    if years:
        inc.append(
            "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.72\\textwidth]{figures/fig_years.png}\n"
            "  \\caption{Temporal distribution of the surveyed corpus (papers in the download-ready pool by publication year).}\n"
            "  \\label{fig:years}\n\\end{figure}\n")
    if nodes:
        inc.append(
            "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.72\\textwidth]{figures/fig_kg_nodes.png}\n"
            f"  \\caption{{Distribution of the six entity types extracted into the knowledge graph from {n_papers} surveyed papers.}}\n"
            "  \\label{fig:kg-nodes}\n\\end{figure}\n")
    if edges:
        inc.append(
            "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.72\\textwidth]{figures/fig_kg_edges.png}\n"
            "  \\caption{Distribution of relation types connecting entities in the knowledge graph.}\n"
            "  \\label{fig:kg-edges}\n\\end{figure}\n")
    (fig_dir / "latex_includes.tex").write_text("\n".join(inc), encoding="utf-8")
    print(f"[real_figures] years={sum(years.values())} kg_nodes={sum(nodes.values())} kg_edges={sum(edges.values())} → latex_includes.tex 重写")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
