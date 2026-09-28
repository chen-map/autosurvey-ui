"""
llm_skill_agent.py — LLM 驱动的 Skill 执行 Agent

使用 Claude API（tool_use）将 Skill .md 作为执行规范，
自主调用 Layer 1 KG 工具完成分析，最终生成 HTML 小论文报告。

架构流程：
  Skill .md  →  系统提示词
  Layer 1 工具  →  Claude tool_use schema
  Claude  →  调用工具 → 获取 KG 数据 → 推理 → 调用 end() → 生成报告
  HTML 渲染器  →  输出 .html 文件
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import anthropic

from ..layer1_kg_ops.kg_loader import KGLoader
from ..layer1_kg_ops.extract_tools import (
    get_entity_by_type,
    get_entity_by_constraint,
    get_relation,
    get_head_entity,
    get_tail_entity,
    get_candidate_entity,
)
from ..layer1_kg_ops.logic_tools import count, intersect, union, judge, end
from ..layer1_kg_ops.semantic_tools import search_paper_sections

from .skill_loader import SkillLoader, SkillSpec
from .tool_schemas import ALL_TOOL_SCHEMAS, get_tools_for_skill
from .html_renderer import render_from_llm_output, HTMLReport

# ---------------------------------------------------------------------------
# 工具分发表 — 工具名 → Python 函数
# ---------------------------------------------------------------------------

def _build_tool_dispatcher(
    loader: KGLoader,
    paper_cards_root: str | None = None,
) -> dict[str, Any]:
    """构建工具名 → 可调用对象的映射，注入 loader 上下文。"""

    def _get_entity_by_type(entity_type: str) -> list[dict]:
        return get_entity_by_type(loader, entity_type)

    def _get_entity_by_constraint(
        entities: list[dict], field: str, op: str, value: Any
    ) -> list[dict]:
        return get_entity_by_constraint(entities, field, op, value)

    def _get_relation(entity_id: str, direction: str = "both") -> list[dict]:
        return get_relation(loader, entity_id, direction)

    def _get_head_entity(
        edge_type: str, tail_id: str, min_confidence: float = 0.0
    ) -> list[dict]:
        return get_head_entity(loader, edge_type, tail_id, min_confidence)

    def _get_tail_entity(
        edge_type: str, head_id: str, min_confidence: float = 0.0
    ) -> list[dict]:
        return get_tail_entity(loader, edge_type, head_id, min_confidence)

    def _get_candidate_entity(
        mention: str, entity_type: str | None = None, topk: int = 5
    ) -> list[dict]:
        return get_candidate_entity(loader, mention, entity_type, topk)

    def _count(entities: list) -> int:
        return count(entities)

    def _intersect(list_a: list, list_b: list, key: str = "node_id") -> list:
        return intersect(list_a, list_b, key)

    def _union(list_a: list, list_b: list, key: str = "node_id") -> list:
        return union(list_a, list_b, key)

    def _judge(value: Any, op: str, threshold: Any) -> bool:
        return judge(value, op, threshold)

    def _end(answer: Any, metadata: dict | None = None) -> dict:
        return end(answer, metadata)

    dispatcher: dict[str, Any] = {
        "get_entity_by_type": _get_entity_by_type,
        "get_entity_by_constraint": _get_entity_by_constraint,
        "get_relation": _get_relation,
        "get_head_entity": _get_head_entity,
        "get_tail_entity": _get_tail_entity,
        "get_candidate_entity": _get_candidate_entity,
        "count": _count,
        "intersect": _intersect,
        "union": _union,
        "judge": _judge,
        "end": _end,
    }

    if paper_cards_root is not None:
        _pcr = paper_cards_root

        def _search_paper_sections(
            query: str,
            topk: int = 5,
            paper_ids: list[str] | None = None,
        ) -> list[dict]:
            return search_paper_sections(_pcr, query, topk=topk, paper_ids=paper_ids)

        dispatcher["search_paper_sections"] = _search_paper_sections

    return dispatcher


# ---------------------------------------------------------------------------
# 工具调用执行器
# ---------------------------------------------------------------------------

def _execute_tool_call(
    tool_name: str,
    tool_input: dict[str, Any],
    dispatcher: dict[str, Any],
) -> Any:
    """
    执行单次工具调用，返回结果（已确保 JSON 可序列化）。
    """
    fn = dispatcher.get(tool_name)
    if fn is None:
        return {"error": f"Unknown tool: {tool_name!r}"}

    try:
        result = fn(**tool_input)
        return result
    except Exception as exc:
        return {"error": str(exc), "tool": tool_name}


def _truncate_result_for_llm(result: Any, max_items: int = 30) -> Any:
    """
    对工具结果做截断，防止超出 Claude 上下文窗口。
    大列表只保留前 max_items 条，附加计数说明。
    """
    if isinstance(result, list):
        if len(result) <= max_items:
            return result
        sample = result[:max_items]
        return {
            "_truncated": True,
            "_total_count": len(result),
            "_showing": max_items,
            "items": sample,
        }
    return result


# ---------------------------------------------------------------------------
# HTML 报告生成提示词
# ---------------------------------------------------------------------------

_HTML_REPORT_PROMPT = """
基于以上所有工具调用的数据结果，请生成一份结构化的研究分析报告。

