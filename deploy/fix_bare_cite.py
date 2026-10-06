"""当前 tex 文件就地修：裸方括号引用 [3823\\_llmbased...] → \\cite{3823_llmbased...}（治溢出边框）。"""
import pathlib
import re

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections')
CMD = re.compile(r'\\(?:cite|ref|label)[^{}]*\{[^}]*\}')


def fix(s: str) -> str:
    stash: list[str] = []

    def keep(m):
        stash.append(m.group(0))
        return f'@@C{len(stash)-1}@@'

    s = CMD.sub(keep, s)

    def to_cite(m):
        return '\\cite{' + m.group(1).replace('\\_', '_') + '}'

    s = re.sub(r'\[(\d{4}(?:\\_|[A-Za-z0-9-]){8,})\]', to_cite, s)
    s = re.sub(r'\[(\d{3,4})\]', r'\\cite{\1}', s)
    for i, c in enumerate(stash):
        s = s.replace(f'@@C{i}@@', c)
    return s


for f in sorted(BASE.glob('*.tex')):
    orig = f.read_text(encoding='utf-8')
    new = fix(orig)
    if new != orig:
        f.write_text(new, encoding='utf-8')
        print('fixed:', f.name)
print('done')
