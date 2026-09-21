"""W1-P6 后置：下载结果入本地库（corpus_papers 表）。

用户裁决：下载完成后写入用户端本地数据库，语料库页从库中读取（后端衔接）。
读取 download/download_ready.csv（DOI 锚定清单）与 no_doi_records.csv（无 DOI 分流），
对照 papers/ 目录实际产出判定状态：PDF=downloaded / 占位 txt=failed / 无 DOI=no_doi，
UPSERT 进 autosurvey.db 的 corpus_papers 表（与 users/api_keys 等同一本地库）。

用法：python corpus_ingest.py --download-dir <ws/download> --papers-dir <ws/papers>
              --project-id <pid> --db <autosurvey.db>
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS corpus_papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    doi TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    year INTEGER,
    url TEXT NOT NULL DEFAULT '',
    abstract TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'failed',
    pdf_path TEXT NOT NULL DEFAULT '',
    record_id TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, doi, title)
);
"""

FIELDS = ("record_id", "title", "doi", "url", "year", "venue", "source_db", "abstract")


def read_rows(csv_path: Path) -> list[dict]:
    if not csv_path.exists():
        return []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]


def find_artifact(papers_dir: Path, record_id: str, ext: str) -> str:
    """下载器产物命名为 {record_id:04d}_{slug}.{ext}，按 record_id 前缀匹配。"""
    rid = str(record_id)
    prefix = f"{int(rid):04d}_" if rid.isdigit() else f"{rid}_"
    for p in sorted(papers_dir.glob(f"{prefix}*.{ext}")):
        return str(p)
    return ""


def ingest(download_dir: Path, papers_dir: Path, project_id: str, db_path: Path) -> dict:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(SCHEMA)
    counts = {"downloaded": 0, "failed": 0, "no_doi": 0, "upserted": 0}

    def upsert(row: dict, status: str, pdf_path: str) -> None:
        conn.execute(
            """INSERT INTO corpus_papers
               (project_id, doi, title, venue, year, url, abstract, source, status, pdf_path, record_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(project_id, doi, title) DO UPDATE SET
                 status=excluded.status, pdf_path=excluded.pdf_path,
                 url=excluded.url, abstract=excluded.abstract""",
            (
                project_id,
                row.get("doi", ""),
                row.get("title", ""),
                row.get("venue", ""),
                int(row["year"]) if row.get("year", "").isdigit() else None,
                row.get("url", ""),
                row.get("abstract", ""),
                row.get("source_db", ""),
                status,
                pdf_path,
                row.get("record_id", ""),
            ),
        )
        counts["upserted"] += 1
        counts[status] += 1

    # DOI 锚定清单：对照 papers/ 实际产出判定 downloaded / failed
    for row in read_rows(download_dir / "download_ready.csv"):
        pdf = find_artifact(papers_dir, row.get("record_id", ""), "pdf")
        upsert(row, "downloaded" if pdf else "failed", pdf)

    # 无 DOI 分流：不进下载器，直接落库供人工/本地合并兜底
    for row in read_rows(download_dir / "no_doi_records.csv"):
        upsert(row, "no_doi", "")

    conn.commit()
    conn.close()
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description="W1-P6 下载结果入库（corpus_papers）")
    ap.add_argument("--download-dir", required=True)
    ap.add_argument("--papers-dir", required=True)
    ap.add_argument("--project-id", required=True)
    ap.add_argument("--db", required=True)
    args = ap.parse_args()
    counts = ingest(Path(args.download_dir), Path(args.papers_dir), args.project_id, Path(args.db))
    print(f"[corpus_ingest] {json.dumps(counts, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
