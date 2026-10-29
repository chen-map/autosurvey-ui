"""
kg_loader.py — KG 数据加载器

负责从 KG 根目录加载所有节点、边、论文元数据。
提供带缓存的懒加载接口，避免重复读取大文件。
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


# 节点类型 → 文件名映射
_NODE_FILE_MAP: dict[str, str] = {
    "problem": "problems.json",
    "method": "methods.json",
    "paper": "papers.json",
    "dataset": "datasets_benchmarks.json",
    "metric": "metrics.json",
    "limitation": "limitations.json",
    "assumption": "assumptions_constraints.json",
}

# node_type 字段值 → 规范化 key 映射（KG 中存的是首字母大写形式）
_NODE_TYPE_NORMALIZE: dict[str, str] = {
    "Problem": "problem",
    "Method": "method",
    "Paper": "paper",
    "Dataset": "dataset",
    "Metric": "metric",
    "Limitation": "limitation",
    "Assumption": "assumption",
    # autoSurvey 真实 KG 的原生存法（kg_adapter 直通，不做改名）
    "DatasetBenchmark": "dataset",
    "AssumptionConstraint": "assumption",
    # 也支持小写直接传入
    **{k: k for k in _NODE_FILE_MAP},
}


class KGLoader:
    """
    KG 数据加载器。

    用法：
        loader = KGLoader("/path/to/knowledge_graph")
        problems = loader.load_nodes("problem")
        edges = loader.load_edges("addresses")
    """

    def __init__(self, kg_root: str) -> None:
        self.kg_root = Path(kg_root).resolve()
        if not self.kg_root.exists():
            raise FileNotFoundError(f"KG root not found: {self.kg_root}")
        self._node_cache: dict[str, list[dict]] = {}
        self._edge_cache: dict[str, list[dict]] = {}

    # ------------------------------------------------------------------
    # 节点加载
    # ------------------------------------------------------------------

    def load_nodes(self, node_type: str) -> list[dict[str, Any]]:
        """
        加载指定类型的节点列表。

        Args:
            node_type: 节点类型，不区分大小写。
                       支持 "problem", "method", "paper", "dataset",
                       "metric", "limitation", "assumption"
        Returns:
            节点 dict 列表，每个节点包含 node_id, node_type,
            canonical_name, description, origin_paper_id 等字段。
        """
        key = _NODE_TYPE_NORMALIZE.get(node_type, node_type.lower())
        if key in self._node_cache:
            return self._node_cache[key]

        filename = _NODE_FILE_MAP.get(key)
        if filename is None:
            raise ValueError(
                f"Unknown node_type: {node_type!r}. "
                f"Valid types: {list(_NODE_FILE_MAP)}"
            )

        path = self.kg_root / "nodes" / filename
        if not path.exists():
            return []

        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        nodes = data if isinstance(data, list) else list(data.values())
        self._node_cache[key] = nodes
        return nodes

    def get_node_by_id(self, node_id: str) -> dict[str, Any] | None:
        """按 node_id 精确查找节点（遍历所有类型）。"""
        for key in _NODE_FILE_MAP:
            for node in self.load_nodes(key):
                if node.get("node_id") == node_id:
                    return node
        return None

    # ------------------------------------------------------------------
    # 边加载
    # ------------------------------------------------------------------

    def load_edges(self, edge_type: str) -> list[dict[str, Any]]:
        """
        加载指定类型的边列表。

        Args:
            edge_type: 边类型名称，对应 edges/ 目录下的文件名（不含 .json）。
                       例如 "addresses", "proposes", "extends"
        Returns:
            边 dict 列表，每条边包含 source_id, source_type, target_id,
            target_type, edge_type, confidence, evidence 等字段。
        """
        if edge_type in self._edge_cache:
            return self._edge_cache[edge_type]

        path = self.kg_root / "edges" / f"{edge_type}.json"
        if not path.exists():
            return []

        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        edges = data if isinstance(data, list) else list(data.values())
        self._edge_cache[edge_type] = edges
        return edges

    def available_edge_types(self) -> list[str]:
        """返回 edges/ 目录下所有可用的边类型名称。"""
        edge_dir = self.kg_root / "edges"
        if not edge_dir.exists():
            return []
        return [p.stem for p in edge_dir.glob("*.json")]

    # ------------------------------------------------------------------
    # 论文元数据
    # ------------------------------------------------------------------

    def load_paper_index(self) -> list[dict[str, Any]]:
        """
        返回所有论文节点（等价于 load_nodes("paper")）。
        每条记录含 node_id（即 paper_id）, canonical_name, description 等。
        """
        return self.load_nodes("paper")

    def load_paper_card(self, paper_id: str) -> dict[str, Any] | None:
        """
        按 paper_id 返回论文节点详情。
        paper_id 支持 node_id 或 origin_paper_id 两种形式。
        """
        for paper in self.load_nodes("paper"):
            if paper.get("node_id") == paper_id or paper.get("origin_paper_id") == paper_id:
                return paper
        return None

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------

    def clear_cache(self) -> None:
        """清空内存缓存，强制下次重新读取文件。"""
        self._node_cache.clear()
        self._edge_cache.clear()

    def __repr__(self) -> str:
        return f"KGLoader(kg_root={self.kg_root!r})"
