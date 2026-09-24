"""W5 Phase 定义：Survey Writing（确定性 LaTeX 论文装配）。

run_workflow5.py 无 LLM 依赖——从 W3/W4 产物确定性装配 IEEE 综述论文
（main.tex + 9 sections + tables/figures + references.bib + 自审报告）。
P1 装配工作台（布局映射 + PAPER_INDEX 生成）→ P2 论文装配。
注意：section 文件名（3_attack_surfaces 等）为存量硬编码（源自记忆安全示范域），
对本项目仅文件命名风格沿用，章节内容由 survey_outline + 工作记忆真实驱动。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
STAGE = str(HERE / "stage_workspace.py")


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    scripts = cfg["scripts_root"].rstrip("/") + "/workflow_5_survey_writing"
    ws = cfg.get("workspace_rel", "retrieval_workspace").rstrip("/")
    staging = f"{ws}/w5_workspace"
    paper_out = "survey_paper"

    return [
        {
            "id": "W5-P1",
            "name": "工作台装配（布局映射 + PAPER_INDEX）",
            "optional": False,
            "steps": [
                {"script": STAGE,
                 "args": ["--workspace", ".", "--staging", staging]},
            ],
            "outputs": [f"{staging}/paper_cards/index/PAPER_INDEX.csv",
                        f"{staging}/workflow_4/working_memory/WORKING_MEMORY_INDEX.json"],
        },
        {
            "id": "W5-P2",
            "name": "综述论文装配（LaTeX 全文 + 自审）",
            "optional": False,
            "steps": [
                {"script": f"{scripts}/run_workflow5.py",
                 "args": ["--workspace-root", staging,
                          "--output-dir", paper_out,
                          "--bib-mode", "full-evidence"]},
            ],
            "outputs": [f"{paper_out}/main.tex",
                        f"{paper_out}/references.bib",
                        f"{paper_out}/WORKFLOW5_SELF_REVIEW.md"],
        },
    ]
