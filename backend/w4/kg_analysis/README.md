# KG Analysis Project

基于论文知识图谱（KG）的 RQ 级别分析框架，LLM 驱动三层架构：

```
┌─────────────────────────────────────────┐
│  LLM Agent (layer3_llm_agent/)          │  ← Claude API 驱动，自动选 Skill，自主推理
├─────────────────────────────────────────┤
│  Layer 2: Skill 规范 (layer2_skills/)   │  ← 37 个分析策略，Markdown 声明式定义
├─────────────────────────────────────────┤
│  Layer 1: KG Ops (layer1_kg_ops/)       │  ← 原子工具：提取 / 逻辑 / 语义
└─────────────────────────────────────────┘
```

## 快速开始

```bash
pip install anthropic
```

```python
from kg_analysis.layer3_llm_agent import LLMSkillAgent

agent = LLMSkillAgent(
    kg_root="/Users/fanfengrui/Documents/Text2DSL/skills/KG_construction/knowledge_graph",
    skills_root="kg_analysis/layer2_skills",
    output_dir="outputs",
    paper_cards_root="/Users/fanfengrui/Documents/Text2DSL/skills/KG_construction/paper_cards/parsed",  # 可选：启用 RAG 原文检索
)
result = agent.run_skill(
    skill_id=None,  # 缺省 → Claude 自动从 37 个 Skill 中选最合适的
    rq_text="这个领域的研究问题有哪些类型？是否存在研究空白？",
    rq_id="RQ_001",
)
# 每次运行在 outputs/working_memory/{rq_id}_{skill_id}_{ts}/ 下生成 6 个文件：
# 00_meta.json / 01_tool_calls.json / 02_reasoning_trace.json /
# 03_final_answer.json / 04_html_sections.json / 05_report.html
print(result["working_memory_dir"])
```

## 项目结构

```
kg_analysis/
├── PROGRESS.md                     ← 整体进度（从这里看全局状态）
├── layer1_kg_ops/                  ← 底层：KG 原子操作工具
│   ├── PROGRESS_L1.md
│   ├── kg_loader.py
│   ├── extract_tools.py
│   ├── logic_tools.py
│   ├── semantic_tools.py
│   └── tool_registry.py
├── layer2_skills/                  ← 中层：37 个 Skill 分析策略（Markdown 规范）
│   ├── problem_space/              ← Problem Space（21 Skills，A1.x-x）
│   └── solution_space/             ← Solution Space（16 Skills，B2.x-x）
├── layer3_llm_agent/               ← 顶层：LLM Agent
│   ├── llm_skill_agent.py
│   ├── skill_loader.py
│   ├── tool_schemas.py
│   └── html_renderer.py
└── tests/
    ├── test_layer1.py
    └── test_layer2.py
```

## KG 数据 Schema

**节点（nodes/）**

| 文件 | node_type | 关键字段 |
|------|-----------|---------|
| problems.json | Problem | node_id, canonical_name, description, origin_paper_id |
| methods.json | Method | node_id, canonical_name, description, origin_paper_id |
| papers.json | Paper | node_id, canonical_name, description |
| datasets_benchmarks.json | Dataset | node_id, canonical_name, description |
| metrics.json | Metric | node_id, canonical_name, description |
| limitations.json | Limitation | node_id, canonical_name, description |

**边（edges/）**

| 文件 | edge_type | 语义 |
|------|-----------|------|
| addresses.json | addresses | Paper → Problem |
| proposes.json | proposes | Paper → Method |
| extends.json | extends | Method → Method |
| compares_with.json | compares_with | Paper → Paper/Method |
| evaluated_on.json | evaluated_on | Method → Dataset |
| measured_by.json | measured_by | Method → Metric |
| has_limitation.json | has_limitation | Paper/Method → Limitation |
| requires.json | requires | Method → Assumption |
| contradicts.json | contradicts | Paper → Paper |
| supports.json | supports | Paper → Paper |
| targets.json | targets | Method → Problem |
| relaxes.json | relaxes | Method → Assumption |

所有边通用字段：`source_id, source_type, target_id, target_type, edge_type, confidence, evidence, context_paper_id, created_at`
