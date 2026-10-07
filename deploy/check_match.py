"""对齐诊断：unified 的 title → papers 文件名的真实映射关系。"""
import csv
import html
import itertools
import pathlib
import re

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
UR = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/normalized/unified_records.csv')

files = [p.name for p in P.iterdir()]
slugify = lambda t: re.sub(r'[^a-z0-9]+', '_', html.unescape((t or '')).lower())[:60].strip('_')

hit = 0
with UR.open(encoding='utf-8-sig', newline='') as fh:
    for row in itertools.islice(csv.DictReader(fh), 200):
        t = html.unescape((row.get('title') or '')).strip()
        sl = slugify(t)
        prefix_hits = [f for f in files if f.startswith(sl[:20])]
        if prefix_hits and hit < 3:
            print('MATCH:', t[:40], '=>', prefix_hits[0][:50])
            hit += 1
print('前200行中 slug 前20字符命中:', hit)
