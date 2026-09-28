#!/usr/bin/env python3
"""w4_selfcheck.py — W4-P3：W5 输入契约完整性自检。

校验每个 rq_* 目录三件套齐全且非空壳，输出 WORKFLOW4_SELF_CHECK.md。
问题只记录不抛错（optional 阶段，W5 自己也带缺文件降级）。
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

REQUIRED = ["working_memory.json", "answer_claims.json", "rq_answer.json"]


def main() -> int:
    ap = argparse.ArgumentParser(description="W4 自检")
    ap.add_argument("--wm", required=True, help="working_memory 目录")
    args = ap.parse_args()
    wm = Path(args.wm)

    problems: list[str] = []
    rq_dirs = sorted(d for d in wm.iterdir() if d.is_dir() and d.name.startswith("rq_")) if wm.exists() else []
    if not rq_dirs:
        problems.append("未发现任何 rq_* 目录（W4-P2 未跑或输出为空）")

    total_claims = 0
    for d in rq_dirs:
        for f in REQUIRED:
            p = d / f
            if not p.exists():
                problems.append(f"{d.name}/{f} 缺失")
                continue
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                problems.append(f"{d.name}/{f} JSON 损坏: {e}")
                continue
            if f == "answer_claims.json":
                n = len(data.get("key_claims") or [])
                total_claims += n
                if not data.get("overall_answer"):
                    problems.append(f"{d.name} overall_answer 为空")
                if n == 0:
                    problems.append(f"{d.name} key_claims 为空（该 RQ 分析未产出结构化结论）")

    index = wm / "WORKING_MEMORY_INDEX.json"
    if not index.exists():
        problems.append("WORKING_MEMORY_INDEX.json 缺失（W5-P1 的输出校验会挂）")

    lines = [
        "# W4 自检报告（kg_analysis v3 → W5 契约）",
        "",
        f"- 检查时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- RQ 目录：{len(rq_dirs)} 个，key_claims 合计 {total_claims} 条",
        f"- WORKING_MEMORY_INDEX：{'存在' if index.exists() else '缺失'}",
        "",
        "## 问题清单" if problems else "## 结论：全部通过 ✓",
    ]
    lines += [f"- {p}" for p in problems] if problems else []
    (wm / "WORKFLOW4_SELF_CHECK.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[w4-selfcheck] {len(rq_dirs)} RQ / {total_claims} claims / 问题 {len(problems)} 个")
    for p in problems:
        print(f"  - {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
