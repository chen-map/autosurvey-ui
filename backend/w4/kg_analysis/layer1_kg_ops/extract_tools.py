"""
extract_tools.py — 提取工具（Extraction Tools）

提供从 KG 中提取实体、关系、头/尾节点的原子操作。
这些工具是 Skill 执行层调用 KG 的标准接口。

工具列表：
    get_entity_by_type       — 按类型获取所有实体
    get_entity_by_constraint — 按字段条件过滤实体
    get_relation             — 获取实体的所有一跳关系边
    get_head_entity          — 沿边类型反向查询头实体
    get_tail_entity          — 沿边类型正向查询尾实体
    get_candidate_entity     — 文本 mention → KG 实体候选（实体链接）
"""

from __future__ import annotations

from typing import Any

from .kg_loader import KGLoader
from .tool_trace import traced_tool


# ---------------------------------------------------------------------------
# get_entity_by_type
# ---------------------------------------------------------------------------

@traced_tool
def get_entity_by_type(loader: KGLoader, entity_type: str) -> list[dict[str, Any]]:
    """
    按类型返回 KG 中所有匹配的实体。

    Args:
        loader: KGLoader 实例
        entity_type: 节点类型，如 "problem", "method", "paper", "dataset",
                     "metric", "limitation", "assumption"
    Returns:
        实体 dict 列表
    """
    return loader.load_nodes(entity_type)


# ---------------------------------------------------------------------------
# get_entity_by_constraint
# ---------------------------------------------------------------------------

_SUPPORTED_OPS = {"==", "!=", ">", "<", ">=", "<=", "in", "contains", "not_in", "not_contains"}


@traced_tool
def get_entity_by_constraint(
    entities: list[dict[str, Any]],
    field: str,
    op: str,
    value: Any,
) -> list[dict[str, Any]]:
    """
    按字段条件过滤实体列表（支持链式调用）。

    Args:
        entities: 待过滤的实体列表
        field:    实体字段名，支持点路径如 "meta.year"
        op:       运算符，支持 ==, !=, >, <, >=, <=, in, contains,
                  not_in, not_contains
        value:    比较值
    Returns:
        满足条件的实体 dict 列表

    Examples:
        # 取置信度 > 0.8 的方法
        methods = get_entity_by_type(loader, "method")
        high_conf = get_entity_by_constraint(methods, "confidence", ">", 0.8)

        # 取 origin_paper_id 在指定论文集合中的问题
        problems = get_entity_by_type(loader, "problem")
        filtered = get_entity_by_constraint(problems, "origin_paper_id", "in", {"p001", "p002"})
    """
    if op not in _SUPPORTED_OPS:
        raise ValueError(f"Unsupported operator {op!r}. Supported: {_SUPPORTED_OPS}")

    result = []
    for entity in entities:
        field_val = _get_nested(entity, field)
        if field_val is None:
            continue
        if _match(field_val, op, value):
            result.append(entity)
    return result


def _get_nested(obj: dict, path: str) -> Any:
    """支持 'a.b.c' 格式的嵌套字段访问。"""
    parts = path.split(".")
    cur = obj
    for part in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _match(field_val: Any, op: str, value: Any) -> bool:
    try:
        if op == "==":
            return field_val == value
        if op == "!=":
            return field_val != value
        if op == ">":
            return field_val > value
        if op == "<":
            return field_val < value
        if op == ">=":
            return field_val >= value
        if op == "<=":
            return field_val <= value
        if op == "in":
            return field_val in value
        if op == "not_in":
            return field_val not in value
        if op == "contains":
            return str(value).lower() in str(field_val).lower()
        if op == "not_contains":
            return str(value).lower() not in str(field_val).lower()
    except (TypeError, ValueError):
        return False
    return False


# ---------------------------------------------------------------------------
# get_relation
# ---------------------------------------------------------------------------

@traced_tool
def get_relation(
    loader: KGLoader,
    entity_id: str,
    direction: str = "both",
) -> list[dict[str, Any]]:
    """
    获取指定实体的所有一跳关系边。

    Args:
        loader:    KGLoader 实例
        entity_id: 目标实体的 node_id
        direction: "out"（出边）| "in"（入边）| "both"（全部，默认）
    Returns:
        边 dict 列表，每条边含 edge_type, source_id, target_id,
        confidence, evidence 等字段
    """
    if direction not in ("out", "in", "both"):
        raise ValueError(f"direction must be 'out', 'in', or 'both', got {direction!r}")

    result = []
    for edge_type in loader.available_edge_types():
        for edge in loader.load_edges(edge_type):
            is_source = edge.get("source_id") == entity_id
            is_target = edge.get("target_id") == entity_id
            if direction == "out" and is_source:
                result.append(edge)
            elif direction == "in" and is_target:
                result.append(edge)
            elif direction == "both" and (is_source or is_target):
                result.append(edge)
    return result


# ---------------------------------------------------------------------------
# get_head_entity
# ---------------------------------------------------------------------------

@traced_tool
def get_head_entity(
    loader: KGLoader,
    edge_type: str,
    tail_id: str,
    min_confidence: float = 0.0,
) -> list[dict[str, Any]]:
    """
    给定边类型和尾节点 ID，反向查询所有头节点实体。

    Args:
        loader:         KGLoader 实例
        edge_type:      边类型名，如 "addresses", "proposes"
        tail_id:        尾节点 node_id
        min_confidence: 最低置信度阈值（默认 0.0，不过滤）
    Returns:
        头节点实体 dict 列表（从 KG 节点表中查找）
    """
    edges = loader.load_edges(edge_type)
    head_ids = [
        e["source_id"]
        for e in edges
        if e.get("target_id") == tail_id
        and e.get("confidence", 1.0) >= min_confidence
    ]
    return _resolve_entities(loader, head_ids)


