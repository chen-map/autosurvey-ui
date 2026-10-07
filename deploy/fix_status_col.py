# -*- coding: utf-8 -*-
"""修 status 列错位：v2 修复脚本复制行时列错位，把 source_db 值写进了 status。
真实状态可从字段组恢复：
- 有 pdf_path 或占位 txt → downloaded / failed
- 其余（检索来源行，未到下载阶段）→ 按 W1 语义应为 not_downloaded/candidate 类
先看列结构确认错位方式，再按规则重写 status。
"""
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)')]
print('列序:', cols)

rows = c.execute("SELECT * FROM corpus_papers WHERE project_id='proj-1790652141048' LIMIT 3").fetchall()
for r in rows:
    print(dict(zip(cols, r)))
