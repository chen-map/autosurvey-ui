# -*- coding: utf-8 -*-
"""修复 patch_w5_structure 带入的 f-string 花括号问题：
f"..." 行内的 LaTeX 中文参数 {范围边界} 被 f-string 当表达式 → 双写 {{...}}。
"""
import ast
import re

P = '/home/G2024hq/autoSurvey_v2/workflow_5_survey_writing/run_workflow5.py'
lines = open(P, encoding='utf-8').read().split('\n')
fixed = 0
for i, ln in enumerate(lines):
    if 'f"' not in ln and "f'" not in ln:
        continue
    new = re.sub(r'(?<![{\\])\{([\u4e00-\u9fff][^{}"]{0,24})\}(?!\})', r'{{\1}}', ln)
    if new != ln:
        lines[i] = new
        fixed += 1
        print(f'L{i+1}: {ln.strip()[:80]}')
src = '\n'.join(lines)
ast.parse(src)
open(P, 'w', encoding='utf-8').write(src)
print(f'fixed {fixed} lines, syntax OK')
