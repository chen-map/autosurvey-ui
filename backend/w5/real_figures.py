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


def load_rq_papers(matrix_json: Path) -> dict[str, set]:
    """RQ -> 冻结证据论文集合（sub_rq 归并到宏 RQ）。"""
    m = json.loads(matrix_json.read_text(encoding="utf-8"))
    rq: dict[str, set] = {}
    for e in m.get("sub_rq_matrix", []):
        rid = e.get("rq_id") or ""
        rq.setdefault(rid, set()).update(e.get("paper_ids_ranked") or [])
    return rq


def load_rq_claims(wm_dir: Path) -> dict[str, dict]:
    """RQ -> {claims, with_evidence, avg_ev}（论断证据支撑度）。"""
    out: dict[str, dict] = {}
    for d in sorted(wm_dir.glob("rq_*")):
        f = d / "answer_claims.json"
        if not f.exists():
            continue
        ac = json.loads(f.read_text(encoding="utf-8"))
        rid = ac.get("rq_id") or d.name
        cs = ac.get("key_claims") or []
        ev_counts = [len([x for x in (c.get("evidence_papers") or []) if x]) for c in cs]
        out[rid] = {"claims": len(cs),
                    "with_evidence": sum(1 for n in ev_counts if n > 0),
                    "avg_ev": (sum(ev_counts) / len(ev_counts)) if ev_counts else 0.0}
    return out


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

    # 图 4：RQ 间证据共享热力图（哪些论文同时支撑多个 RQ——揭示 RQ 证据耦合）
    matrix_json = ws / "analyze_report" / "rq_evidence_matrix.json"
    rq_papers = load_rq_papers(matrix_json) if matrix_json.exists() else {}
    rq_ids = sorted(rq_papers.keys())
    if len(rq_ids) >= 2:
        n = len(rq_ids)
        mat = [[0] * n for _ in range(n)]
        for i, a in enumerate(rq_ids):
            for j, b in enumerate(rq_ids):
                mat[i][j] = len(rq_papers[a] & rq_papers[b]) if i != j else len(rq_papers[a])
        vmax = max(max(r) for r in mat)
        fig, ax = plt.subplots(figsize=(4.6, 4.0))
        im = ax.imshow(mat, cmap="Greys")
        ax.set_xticks(range(n), rq_ids, rotation=45, ha="right")
        ax.set_yticks(range(n), rq_ids)
        for i in range(n):
            for j in range(n):
                ax.text(j, i, str(mat[i][j]), ha="center", va="center", fontsize=8,
                        color="white" if mat[i][j] > vmax * 0.55 else "black")
        fig.colorbar(im, ax=ax, shrink=0.8, label="Shared papers")
        ax.set_title("Cross-RQ evidence sharing")
        fig.tight_layout()
        fig.savefig(fig_dir / "fig_rq_sharing.png", bbox_inches="tight")
        plt.close(fig)

    # 图 5：各 RQ 论断证据支撑度（claims 数 / 有证据占比）
    wm_dir = ws / "working_memory"
    rq_claims = load_rq_claims(wm_dir) if wm_dir.exists() else {}
    if rq_claims:
        ids = sorted(rq_claims.keys())
        claims = [rq_claims[k]["claims"] for k in ids]
        pct = [100 * rq_claims[k]["with_evidence"] / max(rq_claims[k]["claims"], 1) for k in ids]
        fig, ax1 = plt.subplots(figsize=(5.2, 2.8))
        xs = range(len(ids))
        ax1.bar(xs, claims, color="#2b2b2b", width=0.55, label="Key claims")
        ax1.set_xticks(list(xs), ids)
        ax1.set_ylabel("Key claims")
        style_axes(ax1)
        ax2 = ax1.twinx()
        ax2.plot(list(xs), pct, "o--", color="#777", lw=1.2, ms=4)
        ax2.set_ylabel("% claims with evidence")
        ax2.set_ylim(0, 110)
        ax2.spines["top"].set_visible(False)
        for i, v in enumerate(pct):
            ax2.text(i, v + 4, f"{v:.0f}%", ha="center", fontsize=7.5, color="#555")
        ax1.set_title("Evidence backing of per-RQ key claims")
        fig.tight_layout()
        fig.savefig(fig_dir / "fig_rq_claims.png", bbox_inches="tight")
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
    if rq_papers and len(rq_ids) >= 2:
        inc.append(
            "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.58\\textwidth]{figures/fig_rq_sharing.png}\n"
            "  \\caption{Cross-RQ evidence sharing: number of frozen evidence papers shared between each pair of research questions (diagonal = each RQ's evidence set size). Shared papers are the coupling points of the survey's argument structure.}\n"
            "  \\label{fig:rq-sharing}\n\\end{figure}\n")
    if rq_claims:
        inc.append(
            "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.72\\textwidth]{figures/fig_rq_claims.png}\n"
            "  \\caption{Evidence backing of per-RQ key claims: bars = number of key claims; line = share of claims backed by at least one evidence paper.}\n"
            "  \\label{fig:rq-claims}\n\\end{figure}\n")
    (fig_dir / "latex_includes.tex").write_text("\n".join(inc), encoding="utf-8")
    print(f"[real_figures] years={sum(years.values())} kg_nodes={sum(nodes.values())} kg_edges={sum(edges.values())} rq_figs={len(rq_papers)}+{len(rq_claims)} → latex_includes.tex 重写")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
