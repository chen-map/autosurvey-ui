#!/usr/bin/env python3
"""W5-P3 LLM 正文撰写：用真实工作记忆逐章生成 LaTeX 叙事，替换装配器的硬编码示范文。

原则（用户裁决）：
  - W2（KG）与 W4（工作记忆）产物是大头，正文只是它们的渲染层；
  - LLM 只允许基于工作记忆中的 rq_answer / 维度 / 共识 / 证据片段写作，
    引用一律 \\cite{paper_id}（与 references.bib 键一致），不得编造。
每章一次 LLM 调用；写 manifest.json 供 runner 校验。
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys_path = str(HERE.parent / "w2")
if sys_path not in __import__("sys").path:
    __import__("sys").path.insert(0, sys_path)
from llm_wrap import load_llm_config  # noqa: E402

# RQ → 章节文件（run_workflow5 的固定装配顺序）
RQ_SECTION_FILES = ["3_attack_surfaces.tex", "4_attack_families.tex", "5_defenses.tex", "6_evidence_maturity.tex"]


def chat(base_url: str, api_key: str, model: str, system: str, user: str, max_tokens: int = 4000) -> str:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"]


CMD_RE = re.compile(r"\\(?:cite|ref|label|url|includegraphics|input)(?:\[[^\]]*\])?\{[^}]*\}")
UNI_MAP = {
    "≈": "$\\approx$", "≥": "$\\geq$", "≤": "$\\leq$", "×": "$\\times$",
    "→": "$\\to$", "↔": "$\\leftrightarrow$", "±": "$\\pm$",
    "∞": "$\\infty$", "≠": "$\\neq$", "—": "---", "–": "--",
}


def latex_sanitize(tex: str) -> str:
    """LLM 正文常见炸弹防御：内部术语机械替换（禁令遵守率<100% 的保底）；unicode 数学符号→数学模式；
    裸 & % # _ 转义（cite 等命令先 stash）；itemize 闭合兜底。"""
    stash: list[str] = []

    def _keep(m):
        stash.append(m.group(0))
        return f"@@CMD{len(stash) - 1}@@"

    t = CMD_RE.sub(_keep, tex)
    # 系统内部术语 → 学术表达（LLM 会复述材料里的流水线腔，机械替换保底）
    for bad, good in (("冻结证据集合", "预先确定的证据集合"), ("证据冻结", "证据预先固定"),
                      ("工作记忆", "结构化证据档案"), ("流水线", "研究流程"), ("冻结", "预先固定")):
        t = t.replace(bad, good)
    for ch, rep in UNI_MAP.items():
        t = t.replace(ch, rep)
    t = re.sub(r"(?<!\\)\^", r"\\^{}", t)   # 2^4 类裸上标（Missing $ 实测）
    t = re.sub(r"(?<!\\)~", r"\\textasciitilde{}", t)
    for ch in ("&", "%", "#", "_"):
        t = re.sub(r"(?<!\\)" + re.escape(ch), "\\" + ch, t)
    for i, cmd in enumerate(stash):
        t = t.replace(f"@@CMD{i}@@", cmd)
    # 裸方括号引用（stash 还原后处理，避免新造 cite 键被下划线转义破坏）：
    # LLM 偶发把 id 写成 [3823\_llmbased...] 文本而非 \cite——超长不可断致溢出边框。
    # 此时 _ 已转义为 \_，正则按转义形态匹配，还原成裸键后包 \cite。
    def _to_cite(m: "re.Match") -> str:
        return "\\cite{" + m.group(1).replace("\\_", "_") + "}"
    t = re.sub(r"\[(\d{4}(?:\\_|[A-Za-z0-9-]){8,})\]", _to_cite, t)
    t = re.sub(r"\[(\d{3,4})\]", r"\\cite{\1}", t)
    # 裸 id 嵌句（无方括号）："1665\_Flow-of-Action... 显示" → \cite（同病异形，亦致溢出）
    t = re.sub(r"(?<![\w{])(\d{4}(?:\\_|[A-Za-z0-9-]){15,})(?![\w}])", _to_cite, t)
    if t.count("\\begin{itemize}") > t.count("\\end{itemize}"):
        t = t.rstrip() + "\n" + "\\end{itemize}\n" * (t.count("\\begin{itemize}") - t.count("\\end{itemize}"))
    return t


