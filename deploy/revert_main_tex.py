"""服务器 main.tex 就地换头：acmart → 经典 article+ctex 版式（保 title 与 inputs 不动）。"""
import re
import pathlib

MP = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/main.tex')
s = MP.read_text(encoding='utf-8')

# 提取 title 与 inputs（保持现状）
mt = re.search(r'\\title\{(.+?)\}', s, re.S)
title = mt.group(1).strip() if mt else 'Survey'
inputs = re.findall(r'\\input\{sections/[^}]+\}', s)

new = (
    '\\documentclass[10pt]{article}\n'
    '\\usepackage[UTF8]{ctex}\n'
    '\\usepackage[a4paper,margin=2.4cm]{geometry}\n'
    '\\usepackage{amsmath,amssymb,amsfonts}\n'
    '\\usepackage{booktabs,tabularx,array,multirow}\n'
    '\\usepackage{graphicx}\n'
    '\\usepackage{url}\n'
    '\\usepackage{cite}\n'
    '\\usepackage{xcolor}\n'
    '\\usepackage[colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue]{hyperref}\n\n'
    f'\\title{{{title}}}\n'
    '\\author{AutoSurvey Pipeline}\n\n'
    '\\begin{document}\n\\maketitle\n\n'
    '\\begin{abstract}\n\\input{sections/0_abstract}\n\\end{abstract}\n\n'
    + '\n'.join(inputs) + '\n\n'
    '\\bibliographystyle{unsrt}\n\\bibliography{references}\n\n\\end{document}\n')
MP.write_text(new, encoding='utf-8')
print(f'换头完成：{len(inputs)} 章 inputs 保留，title={title[:40]}')
