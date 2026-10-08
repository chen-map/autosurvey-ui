# -*- coding: utf-8 -*-
"""修复被并发写截断的 w2_state.json：重建四阶段干净状态（P0 done/P1-P3 pending）。"""
import json

P = '/home/G2024hq/asv-app/backend/wm/u3/proj-1791385765971/w1/w2_state.json'
d = {
    "project_id": "proj-1791385765971",
    "started_at": "2026-10-08 10:20:00",
    "updated_at": "2026-10-08 10:50:00",
    "current": None,
    "phases": [
        {"id": "W2-P0", "name": "PDF 批量解析（三级降级）", "status": "done",
         "started_at": "2026-10-08 10:20:00", "ended_at": "2026-10-08 10:20:38",
         "duration_sec": 37.8, "rc": 0,
         "outputs": ["paper_cards/parsed/PARSE_LOG.csv"], "log": "logs/W2-P0.log"},
        {"id": "W2-P1", "name": "结构化对象提取（LLM · 六类对象）", "status": "pending",
         "outputs": ["knowledge_graph/structured_papers.jsonl"], "log": "logs/W2-P1.log"},
        {"id": "W2-P2", "name": "候选对象筛选", "status": "pending",
         "outputs": ["knowledge_graph/candidate_structured_papers.jsonl"], "log": "logs/W2-P2.log"},
        {"id": "W2-P3", "name": "KG 构建（prescore 预评分 + 论文对关系判断）", "status": "pending",
         "outputs": ["knowledge_graph/paper_kg.db", "knowledge_graph/paper_kg.json"],
         "log": "logs/W2-P3.log"},
    ],
}
open(P, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))
json.load(open(P, encoding='utf-8'))
print('w2_state.json 重建 OK（P0 done，P1-P3 pending）')
