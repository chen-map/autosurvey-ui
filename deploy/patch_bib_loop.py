# -*- coding: utf-8 -*-
"""P3 加引用闭环：bib 去重（大小写双录）+ 短键展开归一 + 缺失键补录（标题卫生）。
修审稿三类 soundness：[?] 未解析（29 处）、72vs186 去向、畸形条目（页眉/ID/文件名当标题）。"""
import ast

P = 'backend/w5/llm_sections.py'
s = open(P, encoding='utf-8').read()

OLD = r'''    # 引用键扩展：LLM 常写短键（如 2049），bib 键为完整 paper_id——前缀唯一匹配展开
    bib_path = sections_dir.parent / "references.bib"
    if bib_path.exists():
        bib_keys = re.findall(r"@misc\{([^,]+),", bib_path.read_text(encoding="utf-8"))

        def expand(mo: re.Match) -> str:
            keys = [k.strip() for k in mo.group(1).split(",")]
            out_keys = []
            for k in keys:
                if k in bib_keys:
                    out_keys.append(k)
                    continue
                cands = [bk for bk in bib_keys if bk.startswith(k)]
                out_keys.append(cands[0] if len(cands) == 1 else k)
            return "\\cite{" + ",".join(out_keys) + "}"

        for sec in manifest["sections"]:
            f = sections_dir / sec
            f.write_text(re.sub(r"\\cite\{([^}]*)\}", expand, f.read_text(encoding="utf-8")), encoding="utf-8")'''

NEW = r'''    # ==== 引用闭环（修 [?] 未解析 / 双重著录 / 畸形标题）====
    bib_path = sections_dir.parent / "references.bib"
    structured_path = Path(args.staging) / "knowledge_graph" / "structured_papers.jsonl"

    def _norm_title(t: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (t or "").lower())

    def _slug_to_title(key: str) -> str:
        body = re.sub(r"^\d+\s+", "", key.replace("_", " "))
        return body if len(body) > 12 else key

    def _bad_title(t: str) -> bool:
        return (not t or re.fullmatch(r"\d{1,4}", t) or re.match(r"^\d{4}_", t)
                or bool(re.search(r"(?i)under review|camera-ready|published as|preprint submitted", t)))

    bib_entries: dict[str, str] = {}
    if bib_path.exists():
        for m in re.finditer(r"(@misc\{[^,]+,[\s\S]*?\n\})", bib_path.read_text(encoding="utf-8")):
            bib_entries[m.group(1).split("{", 1)[1].split(",", 1)[0]] = m.group(1)
    st_meta: dict[str, dict] = {}
    if structured_path.exists():
        for line in structured_path.read_text(encoding="utf-8").splitlines():
            try:
                r_ = json.loads(line)
                pid = str(r_.get("paper_id") or "")
                if pid:
                    st_meta[pid] = {"title": r_.get("title") or "", "year": r_.get("year")}
            except json.JSONDecodeError:
                continue
    # 1) bib 按归一标题去重（大小写变体双录）→ alias 到保留键
    by_title: dict[str, str] = {}
    alias: dict[str, str] = {}
    for k in list(bib_entries):
        mt = re.search(r"title\s*=\s*\{(.+?)\}", bib_entries[k], re.S)
        raw_t = st_meta.get(k, {}).get("title") or (mt.group(1) if mt else "")
        clean_t = _slug_to_title(k) if _bad_title(raw_t) else raw_t
        nt = _norm_title(clean_t)
        if nt in by_title:
            alias[k] = by_title[nt]
        else:
            by_title[nt] = k
    # 2) 正文引用键 → 展开/归一
    sec_files = sorted(set(sections_dir.glob("*.tex")) - {sections_dir / "0_abstract.tex"})
    cited: set = set()
    for f in sec_files:
        cited.update(k.strip() for m in re.finditer(r"\\cite\{([^}]*)\}", f.read_text(encoding="utf-8"))
                     for k in m.group(1).split(",") if k.strip())
    canon: dict[str, str] = {}
    for k in sorted(cited):
        kk = alias.get(k, k)
        if kk in bib_entries:
            canon[k] = kk
            continue
        cands = {alias.get(bk, bk) for bk in bib_entries if bk.startswith(k)}
        canon[k] = cands.pop() if len(cands) == 1 else k
    # 3) 缺失键补录 @misc（标题卫生：structured 脏则 slug 反推）
    added = 0
    for k, target in canon.items():
        if target not in bib_entries:
            meta = st_meta.get(target, {})
            title = meta.get("title") or ""
            if _bad_title(title):
                title = _slug_to_title(target)
            bib_entries[target] = ("@misc{%s,\n  title = {%s},\n  author = {Anonymous},\n"
                                   "  year = {%s},\n  note = {Preprint},\n}\n") % (target, title, meta.get("year") or "")
            added += 1
    # 4) 重写正文键与 bib
    for f in sec_files:
        s_ = f.read_text(encoding="utf-8")

        def _repl(mo: re.Match) -> str:
            keys: list = []
            for k in mo.group(1).split(","):
                kk = k.strip()
                if kk and kk not in keys:
                    keys.append(canon.get(kk, kk))
            return "\\cite{" + ",".join(keys) + "}"

        s2 = re.sub(r"\\cite\{([^}]*)\}", _repl, s_)
        if s2 != s_:
            f.write_text(s2, encoding="utf-8")
    with bib_path.open("w", encoding="utf-8") as fh:
        for k, ent in bib_entries.items():
            fh.write(ent + "\n")
    print(f"[llm_sections] 引用闭环：正文键 {len(cited)}，补录 {added}，双录合并 {len(alias)}，bib 共 {len(bib_entries)}", flush=True)'''

assert s.count(OLD) == 1, 'anchor'
s = s.replace(OLD, NEW)
open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('bib 闭环补丁 OK')
