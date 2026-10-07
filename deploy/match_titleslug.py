# -*- coding: utf-8 -*-
"""title-slug 直对 papers 文件名匹配（title 生成 slug 与下载文件名同源——终极正确做法）。"""
import html
import pathlib
import re
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
pdfs = {p.name.rsplit('.', 1)[0] for p in P.glob('*.pdf')}
n = 0
for rid, title in c.execute(
        "SELECT id, title FROM corpus_papers WHERE project_id='proj-1790652141048' AND status='candidate'").fetchall():
    sl = re.sub(r'[^a-z0-9]+', '_', html.unescape((title or '')).lower())[:40].strip('_')
    m = [s for s in pdfs if sl and (s == sl or s.startswith(sl[:25]))]
    if m:
        c.execute("UPDATE corpus_papers SET status='downloaded', pdf_path=? WHERE id=?",
                  ('papers/' + m[0] + '.pdf', rid))
        n += 1
c.commit()
print('title-slug 下载命中:', n)
dl = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048' AND status='downloaded'").fetchone()[0]
print('downloaded 总:', dl)
