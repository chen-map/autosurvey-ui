# -*- coding: utf-8 -*-
"""run_workflow5.py 通用化补丁：退役旧主题硬编码模板（RAG 安全综述），改为 W4 产物驱动的通用装配。

替换三处：
1. write_main_tex 函数 → ctex article 版（中文叙事可编译），动态标题/关键词
2. main() 装配段（sections 列表 + write_rq1-4 等调用）→ 按 payloads 实际 RQ 集合动态生成
3. append 段 7_discussion.tex → 动态文件名
新增函数群：_nat_key/_first_sentence/_md_to_latex/write_rq_section/write_*_generic
"""
import re
import shutil
import sys
from pathlib import Path

SRC = Path('/home/G2024hq/autoSurvey_v2/workflow_5_survey_writing/run_workflow5.py')
shutil.copy2(SRC, SRC.with_suffix('.py.bak-20260929-w5generic'))
src = SRC.read_text(encoding='utf-8')

NEW_MAIN_AND_HELPERS = r'''def write_main_tex(paper_dir: Path, section_files: list[str], title: str = "Survey", keywords: str = "") -> None:
    inputs = "\n".join(f"\\input{{sections/{Path(name).stem}}}" for name in section_files if name != "0_abstract.tex")
    kw = keywords or "multi-agent systems, large language models, knowledge graph, survey"
    main = rf"""\documentclass[10pt]{{article}}
\usepackage[UTF8]{{ctex}}
\usepackage[a4paper,margin=2.4cm]{{geometry}}
\usepackage{{amsmath,amssymb,amsfonts}}
\usepackage{{booktabs,tabularx,array,multirow}}
\usepackage{{graphicx}}
\usepackage{{url}}
\usepackage{{cite}}
\usepackage{{xcolor}}
\usepackage[colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue]{{hyperref}}

\title{{{latex_escape(title)}}}
\author{{AutoSurvey Pipeline}}

\begin{{document}}
\maketitle

\begin{{abstract}}
\input{{sections/0_abstract}}
\end{{abstract}}

\noindent\textbf{{Keywords}}: {latex_escape(kw)}

{inputs}

\bibliographystyle{{unsrt}}
\bibliography{{references}}

\end{{document}}
"""
    (paper_dir / "main.tex").write_text(main, encoding="utf-8")


def _nat_key(rq_id: str) -> list:
    return [int(t) if t.isdigit() else t for t in re.split(r"(\\d+)", rq_id)]


def _first_sentence(text: str, limit: int = 170) -> str:
    t = (text or "").strip().replace("\n", " ")
    for sep in ("。", ". ", "；"):
        i = t.find(sep)
        if i != -1:
            return t[: i + 1]
    return t[:limit]


def _md_to_latex(text: str) -> str:
    """overall_answer（中文 markdown 叙事）→ LaTeX：[pid] 引用、列表、粗体标记剥离。"""
    t = text or ""
    stash: list[str] = []

    def _keep(m):
        stash.append(m.group(1))
        return f"@@CITE{len(stash) - 1}@@"

    t = re.sub(r"\\[([A-Za-z0-9_\\-]{2,80})\\]", _keep, t)
    t = latex_escape(t)
    for i, pid in enumerate(stash):
        t = t.replace(f"@@CITE{i}@@", f"\\cite{{{pid}}}")
    t = t.replace("**", "")
    lines = []
    for ln in t.split("\n"):
        s = ln.strip()
        if s.startswith("- "):
            lines.append("\\item " + s[2:])
        elif s.startswith("## "):
            lines.append("\\paragraph{" + s[3:].strip() + "}")
        elif s.startswith("# "):
            lines.append("\\paragraph{" + s[2:].strip() + "}")
        else:
            lines.append(ln)
    out: list[str] = []
    in_item = False
    for ln in lines:
        is_item = ln.startswith("\\item")
        if is_item and not in_item:
            out.append("\\begin{itemize}")
            in_item = True
        elif in_item and not is_item and (not ln.strip() or not ln.startswith(" ")):
            out.append("\\end{itemize}")
            in_item = False
        out.append(ln)
    if in_item:
        out.append("\\end{itemize}")
    return "\n".join(out)


def write_rq_section(path: Path, rid: str, payload: dict[str, Any]) -> None:
    """通用 RQ 章节：W4 overall_answer 叙事为正文 + Key Claims 条目 + 证据覆盖。"""
    ac = payload.get("answer_claims") or {}
    rq_text = ac.get("rq_text") or rid
    overall = ac.get("overall_answer") or (payload.get("rq_answer") or {}).get("overall_answer") or ""
    claims = ac.get("key_claims") or []
    items = []
    for c in claims[:14]:
        ev = [str(x) for x in (c.get("evidence_papers") or []) if x][:4]
        key = cite(ev) if ev else ""
        items.append(f"\\item {latex_escape(claim_text(c))}{(' ' + key) if key else ''}")
    comp = ac.get("answer_completeness") or ""
    note = ac.get("completeness_notes") or ""
    body = _md_to_latex(overall) if overall else "\\textit{(本 RQ 未产出长文叙事，结论见 Key Claims。)}"
    text = (
        f"\\section{{{latex_escape(rid)}：{latex_escape(rq_text)}}}\n\\label{{sec:{rid.lower()}}}\n\n"
        f"{body}\n\n"
        "\\subsection*{Key Claims}\n\\begin{itemize}\n" + "\n".join(items) + "\n\\end{itemize}\n\n"
    )
    if comp or note:
        text += f"\\noindent\\textbf{{证据覆盖（{latex_escape(comp)}）}}：{latex_escape(note)}\n"
    path.write_text(text, encoding="utf-8")


def write_abstract_generic(path: Path, payloads: dict[str, dict[str, Any]], title: str, n_papers: int) -> None:
    parts = []
    for rid in sorted(payloads.keys(), key=_nat_key):
        ac = payloads[rid].get("answer_claims") or {}
        parts.append(f"{latex_escape(rid)}：{latex_escape(_first_sentence(ac.get('overall_answer') or ''))}")
    listing = " ".join(parts)
    text = (
        f"本综述围绕「{latex_escape(title)}」，基于 {n_papers} 篇文献构建的知识图谱（KG）与逐研究问题（RQ）"
        f"的工作记忆，对 {len(payloads)} 个研究问题给出证据接地的综合回答。核心结论如下：{listing}\n\n"
        "各问题的完整论证、关键论断（Key Claims）与证据覆盖边界见正文相应章节；"
        "研究议程与证据缺口在讨论章统一给出。\n"
    )
    path.write_text(text, encoding="utf-8")


def write_intro_generic(path: Path, payloads: dict[str, dict[str, Any]], wm_index: dict[str, Any],
                        title: str, n_papers: int) -> None:
    rqs = wm_index.get("rqs", [])
    rq_items = "\n".join(
        f"\\item \\textbf{{{latex_escape(rq.get('rq_id', ''))}}}: {latex_escape(rq.get('rq_text', ''))}"
        for rq in rqs
    )
    text = (
        "\\section{Introduction}\n\\label{sec:intro}\n\n"
        f"大语言模型（LLM）驱动的智能体系统正从单模型调用走向多环节、多角色协作的复杂系统。"
        f"本综述以「{latex_escape(title)}」为主题，系统综合 {n_papers} 篇文献的结构化证据："
        "工作流上，我们先构建论文级知识图谱（六类概念节点与语义关系边），"
        "再据此设计并冻结研究问题（RQ）与证据集合，最后对每个 RQ 执行基于 KG 的智能体分析，"
        "形成可核查的论断（claims）体系。\n\n"
        "本综述回答以下研究问题：\n\n\\begin{itemize}\n" + rq_items + "\n\\end{itemize}\n\n"
        "各章节按 RQ 组织：每章正文为该 RQ 的综合分析（来自工作记忆的叙事结论），"
        "并附 Key Claims 与证据覆盖说明；所有引用均锚定到冻结证据集合中的论文。\n"
    )
    path.write_text(text, encoding="utf-8")


def write_methodology_generic(path: Path, outline: dict[str, Any], wm_index: dict[str, Any], title: str) -> None:
    sections = outline.get("sections", [])
    total_sub = sum(len(section.get("subsections", [])) for section in sections)
    total_papers = len({pid for section in sections for pid in section.get("supporting_paper_ids", [])})
    sec_items = "\n".join(
        f"\\item \\textbf{{§{section.get('section_index', '')}}}: {latex_escape(str(section.get('title', ''))[:120])}"
        for section in sections
    )
    text = (
        "\\section{Survey Scope and Evidence Protocol}\n\\label{sec:method}\n\n"
        f"综述范围与证据协议由设计阶段冻结：主题为「{latex_escape(title)}」，"
        f"共 {len(sections)} 个 RQ 章节、{total_sub} 个 Sub-RQ，冻结支撑论文 {total_papers} 篇（去重）。\n\n"
        "证据协议为五阶段流水线：（1）多源检索与语料获取（DOI 锚定）；（2）论文级知识图谱构建"
        "（六类概念节点：问题/方法/数据集基准/指标/局限/假设约束，及语义关系边）；"
        "（3）综述设计与 RQ 规划（gap 分析、RQ 设计、证据矩阵冻结与反思修订）；"
        "（4）逐 RQ 的 KG 智能体分析（工作记忆 + 可核查 claims）；（5）本文装配与写作。\n\n"
        "章节与 RQ 对应关系：\n\n\\begin{itemize}\n" + sec_items + "\n\\end{itemize}\n"
    )
    path.write_text(text, encoding="utf-8")


def write_discussion_generic(path: Path, payloads: dict[str, dict[str, Any]],
                             wm_index: dict[str, Any]) -> None:
    items = []
    gaps = []
    for rid in sorted(payloads.keys(), key=_nat_key):
        ac = payloads[rid].get("answer_claims") or {}
        items.append(f"\\item \\textbf{{{latex_escape(rid)}}}: {latex_escape(_first_sentence(ac.get('overall_answer') or ''))}")
        note = ac.get("completeness_notes") or ""
        if note:
            gaps.append(f"\\item {latex_escape(rid)}: {latex_escape(note)}")
    text = (
        "\\section{Cross-RQ Synthesis and Research Agenda}\n\\label{sec:discussion}\n\n"
        "将各 RQ 的结论并置，可以看到贯穿性的图景：\n\n\\begin{itemize}\n"
        + "\n".join(items) + "\n\\end{itemize}\n\n"
        "证据缺口与研究议程（按 RQ 汇总）：\n\n\\begin{itemize}\n"
        + ("\n".join(gaps) if gaps else "\\item 各 RQ 未登记显式缺口。") + "\n\\end{itemize}\n"
    )
    path.write_text(text, encoding="utf-8")


def write_conclusion_generic(path: Path, payloads: dict[str, dict[str, Any]], title: str) -> None:
    n_claims = sum(len((payloads[r].get("answer_claims") or {}).get("key_claims") or []) for r in payloads)
    text = (
        "\\section{Conclusion}\n\\label{sec:conclusion}\n\n"
        f"本综述以「{latex_escape(title)}」为主题，基于知识图谱与逐 RQ 工作记忆，"
        f"对 {len(payloads)} 个研究问题给出证据接地的回答，合计 {n_claims} 条可核查论断。"
        "全部结论均锚定冻结证据集合，读者可通过各章 Key Claims 与引用回溯到具体论文。"
        "证据覆盖的边界与后续议程见讨论章。\n"
    )
    path.write_text(text, encoding="utf-8")


'''

