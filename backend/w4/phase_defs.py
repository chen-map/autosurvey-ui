"""W4 Phase 定义：RQ-specific Working Memory Construction（WORKFLOW4_GUIDE 三阶段 per-RQ）。

P1 证据抽取（extract_rq_evidence，LLM 逐篇）→ P2 答案综合（synthesize_rq_answer）
→ P3 claim 四维核查 + 汇总索引（check_answer_claims + build_working_memory_index）。
输入：W3 冻结的 rq_evidence_matrix.json / rq_query_registry.json + W2 的 KG/结构化论文。

LLM 注入说明：W4 脚本以别名（module_from_spec）加载 kg_common，llm_wrap 补丁不可达；
改为 env 注入——build_phases 时经 w2.llm_wrap.load_llm_config 解析（use_case w4.* → default），
把 base/key/model 写入每个 step 的 env（AS_LLM_*），由 skills/.../kg_common.py shim 消费。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "w2"))
from llm_wrap import load_llm_config  # noqa: E402

SCRIPTS_SUB = "workflow_4_rq_working_memory_construction"


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    scripts = cfg["scripts_root"].rstrip("/") + "/" + SCRIPTS_SUB
    ws = cfg.get("workspace_rel", "retrieval_workspace").rstrip("/")
    ar = "analyze_report"
    wm = "working_memory"

    # RQ 列表来自 W3 冻结矩阵（rq_id → paper 数），决定 per-RQ 步骤展开
    matrix_path = Path(cfg["workspace"]) / ar / "rq_evidence_matrix.json"
    rq_ids: list[str] = []
    if matrix_path.exists():
        m = json.loads(matrix_path.read_text(encoding="utf-8"))
        seen = []
        for e in m.get("sub_rq_matrix", []):
            rid = e.get("rq_id")
            if rid and rid not in seen:
                seen.append(rid)
        rq_ids = seen

    def llm_env(use_case: str) -> dict[str, str]:
        base, key, models = load_llm_config(use_case)
        env: dict[str, str] = {}
        if base:
            env["AS_LLM_BASE_URL"] = base
        if key:
            env["AS_LLM_API_KEY"] = key
        if models:
            env["AS_LLM_MODELS"] = ",".join(models)
        return env

    def rq_dir(rq: str) -> str:
        # RQ1 → rq_1（GUIDE 目录约定 working_memory/rq_1/）
        digits = "".join(ch for ch in rq if ch.isdigit()) or "0"
        return f"rq_{digits}"

    extract_steps = [
        {"script": f"{scripts}/rq_evidence_extractor/extract_rq_evidence.py",
         "env": llm_env("w4.evidence"),
         "args": ["--rq-id", rq,
                  "--evidence-matrix", f"{ar}/rq_evidence_matrix.json",
                  "--query-registry", f"{ar}/rq_query_registry.json",
                  "--structured-papers", "knowledge_graph/structured_papers.jsonl",
                  "--kg-db", "knowledge_graph/paper_kg.db",
                  "--design-report", f"{ar}/design_report.md",
                  "--output", f"{wm}/{rq_dir(rq)}/"]}
        for rq in rq_ids
    ] or [{"script": f"{scripts}/rq_evidence_extractor/extract_rq_evidence.py",
           "args": ["--rq-id", "RQ1", "--output", f"{wm}/rq_1/"]}]

    synth_steps = [
        {"script": f"{scripts}/rq_answer_synthesizer/synthesize_rq_answer.py",
         "env": llm_env("w4.synthesize"),
         "args": ["--evidence-pool", f"{wm}/{rq_dir(rq)}/evidence_pool.json",
                  "--design-report", f"{ar}/design_report.md",
                  "--output", f"{wm}/{rq_dir(rq)}/"]}
        for rq in rq_ids
    ] or [{"script": f"{scripts}/rq_answer_synthesizer/synthesize_rq_answer.py",
           "args": ["--evidence-pool", f"{wm}/rq_1/evidence_pool.json",
                    "--output", f"{wm}/rq_1/"]}]

    check_steps = [
        {"script": f"{scripts}/answer_claim_checker/check_answer_claims.py",
         "env": llm_env("w4.check"),
         "args": ["--rq-answer", f"{wm}/{rq_dir(rq)}/rq_answer.json",
                  "--evidence-pool", f"{wm}/{rq_dir(rq)}/evidence_pool.json",
                  "--output", f"{wm}/{rq_dir(rq)}/"]}
        for rq in rq_ids
    ] or [{"script": f"{scripts}/answer_claim_checker/check_answer_claims.py",
           "args": ["--rq-answer", f"{wm}/rq_1/rq_answer.json",
                    "--evidence-pool", f"{wm}/rq_1/evidence_pool.json",
                    "--output", f"{wm}/rq_1/"]}]

    p1_outputs = [f"{wm}/{rq_dir(rq)}/evidence_pool.json" for rq in rq_ids] or [f"{wm}/rq_1/evidence_pool.json"]
    p2_outputs = [f"{wm}/{rq_dir(rq)}/rq_answer.json" for rq in rq_ids] or [f"{wm}/rq_1/rq_answer.json"]

    return [
        {
            "id": "W4-P1",
            "name": "RQ 证据抽取（LLM 逐篇，冻结集）",
            "optional": False,
            "steps": extract_steps,
            "outputs": p1_outputs,
        },
        {
            "id": "W4-P2",
            "name": "RQ 答案综合（分维度 + 跨论文规律）",
            "optional": False,
            "steps": synth_steps,
            "outputs": p2_outputs,
        },
        {
            "id": "W4-P3",
            "name": "claim 四维核查 + 汇总索引",
            "optional": False,
            "steps": check_steps + [
                {"script": f"{scripts}/build_working_memory_index.py",
                 "args": ["--working-memory-dir", wm,
                          "--output", f"{wm}/WORKING_MEMORY_INDEX.json"]},
            ],
            "outputs": [f"{wm}/WORKING_MEMORY_INDEX.json"],
        },
    ]
