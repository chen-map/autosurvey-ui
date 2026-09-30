# -*- coding: utf-8 -*-
"""修复 patch_run_workflow5 在 raw 块里带入的双反斜杠正则（仅前两处；第三处经普通串解析后本就正确）。"""
import ast

P = '/home/G2024hq/autoSurvey_v2/workflow_5_survey_writing/run_workflow5.py'
s = open(P, encoding='utf-8').read()

fixes = [
    ('r"\\\\[([A-Za-z0-9_\\\\-]{2,80})\\\\]"', 'r"\\[([A-Za-z0-9_\\-]{2,80})\\]"'),
    ('re.split(r"(\\\\d+)", rq_id)', 're.split(r"(\\d+)", rq_id)'),
]
for old, new in fixes:
    n = s.count(old)
    if n != 1:
        print(f'SKIP anchor (count={n}): {old[:44]}')
        continue
    s = s.replace(old, new)
    print('fixed:', old[:44])

open(P, 'w', encoding='utf-8').write(s)
ast.parse(s)
print('syntax valid')
