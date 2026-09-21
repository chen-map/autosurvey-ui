"""W2 Phase 定义：事实记忆构建（主参考 §3.2，四 Phase，存量脚本零改动）。

P0 PDF 批量解析 → P1 结构化对象提取（LLM）→ P2 候选筛选 → P3 KG 构建。
输入：W1 产出的 PDF（默认 `papers/`，即 P6 下载产物）；输出：`knowledge_graph/`。
P1/P3 经 llm_wrap.py 注入桥调起：LLM 配置从用户加密库（autosurvey.db）读取，
运行时覆盖 kg_common 默认值——存量脚本零改动，url+apikey+model 由用户统一配置。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

LLM_WRAP = str(Path(__file__).resolve().parent / "llm_wrap.py")


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """按配置渲染 W2 四个 Phase 的执行步骤。cwd = workspace（相对路径布局前提）。"""
    scripts = cfg["scripts_root"].rstrip("/") + "/workflow_2_factual_memory_construction"
    kg_scripts = scripts + "/paper-cards-kg-builder/scripts"
    pdf_dir = cfg.get("w2_pdf_dir", "papers")  # W1-P6 下载产物目录
    max_pairs = int(cfg.get("w2_max_pairs", 0))          # 0 = 全部论文对（主参考默认）
    min_confidence = float(cfg.get("w2_min_confidence", 0.4))
    max_text_chars = int(cfg.get("w2_max_text_chars", 16000))

    return [
        {
            "id": "W2-P0",
            "name": "PDF 批量解析（三级降级）",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/pdf_batch_parser/parse_pdfs.py",
                 "args": ["--pdf-dir", pdf_dir,
                          "--out-dir", "paper_cards/parsed",
                          "--log", "paper_cards/parsed/PARSE_LOG.csv"]},
            ],
            "outputs": ["paper_cards/parsed/PARSE_LOG.csv"],
        },
        {
            "id": "W2-P1",
            "name": "结构化对象提取（LLM · 六类对象）",
            "optional": False,
            "steps": [
                {"script": LLM_WRAP,
                 "args": ["--target", f"{kg_scripts}/build_structured_papers.py",
                          "--input", "paper_cards/parsed",
                          "--out", "knowledge_graph/structured_papers.jsonl",
                          "--max-text-chars", str(max_text_chars)]},
            ],
            "outputs": ["knowledge_graph/structured_papers.jsonl"],
        },
        {
            "id": "W2-P2",
            "name": "候选对象筛选",
            "optional": True,  # 主参考：可选过滤；全量进 KG 可跳过
            "steps": [
                {"script": f"{kg_scripts}/select_candidate_objects.py",
                 "args": ["--input", "knowledge_graph/structured_papers.jsonl",
                          "--out", "knowledge_graph/candidate_structured_papers.jsonl"]},
            ],
            "outputs": ["knowledge_graph/candidate_structured_papers.jsonl"],
        },
        {
            "id": "W2-P3",
            "name": "KG 构建（prescore 预评分 + 论文对关系判断）",
            "optional": False,
            "steps": [
                {"script": LLM_WRAP,
                 "args": ["--target", f"{kg_scripts}/build_paper_kg.py",
                          "--input", "knowledge_graph/candidate_structured_papers.jsonl",
                          "--out-db", "knowledge_graph/paper_kg.db",
                          "--out-json", "knowledge_graph/paper_kg.json",
                          "--workflow2-assets-dir", "knowledge_graph",
                          "--max-pairs", str(max_pairs),
                          "--min-confidence", str(min_confidence)]},
            ],
            "outputs": ["knowledge_graph/paper_kg.db", "knowledge_graph/paper_kg.json"],
        },
    ]
