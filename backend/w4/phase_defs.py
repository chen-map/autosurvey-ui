r"""W4 Phase 定义：KG 分析三层架构（v3）。

主参考文档"三层架构"的真实实现（kg_analysis/ 包，~5000 行）：
  L1 原子操作（kg_loader/extract/logic/semantic 工具）
  L2 37 个分析 Skill（layer2_skills/ markdown 规范）
  L3 LLM Agent（anthropic tool_use 循环，自主选 Skill + 调工具推理）

Phase 流水：
  W4-P0 KG 适配        paper_kg.json（单文件）→ v3 目录布局（nodes/ + edges/）
  W4-P1 Agent 逐RQ深析  L3 Agent 每个宏 RQ 一次自主分析（自动选 Skill → 工具循环 → HTML 报告 + 6 文件工作记忆）
  W4-P2 W5 契约适配    v3 产物 → working_memory/rq_N/{working_memory,answer_claims,rq_answer}.json + INDEX
  W4-P3 自检           W5 输入契约完整性校验

LLM 通道：v3 说 Anthropic 协议（anthropic SDK，ANTHROPIC_BASE_URL/KEY 可覆盖）。
个人中心 W4 配置 provider=anthropic + base_url（DeepSeek 填 https://api.deepseek.com/anthropic）。
旧版实现备份于 phase_defs_legacy_v2.py.bak。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
KG_PKG = HERE / "kg_analysis"
SKILLS_ROOT = str(KG_PKG / "layer2_skills")


def build_phases(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    # 路径一律 cwd 相对（runner cwd=workspace）：W2 产物在根 knowledge_graph/、W3 在根
    # analyze_report/——曾用 workspace_rel 前缀导致 W4-P0 找不到 KG 秒失败（实测教训）
    return [
        {
            "id": "W4-P0",
            "name": "KG 适配（paper_kg.json → v3 目录布局）",
            "optional": False,
            "steps": [
                {"script": str(HERE / "kg_adapter.py"),
                 "args": ["--kg", "knowledge_graph/paper_kg.json",
                          "--out", "kg_v3"]},
            ],
            "outputs": ["kg_v3/nodes/papers.json",
                        "kg_v3/edges"],
        },
        {
            "id": "W4-P1",
            "name": "Agent 逐 RQ 深析（L3 工具循环，37 Skills 自选）",
            "optional": False,
            "steps": [
                {"script": str(HERE / "run_v3_agent.py"),
                 "args": ["--workspace", ".",
                          "--skills-root", SKILLS_ROOT,
                          "--out-dir", "kg_analysis",
                          "--use-case", "w4"],
                 # embedding 模型已在本地 HF 缓存——离线模式跳过每次联网 HEAD 检查
                 #（服务器连不上 huggingface.co 时 5 轮重试白耗 ~1 分钟/RQ）
                 "env": {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
                 "timeout": 14400},
            ],
            "outputs": ["kg_analysis/working_memory"],
        },
        {
            "id": "W4-P2",
            "name": "W5 契约适配（working_memory/answer_claims/INDEX）",
            "optional": False,
            "steps": [
                {"script": str(HERE / "v3_to_w5_adapter.py"),
                 "args": ["--v3-out", "kg_analysis/working_memory",
                          "--out", "working_memory",
                          "--matrix", "analyze_report/rq_evidence_matrix.json"]},
            ],
            "outputs": ["working_memory/WORKING_MEMORY_INDEX.json"],
        },
        {
            "id": "W4-P3",
            "name": "自检（W5 输入契约完整性）",
            "optional": True,
            "steps": [
                {"script": str(HERE / "w4_selfcheck.py"),
                 "args": ["--wm", "working_memory"]},
            ],
            "outputs": ["working_memory/WORKFLOW4_SELF_CHECK.md"],
        },
    ]
