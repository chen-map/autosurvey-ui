import pathlib
import re

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections')
CMD = re.compile(r'\\(?:cite|ref|label)[^{}]*\{[^}]*\}')
for f in sorted(BASE.glob('*.tex')):
    s = f.read_text(encoding='utf-8')
    orig = s
    stash: list[str] = []
    def keep(m):
        stash.append(m.group(0))
        return f'@@C{len(stash)-1}@@'
    s = CMD.sub(keep, s)
    s = re.sub(r'(?<!\\)\^', r'\\^{}', s)
    s = re.sub(r'(?<!\\)~', r'\\textasciitilde{}', s)
    for i, c in enumerate(stash):
        s = s.replace(f'@@C{i}@@', c)
    if s != orig:
        f.write_text(s, encoding='utf-8')
        print('fixed:', f.name)
print('done')