**输出格式要求（严格遵守）**：
返回一个 JSON 数组，数组中每个元素是报告的一个内容块，类型包括：

1. `section`（章节文字）：
   ```json
   {{"type": "section", "heading": "章节标题", "content": "正文文本（可含多段，用\\n分隔）"}}
   ```

2. `table`（数据表格）：
   ```json
   {{"type": "table", "heading": "表格标题", "headers": ["列1","列2"], "rows": [["值1","值2"]]}}
   ```

3. `bar_chart`（柱状图）：
   ```json
   {{"type": "bar_chart", "heading": "图表标题", "categories": ["A","B"], "series_name": "数量", "values": [10,5]}}
   ```

4. `pie_chart`（饼图）：
   ```json
   {{"type": "pie_chart", "heading": "图表标题", "data": [{{"name":"A","value":10}}]}}
   ```

5. `note`（提示块）：
   ```json
   {{"type": "note", "content": "说明文字"}}
   ```

6. `references`（参考文献列表，**必须作为最后一个块**）：
   ```json
   {{"type": "references", "entries": [{{"id": 1, "paper_id": "origin_paper_id字符串", "title": "论文标题或描述"}}]}}
   ```

**引用规则**：
- 正文、表格单元格、note 内容中，凡引用具体论文/方法作为证据时，须在对应文字后加 `[N]`（N 为整数编号，从 1 开始）
- 同一篇论文在全文中始终使用同一编号
- 编号来源：工具调用结果中每个节点的 `origin_paper_id` 字段；若 origin_paper_id 为 null，则跳过该论文不编号
- 最后一个块必须是 `references` 类型，列出所有被引用论文的编号、origin_paper_id 和标题（标题从节点的 canonical_name 或 description 首句提取）

**报告结构要求**：
- 第一个块必须是 section，heading 为"摘要"，content 包含 1-2 段对分析结论的简要概述
- 包含"数据来源与规模"章节，说明使用了哪些 KG 数据、数量
- 核心分析结果必须用表格或图表呈现（不能只有文字）
- 包含"分析局限性"章节，说明数据覆盖不足或推断置信度问题
- 倒数第二个块是 section，heading 为"结论"
- 最后一个块是 references

直接返回 JSON 数组，不要任何额外文字包装。
"""


# ---------------------------------------------------------------------------
# Skill 自动选型提示词（LLM 分析 RQ → 选择分析方法）
# ---------------------------------------------------------------------------

_SKILL_SELECTION_PROMPT = """你是研究方法选择专家。用户提出了一个研究问题（RQ），需要你从下面的可用分析 Skill 中选择一个最合适的方法来回答它。

