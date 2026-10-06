# -*- coding: utf-8 -*-
"""服务器 run_workflow5.py：
1. intro append 废 table_rq_summary（RQ 表面轴表，用户点名）
2. 新增 write_domain_tables：KG 直接投影两张领域表
   - 方法 × 被评数据集矩阵（top 方法 proposes + 论文桥接 evaluated_on）
   - 失效模式 × 应对机制对照（Limitation 度数 top × 相邻 Method/问题）
   挂到 method 章 append。
"""
import ast

SRC = '/home/G2024hq/autoSurvey_v2/workflow_5_survey_writing/run_workflow5.py'
s = open(SRC, encoding='utf-8').read()

# ---- 1) 新函数（插在 write_limitation_generic 定义前） ----
anchor = 'def write_limitation_generic(path: Path, n_papers: int) -> None:'
new_fn = '''def write_domain_tables(out_dir: Path, kg_json: Path) -> list[str]:
    """KG 直接投影的两张领域表（用户裁决：表格不做 RQ 表面统计）。

    表A 方法×数据集：top 方法（proposes 度）× 其论文桥接被评的数据集（evaluated_on）。
    表B 失效×应对：top Limitation 与同论文关联的 Method/问题（addresses/proposes 桥接）。
    返回生成的表文件名列表。
    """
    if not kg_json.exists():
        return []
    kg = json.loads(kg_json.read_text(encoding="utf-8"))
    names = {str(n.get("node_id") or ""): (n.get("canonical_name") or "") for n in kg.get("nodes", [])}
    paper_methods: dict[str, list] = {}
    paper_ds: dict[str, list] = {}
    method_deg: dict[str, int] = {}
    for e in kg.get("edges", []):
        et = e.get("edge_type") or ""
        src, tgt = str(e.get("source_id") or ""), str(e.get("target_id") or "")
        if et == "proposes":
            paper_methods.setdefault(src, []).append(tgt)
            method_deg[tgt] = method_deg.get(tgt, 0) + 1
        elif et == "evaluated_on":
            paper_ds.setdefault(src, []).append(tgt)
    top_methods = [t for t, _ in sorted(method_deg.items(), key=lambda kv: -kv[1])[:10]]
    if not top_methods:
        return []
    pairs: dict[tuple, int] = {}
    for pid in set(paper_methods) & set(paper_ds):
        for mth in paper_methods[pid]:
            if mth in top_methods:
                for ds in paper_ds[pid]:
                    pairs[(mth, ds)] = pairs.get((mth, ds), 0) + 1
    top_ds = sorted({d for (_, d) in pairs}, key=lambda d: -sum(v for (m, d2), v in pairs.items() if d2 == d))[:8]
    written = []
    tdir = out_dir / "tables"
    tdir.mkdir(parents=True, exist_ok=True)
    if top_ds:
        head = " & ".join(latex_escape(names.get(d, d)[:14]) for d in top_ds)
        rows = []
        for mth in top_methods:
            cells = []
            for d in top_ds:
                v = pairs.get((mth, d), 0)
                cells.append(str(v) if v else "--")
            rows.append(latex_escape(names.get(mth, mth)[:22]) + " & " + " & ".join(cells))
        texA = ("\\\\begin{table*}[t]\\n\\\\centering\\n\\\\caption{Methods and the benchmarks they are "
                "evaluated on (projected from the knowledge graph: a method is linked to a benchmark when "
                "the same paper proposes the method and evaluates on the benchmark).}\\n"
                "\\\\label{tab:method-ds}\\n\\\\small\\n\\\\begin{tabular}{l" + "c" * len(top_ds) + "}\\n"
                "\\\\toprule\\nMethod & " + head + " \\\\\\\\\\n\\\\midrule\\n"
                + " \\\\\\\\\\n".join(rows) + "\\n\\\\bottomrule\\n\\\\end{tabular}\\n\\\\end{table*}\\n")
        (tdir / "table_domain_method_ds.tex").write_text(texA, encoding="utf-8")
        written.append("tables/table_domain_method_ds")
    # 表B：失效 × 应对（Limitation 与同论文 Method）
    lim_deg: dict[str, int] = {}
    paper_lim: dict[str, list] = {}
    for e in kg.get("edges", []):
        et = e.get("edge_type") or ""
        src, tgt = str(e.get("source_id") or ""), str(e.get("target_id") or "")
        if et == "has_limitation":
            paper_lim.setdefault(src, []).append(tgt)
            lim_deg[tgt] = lim_deg.get(tgt, 0) + 1
    top_lims = [t for t, _ in sorted(lim_deg.items(), key=lambda kv: -kv[1])][:8]
    if top_lims:
        rows = []
        for lim in top_lims:
            remedies = []
            for pid, lims in paper_lim.items():
                if lim in lims:
                    for mth in paper_methods.get(pid, []):
                        if names.get(mth, mth) not in remedies:
                            remedies.append(names.get(mth, mth))
            rows.append(latex_escape(names.get(lim, lim)[:34]) + " & "
                        + latex_escape("; ".join(remedies[:3]) if remedies else "（未检索到显式应对机制）"))
        texB = ("\\\\begin{table}[t]\\n\\\\centering\\n\\\\caption{Failure modes and the methods co-occurring "
                "with them in the same papers (candidate remedies projected from the KG).}\\n"
                "\\\\label{tab:lim-remedy}\\n\\\\small\\n\\\\begin{tabular}{p{0.34\\\\linewidth}p{0.58\\\\linewidth}}\\n"
                "\\\\toprule\\nFailure mode & Co-occurring methods \\\\\\\\\\n\\\\midrule\\n"
                + " \\\\\\\\\\n".join(rows) + "\\n\\\\bottomrule\\n\\\\end{tabular}\\n\\\\end{table}\\n")
        (tdir / "table_failure_remedy.tex").write_text(texB, encoding="utf-8")
        written.append("tables/table_failure_remedy")
    return written


def write_limitation_generic(path: Path, n_papers: int) -> None:'''
assert s.count(anchor) == 1
s = s.replace(anchor, new_fn, 1)

