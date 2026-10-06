import pathlib

P = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/main.tex')
s = P.read_text(encoding='utf-8')
marker = '\\end{abstract}\n\n\\input{sections/0_abstract}\n'
if marker in s:
    s = s.replace(marker, '\\end{abstract}\n\n', 1)
    P.write_text(s, encoding='utf-8')
    print('dedup OK')
else:
    print('marker not found（可能已去重）')
print('0_abstract 次数:', s.count('\\input{sections/0_abstract}'))