def kg_subgraph_summary(staging, rid: str, top: int = 6) -> str:
    """该 RQ 冻结证据论文在 W2 知识图谱中诱导的子图摘要（六类节点 top-N + 边类型计数）。

    正文材料从「工作记忆」扩展为「工作记忆 + W2 KG 子图」（用户裁决：文字也要基于 W2）。
    """
    try:
        staging = Path(staging)
        matrix = staging / "workflow_3" / "analyze_report" / "rq_evidence_matrix.json"
        kg_path = staging / "knowledge_graph" / "paper_kg.json"
        if not (matrix.exists() and kg_path.exists()):
            return ""
        m = json.loads(matrix.read_text(encoding="utf-8"))
        paper_ids: set = set()
        for e in m.get("sub_rq_matrix", []):
            if (e.get("rq_id") or "") == rid:
                paper_ids.update(e.get("paper_ids_ranked") or [])
        if not paper_ids:
            return ""
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
        names: dict = {}
        for n in kg.get("nodes", []):
            nid = str(n.get("node_id") or "")
            if nid:
                names[nid] = n.get("canonical_name") or nid
        from collections import Counter
        node_hits: dict = {}
        edge_hits = Counter()
        touched: set = set()
        for e in kg.get("edges", []):
            src, tgt = str(e.get("source_id") or ""), str(e.get("target_id") or "")
            if src in paper_ids or tgt in paper_ids:
                edge_hits[e.get("edge_type") or "?"] += 1
                touched.add(src)
                touched.add(tgt)
        for n in kg.get("nodes", []):
            nid = str(n.get("node_id") or "")
            if nid in touched:
                node_hits.setdefault(n.get("node_type") or "?", Counter())[names[nid]] += 1
        parts = [f"RQ {rid} 证据子图（{len(paper_ids)} 篇冻结论文诱导）："]
        for t in ("Problem", "Method", "DatasetBenchmark", "Metric", "Limitation", "AssumptionConstraint"):
            c = node_hits.get(t)
            if c:
                tops = ", ".join(f"{k}({v})" for k, v in c.most_common(top))
                parts.append(f"- {t} top：{tops}")
        if edge_hits:
            parts.append("- 关系边：" + ", ".join(f"{k}({v})" for k, v in edge_hits.most_common(8)))
        return chr(10).join(parts)
    except Exception:
        return ""


def _load_sub_texts(staging) -> dict:
    """子问题 id → 文本（矩阵 sub_rq_matrix）。"""
    try:
        m = json.loads((Path(staging) / "workflow_3" / "analyze_report" / "rq_evidence_matrix.json")
                       .read_text(encoding="utf-8"))
        return {e.get("sub_rq_id"): (e.get("sub_rq_text") or e.get("rq_text") or "")
                for e in m.get("sub_rq_matrix", []) if e.get("sub_rq_id")}
    except Exception:
        return {}


def _short(t: str, n: int = 42) -> str:
    """子节标题截断（长问题文本压短）。"""
    t = (t or "").strip().replace("\n", " ")
    return t[:n] + ("…" if len(t) > n else "")


