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


def load_method_tree(kg_json: Path, max_nodes: int = 18):
    """Method-Method extends 边的森林：返回 (nodes, edges) 最大分量（nodes=[name], edges=[(p,c)])。"""
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    names: dict[str, str] = {}
    types: dict[str, str] = {}
    for n in kg.get("nodes", []):
        nid = str(n.get("node_id") or "")
        if nid:
            names[nid] = n.get("canonical_name") or nid
            types[nid] = n.get("node_type") or ""
    # KG 的 extends 是 Paper→Paper（引文扩展）——方法族谱经论文桥接推导：
    # B extends A 且 A proposes X、B proposes Y ⇒ X→Y（Y 构建于 X 之上）
    paper_methods: dict[str, list] = {}
    for e in kg.get("edges", []):
        if e.get("edge_type") == "proposes":
            paper_methods.setdefault(str(e.get("source_id") or ""), []).append(str(e.get("target_id") or ""))
    ext: list[tuple[str, str]] = []
    deg: dict[str, int] = {}
    for e in kg.get("edges", []):
        if e.get("edge_type") != "extends":
            continue
        a, b = str(e.get("target_id") or ""), str(e.get("source_id") or "")  # b extends a → a 在前
        for x in paper_methods.get(a, []):
            for y in paper_methods.get(b, []):
                if x != y:
                    ext.append((x, y))
                    deg[x] = deg.get(x, 0) + 1
                    deg[y] = deg.get(y, 0) + 1
    if not ext:
        return [], []
    # 最大连通分量（并查集）
    parent = {n: n for n in set([x for p_ in ext for x in p_])}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a, b in ext:
        parent[find(a)] = find(b)
    from collections import Counter
    comp_counts = Counter(find(x) for x in parent)
    root_comp = comp_counts.most_common(1)[0][0]
    members = [x for x in parent if find(x) == root_comp]
    # 取度数最高的 max_nodes 个成员
    members.sort(key=lambda x: -deg.get(x, 0))
    keep = set(members[:max_nodes])
    nodes = [names[t] for t in keep]
    edges = [(names[a], names[b]) for a, b in ext if a in keep and b in keep]
    return nodes, edges


def draw_method_tree(fig_dir: Path, nodes, edges) -> bool:
    if len(nodes) < 3 or not edges:
        return False
    depth: dict[str, int] = {}
    children: dict[str, list] = {}
    all_nodes = set(nodes) | {x for e in edges for x in e}
    has_parent = {c for _, c in edges}
    roots = [n for n in all_nodes if n not in has_parent]
    def assign(n, d):
        if depth.get(n, 99) <= d:
            return
        depth[n] = d
        for c in children.get(n, []):
            assign(c, d + 1)
    for p, c in edges:
        children.setdefault(p, []).append(c)
    for r in roots:
        assign(r, 0)
    for n in all_nodes:
        depth.setdefault(n, 0)
    # 同层序号布局
    by_depth: dict[int, list] = {}
    for n in sorted(all_nodes):
        by_depth.setdefault(depth[n], []).append(n)
    pos: dict[str, tuple] = {}
    for d, ns in by_depth.items():
        for i, n in enumerate(ns):
            pos[n] = (d, i - (len(ns) - 1) / 2)
    fig, ax = plt.subplots(figsize=(9.5, 1.1 + 0.42 * max(len(v) for v in by_depth.values())))
    for p, c in edges:
        x1, y1 = pos[p]
        x2, y2 = pos[c]
        ax.plot([x1 + 0.04, x2 - 0.04], [y1, y2], color="#999", lw=0.8, zorder=1)
    for n, (x, y) in pos.items():
        ax.scatter([x], [y], s=26, color="#2b2b2b", zorder=2)
        ax.text(x + 0.07, y, n, fontsize=7, va="center")
    ax.set_xlim(-0.3, max(d for d, _ in pos.values()) + 0.3 + max(len(n) for n in all_nodes) * 0.052)
    ax.axis("off")
    ax.set_title("Method evolution tree (extends relations in the KG)", fontsize=9)
    fig.tight_layout()
    fig.savefig(fig_dir / "fig_method_tree.png", bbox_inches="tight")
    plt.close(fig)
    return True


def load_limitations(kg_json: Path, top: int = 12):
    """Limitation 节点按总度数 top-N（失效模式对比）。"""
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    deg: dict[str, int] = {}
    for e in kg.get("edges", []):
        for t in (str(e.get("source_id") or ""), str(e.get("target_id") or "")):
            deg[t] = deg.get(t, 0) + 1
    lims = []
    for n in kg.get("nodes", []):
        if n.get("node_type") == "Limitation":
            nid = str(n.get("node_id") or "")
            lims.append(((n.get("canonical_name") or nid)[:44], deg.get(nid, 0)))
    lims.sort(key=lambda kv: -kv[1])
    return lims[:top]


