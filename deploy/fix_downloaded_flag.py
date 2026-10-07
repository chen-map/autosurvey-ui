# -*- coding: utf-8 -*-
"""错位修完后的状态列收尾：
1. 之前错位期 status 全被写成 source_db 值——统一恢复：
   pdf_path 有 .pdf → downloaded；.txt 或空 → candidate
2. 抽样验 123 与 test 语料页。
"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
n = 0
for rid, pdf_path in c.execute("SELECT id, pdf_path FROM corpus_papers").fetchall():
    pp = pdf_path or ''
    st = 'downloaded' if pp.endswith('.pdf') else 'candidate'
    c.execute("UPDATE corpus_papers SET status=? WHERE id=?", (st, rid))
    n += 1
c.commit()
print(f'status 恢复 {n} 行')

d1 = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048' AND status='downloaded'").fetchone()[0]
d2 = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-demo-multiedge' AND status='downloaded'").fetchone()[0]
print(f'123 downloaded: {d1} | test downloaded: {d2}')
