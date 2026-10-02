# -*- coding: utf-8 -*-
"""C. real_figures 领域深挖两图：
图6 方法演化树（Method-Method extends 边的层级森林，最大分量 top 节点）
图7 失效模式分布（Limitation 节点按度数 top-N——"失败原因对比"）
"""
import ast
import io
import re

P = 'backend/w5/real_figures.py'
s = io.open(P, encoding='utf-8').read()

# 1) helper：方法演化森林数据 + 树布局绘制 + limitation 分布
anchor = "def load_paper_bridges("
helper = '''def load_method_tree(kg_json: Path, max_nodes: int = 18):
    """Method-Method extends 边的森林：返回 (nodes, edges) 最大分量（nodes=[name], edges=[(p,c)])。"""
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    names: dict[str, str] = {}
    types: dict[str, str] = {}
    for n in kg.get("nodes", []):
        nid = str(n.get("node_id") or "")
        if nid:
            names[nid] = n.get("canonical_name") or nid
            types[nid] = n.get("node_type") or ""
    ext: list[tuple[str, str]] = []
    deg: dict[str, int] = {}
    for e in kg.get("edges", []):
        if e.get("edge_type") != "extends":
            continue
        src, tgt = str(e.get("source_id") or ""), str(e.get("target_id") or "")
        if src in types and tgt in types and types.get(src) == "Method" and types.get(tgt) == "Method":
            ext.append((tgt, src))  # target extends source → source 是父
            deg[src] = deg.get(src, 0) + 1
            deg[tgt] = deg.get(tgt, 0) + 1
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


def load_paper_bridges('''
assert s.count(anchor) == 1
s = s.replace(anchor, helper, 1)

# 2) main 里生成两图（插在图5之后）
anchor2 = "    # 重写 latex_includes.tex：真实数据图替换流水线自评图"
block = '''    # 图 6：方法演化树（Method-Method extends 森林，最大分量）
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

    # 重写 latex_includes.tex：真实数据图替换流水线自评图'''
assert s.count(anchor2) == 1
s = s.replace(anchor2, block, 1)

# 3) includes 追加两图
anchor3 = '    (fig_dir / "latex_includes.tex").write_text("\\n".join(inc), encoding="utf-8")'
block3 = '''    inc.append(
        "\\\\begin{figure}[t]\\\\n  \\\\centering\\\\n  \\\\includegraphics[width=0.95\\\\textwidth]{figures/fig_method_tree.png}\\\\n"
        "  \\\\caption{Method evolution: the largest connected group of \\\\emph{extends} relations among methods in the knowledge graph, showing which methods build on which.}\\\\n"
        "  \\\\label{fig:method-tree}\\\\n\\\\end{figure}\\\\n")
    inc.append(
        "\\\\begin{figure}[t]\\\\n  \\\\centering\\\\n  \\\\includegraphics[width=0.62\\\\textwidth]{figures/fig_limitations.png}\\\\n"
        "  \\\\caption{Most-cited failure modes and limitations across the surveyed papers (KG degree = number of relations linking the limitation to methods, papers, or problems).}\\\\n"
        "  \\\\label{fig:limitations}\\\\n\\\\end{figure}\\\\n")
    (fig_dir / "latex_includes.tex").write_text("\\n".join(inc), encoding="utf-8")'''
assert s.count(anchor3) == 1
s = s.replace(anchor3, block3, 1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('C. figures deep OK')
