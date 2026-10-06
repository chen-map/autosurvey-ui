"""就地修 sections 与 bib 里的希腊字母/特殊字符 → LaTeX 数学模式。"""
import pathlib
import re

SEC = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper')
GREEK = {'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
         'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'σ': 'sigma', 'π': 'pi',
         'τ': 'tau', 'ω': 'omega', 'φ': 'phi', 'ψ': 'psi', 'ξ': 'xi',
         'κ': 'kappa', 'ρ': 'rho', 'η': 'eta', 'ζ': 'zeta', 'χ': 'chi'}
CMD = re.compile(r'\\(?:cite|ref|label|url)[^{}]*\{[^}]*\}')

for f in sorted((SEC / 'sections').glob('*.tex')) + [SEC / 'references.bib']:
    if not f.exists():
        continue
    s = f.read_text(encoding='utf-8')
    orig = s
    stash: list = []

    def keep(m):
        stash.append(m.group(0))
        return f'@@G{len(stash)-1}@@'

    s = CMD.sub(keep, s)
    for ch, name in GREEK.items():
        s = s.replace(ch, f'$\\{name}$')
    for i, c in enumerate(stash):
        s = s.replace(f'@@G{i}@@', c)
    if s != orig:
        f.write_text(s, encoding='utf-8')
        print('fixed:', f.name)
print('done')
