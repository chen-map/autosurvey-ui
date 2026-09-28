"""
tool_schemas.py — Layer 1 工具的 Claude tool_use JSON Schema 定义

将 extract_tools.py、logic_tools.py 中的工具函数
转换为 Claude API tool_use 格式的 JSON Schema，
供 LLMSkillAgent 传入 Claude API 的 tools 参数。
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Extract Tools
# ---------------------------------------------------------------------------

_EXTRACT_TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_entity_by_type",
        "description": (
            "从 KG 中按节点类型加载所有实体。返回实体 dict 列表，"
            "每个 dict 含 node_id, node_type, canonical_name, description 等字段。"
            "可用类型：problem, method, paper, dataset, metric, limitation, assumption。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "enum": [
                        "problem", "method", "paper", "dataset",
                        "metric", "limitation", "assumption"
                    ],
                    "description": "要加载的 KG 节点类型",
                }
            },
            "required": ["entity_type"],
        },
    },
    {
        "name": "get_entity_by_constraint",
        "description": (
            "对实体列表按字段条件过滤，返回满足条件的子集。"
            "支持运算符：==, !=, >, <, >=, <=, in, not_in, contains, not_contains。"
            "'in' 操作符要求 value 是列表；'contains' 是子串匹配（大小写不敏感）。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "待过滤的实体列表（来自其他工具的返回值）",
                },
                "field": {
                    "type": "string",
                    "description": "字段名，支持点路径如 'meta.year'",
                },
                "op": {
                    "type": "string",
                    "enum": [
                        "==", "!=", ">", "<", ">=", "<=",
                        "in", "not_in", "contains", "not_contains"
                    ],
                    "description": "过滤运算符",
                },
                "value": {
                    "description": "比较值（标量或列表，取决于 op）",
                },
            },
            "required": ["entities", "field", "op", "value"],
        },
    },
    {
        "name": "get_relation",
        "description": (
            "获取指定实体的所有一跳关系边，返回边 dict 列表。"
            "每条边含 edge_type, source_id, target_id, confidence, evidence 字段。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "目标实体的 node_id",
                },
                "direction": {
                    "type": "string",
                    "enum": ["out", "in", "both"],
                    "description": "'out' 出边 | 'in' 入边 | 'both' 全部（默认）",
                    "default": "both",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "get_head_entity",
        "description": (
            "给定边类型和尾节点 ID，反向查询所有头节点实体。"
            "示例：get_head_entity(edge_type='addresses', tail_id='P-001') "
            "→ 所有 addresses 了 P-001 问题的方法实体。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "edge_type": {
                    "type": "string",
                    "description": "边类型，如 addresses, proposes, has_limitation",
                },
                "tail_id": {
                    "type": "string",
                    "description": "尾节点 node_id",
                },
                "min_confidence": {
                    "type": "number",
                    "description": "最低置信度过滤（0.0~1.0，默认 0.0 不过滤）",
                    "default": 0.0,
                },
            },
            "required": ["edge_type", "tail_id"],
        },
    },
    {
        "name": "get_tail_entity",
        "description": (
            "给定边类型和头节点 ID，正向查询所有尾节点实体。"
            "示例：get_tail_entity(edge_type='has_limitation', head_id='M-001') "
            "→ 方法 M-001 的所有 Limitation 实体。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "edge_type": {
                    "type": "string",
                    "description": "边类型，如 addresses, has_limitation, proposes",
                },
                "head_id": {
                    "type": "string",
                    "description": "头节点 node_id",
                },
                "min_confidence": {
                    "type": "number",
                    "description": "最低置信度过滤（0.0~1.0，默认 0.0 不过滤）",
                    "default": 0.0,
                },
            },
            "required": ["edge_type", "head_id"],
        },
    },
    {
        "name": "get_candidate_entity",
        "description": (
            "实体链接：将文本 mention 映射到 KG 中语义最相似的候选实体列表（Top-K）。"
            "返回结果按相似度降序排列，每个实体附加 _match_score 字段。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mention": {
                    "type": "string",
                    "description": "待链接的文本片段（如从 RQ 中提取的实体名）",
                },
                "entity_type": {
                    "type": "string",
                    "enum": [
                        "problem", "method", "paper", "dataset",
                        "metric", "limitation", "assumption"
                    ],
                    "description": "若指定，只在该类型下搜索；不指定则全类型搜索",
                },
                "topk": {
                    "type": "integer",
                    "description": "返回 Top-K 候选数量（默认 5）",
                    "default": 5,
                },
            },
            "required": ["mention"],
        },
    },
]

# ---------------------------------------------------------------------------
# Logic Tools
# ---------------------------------------------------------------------------

_LOGIC_TOOLS: list[dict[str, Any]] = [
    {
        "name": "count",
        "description": "返回实体列表的数量（整数）。",
        "input_schema": {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "description": "任意列表",
                }
            },
            "required": ["entities"],
        },
    },
    {
        "name": "intersect",
        "description": (
            "对两个实体列表按指定 key 字段求交集。"
            "结果中的 dict 来自 list_a。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "list_a": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "第一个实体列表",
                },
                "list_b": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "第二个实体列表",
                },
                "key": {
                    "type": "string",
                    "description": "对比字段名（默认 'node_id'）",
                    "default": "node_id",
                },
            },
            "required": ["list_a", "list_b"],
        },
    },
    {
        "name": "union",
        "description": (
            "对两个实体列表按指定 key 字段求并集，去重后返回。"
            "重复项优先保留 list_a 的版本。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "list_a": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "第一个实体列表",
                },
                "list_b": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "第二个实体列表",
                },
                "key": {
                    "type": "string",
                    "description": "去重字段名（默认 'node_id'）",
                    "default": "node_id",
                },
            },
            "required": ["list_a", "list_b"],
        },
    },
    {
        "name": "judge",
        "description": "对单个值执行条件判断，返回布尔结果。",
        "input_schema": {
            "type": "object",
            "properties": {
                "value": {"description": "被判断的值"},
                "op": {
                    "type": "string",
                    "enum": ["==", "!=", ">", "<", ">=", "<="],
                    "description": "运算符",
                },
                "threshold": {"description": "比较阈值"},
            },
            "required": ["value", "op", "threshold"],
        },
    },
    {
        "name": "end",
        "description": (
            "将最终分析结果包装为标准化输出，标志推理链结束。"
            "answer 可以是任意结构（字符串、列表、dict）。"
            "调用此工具后分析流程结束，Claude 将基于所有工具结果生成 HTML 报告。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "answer": {
                    "description": "最终分析结果（结构化数据）",
                },
                "metadata": {
                    "type": "object",
                    "description": "附加元数据，如数据统计摘要、置信度说明（可选）",
                },
            },
            "required": ["answer"],
        },
    },
]

# ---------------------------------------------------------------------------
# RAG Tools
# ---------------------------------------------------------------------------

_RAG_TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_paper_sections",
        "description": (
            "基于 embedding 语义检索，从 132 篇 paper card 原文中检索与 query 最相关的段落片段。"
            "当 KG 结构化数据不足以支撑深度分析时，用此工具获取论文原文的具体论述证据。"
            "返回按相关度排序的段落列表，每条含 paper_id、section_name、paragraph_text、score。"
            "典型场景：验证某论文对特定问题的具体论述、获取方法细节、查找贡献声明原文。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索查询文本（自然语言，中英文均可）。"
                                   "例如：'prompt injection attack against tool-use agents'",
                },
                "topk": {
                    "type": "integer",
                    "description": "返回 Top-K 个最相关段落（默认 5，建议 3-10）",
                    "default": 5,
                },
                "paper_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "若指定，只在这些论文中检索（可选，传入 node_id 列表）",
                },
            },
            "required": ["query"],
        },
    },
]

# ---------------------------------------------------------------------------
# 公开接口
# ---------------------------------------------------------------------------

ALL_TOOL_SCHEMAS: list[dict[str, Any]] = _EXTRACT_TOOLS + _LOGIC_TOOLS + _RAG_TOOLS

TOOL_SCHEMA_MAP: dict[str, dict[str, Any]] = {
    t["name"]: t for t in ALL_TOOL_SCHEMAS
}


def get_tools_for_skill(allowed_tools: list[str] | None = None) -> list[dict[str, Any]]:
    """
    返回供 Claude API 使用的工具 Schema 列表。

    Args:
        allowed_tools: Skill .md 中 allowed-tools 字段指定的工具名列表；
                       None 表示返回全部工具。
    """
    if allowed_tools is None:
        return ALL_TOOL_SCHEMAS
    return [t for t in ALL_TOOL_SCHEMAS if t["name"] in allowed_tools]
