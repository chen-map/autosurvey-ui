#!/usr/bin/env python3
"""KG AutoMerge 执行（会议纪要方向 5，保守模式：只合并精确同名，先备份再改数据）。

对 paper_kg.json 与 paper_kg.db 同步执行：
  1. 同类型内 canonical_name 规范化一致的节点组 → 保留度数最高者，其余合并；
  2. 边重接到保留节点；节点别名写入 node_aliases（db）/ description 注记（json）；
  3. 合并后按 (source,target,type) 去重平行边。
词元相似候选（merge_candidates.md 第二节）需人工/LLM 复核，不在本脚本自动范围。
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def main() -> int:
    ap = argparse.ArgumentParser(description="KG AutoMerge 执行（精确同名，先备份）")
    ap.add_argument("--kg-json", default="knowledge_graph/paper_kg.json")
    ap.add_argument("--db", default="knowledge_graph/paper_kg.db")
    ap.add_argument("--execute", action="store_true", help="缺省只做 dry-run 预览")
    args = ap.parse_args()

    kg_path, db_path = Path(args.kg_json), Path(args.db)
    if not kg_path.exists() or not db_path.exists():
        print("[merge_execute] KG 文件缺失")
        return 1

    subprocess.run([sys.executable, str(HERE / "kg_backup.py"), "--label", "pre-automerge",
                    "--paths", str(kg_path), str(db_path)], check=False)

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    nodes = kg.get("nodes", [])
    deg: dict[str, int] = defaultdict(int)
    for e in kg.get("edges", []):
        deg[e.get("source_id", "")] += 1
        deg[e.get("target_id", "")] += 1

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for n in nodes:
        groups[(n.get("node_type"), norm(n.get("canonical_name", "")))].append(n)
    merge_groups = {k: v for k, v in groups.items() if k[1] and len(v) > 1}
    if not merge_groups:
        print("[merge_execute] 无精确同名可合并")
        return 0
    if not args.execute:
        for k, v in merge_groups.items():
            print(f"  [dry-run] {k[0]}: {[n['canonical_name'] for n in v]}")
        print(f"共 {len(merge_groups)} 组，加 --execute 执行")
        return 0

    drop_to_keep: dict[str, tuple[str, str]] = {}  # drop_id → (keep_id, alias_display)
    for (typ, _), members in merge_groups.items():
        members = sorted(members, key=lambda n: -deg.get(n["node_id"], 0))
        keep = members[0]
        for dup in members[1:]:
            drop_to_keep[dup["node_id"]] = (keep["node_id"], dup.get("canonical_name", ""))
            keep["description"] = (keep.get("description") or "")
            if dup.get("canonical_name") and dup["canonical_name"] not in keep["description"]:
                keep["description"] += f" [别名: {dup['canonical_name']}]"
    dropped = set(drop_to_keep)

    kg["nodes"] = [n for n in nodes if n["node_id"] not in dropped]
    seen_edges = set()
    new_edges = []
    dup_edges = 0
    for e in kg.get("edges", []):
        e["source_id"] = drop_to_keep.get(e["source_id"], (e["source_id"],))[0]
        e["target_id"] = drop_to_keep.get(e["target_id"], (e["target_id"],))[0]
        key = (e["source_id"], e["target_id"], e.get("edge_type"))
        if key in seen_edges:
            dup_edges += 1
            continue
        seen_edges.add(key)
        new_edges.append(e)
    kg["edges"] = new_edges
    kg_path.write_text(json.dumps(kg, ensure_ascii=False, indent=2), encoding="utf-8")

    con = sqlite3.connect(str(db_path))
    for drop, (keep, alias) in drop_to_keep.items():
        # 唯一约束冲突（两节点本有相同边）时忽略该行，随后删除指向被并节点的残余边
        con.execute("UPDATE OR IGNORE edges SET source_id=? WHERE source_id=?", (keep, drop))
        con.execute("UPDATE OR IGNORE edges SET target_id=? WHERE target_id=?", (keep, drop))
        con.execute("DELETE FROM edges WHERE source_id=? OR target_id=?", (drop, drop))
        if alias:
            con.execute("INSERT OR REPLACE INTO node_aliases (alias_lower, node_id, alias_display) VALUES (?,?,?)",
                        (alias.lower(), keep, alias))
    con.execute("DELETE FROM nodes WHERE node_id IN (%s)" % ",".join("?" * len(dropped)), tuple(dropped))
    con.commit()
    n_nodes = con.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    n_edges = con.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    con.close()

    print(f"[merge_execute] 合并组 {len(merge_groups)}，删除冗余节点 {len(dropped)}，去重平行边 {dup_edges}；"
          f"JSON 节点 {len(kg['nodes'])}/边 {len(kg['edges'])}，DB 节点 {n_nodes}/边 {n_edges}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
