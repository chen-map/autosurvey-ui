# -*- coding: utf-8 -*-
"""run_workflow5.py 综述结构改造（对齐标准综述写作方法论）：
Introduction(出发点/创新点/贡献点) / Literature Review / Method(mapping-refinement-evaluation)
/ Findings(RQ 章) / Contribution / Future Research / Limitation。
同时清除流水线内部术语（冻结/工作记忆/流水线/W1-W5）——改用学术表达。
"""
import ast
import re
import shutil

SRC_ = '/home/G2024hq/autoSurvey_v2/workflow_5_survey_writing/run_workflow5.py'
shutil.copy2(SRC_, SRC_ + '.bak-structure')
src = open(SRC_, encoding='utf-8').read()

NEW_FUNCS = '''

def write_intro_generic(path: Path, payloads: dict[str, dict[str, Any]], wm_index: dict[str, Any],
                        title: str, n_papers: int) -> None:
    rqs = wm_index.get("rqs", [])
    contribs = "\\n".join(
        f"\\\\item \\\\textbf{{{latex_escape(rq.get('rq_id', ''))}}}：{latex_escape(_first_sentence((payloads.get(rq.get('rq_id', ''), {}).get('answer_claims') or {}).get('overall_answer') or ''))}"
        for rq in rqs if rq.get("rq_id") in payloads)
    text = (
        "\\\\section{Introduction}\\n\\\\label{sec:intro}\\n\\n"
        f"\\\\subsection{{出发点}}\\n\\n"
        f"大语言模型（LLM）驱动的多智能体协作正从单模型调用演变为多角色、多环节的复杂系统，"
        f"其协作机制、评测方法与安全边界亟需系统性的证据梳理。本综述以「{latex_escape(title)}」为主题，"
        f"对 {n_papers} 篇文献进行了结构化提取与逐问题的证据综合。\\n\\n"
        "\\\\subsection{{创新点}}\\n\\n"
        "与既有综述相比，本文的特点在于：（1）以论文级知识图谱为证据底座，六类概念实体"
        "（问题、方法、数据集基准、指标、局限、假设约束）与语义关系边均从原文逐篇提取；"
        "（2）每个研究问题的证据集合在分析启动前已预先确定，结论与证据一一对应、可回溯；"
        "（3）以可核查论断（claims）为最小综合单元，量化呈现证据支撑强度。\\n\\n"
        "\\\\subsection{{贡献点}}\\n\\n"
        "本文的主要贡献如下：\\n\\n\\\\begin{itemize}\\n" + contribs + "\\n\\\\end{itemize}\\n"
    )
    path.write_text(text, encoding="utf-8")


def write_litreview_generic(path: Path, payloads: dict[str, dict[str, Any]], analyze: Path,
                            matrix_json: Path, n_papers: int) -> None:
    parts = ["\\\\section{Literature Review}\\n\\\\label{sec:litrev}\\n\\n"]
    rr = analyze / "related_review_report.md"
    if rr.exists():
        body = _md_to_latex(rr.read_text(encoding="utf-8")[:2600])
        parts.append("\\\\subsection{已有综述格局}\\n\\n" + body + "\\n\\n")
    # 枢纽论文：跨 RQ 共享证据（支撑 >=2 个 RQ 的论文即论证结构的耦合点）
    hub_lines: list[str] = []
    try:
        m = json.loads(matrix_json.read_text(encoding="utf-8"))
        counts: dict[str, int] = {}
        for e in m.get("sub_rq_matrix", []):
            for pid in set(e.get("paper_ids_ranked") or []):
                counts[pid] = counts.get(pid, 0) + 1
        hubs = sorted(counts.items(), key=lambda kv: -kv[1])[:8]
        titles = {r["paper_id"]: r["title"] for r in _load_paper_titles(m)}
        for pid, c in hubs:
            if c >= 2:
                hub_lines.append(f"\\\\item {latex_escape(titles.get(pid, pid))}（支撑 {c} 个子问题）\\\\cite{{{pid}}}")
    except Exception:
        pass
    if hub_lines:
        parts.append("\\\\subsection{关键论文}\\n\\n以下文献在多个研究问题中被同时引为证据，构成本领域论证的枢纽：\\n\\n"
                     "\\\\begin{itemize}\\n" + "\\n".join(hub_lines) + "\\n\\\\end{itemize}\\n\\n")
    parts.append("\\\\subsection{切入点}\\n\\n"
                 f"综上，已有工作对本文所述 {n_papers} 篇语料的覆盖呈碎片化：单一视角的综述难以回答跨层面的权衡问题。"
                 "本文以逐问题的证据综合切入，补足这一空白。\\n")
    path.write_text("".join(parts), encoding="utf-8")


def _load_paper_titles(m: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for e in m.get("sub_rq_matrix", []):
        ids = e.get("paper_ids_ranked") or []
        ts = e.get("paper_titles") or []
        for i, pid in enumerate(ids):
            out.append({"paper_id": pid, "title": ts[i] if i < len(ts) else pid})
    return out


def write_method_generic(path: Path, outline: dict[str, Any], wm_index: dict[str, Any], title: str,
                         analyze: Path, n_papers: int) -> None:
    sections = outline.get("sections", [])
    total_sub = sum(len(section.get("subsections", [])) for section in sections)
    sec_items = "\\n".join(
        f"\\\\item \\\\textbf{{§{section.get('section_index', '')}}}: {latex_escape(str(section.get('title', ''))[:110])}"
        for section in sections)
    text = (
        "\\\\section{Method}\\n\\\\label{sec:method}\\n\\n"
        "本章说明证据的获取、筛选与评估过程，使读者能够判断结论的可靠边界。\\n\\n"
        "\\\\subsection{Data Mapping}\\n\\n"
        f"语料来源为多源学术检索（arXiv 优先、开放学术索引兜底），以主题词与引文扩展双通道获取，"
        f"按 DOI/论文标识锚定去重后共 {n_papers} 篇进入结构化处理。研究问题共 {len(sections)} 组、{total_sub} 个子问题，"
        "与章节的对应关系如下：\\n\\n\\\\begin{itemize}\\n" + sec_items + "\\n\\\\end{itemize}\\n\\n"
        "\\\\subsection{Data Refinement}\\n\\n"
        "筛选采用预先设定的纳入标准与相关性排序；每个子问题的证据集合在分析启动前一经确定即不再变更"
        "（pre-specified evidence set），以避免选择偏差。无法自动获取全文的文献由人工补充，"
        "并标注其在证据集合中的状态。\\n\\n"
        "\\\\subsection{Data Evaluation}\\n\\n"
        "评估分三层：（1）逐篇提取六类概念实体及其语义关系，构成论文级知识图谱；"
        "（2）对每个研究问题执行基于图谱的系统分析（分类、对比、演化路径与权衡谱），"
        "分析过程与工具调用留痕可查；（3）综合结论拆解为可核查论断（key claims），"
        "每条论断标注支撑论文，证据支撑强度在图~\\\\ref{fig:rq-claims} 中量化呈现。\\n"
    )
    path.write_text(text, encoding="utf-8")


def write_contribution_generic(path: Path, payloads: dict[str, dict[str, Any]], title: str) -> None:
    items = []
    for rid in sorted(payloads.keys(), key=_nat_key):
        ac = payloads[rid].get("answer_claims") or {}
        best = ""
        for c in ac.get("key_claims") or []:
            t = c.get("claim_type") or ""
            txt = claim_text(c)
            if t in ("finding", "framework", "method", "taxonomy") and len(txt) > len(best):
                best = txt
        if not best:
            best = _first_sentence(ac.get("overall_answer") or "")
        ev = next((str(x) for c in (ac.get("key_claims") or [])
                   for x in (c.get("evidence_papers") or []) if x), "")
        items.append(f"\\\\item \\\\textbf{{{latex_escape(rid)}}}：{latex_escape(best[:220])}"
                     + (f"\\\\cite{{{ev}}}" if ev else ""))
    text = (
        "\\\\section{Contribution}\\n\\\\label{sec:contrib}\\n\\n"
        f"基于「{latex_escape(title)}」的证据综合，本文形成以下可复用的知识贡献：\\n\\n"
        "\\\\begin{itemize}\\n" + "\\n".join(items) + "\\n\\\\end{itemize}\\n\\n"
        "上述框架与分类均由证据集合支撑，读者可循各章论断回溯至具体文献。\\n"
    )
    path.write_text(text, encoding="utf-8")


def write_future_generic(path: Path, payloads: dict[str, dict[str, Any]], analyze: Path) -> None:
    items = []
    for rid in sorted(payloads.keys(), key=_nat_key):
        ac = payloads[rid].get("answer_claims") or {}
        note = ac.get("completeness_notes") or ""
        if note:
            items.append(f"\\\\item \\\\textbf{{{latex_escape(rid)}}}（批判视角）：{latex_escape(note)}")
    rl = analyze / "rq_reflection_log.md"
    if rl.exists() and len(items) < 3:
        for mm in re.finditer(r"^## (RQ\\d+\\.\\d+): (.+?)$\\n+- Current support: (\\d+) papers",
                              rl.read_text(encoding="utf-8"), re.M):
            items.append(f"\\\\item \\\\textbf{{{mm.group(1)}}}（证据不足）：当前仅 {mm.group(3)} 篇支撑，需扩大检索或改写问题范围")
    text = (
        "\\\\section{Future Research}\\n\\\\label{sec:future}\\n\\n"
        "综合各研究问题的证据缺口，后续工作可循三个视角推进：\\n\\n"
        "\\\\begin{itemize}\\n" + ("\\n".join(items) if items else "\\\\item 各问题未登记显式缺口。") + "\\n\\\\end{itemize}\\n\\n"
        "平衡地看（balanced view），上述缺口既是挑战也是机会；批判地看（critical view），"
        "部分方向的证据强度尚不足以支撑强结论；综合地看（synthesised view），"
        "统一评测框架与跨任务可比性是贯穿多个问题的关键杠杆。\\n"
    )
    path.write_text(text, encoding="utf-8")


def write_limitation_generic(path: Path, n_papers: int) -> None:
    text = (
        "\\\\section{Limitation}\\n\\\\label{sec:limit}\\n\\n"
        "本综述的边界与局限如下：\\n\\n"
        "\\\\begin{itemize}\\n"
        "\\\\item \\\\textbf{语料边界}：纳入文献以自动检索池为主体（含人工补充），"
        "部分付费获取受限的文献可能造成覆盖偏差；语料时间截止于检索执行日。\\n"
        "\\\\item \\\\textbf{方法边界}：概念实体与语义关系由大语言模型辅助提取并经配对判定，"
        "虽逐条留痕可查，仍可能存在个别抽取误差；综合分析章节由模型基于结构化证据撰写，"
        "关键论断均标注支撑文献以供核验。\\n"
        f"\\\\item \\\\textbf{范围边界}：本文聚焦既定主题的 {n_papers} 篇语料，"
        "相邻领域（如单智能体工具调用、传统多智能体系统）仅在与主题交叉处纳入。\\n"
        "\\\\end{itemize}\\n"
    )
    path.write_text(text, encoding="utf-8")


def write_abstract_generic(path: Path, payloads: dict[str, dict[str, Any]], title: str, n_papers: int) -> None:
    parts = []
    for rid in sorted(payloads.keys(), key=_nat_key):
        ac = payloads[rid].get("answer_claims") or {}
        parts.append(f"{latex_escape(rid)}：{latex_escape(_first_sentence(ac.get('overall_answer') or ''))}")
    listing = " ".join(parts)
    text = (
        f"本综述围绕「{latex_escape(title)}」，对 {n_papers} 篇文献进行结构化证据提取与逐问题综合，"
        f"回答 {len(payloads)} 个研究问题。核心结论：{listing}\\n\\n"
        "各问题的完整论证与可核查论断见正文相应章节；证据缺口与后续方向见 Future Research。\\n"
    )
    path.write_text(text, encoding="utf-8")
'''