每个 Skill 的描述说明了它的分析视角与适用的 RQ 类型。请先分析 RQ 的核心诉求（是枚举分布？因果分析？对比？评估？演化趋势？…），再挑选与诉求最匹配的 Skill。

可用 Skill 列表：
{catalog}

用户 RQ：
{rq}

输出要求：只输出一个 JSON 对象，不要任何其他文字或代码块标记：
{{"skill_id": "<选中的 Skill ID>", "reason": "<选型理由，一句话>"}}"""


# ---------------------------------------------------------------------------
# LLMSkillAgent
# ---------------------------------------------------------------------------

class LLMSkillAgent:
    """
    LLM 驱动的 Skill 执行 Agent。

    读取 Skill .md 文件作为执行规范，使用 Claude API tool_use
    自主调用 Layer 1 KG 工具完成分析，输出 HTML 小论文。

    Usage:
        agent = LLMSkillAgent(
            kg_root="/path/to/knowledge_graph",
            skills_root="/path/to/kg_analysis/layer2_skills",
            output_dir="/path/to/output",
        )
        result = agent.run_skill(
            skill_id="A1.1-a",
            rq_text="LLM Agent 有哪些典型安全威胁？",
            rq_id="RQ-002",
        )
        print(result["html_path"])
    """

    DEFAULT_MODEL = "claude-opus-4-6"
    MAX_TOOL_ROUNDS = 30  # 防止无限循环
    _URGE_AT_ROUND = 12   # 超过此轮数后插入催促消息

    def __init__(
        self,
        kg_root: str,
        skills_root: str,
        output_dir: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        paper_cards_root: str | None = None,
    ) -> None:
        """
        Args:
            kg_root:          KG JSON 数据根目录
            skills_root:      layer2_skills/ .md 文件根目录
            output_dir:       HTML 报告输出目录（None 表示不写文件）
            api_key:          Anthropic API Key（None 则依次读 ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN 环境变量）
            model:            使用的 Claude 模型（默认 claude-opus-4-6）
            paper_cards_root: paper_cards/parsed/ 目录路径（None 则禁用 search_paper_sections 工具）
        """
        self._loader = KGLoader(kg_root)
        self._skill_loader = SkillLoader(skills_root)
        self._output_dir = Path(output_dir) if output_dir else None
        self._model = model or self.DEFAULT_MODEL
        self._paper_cards_root = paper_cards_root

        resolved_key = (
            api_key
            or os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            or ""
        )
        if not resolved_key:
            raise ValueError(
                "Anthropic API key not provided. "
                "Pass api_key= or set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env var."
            )
        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        client_kwargs: dict = {"api_key": resolved_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        self._client = anthropic.Anthropic(**client_kwargs)

    # ------------------------------------------------------------------
    # 主入口
    # ------------------------------------------------------------------

    def run_skill(
        self,
        skill_id: str | None = None,
        rq_text: str = "",
        rq_id: str = "RQ-000",
        extra_context: str = "",
    ) -> dict[str, Any]:
        """
        使用 LLM 执行 Skill，生成 HTML 小论文。

        两种 Skill 指定方式：
        - 显式指定：传入 skill_id（如 "A1.1-a"）；
        - LLM 自动选型：skill_id 缺省（None）时，L3 大模型先分析 RQ，
          从可用 Skill 目录中自动选择最合适的分析方法再执行。

        Args:
            skill_id:      Skill ID（缺省则由 LLM 根据 RQ 自动选择）
            rq_text:       用户自然语言 RQ
            rq_id:         RQ 标识符（用于文件名和报告元信息）
            extra_context: 附加上下文（如来自 working_memory 的上游 Skill 输出摘要）

        Returns:
            {
                "skill_id": str,
                "skill_selection": dict | None,  ← LLM 自动选型信息（显式指定时为 None）
                "rq_id": str,
                "html": str,            ← 完整 HTML 字符串
                "html_path": str | None,← 写入的 HTML 文件路径
                "tool_calls": [...],    ← 所有工具调用记录
                "final_answer": Any,    ← end() 的 answer 参数
                "total_time_sec": float,
                "total_tool_rounds": int,
            }
        """
        t_start = time.time()

        # ---- Skill 选择：显式指定 或 L3 大模型分析 RQ 后自动选择 ----
        selection_info: dict | None = None
        if not skill_id:
            skill_id, selection_info = self._select_skill(rq_text, extra_context)

        spec: SkillSpec = self._skill_loader.get(skill_id)
        dispatcher = _build_tool_dispatcher(self._loader, self._paper_cards_root)
        tools = get_tools_for_skill()  # 全部 L1 工具

        system_prompt = spec.as_system_prompt()
        user_message = self._build_user_message(rq_text, rq_id, extra_context)

        messages: list[dict] = [{"role": "user", "content": user_message}]
        tool_call_log: list[dict] = []
        reasoning_trace: list[dict] = []
        html_sections: list[dict] = []
        final_answer: Any = None
        round_count = 0
        html: str | None = None

        # ---- Tool use 对话循环 ----------------------------------------
        while round_count < self.MAX_TOOL_ROUNDS:
            round_count += 1
            response = self._client.messages.create(
                model=self._model,
                max_tokens=8192,
                system=system_prompt,
                tools=tools,
                messages=messages,
            )

            # 追加 assistant 回合
            messages.append({"role": "assistant", "content": response.content})

            # 收集本轮 LLM 推理文本（text 类型块）
            for block in response.content:
                if block.type == "text" and block.text.strip():
                    reasoning_trace.append({
                        "round": round_count,
                        "text": block.text,
                    })

            # 检查停止原因
            if response.stop_reason == "end_turn":
                # LLM 可能在 end_turn 时直接输出了 JSON sections
                extracted = self._extract_json_from_last_message(messages)
                if extracted:
                    html_sections = extracted
                    html = self._render_html(html_sections, spec, rq_text, rq_id)
                break

            if response.stop_reason != "tool_use":
                break

            # 收集本轮所有工具调用，批量执行
            tool_results: list[dict] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input
                call_t0 = time.perf_counter()
                raw_result = _execute_tool_call(tool_name, tool_input, dispatcher)
                elapsed_ms = round((time.perf_counter() - call_t0) * 1000, 2)

                # 截断大结果防 token 爆炸
                truncated = _truncate_result_for_llm(raw_result)

                tool_call_log.append({
                    "round": round_count,
                    "tool": tool_name,
                    "input": tool_input,
                    "raw_result": raw_result,
                    "result_count": (
                        len(raw_result) if isinstance(raw_result, list) else None
                    ),
                    "elapsed_ms": elapsed_ms,
                })

                # 捕获 end() 的最终答案
                if tool_name == "end" and isinstance(raw_result, dict):
                    final_answer = raw_result.get("answer")

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(truncated, ensure_ascii=False),
                })

            # 把工具结果作为 user 回合送回
            # 超过阈值轮数时，追加催促消息（嵌入 tool_results 之后的文本块）
            if round_count >= self._URGE_AT_ROUND and final_answer is None:
                urge_msg = (
                    f"**注意**：已调用工具 {round_count} 轮。"
                    "请立即停止进一步查询，基于已收集的数据完成分析，"
                    "然后调用 `end` 工具输出结果。不要再调用更多工具。"
                )
                messages.append({"role": "user", "content": tool_results})
                messages.append({"role": "user", "content": urge_msg})
            else:
                messages.append({"role": "user", "content": tool_results})

            # end() 被调用后，再请求一轮 HTML sections 生成，然后退出
            if final_answer is not None:
                html_sections = self._request_html_report(
                    messages, system_prompt, tools
                )
                html = self._render_html(html_sections, spec, rq_text, rq_id)
                break

        # 兜底：若仍无 HTML（超出轮数或其他异常），生成工具调用摘要页
        if html is None:
            html = self._fallback_html(tool_call_log, spec, rq_text, rq_id)

        total_time = round(time.time() - t_start, 3)

        # 写 working memory 目录（时间戳确保每次运行独立，不覆盖历史）
        from datetime import datetime
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        wm_dir: str | None = None
        if self._output_dir:
            wm_dir = self._save_working_memory(
                rq_id=rq_id,
                rq_text=rq_text,
                skill_id=skill_id,
                skill_selection=selection_info,
                tool_call_log=tool_call_log,
                reasoning_trace=reasoning_trace,
                final_answer=final_answer,
                html_sections=html_sections,
                html=html or "",
                total_time_sec=total_time,
                total_tool_rounds=round_count,
                ts=ts,
            )

        return {
            "skill_id": skill_id,
            "skill_selection": selection_info,
            "rq_id": rq_id,
            "html": html,
            "working_memory_dir": wm_dir,
            "tool_calls": tool_call_log,
            "final_answer": final_answer,
            "total_time_sec": total_time,
            "total_tool_rounds": round_count,
        }

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _build_user_message(
        self,
        rq_text: str,
        rq_id: str,
        extra_context: str,
    ) -> str:
        msg = (
            f"**研究问题（RQ）**：{rq_text}\n"
            f"**RQ ID**：{rq_id}\n\n"
            "请按照 Skill 规范，调用工具从知识图谱中提取数据完成分析。\n"
            "分析完成后，调用 `end` 工具输出结构化结果，"
            "然后生成 HTML 报告的 JSON 内容块数组。"
        )
        if extra_context:
            msg += f"\n\n**上游 Skill 输出摘要**：\n{extra_context}"
        return msg

    def _select_skill(self, rq_text: str, extra_context: str = "") -> tuple[str, dict]:
        """
        让 L3 大模型分析 RQ，从可用 Skill 目录中自动选择最合适的分析方法。

        Args:
            rq_text:       用户自然语言 RQ
            extra_context: 附加上下文（如来自 working_memory 的上游输出摘要）

        Returns:
            (skill_id, {"skill_id": ..., "reason": ...})

        Raises:
            ValueError: 两次尝试后 LLM 仍未选出有效 Skill
        """
        catalog_lines = []
        for sid in self._skill_loader.list_skill_ids():
            spec = self._skill_loader.get(sid)
            desc = (spec.description or "").replace("\n", " ").strip()
            catalog_lines.append(f"- {sid}：{spec.name} —— {desc[:160]}")
        catalog = "\n".join(catalog_lines)

        prompt = _SKILL_SELECTION_PROMPT.format(catalog=catalog, rq=rq_text)
        if extra_context:
            prompt += f"\n\n补充上下文（来自上游分析）：{extra_context}"

        attempts = 0
        while attempts < 2:
            attempts += 1
            resp = self._client.messages.create(
                model=self._model,
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(getattr(b, "text", "") or "" for b in resp.content)
            parsed = _parse_json_object(text)
            if parsed and parsed.get("skill_id") in self._skill_loader.list_skill_ids():
                return parsed["skill_id"], {
                    "skill_id": parsed["skill_id"],
                    "reason": parsed.get("reason", ""),
                }
            if attempts == 1:
                prompt += (
                    "\n\n你的上一步输出未能解析出有效 Skill ID。"
                    "请重新严格按格式输出 JSON 对象（不要代码块标记）。"
                )

        available = self._skill_loader.list_skill_ids()
        raise ValueError(
            f"LLM 未能选出有效的 Skill（两次尝试失败）。可用 Skill：{available}"
        )

    def _request_html_report(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict],
    ) -> list[dict]:
        """在 end() 调用后追加一轮对话，要求 LLM 生成 HTML sections JSON。"""
        messages_with_request = messages + [
            {
                "role": "user",
                "content": _HTML_REPORT_PROMPT,
            }
        ]
        resp = self._client.messages.create(
            model=self._model,
            max_tokens=8192,
            system=system_prompt,
            tools=tools,
            messages=messages_with_request,
        )
        # 从回复中提取 JSON
        for block in resp.content:
            if hasattr(block, "text"):
                sections = _parse_json_array(block.text)
                if sections:
                    return sections
        return []

    def _extract_json_from_last_message(
        self, messages: list[dict]
    ) -> list[dict]:
        """从最后的 assistant 消息中尝试解析 JSON 数组。"""
        for msg in reversed(messages):
            if msg.get("role") != "assistant":
                continue
            content = msg.get("content", [])
            if isinstance(content, str):
                sections = _parse_json_array(content)
                if sections:
                    return sections
            elif isinstance(content, list):
                for block in content:
                    text = getattr(block, "text", None) or (
                        block.get("text") if isinstance(block, dict) else None
                    )
                    if text:
                        sections = _parse_json_array(text)
                        if sections:
                            return sections
        return []

    def _render_html(
        self,
        sections: list[dict],
        spec: SkillSpec,
        rq_text: str,
        rq_id: str,
    ) -> str:
        title = f"{spec.skill_id} 分析报告"
        meta_info = f"RQ [{rq_id}]：{rq_text}"
        return render_from_llm_output(
            sections, title=title, rq_id=rq_id, meta_info=meta_info
        )

    def _fallback_html(
        self,
        tool_call_log: list[dict],
        spec: SkillSpec,
        rq_text: str,
        rq_id: str,
    ) -> str:
        """当 LLM 未返回有效 JSON 时，生成最低限度的摘要 HTML。"""
        report = HTMLReport(
            title=f"{spec.skill_id} 分析报告（工具调用摘要）",
            rq_id=rq_id,
            meta_info=f"RQ [{rq_id}]：{rq_text}",
        )
        report.add_section(
            "说明",
            "<p>LLM 未返回结构化报告内容，以下为工具调用记录摘要。</p>",
        )
        if tool_call_log:
            headers = ["轮次", "工具", "输入摘要", "结果条数", "耗时(ms)"]
            rows = [
                [
                    str(r["round"]),
                    r["tool"],
                    json.dumps(r["input"], ensure_ascii=False)[:80],
                    str(r["result_count"] or ""),
                    str(r["elapsed_ms"]),
                ]
                for r in tool_call_log
            ]
            report.add_section("工具调用记录", "")
            report.add_table("工具调用明细", headers, rows)
        return report.build()

    def _save_html(self, html: str, rq_id: str, skill_id: str, ts: str) -> str:
        safe_rq = rq_id.replace("/", "-").replace("\\", "-")
        safe_skill = skill_id.replace(".", "_")
        filename = f"{safe_rq}_{safe_skill}_{ts}_report.html"
        out_path = self._output_dir / filename
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(html, encoding="utf-8")
        return str(out_path)

    def _save_tool_log(
        self,
        tool_call_log: list[dict],
        rq_id: str,
        skill_id: str,
        total_time_sec: float,
        ts: str,
    ) -> str:
        """将工具调用日志以 JSON 格式写入输出目录，文件名与 HTML 报告对应。"""
        from datetime import datetime
        safe_rq = rq_id.replace("/", "-").replace("\\", "-")
        safe_skill = skill_id.replace(".", "_")
        filename = f"{safe_rq}_{safe_skill}_{ts}_tool_log.json"
        out_path = self._output_dir / filename
        out_path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "skill_id": skill_id,
            "rq_id": rq_id,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "total_time_sec": total_time_sec,
            "total_calls": len(tool_call_log),
            "total_rounds": tool_call_log[-1]["round"] if tool_call_log else 0,
            "summary_by_tool": _count_by_tool(tool_call_log),
            "calls": tool_call_log,
        }
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return str(out_path)

    def _save_working_memory(
        self,
        rq_id: str,
        rq_text: str,
        skill_id: str,
        skill_selection: dict | None,
        tool_call_log: list[dict],
        reasoning_trace: list[dict],
        final_answer: Any,
        html_sections: list[dict],
        html: str,
        total_time_sec: float,
        total_tool_rounds: int,
        ts: str,
    ) -> str:
        """
        将单次 run_skill() 的所有产物写入结构化 working memory 目录。

        目录结构：
            working_memory/{rq_id}_{skill_id}_{ts}/
                00_meta.json            — 元信息与统计摘要
                01_tool_calls.json      — 完整工具调用流水（含原始返回值）
                02_reasoning_trace.json — LLM 推理文本流
                03_final_answer.json    — end() 的结构化结果
                04_html_sections.json   — HTML render 前的 sections 数组
                05_report.html          — 最终 HTML 报告

        Returns:
            创建的目录绝对路径字符串
        """
        from datetime import datetime

        safe_rq = rq_id.replace("/", "-").replace("\\", "-")
        safe_skill = skill_id.replace(".", "_")
        dir_name = f"{safe_rq}_{safe_skill}_{ts}"
        wm_dir = self._output_dir / "working_memory" / dir_name
        wm_dir.mkdir(parents=True, exist_ok=True)

        now_iso = datetime.now().isoformat(timespec="seconds")

        # 00_meta.json
        meta = {
            "rq_id": rq_id,
            "rq_text": rq_text,
            "skill_id": skill_id,
            "skill_selection": skill_selection,
            "model": self._model,
            "generated_at": now_iso,
            "total_time_sec": total_time_sec,
            "total_tool_rounds": total_tool_rounds,
            "total_tool_calls": len(tool_call_log),
            "summary_by_tool": _count_by_tool(tool_call_log),
        }
        (wm_dir / "00_meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 01_tool_calls.json — raw_result 超 200 条时截断
        serialized_calls = []
        for call in tool_call_log:
            entry = {k: v for k, v in call.items() if k != "raw_result"}
            raw = call.get("raw_result")
            if isinstance(raw, list) and len(raw) > 200:
                entry["raw_result"] = {
                    "_truncated": True,
                    "_total": len(raw),
                    "items": raw[:200],
                }
            else:
                entry["raw_result"] = raw
            serialized_calls.append(entry)
        (wm_dir / "01_tool_calls.json").write_text(
            json.dumps(serialized_calls, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 02_reasoning_trace.json
        (wm_dir / "02_reasoning_trace.json").write_text(
            json.dumps(reasoning_trace, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 03_final_answer.json
        (wm_dir / "03_final_answer.json").write_text(
            json.dumps({"answer": final_answer}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 04_html_sections.json
        (wm_dir / "04_html_sections.json").write_text(
            json.dumps(html_sections, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 05_report.html
        (wm_dir / "05_report.html").write_text(html, encoding="utf-8")

        return str(wm_dir)

    # ------------------------------------------------------------------
    # 便捷工具
    # ------------------------------------------------------------------

    def list_available_skills(self) -> list[str]:
        """返回所有可用的 Skill ID 列表。"""
        return self._skill_loader.list_skill_ids()


# ---------------------------------------------------------------------------
# JSON 解析工具
# ---------------------------------------------------------------------------


def _count_by_tool(tool_call_log: list[dict]) -> dict[str, int]:
    """统计每个工具被调用的次数。"""
    counts: dict[str, int] = {}
    for c in tool_call_log:
        counts[c["tool"]] = counts.get(c["tool"], 0) + 1
    return dict(sorted(counts.items(), key=lambda x: x[1], reverse=True))


def _parse_json_array(text: str) -> list[dict] | None:
    """
    从文本中提取第一个 JSON 数组。
    支持 ```json ... ``` 代码块和裸 JSON。
    """
    import re

    # 尝试 ```json 代码块
    m = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(1))
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    # 尝试裸 JSON 数组
    m = re.search(r"(\[.*\])", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(1))
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    return None


def _parse_json_object(text: str) -> dict | None:
    """
    从文本中提取第一个 JSON 对象（用于解析 Skill 自动选型结果）。
    支持 ```json ... ``` 代码块和裸 JSON。
    """
    import re

    # 尝试 ```json 代码块
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(1))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    # 尝试裸 JSON 对象
    m = re.search(r"(\{.*\})", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group(1))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    return None
