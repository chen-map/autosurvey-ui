# -*- coding: utf-8 -*-
"""引用闭环 v5（全局规则：宁少引，不假引）——就地修当前论文。

规则：
1. 禁键：paper_id / 纯数字键（\d{1,4}）——除非能在语料 structured 里唯一解析到完整 paper_id
2. 解析顺序：bib 精确 → bib 前缀唯一 → structured 前缀唯一
3. 解析失败 → 从正文剥离该引用（\cite 空则整条删除）——绝不造占位条目
4. bib 内垃圾条目（纯ID标题/paper_id/页眉）→ 解析则重建，否则删除
5. 终检：所有正文 cite 键 ∈ bib 且标题全部非垃圾，违规即报错退出
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
                st_meta[pid] = {'title': r.get('title') or '', 'year': r.get('year'),
                                'authors': r.get('authors') or []}
        except json.JSONDecodeError:
            pass
full_ids = sorted(st_meta)

def esc(t):
    return re.sub(r'([_%&#])', r'\\\1', t)

def bad_title(t):
    t = (t or '').replace('\\_', '_').replace('\\%', '%').replace('\\&', '&')
    return (not t or re.fullmatch(r'\d{1,4}', t) or re.match(r'^\d{4}_', t)
            or t.lower() in ('paper id', 'paper_id')
            or bool(re.search(r'(?i)under review|camera-ready|published as|preprint submitted', t)))

def resolve(k):
    """短键/任意键 → 唯一完整语料 id（structured 前缀唯一），否则 None。"""
    if k in st_meta:
        return k
    cands = [fid for fid in full_ids if fid.startswith(k)]
    return cands[0] if len(cands) == 1 else None

def build_entry(fid):
    meta = st_meta[fid]
    authors = [str(a).strip() for a in (meta['authors'] or []) if str(a).strip()][:4]
    return ('@misc{%s,\n  title = {%s},\n  author = {%s},\n  year = {%s},\n  note = {Preprint},\n}\n'
            ) % (fid, esc(meta['title'] or fid), ' and '.join(authors) or 'Anonymous', meta.get('year') or '')

entries = {}
for m in re.finditer(r'(@misc\{[^,]+,[\s\S]*?\n\})', BIB.read_text(encoding='utf-8')):
    entries[m.group(1).split('{', 1)[1].split(',', 1)[0]] = m.group(1)

# 禁键 = paper_id 残骸 + "非语料"纯数字键（语料里真实存在的数字 paper_id 合法——
# W1 早期下载命名就是纯 record_id，标题/作者真实即可核查；审稿人误判源于双命名并存）
FORBIDDEN = re.compile(r'^paper_id$', re.I)

def is_forbidden(k):
    if k.lower() == 'paper_id':
        return True
    if re.fullmatch(r'\d{1,4}', k):
        return k not in st_meta  # 不在语料的数字键 = 幻影引用
    return False

# ---- bib 重建 ----
new_entries: dict[str, str] = {}
rename: dict[str, str] = {}
drop: set = set()
for k, ent in entries.items():
    mt = re.search(r'title\s*=\s*\{(.+?)\}', ent, re.S)
    raw_t = (mt.group(1) if mt else '')
    garbage = is_forbidden(k) or bad_title(raw_t)
    if not garbage and k in st_meta:
        new_entries[k] = ent
        continue
    fid = resolve(k)
    if fid:
        new_entries[fid] = build_entry(fid)
        if fid != k:
            rename[k] = fid
    else:
        drop.add(k)  # 无法解析 → 删条目（正文同步剥引用）

# ---- 正文重写 ----
strip_total = 0
for f in sorted(SEC.glob('*.tex')):
    s = f.read_text(encoding='utf-8')

    def repl(m):
        global strip_total
        keys = []
        for k in m.group(1).split(','):
            kk = k.strip()
            kk = rename.get(kk, kk)
            if is_forbidden(kk) and kk not in new_entries:
                strip_total += 1
                continue  # 假引 → 剥离
            if kk in drop:
                strip_total += 1
                continue
            if kk and kk not in keys and kk in new_entries:
                keys.append(kk)
            elif kk and kk not in keys and kk not in new_entries:
                strip_total += 1  # 键不在 bib（悬空）→ 剥离
                continue
        return '\\cite{' + ','.join(keys) + '}' if keys else ''

    s2 = re.sub(r'\\cite\{([^}]*)\}', repl, s)
    s2 = re.sub(r'\n\s*\n\s*\n+', '\n\n', s2)  # 清剥离后的空行堆积
    if s2 != s:
        f.write_text(s2, encoding='utf-8')

with BIB.open('w', encoding='utf-8') as fh:
    for k, ent in new_entries.items():
        fh.write(ent + '\n')

# ---- 终检（违规即失败，不静默产出垃圾）----
errors = []
bib_now = BIB.read_text(encoding='utf-8')
for m in re.finditer(r'@misc\{([^,]+),[\s\S]*?\n\}', bib_now):
    k = m.group(1)
    t = re.search(r'title\s*=\s*\{(.+?)\}', m.group(0))
    tv = (t.group(1) if t else '').replace('\\_', '_')
    if is_forbidden(k) or bad_title(tv):
        errors.append(f'垃圾条目残留: {k} / {tv[:40]}')
cited = set()
for f in SEC.glob('*.tex'):
    for m in re.finditer(r'\\cite\{([^}]*)\}', f.read_text(encoding='utf-8')):
        for k in m.group(1).split(','):
            if k.strip():
                cited.add(k.strip())
for k in sorted(cited):
    if k not in new_entries:
        errors.append(f'悬空引用: {k}')
if errors:
    print('终检失败:')
    for e_ in errors[:10]:
        print(' ', e_)
    raise SystemExit(1)
print(f'闭环 v5：bib {len(entries)}→{len(new_entries)} | 改键 {len(rename)} | 剥假引 {strip_total} | 悬空 0 | 终检通过')
