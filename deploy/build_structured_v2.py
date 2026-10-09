# -*- coding: utf-8 -*-
"""build_structured_papers 增量版（v5 规则前的准备）：
- 读 paper_cards/parsed/*.json 全部卡
- structured_papers.jsonl 已有 paper_id 的跳过（断点），只提取新增
- 输出追加到同一 jsonl（W2-P2/P3 消费时按 paper_id 去重）
用法：python3 incremental_extract.py <workspace> <新增卡目录=同目录>
由用户在服务器上跑；需要 LLM 可用（当前本地 Qwen 挤压中，建议换 API 后执行）。
"""
import json
import pathlib
import sys

WS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
CARDS = WS / 'paper_cards' / 'parsed'
OUT = WS / 'knowledge_graph' / 'structured_papers.jsonl'
OUT.parent.mkdir(parents=True, exist_ok=True)

done = set()
if OUT.exists():
    for line in OUT.read_text(encoding='utf-8').splitlines():
        try:
            done.add(str(json.loads(line).get('paper_id') or ''))
        except Exception:
            pass

todo = [f for f in sorted(CARDS.glob('*.json'))
        if str(json.loads(f.read_text(encoding='utf-8')).get('paper_id') or f.stem) not in done]
print(f'已完成 {len(done)} | 待提取 {len(todo)}')
