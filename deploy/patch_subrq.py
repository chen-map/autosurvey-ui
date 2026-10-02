# -*- coding: utf-8 -*-
"""W4 子 RQ 粒度重构（学长思路：小 RQ 才是回答重点，逐个分析后综合）。

A. run_v3_agent.py：collect_rqs（宏 RQ）→ 子 RQ（RQ1.1...），每子 RQ 一次 Agent 分析，
   rq_text 带父问题上下文 + 证据矩阵冻结论文提示。
B. v3_to_w5_adapter.py：按父 RQ 聚合子目录——sub_rq_answers 填真实子答案（W5/P3 直接消费）、
   overall = 子答案拼接、key_claims 合并。
"""
import ast

# ============ A. run_v3_agent.py ============
P1 = 'backend/w4/run_v3_agent.py'
s = open(P1, encoding='utf-8').read()

old_collect = '''def collect_rqs(matrix_path: Path) -> list[dict]:
    """从 W3 证据矩阵提取宏 RQ 列表（rq_id, rq_text），保持首次出现顺序去重。"""
    m = json.loads(matrix_path.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}
    for e in m.get("sub_rq_matrix", []):
        rid = (e.get("rq_id") or "").strip()
        if rid and rid not in seen:
            seen[rid] = e.get("rq_text", "")
    return [{"rq_id": k, "rq_text": v} for k, v in seen.items()]'''
new_collect = '''def collect_rqs(matrix_path: Path) -> list[dict]:
    """从 W3 证据矩阵提取**子 RQ** 列表（学长思路：子 RQ 才是回答重点，逐个分析后综合）。

    返回 [{rq_id: "RQ1.1", rq_text: 子问题文本（含父问题上下文与冻结证据提示）}]；
    无子 RQ 的矩阵回落宏 RQ 粒度。
    """
    m = json.loads(matrix_path.read_text(encoding="utf-8"))
    parent_text: dict[str, str] = {}
    subs: list[dict] = []
    for e in m.get("sub_rq_matrix", []):
        pid = (e.get("rq_id") or "").strip()
        if pid and pid not in parent_text:
            parent_text[pid] = e.get("rq_text", "")
        sid = (e.get("sub_rq_id") or "").strip()
        if not sid or "." not in sid:
            continue
        ev = (e.get("paper_ids_ranked") or [])[:6]
        hint = (f"\\n\\n（证据矩阵为该子问题冻结的论文，可优先用工具查询：{', '.join(ev)}）" if ev else "")
        subs.append({
            "rq_id": sid,
            "rq_text": (f"[父问题 {pid}] {parent_text.get(pid, '')}\\n"
                        f"[本子问题 {sid}] {e.get('sub_rq_text') or e.get('rq_text', '')}{hint}"),
        })
    if subs:
        return subs
    seen: dict[str, str] = {}
    for e in m.get("sub_rq_matrix", []):
        rid = (e.get("rq_id") or "").strip()
        if rid and rid not in seen:
            seen[rid] = e.get("rq_text", "")
    return [{"rq_id": k, "rq_text": v} for k, v in seen.items()]'''
assert s.count(old_collect) == 1
s = s.replace(old_collect, new_collect)
open(P1, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('A. run_v3_agent OK')

# ============ B. v3_to_w5_adapter.py ============
P2 = 'backend/w4/v3_to_w5_adapter.py'
s2 = open(P2, encoding='utf-8').read()

old_scan = '''    # 每个 RQ 取最新一次 run 目录（v3 目录名 {rq_id}_{skill_id}_{ts}）
    runs: dict[str, Path] = {}
    for d in sorted(v3_root.iterdir()):
        if not d.is_dir() or not (d / "03_final_answer.json").exists():
            continue
        rid = d.name.split("_")[0]
        runs[rid] = d  # sorted 顺序下后者覆盖 → 取字典序最新（时间戳后缀保证）
    if not runs:
        raise SystemExit("[v3->w5] 未发现任何含 03_final_answer.json 的运行目录")'''
new_scan = '''    # 子 RQ 粒度目录（RQ1.1_xxx）按父 RQ 聚合；兼容旧宏 RQ 目录（RQ1_xxx）
    runs_by_parent: dict[str, dict[str, Path]] = {}
    for d in sorted(v3_root.iterdir()):
        if not d.is_dir() or not (d / "03_final_answer.json").exists():
            continue
        rid_full = d.name.split("_")[0]
        parent = rid_full.split(".")[0]
        runs_by_parent.setdefault(parent, {})[rid_full] = d
    if not runs_by_parent:
        raise SystemExit("[v3->w5] 未发现任何含 03_final_answer.json 的运行目录")'''
assert s2.count(old_scan) == 1
s2 = s2.replace(old_scan, new_scan)
open(P2, 'w', encoding='utf-8', newline='\n').write(s2)
ast.parse(s2)
print('B1. adapter 扫描 OK（聚合循环体下一步）')
