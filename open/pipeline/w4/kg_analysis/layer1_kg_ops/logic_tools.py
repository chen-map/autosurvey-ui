"""
logic_tools.py — 逻辑工具（Logic Tools）

提供对实体集合进行集合运算、计数和条件判断的原子操作。

工具列表：
    count      — 计数
    intersect  — 集合交运算
    union      — 集合并运算
    judge      — 条件判断
    end        — 包装最终答案
"""

from __future__ import annotations

from typing import Any

from .tool_trace import traced_tool


# ---------------------------------------------------------------------------
# count
# ---------------------------------------------------------------------------

@traced_tool
def count(entities: list[Any]) -> int:
    """
    返回实体列表的数量。

    Args:
        entities: 任意列表
    Returns:
        列表长度（int）
    """
    return len(entities)


# ---------------------------------------------------------------------------
# intersect
# ---------------------------------------------------------------------------

@traced_tool
def intersect(
    list_a: list[dict[str, Any]],
    list_b: list[dict[str, Any]],
    key: str = "node_id",
) -> list[dict[str, Any]]:
    """
    对两个实体列表按指定 key 字段求交集。
    结果中的 dict 来自 list_a（保留 list_a 的字段内容）。

    Args:
        list_a: 第一个实体列表
        list_b: 第二个实体列表
        key:    用于对比的字段名（默认 "node_id"）
    Returns:
        同时出现在 list_a 和 list_b 中的实体（以 list_a 中的记录为准）
    """
    keys_b = {item[key] for item in list_b if key in item}
    return [item for item in list_a if item.get(key) in keys_b]


# ---------------------------------------------------------------------------
# union
# ---------------------------------------------------------------------------

@traced_tool
def union(
    list_a: list[dict[str, Any]],
    list_b: list[dict[str, Any]],
    key: str = "node_id",
) -> list[dict[str, Any]]:
    """
    对两个实体列表按指定 key 字段求并集，去重后返回。
    重复项优先保留 list_a 中的版本。

    Args:
        list_a: 第一个实体列表
        list_b: 第二个实体列表
        key:    用于去重的字段名（默认 "node_id"）
    Returns:
        去重后的合并列表
    """
    seen: set = set()
    result: list[dict[str, Any]] = []
    for item in list_a + list_b:
        k = item.get(key)
        if k not in seen:
            seen.add(k)
            result.append(item)
    return result


# ---------------------------------------------------------------------------
# judge
# ---------------------------------------------------------------------------

_JUDGE_OPS = {"==", "!=", ">", "<", ">=", "<="}


@traced_tool
def judge(value: Any, op: str, threshold: Any) -> bool:
    """
    对单个值执行条件判断，返回布尔结果。

    Args:
        value:     被判断的值
        op:        运算符（==, !=, >, <, >=, <=）
        threshold: 比较阈值
    Returns:
        判断结果（bool）

    Examples:
        judge(5, ">", 3)    → True
        judge("hot", "==", "hot")  → True
    """
    if op not in _JUDGE_OPS:
        raise ValueError(f"Unsupported op {op!r} for judge. Use: {_JUDGE_OPS}")
    try:
        if op == "==":
            return value == threshold
        if op == "!=":
            return value != threshold
        if op == ">":
            return value > threshold
        if op == "<":
            return value < threshold
        if op == ">=":
            return value >= threshold
        if op == "<=":
            return value <= threshold
    except TypeError:
        return False
    return False


# ---------------------------------------------------------------------------
# end
# ---------------------------------------------------------------------------

@traced_tool
def end(answer: Any, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    将最终分析结果包装为标准化输出格式，标志推理链结束。

    Args:
        answer:   最终答案（可以是字符串、数字、列表、dict 等）
        metadata: 附加元数据（可选），如来源信息、置信度说明
    Returns:
        标准化结果 dict，格式：
        {
            "answer": <answer>,
            "metadata": <metadata or {}>,
            "_done": True
        }
    """
    return {
        "answer": answer,
        "metadata": metadata or {},
        "_done": True,
    }