NEW_ASSEMBLY = '''    # 通用装配：RQ 章节按 payloads 实际集合生成（旧主题硬编码模板退役）
    survey_title = "Survey"
    ds_md = analyze / "survey_design_summary.md"
    if ds_md.exists():
        m0 = re.search(r"^#.*?[\\uFF1A:]\\s*(.+)$", ds_md.read_text(encoding="utf-8"), re.M)
        if m0:
            survey_title = m0.group(1).strip()
    rq_ids = sorted(payloads.keys(), key=_nat_key)
    section_files = ["0_abstract.tex", "1_introduction.tex", "2_scope_and_protocol.tex"]
    for i, rid in enumerate(rq_ids):
        fn = f"{3 + i}_{rid.lower()}.tex"
        write_rq_section(output_dir / "sections" / fn, rid, payloads[rid])
        section_files.append(fn)
    tail = 3 + len(rq_ids)
    disc_file = f"{tail}_discussion.tex"
    conc_file = f"{tail + 1}_conclusion.tex"
    write_abstract_generic(output_dir / "sections" / "0_abstract.tex", payloads, survey_title, len(structured))
    write_intro_generic(output_dir / "sections" / "1_introduction.tex", payloads, wm_index, survey_title, len(structured))
    write_methodology_generic(output_dir / "sections" / "2_scope_and_protocol.tex", outline, wm_index, survey_title)
    write_discussion_generic(output_dir / "sections" / disc_file, payloads, wm_index)
    write_conclusion_generic(output_dir / "sections" / conc_file, payloads, survey_title)
    section_files += [disc_file, conc_file]
'''

