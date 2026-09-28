"""
tool_trace.py — Layer 1 工具调用追踪系统

通过 contextvars 在当前异步/线程上下文中维护一个 TraceCollector。
所有被 @traced_tool 装饰的工具函数，调用时自动记录：
  - 工具名、参数摘要、返回值摘要、耗时、调用方文件:行号

Skill 代码无需任何修改。
"""

from __future__ import annotations

import functools
import inspect
import time
from contextvars import ContextVar
from typing import Any, Callable

# 当前上下文中活跃的 TraceCollector（无则为 None）
_active_collector: ContextVar["TraceCollector | None"] = ContextVar(
    "_active_collector", default=None
)


# ---------------------------------------------------------------------------
# TraceCollector — 收集单个 Skill 执行期间的所有工具调用
# ---------------------------------------------------------------------------

class TraceCollector:
    """
    收集一次 Skill 执行中所有 Layer 1 工具调用的记录。

    每条记录结构：
        {
            "seq":        int,          # 调用序号（从 1 开始）
            "tool":       str,          # 工具函数名
            "args_repr":  dict,         # 参数摘要（截断大列表）
            "result_repr": Any,         # 返回值摘要
            "result_count": int | None, # 若返回列表，其长度
            "elapsed_ms": float,
            "caller":     str,          # 调用方 file:line in func()
        }
    """

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []
        self._seq = 0

    def record(
        self,
        tool: str,
        args_repr: dict[str, Any],
        result: Any,
        elapsed_ms: float,
        caller: str,
    ) -> None:
        self._seq += 1
        result_repr, result_count = _summarize_result(result)
        self.records.append({
            "seq": self._seq,
            "tool": tool,
            "args_repr": args_repr,
            "result_repr": result_repr,
            "result_count": result_count,
            "elapsed_ms": round(elapsed_ms, 3),
            "caller": caller,
        })

    def summary(self) -> dict[str, Any]:
        from collections import Counter
        tool_counts = Counter(r["tool"] for r in self.records)
        return {
            "total_calls": len(self.records),
            "calls_by_tool": dict(tool_counts),
            "total_elapsed_ms": round(sum(r["elapsed_ms"] for r in self.records), 3),
        }

    def render(self) -> str:
        """渲染为人类可读的纯文本。"""
        lines = ["─" * 68]
        for r in self.records:
            lines.append(
                f"#{r['seq']:03d}  {r['tool']}()  →  {r['result_repr']}"
                f"  ({r['elapsed_ms']} ms)"
            )
            # 参数行（每个参数独立一行，缩进）
            for k, v in r["args_repr"].items():
                lines.append(f"      {k} = {v}")
            lines.append(f"      调用方：{r['caller']}")
        lines.append("─" * 68)
        s = self.summary()
        lines.append(
            f"合计 {s['total_calls']} 次调用，耗时 {s['total_elapsed_ms']} ms"
        )
        lines.append(
            "  " + "  ".join(f"{k}×{v}" for k, v in s["calls_by_tool"].items())
        )
        lines.append("─" * 68)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# 上下文管理器 — 激活 / 停用 collector
# ---------------------------------------------------------------------------

class collect_trace:
    """
    上下文管理器，激活 TraceCollector 并在退出时返回它。

    Usage:
        with collect_trace() as col:
            skill.run(loader, rq_id, wm)
        print(col.render())
    """

    def __init__(self) -> None:
        self._collector = TraceCollector()
        self._token = None

    def __enter__(self) -> TraceCollector:
        self._token = _active_collector.set(self._collector)
        return self._collector

    def __exit__(self, *_) -> None:
        _active_collector.reset(self._token)


# ---------------------------------------------------------------------------
# 装饰器 — 插桩单个工具函数
# ---------------------------------------------------------------------------

def traced_tool(fn: Callable) -> Callable:
    """
    装饰器：若当前上下文存在活跃的 TraceCollector，
    则在每次调用时记录参数、返回值、耗时。
    若无 collector，行为与原函数完全相同（零开销）。
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        collector = _active_collector.get()
        if collector is None:
            return fn(*args, **kwargs)

        t0 = time.perf_counter()
        result = fn(*args, **kwargs)
        elapsed = (time.perf_counter() - t0) * 1000

        args_repr = _summarize_args(fn, args, kwargs)
        caller = _get_caller()
        collector.record(fn.__name__, args_repr, result, elapsed, caller)
        return result

    return wrapper


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _summarize_args(fn: Callable, args: tuple, kwargs: dict) -> dict[str, Any]:
    """将位置参数绑定到参数名，截断大列表后返回可读摘要。KGLoader 实例替换为占位符。"""
    try:
        sig = inspect.signature(fn)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        result = {}
        for k, v in bound.arguments.items():
            # KGLoader / TracingKGLoader 不序列化，用占位符代替
            type_name = type(v).__name__
            if "Loader" in type_name:
                result[k] = f"<{type_name}>"
            else:
                result[k] = _truncate(v)
        return result
    except Exception:
        return {"args": str(args)[:200], "kwargs": str(kwargs)[:200]}


def _truncate(v: Any, max_items: int = 3, max_str: int = 120) -> Any:
    """截断大列表/长字符串，保留可读性。"""
    if isinstance(v, list):
        if len(v) <= max_items:
            return [_truncate(i) for i in v]
        sample = [_truncate(i) for i in v[:max_items]]
        return f"[{sample[0]!r}, ... ({len(v)} items)]"
    if isinstance(v, dict):
        # 只展示 node_id / canonical_name 等关键字段
        keys = ["node_id", "canonical_name", "edge_type", "source_id", "target_id"]
        preview = {k: v[k] for k in keys if k in v}
        if preview:
            return preview
        return f"{{...{len(v)} keys}}"
    if isinstance(v, str) and len(v) > max_str:
        return v[:max_str] + "..."
    return v


def _summarize_result(result: Any) -> tuple[Any, int | None]:
    """返回 (result_repr, result_count)。"""
    if isinstance(result, list):
        count = len(result)
        if count == 0:
            return "[]", 0
        sample = _truncate(result[0])
        return f"[{sample!r}, ...] ({count} items)", count
    if isinstance(result, dict):
        return _truncate(result), None
    if isinstance(result, bool):
        return result, None
    if isinstance(result, (int, float)):
        return result, None
    return str(result)[:120], None


def _get_caller() -> str:
    """从调用栈中找到第一个属于 Skill 代码（非 tool/基础设施模块）的帧。"""
    skip_modules = {
        "tool_trace.py", "extract_tools.py", "logic_tools.py",
        "semantic_tools.py", "tool_registry.py", "tracing_loader.py",
        "kg_loader.py", "base_skill.py",
    }
    for frame_info in inspect.stack()[3:]:
        fname = frame_info.filename.split("/")[-1]
        if fname not in skip_modules:
            return f"{fname}:{frame_info.lineno} in {frame_info.function}()"
    return "unknown"
