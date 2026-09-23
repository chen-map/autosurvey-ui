#!/usr/bin/env python3
"""执行器层通用备份工具：把指定文件/目录快照到 <项目>/_backup/<时间戳>/。

用法（在项目 workspace 或任意 CWD）：
  python kg_backup.py --label merge --paths a.json b/ dir/c.db
产物：<第一个路径的共同父目录>/_backup/<label>-<ts>/...（保持相对结构）。
"""
from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="执行器层文件备份")
    ap.add_argument("--label", default="bak", help="备份目录标签")
    ap.add_argument("--paths", nargs="+", required=True, help="要快照的文件/目录")
    args = ap.parse_args()

    paths = [Path(p) for p in args.paths if Path(p).exists()]
    if not paths:
        print("[backup] 没有可备份的路径（均不存在）")
        return 1
    base = paths[0].parent if paths[0].is_file() else paths[0].parent
    ts = time.strftime("%Y%m%d-%H%M%S")
    dest_root = base / "_backup" / f"{args.label}-{ts}"
    copied = 0
    for p in paths:
        if not p.exists():
            continue
        rel = p.name if p.is_file() else p.name
        dest = dest_root / rel
        if p.is_dir():
            shutil.copytree(p, dest, dirs_exist_ok=True)
            copied += sum(1 for _ in dest.rglob("*") if _.is_file())
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dest)
            copied += 1
    print(f"[backup] {copied} 个文件 → {dest_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
