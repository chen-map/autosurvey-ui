"""修 bib 'title = {paper_id}' 残骸条目（键即数据：slug 反推标题）+ 重编译。"""
import pathlib
import re

BIB = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/references.bib')
s = BIB.read_text(encoding='utf-8')
orig = s
for m in re.finditer(r'(@misc\{([^,]+),[\s\S]*?\n\})', s):
    ent, key = m.group(1), m.group(2)
    if re.search(r'title\s*=\s*\{paper_id\}', ent):
        body = re.sub(r'^\d+\s+', '', key.replace('_', ' '))
        new_ent = ent.replace('title = {paper_id}', 'title = {' + body + '}')
        s = s.replace(ent, new_ent)
        print('fixed paper_id entry:', key[:50])
if s != orig:
    BIB.write_text(s, encoding='utf-8')
print('done')
