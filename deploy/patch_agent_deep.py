# -*- coding: utf-8 -*-
"""W4 Agent 深挖版：上限 30→60、催促 12→45、防早退拦截（<14轮或<40次调用的 end 拒一次）、
user message 追加深挖纪律。治'自愿早退'（实测 6-10 轮即交卷、覆盖不足）。"""
import ast

P = 'backend/w4/kg_analysis/layer3_llm_agent/llm_skill_agent.py'
s = open(P, encoding='utf-8').read()

old = "    MAX_TOOL_ROUNDS = 30  # 防止无限循环"
new = (
    "    MAX_TOOL_ROUNDS = 60  # 防止无限循环（深挖版：30→60，实测 6-10 轮即自愿交卷、覆盖不足）\n"
    "    _URGE_AT_ROUND = 45   # 催促阈值随上限放宽（原 12 会过早打断深挖）\n"
    "    _MIN_ROUNDS = 14      # 防早退：低于此轮次调 end 会被拒一次并要求补覆盖\n"
    "    _MIN_TOOL_CALLS = 40  # 防早退：工具调用总数门槛（软性，随提示词一起强调）"
)
assert s.count(old) == 1
s = s.replace(old, new)

old2 = "    _URGE_AT_ROUND = 12   # 超过此轮数后插入催促消息\n"
assert s.count(old2) == 1
s = s.replace(old2, "")

old3 = (
    "                # 捕获 end() 的最终答案\n"
    "                if tool_name == \"end\" and isinstance(raw_result, dict):\n"
    "                    final_answer = raw_result.get(\"answer\")"
)
new3 = (
    "                # 捕获 end() 的最终答案；防早退：覆盖不足时拒绝一次 end，要求补查\n"
    "                if tool_name == \"end\" and isinstance(raw_result, dict):\n"
    "                    if (round_count < self._MIN_ROUNDS\n"
    "                            and len(tool_call_log) < self._MIN_TOOL_CALLS):\n"
    "                        tool_results.append({\n"
    "                            \"type\": \"tool_result\",\n"
    "                            \"tool_use_id\": block.id,\n"
    "                            \"content\": json.dumps({\n"
    "                                \"rejected\": True,\n"
    "                                \"reason\": (f\"证据覆盖不足：目前仅 {round_count} 轮 / \"\n"
    "                                           f\"{len(tool_call_log)} 次工具调用。请继续深挖：\"\n"
    "                                           \"对六类节点（问题/方法/数据集基准/指标/局限/假设）逐类补查询，\"\n"
    "                                           \"并用 search_paper_sections 多读几篇关键论文的原文摘录，\"\n"
    "                                           \"覆盖充分后再调用 end。\"), \"ensure_ascii\": False}),\n"
    "                        })\n"
    "                        continue\n"
    "                    final_answer = raw_result.get(\"answer\")"
)
assert s.count(old3) == 1
s = s.replace(old3, new3)

NL = '\\n'  # 目标源码里的转义序列（两字符），不是真实换行
old4 = '"然后生成 HTML 报告的 JSON 内容块数组。"'
assert s.count(old4) == 1
new4 = (
    '"然后生成 HTML 报告的 JSON 内容块数组。' + NL + NL + '"\n'
    '            "**深挖纪律（重要）**：end 之前必须确认——（1）对问题/方法/数据集基准/指标/局限/假设六类节点"\n'
    '            "都执行过针对性查询；（2）用 search_paper_sections 精读过至少 8 篇关键论文的相关段落；"\n'
    '            "（3）总工具调用不少于 40 次。宁多查三轮，不浅尝辄止——分析深度是首要质量标准。"'
)
s = s.replace(old4, new4)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('agent deep OK')
