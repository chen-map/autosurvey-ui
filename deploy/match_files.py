# -*- coding: utf-8 -*-
"""PDF 文件名 slug → corpus 行 title 模糊匹配补标（token 重合 ≥0.6 视为同篇——
文件名与标题同源，只是 token 顺序/标点差异）。"""
import html
import pathlib
import re
import sqlite3

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')

def toks(t):
    t = html.unescape((t or '')).lower()
    return set(re.findall(r'[a-z0-9]+', t))

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
pdf_rows = [(p.name.rsplit('.', 1)[0], p.name) for p in P.glob('*.pdf')]
n = 0
for (rid, title) in c.execute(
        "SELECT id, title FROM corpus_papers WHERE status='candidate' AND title IS NOT NULL").fetchall():
    tt = toks(title)
    if len(tt) < 3:
        continue
    best, best_score = None, 0.0
    for stem, fname in pdf_rows:
        fs = toks(re.sub(r'^\d+_', '', stem))
        if not fs:
            continue
        score = len(tt & fs) / max(len(tt | fs), 1)
        if score > best_score:
            best, best_score = fname, score
    if best and best_score >= 0.6:
        c.execute("UPDATE corpus_papers SET status='downloaded', pdf_path=? WHERE id=?",
                  ('papers/' + best, rid))
        n += 1
c.commit()
dl = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE status='downloaded'").fetchone()[0]
print(f'token 重合补标 {n}，downloaded 总 {dl}')
