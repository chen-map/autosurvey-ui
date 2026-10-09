# -*- coding: utf-8 -*-
"""加 /w2-pending 检测端点（服务器 3.12 验证）。"""
import ast

P = 'backend/api/main.py'
s = open(P, encoding='utf-8').read()

OLD = '@app.post("/api/projects/{pid}/corpus/{row_id}/upload")'
NEW = '''@app.get("/api/projects/{pid}/w2-pending")
def w2_pending_count(pid: str, user: dict = Depends(_me)):
    """检测：手动上传/新入语料但尚未进入 KG 提取的论文数（前端『补充构建 KG』按钮依据）。"""
    _own_project(pid, user)
    kgj = _wm(pid) / "knowledge_graph" / "structured_papers.jsonl"
    done: set = set()
    if kgj.exists():
        for line in kgj.read_text(encoding="utf-8").splitlines():
            try:
                done.add(str(json.loads(line).get("paper_id") or ""))
            except json.JSONDecodeError:
                pass
    papers_dir = _wm(pid) / "paper_cards" / "parsed"
    pending = [f.stem for f in papers_dir.glob("*.json") if f.stem not in done]
    return {"pending": len(pending), "total_cards": len(list(papers_dir.glob("*.json"))),
            "extracted": len(list(papers_dir.glob("*.json"))) - len(pending)}


@app.post("/api/projects/{pid}/corpus/{row_id}/upload")'''
assert s.count(OLD) == 1
s = s.replace(OLD, NEW)
open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('w2-pending 端点 OK')