# ---- 1) write_main_tex 函数整体替换 + 插入新函数群（write_main_tex 起至 def rq_claims 前）----
pat_main = re.compile(r"def write_main_tex\(.*?\n(?=def rq_claims\()", re.S)
assert pat_main.search(src), 'write_main_tex anchor not found'
src = pat_main.sub(lambda m: NEW_MAIN_AND_HELPERS.rstrip('\n') + '\n\n\n', src, count=1)

# ---- 2) main() 装配段替换（sections 列表起至 write_conclusion 调用）----
pat_asm = re.compile(r'    sections = \[\n.*?write_conclusion\(output_dir / "sections" / sections\[8\]\)\n', re.S)
assert pat_asm.search(src), 'assembly anchor not found'
src = pat_asm.sub(lambda m: NEW_ASSEMBLY.rstrip('\n') + '\n', src, count=1)

# ---- 3) append 段的 7_discussion.tex 换动态名 ----
old_append = '"7_discussion.tex").open("a", encoding="utf-8") as handle:'
new_append = 'disc_file).open("a", encoding="utf-8") as handle:'
assert src.count(old_append) == 1, 'append anchor not found'
src = src.replace(old_append, new_append)

# ---- 4) write_main_tex 调用传新参 ----
old_call = 'write_main_tex(output_dir, sections)'
assert src.count(old_call) == 1, 'main_tex call anchor'
src = src.replace(old_call, 'write_main_tex(output_dir, section_files, survey_title)')

SRC.write_text(src, encoding='utf-8')
import ast
ast.parse(src)
print('patched + syntax OK, backup at', SRC.with_suffix('.py.bak-20260929-w5generic').name)