# ---- 1) 用新函数群整体替换旧的 generic 函数块（从 write_abstract_generic 定义到 write_conclusion_generic 结束）----
pat = re.compile(r'\ndef write_abstract_generic\(.*?\n(?=\n\ndef |\n\n# |if principle or hooks)', re.S)
assert pat.search(src), 'generic block anchor'
src = pat.sub(lambda m: NEW_FUNCS, src, count=1)

# ---- 2) main() 装配段替换为七部结构 ----
NEW_ASSEMBLY = '''    # 七部综述结构（标准综述写作方法论）：Intro/LitReview/Method/Findings(RQ)/Contribution/Future/Limitation
    survey_title = "Survey"
    ds_md = analyze / "survey_design_summary.md"
    if ds_md.exists():
        m0 = re.search(r"^#.*?[:\\uff1a]\\s*(.+)$", ds_md.read_text(encoding="utf-8"), re.M)
        if m0:
            survey_title = m0.group(1).strip()
    matrix_json = analyze / "rq_evidence_matrix.json"
    rq_ids = sorted(payloads.keys(), key=_nat_key)
    n_corpus = len(structured)
    section_files = ["0_abstract.tex", "1_introduction.tex", "2_literature_review.tex", "3_method.tex"]
    write_abstract_generic(output_dir / "sections" / "0_abstract.tex", payloads, survey_title, n_corpus)
    write_intro_generic(output_dir / "sections" / "1_introduction.tex", payloads, wm_index, survey_title, n_corpus)
    write_litreview_generic(output_dir / "sections" / "2_literature_review.tex", payloads, analyze, matrix_json, n_corpus)
    write_method_generic(output_dir / "sections" / "3_method.tex", outline, wm_index, survey_title, analyze, n_corpus)
    for i, rid in enumerate(rq_ids):
        fn = f"{4 + i}_{rid.lower()}.tex"
        write_rq_section(output_dir / "sections" / fn, rid, payloads[rid])
        section_files.append(fn)
    tail = 4 + len(rq_ids)
    contrib_file = f"{tail}_contribution.tex"
    future_file = f"{tail + 1}_future_research.tex"
    limit_file = f"{tail + 2}_limitation.tex"
    write_contribution_generic(output_dir / "sections" / contrib_file, payloads, survey_title)
    write_future_generic(output_dir / "sections" / future_file, payloads, analyze)
    write_limitation_generic(output_dir / "sections" / limit_file, n_corpus)
    section_files += [contrib_file, future_file, limit_file]
'''
pat_asm = re.compile(r'    # 通用装配：RQ 章节按 payloads 实际集合生成（旧主题硬编码模板退役）\n.*?section_files \+= \[disc_file, conc_file\]\n', re.S)
assert pat_asm.search(src), 'assembly anchor'
src = pat_asm.sub(lambda m: NEW_ASSEMBLY, src, count=1)

# ---- 3) 残留引用清理：append 段（disc_file 引用换 contribution 段）----
src = src.replace('disc_file).open("a", encoding="utf-8") as handle:',
                  'future_file).open("a", encoding="utf-8") as handle:')

ast.parse(src)
open(SRC_, 'w', encoding='utf-8').write(src)
print('structure patch OK + syntax valid')
