#!/usr/bin/env python3
"""W5-P4 综述论文编译：tectonic → main.pdf（PDF 预览的产物）。

tectonic 定位：环境变量 AS_TECTONIC → backend/tools/tectonic.exe。
未安装时优雅跳过（exit 0），不阻塞流水线。
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def tectonic_exe() -> Path | None:
    env = os.environ.get("AS_TECTONIC")
    if env and Path(env).exists():
        return Path(env)
    cand = HERE.parent / "tools" / ("tectonic.exe" if os.name == "nt" else "tectonic")
    return cand if cand.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser(description="综述论文编译（tectonic）")
    ap.add_argument("--paper-dir", default="survey_paper")
    args = ap.parse_args()

    paper_dir = Path(args.paper_dir)
    sys.path.insert(0, str(HERE))
    tex = paper_dir / "main.tex"
    if not tex.exists():
        print(f"[compile_pdf] {tex} 不存在，跳过")
        return 0
    tect = tectonic_exe()
    if tect is None:
        print("[compile_pdf] tectonic 未安装，跳过编译（PDF 预览不可用）")
        return 0

    pdf = paper_dir / "main.pdf"
    # 断点：已有 PDF 且比「全目录最新 tex/图」新才跳过（P3 只重写 sections/*.tex 不动 main.tex，
    # 仅比较 main.tex 会漏检 sections 更新——实测教训）
    latest_src = max((f.stat().st_mtime for f in paper_dir.rglob("*.tex")), default=0.0)
    for extra in paper_dir.rglob("*.png"):
        latest_src = max(latest_src, extra.stat().st_mtime)
    if pdf.exists() and pdf.stat().st_mtime > latest_src:
        print(f"[compile_pdf] main.pdf 已是最新（{pdf.stat().st_size // 1024}KB），跳过")
        return 0

    # 真实数据统计图（年份/KG 分布）替换流水线自评图
    try:
        import real_figures  # noqa: PLC0415
        real_figures.main([])  # 传空 argv：防其 argparse 误吞本脚本的 --paper-dir
    except Exception as exc:  # matplotlib 缺失等 → 跳过图，继续编译
        print(f"[compile_pdf] real_figures 跳过: {exc}", flush=True)

    print(f"[compile_pdf] 编译 {tex} → main.pdf（首次运行会联网拉取宏包）", flush=True)
    try:
        proc = subprocess.run([str(tect), tex.name], cwd=str(paper_dir),
                              capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        print("[compile_pdf] 编译超时（30min）")
        return 1
    if proc.returncode != 0:
        print(f"[compile_pdf] 编译失败：{(proc.stderr or proc.stdout)[-500:]}", flush=True)
        return 1
    if not pdf.exists() or open(pdf, "rb").read(4) != b"%PDF":
        print("[compile_pdf] 产物校验失败")
        return 1
    print(f"[compile_pdf] main.pdf 编译成功（{pdf.stat().st_size // 1024}KB）", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
