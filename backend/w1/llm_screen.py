"""llm_screen.py — W1-P4 六阶段筛选判断收敛层（w1-pipeline-design §4/§5）。

把 skill 形态的"LLM 自由填写判断"收敛为：固定 prompt + temperature=0 + 缓存 + 启发式兜底。
消除 skill 形态最大的不稳定源（筛选决策由会话自由填写）。

用法：
    python llm_screen.py --stage 1 --input screening/stage1_title.csv \
        --workspace screening/ --topic "LLM Agent 安全" [--llm-config llm.json] [--limit 50]

行为：
  - 读入 stage CSV，逐条判断
  - 缓存命中（record_hash + prompt_version）直接复用；未命中调 LLM（配置存在时）或启发式规则
  - 决策回写 CSV 的 decision/reason 列；启发式结果标注 heuristic
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

PROMPT_VERSION = "v1"

STAGE_TASKS: dict[int, str] = {
    1: "标题筛选：判断该论文标题是否与研究主题相关（related=true/false）",
    2: "摘要筛选：判断该论文摘要是否满足纳入标准（related=true 进入下一阶段）",
    3: "可获取性：判断全文是否可获取（DOI 或预印本可查即 available）",
    4: "全文筛选：综合判断是否值得纳入综述（include=true/false）",
    5: "质量评估：按方法学/相关性/证据三维打分（各 1-3 分）",
    6: "最终纳入：汇总各阶段结论给出最终去留",
}


def batch_prompt(stage: int, records: list[dict], topic: str) -> str:
    rec_lines = "\n".join(
        f"{i}. {str(r.get('title', ''))[:80]} | 摘要片段: {str(r.get('abstract', ''))[:120]}"
        for i, r in enumerate(records)
    )
    task = STAGE_TASKS.get(stage, "筛选判断")
    return (
        f"研究主题：{topic}\n任务：{task}\n"
        f'对以下每条记录给出判断，严格输出 JSON 数组（不要解释）：\n'
        f'[{{"index":0,"decision":"include|exclude","reason":"一句话理由"}}, …]\n\n'
        f"记录列表（共 {len(records)} 条）：\n{rec_lines}\n"
    )


def parse_llm_json(raw: str, count: int) -> list[dict]:
    import json as _json

    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError(f"LLM 输出不含 JSON 数组: {text[:120]}")
    arr = _json.loads(text[start : end + 1])
    if not isinstance(arr, list) or len(arr) != count:
        raise ValueError("LLM 数组数量与输入不匹配")
    return arr


def topic_words(topic: str) -> set[str]:
    stop = {"的", "与", "和", "在", "及", "for", "and", "the", "of", "a"}
    return {
        w.lower()
        for w in topic.replace("：", " ").replace("，", " ").split()
        if len(w) >= 2 and w.lower() not in stop
    } or {"."}


def heuristic_record(record: dict, stage: int, topic_words: set[str]) -> dict:
    """无 LLM 时的规则兜底（关键词命中，显式标注来源）。"""
    text = (str(record.get("title", "")) + " " + str(record.get("abstract", ""))).lower()
    hits = sum(1 for w in topic_words if w.lower() in text)
    include = hits >= 2
    return {
        "decision": "include" if include else "exclude",
        "reason": f"heuristic: 命中 {hits} 个主题词",
    }


def llm_chat(cfg: dict, messages: list[dict]) -> str:
    import json as _json
    import urllib.request

    req = urllib.request.Request(
        cfg["baseUrl"].rstrip("/") + "/chat/completions",
        data=_json.dumps({"model": cfg["model"], "messages": messages, "temperature": 0},
                         ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {cfg['apiKey']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = _json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def main() -> int:
    parser = argparse.ArgumentParser(description="六阶段筛选判断（LLM 收敛层）")
    parser.add_argument("--stage", type=int, required=True, choices=[1, 2, 3, 4, 5, 6])
    parser.add_argument("--input", required=True, help="stage CSV 路径")
    parser.add_argument("--workspace", required=True, help="screening 工作目录")
    parser.add_argument("--topic", default="", help="研究主题")
    parser.add_argument("--llm-config", default="", help="LLM 配置 JSON 文件（空=纯启发式）")
    parser.add_argument("--limit", type=int, default=0, help="最多处理条数（0=全部）")
    args = parser.parse_args()

    import pandas as pd

    cache_path = Path(args.workspace) / f"llm_cache_stage{args.stage}.json"
    cache: dict = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

    df = pd.read_csv(args.input, dtype=str).fillna("")
    if args.limit:
        df = df.head(args.limit)

    tw = topic_words(args.topic)
    decisions: list[dict] = []
    llm_used = 0
    for idx, r in df.iterrows():
        rk = hashlib.sha1(f"{PROMPT_VERSION}|{args.stage}|{r.get('title', '')}".encode()).hexdigest()[:12]
        if rk in cache:
            decisions.append(cache[rk])
            continue
        rec = {"title": r.get("title", ""), "abstract": r.get("abstract", "")[:500], "doi": r.get("doi", "")}
        if args.llm_config and Path(args.llm_config).exists():
            cfg = json.loads(Path(args.llm_config).read_text(encoding="utf-8"))
            sys_msg = f"你是 SLR 筛选助手。研究主题：{args.topic}。任务：{STAGE_TASKS.get(args.stage, '筛选判断')}。只输出 JSON。"
            raw = llm_chat(cfg, [
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": json.dumps(rec, ensure_ascii=False)},
            ])
            reason = raw.strip()
            llm_used += 1
        else:
            reason = heuristic_record(r, args.stage, tw)["reason"]
        decisions.append({"index": idx, "decision": "include" if "include" in reason or "相关" in reason else "exclude", "reason": reason})
        if args.limit and idx >= args.limit - 1:
            break
    out = df.copy()
    out["decision_reason"] = [d["reason"] for d in decisions]
    out.to_csv(args.input, index=False, encoding="utf-8")
    cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"stage {args.stage}: {len(out)} 条判断完成（llm_used={llm_used}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
