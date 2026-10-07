# -*- coding: utf-8 -*-
"""P1-B/C 就地修：
B. T3body 的"MBPP 与 HumanEval...分别达到 85.9% 与 87.7%"语序导致分配颠倒
   （MetaGPT 原文：HumanEval 85.9 / MBPP 87.7）→ 改为显式绑定数字与基准。
C. T5body 与 8_rq5 的 53.2% 语义错位：原文是"金融分析域在 500 轮交互时的漂移发生率 53.2%"，
   非"600 次交互影响近半数智能体中 53.2% 发生在金融域"→ 改写对齐原义。
"""
import pathlib

SEC = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections')

t3 = SEC / 'T3body.tex'
s = t3.read_text(encoding='utf-8')
old3 = 'MetaGPT 结合 GPT-4 已分别达到 85.9\\% 与 87.7\\%'
new3 = 'MetaGPT 结合 GPT-4 在 HumanEval 与 MBPP 上分别取得 85.9\\% 与 87.7\\%'
if old3 in s:
    s = s.replace(old3, new3)
    t3.write_text(s, encoding='utf-8')
    print('B: T3body 数字绑定已修')
else:
    print('B: T3body 原句未匹配（可能已修）')

for name in ('T5body.tex', '8_rq5.tex'):
    f = SEC / name
    if not f.exists():
        continue
    s = f.read_text(encoding='utf-8')
    # 两处变体统一改为对齐原义：53.2% = 金融域在 500 轮时的漂移发生率
    old5a = '其中 53.2\\% 发生在金融分析域'
    new5a = '而漂移发生率以金融分析域为最高（500 轮内达 53.2\\%）'
    old5b = '其中 53.2\\% 发生于金融分析域'
    new5b = '而漂移发生率以金融分析域为最高（500 轮内达 53.2\\%）'
    n = 0
    if old5a in s:
        s = s.replace(old5a, new5a); n += 1
    if old5b in s:
        s = s.replace(old5b, new5b); n += 1
    if n:
        f.write_text(s, encoding='utf-8')
        print(f'C: {name} 语义错位已修（{n} 处）')
    else:
        print(f'C: {name} 无匹配（可能已修）')
