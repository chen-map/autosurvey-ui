"""W1 Phase 定义：脚本、参数渲染、产物清单（配置驱动，存量脚本零改动）。

参数模板中的值来自 w1_config.json（前端 createProject 载荷生成），
映射关系见 docs/w1-pipeline-design.md §5。
"""
from __future__ import annotations

from pathlib import Path
HERE = Path(__file__).resolve().parent

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
                          "--output", f"{ws}/golden_set/keyword_analysis", "--top-n", "30"]},
            ],
            "outputs": [f"{ws}/golden_set/keyword_analysis/search_strings.md"],
        },
        {
            "id": "W1-P2",
            "name": "七数据库检索",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/multi_database_searcher/search_databases.py",
                 "args": ["--db", "all", "--query-file", f"{ws}/golden_set/keyword_analysis/search_strings.md",
                          "--start-year", str(year_from), "--end-year", str(year_to),
                          "--max-results", str(cfg.get("search_cap", 2000)),
                          "--output", f"{ws}/raw_results/"]},
            ],
            "outputs": [f"{ws}/raw_results/"],
            # arXiv 合规补充源：OAI-PMH 增量元数据（Retry-After 退避 + 日限额 + 合规 UA），经 P3 归一合流
            "steps_tail": [
                {"script": str(HERE / "arxiv_oai.py"),
                 "args": ["--set", cfg.get("oai_sets", "cs"),
                          "--from", f"{year_from}-01-01",
                          "--out", f"{ws}/raw_results/arxiv_oai_results.csv",
                          "--max-records", str(cfg.get("oai_max_records", 800)),
                          "--contact-email", cfg.get("contact_email", "researcher@example.com")]},
            ],
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
            "steps_tail": [
                {"script": str(Path(__file__).resolve().parent / "cache_ingest.py"),
                 "args": ["--normalized", f"{ws}/normalized/unified_records.csv",
                          "--cache-db", str(Path(cfg["workspace"]) / "paper_cache.sqlite3")]},
            ],
        },
        {
            "id": "W1-P4",
            "name": "六阶段筛选",
            "optional": False,
            "steps": [
                {"script": str(HERE / "simple_screen.py"),
                 "args": ["--input", f"{ws}/normalized/unified_records.csv",
                          "--topic", cfg.get("topic", ""),
                          "--output-dir", f"{ws}/screening/"]},
            ],
            "outputs": [f"{ws}/screening/screened_records.csv", f"{ws}/screening/screening_log.md"],
        },
        {
            "id": "W1-P5",
            "name": "滚雪球扩展",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/snowball_searcher/snowball_search.py",
                 "args": ["--direction", "both", "--input", f"{ws}/normalized/unified_records.csv",
                          "--output", f"{ws}/snowball/"]},
            ],
            "outputs": [f"{ws}/snowball/snowball_candidates.csv"],
        },
        {
            "id": "W1-P6",
            "name": "论文下载（DOI 锚定 · 五级合法降级）",
            "optional": False,
            "steps": [
                # DOI 锚定预处理（用户裁决：不用 DOI 会跑偏）——消毒/补 arXiv DOI/去重/无 DOI 分流
                {"script": str(HERE / "download_prep.py"),
                 "args": ["--input", f"{ws}/snowball/snowball_candidates.csv",
                          "--out-dir", f"{ws}/download/",
                          "--limit", str(cfg.get("corpus_cap", 500))]},
                # arXiv 批量直连先行（限速 5s/篇 + 全局冷却 + 断点续传）：
                # OAI 收割的记录带官方 DOI，走 export.arxiv.org 一次到位；
                # 剩余无 arXiv ID / 失败的才交给下面五级降级链兜底
                {"script": str(HERE / "arxiv_batch.py"),
                 "args": ["--input", f"{ws}/download/download_ready.csv",
                          "--out-dir", f"{ws}/papers/",
                          "--stats-out", f"{ws}/download/arxiv_batch_stats.json",
                          "--min-interval-sec", str(cfg.get("arxiv_dl_min_interval", 5.0)),
                          "--contact-email", cfg.get("contact_email", "researcher@example.com")]},
                {"script": f"{scripts}/paper_downloader/download_papers.py",
                 "args": ["--input", f"{ws}/download/download_ready.csv",
                          "--output", f"{ws}/papers/", "--no-scihub", "--skip-existing",
                          "--delay", "2",
                          "--unpaywall-email", cfg.get("unpaywall_email", "autosurvey@example.com")]},
            ],
            "outputs": [f"{ws}/download/prep_stats.json",
                        f"{ws}/download/arxiv_batch_stats.json",
                        f"{ws}/papers/download_report.md"],
            # 下载完成 → 入本地库（用户裁决：语料页从 corpus_papers 表读）
            "steps_tail": [
                {"script": str(HERE / "corpus_ingest.py"),
                 "args": ["--download-dir", f"{ws}/download/",
                          "--papers-dir", f"{ws}/papers/",
                          "--project-id", cfg["project_id"],
                          "--db", str(HERE.parents[1] / "autosurvey.db")]},
            ],
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
