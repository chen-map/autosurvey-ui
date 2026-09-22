#!/usr/bin/env python3
"""W3 LLM 文档阶段驱动器（gap 分析 / RQ 设计 / 综述评审）。

WORKFLOW3_GUIDE 的 Phase 1/2/6 在存量库中是纯技能（SKILL.md，无脚本），
本驱动器在执行器层补位：读取 KG 摘要与上游产物，按任务组装提示词调用
统一 LLM（复用 w2/llm_wrap 的 use_case 解析链），按分隔符把一次生成的
多份 markdown 拆写为 GUIDE 要求的产物文件。

用法：python llm_doc.py --task gap|design|review --out-dir analyze_report ...
LLM 输出契约：用「=== FILE: <相对路径> ===」分节，每节为一份完整 markdown。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "w2"))
from llm_wrap import load_llm_config  # noqa: E402  复用 use_case→default 解析链

FILE_SPLIT_RE = re.compile(r"^=== FILE:\s*(.+?)\s*===\s*$", re.M)
MAX_CHARS = 9000  # 嵌入提示词的上下文截断


def read_text(p: Path, limit: int = MAX_CHARS) -> str:
    try:
        return p.read_text(encoding="utf-8")[:limit]
    except OSError:
        return ""


def chat(base_url: str, api_key: str, model: str, system: str, user: str, max_tokens: int = 7800) -> str:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def write_files(out_dir: Path, content: str) -> list[str]:
    """按 === FILE: path === 分节拆写；无标记则整体写 main.md。

    LLM 可能输出带 out-dir 前缀的路径（提示词示例即含 analyze_report/），
    这里剥掉重复前缀，保证落点恰为 out_dir/<相对路径>。
    """
    parts = FILE_SPLIT_RE.split(content)
    written: list[str] = []
    prefix = f"{out_dir.as_posix().strip('/')}/"
    if len(parts) >= 3:
        it = iter(parts[1:])
        for rel, body in zip(it, it):
            rel = rel.strip().lstrip("/")
            if rel.startswith(prefix):
                rel = rel[len(prefix):]
            if not rel or ".." in rel:
                continue
            p = out_dir / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body.strip() + "\n", encoding="utf-8")
            written.append(rel)
    if not written:
        (out_dir / "main.md").write_text(content.strip() + "\n", encoding="utf-8")
        written.append("main.md")
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description="W3 LLM 文档阶段（gap/design/review）")
    ap.add_argument("--task", required=True, choices=["gap", "design", "review", "revise"])
    ap.add_argument("--out-dir", default="analyze_report")
    ap.add_argument("--domain", default="", help="领域描述/综述主题")
    ap.add_argument("--kg-summary", default="knowledge_graph/KG_SUMMARY.md")
    ap.add_argument("--use-case", default="", help="LLM use_case（默认 w3.<task>）")
    ap.add_argument("--stats", default="", help="JSON：KG 规模统计（可选，注入提示词）")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    base_url, api_key, model = load_llm_config(args.use_case or f"w3.{args.task}")
    # llm_configs.model 存的是列表（kg_common 取首个），这里同样归一
    if isinstance(model, (list, tuple)):
        model = model[0] if model else ""
    kg_summary = read_text(Path(args.kg_summary))
    stats = args.stats

    if args.task == "gap":
        system = (
            "你是学术综述规划专家（Survey Gap Analyzer）。职责：先核对本地已有综述（若无则明确说明"
            "并基于 KG 事实开展），再依据 KG 领域摘要理解领域现状（方法、问题、数据集、指标、争议、"
            "时间演进），识别已有综述未覆盖的空白、争议与新兴趋势，最后推荐最合适的综述类型"
            "（descriptive/comparative/causal/trend/gap/evaluative 之一）并说明理由。\n"
            "输出三份 markdown，用「=== FILE: 路径 ===」分节：\n"
            "=== FILE: analyze_report/related_review_report.md ===（已有综述调研；无本地综述时基于 KG 概念聚类推断学界综述格局）\n"
            "=== FILE: analyze_report/gap_summary.md ===（领域空白分析：每条 gap 给出 KG 证据引用）\n"
            "=== FILE: analyze_report/survey_type_selection.md ===（综述类型选择依据）\n"
            "全部用中文，术语保留英文。"
        )
        user = f"综述主题/领域描述：{args.domain or '（见 KG 摘要）'}\n\nKG 规模：{stats}\n\nKG 领域摘要：\n{kg_summary}"
    elif args.task == "design":
        gap = read_text(out_dir / "gap_summary.md")
        related = read_text(out_dir / "related_review_report.md", 4000)
        system = (
            "你是综述问题设计专家（Problem Formulation & RQ Designer）。基于 gap 分析与 KG 摘要，"
            "动态确认综述类型，设计 3-5 个 Macro-RQ，每个 Macro-RQ 配 2-3 个可查询、可验证的 Sub-RQ，"
            "并为每个 Sub-RQ 预埋证据钩子（依赖的 KG 节点类型、边类型、英文焦点词）。\n"
            "硬性格式约束：design_report.md 中 Macro-RQ 必须有形如「RQ1: 问题文本」的行，"
            "Sub-RQ 必须有形如「- RQ1.1: 问题文本」的行（编号与父 RQ 对应）——下游脚本按此正则解析，违反即失败。\n"
            "focus_terms / 查询钩子一律用英文关键词（KG 语料为英文）。\n"
            "输出三份 markdown（=== FILE: === 分节）：\n"
            "=== FILE: analyze_report/design_report.md ===\n"
            "=== FILE: analyze_report/review_protocol.md ===\n"
            "=== FILE: analyze_report/survey_design_summary.md ===\n"
            "全部用中文，术语保留英文。"
        )
        user = (f"综述主题/领域描述：{args.domain or '（见 KG 摘要）'}\n\n"
                f"KG 规模：{stats}\n\n== gap_summary ==\n{gap}\n\n== 相关综述报告（节选）==\n{related}\n\n"
                f"== KG 领域摘要 ==\n{kg_summary}")
    else:  # review
        files = ["gap_summary.md", "design_report.md", "rq_query_report.md", "survey_outline.md"]
        ctx = "\n\n".join(f"== {f} ==\n{read_text(out_dir / f, 5000)}" for f in files)
        system = (
            "你是综述设计评审专家（Report Review）。对以上 Workflow 3 设计包做两轮独立审查："
            "第一轮聚焦一致性与证据充分性（gap↔RQ 对齐、answerability 弱项是否已处理、大纲与证据结构一致），"
            "第二轮聚焦可用性（Workflow 4/5 能否直接消费）。每轮给出问题清单与处置建议；"
            "最后汇总为最终综合报告（结论：可交付 / 需返工 + 理由）。\n"
            "输出三份 markdown（=== FILE: === 分节）：\n"
            "=== FILE: analyze_report/review/main_round1.md ===\n"
            "=== FILE: analyze_report/review/main_round2.md ===\n"
            "=== FILE: analyze_report/survey_research_report.md ===\n"
            "全部用中文。"
        )
        user = f"综述主题：{args.domain or '（见文档）'}\n\n{ctx}"

    if args.task == "revise":
        # 反思修订：单文件直写（不拆分），只改被拦截的 Sub-RQ
        verify = read_text(Path(args.out_dir) / "verify_report.json", 12000)
        design = read_text(Path(args.out_dir) / "design_report.md", 12000)
        system = (
            "你是 RQ 反思修订专家（Reflection & Revision Loop）。以下 design_report.md 中的一部分 Sub-RQ "
            "在 KG 查询落地时被拦截（匹配论文数 < 2）。请只改写这些被拦截的 Sub-RQ：措辞对齐 KG 中真实存在的"
            "概念词汇（参考 KG 摘要与其中的英文术语），focus_terms 换成 KG 里高频出现的英文概念词；"
            "保持 RQ 编号体系、格式契约（「RQ1: 文本」行 / 「- RQ1.1: 文本」行）与未拦截内容完全不变。\n"
            "直接输出修订后的完整 design_report.md 的 markdown 全文，不要任何 FILE 分节标记、不要解释。"
        )
        user = (f"== 核验报告（被拦截清单与当前 focus_terms）==\n{verify}\n\n"
                f"== 当前 design_report.md ==\n{design}\n\n== KG 领域摘要 ==\n{kg_summary}")
        print(f"[llm_doc] task=revise model={model} base={base_url}", flush=True)
        content = chat(base_url, api_key, model, system, user)
        target = Path(args.out_dir) / "design_report.md"
        backup = Path(args.out_dir) / "design_report.pre_revise.md"
        if target.exists() and not backup.exists():
            backup.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"[llm_doc] 修订已写入 {target}（原稿备份 design_report.pre_revise.md）", flush=True)
        return 0

    print(f"[llm_doc] task={args.task} model={model} base={base_url}", flush=True)
    content = chat(base_url, api_key, model, system, user)
    written = write_files(out_dir, content)
    # 兜底：review 的 LLM 偶发忽略 FILE 分节（输出落 main.md），综合报告必检，拷贝补位
    if args.task == "review" and "main.md" in written:
        main_doc = out_dir / "main.md"
        report = out_dir / "survey_research_report.md"
        if not report.exists():
            report.write_text(main_doc.read_text(encoding="utf-8"), encoding="utf-8")
            written.append("survey_research_report.md（自 main.md 兜底）")
    print(f"[llm_doc] 产出: {written}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
