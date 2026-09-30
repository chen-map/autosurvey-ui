# -*- coding: utf-8 -*-
"""llm_sections.py 论文化改造：
1. RQ 章：模板式渲染 → 详尽论文语言（润色/关联词/学术探究/深挖，给邻域 RQ 供综合）
2. abstract：英文段 → 中文摘要
3. 新增 contribution 章 LLM 撰写（跨 RQ 综合分析）
"""
import ast
import io

P = 'backend/w5/llm_sections.py'
s = io.open(P, encoding='utf-8').read()

# ---- 1) system 提示词：论文语言版 ----
old_sys = '''        "2. 结构：先总起一段直接回答本问题；再按维度/子问题分段展开，每段混合「探索性论述」（定义、分类、对比、演化关系）与「验证性证据」（具体方法名、数据集、实验数字）；结尾一段指出该问题下的证据分歧与缺口；\\n"
        "3. 如实呈现材料中的分歧与缺口，不得编造论文、数据或结论；\\n"
        "4. 学术中文撰写（与全文语言一致），专业术语、数据集/方法名保留英文原文，每章 3-6 段；\\n"
        "5. 严禁出现系统内部术语：冻结、工作记忆、流水线、W1/W2/W3/W4/W5、KG 分析 Agent、装配器——如需表达相应概念一律用学术语言（例如「证据集合在分析启动前已预先确定」「结构化证据档案」「研究流程」）。"'''
new_sys = '''        "2. 这是面向期刊读者的正文，不是材料复述：要组织成详尽的论文语言——承上启下的关联词与过渡句（然而/与之相对/进一步地/值得注意的是/综合来看）、学术探究的句式（这提示…/其内在机制可解释为…/一个自然的疑问是…），对材料中的结论做更深入的阐释与串联，而非罗列；\\n"
        "3. 结构：开篇一段承接上一章并给出本章问题的回答总纲；主体 3-5 个论证段落，每段围绕一个维度展开（探索性论述与验证性证据交织：具体方法名、数据集、实验数字）；结尾一段给出本章结论并自然引向下一章的主题；\\n"
        "4. 如实呈现材料中的分歧与缺口，不得编造论文、数据或结论；所有关键论断用 \\\\cite{paper_id} 引用；\\n"
        "5. 学术中文撰写，专业术语、数据集/方法名保留英文原文，每章 4-8 段、每段 4-8 句，篇幅充实；\\n"
        "6. 严禁出现系统内部术语：冻结、工作记忆、流水线、W1/W2/W3/W4/W5、KG 分析 Agent、装配器、研究问题编号堆砌——用学术语言表达（如「证据集合在分析启动前已预先确定」「结构化证据档案」）。"'''
assert s.count(old_sys) == 1, 'sys anchor'
s = s.replace(old_sys, new_sys)

# ---- 2) user 材料：加邻域 RQ（供关联与综合） ----
old_user = '''        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n\\n"
                f"工作记忆（真实证据）：\\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}")'''
new_user = '''        prev_rq = rq_data[i - 1] if i > 0 else None
        next_rq = rq_data[i + 1] if i + 1 < len(rq_data) else None
        ctx = ""
        if prev_rq:
            ctx += f"\\n上一章主题（{prev_rq['rq_id']}）：{prev_rq['rq_text']}\\n上一章核心结论：{prev_rq['overall_answer'][:260]}"
        if next_rq:
            ctx += f"\\n下一章主题（{next_rq['rq_id']}）：{next_rq['rq_text']}——本章结尾应自然引向它"
        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n{ctx}\\n\\n"
                f"结构化证据材料（真实证据，论断与引用只允许来自这里）：\\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}")'''
assert s.count(old_user) == 1, 'user anchor'
s = s.replace(old_user, new_user)

# ---- 3) abstract 中文化 ----
old_abs = '''    abstract_user = ("为综述撰写 abstract（一段英文，150-220 词）。四个研究问题及其整体答案如下：\\n"
                     + "\\n".join(f"- {p['rq_id']}: {p['overall_answer'][:500]}" for p in rq_data))
    abstract_tex = chat(base, key, model,
                        "你是综述摘要写作者。只输出摘要正文一段，不含 \\\\begin{abstract} 等命令，不加标题。",
                        abstract_user, max_tokens=1200)'''
new_abs = '''    abstract_user = ("为综述撰写中文摘要（一段，250-350 字，语言与正文一致）。各研究问题及其核心结论如下：\\n"
                     + "\\n".join(f"- {p['rq_id']}: {p['overall_answer'][:500]}" for p in rq_data))
    abstract_tex = chat(base, key, model,
                        "你是综述摘要写作者。只输出摘要正文一段（中文），不含 \\\\begin{abstract} 等命令，不加标题，"
                        "句式凝练、有整体感，不出现「研究问题编号」堆砌与任何系统内部术语。",
                        abstract_user, max_tokens=1400)'''
assert s.count(old_abs) == 1, 'abs anchor'
s = s.replace(old_abs, new_abs)

# ---- 4) contribution 章 LLM 撰写（跨 RQ 综合分析） ----
old_contrib_anchor = '''    # 引用键扩展：LLM 常写短键（如 2049），bib 键为完整 paper_id——前缀唯一匹配展开'''
new_contrib = '''    # Contribution 章：跨 RQ 综合分析（LLM 撰写，非模板拼接）
    contrib_files = sorted(sections_dir.glob("[0-9]*_contribution.tex"),
                           key=lambda p: int(p.name.split('_')[0]))
    if contrib_files:
        cf = contrib_files[0]
        contrib_user = (
            "撰写综述的「综合分析与贡献」一章（Contribution），做跨研究问题的综合分析：\\n"
            "1. 第一段总起：把各问题的结论并置，提炼贯穿全文的 1-2 条主线索（例如架构-任务适配、评测碎片化）；\\n"
            "2. 中段 2-3 段：交叉综合——某问题的证据如何补充/制约另一问题的结论；指出跨问题的共识、矛盾与耦合；\\n"
            "3. 结尾段：凝练本文可复用的知识贡献（新分类框架、新坐标系、新设计维度）。\\n"
            "只输出 LaTeX 正文（不含 \\\\section 行）。各研究问题的结论材料：\\n"
            + json.dumps([{ 'rq_id': p['rq_id'], 'rq_text': p['rq_text'],
                            'core': p['overall_answer'][:700],
                            'top_claims': [c['text'] for c in (p.get('key_claims') or [])[:4]]}
                          for p in rq_data], ensure_ascii=False, indent=1)[:12000])
        contrib_tex = chat(base, key, model,
                           "你是学术综述写作者，撰写跨问题的综合分析章。学术中文、术语保留英文，4-6 段，"
                           "论断须来自给定材料并用 \\\\cite{paper_id} 引用，严禁内部术语（冻结/工作记忆/流水线/W1-W5）。",
                           contrib_user, max_tokens=4000)
        import re as _re2
        contrib_tex = _re2.sub(r"(?<!\\\\)&", r"\\\\&", contrib_tex)
        cf.write_text(contrib_tex.strip() + "\\n", encoding="utf-8")
        manifest["sections"].append(cf.name)
        print(f"[llm_sections] {cf.name} 跨RQ综合章写入（{len(contrib_tex)} 字符）", flush=True)

    # 引用键扩展：LLM 常写短键（如 2049），bib 键为完整 paper_id——前缀唯一匹配展开'''
assert s.count(old_contrib_anchor) == 1, 'contrib anchor'
s = s.replace(old_contrib_anchor, new_contrib)

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('llm_sections 论文化 OK')
