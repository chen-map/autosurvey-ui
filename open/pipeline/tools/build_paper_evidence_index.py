"""把每篇论文的 evidence 引文定位回 PDF 原文，输出页码 + 高亮截图。

用法:
    python build_paper_evidence_index.py <project_dir> [--crops-dir 名称]

输出:
    <project_dir>/w1/working_memory/paper_evidence_index.jsonl
    <project_dir>/w1/working_memory/evidence_crops/<paper_id>__<n>.png
"""
import json, glob, os, re, sys, ast, difflib
from collections import defaultdict

import fitz


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def clean_quote(raw):
    """evidence 混用 dict-repr / 裸字符串，且键名不统一（text、description…）。"""
    s = str(raw).strip()
    if s.startswith("{"):
        try:
            d = ast.literal_eval(s)
            if isinstance(d, dict):
                for k in ("text", "quote", "description", "evidence"):
                    if isinstance(d.get(k), str):
                        return d[k]
                vals = [v for v in d.values() if isinstance(v, str)]
                if vals:
                    return max(vals, key=len)
        except Exception:
            m = re.search(r":\s*'(.*)',\s*'(?:confidence|score)'", s, re.S)
            if m:
                return m.group(1)
    return s


def load_evidence(path):
    out = defaultdict(list)
    for line in open(path, encoding="utf-8"):
        if not line.strip():
            continue
        r = json.loads(line)
        for e in (r.get("evidence") or []):
            t = norm(clean_quote(e).strip().strip("'\""))
            if len(t) >= 40:
                out[r["paper_id"]].append(t)
    return out


def toks(s):
    return [t for t in (re.sub(r"[^a-z0-9]", "", w.lower()) for w in s.split()) if t]


def page_tokens(page):
    words = page.get_text("words")   # x0,y0,x1,y1,word,...
    tk, rc = [], []
    for w in words:
        t = re.sub(r"[^a-z0-9]", "", w[4].lower())
        tk.append(t)
        rc.append(fitz.Rect(w[0], w[1], w[2], w[3]))
    return tk, rc


def find_quote(doc, quote):
    """词级对齐定位：只标该句真正出现的位置，跨行/连字符也能覆盖整句。"""
    qt = toks(quote)
    if len(qt) < 5:
        return 0, []
    for page in doc:
        tk, rc = page_tokens(page)
        if len(tk) < 5:
            continue
        sm = difflib.SequenceMatcher(None, tk, qt, autojunk=False)
        blocks = [b for b in sm.get_matching_blocks() if b.size >= 2]
        if not blocks:
            continue
        # 把位置相近的匹配块聚成一簇，取覆盖最多的那簇
        groups, cur = [], [blocks[0]]
        for b in blocks[1:]:
            if b.a - (cur[-1].a + cur[-1].size) <= 8:
                cur.append(b)
            else:
                groups.append(cur)
                cur = [b]
        groups.append(cur)
        best = max(groups, key=lambda g: sum(b.size for b in g))
        covered = sum(b.size for b in best)
        if covered < max(6, int(0.6 * len(qt))):
            continue
        idx = [i for b in best for i in range(b.a, b.a + b.size) if tk[i]]
        if not idx:
            continue
        xs0 = min(rc[i].x0 for i in idx)
        ys0 = min(rc[i].y0 for i in idx)
        xs1 = max(rc[i].x1 for i in idx)
        ys1 = max(rc[i].y1 for i in idx)
        return page.number + 1, [fitz.Rect(xs0, ys0, xs1, ys1)]
    return 0, []


def render(page, rects, out_png):
    page_h, page_w = page.rect.height, page.rect.width
    if rects:
        y0 = max(0, min(r.y0 for r in rects) - 55)
        y1 = min(page_h, max(r.y1 for r in rects) + 55)
        clip = fitz.Rect(0, y0, page_w, y1)
    else:
        clip = page.rect
    for r in rects:
        page.add_highlight_annot(r)
    pix = page.get_pixmap(clip=clip, matrix=fitz.Matrix(3, 3))
    pix.save(out_png)


def main(project_dir):
    w1 = os.path.join(project_dir, "w1")
    evidence = load_evidence(os.path.join(w1, "knowledge_graph", "structured_papers.jsonl"))

    cards = {}
    for f in glob.glob(os.path.join(w1, "paper_cards", "parsed", "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        cards[d["paper_id"]] = d

    out_dir = os.path.join(w1, "working_memory")
    crops = os.path.join(out_dir, "evidence_crops")
    os.makedirs(crops, exist_ok=True)

    rows = []
    total = located = with_rect = no_pdf = 0
    doc_cache = {}
    for pid, quotes in evidence.items():
        card = cards.get(pid) or {}
        rel = card.get("local_path") or ""
        pdf = rel if os.path.isabs(rel) else os.path.join(w1, rel)
        if not rel or not os.path.exists(pdf):
            no_pdf += len(quotes)
            for q in quotes:
                rows.append({"paper_id": pid, "title": card.get("title", ""), "quote": q,
                             "page": 0, "image": "", "ok": False, "reason": "no_pdf"})
            continue
        doc = doc_cache.get(pdf)
        if doc is None:
            doc = doc_cache[pdf] = fitz.open(pdf)
        for i, q in enumerate(quotes):
            total += 1
            page_no, rects = find_quote(doc, q)
            row = {"paper_id": pid, "title": card.get("title", ""), "quote": q,
                   "page": page_no, "image": "", "ok": page_no > 0,
                   "reason": "" if page_no else "not_found"}
            if page_no:
                located += 1
                page = doc[page_no - 1]
                png = os.path.join(crops, f"{pid[:40]}__{i}.png")
                render(page, rects, png)
                row["image"] = os.path.relpath(png, w1).replace("\\", "/")
                with_rect += 1 if rects else 0
            rows.append(row)

    with open(os.path.join(out_dir, "paper_evidence_index.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"引文 {total} 条 | 定位到页码 {located} ({100*located/max(1,total):.1f}%) "
          f"| 有高亮框 {with_rect} | 缺 PDF {no_pdf}")
    for r in rows:
        if 0 < 3 and r["ok"]:
            print(f"  示例 {r['paper_id'][:28]} p{r['page']} -> {r['image']}")
            break


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
