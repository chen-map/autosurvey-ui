import pathlib
import re

F = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections/9_contribution.tex')
s = F.read_text(encoding='utf-8')

# 截断残迹：未闭合的 \cite{xxx（无 }）→ 移除
s = re.sub(r'\\cite\{[^}]*$', '', s)
# “\item 跨问题交叉综合”孤立行（截断处）→ 补成完整段
if '\\item 跨问题交叉综合' in s and '正交维度解耦' not in s.split('跨问题交叉综合')[-1][:200]:
    s = s.replace(
        '\\item 跨问题交叉综合',
        '\\item \\textbf{跨问题交叉综合}：错误传播的抑制依赖可审计的编排结构，而这正是集中式架构的优势面；'
        '评测碎片化使不同架构路线的对比难以公平，凸显统一协作度量的必要性。'
        '综合来看，架构选择、错误抑制与评测方法三者互为约束，构成需要联合求解的设计空间。')
if '\\begin{itemize}' in s and '\\end{itemize}' not in s:
    s = s.rstrip() + '\n\\end{itemize}\n'
F.write_text(s, encoding='utf-8')
print('tail:', s[-120:].replace('\n', ' '))
