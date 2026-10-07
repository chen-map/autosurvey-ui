import csv
import pathlib
import re

BIB = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/references.bib')
UR = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/normalized/unified_records.csv')
norm = lambda t: re.sub(r'[^a-z0-9]', '', (t or '').lower())

meta = {}
with UR.open(encoding='utf-8-sig', newline='') as fh:
    for row in csv.DictReader(fh):
        t = (row.get('title') or '').strip()
        if t:
            meta[norm(t)] = row

bib = BIB.read_text(encoding='utf-8')
btitles = re.findall(r'title = \{([^}]*)\}', bib)
print('bib titles:', len(btitles), '| csv titles:', len(meta))
hit = miss = 0
samples = []
for bt in btitles[:200]:
    key = norm(bt.replace('\\_', '_').replace('\\%', '%').replace('\\&', '&'))
    if key in meta:
        hit += 1
    else:
        miss += 1
        if len(samples) < 3:
            samples.append((bt[:70], key[:40]))
print(f'命中 {hit} / 未中 {miss}')
for s in samples:
    print('未中样例:', s)
