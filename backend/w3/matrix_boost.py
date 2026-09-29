#!/usr/bin/env python3
"""W3 证据矩阵结构兜底（执行器层，存量脚本零改动；改矩阵前自动备份）。

病根（proj-1790652141048 实测）：query_rq_evidence.py 的匹配是纯 LIKE 字面匹配，
LLM 规划的 focus_terms 是抽象长短语（"evaluation validity" 类）时字面零命中——
该 RQ 论文数 0、判 blocked；而 query_plan 里带全的 node_type_hints / edge_type_hints
结构钩子完全没被用上（KG 里明明有 Metric×278、measured_by×725）。

本脚本在证据矩阵落地后（P6 steps_tail）跑：对 paper_ids 为空的行，按结构钩子查
KG 图（论文=拥有提示类型节点 / 参与提示类型边的 origin_paper_id）补齐证据论文。
评分诚实压在 supporting/background 档（封顶 0.84，不冒充 strong），并标注 boost 来源。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import time
from pathlib import Path


def qmarks(items: list[str]) -> str:
    return ",".join("?" for _ in items)


def main() -> int:
    ap = argparse.ArgumentParser(description="证据矩阵结构兜底（0 论文行按 KG 图补齐）")
    ap.add_argument("--matrix", required=True, help="rq_evidence_matrix.json")
    ap.add_argument("--db", required=True, help="paper_kg.db")
    ap.add_argument("--max-papers", type=int, default=12)
    args = ap.parse_args()

    matrix_path = Path(args.matrix)
    data = json.loads(matrix_path.read_text(encoding="utf-8"))
    thresholds = (data.get("selection_policy") or {}).get("role_thresholds") or {}
    sup_th = float(thresholds.get("supporting_evidence", 0.65))
    bg_th = float(thresholds.get("background", 0.45))
    primary_cap = sup_th  # 兜底证据不冒充 primary

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    def struct_papers(node_types: list[str], edge_types: list[str]) -> dict[str, float]:
        """论文得分 = 拥有提示类型节点数 + 0.5×参与提示类型边数。"""
        scores: dict[str, float] = {}
        if node_types:
            for r in conn.execute(
                f"SELECT origin_paper_id pid, COUNT(*) c FROM nodes "
                f"WHERE node_type IN ({qmarks(node_types)}) "
                f"AND origin_paper_id IS NOT NULL AND TRIM(origin_paper_id)!='' "
                f"GROUP BY 1", node_types):
                scores[r["pid"]] = scores.get(r["pid"], 0.0) + float(r["c"])
        if edge_types:
            for r in conn.execute(
                f"SELECT n.origin_paper_id pid, COUNT(*) c FROM edges e "
                f"JOIN nodes n ON n.node_id IN (e.source_id, e.target_id) "
                f"WHERE e.edge_type IN ({qmarks(edge_types)}) "
                f"AND n.origin_paper_id IS NOT NULL AND TRIM(n.origin_paper_id)!='' "
                f"GROUP BY 1", edge_types):
                scores[r["pid"]] = scores.get(r["pid"], 0.0) + 0.5 * float(r["c"])
        return scores

    titles = {r["paper_id"]: r["title"] for r in conn.execute("SELECT paper_id, title FROM papers")}

    def fill_row(row: dict, sid: str) -> int:
        qp = row.get("query_plan") or {}
        node_types = [t for t in (qp.get("node_type_hints") or []) if t]
        edge_types = [t for t in (qp.get("edge_type_hints") or []) if t]
        if not node_types and not edge_types:
            return 0
        raw = struct_papers(node_types, edge_types)
        ranked = sorted(raw.items(), key=lambda kv: -kv[1])[: args.max_papers]
        if not ranked:
            return 0
        top = ranked[0][1] or 1.0
        ids, scores, roles = [], [], []
        for pid, sc in ranked:
            rel = round(min(primary_cap, bg_th + 0.2 * (sc / top)), 2)  # 相对强度映射，封顶 supporting
            ids.append(pid)
            scores.append(rel)
            roles.append("supporting_evidence" if rel >= sup_th else "background")
        row["paper_ids_ranked"] = ids
        row["paper_scores"] = scores
        row["paper_roles"] = roles
        row["paper_titles"] = [titles.get(p, p) for p in ids]
        if node_types:
            sample = conn.execute(
                f"SELECT node_id FROM nodes WHERE node_type IN ({qmarks(node_types)}) "
                f"ORDER BY rowid LIMIT 8", node_types)
            row["node_ids"] = [r["node_id"] for r in sample]
        else:
            row["node_ids"] = row.get("node_ids") or []
        ans = row.get("answerability") if isinstance(row.get("answerability"), dict) else {}
        ans.update({"level": "moderate" if len(ids) >= 5 else "limited",
                    "note": "结构兜底：focus_terms 字面零命中，按 query_plan 节点/边类型钩子从 KG 图补齐"})
        row["answerability"] = ans
        row["boost"] = {"source": "kg_structural_fallback",
                        "node_types": node_types, "edge_types": edge_types,
                        "papers_added": len(ids)}
        return len(ids)

    touched = []
    for row in data.get("sub_rq_matrix") or []:
        sid = row.get("sub_rq_id") or ""
        if not row.get("paper_ids_ranked") and row.get("rq_id"):
            n = fill_row(row, sid)
            if n:
                touched.append(f"{sid}:+{n}")
    for row in data.get("rq_matrix") or []:
        rid = row.get("rq_id") or ""
        if not row.get("paper_ids_ranked"):
            n = fill_row(row, rid)
            if n:
                touched.append(f"{rid}:+{n}")
    for key, idx in (data.get("indexes") or {}).items():
        if isinstance(idx, dict):
            for row in data.get("sub_rq_matrix") or []:
                sid = row.get("sub_rq_id") or ""
                if idx.get(sid) == [] and row.get("paper_ids_ranked"):
                    idx[sid] = row["paper_ids_ranked"]
            for row in data.get("rq_matrix") or []:
                rid = row.get("rq_id") or ""
                if idx.get(rid) == [] and row.get("paper_ids_ranked"):
                    idx[rid] = row["paper_ids_ranked"]

    if touched:
        backup = matrix_path.with_suffix(f".pre_boost_{int(time.time())}.json")
        shutil.copy2(matrix_path, backup)
        matrix_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[matrix_boost] 备份: {backup.name}")
    print(f"[matrix_boost] 补齐: {', '.join(touched) if touched else '无需补齐（无 0 论文行或无结构钩子）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
