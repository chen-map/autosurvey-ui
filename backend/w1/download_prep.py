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


def prep(input_csv: Path, out_dir: Path, *, limit: int = 0) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    ready: list[dict] = []
    no_doi: list[dict] = []
    seen_keys: set[str] = set()
    n_in = n_injected = n_dedup = 0

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

    # 最终保留上限： DOI 锚定清单在前（用户裁决），超出部分不进入下载
    if limit > 0 and len(ready) > limit:
        no_doi = no_doi + ready[limit:]
        ready = ready[:limit]

    def dump(path: Path, rows: list[dict], fields: list[str]) -> None:
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    base_fields = ["record_id", "title", "doi", "url", "year", "venue", "source_db", "abstract"]
    dump(out_dir / "download_ready.csv", ready, base_fields)
    dump(out_dir / "no_doi_records.csv", no_doi, base_fields)

    stats = {
        "input": n_in, "with_doi": len(ready), "no_doi": len(no_doi),
        "limit_applied": limit if limit and n_in > limit else 0,
        "arxiv_doi_injected": n_injected, "duplicates_removed": n_dedup,
    }
    (out_dir / "prep_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="W1-P6 DOI 锚定预处理")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--limit", type=int, default=0, help="最终保留上限（corpus_cap），0=不限")
    args = ap.parse_args()
    stats = prep(Path(args.input), Path(args.out_dir), limit=args.limit)
    print(f"[download_prep] {json.dumps(stats, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
