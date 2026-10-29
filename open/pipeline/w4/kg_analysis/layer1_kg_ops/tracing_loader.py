"""
tracing_loader.py — 透明化 KG 操作的追踪包装器

用 TracingKGLoader 包装 KGLoader，拦截所有 load_nodes / load_edges 调用，
记录完整的操作日志（调用方、参数、返回条数、耗时）。

日志结构：
    {
        "op":        "load_edges" | "load_nodes",
        "arg":       边类型 / 节点类型,
        "caller":    调用方（Skill ID + 文件:行号）,
        "hit_cache": bool,
        "result_count": int,
        "elapsed_ms":   float,
    }
"""

from __future__ import annotations

import inspect
import time
from typing import Any

from .kg_loader import KGLoader


class TracingKGLoader:
    """
    透明 KGLoader 包装器。

    所有 load_nodes / load_edges 调用均被拦截并追加到 self.trace_log。
    接口与 KGLoader 完全一致，Skill 代码无需修改即可使用。

    Usage:
        base_loader = KGLoader(kg_root)
        tloader = TracingKGLoader(base_loader)
        # 传入 Skill.run() 代替普通 loader
        result = skill.run(tloader, rq_id, working_memory)
        # 查看操作日志
        for entry in tloader.trace_log:
            print(entry)
    """

    def __init__(self, loader: KGLoader) -> None:
        self._loader = loader
        self.trace_log: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # 拦截核心接口
    # ------------------------------------------------------------------

    def load_nodes(self, node_type: str) -> list[dict[str, Any]]:
        t0 = time.perf_counter()
        hit_cache = node_type in self._loader._node_cache or \
                    node_type.lower() in self._loader._node_cache
        result = self._loader.load_nodes(node_type)
        elapsed = (time.perf_counter() - t0) * 1000

        self.trace_log.append({
            "op": "load_nodes",
            "arg": node_type,
            "caller": _get_caller(),
            "hit_cache": hit_cache,
            "result_count": len(result),
            "elapsed_ms": round(elapsed, 2),
            "sample": _sample(result, n=3),
        })
        return result

    def load_edges(self, edge_type: str) -> list[dict[str, Any]]:
        t0 = time.perf_counter()
        hit_cache = edge_type in self._loader._edge_cache
        result = self._loader.load_edges(edge_type)
        elapsed = (time.perf_counter() - t0) * 1000

        self.trace_log.append({
            "op": "load_edges",
            "arg": edge_type,
            "caller": _get_caller(),
            "hit_cache": hit_cache,
            "result_count": len(result),
            "elapsed_ms": round(elapsed, 2),
            "sample": _sample(result, n=3),
        })
        return result

    # ------------------------------------------------------------------
    # 透传其余接口（不追踪，因为它们内部会调用上面的方法）
    # ------------------------------------------------------------------

    def get_node_by_id(self, node_id: str) -> dict[str, Any] | None:
        return self._loader.get_node_by_id(node_id)

    def available_edge_types(self) -> list[str]:
        return self._loader.available_edge_types()

    def load_paper_index(self) -> list[dict[str, Any]]:
        return self._loader.load_paper_index()

    def load_paper_card(self, paper_id: str) -> dict[str, Any] | None:
        return self._loader.load_paper_card(paper_id)

    def clear_cache(self) -> None:
        self._loader.clear_cache()

    # ------------------------------------------------------------------
    # 透传属性（部分 Skill 直接访问 loader.kg_root）
    # ------------------------------------------------------------------

    @property
    def kg_root(self):
        return self._loader.kg_root

    @property
    def _node_cache(self):
        return self._loader._node_cache

    @property
    def _edge_cache(self):
        return self._loader._edge_cache

    # ------------------------------------------------------------------
    # 日志工具
    # ------------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        """返回操作统计摘要。"""
        total = len(self.trace_log)
        cache_hits = sum(1 for e in self.trace_log if e["hit_cache"])
        by_op: dict[str, int] = {}
        for e in self.trace_log:
            key = f"{e['op']}({e['arg']})"
            by_op[key] = by_op.get(key, 0) + 1

        return {
            "total_calls": total,
            "cache_hits": cache_hits,
            "cache_miss": total - cache_hits,
            "calls_by_op": by_op,
            "total_elapsed_ms": round(
                sum(e["elapsed_ms"] for e in self.trace_log), 2
            ),
        }

    def render_trace(self) -> str:
        """将 trace_log 渲染为人类可读的文本格式。"""
        lines = ["=" * 72, "KG 操作追踪日志", "=" * 72]
        for i, entry in enumerate(self.trace_log, 1):
            cache_tag = "[缓存命中]" if entry["hit_cache"] else "[读磁盘]"
            lines.append(
                f"\n#{i:03d}  {entry['op']}({entry['arg']!r})  "
                f"{cache_tag}  → {entry['result_count']} 条  "
                f"({entry['elapsed_ms']} ms)"
            )
            lines.append(f"      调用方：{entry['caller']}")
            if entry.get("sample"):
                lines.append(f"      前3条样本：")
                for s in entry["sample"]:
                    lines.append(f"        {s}")
        lines.append("\n" + "=" * 72)
        s = self.summary()
        lines.append(
            f"汇总：共 {s['total_calls']} 次调用，"
            f"缓存命中 {s['cache_hits']} 次，"
            f"磁盘读取 {s['cache_miss']} 次，"
            f"总耗时 {s['total_elapsed_ms']} ms"
        )
        lines.append("=" * 72)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _get_caller() -> str:
    """
    从调用栈中找到第一个不属于本文件、layer1_kg_ops 内部的调用帧，
    返回 "skill_id @ file:line" 格式的字符串。
    """
    skip_files = {"tracing_loader.py", "kg_loader.py", "extract_tools.py",
                  "logic_tools.py", "tool_registry.py"}
    stack = inspect.stack()
    for frame_info in stack[2:]:  # 跳过本函数和 load_nodes/load_edges 本身
        filename = frame_info.filename.split("/")[-1]
        if filename not in skip_files:
            return f"{filename}:{frame_info.lineno} in {frame_info.function}()"
    return "unknown"


def _sample(items: list[dict], n: int = 3) -> list[str]:
    """取前 n 条，提取 node_id/edge_type + canonical_name 做简要展示。"""
    result = []
    for item in items[:n]:
        nid = item.get("node_id") or item.get("source_id", "?")
        name = item.get("canonical_name") or item.get("edge_type") or ""
        result.append(f"{nid}  {name[:60]}")
    return result
