#!/usr/bin/env python3
"""References 段回填（会议纪要方向 3 的数据层修复，执行器层后处理）。

诊断（2026-09-23）：100 张解析卡仅 31 张有 references 字段且全部 ≤50 字符，
导致 build_citation_index 无米下锅、引用关系无法识别（Related Work 短板根因）。

本脚本不改解析器，只做卡后处理：
  1. 优先取 sections 中标题为 References 的节（严格匹配，排除 "symbol reference" 类假阳性）；
  2. 兜底从 paper_text 按 「References」独立行切取尾部（截断上限内）。
运行前自动把 paper_cards/parsed/ 快照到 _backup/。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REF_TITLE_RE = re.compile(r"^\s*\d*\s*\.?\s*references\s*$", re.I)
# PDF 提取常把小型大写标题拆成 "R EFERENCES" 且与正文粘连（不在行首），故不用 ^ 锚点
REF_LINE_RE = re.compile(
    r"(?:R\s{0,3}E\s{0,3}F\s{0,3}E\s{0,3}R\s{0,3}E\s{0,3}N\s{0,3}C\s{0,3}E\s{0,3}S\b|\bBibliography\b)")
TAIL_CAP = 25000


def extract_from_sections(sections: dict) -> str:
    for title, text in sections.items():
        if REF_TITLE_RE.match(str(title)):
            return str(text)
    return ""


def extract_from_text(paper_text: str) -> str:
    matches = list(REF_LINE_RE.finditer(paper_text or ""))
    if not matches:
        return ""
    tail = paper_text[matches[-1].end():]  # 取最后一次出现（真书目通常在文末）
    tail = re.sub(r"\n{3,}", "\n\n", tail).strip()
    return tail[:TAIL_CAP]


def main() -> int:
    ap = argparse.ArgumentParser(description="References 段回填（卡后处理）")
    ap.add_argument("--cards-dir", default="paper_cards/parsed")
    args = ap.parse_args()

    cards_dir = Path(args.cards_dir)
    if not cards_dir.exists():
        print(f"[backfill_refs] 卡目录不存在: {cards_dir}")
        return 1

    here = Path(__file__).resolve().parent
    subprocess.run([sys.executable, str(here / "kg_backup.py"), "--label", "pre-backfill-refs",
                    "--paths", str(cards_dir)], check=False)

    filled, kept, total = 0, 0, 0
    for f in sorted(cards_dir.glob("*.json")):
        card = json.loads(f.read_text(encoding="utf-8"))
        total += 1
        cur = card.get("references")
        # 只填空壳（空列表/空串/缺失）；任何非空内容（list 或 str）一律保留
        if cur:
            kept += 1
            continue
        ref = extract_from_sections(card.get("sections") or {})
        if len(ref) < 100:
            ref = extract_from_text(card.get("paper_text", ""))
        if len(ref) > 100:
            card["references"] = ref
            f.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
            filled += 1
        else:
            kept += 1

    n_ok = sum(1 for f in sorted(cards_dir.glob("*.json"))
               if len((json.loads(f.read_text(encoding="utf-8"))).get("references") or "") > 100)
    print(f"[backfill_refs] 共 {total} 卡：本次回填 {filled}，原有有效 {kept} → 现有有效 references {n_ok}/{total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
