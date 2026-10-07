# -*- coding: utf-8 -*-
"""candidate 行 title-slug 补标剩余 PDF（slug-id 论文）。"""
import html
import pathlib
import re
import sqlite3

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
pdfs = {p.name.rsplit('.', 1)[0]: p.name for p in P.glob('*.pdf')}
c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
n = 0
for rid, title in c.execute(
        "SELECT id, title FROM corpus_papers WHERE status='candidate'").fetchall():
    s = re.sub(r'[^a-z0-9]', '', html.unescape((title or '')).lower())[:30]
    if not s:
        continue
    m = []
    for f, stem in ((f, re.sub(r'^\d+_', '', f)) for f in pdfs):
        clean = re.sub(r'[^a-z0-9]', '', stem)
        if s and s in clean:
            m.append(pdfs[f])
    if m:
        c.execute("UPDATE corpus_papers SET status='downloaded', pdf_path=? WHERE id=?",
                  ('papers/' + m[0], rid))
        n += 1
c.commit()
dl = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE status='downloaded'").fetchone()[0]
print(f'补标 {n}，downloaded 总 {dl}')
