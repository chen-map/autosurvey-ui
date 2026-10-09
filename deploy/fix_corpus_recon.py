# -*- coding: utf-8 -*-
"""corpus_papers 对账补全：papers/ 目录有 PDF 但 DB 无行的新增论文 → 入账。
（修复 396 vs 426 差异：W1-P6 末尾 ingest 之后 title_backfill/OA 又下载的 30 篇没有行。）
"""
import csv
import pathlib
import re
import sqlite3

W1 = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1791385765971/w1')
PID = 'proj-1791385765971'
DB = '/home/G2024hq/asv-app/autosurvey.db'

c = sqlite3.connect(DB)
existing = {r[0] for r in c.execute("SELECT record_id FROM corpus_papers WHERE project_id=?", (PID,)).fetchall()}

pdfs = {p.name.split('_')[0]: p for p in (W1 / 'retrieval_workspace' / 'papers').glob('*.pdf')}
added = 0
for rid, path in pdfs.items():
    if rid in existing:
        continue
    # 从 download_ready 找元数据
    row = {}
    dr = W1 / 'retrieval_workspace' / 'download' / 'download_ready.csv'
    if dr.exists():
        for r in csv.DictReader(dr.open(encoding='utf-8-sig', newline='')):
            rid_csv = ''.join(ch for ch in (r.get('record_id') or '') if ch.isdigit())
            if rid_csv.zfill(4) == rid:
                row = r
                break
    c.execute("INSERT OR IGNORE INTO corpus_papers (project_id, doi, title, venue, year, url, abstract, source, status, pdf_path, record_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (PID, row.get('doi') or '', row.get('title') or path.stem, row.get('venue') or '',
               int(row['year']) if (row.get('year') or '').isdigit() else None,
               row.get('url') or '', '', row.get('source_db') or 'backfill',
               'downloaded', str(path), rid))
    added += 1
c.commit()
print(f'补录 {added} 行 | DB 总行: {c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id=?", (PID,)).fetchone()[0]}')
