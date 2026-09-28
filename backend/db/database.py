"""SQLite 连接 + 全表 schema（加密数据库）。"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "autosurvey.db"
# 用户数据分区基目录（单一事实源：api/main.py 与 api/auth.py 共用）
WORKSPACE = Path(os.environ.get("AS_WORKSPACE", str(Path(__file__).resolve().parents[1] / "wm")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'researcher',
    created_at TEXT DEFAULT (datetime('now'))
);

-- 项目归属：每个项目属于一个用户；workspace_rel 相对 WORKSPACE 基目录（多用户隔离）
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL DEFAULT '',
    workspace_rel TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 登录会话持久化（后端重启不丢会话）
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'researcher',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
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

-- 找回密码：一次性令牌（只存 SHA256 哈希，明文 token 仅出现在发信内容里）
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
"""

# 列迁移（幂等）：存量库补新列
_MIGRATIONS = [
    ("users", "email", "ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''"),
]


def _run_migrations(conn: sqlite3.Connection) -> None:
    for table, col, ddl in _MIGRATIONS:
        cols = {d[1] for d in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if col not in cols:
            conn.execute(ddl)
    _migrate_llm_configs_unique(conn)


def _migrate_llm_configs_unique(conn: sqlite3.Connection) -> None:
    """老库 llm_configs 是 user_id 单列 UNIQUE（每用户仅一行配置）→ 重建为
    UNIQUE(user_id, use_case)。不加此迁移，PUT /api/me/llm-config 的
    ON CONFLICT(user_id, use_case) 在老库上直接报错（per-WF 配置功能全坏）。"""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='llm_configs'").fetchone()
    if row is None:
        return
    sql = " ".join((row[0] or "").split())
    if "UNIQUE(user_id, use_case)" in sql:
        return  # 已是新结构
    conn.executescript("""
DROP TABLE IF EXISTS llm_configs_new;
CREATE TABLE llm_configs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    use_case TEXT NOT NULL DEFAULT 'default',
    base_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    provider TEXT NOT NULL DEFAULT 'openai',
    UNIQUE(user_id, use_case)
);
INSERT INTO llm_configs_new (user_id, use_case, base_url, api_key_encrypted, model, updated_at, provider)
    SELECT user_id, CASE WHEN COALESCE(use_case,'')='' THEN 'default' ELSE use_case END,
           base_url, api_key_encrypted, model, updated_at,
           COALESCE(provider,'openai')
    FROM llm_configs;
DROP TABLE llm_configs;
ALTER TABLE llm_configs_new RENAME TO llm_configs;
""")


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
    _run_migrations(conn)
    conn.commit()
    conn.close()


def _migrate_llm_provider():
    try:
        conn = get_db()
        conn.execute("ALTER TABLE llm_configs ADD COLUMN provider TEXT DEFAULT 'openai'")
        conn.commit()
        conn.close()
    except Exception:
        pass  # 列已存在
