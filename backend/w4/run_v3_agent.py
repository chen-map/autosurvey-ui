#!/usr/bin/env python3
"""run_v3_agent.py — W4-P1：L3 Agent 逐宏 RQ 自主分析。

对 W3 冻结的每个宏 RQ 跑一次 LLMSkillAgent.run_skill（skill_id=None 自动选型）：
  工具循环（≤30 轮）→ end(answer) → HTML 报告 → 6 文件工作记忆目录。

LLM 通道（v3 说 Anthropic 协议）：
  llm_wrap.load_llm_config_full('w4') 解析归属用户配置（AS_RUN_USER_ID），
  provider 必须为 anthropic：base → ANTHROPIC_BASE_URL，key → ANTHROPIC_API_KEY。
  DeepSeek 用户在个人中心 W4 填 base_url=https://api.deepseek.com/anthropic + provider=anthropic。

断点续跑：某 RQ 已有 03_final_answer.json 则跳过（--force 重跑）。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # backend/（db、w2.llm_wrap）


def resolve_anthropic(use_case: str) -> tuple[str, str, str]:
    """解析 (base_url, api_key, model)；provider 非 anthropic 时给明确指引。"""
    from w2.llm_wrap import load_llm_config_full

    base, key, models, provider = load_llm_config_full(use_case)
    if not (base and key and models):
        raise SystemExit(
            "[w4-agent] LLM 未配置：个人中心 → W4 填 baseUrl + API Key + 模型")
    if provider != "anthropic":
        raise SystemExit(
            "[w4-agent] W4 v3（KG 分析 Agent）走 Anthropic 协议，当前 W4 配置 provider="
            f"{provider}。请在个人中心 W4 卡片把接口地址改为 Anthropic 兼容端点并将协议选为 "
            f"anthropic（DeepSeek 填 https://api.deepseek.com/anthropic）")
    return base, key, models[0]


def collect_rqs(matrix_path: Path) -> list[dict]:
    """从 W3 证据矩阵提取宏 RQ 列表（rq_id, rq_text），保持首次出现顺序去重。"""
    m = json.loads(matrix_path.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}
    for e in m.get("sub_rq_matrix", []):
        rid = (e.get("rq_id") or "").strip()
        if rid and rid not in seen:
            seen[rid] = e.get("rq_text", "")
    return [{"rq_id": k, "rq_text": v} for k, v in seen.items()]


def paper_ids_touched(tool_calls: list[dict]) -> list[str]:
    """从工具调用结果中提取被触及的论文 id（去重保序，供 claims 证据溯源）。"""
    ids: list[str] = []
    for tc in tool_calls or []:
        raw = tc.get("raw_result")
        text = json.dumps(raw, ensure_ascii=False) if not isinstance(raw, str) else raw
        if not text:
            continue
        for token in text.split('"'):
            if token.startswith("paper_") or (len(token) == 4 and token.isdigit()):
                if token not in ids:
                    ids.append(token)
    return ids[:30]


def main() -> int:
    ap = argparse.ArgumentParser(description="W4 v3 Agent 逐 RQ 深析")
    ap.add_argument("--workspace", default=".", help="项目工作区 cwd")
    ap.add_argument("--skills-root", required=True, help="layer2_skills 目录")
    ap.add_argument("--out-dir", required=True, help="工作记忆输出根目录")
    ap.add_argument("--use-case", default="w4")
    ap.add_argument("--kg-root", default="", help="覆盖 KG 目录（默认 <workspace>/kg_v3）")
    ap.add_argument("--force", action="store_true", help="忽略断点强制重跑")
    args = ap.parse_args()

    ws = Path(args.workspace).resolve()
    kg_root = Path(args.kg_root) if args.kg_root else ws / "kg_v3"
    matrix = ws / "analyze_report" / "rq_evidence_matrix.json"
    cards = ws / "paper_cards" / "parsed"
    out_root = Path(args.out_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    if not (kg_root / "nodes" / "papers.json").exists():
        raise SystemExit(f"[w4-agent] KG 目录缺失: {kg_root}（先跑 W4-P0）")
    if not matrix.exists():
        raise SystemExit(f"[w4-agent] W3 证据矩阵缺失: {matrix}（先跑 W3）")

    rqs = collect_rqs(matrix)
    print(f"[w4-agent] 宏 RQ {len(rqs)} 个: {[r['rq_id'] for r in rqs]}", flush=True)

    # v3 落盘约定：{output_dir}/working_memory/{rq_id}_{skill}_{ts}/——断点检查须在同一层
    v3_root = out_root / "working_memory"

    # 断点：已完成（有最终答案且非空）的 RQ 跳过
    def _done(rid: str) -> bool:
        if args.force:
            return False
        for d in v3_root.glob(f"{rid}_*"):
            f = d / "03_final_answer.json"
            if not f.exists():
                continue
            try:
                w = json.loads(f.read_text(encoding="utf-8"))
                if w.get("answer") is not None:
                    return True
            except (OSError, json.JSONDecodeError):
                continue
        return False

    pending = [r for r in rqs if not _done(r["rq_id"])]
    skipped = len(rqs) - len(pending)
    if skipped:
        print(f"[w4-agent] 断点续跑：跳过已完成 {skipped} 个", flush=True)
    if not pending:
        print("[w4-agent] 全部 RQ 已完成", flush=True)
        return 0

    base, key, model = resolve_anthropic(args.use_case)
    print(f"[w4-agent] LLM: provider=anthropic model={model} base={base}", flush=True)

    # v3 Agent 依赖 anthropic SDK + env 通道
    os.environ["ANTHROPIC_BASE_URL"] = base
    os.environ["ANTHROPIC_API_KEY"] = key
    from kg_analysis.layer3_llm_agent.llm_skill_agent import LLMSkillAgent

    agent = LLMSkillAgent(
        kg_root=str(kg_root),
        skills_root=args.skills_root,
        output_dir=str(out_root),
        model=model,
        paper_cards_root=str(cards) if cards.exists() else None,
    )

    failed: list[str] = []
    for r in pending:
        rid, rq_text = r["rq_id"], r["rq_text"]
        print(f"[w4-agent] === {rid} 开始：{rq_text[:60]}…", flush=True)
        result = None
        for attempt in (1, 2):  # 空答案/凝练违约（overall<400字）自动重试一次
            try:
                result = agent.run_skill(skill_id=None, rq_text=rq_text, rq_id=rid)
            except SystemExit:
                raise
            except Exception as e:  # 单 RQ 失败不拖垮整批，汇总后统一退出码
                failed.append(rid)
                print(f"[w4-agent] {rid} 失败：{type(e).__name__}: {e}", flush=True)
                result = None
                break
            fa = result.get("final_answer")
            if fa is None:
                # 空答案：删掉这次落盘（防 resume 误判完成），重试
                wm_dir = result.get("working_memory_dir")
                if wm_dir:
                    import shutil
                    shutil.rmtree(wm_dir, ignore_errors=True)
                print(f"[w4-agent] {rid} 第 {attempt} 次得到空答案（end=None），重试", flush=True)
                continue
            oa = fa.get("overall_answer") if isinstance(fa, dict) else ""
            if isinstance(oa, str) and len(oa) >= 400:
                break  # 契约达标（叙事 500-2000 字）
            if attempt == 1:
                # 凝练违约：删目录重试一次（提示词遵守率 ~60%，重试显著提升）
                wm_dir = result.get("working_memory_dir")
                if wm_dir:
                    import shutil
                    shutil.rmtree(wm_dir, ignore_errors=True)
                print(f"[w4-agent] {rid} overall_answer 过短（{len(oa or '')} 字 < 400，契约 500-2000），重试", flush=True)
                continue
            print(f"[w4-agent] {rid} 重试后仍凝练（{len(oa or '')} 字），接受——claims 合成兜底补位", flush=True)
        if result is None:
            continue
        if result.get("final_answer") is None:
            if rid not in failed:
                failed.append(rid)
            print(f"[w4-agent] {rid} 两次均空答案，放弃（可重试）", flush=True)
            continue
        n_rounds = result.get("total_tool_rounds", 0)
        wm_dir = result.get("working_memory_dir") or ""
        print(f"[w4-agent] {rid} 完成：{n_rounds} 轮工具 → {wm_dir}", flush=True)

    if failed:
        print(f"[w4-agent] 失败 RQ：{failed}（可重试，断点保已完成的）", flush=True)
        return 1
    print("[w4-agent] 全部完成", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
