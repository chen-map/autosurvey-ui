# -*- coding: utf-8 -*-
"""最终对账（真相已明）：
- papers/ 目录 529 文件（186 PDF + 343 占位 txt）= 真实下载实况
- candidate 剩余 3800+ 行 title 是 unified 检索态、其中大量从未进入下载（download_ready 仅 500 行）
  → 它们本来就不是"下载失败"，是"未进入下载阶段"。status 语义修正：candidate（不标 failed）
- downloaded 25 vs papers/ 186 PDF：其余 161 PDF 属于"早期列表/回捞/人工"路径，record_id 桥未覆盖
  → 用 papers 文件名 slug 反查 corpus 行（slug 前缀匹配 title slug）标 downloaded
跑完统计，力求 downloaded ≈ 186。
"""
import html
import pathlib
import re
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
pdfs = {p.name.rsplit('.', 1)[0]: p.name for p in P.glob('*.pdf')}

# candidate/title-slug 匹配 0 的原因已明：downloaded 行的 title slug 命中了文件（它们是同一批），
# candidate 行的 title（unified 检索态）与文件名 slug 不同源——其文件名来自 download_ready 的编号。
# 正确桥：download_ready 的 record_id ↔ unified 行？无共同键。
# 改用模糊：papers 文件名（除数字头）slug → 与 candidate title slug 做包含匹配（双向）
files = {f: re.sub(r'^\d+_', '', f) for f in pdfs}  # stem=去数字头
n = 0
for rid, title in c.execute(
        "SELECT id, title FROM corpus_papers WHERE project_id='proj-1790652141048' AND status='candidate'").fetchall():
    s = re.sub(r'[^a-z0-9]+', '', html.unescape((title or '')).lower())[:30]
    if not s:
        continue
    m = [pdfs[f] for f, stem in files.items() if s in re.sub(r'[^a-z0-9]', '', stem)]
    if m:
        c.execute("UPDATE corpus_papers SET status='downloaded', pdf_path=? WHERE id=?",
                  ('papers/' + m[0], rid))
        n += 1
c.commit()
dl = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048' AND status='downloaded'").fetchone()[0]
print(f'模糊包含匹配补标 {n}，downloaded 总 {dl}（目标 ≈186 PDF）')
