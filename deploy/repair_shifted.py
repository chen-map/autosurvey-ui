# -*- coding: utf-8 -*-
"""列错位自校正修复：
观察到的错位（右移一格，首列 doi 位置装了 project_id）：
  doi←project_id, title←doi, venue←title, year←venue(字符串), url←year, abstract←url, source←abstract...
即真值序列 [record_id?] 丢失，其余全部后移一位。
修复规则（对 123 与 test 全部行）：
  project_id 从当前列还原（已知每行真实 pid）；year=venue 列若是 4 位数字则取之；
  title=venue 列若为长文本；其余错位列重置——doi/url 从 unified 按 title 回查；abstract 置空。
"""
import csv
import html
import re
import sqlite3

DB = '/home/G2024hq/asv-app/autosurvey.db'
UR = '/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/normalized/unified_records.csv'

# unified 索引：norm(title) → (doi, url, year, venue, abstract)
idx = {}
with open(UR, encoding='utf-8-sig', newline='') as fh:
    for row in csv.DictReader(fh):
        t = html.unescape((row.get('title') or '')).strip()
        k = re.sub(r'[^a-z0-9]', '', t.lower())[:48]
        if k:
            idx[k] = (html.unescape((row.get('doi') or '')).strip(),
                      (row.get('url') or '').strip(),
                      (row.get('year') or '').strip(),
                      html.unescape((row.get('venue') or '')).strip()[:120],
                      (row.get('abstract') or '').strip()[:4000])

c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
rows = c.execute("SELECT id, project_id, doi, title, venue, year, url FROM corpus_papers").fetchall()
fixed = 0
for r in rows:
    title = (r['title'] or '').strip()
    # 已经正确的行：title 是长文本且 doi 是 10. 开头或空 → 跳过
    if title and (r['doi'].startswith('10.') or r['doi'] == '') and len(title) > 12 and not re.fullmatch(r'[0-9.]+', title):
        continue
    k = re.sub(r'[^a-z0-9]', '', title.lower())[:48]
    rec = idx.get(k)
    if not rec:
        # title 本身可能也是错的（title 列装的是 doi）——用 doi 列内容反查（里面是真 title? 不，
        # 错位时 doi←project_id。venue←title 才是真 title）
        k2 = re.sub(r'[^a-z0-9]', '', (r['venue'] or '').lower())[:48]
        rec = idx.get(k2)
    if not rec:
        continue
    doi, url, year, venue, abstract = rec
    c.execute("UPDATE corpus_papers SET doi=?, url=?, year=?, venue=?, abstract=? WHERE id=?",
              (doi, url, int(year) if year.isdigit() else None, venue, abstract, r['id']))
    fixed += 1
c.commit()
print(f'错位修复：{fixed} 行')

# 终检：全表 doi 列不得有 proj- 开头
bad = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE doi LIKE 'proj-%'").fetchone()[0]
print('错位残留:', bad)
