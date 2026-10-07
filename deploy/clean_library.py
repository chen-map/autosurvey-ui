# -*- coding: utf-8 -*-
"""存量知识库清洗：lib-c-NaN 重复条目按标题指纹去重（每组保留一条，补 fp 字段）。"""
import json
import re
import sqlite3

DB = '/home/G2024hq/asv-app/autosurvey.db'

def norm(t):
    return re.sub(r'[^a-z0-9一-鿿]+', '', (t or '').lower())[:60]

def fp(item):
    y = item.get('year')
    return norm(item.get('title')) + '|' + str(y or '')

c = sqlite3.connect(DB)
row = c.execute("SELECT v FROM user_kv WHERE user_id=3 AND k='library'").fetchone()
if not row:
    print('123 无 library KV')
    raise SystemExit
d = json.loads(row[0])
items = d.get('items', [])
seen: dict = {}
out = []
removed = 0
for it in items:
    key = fp(it)
    if key in seen:
        removed += 1
        continue
    seen[key] = it
    it['fp'] = key
    if str(it.get('key', '')).startswith('lib-c-NaN') or 'paperIdx' in it and it.get('paperIdx') is None:
        it['key'] = 'lib-f-' + key[:24]
    out.append(it)
d['items'] = out
c.execute("UPDATE user_kv SET v=? WHERE user_id=3 AND k='library'", (json.dumps(d, ensure_ascii=False),))
c.commit()
print(f'清洗：{len(items)} → {len(out)}（删 {removed} 条重复）')
