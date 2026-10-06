# -*- coding: utf-8 -*-
"""llm_sections 深度化改造（用户裁决：分析内在而非表面）：
1. 材料预算重分配：claims+evidence 置顶保真（治 RQ2 零引用——9500 截断把论文 id 挤掉）
2. user 材料改为分层构造（论断证据 > 子问题分析 > KG 子图）
3. 输出自检清单 + 代码验收：每章 cite<8 自动重试一次
4. 五个模板章 LLM 化（intro/method/future/limitation——材料来自真实参数与产物）
5. 引用规范：禁三连堆砌
"""
import ast

P = 'backend/w5/llm_sections.py'
s = open(P, encoding='utf-8').read()
NL = chr(10)

# ============ 1) user 材料分层构造（替换旧 user 组装） ============
old_user = '''        kg_ctx = kg_subgraph_summary(args.staging, payload['rq_id'])
        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n{ctx}\\n\\n"
                f"结构化证据材料（真实证据，论断与引用只允许来自这里）：\\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}"
                + (f"\\n\\n== W2 知识图谱证据子图（本 RQ 冻结论文诱导，用于对比分析与事实锚定）==\\n{kg_ctx}" if kg_ctx else ""))'''
new_user = '''        kg_ctx = kg_subgraph_summary(args.staging, payload['rq_id'])
        claims_txt = json.dumps(payload.get('key_claims') or [], ensure_ascii=False)[:4200]
        subs = payload.get('sub_answers') or []
        subs_txt = NL.join(f"- {s.get('id') or s.get('sub_rq_id')}: {(s.get('answer') or s[:0] if isinstance(s, str) else s.get('answer') or '')[:1100]}"
                           for s in subs)[:3600]
        overall_txt = (payload.get('overall_answer') or '')[:1800]
        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n{ctx}\\n\\n"
                "== 可核查论断与证据论文 id（引用只允许使用这里出现的 id，务必充分使用）==\\n" + claims_txt + NL + NL
                + "== 子问题及其分析（本章须逐一覆盖）==\\n" + (subs_txt or "（无子答案）") + NL + NL
                + "== 综合叙事（补充上下文）==\\n" + overall_txt
                + (f"\\n\\n== W2 知识图谱证据子图（对比分析与事实锚定用）==\\n{kg_ctx}" if kg_ctx else ""))'''
assert s.count(old_user) == 1, 'user anchor'
s = s.replace(old_user, new_user)

# ============ 2) 提示词：自检清单 + 引用规范 ============
old_sys_tail = '"6. 严禁出现系统内部术语：冻结、工作记忆、流水线、W1/W2/W3/W4/W5、KG 分析 Agent、装配器、研究问题编号堆砌——用学术语言表达（如「证据集合在分析启动前已预先确定」「结构化证据档案」「研究流程」）。"'
new_sys_tail = ('"6. 严禁出现系统内部术语：冻结、工作记忆、流水线、W1/W2/W3/W4/W5、KG 分析 Agent、装配器——用学术语言表达（如「证据集合在分析启动前已预先确定」「结构化证据档案」）；\\n"\n'
                '        "7. 输出前自检（不满足则重写再交）：全文引用 ≥8 处且每个论证段至少 1 处；本章所有子问题逐一覆盖；同一断言的引用 ≤2 篇（选代表性来源，禁止三连堆砌）；首段承接上一章、尾段引出下一章。"')
assert s.count(old_sys_tail) == 1, 'sys tail'
s = s.replace(old_sys_tail, new_sys_tail)

# ============ 3) 代码验收：cite<8 重试一次 ============
old_write = '''        tex = latex_sanitize(chat(base, key, model, system, user))
        target.write_text(tex.strip() + "\\n", encoding="utf-8")
        manifest["sections"].append(str(target.name))
        print(f"[llm_sections] {target.name} 写入（{len(tex)} 字符）", flush=True)'''
new_write = '''        tex = latex_sanitize(chat(base, key, model, system, user))
        n_cites = len(re.findall(r"\\\\cite\\{", tex))
        if n_cites < 8:  # 验收：引用密度不达标 → 带批评重试一次（不靠 LLM 自觉）
            print(f"[llm_sections] {target.name} 引用仅 {n_cites} 处（<8），重试", flush=True)
            tex2 = chat(base, key, model, system,
                        user + "\\n\\n【上次输出被驳回：引用只有 " + str(n_cites) + " 处（要求 ≥8）且可能未覆盖子问题。"
                        "这次必须充分使用「可核查论断与证据论文 id」材料中的论文 id。】")
            tex = latex_sanitize(tex2)
            n_cites = len(re.findall(r"\\\\cite\\{", tex))
        target.write_text(tex.strip() + "\\n", encoding="utf-8")
        manifest["sections"].append(str(target.name))
        print(f"[llm_sections] {target.name} 写入（{len(tex)} 字符，{n_cites} 处引用）", flush=True)'''
assert s.count(old_write) == 1, 'write anchor'
s = s.replace(old_write, new_write)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('llm_sections deep OK (1-3)')
