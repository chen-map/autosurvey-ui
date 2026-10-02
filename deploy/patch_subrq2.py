# -*- coding: utf-8 -*-
"""B2. v3_to_w5_adapter 聚合循环体：单 RQ 目录 → 父 RQ 聚合（子 RQ 各自分析的结果拼装）。"""
import ast

P = 'backend/w4/v3_to_w5_adapter.py'
s = open(P, encoding='utf-8').read()

old = '''    index_entries = []
    for rid in sorted(runs, key=_rq_num):
        d = runs[rid]
        meta = _j(d / "00_meta.json", {})
        ans = _j(d / "03_final_answer.json", None)
        # end() 包装：{"answer": ..., "metadata": ..., "_done": true}
        if isinstance(ans, dict) and "answer" in ans:
            ans = ans.get("answer")
        tool_calls = _j(d / "01_tool_calls.json", [])
        trace = _j(d / "02_reasoning_trace.json", [])
        papers_touched = paper_ids_touched(tool_calls)

        overall, note1 = extract_overall_answer(ans)
        claims, notes2 = extract_claims(ans, papers_touched)
        notes = [n for n in (note1, *notes2) if n]

        rq_dir = out / f"rq_{_rq_num(rid)}"
        rq_dir.mkdir(parents=True, exist_ok=True)'''

new = '''    index_entries = []
    for rid in sorted(runs_by_parent, key=_rq_num):
        sub_runs = runs_by_parent[rid]           # {RQ1.1: Path, RQ1.2: Path, ...} 或 {RQ1: Path}
        sub_ids = sorted(sub_runs, key=_rq_num)

        # ---- 逐子 RQ 收集分析结果，按父 RQ 聚合 ----
        subs_overall: list[str] = []
        subs_answers: list[dict] = []
        claims: list = []
        notes: list[str] = []
        skills: list[str] = []
        papers_all: list[str] = []
        total_calls = 0
        total_rounds = 0
        for sid in sub_ids:
            d = sub_runs[sid]
            meta = _j(d / "00_meta.json", {})
            ans = _j(d / "03_final_answer.json", None)
            if isinstance(ans, dict) and "answer" in ans:
                ans = ans.get("answer")
            tool_calls = _j(d / "01_tool_calls.json", [])
            papers_touched = paper_ids_touched(tool_calls)
            s_overall, note1 = extract_overall_answer(ans)
            s_claims, notes2 = extract_claims(ans, papers_touched)
            notes += [n for n in (note1, *notes2) if n]
            skills.append(str(meta.get("skill_id", "")))
            total_calls += len(tool_calls)
            total_rounds += int(meta.get("total_tool_rounds") or 0)
            for p in papers_touched:
                if p not in papers_all:
                    papers_all.append(p)
            if s_overall:
                subs_overall.append(f"### {sid}\\n{s_overall}" if len(sub_ids) > 1 else s_overall)
            subs_answers.append({
                "sub_rq_id": sid,
                "answer": s_overall or "",
                "confidence": None,
                "claims": len(s_claims),
                "papers_touched": len(papers_touched),
            })
            claims.extend(s_claims)
        claims = claims[:24]  # 聚合上限：W5 消费友好
        overall = "\\n\\n".join(subs_overall)
        papers_touched = papers_all[:30]

        rq_dir = out / f"rq_{_rq_num(rid)}"
        rq_dir.mkdir(parents=True, exist_ok=True)'''

assert s.count(old) == 1
s = s.replace(old, new)

# ---- 循环体内残留的旧引用清理（meta/ans/tool_calls/trace 已上移子循环）----
old2 = '''        working_memory = {
            "rq_id": rid,
            "rq_text": rq_text.get(rid, ""),
            "engine": "kg_analysis_v3",
            "skill_used": meta.get("skill_id", ""),
            "skill_selection": meta.get("skill_selection"),
            "answer": ans,
            "overall_answer": overall,
            "tool_rounds": meta.get("total_tool_rounds") or len(tool_calls),
            "papers_touched": papers_touched,
            "v3_run_dir": str(d),
        }'''
new2 = '''        working_memory = {
            "rq_id": rid,
            "rq_text": rq_text.get(rid, ""),
            "engine": "kg_analysis_v3",
            "skill_used": "+".join(skills),
            "sub_rq_analyses": subs_answers,
            "overall_answer": overall,
            "tool_rounds": total_rounds,
            "tool_calls": total_calls,
            "papers_touched": papers_touched,
        }'''
assert s.count(old2) == 1
s = s.replace(old2, new2)

old3 = '''            "sub_rq_answers": [],  # v3 宏 RQ 粒度分析；Sub 级映射见 completeness_notes'''
new3 = '''            "sub_rq_answers": subs_answers,  # 子 RQ 粒度分析（学长思路）：每子答案真实落位'''
assert s.count(old3) == 1
s = s.replace(old3, new3)

old4 = '''            "synthesis_notes": f"由 kg_analysis v3 生成（Skill: {meta.get('skill_id', '?')}，"
                               f"{len(tool_calls)} 次工具调用，触及 {len(papers_touched)} 篇论文）",
        }
        rq_answer = {
            "rq_id": rid, "rq_text": rq_text.get(rid, ""),
            "overall_answer": overall, "sub_rq_answers": [],
            "key_claims": claims,
        }'''
new4 = '''            "synthesis_notes": f"kg_analysis v3 子 RQ 粒度聚合（{len(sub_ids)} 个子分析，"
                               f"Skills: {'+'.join(skills) or '?'}，{total_calls} 次工具调用，"
                               f"触及 {len(papers_all)} 篇论文）",
        }
        rq_answer = {
            "rq_id": rid, "rq_text": rq_text.get(rid, ""),
            "overall_answer": overall, "sub_rq_answers": subs_answers,
            "key_claims": claims,
        }'''
assert s.count(old4) == 1
s = s.replace(old4, new4)

old5 = '''            "rq_type": "", "total_papers": len(papers_touched),
            "engine": "kg_analysis_v3", "skill_used": meta.get("skill_id", ""),'''
new5 = '''            "rq_type": "", "total_papers": len(papers_all),
            "engine": "kg_analysis_v3", "skill_used": "+".join(skills),'''
assert s.count(old5) == 1
s = s.replace(old5, new5)

old6 = '''        print(f"[v3->w5] {rid} → {rq_dir}（claims {len(claims)}，"
              f"触及论文 {len(papers_touched)}）")'''
new6 = '''        print(f"[v3->w5] {rid} → {rq_dir}（子分析 {len(sub_ids)} 个，claims {len(claims)}，"
              f"触及论文 {len(papers_all)}）")'''
assert s.count(old6) == 1
s = s.replace(old6, new6)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('B2. adapter 聚合循环 OK')
