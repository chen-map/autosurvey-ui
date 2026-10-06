#!/usr/bin/env python3
"""v3_to_w5_adapter.py — W4-P2：v3 工作记忆 → W5 输入契约。

run_workflow5.py 对每个 rq 目录读三个文件（schema 从现有跑通产物逆向）：
  working_memory.json  — 全量工作记忆（透传 v3 answer + 工具/推理轨迹摘要）
  answer_claims.json   — {rq_id, rq_text, overall_answer, key_claims[], sub_rq_answers[],
                          confidence, answer_completeness, completeness_notes, synthesis_notes}
  rq_answer.json       — {rq_id, rq_text, overall_answer, sub_rq_answers, ...}
另生成 working_memory/WORKING_MEMORY_INDEX.json。

v3 的 end(answer) 结构按 Skill 各异 → 宽容提取：
  overall_answer ← answer.summary / overall_answer / 结论性文本字段 / 兜底 JSON 摘要
  key_claims     ← answer.key_claims / claims / findings / 列表型结论字段泛化
  evidence_papers ← 工具调用触及的论文 id（溯源真实工具轨迹）
提取不到的字段留空并在 completeness_notes 里如实说明（不编造）。
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# 结论性列表字段的泛化名（按优先级：显式 claims → 证据片段 → 分区/链等结构化结论）
_CLAIM_KEYS = ["key_claims", "claims", "findings", "main_findings",
               "key_findings", "conclusions", "evidence_snippets",
               "hot_zones", "cold_zones", "chains", "patterns"]
# 列表条目里当"文本"用的字段名优先级
_TEXT_KEYS = ["claim_text", "claim", "finding", "text", "description",
              "summary", "content", "name", "core_verb_logic"]
# 列表条目里当"论文列表"用的字段名（复数列表 + 单数 id）
_PAPER_KEYS = ["papers", "evidence_papers", "paper_ids", "supporting_papers"]
_PAPER_SINGLE = ["paper_id", "paper", "origin_paper_id"]


def _first_str(d: dict, keys: list[str]) -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, list) and v and isinstance(v[0], str):
            return "; ".join(v[:5])
    return ""


def extract_overall_answer(ans) -> tuple[str, str]:
    """返回 (overall_answer, note)。"""
    if isinstance(ans, str):
        return ans.strip(), ""
    if isinstance(ans, dict):
        s = _first_str(ans, ["overall_answer", "answer_summary", "summary",
                             "rq_answer_synthesis", "conclusion", "answer",
                             "executive_summary", "cognitive_coordinate"])
        if s:
            return s, ""
        # 兜底：JSON 摘要（截断），不编造
        s = json.dumps(ans, ensure_ascii=False)
        return (s[:1500] + "…" if len(s) > 1500 else s,
                "overall_answer 为 answer JSON 摘要（该 Skill 未输出 summary 类字段）")
    return json.dumps(ans, ensure_ascii=False)[:1500], "answer 为非 dict 结构"


def extract_claims(ans, papers_touched: list[str]) -> tuple[list[dict], list[str]]:
    """返回 (key_claims, notes)。泛化列表字段 → W5 claim schema。"""
    if not isinstance(ans, dict):
        return [], []
    notes: list[str] = []
    claims: list[dict] = []
    src_key = None
    for k in _CLAIM_KEYS:
        v = ans.get(k)
        if isinstance(v, list) and v:
            src_key = k
            break
    if src_key is None:
        notes.append("answer 未含显式 claims 类列表字段，转入泛化兜底扫描")

    for i, item in enumerate(v if (v := ans.get(src_key)) else [], 1):
        if isinstance(item, str):
            claims.append({"claim_id": f"C{i}", "claim_text": item,
                           "claim_type": "finding", "evidence_papers": papers_touched[:5],
                           "confidence": None, "counter_evidence": [], "related_sub_rq": ""})
            continue
        if not isinstance(item, dict):
            continue
        text = _first_str(item, _TEXT_KEYS)
        if not text:
            continue
        ep: list[str] = []
        for pk in _PAPER_KEYS:
            pv = item.get(pk)
            if isinstance(pv, list) and pv:
                ep = [str(x) for x in pv][:8]
                break
        if not ep:
            for pk in _PAPER_SINGLE:
                pv = item.get(pk)
                if isinstance(pv, str) and pv:
                    ep = [pv]
                    break
        claims.append({
            "claim_id": f"C{i}",
            "claim_text": text[:600],
            "claim_type": str(item.get("type") or item.get("status") or "finding"),
            "evidence_papers": ep or papers_touched[:5],
            "confidence": item.get("confidence") if isinstance(item.get("confidence"), (int, float)) else None,
            "counter_evidence": item.get("counter_evidence") if isinstance(item.get("counter_evidence"), list) else [],
            "related_sub_rq": str(item.get("related_sub_rq") or item.get("rq_id") or ""),
        })
    if claims:
        notes.append(f"key_claims 由 answer.{src_key} 泛化映射（{len(claims)} 条）")
        return claims, notes

    # 泛化兜底：扫描 answer 全部 list 值，条目含像样文本字段（≥25 字符）即收
    for k, v in ans.items():
        if k in ("metadata", "rq_id") or not isinstance(v, list) or len(v) < 2:
            continue
        harvested = []
        for i, item in enumerate(v, 1):
            if isinstance(item, dict):
                text = _first_str(item, _TEXT_KEYS + ["category", "blind_spot_type", "reason"])
                if len(text) < 25:
                    continue
                ep = next(([(str(x) if not isinstance(x, dict) else str(x.get("paper_id") or x))
                            for x in item.get(pk)][:8]
                           for pk in _PAPER_KEYS if isinstance(item.get(pk), list) and item.get(pk)),
                          None) or next(([item.get(ps)] for ps in _PAPER_SINGLE
                                         if isinstance(item.get(ps), str) and item.get(ps)), None)
                harvested.append({
                    "claim_id": f"C{i}", "claim_text": text[:600],
                    "claim_type": str(item.get("type") or item.get("status") or k),
                    "evidence_papers": ep or papers_touched[:5],
                    "confidence": item.get("confidence") if isinstance(item.get("confidence"), (int, float)) else None,
                    "counter_evidence": [], "related_sub_rq": ""})
            elif isinstance(item, str) and len(item) >= 25:
                harvested.append({"claim_id": f"C{i}", "claim_text": item[:600],
                                  "claim_type": k, "evidence_papers": papers_touched[:5],
                                  "confidence": None, "counter_evidence": [], "related_sub_rq": ""})
        if len(harvested) >= 2:
            notes.append(f"key_claims 由 answer.{k} 泛化兜底（{len(harvested)} 条）")
            return harvested[:10], notes
    return [], notes


def main() -> int:
    ap = argparse.ArgumentParser(description="v3 产物 → W5 契约")
    ap.add_argument("--v3-out", required=True, help="v3 工作记忆根目录")
    ap.add_argument("--out", required=True, help="W5 working_memory 目录")
    ap.add_argument("--matrix", required=True, help="W3 rq_evidence_matrix.json")
    args = ap.parse_args()

    v3_root = Path(args.v3_out)
    out = Path(args.out)
    if not v3_root.exists():
        raise SystemExit(f"[v3->w5] v3 输出缺失: {v3_root}（先跑 W4-P1）")

    # RQ 文本对照表（从 W3 矩阵）
    rq_text: dict[str, str] = {}
    mp = Path(args.matrix)
    if mp.exists():
        m = json.loads(mp.read_text(encoding="utf-8"))
        for e in m.get("sub_rq_matrix", []):
            rid = (e.get("rq_id") or "").strip()
            if rid and rid not in rq_text:
                rq_text[rid] = e.get("rq_text", "")

    # 子 RQ 粒度目录（RQ1.1_xxx）按父 RQ 聚合；兼容旧宏 RQ 目录（RQ1_xxx）
    runs_by_parent: dict[str, dict[str, Path]] = {}
    for d in sorted(v3_root.iterdir()):
        if not d.is_dir() or not (d / "03_final_answer.json").exists():
            continue
        rid_full = d.name.split("_")[0]
        parent = rid_full.split(".")[0]
        runs_by_parent.setdefault(parent, {})[rid_full] = d
    if not runs_by_parent:
        raise SystemExit("[v3->w5] 未发现任何含 03_final_answer.json 的运行目录")

    def _rq_num(rid: str) -> int:
        m = re.search(r"\d+", rid)
        return int(m.group()) if m else 0

    index_entries = []
    for rid in sorted(runs_by_parent, key=_rq_num):
        sub_runs = runs_by_parent[rid]           # {RQ1.1: Path, RQ1.2: Path, ...} 或 {RQ1: Path}
        sub_ids = sorted(sub_runs, key=_rq_num)

        # ---- 逐子 RQ 收集分析结果，按父 RQ 聚合 ----
        subs_overall: list[str] = []
        subs_answers: list[dict] = []
        claims: list = []
        notes: list[str] = []
        skills: list[str] = []
        papers_all: list[str] = []
        total_calls = 0
        total_rounds = 0
        for sid in sub_ids:
            d = sub_runs[sid]
            meta = _j(d / "00_meta.json", {})
            ans = _j(d / "03_final_answer.json", None)
            if isinstance(ans, dict) and "answer" in ans:
                ans = ans.get("answer")
            tool_calls = _j(d / "01_tool_calls.json", [])
            papers_touched = paper_ids_touched(tool_calls)
            s_overall, note1 = extract_overall_answer(ans)
            s_claims, notes2 = extract_claims(ans, papers_touched)
            notes += [n for n in (note1, *notes2) if n]
            skills.append(str(meta.get("skill_id", "")))
            total_calls += len(tool_calls)
            total_rounds += int(meta.get("total_tool_rounds") or 0)
            for p in papers_touched:
                if p not in papers_all:
                    papers_all.append(p)
            if s_overall:
                subs_overall.append(f"### {sid}\n{s_overall}" if len(sub_ids) > 1 else s_overall)
            subs_answers.append({
                "sub_rq_id": sid,
                "answer": s_overall or "",
                "confidence": None,
                "claims": len(s_claims),
                # 子级论断带证据 id（W5 逐小节撰写的引用来源——小 RQ 是分析主力）
                "sub_claims": [{"text": str(c.get("claim_text") or c.get("claim") or "")[:240],
                                "evidence": [str(x) for x in (c.get("evidence_papers") or []) if x][:4]}
                               for c in s_claims][:8],
                "papers_touched": len(papers_touched),
            })
            claims.extend(s_claims)
        claims = claims[:24]  # 聚合上限：W5 消费友好
        overall = "\n\n".join(subs_overall)
        papers_touched = papers_all[:30]

        rq_dir = out / f"rq_{_rq_num(rid)}"
        rq_dir.mkdir(parents=True, exist_ok=True)

        working_memory = {
            "rq_id": rid,
            "rq_text": rq_text.get(rid, ""),
            "engine": "kg_analysis_v3",
            "skill_used": "+".join(skills),
            "sub_rq_analyses": subs_answers,
            "overall_answer": overall,
            "tool_rounds": total_rounds,
            "tool_calls": total_calls,
            "papers_touched": papers_touched,
        }
        answer_claims = {
            "rq_id": rid,
            "rq_text": rq_text.get(rid, ""),
            "overall_answer": overall,
            "key_claims": claims,
            "sub_rq_answers": subs_answers,  # 子 RQ 粒度分析（学长思路）：每子答案真实落位
            "confidence": None,
            "answer_completeness": "partial" if notes else "answered",
            "completeness_notes": "; ".join(notes) if notes else "",
            "synthesis_notes": f"kg_analysis v3 子 RQ 粒度聚合（{len(sub_ids)} 个子分析，"
                               f"Skills: {'+'.join(skills) or '?'}，{total_calls} 次工具调用，"
                               f"触及 {len(papers_all)} 篇论文）",
        }
        rq_answer = {
            "rq_id": rid, "rq_text": rq_text.get(rid, ""),
            "overall_answer": overall, "sub_rq_answers": subs_answers,
            "key_claims": claims,
        }

        (rq_dir / "working_memory.json").write_text(
            json.dumps(working_memory, ensure_ascii=False, indent=1), encoding="utf-8")
        (rq_dir / "answer_claims.json").write_text(
            json.dumps(answer_claims, ensure_ascii=False, indent=1), encoding="utf-8")
        (rq_dir / "rq_answer.json").write_text(
            json.dumps(rq_answer, ensure_ascii=False, indent=1), encoding="utf-8")

        index_entries.append({
            "rq_id": rid, "rq_text": rq_text.get(rid, ""),
            "rq_type": "", "total_papers": len(papers_all),
            "engine": "kg_analysis_v3", "skill_used": "+".join(skills),
            "answer_completeness": answer_claims["answer_completeness"],
        })
        print(f"[v3->w5] {rid} → {rq_dir}（子分析 {len(sub_ids)} 个，claims {len(claims)}，"
              f"触及论文 {len(papers_all)}）")

    out.mkdir(parents=True, exist_ok=True)
    (out / "WORKING_MEMORY_INDEX.json").write_text(
        json.dumps({"rq_count": len(index_entries), "rqs": index_entries},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[v3->w5] 完成：{len(index_entries)} 个 RQ → {out}")
    return 0


def _j(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def paper_ids_touched(tool_calls: list[dict]) -> list[str]:
    """工具调用结果中触及的论文 id（去重保序）。"""
    ids: list[str] = []
    for tc in tool_calls or []:
        raw = tc.get("raw_result")
        text = json.dumps(raw, ensure_ascii=False) if not isinstance(raw, str) else raw
        if not text:
            continue
        for token in re.split(r'["\s,;\[\]{}()]', text):
            if token.startswith("paper_") or (len(token) == 4 and token.isdigit()):
                if token not in ids:
                    ids.append(token)
    return ids[:30]


if __name__ == "__main__":
    raise SystemExit(main())
