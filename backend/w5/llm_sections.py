#!/usr/bin/env python3
"""W5-P3 LLM 正文撰写：用真实工作记忆逐章生成 LaTeX 叙事，替换装配器的硬编码示范文。

原则（用户裁决）：
  - W2（KG）与 W4（工作记忆）产物是大头，正文只是它们的渲染层；
  - LLM 只允许基于工作记忆中的 rq_answer / 维度 / 共识 / 证据片段写作，
    引用一律 \\cite{paper_id}（与 references.bib 键一致），不得编造。
每章一次 LLM 调用；写 manifest.json 供 runner 校验。
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys_path = str(HERE.parent / "w2")
if sys_path not in __import__("sys").path:
    __import__("sys").path.insert(0, sys_path)
from llm_wrap import load_llm_config  # noqa: E402

# RQ → 章节文件（run_workflow5 的固定装配顺序）
RQ_SECTION_FILES = ["3_attack_surfaces.tex", "4_attack_families.tex", "5_defenses.tex", "6_evidence_maturity.tex"]


def chat(base_url: str, api_key: str, model: str, system: str, user: str, max_tokens: int = 4000) -> str:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"]


def rq_payload_summaries(wm_dir: Path) -> list[dict]:
    idx = json.loads((wm_dir / "WORKING_MEMORY_INDEX.json").read_text(encoding="utf-8"))
    out = []
    for entry in idx.get("rqs", []):
        # 索引里的路径相对 W1 根（含 working_memory/ 前缀），去掉前缀后相对 wm_dir
        rel = entry.get("rq_answer_path", "").replace("\\", "/")
        if rel.lower().startswith("working_memory/"):
            rel = rel[len("working_memory/"):]
        p = wm_dir / rel
        if not p.exists():
            continue
        a = json.loads(p.read_text(encoding="utf-8"))
        out.append({
            "rq_id": entry.get("rq_id"),
            "rq_text": entry.get("rq_text", ""),
            "rq_type": a.get("rq_type", ""),
            "overall_answer": a.get("overall_answer", ""),
            "dimensions": [
                {"label": d.get("dimension_label", ""), "summary": d.get("dimension_summary", ""),
                 "papers": len(d.get("papers") or [])}
                for d in (a.get("evidence_by_dimension") or [])
            ],
            "consensus": (a.get("cross_paper_patterns") or {}).get("consensus") or [],
            "sub_answers": [
                {"id": s.get("sub_rq_id"), "answer": s.get("answer", ""), "confidence": s.get("confidence")}
                for s in (a.get("sub_rq_answers") or [])
            ],
            "gaps": [g.get("gap_description", "") for g in (a.get("evidence_gaps") or [])],
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="W5-P3 LLM 正文撰写")
    ap.add_argument("--staging", default="retrieval_workspace/w5_workspace")
    ap.add_argument("--sections-dir", default="survey_paper/sections")
    ap.add_argument("--use-case", default="w5.write")
    ap.add_argument("--out-manifest", default="survey_paper/sections/llm_written.json")
    args = ap.parse_args()

    wm_dir = Path(args.staging) / "workflow_4" / "working_memory"
    sections_dir = Path(args.sections_dir)
    rq_data = rq_payload_summaries(wm_dir)
    if not rq_data:
        print("[llm_sections] 无工作记忆可写")
        return 1

    base, key, model = load_llm_config(args.use_case)
    if isinstance(model, list):
        model = model[0] if model else ""
    system = (
        "你是学术综述写作者。基于给定的真实工作记忆（RQ 答案、维度、共识、证据）撰写综述的一个章节，"
        "输出纯 LaTeX 正文（不含 \\section 标题行，那由装配器提供）。要求：\n"
        "1. 所有论断必须来自给定材料，关键论断用 \\cite{paper_id} 引用（paper_id 见材料中的论文 ID，原样使用）；\n"
        "2. 结构建议：先总起一段，再按维度/子问题分段，结尾指出证据缺口；\n"
        "3. 如实呈现材料中的分歧与缺口，不得编造论文、数据或结论；\n"
        "4. 学术英语，每章 3-6 段。"
    )

    manifest = {"sections": [], "model": model}

    # RQ 章节（3-6）：按大纲顺序逐章撰写
    for i, payload in enumerate(rq_data):
        target = sections_dir / RQ_SECTION_FILES[i] if i < len(RQ_SECTION_FILES) else None
        if target is None:
            break
        user = (f"章节主题（来自综述大纲）：{payload['rq_text']}\n\n"
                f"工作记忆（真实证据）：\n{json.dumps(payload, ensure_ascii=False, indent=1)[:9000]}")
        tex = chat(base, key, model, system, user)
        target.write_text(tex.strip() + "\n", encoding="utf-8")
        manifest["sections"].append(str(target.name))
        print(f"[llm_sections] {target.name} 写入（{len(tex)} 字符）", flush=True)

    # 摘要：汇总四个 RQ 的整体答案
    abstract_user = ("为综述撰写 abstract（一段英文，150-220 词）。四个研究问题及其整体答案如下：\n"
                     + "\n".join(f"- {p['rq_id']}: {p['overall_answer'][:500]}" for p in rq_data))
    abstract_tex = chat(base, key, model,
                        "你是综述摘要写作者。只输出摘要正文一段，不含 \\begin{abstract} 等命令，不加标题。",
                        abstract_user, max_tokens=1200)
    (sections_dir / "0_abstract.tex").write_text(abstract_tex.strip() + "\n", encoding="utf-8")
    manifest["sections"].append("0_abstract.tex")
    print("[llm_sections] abstract 写入", flush=True)

    # 引用键扩展：LLM 常写短键（如 2049），bib 键为完整 paper_id——前缀唯一匹配展开
    bib_path = sections_dir.parent / "references.bib"
    if bib_path.exists():
        bib_keys = re.findall(r"@misc\{([^,]+),", bib_path.read_text(encoding="utf-8"))

        def expand(mo: re.Match) -> str:
            keys = [k.strip() for k in mo.group(1).split(",")]
            out_keys = []
            for k in keys:
                if k in bib_keys:
                    out_keys.append(k)
                    continue
                cands = [bk for bk in bib_keys if bk.startswith(k)]
                out_keys.append(cands[0] if len(cands) == 1 else k)
            return "\cite{" + ",".join(out_keys) + "}"

        for sec in manifest["sections"]:
            f = sections_dir / sec
            f.write_text(re.sub(r"\cite\{([^}]*)\}", expand, f.read_text(encoding="utf-8")), encoding="utf-8")

    Path(args.out_manifest).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_manifest).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[llm_sections] 完成 {len(manifest['sections'])} 节")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
