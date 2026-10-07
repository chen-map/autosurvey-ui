# -*- coding: utf-8 -*-
"""最终还原：corpus_papers 全部行归还 proj-1790652141048（uid=3 真实数据），demo 项目不碰语料表。
demo 的语料页由 get_corpus 的 papers/ 目录实时对账路径兜底（live 视图）。"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
n = 0
for (rid,) in c.execute("SELECT id FROM corpus_papers WHERE project_id='proj-demo-multiedge'").fetchall():
    c.execute("UPDATE corpus_papers SET project_id='proj-1790652141048' WHERE id=?", (rid,))
    n += 1
c.commit()
print(f'归还 {n} 行给 proj-1790652141048')
print('123 行数:', c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchone()[0])
print('demo 行数:', c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-demo-multiedge'").fetchone()[0])