def rq_payload_summaries(wm_dir: Path) -> list[dict]:
    idx = json.loads((wm_dir / "WORKING_MEMORY_INDEX.json").read_text(encoding="utf-8"))
    out = []
    for entry in idx.get("rqs", []):
        # 索引里的路径相对 W1 根（含 working_memory/ 前缀），去掉前缀后相对 wm_dir
        rel = entry.get("rq_answer_path", "").replace("\\", "/")
        if rel.lower().startswith("working_memory/"):
            rel = rel[len("working_memory/"):]
        p = wm_dir / rel if rel else None
        if p is None or not p.exists():
            # v3 契约 INDEX 无 rq_answer_path 键——按 rq_id 定位 rq_N 目录
            num = re.search(r"\d+", str(entry.get("rq_id") or ""))
            if num:
                p = wm_dir / f"rq_{num.group()}"
        if p is None or not p.exists():
            continue
        if p.is_dir():  # 目录 → 下钻三件套
            p = p / "rq_answer.json"
        if not p.exists():
            continue
        a = json.loads(p.read_text(encoding="utf-8"))
        ac_file = p.parent / "answer_claims.json"
        ac = json.loads(ac_file.read_text(encoding="utf-8")) if ac_file.exists() else {}
        key_claims = [
            {"text": str(c.get("claim_text") or c.get("claim") or "")[:220],
             "evidence": [str(x) for x in (c.get("evidence_papers") or [])][:4]}
            for c in (ac.get("key_claims") or [])
        ][:14]
        out.append({
            "rq_id": entry.get("rq_id"),
            "rq_text": entry.get("rq_text", ""),
            "rq_type": a.get("rq_type", ""),
            "overall_answer": a.get("overall_answer", ""),
            "dimensions": [
                {"label": d.get("dimension_label", ""), "summary": d.get("dimension_summary", ""),
                 "papers": len(d.get("papers") or [])}
                for d in (a.get("evidence_by_dimension") or [])
            ],
            "consensus": (a.get("cross_paper_patterns") or {}).get("consensus") or [],
            "sub_answers": [
                {"id": s.get("sub_rq_id"), "answer": s.get("answer", ""), "confidence": s.get("confidence"),
                 "sub_claims": s.get("sub_claims") or []}
                for s in (a.get("sub_rq_answers") or [])
            ],
            "gaps": [g.get("gap_description", "") for g in (a.get("evidence_gaps") or [])],
            "key_claims": key_claims,
            "completeness": ac.get("answer_completeness", ""),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="W5-P3 LLM 正文撰写")
    ap.add_argument("--staging", default="retrieval_workspace/w5_workspace")
    ap.add_argument("--sections-dir", default="survey_paper/sections")
    ap.add_argument("--use-case", default="w5")
    ap.add_argument("--out-manifest", default="survey_paper/sections/llm_written.json")
    args = ap.parse_args()

    wm_dir = Path(args.staging) / "workflow_4" / "working_memory"
    sections_dir = Path(args.sections_dir)
    rq_data = rq_payload_summaries(wm_dir)
    if not rq_data:
        print("[llm_sections] 无工作记忆可写")
        return 1

    base, key, model = load_llm_config(args.use_case)
    if isinstance(model, list):
        model = model[0] if model else ""
    system = (
        "你是学术综述写作者。基于给定的真实工作记忆（RQ 答案、维度、共识、证据）撰写综述的一个章节，"
        "输出纯 LaTeX 正文（不含 \\section 标题行，那由装配器提供）。要求：\n"
        "1. 所有论断必须来自给定材料，关键论断用 \\cite{paper_id} 引用（paper_id 见材料中的论文 ID，原样使用）；\n"
        "2. 这是面向期刊读者的正文，不是材料复述：要组织成详尽的论文语言——承上启下的关联词与过渡句（然而/与之相对/进一步地/值得注意的是/综合来看）、学术探究的句式（这提示…/其内在机制可解释为…/一个自然的疑问是…），对材料中的结论做更深入的阐释与串联，而非罗列；\n"
        "2b. 对比分析是硬要求：利用 KG 子图摘要做显式对比——方法之间（谁在什么条件下优于谁）、数据集/基准之间（覆盖与盲区）、失败模式之间（成因与耦合）；每个主要论证段至少包含一组对比或一组跨文献的综合；\n"
        "3. 结构：开篇一段承接上一章并给出本章问题的回答总纲；主体 3-5 个论证段落，每段围绕一个维度展开（探索性论述与验证性证据交织：具体方法名、数据集、实验数字）；结尾一段给出本章结论并自然引向下一章的主题；\n"
        "4. 如实呈现材料中的分歧与缺口，不得编造论文、数据或结论；所有关键论断用 \\cite{paper_id} 引用；\n"
        "5. 学术中文撰写，专业术语、数据集/方法名保留英文原文，每章 4-8 段、每段 4-8 句，篇幅充实；\n"
        "6. 严禁出现系统内部术语：冻结、工作记忆、流水线、W1/W2/W3/W4/W5、KG 分析 Agent、装配器、研究问题编号堆砌——用学术语言表达（如「证据集合在分析启动前已预先确定」「结构化证据档案」）；\n"
        "7. 输出前自检（不满足则重写再交）：全文引用 ≥8 处且每个论证段至少 1 处；本章所有子问题逐一覆盖；同一断言的引用 ≤2 篇（选代表性来源，禁止三连堆砌）；首段承接上一章、尾段引出下一章。"
    )

    manifest = {"sections": [], "model": model}

    # ==== 发表级结构：子分析按主题重组为章（不做 RQ 罗列/串联） ====
    sub_texts_cfg = _load_sub_texts(args.staging)
    all_subs = []
    for p_ in rq_data:
        for s_ in (p_.get('sub_answers') or []):
            all_subs.append({"id": s_.get('id') or p_['rq_id'], "payload": p_, "s": s_})
    if not all_subs:  # 无子分析的项目：每 RQ 作为一个单元
        all_subs = [{"id": p_['rq_id'], "payload": p_,
                     "s": {"id": p_['rq_id'], "answer": p_.get('overall_answer', ''),
                           "sub_claims": p_.get('key_claims', [])}} for p_ in rq_data]

    # 1) 主题规划：LLM 把全部单元聚类为 3-4 个主题章（按内容亲缘，输出阅读逻辑顺序）
    n_theme_hint = max(3, min(6, round(len(all_subs) / 4)))
    plan_user = (f"把以下综述分析单元重组为 {n_theme_hint} 个左右的主题章。分组基线：大问题（RQ）本就是"
                 "现成主题（其子问题天然聚成一章）；仅当两个大问题内容亲缘明显（如安全与通信）才合并为一章，"
                 "仅当一个大问题内部跨度过大才拆成两章——不要求从零聚类。"
                 '输出 JSON 数组：[{"title": "主题章标题（观点性短语，不带编号与冒号）", '
                 '"logic": "本章组织逻辑一句话", "subs": ["单元id", ...]}]。'
                 "要求：每个单元恰好被分配一次；主题顺序符合阅读逻辑（如：现象与机理 → 设计与架构 → "
                 "评测与方法论 → 风险与边界）。单元清单（id: 子问题 | 结论速览）：\n"
                 + "\n".join(f"- {u['id']}: {sub_texts_cfg.get(u['id'], u['payload']['rq_text'])[:100]}"
                             f" | {(u['s'].get('answer') or '')[:110]}" for u in all_subs))
    plan_raw = chat(base, key, model,
                    "你是综述架构师。只输出 JSON 数组本体，不要任何其他文字与代码块标记。",
                    plan_user, max_tokens=1600)
    themes: list = []
    try:
        _mj = re.search(r"\[.*\]", plan_raw, re.S)
        if _mj:
            themes = json.loads(_mj.group(0))
    except (json.JSONDecodeError, AttributeError):
        themes = []
    if not isinstance(themes, list) or not themes:
        themes = [{"title": _short(p_['rq_text'], 30), "logic": "",
                   "subs": [s_.get('id') for s_ in (p_.get('sub_answers') or [])] or [p_['rq_id']]}
                  for p_ in rq_data]
    _assigned = {sid for th in themes for sid in (th.get("subs") or [])}
    for u in all_subs:  # 覆盖校验：遗漏单元追加末章
        if u["id"] not in _assigned:
            themes[-1].setdefault("subs", []).append(u["id"])
    print(f"[llm_sections] 主题规划：{len(themes)} 章 = " +
          " / ".join(f"{th.get('title', '')[:18]}({len(th.get('subs', []))})" for th in themes), flush=True)

    sub_by_id = {u["id"]: u for u in all_subs}
    theme_stems: list[str] = []
    for ti, th in enumerate(themes):
        stem = f"T{ti + 1}body"
        f = sections_dir / f"{stem}.tex"
        parts_tex: list[str] = []
        title_tex = re.sub(r"[&#%]", "", th.get("title") or f"主题 {ti + 1}")
        parts_tex.append(f"\\section{{{title_tex}}}\n\\label{{sec:theme{ti + 1}}}\n\n")
        prev_th = themes[ti - 1] if ti > 0 else None
        next_th = themes[ti + 1] if ti + 1 < len(themes) else None
        ctx2 = (f"上一章是「{prev_th.get('title', '')}」。\n" if prev_th else "这是正文第一个主题章（前文是方法章）。\n")
        if next_th:
            ctx2 += f"下一章是「{next_th.get('title', '')}」——本章最后一小节的结尾应自然引向它。\n"
        head_user = (f"综述主题章「{title_tex}」的章首导语。{ctx2}\n本章组织逻辑：{th.get('logic', '')}\n"
                     "本章各部分结论速览：\n"
                     + "\n".join(f"- {(sub_by_id[sid]['s'].get('answer') or '')[:200]}"
                                 for sid in (th.get("subs") or []) if sid in sub_by_id)
                     + "\n\n写 3-4 句导语：承接上文 + 点出本章核心张力 + 按内容逻辑预告展开。不写标题命令、不引用。")
        parts_tex.append(chat(base, key, model,
                              "你是综述章节作者。只输出一段中文导语（无任何标题命令），期刊风格，凝练克制。",
                              head_user, max_tokens=700))
        prev_tail = ""
        for j, sid in enumerate(th.get("subs") or []):
            u = sub_by_id.get(sid)
            if not u:
                continue
            s_ = u["s"]
            sub_claims = json.dumps(s_.get('sub_claims') or [], ensure_ascii=False)[:2600]
            sub_user = (f"撰写综述本章的一小节。\n"
                        f"本节要回答的子问题：{sub_texts_cfg.get(sid, u['payload']['rq_text'])}\n"
                        f"（所在章主题：{title_tex}）\n\n"
                        "== 本节论断与证据论文 id（引用只准用这些 id，务必充分使用）==\n" + sub_claims + "\n\n"
                        "== 本节的分析材料（改写为论文语言，深入机理与对比）==\n"
                        + (s_.get('answer') or '')[:4500])
            if prev_tail:
                sub_user += (f"\n\n== 上一小节的结尾（你的第一句必须与之自然衔接，"
                             f"禁止「下一节将讨论」式编号导航腔）==\n{prev_tail}")
            sub_user += ("\n\n输出格式：第一行是 \\subsection{内容性标题}——概括本节核心观点，"
                         "禁止使用 RQ/单元编号、禁止照抄子问题原文；随后 4-7 段正文（这是论文主体，"
                         "写足写深：机理剖析→证据对比→量化结果→边界与例外，段间有推进）。")
            sub_tex = latex_sanitize(chat(base, key, model, system, sub_user))
            nc = len(re.findall(r"\\cite\{", sub_tex))
            if nc < 4:
                sub_tex = latex_sanitize(chat(base, key, model, system,
                    sub_user + f"\n\n【上次引用仅 {nc} 处（要求 ≥4），必须使用材料中的论文 id。】"))
                nc = len(re.findall(r"\\cite\{", sub_tex))
            if not sub_tex.lstrip().startswith("\\subsection"):
                sub_tex = f"\\subsection{{{_short(sub_texts_cfg.get(sid, ''), 40)}}}\n" + sub_tex
            parts_tex.append(sub_tex)
            prev_tail = sub_tex[-360:]
            print(f"[llm_sections] {stem} {sid} 小节（{len(sub_tex)} 字符，{nc} 引用）", flush=True)
        f.write_text("\n\n".join(parts_tex).strip() + "\n", encoding="utf-8")
        manifest["sections"].append(f.name)
        theme_stems.append(stem)
        print(f"[llm_sections] 主题章 {f.name} 完成", flush=True)

    # ---- Background 章（领域基础：概念与术语，发表级结构标配） ----
    bg_file = sections_dir / "background.tex"
    if not bg_file.exists():
        bg_mat = ("为本综述撰写 Background 章（领域基础与 preliminaries）。核心概念素材（来自图谱与各章分析）：\n"
                  + "\n".join(f"- 主题「{th.get('title', '')}」涉及："
                              + "; ".join(sub_texts_cfg.get(sid, '')[:60]
                                          for sid in (th.get('subs') or [])[:6]) for th in themes)
                  + "\n\n任务：定义本综述反复出现的核心概念（如多智能体协作、编排拓扑、角色制度、评测基准、"
                    "协作约束等，以素材实际出现为准），给出术语界定与相互关系（3-5 个概念小节用 "
                    "\\subsection，标题为概念名），为后文主题章铺垫。学术中文，2-4 段/小节，可少量引用"
                    "（仅当材料中出现了具体论文时）。第一行输出 \\section{Background and Preliminaries}。")
        bg_tex = latex_sanitize(chat(base, key, model,
                              "你是综述作者。撰写 Background 章：概念定义准确、相互关系清晰，"
                              "面向不熟悉本领域的读者，严禁内部术语与空话。",
                              bg_mat, max_tokens=2800))
        bg_file.write_text(bg_tex.strip() + "\n", encoding="utf-8")
        manifest["sections"].append(bg_file.name)
        print(f"[llm_sections] background.tex 写入（{len(bg_tex)} 字符）", flush=True)

    # ---- Conclusion 章 ----
    concl_file = sections_dir / "conclusion.tex"
    concl_mat = ("撰写 Conclusion 章（3-4 段：总括各主题章的核心答案 → 本文带来的认识转变一句话 → "
                 "对研究者/工程师各一句实践启示）。素材：\n"
                 + "\n".join(f"- 「{th.get('title', '')}」："
                             + " ".join((sub_by_id[sid]['s'].get('answer') or '')[:120]
                                        for sid in (th.get('subs') or [])[:3] if sid in sub_by_id)
                             for th in themes))
    concl_tex = latex_sanitize(chat(base, key, model,
                               "你是综述作者。第一行输出 \\section{Conclusion}，随后正文 3-4 段，凝练收束，不引入新论断。",
                               concl_mat, max_tokens=1200))
    concl_file.write_text(concl_tex.strip() + "\n", encoding="utf-8")
    manifest["sections"].append(concl_file.name)
    print(f"[llm_sections] conclusion.tex 写入（{len(concl_tex)} 字符）", flush=True)

    # ---- main.tex 重写：发表级章节顺序（编号全部由 LaTeX 自动排） ----
    def _glob1(pat: str) -> str | None:
        fs = sorted(sections_dir.glob(pat))
        return fs[0].stem if fs else None

    order = []
    for pat in ("[0-9]*_introduction.tex", "background.tex",
                "[0-9]*_literature_review.tex", "[0-9]*_method.tex"):
        st = _glob1(pat)
        if st:
            order.append(st)
    order += theme_stems
    for pat in ("[0-9]*_contribution.tex", "[0-9]*_future_research.tex",
                "[0-9]*_limitation.tex", "conclusion.tex"):
        st = _glob1(pat)
        if st:
            order.append(st)
    main_path = sections_dir.parent / "main.tex"
    old_title = "Survey"
    if main_path.exists():
        _mt = re.search(r"\\title\{(.+?)\}", main_path.read_text(encoding="utf-8"), re.S)
        if _mt:
            old_title = _mt.group(1).strip()
    inputs_tex = "\n".join(f"\\input{{sections/{st}}}" for st in order)
    # 经典单栏版式（用户裁决：视觉用这版，比 ACM 模板美观；结构/内容不变）
    main_tex = (
        "\\documentclass[10pt]{article}\n"
        "\\usepackage[UTF8]{ctex}\n"
        "\\usepackage[a4paper,margin=2.4cm]{geometry}\n"
        "\\usepackage{amsmath,amssymb,amsfonts}\n"
        "\\usepackage{booktabs,tabularx,array,multirow}\n"
        "\\usepackage{graphicx}\n"
        "\\usepackage{url}\n"
        "\\usepackage{cite}\n"
        "\\usepackage{xcolor}\n"
        "\\usepackage[colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue]{hyperref}\n\n"
        f"\\title{{{old_title}}}\n"
        "\\author{AutoSurvey Pipeline}\n\n"
        "\\begin{document}\n\\maketitle\n\n"
        "\\begin{abstract}\n\\input{sections/0_abstract}\n\\end{abstract}\n\n"
        + inputs_tex + "\n\n"
        "\\bibliographystyle{unsrt}\n\\bibliography{references}\n\n\\end{document}\n")
    main_path.write_text(main_tex, encoding="utf-8")
    print(f"[llm_sections] main.tex 重写（经典版式）：{len(order)} 章 = {' → '.join(order)}", flush=True)

    # 摘要：汇总四个 RQ 的整体答案
    abstract_user = ("为综述撰写中文摘要（一段，250-350 字，语言与正文一致）。各研究问题及其核心结论如下：\n"
                     + "\n".join(f"- {p['rq_id']}: {p['overall_answer'][:500]}" for p in rq_data))
    abstract_tex = chat(base, key, model,
                        "你是综述摘要写作者。只输出摘要正文一段（中文），不含 \\begin{abstract} 等命令，不加标题，"
                        "句式凝练、有整体感，不出现「研究问题编号」堆砌与任何系统内部术语。",
                        abstract_user, max_tokens=1400)
    (sections_dir / "0_abstract.tex").write_text(abstract_tex.strip() + "\n", encoding="utf-8")
    manifest["sections"].append("0_abstract.tex")
    print("[llm_sections] abstract 写入", flush=True)

    # Contribution 章：跨 RQ 综合分析（LLM 撰写，非模板拼接）
    contrib_files = sorted(sections_dir.glob("[0-9]*_contribution.tex"),
                           key=lambda p: int(p.name.split('_')[0]))
    if contrib_files:
        cf = contrib_files[0]
        contrib_user = (
            "撰写综述的「综合分析与贡献」一章（Contribution），做跨研究问题的综合分析：\n"
            "1. 第一段总起：把各问题的结论并置，提炼贯穿全文的 1-2 条主线索（例如架构-任务适配、评测碎片化）；\n"
            "2. 中段 2-3 段：交叉综合——某问题的证据如何补充/制约另一问题的结论；指出跨问题的共识、矛盾与耦合；\n"
            "3. 结尾段：凝练本文可复用的知识贡献（新分类框架、新坐标系、新设计维度）。\n"
            "只输出 LaTeX 正文（不含 \\section 行）。各研究问题的结论材料：\n"
            + json.dumps([{ 'rq_id': p['rq_id'], 'rq_text': p['rq_text'],
                            'core': p['overall_answer'][:700],
                            'top_claims': [c['text'] for c in (p.get('key_claims') or [])[:4]]}
                          for p in rq_data], ensure_ascii=False, indent=1)[:12000])
        contrib_tex = latex_sanitize(chat(base, key, model,
                           "你是学术综述写作者，撰写跨问题的综合分析章。学术中文、术语保留英文，4-6 段，"
                           "论断须来自给定材料并用 \\cite{paper_id} 引用，严禁内部术语（冻结/工作记忆/流水线/W1-W5）。",
                           contrib_user, max_tokens=6500))
        cf.write_text(contrib_tex.strip() + "\n", encoding="utf-8")
        manifest["sections"].append(cf.name)
        print(f"[llm_sections] {cf.name} 跨RQ综合章写入（{len(contrib_tex)} 字符）", flush=True)

    # Literature Review 章：LLM 学术化重写（模板嵌 markdown 调研报告的排版/腔调问题治本）
    lit_files = sorted(sections_dir.glob("[0-9]*_literature_review.tex"),
                       key=lambda p: int(p.name.split('_')[0]))
    if lit_files:
        rr_path = Path(args.staging) / "workflow_3" / "analyze_report" / "related_review_report.md"
        gap_path = Path(args.staging) / "workflow_3" / "analyze_report" / "gap_summary.md"
        rr_text = rr_path.read_text(encoding="utf-8")[:4000] if rr_path.exists() else ""
        gap_text = gap_path.read_text(encoding="utf-8")[:1800] if gap_path.exists() else ""
        if rr_text:
            lit_user = (
                "撰写综述的 Literature Review 章（2-4 段正文 + 一个「关键论文」条目列表）：\n"
                "1. 第一段：概括本领域已有综述所覆盖的视角与结论格局（基于给定调研材料改写成学术叙述，"
                "不得照抄报告原文、不得出现任何 markdown 标记或报告腔标题）；\n"
                "2. 第二段：指出已有工作的覆盖盲区与本文的切入点；\n"
                "3. 「关键论文」部分用 \\\\begin{itemize} 列 4-8 篇给定枢纽论文（有则列，无则略）；\n"
                "4. 只输出 LaTeX 正文（不含 \\\\section 行），学术中文、术语保留英文。\n\n"
                f"== 已有综述调研材料 ==\\n{rr_text}\\n\\n== 领域空白分析 ==\\n{gap_text}\\n\\n"
                f"== 枢纽论文（多问题共享证据） ==\\n" + "\\n".join(
                    f"- {p['rq_id']} 相关：{c['text'][:120]}（证据：" + ",".join(c['evidence'][:2]) + "）"
                    for p in rq_data for c in (p.get('key_claims') or [])[:1]))
            lit_tex = latex_sanitize(chat(base, key, model,
                                "你是学术综述写作者。基于给定材料撰写 Literature Review 章，"
                                "把调研报告改写为面向期刊读者的学术叙述，严禁照抄原文结构与标题、"
                                "严禁内部术语（冻结/工作记忆/流水线/W1-W5）与 markdown 残留；"
                                "「关键论文」列表必须给出且每条带 \\cite{论文 id}，正文引用 ≥4 处。",
                                lit_user, max_tokens=3500))
            lit_files[0].write_text(lit_tex.strip() + "\n", encoding="utf-8")
            manifest["sections"].append(lit_files[0].name)
            print(f"[llm_sections] {lit_files[0].name} Literature Review 重写（{len(lit_tex)} 字符）", flush=True)

    # ---- 模板章 LLM 学术化（intro / method / future / limitation——骨架文案升级为成文） ----
    def _llm_rewrite(fname_pat: str, system2: str, user2: str, min_cites: int = 0) -> None:
        fs = sorted(sections_dir.glob(fname_pat), key=lambda p: int(p.name.split('_')[0]))
        if not fs:
            return
        tex3 = latex_sanitize(chat(base, key, model, system2, user2, max_tokens=3000))
        nc = len(re.findall(r"\\cite\{", tex3))
        if nc < min_cites:
            tex3 = latex_sanitize(chat(base, key, model, system2,
                                       user2 + f"\n\n【上次引用仅 {nc} 处（要求 ≥{min_cites}），须使用材料中的论文 id。】",
                                       max_tokens=3500))
        fs[0].write_text(tex3.strip() + "\n", encoding="utf-8")
        manifest["sections"].append(fs[0].name)
        print(f"[llm_sections] {fs[0].name} 重写（{len(tex3)} 字符，{nc} 处引用）", flush=True)

    rq_ids = [p['rq_id'] for p in rq_data]
    _ids = sorted({e for p_ in rq_data for c in (p_.get('key_claims') or [])[:3] for e in (c.get('evidence') or [])[:2]})
    intro_mat = ("综述主题：" + (rq_data[0].get('rq_text') or '')[:200] + " 等 " + str(len(rq_data)) + " 个问题方向。\n"
                 "可引用论文 id 清单（贡献点每条至少引 1 篇，只准用这些 id）：" + ", ".join(_ids[:20]) + "\n"
                 "各问题核心结论（用于撰写贡献点，引用其中的论文 id）：\n"
                 + "\n".join(f"- {p['rq_id']}: {p['overall_answer'][:400]}" for p in rq_data)
                 + "\n代表性论断：\n" + json.dumps(
                     [{"rq": p['rq_id'], "claims": [c['text'] for c in (p.get('key_claims') or [])[:3]],
                       "ev": [e for c in (p.get('key_claims') or [])[:3] for e in (c.get('evidence') or [])[:2]]}
                     for p in rq_data], ensure_ascii=False)[:3000])
    _llm_rewrite("[0-9]*_introduction.tex",
                 "你是综述 Introduction 写作者。按「出发点（领域背景与核心张力）→ 创新点（与已有综述的差异，"
                 "基于结构化证据与逐问题综合）→ 贡献点（itemize 列出，每条带引用）」三小节成文，学术中文，"
                 "\\section 行不要，4-6 段，引用 ≥6 处，严禁内部术语与空话套话。",
                 intro_mat, min_cites=6)

    n_corpus = 0
    idx_csv = Path(args.staging) / "paper_cards" / "index" / "PAPER_INDEX.csv"
    if idx_csv.exists():
        with open(idx_csv, encoding='utf-8') as fh:
            n_corpus = max(0, sum(1 for _ in fh) - 1)
    n_subs = sum(len(p.get('sub_answers') or []) for p in rq_data)
    method_mat = (f"语料 {n_corpus} 篇（多源检索：arXiv 优先、开放学术索引兜底，DOI/标识锚定去重）；"
                  f"{len(rq_data)} 个研究问题共 {n_subs} 个子问题，证据集合在分析前预先固定；"
                  "概念提取为六类实体（问题/方法/数据集基准/指标/局限/假设约束）与语义关系边；"
                  "逐子问题做基于图谱的分析（分类/对比/演化/权衡），结论拆解为可核查论断并标注支撑论文。")
    _llm_rewrite("[0-9]*_method.tex",
                 "你是综述 Method 写作者。按「Data Mapping（来源与范围）→ Data Refinement（筛选标准与证据固定协议）"
                 "→ Data Evaluation（图谱构建、逐问题分析、论断核查三层）」三小节成文，学术中文，\\section 行不要，"
                 "3-5 段，写实不写虚（用材料中的真实数字），严禁内部术语。",
                 method_mat, min_cites=0)

    _fids = sorted({e for p_ in rq_data for c in (p_.get('key_claims') or [])[-2:] for e in (c.get('evidence') or [])[:2]})
    future_mat = ("各问题的证据缺口与覆盖不足（用于研究议程）：\n"
                  "可引用论文 id 清单（每段至少 1 处，只准用这些 id）：" + ", ".join(_fids[:16]) + "\n"
                  + "\n".join(f"- {p['rq_id']}（{p.get('completeness') or ''}）: "
                              + "; ".join(c['text'][:120] for c in (p.get('key_claims') or [])[-2:])
                              for p in rq_data)[:3000])
    _llm_rewrite("[0-9]*_future_research.tex",
                 "你是综述 Future Research 写作者。按 balanced（平衡视角：缺口即机会）/ critical（批判视角："
                 "哪些方向证据强度不足以支撑强结论）/ synthesised（综合视角：贯穿多问题的杠杆点）三段成文，"
                 "学术中文，\\section 行不要，3-4 段，每段至少 1 处引用，严禁内部术语。",
                 future_mat, min_cites=3)

    _llm_rewrite("[0-9]*_limitation.tex",
                 "你是综述 Limitation 写作者。就（1）语料与检索边界（自动检索池+人工补充的覆盖偏差、时间截止）；"
                 "（2）方法边界（模型辅助提取与撰写的可核查性努力：逐条论断标注支撑文献、分析过程留痕，"
                 "但个别抽取误差仍可能存在）；（3）范围边界（聚焦既定主题，相邻领域仅交叉处纳入）三方面诚实成文，"
                 "学术中文，\\section 行不要，3 段，不引用、不辩解。",
                 "（无额外材料，按规范直接撰写）", min_cites=0)

    # 引用键扩展：LLM 常写短键（如 2049），bib 键为完整 paper_id——前缀唯一匹配展开
    bib_path = sections_dir.parent / "references.bib"
    if bib_path.exists():
        bib_keys = re.findall(r"@misc\{([^,]+),", bib_path.read_text(encoding="utf-8"))

        def expand(mo: re.Match) -> str:
            keys = [k.strip() for k in mo.group(1).split(",")]
            out_keys = []
            for k in keys:
                if k in bib_keys:
                    out_keys.append(k)
                    continue
                cands = [bk for bk in bib_keys if bk.startswith(k)]
                out_keys.append(cands[0] if len(cands) == 1 else k)
            return "\\cite{" + ",".join(out_keys) + "}"

        for sec in manifest["sections"]:
            f = sections_dir / sec
            f.write_text(re.sub(r"\\cite\{([^}]*)\}", expand, f.read_text(encoding="utf-8")), encoding="utf-8")

    Path(args.out_manifest).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_manifest).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[llm_sections] 完成 {len(manifest['sections'])} 节")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
