# -*- coding: utf-8 -*-
"""llm_sections 引用闭环升级 v5（index 切片法，避开字面转义）。"""
import ast

P = 'backend/w5/llm_sections.py'
s = open(P, encoding='utf-8').read()

# ---- 定位三大段边界 ----
i_canon = s.index('    canon: dict[str, str] = {}')
i_canon_end = s.index('    # 3) 缺失键补录')
i_repl_start = s.index('    # 4) 重写正文键与 bib')
i_repl_end = s.index('    Path(args.out_manifest).parent.mkdir')

# 旧 canon 块（含 structured 解析缺失）
NEW_CANON = '''    canon: dict[str, str] = {}
    for k in sorted(cited):
        kk = alias.get(k, k)
        if kk in bib_entries:
            canon[k] = kk
            continue
        cands = {alias.get(bk, bk) for bk in bib_entries if bk.startswith(k)}
        if len(cands) == 1:
            canon[k] = cands.pop()
            continue
        # bib 无解 → structured 语料前缀唯一解析（真实语料 id，含数字命名）
        s_cands = [fid for fid in st_full_ids if fid.startswith(k)]
        if len(s_cands) == 1:
            canon[k] = s_cands[0]
        else:
            canon[k] = None  # 不可解析 → 剥离（宁少引，不假引）

'''
s = s[:i_canon] + NEW_CANON + s[i_canon_end:]

# 重新定位（上文插入改变了偏移）
i_c = s.index('# 3) 缺失键补录')
i_r = s.index('# 4) 重写正文键与 bib')

NEW_STEP3 = '''# 3) 缺失键处理（v5 规则：宁少引，不假引）——仅真实语料键可补录；禁键/脏标题 → 剥离
    added = 0
    stripped: set = set()
    for k, target in list(canon.items()):
        if target is None or target.lower() == "paper_id":
            stripped.add(k)
            continue
        if target in bib_entries:
            continue
        meta = st_meta.get(target, {})
        title = meta.get("title") or ""
        if _bad_title(title):
            stripped.add(k)  # 语料标题脏且无法回填 → 剥离，不造标题
            continue
        title_esc = re.sub(r"([_%&#])", r"\\\\1", title)  # BibTeX 特殊字符转义
        authors = [str(a).strip() for a in (meta.get("authors") or []) if str(a).strip()][:4]
        bib_entries[target] = ("@misc{%s,\\n  title = {%s},\\n  author = {%s},\\n"
                               "  year = {%s},\\n  note = {Preprint},\\n}\\n") % (
            target, title_esc, " and ".join(authors) or "Anonymous", meta.get("year") or "")
        added += 1

'''
s = s[:i_c] + NEW_STEP3 + s[i_r:]

i_c2 = s.index('# 4) 重写正文键与 bib')
i_e2 = s.index('    Path(args.out_manifest).parent.mkdir')

NEW_REPL = '''# 4) 重写正文键与 bib（剥离键从正文消失，空 cite 删除）
    for f in sec_files:
        s_ = f.read_text(encoding="utf-8")

        def _repl(mo: re.Match) -> str:
            keys: list = []
            for k in mo.group(1).split(","):
                kk = k.strip()
                target = canon.get(kk, kk)
                if target is None or kk in stripped:
                    continue  # 假引剥离
                if target and target not in keys:
                    keys.append(target)
            return "\\\\cite{" + ",".join(keys) + "}" if keys else ""

        s2 = re.sub(r"\\\\cite\\{([^}]*)\\}", _repl, s_)
        s2 = re.sub(r"\\n\\s*\\n\\s*\\n+", "\\n\\n", s2)
        if s2 != s_:
            f.write_text(s2, encoding="utf-8")
    print(f"[llm_sections] 引用闭环 v5：正文键 {len(cited)}，补录 {added}，剥离 {len(stripped)}，双录合并 {len(alias)}，bib 共 {len(bib_entries)}", flush=True)

    # 终检（硬失败）：正文 cite ⊆ bib、bib 无垃圾标题——违规退出码 1，不静默产出假引
    errors: list = []
    for k in sorted(cited):
        tgt = canon.get(k, k)
        if tgt is None or (tgt not in bib_entries and k not in stripped):
            errors.append(f"悬空引用 {k}")
    for bk, ent in bib_entries.items():
        mt2 = re.search(r"title\\s*=\\s*\\{(.+?)\\}", ent, re.S)
        tv = (mt2.group(1) if mt2 else "").replace("\\\\_", "_")
        if _bad_title(tv):
            errors.append(f"垃圾条目 {bk}: {tv[:40]}")
    if errors:
        for e_ in errors[:10]:
            print(f"[llm_sections] 终检失败: {e_}", flush=True)
        raise SystemExit(1)

'''
s = s[:i_c2] + NEW_REPL + s[i_e2:]

# st_full_ids 加载（在 bib_entries 前插入）
old_ids = '    bib_entries: dict[str, str] = {}'
if 'st_full_ids' not in s:
    s = s.replace(old_ids, '    st_full_ids: list = sorted(st_meta)\n' + old_ids, 1)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('llm_sections v5 OK')
