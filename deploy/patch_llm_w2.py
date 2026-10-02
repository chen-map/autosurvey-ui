# -*- coding: utf-8 -*-
"""P3 材料注入 W2 KG 子图摘要 + 提示词升级（对比分析/综合密度）。"""
import ast

P = 'backend/w5/llm_sections.py'
s = open(P, encoding='utf-8').read()

NL = chr(10)

anchor = "def rq_payload_summaries("
helper = (
    'def kg_subgraph_summary(staging, rid: str, top: int = 6) -> str:' + NL +
    '    """该 RQ 冻结证据论文在 W2 知识图谱中诱导的子图摘要（六类节点 top-N + 边类型计数）。' + NL +
    NL +
    '    正文材料从「工作记忆」扩展为「工作记忆 + W2 KG 子图」（用户裁决：文字也要基于 W2）。' + NL +
    '    """' + NL +
    '    try:' + NL +
    '        staging = Path(staging)' + NL +
    '        matrix = staging / "workflow_3" / "analyze_report" / "rq_evidence_matrix.json"' + NL +
    '        kg_path = staging / "knowledge_graph" / "paper_kg.json"' + NL +
    '        if not (matrix.exists() and kg_path.exists()):' + NL +
    '            return ""' + NL +
    '        m = json.loads(matrix.read_text(encoding="utf-8"))' + NL +
    '        paper_ids: set = set()' + NL +
    '        for e in m.get("sub_rq_matrix", []):' + NL +
    '            if (e.get("rq_id") or "") == rid:' + NL +
    '                paper_ids.update(e.get("paper_ids_ranked") or [])' + NL +
    '        if not paper_ids:' + NL +
    '            return ""' + NL +
    '        kg = json.loads(kg_path.read_text(encoding="utf-8"))' + NL +
    '        names: dict = {}' + NL +
    '        for n in kg.get("nodes", []):' + NL +
    '            nid = str(n.get("node_id") or "")' + NL +
    '            if nid:' + NL +
    '                names[nid] = n.get("canonical_name") or nid' + NL +
    '        from collections import Counter' + NL +
    '        node_hits: dict = {}' + NL +
    '        edge_hits = Counter()' + NL +
    '        touched: set = set()' + NL +
    '        for e in kg.get("edges", []):' + NL +
    '            src, tgt = str(e.get("source_id") or ""), str(e.get("target_id") or "")' + NL +
    '            if src in paper_ids or tgt in paper_ids:' + NL +
    '                edge_hits[e.get("edge_type") or "?"] += 1' + NL +
    '                touched.add(src)' + NL +
    '                touched.add(tgt)' + NL +
    '        for n in kg.get("nodes", []):' + NL +
    '            nid = str(n.get("node_id") or "")' + NL +
    '            if nid in touched:' + NL +
    '                node_hits.setdefault(n.get("node_type") or "?", Counter())[names[nid]] += 1' + NL +
    '        parts = [f"RQ {rid} 证据子图（{len(paper_ids)} 篇冻结论文诱导）："]' + NL +
    '        for t in ("Problem", "Method", "DatasetBenchmark", "Metric", "Limitation", "AssumptionConstraint"):' + NL +
    '            c = node_hits.get(t)' + NL +
    '            if c:' + NL +
    '                tops = ", ".join(f"{k}({v})" for k, v in c.most_common(top))' + NL +
    '                parts.append(f"- {t} top：{tops}")' + NL +
    '        if edge_hits:' + NL +
    '            parts.append("- 关系边：" + ", ".join(f"{k}({v})" for k, v in edge_hits.most_common(8)))' + NL +
    '        return chr(10).join(parts)' + NL +
    '    except Exception:' + NL +
    '        return ""' + NL +
    NL +
    NL +
    'def rq_payload_summaries('
)
assert s.count(anchor) == 1
s = s.replace(anchor, helper, 1)

# user 材料追加 KG 子图摘要
old_user = '''        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n{ctx}\\n\\n"
                f"结构化证据材料（真实证据，论断与引用只允许来自这里）：\\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}")'''
new_user = '''        kg_ctx = kg_subgraph_summary(args.staging, payload['rq_id'])
        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\\n{ctx}\\n\\n"
                f"结构化证据材料（真实证据，论断与引用只允许来自这里）：\\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}"
                + (f"\\n\\n== W2 知识图谱证据子图（本 RQ 冻结论文诱导，用于对比分析与事实锚定）==\\n{kg_ctx}" if kg_ctx else ""))'''
assert s.count(old_user) == 1, 'user anchor'
s = s.replace(old_user, new_user)

# system 提示词升级（对比分析要求）
old_sys = '"2. 这是面向期刊读者的正文，不是材料复述：要组织成详尽的论文语言——承上启下的关联词与过渡句（然而/与之相对/进一步地/值得注意的是/综合来看）、学术探究的句式（这提示…/其内在机制可解释为…/一个自然的疑问是…），对材料中的结论做更深入的阐释与串联，而非罗列；\\n"'
new_sys = '"2. 这是面向期刊读者的正文，不是材料复述：要组织成详尽的论文语言——承上启下的关联词与过渡句（然而/与之相对/进一步地/值得注意的是/综合来看）、学术探究的句式（这提示…/其内在机制可解释为…/一个自然的疑问是…），对材料中的结论做更深入的阐释与串联，而非罗列；\\n"\n        "2b. 对比分析是硬要求：利用 KG 子图摘要做显式对比——方法之间（谁在什么条件下优于谁）、数据集/基准之间（覆盖与盲区）、失败模式之间（成因与耦合）；每个主要论证段至少包含一组对比或一组跨文献的综合；\\n"'
assert s.count(old_sys) == 1, 'sys anchor'
s = s.replace(old_sys, new_sys)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('llm_sections W2 材料注入 OK')
