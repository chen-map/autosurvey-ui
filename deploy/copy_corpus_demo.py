# -*- coding: utf-8 -*-
"""为 demo 复制语料行（COPY，非搬移——123 的 3642 行原地保留，两账号各自可见）。"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)') if r[1] != 'id']
rows = c.execute("SELECT * FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchall()
n = 0
for r in rows:
    d = dict(zip(cols, r))
    d['project_id'] = 'proj-demo-multiedge'
    ph = ','.join('?' * len(cols))
    c.execute("INSERT OR IGNORE INTO corpus_papers ({}) VALUES ({})".format(','.join(cols), ph),
              list(d.values()))
    n += 1
c.commit()
print(f'demo 复制 {n} 行 | 123 行数不变: {c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id=?", ("proj-1790652141048",)).fetchone()[0]}')
