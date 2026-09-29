#!/usr/bin/env python3
"""W3 证据矩阵兜底增强（执行器层，存量脚本零改动；改矩阵前自动备份）。

病根（proj-1790652141048 实测）：query_rq_evidence.py 的匹配是纯 LIKE 整串匹配，
LLM 规划的 focus_terms 是抽象长短语（"multi-agent collaboration evaluation" 类）时
字面零命中——该 RQ 论文数 0、判 blocked。

两级递降（用户裁决：长短语拆词匹配是治本，结构钩子只是兜底）：
1. 拆词匹配：focus_terms/paper_text_terms 拆 token（去停用词/去连字符变体），
   逐词 LIKE 标题/摘要/summary，IDF 加权计分（语料全是 multi-agent 论文，
   "multi-agent" 无区分度；mismatch/validity 等稀有词才是排序信号）。
2. 结构兜底：拆词仍零命中时，按 query_plan 节点/边类型钩子查 KG 图补齐。

评分诚实压在 supporting 档（封顶 0.84 / primary 线以下），并标注 boost 来源。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sqlite3
import time
from pathlib import Path

# 研究腔/功能词——无区分度，拆词后剔除
STOPWORDS = {
    "a", "an", "the", "of", "in", "on", "for", "and", "or", "to", "with", "via",
    "how", "what", "whether", "between", "existing", "current", "across", "their",
    "these", "those", "such", "some", "is", "are", "do", "does", "can", "could",
    "should", "there", "exist", "existing", "using", "based", "toward", "towards",
    "study", "survey", "review", "research",
}
TOKEN_RE = re.compile(r"[a-z][a-z0-9-]+")
MIN_TOKEN_LEN = 4


def tokenize(phrases: list[str], limit: int = 16) -> list[str]:
    """长短语 → 去重 token 列表（保序）。连字符词保留原形与去连字符两变体由调用方 LIKE。"""
    seen: list[str] = []
    for ph in phrases or []:
        for tok in TOKEN_RE.findall((ph or "").lower()):
            if len(tok) < MIN_TOKEN_LEN or tok in STOPWORDS:
                continue
            if tok not in seen:
                seen.append(tok)
            if len(seen) >= limit:
                return seen
    return seen


def like_variants(tok: str) -> list[str]:
    """multi-agent → ['multi-agent', 'multi agent', 'multiagent'] 三种标题写法。"""
    if "-" in tok:
        return list(dict.fromkeys([tok, tok.replace("-", " "), tok.replace("-", "")]))
    return [tok]


def qmarks(items: list[str]) -> str:
    return ",".join("?" for _ in items)


def main() -> int:
    ap = argparse.ArgumentParser(description="证据矩阵兜底（0 论文行：拆词匹配优先 + 结构兜底）")
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
    n_papers = conn.execute("SELECT COUNT(*) c FROM papers").fetchone()["c"]
    titles = {r["paper_id"]: r["title"] for r in conn.execute("SELECT paper_id, title FROM papers")}

    def paper_hits(tok: str) -> set[str]:
        """LIKE 命中该词（含连字符变体）的论文集合。"""
        pats, params = [], []
        for v in like_variants(tok):
            pats.append("(title LIKE ? COLLATE NOCASE OR abstract LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE)")
            params += [f"%{v}%"] * 3
        rows = conn.execute(f"SELECT paper_id FROM papers WHERE {' OR '.join(pats)}", params)
        return {r["paper_id"] for r in rows}

    def term_match_papers(phrases: list[str]) -> list[tuple[str, float]]:
        """拆词 + IDF 加权：score = Σ 命中词 idf；命中 ≥2 个不同 token 才入围
        （防"只沾 multi-agent 这类全语料高频词"的无关论文混入——Who2com 实测教训）。"""
        toks = tokenize(phrases)
        if not toks:
            return []
        hits_by_pid: dict[str, set[str]] = {}
        idf_by_tok: dict[str, float] = {}
        for tok in toks:
            hits = paper_hits(tok)
            if not hits:
                continue
            idf_by_tok[tok] = math.log(max(1.05, n_papers / len(hits)))  # 全语料词也留微小权重
            for pid in hits:
                hits_by_pid.setdefault(pid, set()).add(tok)
        scores: dict[str, float] = {}
        for pid, hit_toks in hits_by_pid.items():
            if len(hit_toks) < 2:  # 单词命中（尤其高频词）无主题证据，剔除
                continue
            scores[pid] = sum(idf_by_tok[t] for t in hit_toks)
        return sorted(scores.items(), key=lambda kv: -kv[1])

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

    def fill_row(row: dict) -> str | None:
        qp = row.get("query_plan") or {}
        phrases = list(qp.get("focus_terms") or []) + list(qp.get("paper_text_terms") or [])
        ranked: list[tuple[str, float]] = []
        source, detail = "", {}
        # 第一级：拆词匹配（治本——长短语拆 token 逐词 LIKE，IDF 加权排序）
        ranked = term_match_papers(phrases)
        if ranked:
            source = "term_split"
            detail = {"tokens": tokenize(phrases)[:12]}
        if not ranked:
            # 第二级：结构钩子兜底（拆词仍零命中才走）
            node_types = [t for t in (qp.get("node_type_hints") or []) if t]
            edge_types = [t for t in (qp.get("edge_type_hints") or []) if t]
            if not node_types and not edge_types:
                return None
            raw = struct_papers(node_types, edge_types)
            ranked = sorted(raw.items(), key=lambda kv: -kv[1])
            source = "kg_structural_fallback"
            detail = {"node_types": node_types, "edge_types": edge_types}
        if not ranked:
            return None
        ranked = ranked[: args.max_papers]
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
        if source == "term_split":
            pass  # 拆词命中不需要 node_ids 伪装
        elif detail.get("node_types"):
            nt = detail["node_types"]
            sample = conn.execute(
                f"SELECT node_id FROM nodes WHERE node_type IN ({qmarks(nt)}) "
                f"ORDER BY rowid LIMIT 8", nt)
            row["node_ids"] = [r["node_id"] for r in sample]
        ans = row.get("answerability") if isinstance(row.get("answerability"), dict) else {}
        note = ("拆词匹配：长短语拆 token 逐词匹配，IDF 加权排序"
                if source == "term_split" else
                "结构兜底：按 query_plan 节点/边类型钩子从 KG 图补齐")
        ans.update({"level": "moderate" if len(ids) >= 5 else "limited", "note": note})
        row["answerability"] = ans
        row["boost"] = {"source": source, **detail, "papers_added": len(ids)}
        return source

    touched = []
    for row in data.get("sub_rq_matrix") or []:
        sid = row.get("sub_rq_id") or ""
        if not row.get("paper_ids_ranked") and row.get("rq_id"):
            src = fill_row(row)
            if src:
                touched.append(f"{sid}:+{len(row['paper_ids_ranked'])}({src})")
    for row in data.get("rq_matrix") or []:
        rid = row.get("rq_id") or ""
        if not row.get("paper_ids_ranked"):
            src = fill_row(row)
            if src:
                touched.append(f"{rid}:+{len(row['paper_ids_ranked'])}({src})")
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
    print(f"[matrix_boost] 补齐: {', '.join(touched) if touched else '无需补齐（无 0 论文行）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
