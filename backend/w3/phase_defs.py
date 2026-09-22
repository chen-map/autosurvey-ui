"""W3 Phase 定义：Survey Framing and RQ Planning（WORKFLOW3_GUIDE 六阶段 → 执行器五 Phase）。

P1 Gap 分析（LLM）→ P2 RQ 设计（LLM）→ P3 查询落地（存量 query_rq_evidence.py，核心）
→ P4 证据核验（反思循环入口）→ P5 综述评审（LLM）。
GUIDE 的 Phase 3/4/5 产物（registry/matrix/reflection/outline）由 P3 脚本一次产出，
P4 对矩阵做 answerability 核验，P5 做两轮评审与综合报告。

LLM 说明：P1/P2/P5 在存量库中是纯技能（SKILL.md 无脚本），由执行器层 llm_doc.py 驱动；
P3 经 llm_wrap 注入桥调起（query_rq_evidence.py 内部走 kg_common.LLMClient）。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
LLM_DOC = str(HERE / "llm_doc.py")
VERIFY = str(HERE / "w3_verify.py")
WRAP = str(HERE.parent / "w2" / "llm_wrap.py")


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    scripts = cfg["scripts_root"].rstrip("/") + "/workflow_3_survey_framing_and_rq_planning"
    kg_scripts = scripts + "/rq_card_linker"
    ws = cfg.get("workspace_rel", "retrieval_workspace").rstrip("/")
    domain = " / ".join(cfg.get("domain_tags", []))
    desc = "；".join(x for x in (cfg.get("topic", ""), cfg.get("description", "")) if x)
    stats = json_stats(cfg)
    ar = "analyze_report"

    return [
        {
            "id": "W3-P1",
            "name": "Survey Gap 分析（LLM）",
            "optional": False,
            "steps": [
                {"script": LLM_DOC,
                 "args": ["--task", "gap", "--out-dir", ar,
                          "--domain", f"{desc}（领域：{domain or '见 KG 摘要'}）",
                          "--kg-summary", "knowledge_graph/KG_SUMMARY.md",
                          "--use-case", "w3.gap", "--stats", stats]},
            ],
            "outputs": [f"{ar}/gap_summary.md", f"{ar}/survey_type_selection.md",
                        f"{ar}/related_review_report.md"],
        },
        {
            "id": "W3-P2",
            "name": "RQ 设计（Macro + Sub，LLM）",
            "optional": False,
            "steps": [
                {"script": LLM_DOC,
                 "args": ["--task", "design", "--out-dir", ar,
                          "--domain", f"{desc}（领域：{domain or '见 KG 摘要'}）",
                          "--kg-summary", "knowledge_graph/KG_SUMMARY.md",
                          "--use-case", "w3.design", "--stats", stats]},
            ],
            "outputs": [f"{ar}/design_report.md", f"{ar}/review_protocol.md"],
        },
        {
            "id": "W3-P3",
            "name": "查询落地与证据矩阵（query_rq_evidence）",
            "optional": False,
            "steps": [
                {"script": WRAP,
                 "args": ["--use-case", "w3.query",
                          "--target", f"{kg_scripts}/query_rq_evidence.py",
                          # kg_common 在 W2 脚本目录（跨工作流共享），注入 sys.path
                          "--kg-common-path",
                          f"{cfg['scripts_root'].rstrip('/')}/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts",
                          "--design-report", f"{ar}/design_report.md",
                          "--db", "knowledge_graph/paper_kg.db",
                          "--output-json", f"{ar}/rq_query_registry.json",
                          "--output-md", f"{ar}/rq_query_report.md",
                          "--reflection-output", f"{ar}/rq_reflection_log.md",
                          "--outline-output", f"{ar}/survey_outline.md",
                          "--outline-json-output", f"{ar}/survey_outline.json",
                          "--matrix-output", f"{ar}/rq_evidence_matrix.json"]},
            ],
            "outputs": [f"{ar}/rq_query_registry.json", f"{ar}/rq_evidence_matrix.json",
                        f"{ar}/rq_query_report.md", f"{ar}/survey_outline.json"],
        },
        {
            "id": "W3-P4",
            "name": "证据核验（answerability 分级 + 反思记录）",
            "optional": False,
            "steps": [
                {"script": VERIFY,
                 "args": ["--matrix", f"{ar}/rq_evidence_matrix.json",
                          "--reflection", f"{ar}/rq_reflection_log.md",
                          "--out", f"{ar}/verify_report.json"]},
            ],
            "outputs": [f"{ar}/verify_report.json"],
        },
        {
            "id": "W3-P5",
            "name": "反思修订（改写被拦截 Sub-RQ，LLM）",
            "optional": False,
            "steps": [
                {"script": LLM_DOC,
                 "args": ["--task", "revise", "--out-dir", ar,
                          "--kg-summary", "knowledge_graph/KG_SUMMARY.md",
                          "--use-case", "w3.revise"]},
            ],
            "outputs": [f"{ar}/design_report.md"],
        },
        {
            "id": "W3-P6",
            "name": "二次查询落地（修订后重新冻结证据）",
            "optional": False,
            "steps": [
                {"script": WRAP,
                 "args": ["--use-case", "w3.query",
                          "--target", f"{kg_scripts}/query_rq_evidence.py",
                          # kg_common 在 W2 脚本目录（跨工作流共享），注入 sys.path
                          "--kg-common-path",
                          f"{cfg['scripts_root'].rstrip('/')}/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts",
                          "--design-report", f"{ar}/design_report.md",
                          "--db", "knowledge_graph/paper_kg.db",
                          "--output-json", f"{ar}/rq_query_registry.json",
                          "--output-md", f"{ar}/rq_query_report.md",
                          "--reflection-output", f"{ar}/rq_reflection_log.md",
                          "--outline-output", f"{ar}/survey_outline.md",
                          "--outline-json-output", f"{ar}/survey_outline.json",
                          "--matrix-output", f"{ar}/rq_evidence_matrix.json"]},
            ],
            "outputs": [f"{ar}/rq_query_registry.json", f"{ar}/rq_evidence_matrix.json"],
        },
        {
            "id": "W3-P7",
            "name": "综述评审（两轮 + 综合报告，LLM）",
            "optional": False,
            "steps": [
                {"script": LLM_DOC,
                 "args": ["--task", "review", "--out-dir", ar,
                          "--domain", desc,
                          "--use-case", "w3.review"]},
            ],
            "outputs": [f"{ar}/survey_research_report.md"],
        },
    ]


def json_stats(cfg: dict[str, Any]) -> str:
    """KG 规模摘要（节点/边计数），供 LLM 提示词引用。"""
    try:
        kg = Path(cfg["workspace"]) / "knowledge_graph" / "paper_kg.json"
        d = json.loads(kg.read_text(encoding="utf-8"))
        return f"论文 {len(d.get('papers', []))}，概念节点 {len(d.get('nodes', []))}，关系边 {len(d.get('edges', []))}"
    except Exception:
        return "（统计不可用）"
