# -*- coding: utf-8 -*-
"""W2-P1 增量提取包装（执行器层，存量脚本零修改）。

语义（用户裁决，分界必须清晰）：
- 续跑/增量：structured_papers.jsonl 或 checkpoint 已存在 → 只提取 paper_cards 中
  「checkpoint 里没有 paper_id」的新增卡（如手动上传后新增的论文），已有产物不动
- 重跑/全量：仅当 --force 传入（用户显式重置：删 jsonl+checkpoint 后从头来）

用法（经 llm_wrap 调用，与 W2-P1 step args 兼容）：
  python incremental_extract.py --input paper_cards/parsed \
      --out knowledge_graph/structured_papers.jsonl \
      --max-text-chars 16000 [--force]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# ---- llm_wrap 已剥掉 --target 和 --use-case/--kg-common-path，剩余 args 直接解析 ----
argv = sys.argv[1:]

parser = argparse.ArgumentParser(description="W2-P1 增量提取（checkpoint 续跑）")
parser.add_argument("--input", action="append", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--max-text-chars", type=int, default=16000)
parser.add_argument("--force", action="store_true", help="忽略 checkpoint 全量重跑")
args = parser.parse_args(argv)

out_path = Path(args.out)
ckpt_path = out_path.with_name("structured_checkpoint.jsonl")

# ---- 语义判定：增量 vs 全量 ----
out_exists = out_path.exists() and out_path.stat().st_size > 0
ckpt_exists = ckpt_path.exists() and ckpt_path.stat().st_size > 0
if args.force:
    mode = "全量重跑（--force）"
    ckpt_path.unlink(missing_ok=True)
    if out_exists:
        out_path.unlink()
elif out_exists or ckpt_exists:
    mode = "增量续跑（checkpoint 续传，仅提取新增卡）"
else:
    mode = "首次全量提取"
print(f"[incremental] 模式: {mode}", flush=True)

# ---- import 存量脚本 ----
# build_structured_papers.py 与 kg_common.py 的目录由 --kg-common-path 加入 sys.path（llm_wrap 处理）
# 这里直接 import 即可
import importlib
import kg_common  # noqa: PLC0415 — LLM 配置由 llm_wrap 注入 kg_common 模块变量

# 加载 kg_scripts 目录（build_structured_papers.py 所在）
# --kg-common-path 的路径已在 sys.path 里
import build_structured_papers as bsp  # noqa: PLC0415

# ---- 调存量核心函数（checkpoint 接线） ----
records = bsp.build_structured_records(
    inputs=args.input,
    max_papers=0,
    max_text_chars=args.max_text_chars,
    checkpoint_path=ckpt_path,
    resume=not args.force,
)
bsp.save_structured_records(records, args.out)
import json as _json
print(_json.dumps({"out": str(out_path), "papers": len(records), "mode": mode}, ensure_ascii=False))
