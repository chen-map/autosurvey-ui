"""就地修：给丢 \section 的章节文件补标准标题（发表级章节体系）。"""
import pathlib

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections')
TITLES = {
    '1_introduction.tex': '\\section{Introduction}\n',
    '2_literature_review.tex': '\\section{Related Work}\n',
    '3_method.tex': '\\section{Survey Methodology}\n',
    '9_contribution.tex': '\\section{Discussion}\n',
    '10_future_research.tex': '\\section{Future Research}\n',
    '11_limitation.tex': '\\section{Limitations}\n',
}
for fname, sec in TITLES.items():
    f = BASE / fname
    if not f.exists():
        continue
    s = f.read_text(encoding='utf-8').lstrip()
    if s.startswith('\\section'):
        print('已有标题，跳过:', fname)
        continue
    f.write_text(sec + s, encoding='utf-8')
    print('补标题:', fname, '->', sec.strip())
print('done')