# ---- 2) main 里调用 + intro append 换血 ----
old_append = '''    # Place tables/figures after the narrative files exist, so the source is easy to inspect.
    with (output_dir / "sections" / "1_introduction.tex").open("a", encoding="utf-8") as handle:
        handle.write("\\n\\\\input{tables/table_rq_summary}\\n\\\\input{figures/latex_includes}\\n")'''
new_append = '''    # Place tables/figures after the narrative files exist, so the source is easy to inspect.
    domain_tables = write_domain_tables(output_dir, Path("knowledge_graph/paper_kg.json"))
    with (output_dir / "sections" / "1_introduction.tex").open("a", encoding="utf-8") as handle:
        handle.write("\\n\\\\input{figures/latex_includes}\\n")  # table_rq_summary（RQ 表面轴）已废——用户裁决'''
assert s.count(old_append) == 1, 'append anchor'
s = s.replace(old_append, new_append)

# method 章 append 领域表
old_m = '''    with (output_dir / "sections" / "2_scope_and_protocol.tex").open("a", encoding="utf-8") as handle:
        handle.write("\\n\\\\input{tables/table_key_claims}\\n")'''
new_m = '''    with (output_dir / "sections" / "3_method.tex").open("a", encoding="utf-8") as handle:
        handle.write("\\n" + "".join(f"\\\\input{{{t}}}\\n" for t in domain_tables))
    with (output_dir / "sections" / "2_scope_and_protocol.tex").open("a", encoding="utf-8") as handle:
        handle.write("\\n\\\\input{tables/table_key_claims}\\n")'''
assert s.count(old_m) == 1, 'method append'
s = s.replace(old_m, new_m)

open(SRC, 'w', encoding='utf-8').write(s)
ast.parse(s)
print('run_workflow5 tables OK')
