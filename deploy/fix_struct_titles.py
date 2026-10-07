# -*- coding: utf-8 -*-
"""标题卫生源头修复：structured_papers.jsonl 的脏标题（页眉残留/文件名slug）
→ 用 unified_records.csv（W1 权威元数据）按 record_id 匹配回填。
同时修 paper_cards 的 title 字段（同源脏数据）。
"""
import csv
import json
import pathlib
import re

W1 = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1')
ST = W1 / 'retrieval_workspace' / 'w5_workspace' / 'knowledge_graph' / 'structured_papers.jsonl'
UR = W1 / 'retrieval_workspace' / 'normalized' / 'unified_records.csv'
CARDS = W1 / 'paper_cards' / 'parsed'

def bad(t):
    t = (t or '').strip()
    return (not t or re.fullmatch(r'\d{1,4}', t) or re.match(r'^\d{4}_', t)
            or bool(re.search(r'(?i)under review|camera-ready|published as|preprint submitted|anonymous authors', t))
            or len(t) < 12)

meta = {}
if UR.exists():
    with UR.open(encoding='utf-8-sig', newline='') as fh:
        for row in csv.DictReader(fh):
            rid = (row.get('record_id') or '').strip()
            t = (row.get('title') or '').strip()
            if rid and t and not bad(t):
                meta[rid] = t

fixed = 0
lines = []
for line in ST.read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    r = json.loads(line)
    pid = str(r.get('paper_id') or '')
    if bad(r.get('title')):
        rid = pid.split('_')[0]
        if rid in meta:
            r['title'] = meta[rid]
            fixed += 1
    lines.append(json.dumps(r, ensure_ascii=False))
ST.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'structured 标题修复：{fixed} 条')

fixed_c = 0
for f in CARDS.glob('*.json'):
    try:
        d = json.loads(f.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        continue
    pid = str(d.get('paper_id') or f.stem)
    if bad(d.get('title')):
        rid = pid.split('_')[0]
        if rid in meta:
            d['title'] = meta[rid]
            f.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
            fixed_c += 1
print(f'paper_cards 标题修复：{fixed_c} 条')
