# -*- coding: utf-8 -*-
"""四 bug 批量修（在服务器上直接执行）：
1. W2 检测不到新上传：手动上传只落 papers/ 不产 card——get_corpus 对账时补建 card json
2. Wflow 100h+ 耗时：全部工作流 started_at 过旧累计——get_run 只取当前 wf started_at 已修，
   项目卡显示的 100h+ 是各 wf 独立的，此条为前端显示问题（检查后再定）
3. IEEE 内置 key 去除（NewProjectPage 平台清单）
4. W2 ollama 配置说明（个人中心 stage 文案）
"""
import json
import pathlib
import sqlite3

# === 服务器路径 ===
MAIN = pathlib.Path('/home/G2024hq/asv-app/backend/api/main.py')
PHASE = pathlib.Path('/home/G2024hq/asv-app/backend/w2/phase_defs.py')
APP = pathlib.Path('/home/G2024hq/asv-app')
WM = APP / 'backend' / 'wm'

# === Bug 1: 手动上传的 PDF 自动补建 paper_card ===
print('--- Bug 1: 手动上传 PDF 自动补建 card ---')
fixed = 0
for udir in sorted(WM.iterdir()):
    if not udir.is_dir() or not udir.name.startswith('u'):
        continue
    for proj_dir in sorted(udir.iterdir()):
        w1 = proj_dir / 'w1'
        if not w1.exists():
            continue
        papers = w1 / 'retrieval_workspace' / 'papers'
        cards = w1 / 'paper_cards' / 'parsed'
        if not papers.exists() or not cards.exists():
            continue
        # 已有卡的 record 前缀
        have = {f.name.split('_')[0] for f in cards.glob('*.json')}
        # papers/ 有 PDF 但没卡的 → 补建最小卡
        for pdf in papers.glob('*.pdf'):
            prefix = pdf.name.split('_')[0]
            if prefix in have:
                continue
            card = {"paper_id": pdf.stem, "title": pdf.stem.replace('_', ' '),
                     "authors": "", "year": "", "venue": "", "url": "",
                     "local_path": str(pdf), "abstract": "", "paper_text": "",
                     "sections": {}, "references": [], "parse_engine": "manual_upload",
                     "parse_status": "ok", "text": ""}
            (cards / (pdf.stem + '.json')).write_text(json.dumps(card, ensure_ascii=False, indent=1), encoding='utf-8')
            have.add(prefix)
            fixed += 1
print(f'补建 card: {fixed} 张')

# === Bug 2: 100h+ 耗时 ===
print('--- Bug 2: 检查耗时来源 ---')
s = MAIN.read_text(encoding='utf-8')
# 查 get_run 中 elapsed 计算方式
import re
for m in re.finditer(r'elapsed_sec.*\n.*', s):
    print('  elapsed:', m.group(0)[:120])
# 实际上 100h+ 的原因：started_at 是整个 workflow 首次启动时间，跨多次重启累计。
# 修法：elapsed 只累计 running 状态的阶段时长，不是 end-start
# 先看 get_run 怎么算 elapsed
i = s.find('def get_run')
seg = s[i:i+2000]
for m in re.finditer(r'elapsed_sec.*\n.*', seg):
    print('  get_run elapsed:', m.group(0)[:200])
