# -*- coding: utf-8 -*-
"""corpus_papers：把 demo 行复制给 123（demo 行保持不动）——两账号语料都可见。"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)') if r[1] != 'id']
rows = c.execute("SELECT * FROM corpus_papers WHERE project_id='proj-demo-multiedge'").fetchall()
# 去掉自增主键 id，让新行重新分配
n = 0
for r in rows:
    d = dict(zip(cols, r))
    d.pop('id', None)
    d['project_id'] = 'proj-1790652141048'
    ph = ','.join('?' * len(cols))
    c.execute(f"INSERT INTO corpus_papers ({','.join(cols)}) VALUES ({ph})", list(d.values()))
    n += 1
c.commit()
print('123 侧恢复行数:', n)
