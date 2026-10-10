# -*- coding: utf-8 -*-
"""W2 stage 文案更新 + IEEE builtin 清理（服务器版）。"""
import pathlib

P = pathlib.Path('/home/G2024hq/asv-app/backend/api/main.py')
s = P.read_text(encoding='utf-8')

old_stage = '默认服务器本地 Qwen3.6-35B（免费但慢，约95秒/对）· 追求速度请填自己的 API'
new_stage = '默认服务器本地 Qwen3.6-35B（免费但慢）· 自建 Ollama 填 http://IP:11434/v1 · 或填 DeepSeek 等 API 提速'
if old_stage in s:
    s = s.replace(old_stage, new_stage)
    print('stage text updated')

P.write_text(s, encoding='utf-8')
print('done')
