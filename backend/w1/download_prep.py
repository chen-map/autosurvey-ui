"""W1-P6 前置：DOI 锚定预处理（执行器层，存量 download_papers.py 零改动）。

用户裁决：最终下载必须以 DOI 为锚，不用 DOI 会跑偏。本步骤把上游候选集
（滚雪球/筛选输出）整理成 DOI 锚定的下载清单：

1. DOI 归一：去 https://doi.org/ 前缀、去空白、去空值；按 DOI + arXiv ID 去重
2. arXiv 记录补 DOI：无 DOI 但 URL/字段含 arXiv ID 的，注入 10.48550/arXiv.<id>
   （arXiv 官方 DOI，Unpaywall / doi.org / 下载器 arxiv 策略均可消费）
3. 标题消毒：去除 Windows 非法文件名字符（存量脚本 write_placeholder 用标题
   拼文件名，实测脏标题会让整批下载崩溃）
4. 分流：有 DOI → download_ready.csv（进下载器）；无 DOI 且无 arXiv ID →
   no_doi_records.csv（不进下载器，走人工/P7 本地合并兜底）

用法：python download_prep.py --input snowball_candidates.csv --out-dir <dir>
产出：download_ready.csv / no_doi_records.csv / prep_stats.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?", re.IGNORECASE)
ARXIV_DOI_RE = re.compile(r"10\.48550/arxiv\.([0-9]{4}\.[0-9]{4,5})", re.IGNORECASE)
DOI_PREFIX_RE = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.IGNORECASE)
# Windows 文件名非法字符 + 控制字符（占位文件名崩溃根源）
ILLEGAL_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def normalize_doi(raw: str) -> str:
    d = DOI_PREFIX_RE.sub("", (raw or "").strip())
    return d.rstrip("/").rstrip(".")


def sanitize_title(title: str) -> str:
    t = ILLEGAL_RE.sub("", title or "")
    return re.sub(r"\s+", " ", t).strip()


def arxiv_id_of(record: dict) -> str:
    for field in (record.get("url", ""), record.get("doi", "")):
        m = ARXIV_RE.search(field) or ARXIV_DOI_RE.search(field)
        if m:
            return m.group(1)
    return ""


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def prep(input_csv: Path, out_dir: Path, *, limit: int = 0,
         scores_csv: Path | None = None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    ready: list[dict] = []
    no_doi: list[dict] = []
    seen_keys: set[str] = set()
    n_in = n_injected = n_dedup = 0

    # 评分回填映射（标题/DOI → _score）：滚雪球等下游产物可能剥掉 _score 列，
    # 用 P4 筛选输出做侧文件恢复评分，保证 --limit 截断的是评分 Top-N
    score_by_key: dict[str, float] = {}
    if scores_csv and scores_csv.exists():
        with open(scores_csv, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    s = float(row.get("_score", "") or -1)
                except ValueError:
                    continue
                if row.get("title"):
                    score_by_key["t:" + _norm_title(row["title"])] = s
                if row.get("doi"):
                    score_by_key["d:" + normalize_doi(row["doi"])] = s

    with open(input_csv, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            n_in += 1
            rec = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            rec["title"] = sanitize_title(rec.get("title", ""))
            rec["doi"] = normalize_doi(rec.get("doi", ""))

            aid = arxiv_id_of(rec)
            if not rec["doi"] and aid:
                rec["doi"] = f"10.48550/arXiv.{aid}"
                n_injected += 1
            if aid:
                rec["arxiv_id"] = aid

            key = rec["doi"] or (f"arxiv:{aid}" if aid else f"title:{rec['title'].lower()}")
            if key in seen_keys:
                n_dedup += 1
                continue
            seen_keys.add(key)

            if rec["doi"]:
                ready.append(rec)
            else:
                no_doi.append(rec)

    # 评分降序（同分新→旧）：截断即 Top-N 评分筛选；无评分的滚雪球扩展记录排最后
    def year_key(rec: dict) -> int:
        y = rec.get("year", "")
        return int(y) if str(y).isdigit() else 0

    def score_of(rec: dict) -> float:
        if "_score" in rec and rec["_score"]:
            try:
                return float(rec["_score"])
            except ValueError:
                pass
        return score_by_key.get("d:" + rec["doi"],
                                score_by_key.get("t:" + _norm_title(rec["title"]), -1.0))

    ready.sort(key=lambda r: (-score_of(r), -year_key(r)))

    # 最终保留上限：评分 Top-N 在前（用户裁决），超出部分不进入下载
    if limit > 0 and len(ready) > limit:
        no_doi = no_doi + ready[limit:]
        ready = ready[:limit]

    def dump(path: Path, rows: list[dict], fields: list[str]) -> None:
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    base_fields = ["record_id", "title", "doi", "url", "year", "venue", "source_db", "abstract", "_score"]
    dump(out_dir / "download_ready.csv", ready, base_fields)
    dump(out_dir / "no_doi_records.csv", no_doi, base_fields)

    stats = {
        "input": n_in, "with_doi": len(ready), "no_doi": len(no_doi),
        "limit_applied": limit if limit and n_in > limit else 0,
        "arxiv_doi_injected": n_injected, "duplicates_removed": n_dedup,
        "score_sorted": bool(score_by_key) or any("_score" in r for r in ready),
    }
    (out_dir / "prep_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="W1-P6 DOI 锚定预处理")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--limit", type=int, default=0, help="最终保留上限（corpus_cap），0=不限")
    ap.add_argument("--scores", default="", help="P4 筛选输出（含 _score 列），回填评分用侧文件")
    args = ap.parse_args()
    stats = prep(Path(args.input), Path(args.out_dir), limit=args.limit,
                 scores_csv=Path(args.scores) if args.scores else None)
    print(f"[download_prep] {json.dumps(stats, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
