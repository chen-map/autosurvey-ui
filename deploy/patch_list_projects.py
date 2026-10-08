# -*- coding: utf-8 -*-
"""list_projects 四修（本地 3.11 f-string 校验限制，部署到服务器 3.12 验证）：
1. 项目状态扫全部 5 个工作流 state（原只读 w1——LLM裁判项目 W2 failed 却显示已完成）
2. W5 进度分母 3→4（133% 实测）
3. stats.rqs/claims 接真值（矩阵 macro 数），替代硬编码 0
"""
import ast

P = 'backend/api/main.py'
s = open(P, encoding='utf-8').read()

# 1) status 派生扫全部工作流
old = '''        state_path = cfg_path.parent / "w1_state.json"
        status = "draft"
        if state_path.exists():
            st = json.loads(state_path.read_text(encoding="utf-8"))
            statuses = [p.get("status") for p in st.get("phases", [])]
            if "running" in statuses:
                status = "running"
            elif statuses and all(x == "done" for x in statuses if x):
                status = "completed"
            elif "failed" in statuses:
                status = "failed"'''
new = '''        status = "draft"
        all_statuses: list = []
        for sf in ("w1_state.json", "w2_state.json", "w3_state.json", "w4_state.json", "w5_state.json"):
            sp = cfg_path.parent / sf
            if sp.exists():
                try:
                    all_statuses += [q.get("status") for q in json.loads(sp.read_text(encoding="utf-8")).get("phases", [])]
                except (OSError, json.JSONDecodeError):
                    pass
        if "running" in all_statuses:
            status = "running"
        elif "failed" in all_statuses:
            status = "failed"
        elif all_statuses and all(x == "done" for x in all_statuses if x):
            status = "completed"'''
assert s.count(old) == 1, 'status'
s = s.replace(old, new)

# 2) W5 分母
old2 = '_wf(pid, "W5", "综述写作", "w5_state.json", 3),'
new2 = '_wf(pid, "W5", "综述写作", "w5_state.json", 4),'
assert s.count(old2) == 1, 'w5'
s = s.replace(old2, new2)

# 3) stats 接真值
old3 = '''            "rqs": 0,
            "claims": {"verified": 0, "needsRevision": 0, "shouldRemove": 0},'''
new3 = '''            "rqs": rq_stats.get(pr["project_id"], 0),
            "claims": {"verified": rq_stats.get(pr["project_id"], 0), "needsRevision": 0, "shouldRemove": 0},'''
assert s.count(old3) == 1, 'stats'
s = s.replace(old3, new3)

# 4) rq_stats 计算（kg_stats 循环旁）
old4 = '''    kg_stats = {}
    for pr in projects:
        n = conn.execute("SELECT COUNT(*) c FROM corpus_papers WHERE project_id=? AND status='downloaded'",
                         (pr["project_id"],)).fetchone()["c"]'''
new4 = '''    kg_stats = {}
    rq_stats: dict = {}
    for pr in projects:
        rqj = _wm(pr["project_id"]) / "analyze_report" / "rq_evidence_matrix.json"
        if rqj.exists():
            try:
                mj = json.loads(rqj.read_text(encoding="utf-8"))
                rq_stats[pr["project_id"]] = len(mj.get("rq_matrix") or mj.get("sub_rq_matrix") or [])
            except Exception:
                pass
        n = conn.execute("SELECT COUNT(*) c FROM corpus_papers WHERE project_id=? AND status='downloaded'",
                         (pr["project_id"],)).fetchone()["c"]'''
assert s.count(old4) == 1, 'rq_stats'
s = s.replace(old4, new4)

open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('list_projects 四修 OK')
