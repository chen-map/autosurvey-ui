"""SQLite 连接 + 全表 schema（加密数据库）。"""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "autosurvey.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'researcher',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    platform TEXT NOT NULL,
    key_encrypted TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, platform)
);

-- 按使用点细分 LLM 配置（会议裁决：不同环节可用不同 AI）；use_case='default' 为全局兜底
CREATE TABLE IF NOT EXISTS llm_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    use_case TEXT NOT NULL DEFAULT 'default',
    base_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, use_case)
);

CREATE TABLE IF NOT EXISTS directions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL DEFAULT '',
    fields_json TEXT NOT NULL DEFAULT '[]',
    goal TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    paper_idx INTEGER,
    source TEXT NOT NULL DEFAULT 'corpus',
    title TEXT NOT NULL DEFAULT '',
    authors TEXT DEFAULT '',
    venue TEXT DEFAULT '',
    year INTEGER,
    doi TEXT DEFAULT '',
    collection TEXT DEFAULT '未分类',
    saved_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, doi, title)
);

-- W1 语料库：下载完成后由 corpus_ingest.py 落库（用户裁决：下载后入本地库，语料页从库读）
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

CREATE INDEX IF NOT EXISTS idx_corpus_project ON corpus_papers(project_id);

-- 用户状态类数据 KV（方向库/知识库等前端全量同步；行级规范化后续迁移）
CREATE TABLE IF NOT EXISTS user_kv (
    user_id INTEGER NOT NULL,
    k TEXT NOT NULL,
    v TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, k)
);
"""


def get_db() -> sqlite3.Connection:
    """获取数据库连接（启用外键 + WAL 模式）。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    """初始化数据库表（幂等）。"""
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