def load_paper_bridges(kg_json: Path, row_edge: str, col_edge: str, top: int = 12):
    """同一论文同时连接的两类概念节点的共现矩阵（轴=领域概念）。

    KG 边形如 Paper -edge-> Concept；row_edge 取行概念（如 evaluated_on→数据集），
    col_edge 取列概念（如 measured_by→指标）。返回 (row_names, col_names, mat)。
    """
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    names: dict[str, str] = {}
    for n in kg.get("nodes", []):
        nid = str(n.get("node_id") or "")
        if nid:
            names[nid] = n.get("canonical_name") or nid
    rows_of: dict[str, set] = {}
    cols_of: dict[str, set] = {}
    deg_r: dict[str, int] = {}
    deg_c: dict[str, int] = {}
    for e in kg.get("edges", []):
        et = e.get("edge_type") or ""
        tgt = str(e.get("target_id") or "")
        src = str(e.get("source_id") or "")
        if not tgt or not src:
            continue
        if et == row_edge:
            rows_of.setdefault(src, set()).add(tgt)
            deg_r[tgt] = deg_r.get(tgt, 0) + 1
        elif et == col_edge:
            cols_of.setdefault(src, set()).add(tgt)
            deg_c[tgt] = deg_c.get(tgt, 0) + 1
    rows = [t for t, _ in sorted(deg_r.items(), key=lambda kv: -kv[1])[:top]]
    cols = [t for t, _ in sorted(deg_c.items(), key=lambda kv: -kv[1])[:top]]
    mat = [[0] * len(cols) for _ in rows]
    for pid in set(rows_of) & set(cols_of):
        for r in rows_of[pid]:
            if r in rows:
                i = rows.index(r)
                for c in cols_of[pid]:
                    if c in cols:
                        mat[i][cols.index(c)] += 1
    return ([names.get(t, t)[:22] for t in rows],
            [names.get(t, t)[:16] for t in cols], mat)


def draw_cooccur(fig_dir: Path, fname: str, title: str, row_names, col_names, mat) -> bool:
    if not mat or not any(any(r) for r in mat):
        return False
    nr, nc = len(row_names), len(col_names)
    fig, ax = plt.subplots(figsize=(1.9 + 0.42 * nc, 1.6 + 0.30 * nr))
    ax.imshow(mat, cmap="Greys", aspect="auto")
    ax.set_xticks(range(nc), col_names, rotation=42, ha="right", fontsize=7)
    ax.set_yticks(range(nr), row_names, fontsize=7)
    vmax = max(max(r) for r in mat)
    for i in range(nr):
        for j in range(nc):
            if mat[i][j]:
                ax.text(j, i, str(mat[i][j]), ha="center", va="center", fontsize=6.5,
                        color="white" if mat[i][j] > vmax * 0.55 else "black")
    ax.set_title(title, fontsize=9)
    fig.tight_layout()
    fig.savefig(fig_dir / fname, bbox_inches="tight")
    plt.close(fig)
    return True


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

    # 图 4：数据集 × 指标评测格局（同一论文共同评测；轴=领域概念而非 RQ）
    if kg_json.exists():
        rnames, cnames, mat = load_paper_bridges(kg_json, "evaluated_on", "measured_by")
        draw_cooccur(fig_dir, "fig_ds_metric.png",
                     "Benchmark-metric landscape (co-evaluated within papers)",
                     rnames, cnames, mat)

    # 图 5：问题 × 方法格局（同一论文 addresses 的问题与 proposes 的方法）
    if kg_json.exists():
        rnames2, cnames2, mat2 = load_paper_bridges(kg_json, "addresses", "proposes")
        draw_cooccur(fig_dir, "fig_prob_method.png",
                     "Problem-method landscape (co-occurring within papers)",
                     rnames2, cnames2, mat2)

    # 图 6：方法演化树（Method-Method extends 森林，最大分量）
    if kg_json.exists():
        m_nodes, m_edges = load_method_tree(kg_json)
        draw_method_tree(fig_dir, m_nodes, m_edges)

    # 图 7：失效模式分布（Limitation 度数 top-N——失败原因对比）
    if kg_json.exists():
        lims = load_limitations(kg_json)
        lims = [(n, v) for n, v in lims if v > 0]
        if lims:
            fig, ax = plt.subplots(figsize=(5.6, 1.0 + 0.26 * len(lims)))
            ax.barh([n for n, _ in lims][::-1], [v for _, v in lims][::-1],
                    color="#2b2b2b", height=0.58)
            for i, (_, v) in enumerate(reversed(lims)):
                ax.text(v + 0.15, i, str(v), va="center", fontsize=7.5)
            ax.set_xlabel("Relations involving this limitation (KG degree)")
            style_axes(ax)
            ax.tick_params(axis="y", labelsize=7)
            ax.set_title("Most-cited failure modes / limitations", fontsize=9)
            fig.tight_layout()
            fig.savefig(fig_dir / "fig_limitations.png", bbox_inches="tight")
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
    inc.append(
        "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.88\\textwidth]{figures/fig_ds_metric.png}\n"
        "  \\caption{Benchmark--metric landscape: how frequently each benchmark is co-evaluated with each metric within the same paper. The matrix reveals which measurement conventions dominate which benchmarks, and where evaluation practice diverges.}\n"
        "  \\label{fig:ds-metric}\n\\end{figure}\n")
    inc.append(
        "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.88\\textwidth]{figures/fig_prob_method.png}\n"
        "  \\caption{Problem--method landscape: problems addressed and methods proposed within the same papers. Dense rows indicate crowded problem niches; sparse rows indicate under-served problems.}\n"
        "  \\label{fig:prob-method}\n\\end{figure}\n")
    inc.append(
        "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.95\\textwidth]{figures/fig_method_tree.png}\n"
        "  \\caption{Method evolution: the largest connected group of extends relations among methods in the knowledge graph, showing which methods build on which.}\n"
        "  \\label{fig:method-tree}\n\\end{figure}\n")
    inc.append(
        "\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.62\\textwidth]{figures/fig_limitations.png}\n"
        "  \\caption{Most-cited failure modes and limitations across the surveyed papers (KG degree = number of relations linking the limitation to methods, papers, or problems).}\n"
        "  \\label{fig:limitations}\n\\end{figure}\n")
    (fig_dir / "latex_includes.tex").write_text("\n".join(inc), encoding="utf-8")
    print(f"[real_figures] years={sum(years.values())} kg_nodes={sum(nodes.values())} kg_edges={sum(edges.values())} domain_figs=ds-metric+prob-method → latex_includes.tex 重写")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
