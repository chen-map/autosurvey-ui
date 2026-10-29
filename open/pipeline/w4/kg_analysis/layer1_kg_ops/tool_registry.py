"""
tool_registry.py — 工具注册表（Tool Registry）

将所有底层工具统一注册到 TOOL_REGISTRY 字典中，
提供 call_tool() 统一反射调用入口，供 Layer 3 Agent 动态派发使用。

注册格式：
    TOOL_REGISTRY[tool_name] = callable

调用方式：
    result = call_tool("get_entity_by_type", loader=loader, entity_type="problem")
"""

from __future__ import annotations

from typing import Any, Callable

from .extract_tools import (
    get_candidate_entity,
    get_entity_by_constraint,
    get_entity_by_type,
    get_evidence_papers,
    get_head_entity,
    get_relation,
    get_tail_entity,
)
from .logic_tools import count, end, intersect, judge, union
from .semantic_tools import disambiguate_entity, retrieve_relation, search_paper_sections

# ---------------------------------------------------------------------------
# 注册表
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, Callable] = {
    # ── 提取工具 ──
    "get_entity_by_type": get_entity_by_type,
    "get_entity_by_constraint": get_entity_by_constraint,
    "get_relation": get_relation,
    "get_head_entity": get_head_entity,
    "get_tail_entity": get_tail_entity,
    "get_candidate_entity": get_candidate_entity,
    "get_evidence_papers": get_evidence_papers,
    # ── 逻辑工具 ──
    "count": count,
    "intersect": intersect,
    "union": union,
    "judge": judge,
    "end": end,
    # ── 语义工具 ──
    "retrieve_relation": retrieve_relation,
    "disambiguate_entity": disambiguate_entity,
    "search_paper_sections": search_paper_sections,
}

# ---------------------------------------------------------------------------
# 统一调用入口
# ---------------------------------------------------------------------------

def call_tool(name: str, **kwargs: Any) -> Any:
    """
    按工具名调用对应工具函数。

    Args:
        name:   工具名称（必须在 TOOL_REGISTRY 中）
        **kwargs: 传递给工具函数的关键字参数
    Returns:
        工具函数的返回值
    Raises:
        KeyError: 工具名不存在时
        TypeError: 参数不匹配时（由工具函数自身抛出）

    Example:
        problems = call_tool("get_entity_by_type", loader=loader, entity_type="problem")
        n = call_tool("count", entities=problems)
    """
    if name not in TOOL_REGISTRY:
        available = list(TOOL_REGISTRY.keys())
        raise KeyError(
            f"Tool {name!r} not found. Available tools:\n  " + "\n  ".join(available)
        )
    return TOOL_REGISTRY[name](**kwargs)


def list_tools() -> list[str]:
    """返回所有已注册工具的名称列表。"""
    return list(TOOL_REGISTRY.keys())


def tool_help(name: str) -> str:
    """返回指定工具的 docstring。"""
    if name not in TOOL_REGISTRY:
        return f"Tool {name!r} not found."
    return TOOL_REGISTRY[name].__doc__ or "(no docstring)"
