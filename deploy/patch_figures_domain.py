# -*- coding: utf-8 -*-
"""real_figures.py 领域化：删 RQ 轴两图，加两张领域共现矩阵图（同一论文桥接）。"""
import ast
import io
import re

P = 'backend/w5/real_figures.py'
s = io.open(P, encoding='utf-8').read()

# ---- 1) helper：论文桥接的两类概念共现 ----
anchor = "def load_rq_papers(matrix_json: Path) -> dict[str, set]:"
helper = '''def load_paper_bridges(kg_json: Path, row_edge: str, col_edge: str, top: int = 12):
    """同一论文同时连接的两类概念节点的共现矩阵。

    KG 边形如 Paper -edge-> Concept；row_edge 取行概念（如 evaluated_on→数据集），
    col_edge 取列概念（如 measured_by→指标）。返回 (row_names, col_names, mat)。
    """
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    names: dict[str, str] = {}
    for n in kg.get("nodes", []):
        nid = str(n.get("node_id") or "")
        if nid:
            names[nid] = n.get("canonical_name") or nid
    by_paper: dict[str, list] = {"r": {}, "c": {}}
    deg_r: dict[str, int] = {}
    deg_c: dict[str, int] = {}
    for e in kg.get("edges", []):
        et = e.get("edge_type") or ""
        tgt = str(e.get("target_id") or "")
        src = str(e.get("source_id") or "")
        if not tgt or not src:
            continue
        if et == row_edge:
            by_paper["r"].setdefault(src, set()).add(tgt)
            deg_r[tgt] = deg_r.get(tgt, 0) + 1
        elif et == col_edge:
            by_paper["c"].setdefault(src, set()).add(tgt)
            deg_c[tgt] = deg_c.get(tgt, 0) + 1
    rows = [t for t, _ in sorted(deg_r.items(), key=lambda kv: -kv[1])[:top]]
    cols = [t for t, _ in sorted(deg_c.items(), key=lambda kv: -kv[1])[:top]]
    mat = [[0] * len(cols) for _ in rows]
    for pid in set(by_paper["r"]) & set(by_paper["c"]):
        for r in by_paper["r"][pid]:
            if r in rows:
                i = rows.index(r)
                for c in by_paper["c"][pid]:
                    if c in cols:
                        mat[i][cols.index(c)] += 1
    row_names = [names.get(t, t)[:22] for t in rows]
    col_names = [names.get(t, t)[:16] for t in cols]
    return row_names, col_names, mat


def draw_cooccur(fig_dir: Path, fname: str, title: str, row_names, col_names, mat) -> bool:
    if not any(any(r) for r in mat):
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


def load_rq_papers(matrix_json: Path) -> dict[str, set]:'''
assert s.count(anchor) == 1
s = s.replace(anchor, helper, 1)

# ---- 2) main 里图4/图5段整体替换为两张领域矩阵 ----
pat = re.compile(r'    # 图 4：RQ 间证据共享热力图.*?fig_rq_claims\.png", bbox_inches="tight"\)\n        plt\.close\(fig\)\n', re.S)
assert pat.search(s), 'fig45 anchor'
new_block = '''    # 图 4：数据集 × 指标评测格局（同一论文共同评测；轴=领域概念而非 RQ）
    if kg_json.exists():
        rnames, cnames, mat = load_paper_bridges(kg_json, "evaluated_on", "measured_by")
        draw_cooccur(fig_dir, "fig_ds_metric.png",
                     "Benchmark–metric landscape (co-evaluated within papers)",
                     rnames, cnames, mat)

    # 图 5：问题 × 方法格局（同一论文 addresses 的问题与 proposes 的方法）
    if kg_json.exists():
        rnames2, cnames2, mat2 = load_paper_bridges(kg_json, "addresses", "proposes")
        draw_cooccur(fig_dir, "fig_prob_method.png",
                     "Problem–method landscape (co-occurring within papers)",
                     rnames2, cnames2, mat2)
'''
s = pat.sub(lambda m: new_block, s, count=1)

# ---- 3) includes 替换 ----
old_inc = re.compile(r'    if rq_papers and len\(rq_ids\) >= 2:.*?"\\\\label\{fig:rq-claims\}\\\\n\\\\end\{figure\}\\\\n"\)\n', re.S)
assert old_inc.search(s), 'inc anchor'
new_inc = '''    inc.append(
        "\\\\begin{figure}[t]\\\\n  \\\\centering\\\\n  \\\\includegraphics[width=0.86\\\\textwidth]{figures/fig_ds_metric.png}\\\\n"
        "  \\\\caption{Benchmark–metric landscape: how frequently each benchmark is co-evaluated with each metric within the same paper. The matrix reveals which measurement conventions dominate which benchmarks, and where evaluation practice diverges.}\\\\n"
        "  \\\\label{fig:ds-metric}\\\\n\\\\end{figure}\\\\n")
    inc.append(
        "\\\\begin{figure}[t]\\\\n  \\\\centering\\\\n  \\\\includegraphics[width=0.86\\\\textwidth]{figures/fig_prob_method.png}\\\\n"
        "  \\\\caption{Problem–method landscape: problems addressed and methods proposed within the same papers. Dense rows indicate crowded problem niches; sparse rows indicate under-served problems.}\\\\n"
        "  \\\\label{fig:prob-method}\\\\n\\\\end{figure}\\\\n")
'''
s = old_inc.sub(lambda m: new_inc, s, count=1)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('figures domain OK')
