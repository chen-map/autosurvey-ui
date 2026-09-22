#!/usr/bin/env python3
"""W3-P4 证据矩阵核验：answerability 分级 + 弱项清单（反思循环的执行器入口）。

兼容 rq_evidence_matrix v2 schema（sub_rq_matrix 列表，含 answerability.support_level/
intercept 与 paper_ids_ranked）：
  strong >=3 篇 · weak 2 篇 · blocked <2 篇或 intercept=true（WORKFLOW3_GUIDE 拦截条件）。
核验结论写入 verify_report.json 并追加到 rq_reflection_log.md；
blocked 不使 pipeline 失败（由后续反思修订阶段改写后重新落地）。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="W3 证据矩阵核验")
    ap.add_argument("--matrix", default="analyze_report/rq_evidence_matrix.json")
    ap.add_argument("--reflection", default="analyze_report/rq_reflection_log.md")
    ap.add_argument("--out", default="analyze_report/verify_report.json")
    args = ap.parse_args()

    matrix_path = Path(args.matrix)
    if not matrix_path.exists():
        print(f"[w3_verify] 证据矩阵缺失: {matrix_path}")
        return 1
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))

    rows: list[dict] = []
    subs = matrix.get("sub_rq_matrix")
    if isinstance(subs, list):  # v2 schema
        for e in subs:
            ans = e.get("answerability") or {}
            n_papers = len(e.get("paper_ids_ranked") or e.get("supporting_papers_ranked") or [])
            intercept = bool(ans.get("intercept")) or n_papers < 2
            level = "blocked" if intercept else ("strong" if n_papers >= 3 else "weak")
            rows.append({
                "rq_id": e.get("rq_id"), "sub_rq_id": e.get("sub_rq_id"),
                "sub_rq_text": e.get("sub_rq_text", ""),
                "papers": n_papers,
                "focus_terms": (e.get("query_plan") or {}).get("focus_terms") or [],
                "score": ans.get("answerability_score"),
                "level": level,
            })
    else:  # 兜底：GUIDE 初版嵌套 schema
        for rq_id, rq in (matrix.items() if isinstance(matrix, dict) else []):
            if not isinstance(rq, dict):
                continue
            for sub_id, sub in (rq.get("sub_rqs") or {}).items():
                if not isinstance(sub, dict):
                    continue
                n_papers = len(sub.get("paper_ids") or [])
                rows.append({
                    "rq_id": rq_id, "sub_rq_id": sub_id, "sub_rq_text": sub.get("sub_rq_text", ""),
                    "papers": n_papers, "score": sub.get("answerability_score"),
                    "level": "strong" if n_papers >= 3 else ("weak" if n_papers == 2 else "blocked"),
                })

    blocked = [r for r in rows if r["level"] == "blocked"]
    summary = {
        "total_sub_rqs": len(rows),
        "strong": sum(1 for r in rows if r["level"] == "strong"),
        "weak": sum(1 for r in rows if r["level"] == "weak"),
        "blocked_count": len(blocked),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(
        {"summary": summary, "blocked_detail": blocked, "rows": rows},
        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = ["", "## 执行器核验（w3_verify）", "",
             f"- Sub-RQ 总数 {summary['total_sub_rqs']}：strong {summary['strong']} · weak {summary['weak']} · blocked {summary['blocked_count']}"]
    for r in blocked:
        lines.append(f"- ⛔ 拦截：{r['sub_rq_id']} 仅 {r['papers']} 篇支撑 —— {r['sub_rq_text'][:60]}（反思修订后重跑查询落地）")
    with open(args.reflection, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"[w3_verify] Sub-RQ {summary['total_sub_rqs']}: strong {summary['strong']} / weak {summary['weak']} / blocked {summary['blocked_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
