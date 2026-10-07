import json
import pathlib
import re

# MetaGPT 85.9/87.7 原始归属
card = list(pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/paper_cards/parsed').glob('3810*'))[0]
s = card.read_text(encoding='utf-8')
for m in re.finditer(r'[^.\n]*(?:85\.9|87\.7|HumanEval|MBPP)[^.\n]*', s):
    t = m.group(0).strip()
    if len(t) > 30:
        print('3810卡:', t[:200])
        break
print('---')
# 53.2 语义：financial susceptibility 53.2% by 500 interactions = 易感性（发生率），非"漂移率上升"
# 4_rq1 写法 "金融分析系统在 500 轮内达 53.2%" ≈ 正确（drift incidence）
# T5/8_rq5 写法 "语义漂移在 600 次交互后影响近半数智能体，其中 53.2% 发生在金融分析域" —— 错：53.2 是 500 轮的金融域漂移发生率，不是 600 次里的占比
print('结论：T5body/8_rq5 的 53.2% 语义错位（600次交互占比 vs 500轮金融域易感性）')
