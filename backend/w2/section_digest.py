#!/usr/bin/env python3
"""W2-P0 后处理：章节定位提取（会议纪要方向 2 的执行器层实现，存量零改动）。

痛点：build_structured_papers 把论文前 16000 字符整体喂给 LLM，方法/实验章节
常被截掉。kg_common 的字段别名链中 `text` 优先于 `paper_text`——本脚本给每张卡
写一个按章节选取的 `text` 摘要，存量脚本自然优先消费；`paper_text` 原文保留。

选节策略（按 sections 标题关键词，保持文档顺序，总预算 13000 字符）：
  引言背景 3000 · 方法 5000 · 实验评测 3500 · 结论局限 1500；
  一节未命中则回退 paper_text 前 9000。运行前自动快照 cards 目录。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

BUCKETS = [
    (re.compile(r"introduction|motivation|background|overview|related work", re.I), 3000, 2500),
    (re.compile(r"method|approach|model|framework|technique|algorithm|propos|design|formal", re.I), 5000, 2200),
    (re.compile(r"experiment|evaluation|result|empirical|dataset|benchmark|ablation|simulation", re.I), 3500, 1800),
    (re.compile(r"conclusion|discussion|summary|limitation|future", re.I), 2000, 1200),
]
TOTAL_CAP = 13000


def build_digest(card: dict) -> str:
    sections = card.get("sections") if isinstance(card.get("sections"), dict) else {}
    picked: list[tuple[str, str]] = []
    used = {name.pattern: 0 for name, _, _ in BUCKETS}
    total = 0
    for title, text in sections.items():
        t = str(text).strip()
        if len(t) < 80:
            continue
        for name, bucket_cap, per_cap in BUCKETS:
            if name.search(str(title)) and used[name.pattern] < bucket_cap and total < TOTAL_CAP:
                take = t[:per_cap]
                picked.append((str(title), take))
                used[name.pattern] += len(take)
                total += len(take)
                break
    if not picked:
        return (card.get("paper_text") or "")[:9000]
    parts = [f"[{title}]\n{body}" for title, body in picked]
    return "\n\n".join(parts)[:TOTAL_CAP]


def main() -> int:
    ap = argparse.ArgumentParser(description="章节定位摘要（写 text 字段，paper_text 保留）")
    ap.add_argument("--cards-dir", default="paper_cards/parsed")
    args = ap.parse_args()

    cards_dir = Path(args.cards_dir)
    if not cards_dir.exists():
        print(f"[section_digest] 卡目录不存在: {cards_dir}")
        return 1
    subprocess.run([sys.executable, str(HERE / "kg_backup.py"), "--label", "pre-section-digest",
                    "--paths", str(cards_dir)], check=False)

    written = 0
    for f in sorted(cards_dir.glob("*.json")):
        card = json.loads(f.read_text(encoding="utf-8"))
        digest = build_digest(card)
        if len(digest) < 200:
            continue
        card["text"] = digest
        f.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
        written += 1
    print(f"[section_digest] {written}/{len(list(cards_dir.glob('*.json')))} 卡写入章节定位摘要（text 字段）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
