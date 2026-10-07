# -*- coding: utf-8 -*-
"""bib 根治：
1) 短键/纯ID条目 → 在 structured_papers 全量 paper_id 里解析出完整键，取真实 title/authors/year；
2) 所有 Anonymous 条目回填 structured 的真实作者与年份；
3) 正文 cite 键同步重写（短键 → 完整键）；
4) 仍无法解析的条目 → 从 bib 删除并同步删正文对应 cite（宁可少引不可垃圾引）。
"""
import json
import pathlib
import re

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper')
SEC = BASE / 'sections'
BIB = BASE / 'references.bib'
ST = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/w5_workspace/knowledge_graph/structured_papers.jsonl')

st_meta = {}
if ST.exists():
    for line in ST.read_text(encoding='utf-8').splitlines():
        try:
            r = json.loads(line)
            pid = str(r.get('paper_id') or '')
            if pid:
                st_meta[pid] = {
                    'title': r.get('title') or '',
                    'year': r.get('year'),
                    'authors': r.get('authors') or [],
                }
        except json.JSONDecodeError:
            pass

entries = {}
for m in re.finditer(r'(@misc\{[^,]+,[\s\S]*?\n\})', BIB.read_text(encoding='utf-8')):
    entries[m.group(1).split('{', 1)[1].split(',', 1)[0]] = m.group(1)

def esc(t):
    return re.sub(r'([_%&#])', r'\\\1', t)

def authors_str(authors):
    a = [str(x).strip() for x in authors if str(x).strip()][:4]
    return ' and '.join(a) if a else 'Anonymous'

# 前缀索引：短键 → 全键（structured）
full_ids = sorted(st_meta)

def resolve_full(k):
    if k in st_meta:
        return k
    cands = [fid for fid in full_ids if fid.startswith(k)]
    return cands[0] if len(cands) == 1 else None

def build_entry(fid):
    meta = st_meta[fid]
    t = meta['title'] or fid
    return ('@misc{%s,\n  title = {%s},\n  author = {%s},\n'
            '  year = {%s},\n  note = {Preprint},\n}\n') % (fid, esc(t), authors_str(meta['authors']), meta.get('year') or '')

# 1) 逐条目修复
new_entries: dict[str, str] = {}
rename: dict[str, str] = {}   # 旧键（正文中的）→ 新键
drop: set = set()
for k, ent in entries.items():
    mt = re.search(r'title\s*=\s*\{(.+?)\}', ent, re.S)
    raw_t = (mt.group(1) if mt else '').replace('\\_', '_').replace('\\%', '%')
    is_garbage = (re.fullmatch(r'\d{1,4}', raw_t) or raw_t == 'paper_id'
                  or re.match(r'^\d{4}_', raw_t)
                  or re.search(r'(?i)under review|camera-ready|published as|preprint submitted', raw_t))
    fid = resolve_full(k)
    if fid is None and not is_garbage:
        new_entries[k] = ent  # 正常条目保留
        continue
    if fid is None:
        # 键无法解析到语料 → 垃圾条目，待删
        drop.add(k)
        continue
    # 解析成功 → 用完整键重建真实条目
    new_entries[fid] = build_entry(fid)
    if k != fid:
        rename[k] = fid

# 2) 正文 cite 键重写 + 剔除指向已删条目的引用
files = sorted(SEC.glob('*.tex'))
removed_cites = 0
for f in files:
    s = f.read_text(encoding='utf-8')
    def repl(m):
        global removed_cites
        keys = []
        for k in m.group(1).split(','):
            kk = k.strip()
            kk = rename.get(kk, kk)
            if kk in drop:
                removed_cites += 1
                continue
            if kk and kk not in keys:
                keys.append(kk)
        return '\\cite{' + ','.join(keys) + '}'
    s2 = re.sub(r'\\cite\{([^}]*)\}', repl, s)
    s2 = re.sub(r'\\cite\{\}', '', s2)
    if s2 != s:
        f.write_text(s2, encoding='utf-8')

with BIB.open('w', encoding='utf-8') as fh:
    for k, ent in new_entries.items():
        fh.write(ent + '\n')

anon_left = sum(1 for e in new_entries.values() if 'author = {Anonymous}' in e)
print(f'bib 重建：{len(entries)} → {len(new_entries)} 条 | 改键 {len(rename)} | 删垃圾 {len(drop)} | 残留 Anonymous {anon_left}')
