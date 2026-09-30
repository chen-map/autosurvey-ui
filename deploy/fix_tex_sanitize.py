# -*- coding: utf-8 -*-
"""LaTeX 输出净化（LLM 正文常见炸弹）：
- Unicode 数学符号 → LaTeX 数学模式（≈ ≥ ≤ × → ± etc.）
- 裸 & % # _ 转义——但先 stash \\cite/\\ref/\\label/\\url 参数（键里的 _ 不能动）
对 survey_paper/sections/*.tex 就地修复。
"""
import pathlib
import re

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/sections')

CMD_RE = re.compile(r'\\(?:cite|ref|label|url|includegraphics|input)(?:\[[^\]]*\])?\{[^}]*\}')
UNI_MAP = {
    '≈': r'$\approx$', '≥': r'$\geq$', '≤': r'$\leq$', '×': r'$\times$',
    '→': r'$\rightarrow$', '←': r'$\leftarrow$', '↔': r'$\leftrightarrow$',
    '±': r'$\pm$', '·': r'$\\cdot$', 'α': r'$\alpha$', 'β': r'$\beta$',
    'γ': r'$\gamma$', 'δ': r'$\delta$', 'λ': r'$\lambda$', 'μ': r'$\mu$',
    'σ': r'$\sigma$', 'π': r'$\pi$', '∞': r'$\infty$', '∑': r'$\sum$',
    '√': r'$\sqrt{}$', '≠': r'$\neq$', '—': '---', '–': '--',
}


def sanitize(tex: str) -> str:
    stash: list[str] = []

    def keep(m):
        stash.append(m.group(0))
        return f'@@CMD{len(stash) - 1}@@'

    t = CMD_RE.sub(keep, tex)
    for ch, rep in UNI_MAP.items():
        t = t.replace(ch, rep)
    for ch in ('&', '%', '#', '_'):
        t = re.sub(r'(?<!\\)' + re.escape(ch), '\\' + ch, t)
    for i, cmd in enumerate(stash):
        t = t.replace(f'@@CMD{i}@@', cmd)
    return t


fixed = 0
for f in sorted(BASE.glob('*.tex')):
    orig = f.read_text(encoding='utf-8')
    new = sanitize(orig)
    if new != orig:
        f.write_text(new, encoding='utf-8')
        fixed += 1
        print('fixed:', f.name)
print(f'done, {fixed} files')
