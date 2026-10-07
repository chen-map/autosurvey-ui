# -*- coding: utf-8 -*-
"""corpus_papers 全量重建（真源=unified_records.csv 元数据 + papers/ 目录实况）。
步骤：清错位行 → 3898 元数据行全量入（title/doi/year/venue 修正列错位）→
papers/ 实况标注 status（pdf=downloaded, txt=failed 占位）→ 双项目行（123 + test 演示）。"""
import csv
import html
import pathlib
import re
import sqlite3

W1 = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1')
UR = W1 / 'retrieval_workspace' / 'normalized' / 'unified_records.csv'
PAPERS = W1 / 'retrieval_workspace' / 'papers'
DB = '/home/G2024hq/asv-app/autosurvey.db'

PID123 = 'proj-1790652141048'
PIDDEMO = 'proj-demo-multiedge'

def norm(t):
    return re.sub(r'[^a-z0-9]', '', html.unescape((t or '')).lower())

c = sqlite3.connect(DB)
cols = [r[1] for r in c.execute('PRAGMA table_info(corpus_papers)') if r[1] != 'id']
print('列:', cols)

# ---- 1) 清空错位行 ----
c.execute("DELETE FROM corpus_papers")
c.commit()
print('错位行已清')

# ---- 2) 元数据全量入（123 名下）----
rows = []
with UR.open(encoding='utf-8-sig', newline='') as fh:
    for row in csv.DictReader(fh):
        t = html.unescape((row.get('title') or '').strip())
        y = (row.get('year') or '').strip()
        rows.append({
            'project_id': PID123,
            'doi': html.unescape((row.get('doi') or '').strip()),
            'title': t,
            'venue': html.unescape((row.get('venue') or '').strip()),
            'year': int(y) if y.isdigit() else None,
            'url': (row.get('url') or '').strip(),
            'abstract': html.unescape((row.get('abstract') or '').strip())[:4000],
            'source': (row.get('source_db') or '').strip(),
            'status': 'candidate',
            'pdf_path': '',
            'record_id': (row.get('record_id') or '').strip(),
        })
ph = ','.join('?' * len(cols))
c.executemany(f"INSERT INTO corpus_papers ({','.join(cols)}) VALUES ({ph})",
              [[r_.get(cn) for cn in cols] for r_ in rows])
c.commit()
print(f'元数据行入库: {len(rows)}')

# ---- 3) papers/ 实况标注：桥 = download_ready.csv（record_id ↔ 文件名 slug 同源）----
pdfs = {p.name.rsplit('.', 1)[0] for p in PAPERS.glob('*.pdf')}
txts = {p.name.rsplit('.', 1)[0] for p in PAPERS.glob('*.txt')}

DR = W1 / 'retrieval_workspace' / 'download' / 'download_ready.csv'
dr_slug: dict[str, str] = {}
if DR.exists():
    with DR.open(encoding='utf-8-sig', newline='') as fh:
        for row in csv.DictReader(fh):
            rid = (row.get('record_id') or '').strip()
            slug = re.sub(r'[^a-z0-9]+', '_', html.unescape((row.get('title') or '')).lower())[:40].strip('_')
            if rid and slug:
                dr_slug[rid] = slug
n_pdf = n_txt = 0
for (rid, rec_id, title) in c.execute(
        "SELECT id, record_id, title FROM corpus_papers WHERE project_id=?", (PID123,)).fetchall():
    slug = dr_slug.get(rec_id, '')
    # 命中规则：{rec_id}_{桥slug} 完整前缀；无桥时退数字头
    hit_pdf = [s for s in pdfs if s.startswith(rec_id + '_' + slug) or (not slug and s.startswith(rec_id + '_'))]
    hit_txt = [s for s in txts if s.startswith(rec_id + '_' + slug) or (not slug and s.startswith(rec_id + '_'))]
    if hit_pdf:
        c.execute("UPDATE corpus_papers SET status='downloaded', pdf_path=? WHERE id=?",
                  (f'papers/{hit_pdf[0]}.pdf', rid))
        n_pdf += 1
    elif hit_txt:
        c.execute("UPDATE corpus_papers SET status='failed', pdf_path=? WHERE id=?",
                  (f'papers/{hit_txt[0]}.txt', rid))
        n_txt += 1
c.commit()
print(f'实况标注: downloaded={n_pdf}, 占位failed={n_txt}')

# ---- 4) test 演示行复制 ----
rows2 = c.execute(f"SELECT {','.join(cols)} FROM corpus_papers WHERE project_id=?", (PID123,)).fetchall()
data2 = [tuple(r_[:2] + (PIDDEMO,) + r_[3:]) for r_ in rows2] if False else \
        [tuple(PIDDEMO if cn == 'project_id' else r_[i] for i, cn in enumerate(cols)) for r_ in rows2]
c.executemany(f"INSERT INTO corpus_papers ({','.join(cols)}) VALUES ({ph})", data2)
c.commit()
print(f'test 演示行: {len(data2)}')

# ---- 5) 验收 ----
for pid in (PID123, PIDDEMO):
    dl = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id=? AND status='downloaded'", (pid,)).fetchone()[0]
    total = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id=?", (pid,)).fetchone()[0]
    print(f'{pid}: 总 {total} / downloaded {dl}')
