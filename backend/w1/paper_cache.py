"""论文标识符级缓存（来源：apipick 文章三工程动作之一，[来源] 已核）。

以 DOI / arXiv ID / 标题哈希为键的 SQLite 缓存：
同一篇论文被多个 query 命中时只算一次；流水线重跑不重复拉取外部 API。
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
  cache_key TEXT PRIMARY KEY,
  source TEXT DEFAULT '',
  title TEXT DEFAULT '',
  authors TEXT DEFAULT '[]',
  year INTEGER,
  doi TEXT DEFAULT '',
  venue TEXT DEFAULT '',
  url TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  payload_json TEXT DEFAULT '{}',
  fetched_at TEXT DEFAULT (datetime('now')),
  hits INTEGER DEFAULT 1
);
"""


def key_for(record: dict) -> str:
    """缓存键：DOI 优先 → arXiv ID → 标题哈希。"""
    doi = (record.get("doi") or "").strip().lower().replace("https://doi.org/", "")
    if doi:
        return "doi:" + doi
    url = record.get("url") or ""
    if "arxiv.org" in url:
        return "arxiv:" + url.rstrip("/").rsplit("/", 1)[-1]
    title = (record.get("title") or "").strip().lower()
    if title:
        return "title:" + hashlib.sha1(title.encode("utf-8")).hexdigest()[:16]
    return ""


class PaperCache:
    def __init__(self, db_path: str | Path):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def upsert(self, record: dict) -> bool:
        """按缓存键去重写入。返回 True=新增，False=命中已有（hits+1）。"""
        k = key_for(record)
        if not k:
            return False
        row = self.conn.execute("SELECT 1 FROM papers WHERE cache_key=?", (k,)).fetchone()
        payload = json.dumps(record, ensure_ascii=False)
        if row:
            self.conn.execute(
                "UPDATE papers SET payload_json=?, hits=hits+1, fetched_at=datetime('now') WHERE cache_key=?",
                (payload, k))
            self.conn.commit()
            return False
        self.conn.execute(
            "INSERT INTO papers (cache_key, source, title, authors, year, doi, venue, url, abstract, payload_json)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (k, record.get("source_db") or record.get("source") or "",
             record.get("title") or "", json.dumps(record.get("authors") or [], ensure_ascii=False),
             record.get("year"), record.get("doi") or "", record.get("venue") or "",
             record.get("url") or "", (record.get("abstract") or "")[:4000], payload))
        self.conn.commit()
        return True

    def upsert_many(self, records) -> int:
        return sum(1 for r in records if self.upsert(r))

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]

    def get(self, key: str) -> dict | None:
        row = self.conn.execute("SELECT payload_json FROM papers WHERE cache_key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None
