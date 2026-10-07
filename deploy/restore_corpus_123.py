# -*- coding: utf-8 -*-
"""corpus_papers 修复 v2：单事务 + INSERT OR IGNORE + 逐批提交（避免部分插入后冲突全滚回）。"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)') if r[1] != 'id']
rows = c.execute("SELECT * FROM corpus_papers WHERE project_id='proj-demo-multiedge'").fetchall()
n = 0
for r in rows:
    d = dict(zip(cols, r))
    d['project_id'] = 'proj-1790652141048'
    ph = ','.join('?' * len(cols))
    c.execute(f"INSERT OR IGNORE INTO corpus_papers ({','.join(cols)}) VALUES ({ph})", list(d.values()))
    n += 1
    if n % 500 == 0:
        c.commit()
# demo 行删除放最后（复制确认后再清）
c.commit()
cnt = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchone()[0]
print(f'插入完成，123 现有 {cnt} 行')
if cnt >= 3600:
    c.execute("DELETE FROM corpus_papers WHERE project_id='proj-demo-multiedge'")
    c.commit()
    print('demo 行已清零')
else:
    print('数量异常，保留 demo 行不删（人工核查）')
