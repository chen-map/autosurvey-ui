# -*- coding: utf-8 -*-
"""test 演示项目语料清洗：删 demo 时代脏行（含错位行）→ 从 123 真实行 COPY 干净版。
123（uid=3）的行一根手指不动。"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)') if r[1] != 'id']

# 1) 删 test 演示项目旧语料行（脏）
c.execute("DELETE FROM corpus_papers WHERE project_id='proj-demo-multiedge'")

# 2) 从 123 真实行 COPY 干净版（123 行原地保留）
rows = c.execute("SELECT * FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchall()
n = 0
for r in rows:
    d = dict(zip(cols, r))
    d['project_id'] = 'proj-demo-multiedge'
    ph = ','.join('?' * len(cols))
    c.execute(f"INSERT OR IGNORE INTO corpus_papers ({','.join(cols)}) VALUES ({ph})", list(d.values()))
    n += 1
c.commit()

# 3) 三方校验
n123 = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchone()[0]
ntest = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-demo-multiedge'").fetchone()[0]
badtest = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-demo-multiedge' AND doi LIKE 'proj-%'").fetchone()[0]
print(f'123: {n123} 行（未动） | test 干净副本: {ntest} 行 | test 脏行残留: {badtest}')