# ---------------------------------------------------------------------------
# get_tail_entity
# ---------------------------------------------------------------------------

@traced_tool
def get_tail_entity(
    loader: KGLoader,
    edge_type: str,
    head_id: str,
    min_confidence: float = 0.0,
) -> list[dict[str, Any]]:
    """
    给定边类型和头节点 ID，正向查询所有尾节点实体。

    Args:
        loader:         KGLoader 实例
        edge_type:      边类型名，如 "addresses", "proposes"
        head_id:        头节点 node_id
        min_confidence: 最低置信度阈值（默认 0.0，不过滤）
    Returns:
        尾节点实体 dict 列表（从 KG 节点表中查找）
    """
    edges = loader.load_edges(edge_type)
    tail_ids = [
        e["target_id"]
        for e in edges
        if e.get("source_id") == head_id
        and e.get("confidence", 1.0) >= min_confidence
    ]
    return _resolve_entities(loader, tail_ids)


def _resolve_entities(loader: KGLoader, node_ids: list[str]) -> list[dict[str, Any]]:
    """将 node_id 列表解析为实体 dict 列表。"""
    id_set = set(node_ids)
    result = []
    for node_type in ("problem", "method", "paper", "dataset", "metric", "limitation", "assumption"):
        for node in loader.load_nodes(node_type):
            if node.get("node_id") in id_set:
                result.append(node)
                id_set.discard(node.get("node_id"))
        if not id_set:
            break
    # 未找到的 ID 以占位 dict 返回，避免静默丢失
    for missing_id in id_set:
        result.append({"node_id": missing_id, "node_type": "unknown", "canonical_name": missing_id})
    return result


# ---------------------------------------------------------------------------
# get_candidate_entity
# ---------------------------------------------------------------------------

@traced_tool
def get_candidate_entity(
    loader: KGLoader,
    mention: str,
    entity_type: str | None = None,
    topk: int = 5,
) -> list[dict[str, Any]]:
    """
    实体链接：将文本 mention 映射到 KG 中最相似的候选实体。
    使用 canonical_name 和 label 字段的子串/包含匹配，
    再结合 Jaccard 字符级相似度排序。

    Args:
        loader:      KGLoader 实例
        mention:     待链接的文本（如从 RQ 中提取的实体名）
        entity_type: 若指定，只在该类型下搜索
        topk:        返回 Top-K 候选（默认 5）
    Returns:
        按相似度从高到低排序的候选实体列表，每个实体附加 _match_score 字段
    """
    mention_lower = mention.lower()
    mention_tokens = set(mention_lower.split())

    node_types = [entity_type] if entity_type else list(
        ("problem", "method", "paper", "dataset", "metric", "limitation", "assumption")
    )

    scored: list[tuple[float, dict]] = []
    for nt in node_types:
        for node in loader.load_nodes(nt):
            name = (node.get("canonical_name") or node.get("label") or "").lower()
            if not name:
                continue
            score = _jaccard_token_sim(mention_tokens, set(name.split()))
            # 子串精确匹配加分
            if mention_lower in name or name in mention_lower:
                score += 0.5
            if score > 0:
                node_copy = dict(node)
                node_copy["_match_score"] = round(score, 4)
                scored.append((score, node_copy))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:topk]]


def _jaccard_token_sim(tokens_a: set[str], tokens_b: set[str]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    inter = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    return inter / union if union else 0.0


# ---------------------------------------------------------------------------
# get_evidence_papers
# ---------------------------------------------------------------------------

@traced_tool
def get_evidence_papers(
    loader: KGLoader,
    node_id: str,
) -> list[dict[str, Any]]:
    """
    为指定节点找回所有来源论文，解决 origin_paper_id 为 null 的断链问题。

    策略（按优先级依次尝试）：
    1. 若节点的 origin_paper_id 非 null，直接返回对应的 paper 节点。
    2. 遍历所有边，收集以该节点为 source 或 target 的边上的 context_paper_id。
    3. 对收集到的 paper_id 集合，从 KG papers 节点表中查找并返回。

    Args:
        loader:  KGLoader 实例
        node_id: 目标节点的 node_id

    Returns:
        来源论文节点 dict 列表，每条记录含 paper_id、title、year、venue 等字段。
        若完全找不到来源，返回空列表（不抛异常）。

    Example:
        papers = get_evidence_papers(loader, "problem_problem_action_space_hijacking_6d3a3a7371")
        # → [{"paper_id": "001_formal_...", "title": "...", ...}]
    """
    # 先尝试 origin_paper_id 直接路径
    node = loader.get_node_by_id(node_id)
    origin_pid = node.get("origin_paper_id") if node else None

    paper_ids: set[str] = set()
    if origin_pid:
        paper_ids.add(origin_pid)

    # 从所有边的 context_paper_id 收集来源
    for edge_type in loader.available_edge_types():
        for edge in loader.load_edges(edge_type):
            if edge.get("source_id") == node_id or edge.get("target_id") == node_id:
                cpid = edge.get("context_paper_id")
                if cpid:
                    paper_ids.add(cpid)

    if not paper_ids:
        return []

    # 从 papers 节点表中查找匹配记录
    result = []
    for paper in loader.load_nodes("paper"):
        pid = paper.get("paper_id") or paper.get("node_id") or ""
        if pid in paper_ids:
            result.append(paper)
            paper_ids.discard(pid)
        if not paper_ids:
            break

    return result
