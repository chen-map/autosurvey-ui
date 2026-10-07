"""根因检测：papers/ 的 .runtime 隐藏目录 + downloaded 的 25 个是哪些文件。
candidate 行的 title 是干净的（'Weaponizing Technical Intelligence'），slug 应能匹配
papers 文件名——除非它们对应的文件根本不存在（这批论文在 download 阶段失败）。
结论方向：25 个 downloaded = download_ready 里有 PDF 的；candidate 的 title-slug 匹配 0
说明这批 title 对应的文件名可能带额外前后缀。抽 3 个 candidate 逐一比对全部文件名。"""
import html
import pathlib
import re
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/papers')
files = [p.name for p in P.glob('*') if p.suffix in ('.pdf', '.txt')]
slug = lambda t: re.sub(r'[^a-z0-9]+', '_', html.unescape((t or '')).lower())[:40].strip('_')

rows = c.execute("SELECT id, title FROM corpus_papers WHERE status='candidate' LIMIT 3").fetchall()
for rid, t in rows:
    s = slug(t)
    # 全文件名找包含关系
    contains = [f for f in files if s[:20] in f]
    print('candidate:', (t or '')[:50])
    print('  slug[:20]:', s[:20], '| 文件名包含者:', contains[:2] if contains else '无')

# 反向：抽一个已下载文件名，看对应 corpus 行 title
dl = c.execute("SELECT title FROM corpus_papers WHERE status='downloaded' LIMIT 2").fetchall()
for (t,) in dl:
    s = slug(t)
    m = [f for f in files if s[:20] in f]
    print('downloaded:', t[:50], '-> 文件存在:', bool(m))
