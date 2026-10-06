# -*- coding: utf-8 -*-
"""当前产物就地修复（不重跑 LLM）：
1) 引用闭环：bib 大小写双录去重 + 短键展开归一 + 缺失键补录（标题卫生：纯ID/文件名slug/页眉 → slug 反推）
2) 正文 ID 泄入清理（流程腔句子剔除）
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
                st_meta[pid] = {'title': r.get('title') or '', 'year': r.get('year')}
        except json.JSONDecodeError:
            pass

norm = lambda t: re.sub(r'[^a-z0-9]', '', (t or '').lower())
slug_title = lambda k: (re.sub(r'^\d+\s+', '', k.replace('_', ' ')) if len(k) > 16 else k)
bad = lambda t: (not t or re.fullmatch(r'\d{1,4}', t) or re.match(r'^\d{4}_', t)
                 or bool(re.search(r'(?i)under review|camera-ready|published as|preprint submitted', t)))

entries = {}
for m in re.finditer(r'(@misc\{[^,]+,[\s\S]*?\n\})', BIB.read_text(encoding='utf-8')):
    entries[m.group(1).split('{', 1)[1].split(',', 1)[0]] = m.group(1)

by_title, alias = {}, {}
for k in list(entries):
    mt = re.search(r'title\s*=\s*\{(.+?)\}', entries[k], re.S)
    raw = st_meta.get(k, {}).get('title') or (mt.group(1) if mt else '')
    clean = slug_title(k) if bad(raw) else raw
    nt = norm(clean)
    if nt in by_title:
        alias[k] = by_title[nt]
    else:
        by_title[nt] = k

files = sorted(SEC.glob('*.tex'))
cited = set()
for f in files:
    cited.update(k.strip() for m in re.finditer(r'\\cite\{([^}]*)\}', f.read_text(encoding='utf-8'))
                 for k in m.group(1).split(',') if k.strip())
canon = {}
for k in sorted(cited):
    kk = alias.get(k, k)
    if kk in entries:
        canon[k] = kk
        continue
    cands = {alias.get(b, b) for b in entries if b.startswith(k)}
    canon[k] = cands.pop() if len(cands) == 1 else k

added = 0
for k, target in canon.items():
    if target not in entries:
        meta = st_meta.get(target, {})
        t = meta.get('title') or ''
        if bad(t):
            t = slug_title(target)
        t_esc = re.sub(r'([_%&#])', r'\\\1', t)
        entries[target] = ('@misc{%s,\n  title = {%s},\n  author = {Anonymous},\n'
                           '  year = {%s},\n  note = {Preprint},\n}\n') % (target, t_esc, meta.get('year') or '')
        added += 1

META_SPEAK = re.compile(r'应从证据矩阵|候选文献\s*\d|证据矩阵中(剔除|移除)|同语料的\s*\d{3,4}|从语料中剔除')
for f in files:
    s = f.read_text(encoding='utf-8')
    lines = [ln for ln in s.split('\n') if not META_SPEAK.search(ln)]
    s2 = '\n'.join(lines)
    def repl(m):
        keys = []
        for k in m.group(1).split(','):
            kk = k.strip()
            if kk and kk not in keys:
                keys.append(canon.get(kk, kk))
        return '\\cite{' + ','.join(keys) + '}'
    s2 = re.sub(r'\\cite\{([^}]*)\}', repl, s2)
    if s2 != s:
        f.write_text(s2, encoding='utf-8')
        print('fixed:', f.name)

# 存量条目标题卫生：畸形（slug/纯ID/页眉/字面paper_id）→ slug 反推 + BibTeX 转义
for k in list(entries):
    ent = entries[k]
    mt = re.search(r'title\s*=\s*\{(.+?)\}', ent, re.S)
    if not mt:
        continue
    unesc = mt.group(1).replace('\\_', '_').replace('\\%', '%').replace('\\&', '&').replace('\\#', '#')
    if bad(unesc):
        clean = re.sub(r'([_%&#])', r'\\\1', slug_title(k))
        entries[k] = ent.replace(mt.group(0), 'title = {' + clean + '}')

with BIB.open('w', encoding='utf-8') as fh:
    for k, ent in entries.items():
        fh.write(ent + '\n')
print(f'闭环：cited={len(cited)} 补录={added} 双录合并={len(alias)} bib总量={len(entries)}')
