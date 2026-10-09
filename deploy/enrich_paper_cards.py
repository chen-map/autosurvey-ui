# -*- coding: utf-8 -*-
"""paper_cards 元数据补全（真源=unified_records.csv，按 record_id 前缀精确匹配）：
- title 空或页眉残留（Vol.:/Under review 等）→ unified 真标题
- authors/year/venue 空 → unified 回填
- abstract 空 → unified 补（卡片已有的不动）
123 与 test 演示项目两侧的 papers 目录都处理；改前备份卡目录清单。
"""
import csv
import json
import pathlib
import re

W1 = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1')
UR = W1 / 'retrieval_workspace' / 'normalized' / 'unified_records.csv'
TARGETS = [
    pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/paper_cards/parsed'),
    pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/paper_cards/parsed'),  # 同目录（123 与 demo 共享 workspace 已验证）
]

def norm(t):
    return re.sub(r'[^a-z0-9]', '', (t or '').lower())[:48]

def bad_title(t):
    t = (t or '').strip()
    return (not t or len(t) < 12
            or bool(re.search(r'(?i)under review|camera-ready|published as|vol\.\:|preprint submitted', t)))

# unified 索引：record_id → 权威元数据
meta = {}
with UR.open(encoding='utf-8-sig', newline='') as fh:
    for row in csv.DictReader(fh):
        rid = ''.join(c for c in (row.get('record_id') or '') if c.isdigit())
        if rid:
            meta[f"{int(rid):04d}"] = row

def fix_card(f: pathlib.Path) -> bool:
    d = json.loads(f.read_text(encoding='utf-8'))
    pid = str(d.get('paper_id') or f.stem)
    rid = pid.split('_')[0]
    row = meta.get(rid)
    if not row:
        return False
    changed = False
    if bad_title(d.get('title')):
        ut = html_unescape(row.get('title') or '')
        if ut:
            d['title'] = ut; changed = True
    if not (d.get('authors') or '').strip() and (row.get('authors') or '').strip():
        d['authors'] = row['authors'].strip(); changed = True
    if not d.get('year') and (row.get('year') or '').strip():
        y = row['year'].strip()
        d['year'] = int(y) if y.isdigit() else y; changed = True
    if not (d.get('venue') or '').strip() and (row.get('venue') or '').strip():
        d['venue'] = row['venue'].strip(); changed = True
    if not (d.get('abstract') or '').strip() and (row.get('abstract') or '').strip():
        d['abstract'] = row['abstract'].strip()[:6000]; changed = True
    if changed:
        f.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    return changed

def html_unescape(t):
    import html as _h
    return _h.unescape(t or '')

for d_ in TARGETS:
    n = 0
    for f in sorted(d_.glob('*.json')):
        if fix_card(f):
            n += 1
    print(f'{d_}: 修复 {n} 张卡')

# 终验：统计残留缺失
total = miss_t = miss_a = miss_y = 0
for f in sorted(TARGETS[0].glob('*.json')):
    d = json.loads(f.read_text(encoding='utf-8'))
    total += 1
    if bad_title(d.get('title')): miss_t += 1
    if not (d.get('authors') or '').strip(): miss_a += 1
    if not d.get('year'): miss_y += 1
print(f'终验：{total} 卡 | title 缺 {miss_t} | authors 缺 {miss_a} | year 缺 {miss_y}')
