# -*- coding: utf-8 -*-
"""W2-P1 增量提取包装（执行器层，存量脚本零修改）。

语义（用户裁决，分界必须清晰）：
- 续跑/增量：structured_papers.jsonl 或 checkpoint 已存在 → 只提取 paper_cards 中
  「checkpoint 里没有 paper_id」的新增卡（如手动上传后新增的论文），已有产物不动
- 重跑/全量：仅当 --force 传入（用户显式重置：删 jsonl+checkpoint+KG 后从头来）

实现：import 存量 build_structured_papers，调用 build_structured_records(checkpoint_path=...)——
argparse 未暴露 --checkpoint，但 run() 函数已支持；本包装是合规的执行器层接线。

用法（经 llm_wrap 调用，与 W2-P1 step args 兼容）：
  python incremental_extract.py --input paper_cards/parsed \
      --out knowledge_graph/structured_papers.jsonl \
      --max-text-chars 16000 [--force]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---- 与 llm_wrap 相同的 argv 预处理（透传 --use-case/--kg-common-path） ----
argv = sys.argv[1:]
if "--target" not in argv:
    raise SystemExit("incremental_extract: 需经 llm_wrap 调用（缺 --target）")
i = argv.index("--target")
target = Path(argv[i + 1]).resolve()
argv = argv[:i] + argv[i + 2:]
if "--use-case" in argv:
    j = argv.index("--use-case")
    argv = argv[:j] + argv[j + 2:]
if "--kg-common-path" in argv:
    j = argv.index("--kg-common-path")
    kg_dir = argv[j + 1]
    argv = argv[:j] + argv[j + 2:]
    if kg_dir not in sys.path:
        sys.path.insert(0, kg_dir)

parser = argparse.ArgumentParser(description="W2-P1 增量提取（checkpoint 续跑）")
parser.add_argument("--input", action="append", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--max-text-chars", type=int, default=16000)
parser.add_argument("--checkpoint", default=None,
                    help="checkpoint jsonl（默认 <out 目录>/structured_checkpoint.jsonl）")
parser.add_argument("--force", action="store_true", help="忽略 checkpoint 全量重跑")
args = parser.parse_args(argv)

out_path = Path(args.out)
ckpt_path = Path(args.checkpoint) if args.checkpoint else out_path.with_name("structured_checkpoint.jsonl")

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

# ---- import 存量脚本（kg_common 依赖同目录；target 目录由 llm_wrap 注入） ----
target_dir = str(target.parent)
if target_dir not in sys.path:
    sys.path.insert(0, target_dir)
import build_structured_papers as bsp  # noqa: PLC0415

records = bsp.build_structured_records(
    inputs=args.input,
    max_papers=0,
    max_text_chars=args.max_text_chars,
    checkpoint_path=ckpt_path,
    resume=not args.force,
)
bsp.save_structured_records(records, args.out)
print(json.dumps({"out": str(out_path), "papers": len(records), "mode": mode}, ensure_ascii=False))
