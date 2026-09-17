"""W1 Phase 定义：脚本、参数渲染、产物清单（配置驱动，存量脚本零改动）。

参数模板中的值来自 w1_config.json（前端 createProject 载荷生成），
映射关系见 docs/w1-pipeline-design.md §5。
"""
from __future__ import annotations

from typing import Any


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """按配置渲染 W1 七个 Phase 的执行步骤。每个 step = 一个存量脚本的调起。"""
    scripts = cfg["scripts_root"].rstrip("/") + "/workflow_1_corpus_construction"
    ws = cfg.get("workspace_rel", "retrieval_workspace").rstrip("/")
    year_from, year_to = cfg.get("year_range", [2018, 2026])
    domain = " / ".join(cfg.get("domain_tags", [])) or cfg.get("topic", "general")
    has_local = bool(cfg.get("local_dir"))

    def golden(*ps: str) -> list[str]:
        return [f"{ws}/golden_set/{p}" for p in ps]

    phases: list[dict[str, Any]] = [
        {
            "id": "W1-P1",
            "name": "Golden Set 检索式构建",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/golden_set_builder/extract_seed_metadata.py",
                 "args": ["--input", cfg["seed_dir"], "--output", f"{ws}/golden_set/seed_papers.csv"]},
                {"script": f"{scripts}/golden_set_builder/keyword_analyzer.py",
                 "args": ["--input", f"{ws}/golden_set/seed_papers.csv", "--domain", domain,
                          "--output", f"{ws}/golden_set/search_strings.md", "--top-n", "30"]},
            ],
            "outputs": golden("seed_papers.csv", "search_strings.md"),
        },
        {
            "id": "W1-P2",
            "name": "七数据库检索",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/multi_database_searcher/search_databases.py",
                 "args": ["--db", "all", "--query-file", f"{ws}/golden_set/search_strings.md",
                          "--start-year", str(year_from), "--end-year", str(year_to),
                          "--max-results", str(cfg.get("search_cap", 2000)),
                          "--output", f"{ws}/raw_results/"]},
            ],
            "outputs": [f"{ws}/raw_results/"],
        },
        {
            "id": "W1-P3",
            "name": "归一化与去重",
            "optional": False,
            "requires": ["rapidfuzz"],
            "steps": [
                {"script": f"{scripts}/record_normalizer/normalize_and_dedup.py",
                 "args": ["--input", f"{ws}/raw_results/", "--output", f"{ws}/normalized/",
                          "--title-threshold", "0.90",
                          "--golden-set", f"{ws}/golden_set/seed_papers.csv"]},
            ],
            "outputs": [f"{ws}/normalized/unified_records.csv"],
        },
        {
            "id": "W1-P4",
            "name": "六阶段筛选",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/six_stage_screener/screening_manager.py",
                 "args": ["--init", "--workspace", f"{ws}/screening/",
                          "--input", f"{ws}/normalized/unified_records.csv"]},
                *[{"script": f"{scripts}/six_stage_screener/screening_manager.py",
                   "args": ["--stage", str(n), "--workspace", f"{ws}/screening/"]}
                  for n in range(1, 7)],
                {"script": f"{scripts}/six_stage_screener/screening_manager.py",
                 "args": ["--report", "--workspace", f"{ws}/screening/"]},
            ],
            "outputs": [f"{ws}/screening/stage6_final.csv", f"{ws}/screening/screening_log.md"],
        },
        {
            "id": "W1-P5",
            "name": "滚雪球扩展",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/snowball_searcher/snowball_search.py",
                 "args": ["--direction", "both", "--input", f"{ws}/normalized/unified_records.csv",
                          "--output", f"{ws}/snowball/", "--merge"]},
            ],
            "outputs": [f"{ws}/snowball/FINAL_INCLUDED_PAPERS.csv"],
        },
        {
            "id": "W1-P6",
            "name": "论文下载（六级降级）",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/paper_downloader/download_papers.py",
                 "args": ["--input", f"{ws}/snowball/FINAL_INCLUDED_PAPERS.csv",
                          "--output", f"{ws}/papers/", "--no-scihub", "--skip-existing",
                          "--delay", "2"]},
            ],
            "outputs": [f"{ws}/papers/download_report.md"],
        },
    ]

    if has_local:
        phases.append({
            "id": "W1-P7",
            "name": "本地论文合并",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/local_paper_merger/merge_local_papers.py",
                 "args": ["--local-dir", cfg["local_dir"], "--corpus-dir", f"{ws}/corpus/",
                          "--title-threshold", "0.90"]},
            ],
            "outputs": [f"{ws}/corpus/CORPUS_PAPERS.csv"],
        })
    return phases
