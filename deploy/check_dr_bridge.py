"""桥接诊断：download_ready.csv 的 record_id/title ↔ papers 文件名。"""
import csv
import html
import pathlib
import re

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
DR = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/download/download_ready.csv')
files = [p.name for p in P.iterdir()]
print('papers 文件样例:', files[:3])

hit = 0
with DR.open(encoding='utf-8-sig', newline='') as fh:
    for row in csv.DictReader(fh):
        rid = (row.get('record_id') or '').strip()
        slug = re.sub(r'[^a-z0-9]+', '_', html.unescape((row.get('title') or '')).lower())[:40].strip('_')
        m = [f for f in files if f.startswith(rid + '_') or (slug and f.startswith(slug[:20]))]
        if m and hit < 3:
            print('DR MATCH:', rid, '|', (row.get('title') or '')[:40], '=>', m[0][:44])
            hit += 1
print('DR 匹配样例数:', hit)
