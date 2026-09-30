import pathlib
import re

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper')
PAT = re.compile(r'R\\+R?\\*&D+')   # R&D / R\&D / R\R\&DD 等一切畸形变体
for tex in (BASE / 'sections').glob('*.tex'):
    s = tex.read_text(encoding='utf-8')
    orig = s
    s = PAT.sub(r'R\\&D', s)
    s = re.sub(r'(?<!\\)&', r'\\&', s)   # 其余裸 & 全转（无表格环境）
    if s != orig:
        tex.write_text(s, encoding='utf-8')
        print('fixed:', tex.name)
print('done')
