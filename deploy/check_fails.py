# -*- coding: utf-8 -*-
"""占位 txt 的 DOI 前缀分布（判定付费墙占比）。"""
import collections
import pathlib
import re

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1791385765971/w1/retrieval_workspace/papers')
txts = list(P.glob('*.txt'))
pref = collections.Counter()
no_doi = 0
for t in txts:
    s = t.read_text(encoding='utf-8', errors='replace')
    m = re.search(r'DOI\s*:\s*([^\n]+)', s)
    if m:
        pref[m.group(1).strip().split('/')[0]] += 1
    else:
        no_doi += 1
print('占位 DOI 前缀分布:', dict(pref.most_common()))
print('无 DOI 占位:', no_doi)
