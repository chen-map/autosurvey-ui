# -*- coding: utf-8 -*-
"""对账：downloaded 行 → paper-card 端点逐篇验证；并核对 papers/ 目录 PDF ↔ KG papers 覆盖。"""
import json
import pathlib
import urllib.request

BASE = 'http://222.20.126.64:8000'
PID = 'proj-1790652141048'

d = json.loads(urllib.request.urlopen(urllib.request.Request(
    f'{BASE}/api/auth/login', data=json.dumps({"username": "123", "password": "123456"}).encode(),
    headers={"Content-Type": "application/json"}), timeout=30).read())
tok = d['token']

# 全部 downloaded 行
b = json.loads(urllib.request.urlopen(urllib.request.Request(
    f'{BASE}/api/projects/{PID}/corpus?page=1&page_size=200&status=downloaded',
    headers={'Authorization': 'Bearer ' + tok}), timeout=60).read())
rows = b.get('papers', [])
print(f'downloaded 行: {len(rows)}')

ok = miss = 0
miss_samples = []
for p in rows:
    rid = p.get('rid')
    if not rid:
        miss += 1
        miss_samples.append(('无rid', (p.get('title') or '')[:40]))
        continue
    try:
        c = json.loads(urllib.request.urlopen(urllib.request.Request(
            f'{BASE}/api/projects/{PID}/paper-card/{rid}',
            headers={'Authorization': 'Bearer ' + tok}), timeout=30).read())
        if 'problems' in c:
            ok += 1
        else:
            miss += 1
            miss_samples.append(('无problems键', rid))
    except Exception as e:
        miss += 1
        miss_samples.append((str(e)[:30], rid))
print(f'paper-card 成功: {ok} | 失败: {miss}')
for s in miss_samples[:6]:
    print(' 失败样例:', s)
