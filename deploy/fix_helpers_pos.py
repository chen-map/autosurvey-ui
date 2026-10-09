# -*- coding: utf-8 -*-
"""服务器 main.py 就地修复：_html_unescape/_norm_key 两个 helper 被插到 @app.get 装饰器与
get_corpus 之间 → FastAPI 把 _html_unescape 当 /corpus 处理函数、必需 query t → 422。
修复：把 helper 块移动到 import requests 之后（模块级）。"""
import ast
import pathlib

P = pathlib.Path('/home/G2024hq/asv-app/backend/api/main.py')
lines = P.read_text(encoding='utf-8').split('\n')

# 找 helper 块（def _html_unescape 起，到 _norm_key 函数体结束）
i1 = next(i for i, l in enumerate(lines) if l.startswith('def _html_unescape'))
i2 = next(i for i, l in enumerate(lines) if l.startswith('def _norm_key'))
block = lines[i1:i2 + 2]  # 两函数 + 中间空行
del lines[i1:i2 + 2]

# 插到 import requests as _requests 行之后
j = next(i for i, l in enumerate(lines) if l.startswith('import requests as _requests'))
lines[j + 1:j + 1] = ['', *block]

src = '\n'.join(lines)
ast.parse(src)
P.write_text(src, encoding='utf-8')
print('helpers moved OK')
