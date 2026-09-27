"""认证路由：登录/注册/token 管理。

会话持久化：token 存 SQLite sessions 表（含过期时间），后端重启不丢会话。
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.crypto import hash_password, verify_password
from db.database import get_db, WORKSPACE

router = APIRouter(prefix="/api/auth", tags=["auth"])

SECRET = os.environ.get("AS_SECRET", secrets.token_hex(32))
SESSION_TTL_HOURS = 24 * 7  # 会话有效期 7 天


def provision_user_partition(uid: int) -> Path:
    """开用户数据分区：wm/u{uid}/ + 分区清单。幂等（已存在直接返回）。"""
    import json as _json
    part = WORKSPACE / f"u{uid}"
    part.mkdir(parents=True, exist_ok=True)
    manifest = part / "_partition.json"
    if not manifest.exists():
        manifest.write_text(_json.dumps(
            {"user_id": uid, "created_at": time.strftime("%Y-%m-%d %H:%M:%S")},
            ensure_ascii=False, indent=2), encoding="utf-8")
    return part


class AuthRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(AuthRequest):
    role: str = "researcher"


def _make_token(username: str) -> str:
    raw = f"{username}:{time.time()}:{SECRET}:{secrets.token_hex(16)}"
    return hashlib.sha256(raw.encode()).hexdigest()


@router.post("/login")
def login(body: AuthRequest):
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        (body.username,),
    ).fetchone()
    conn.close()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "账号或密码不正确")
    token = _make_token(body.username)
    expires = (datetime.utcnow() + timedelta(hours=SESSION_TTL_HOURS)).isoformat()
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO sessions (token, user_id, username, role, expires_at) VALUES (?,?,?,?,?)",
        (token, row["id"], row["username"], row["role"], expires),
    )
    # 清理过期会话
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.utcnow().isoformat(),))
    conn.commit()
    conn.close()
    return {"token": token, "username": row["username"], "role": row["role"]}


@router.post("/register")
def register(body: AuthRequest):
    username = body.username.strip()
    if len(username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(body.password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    conn = get_db()
    dup = conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (username,)
    ).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, "用户名已存在")
    pw_hash = hash_password(body.password)
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
        (username, pw_hash, "researcher"),
    )
    uid = cur.lastrowid
    conn.commit()
    conn.close()
    # 开数据分区（注册即建，网站基本原则）
    part = provision_user_partition(uid)
    return {"ok": True, "user_id": uid, "partition": part.name}


def get_current_user(token: str) -> dict | None:
    """从 DB sessions 表查 token 对应的用户；过期自动清除。"""
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT user_id, username, role, expires_at FROM sessions WHERE token = ?",
        (token,),
    ).fetchone()
    if row is None:
        conn.close()
        return None
    expires = row["expires_at"]
    if expires < datetime.utcnow().isoformat():
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
        return None
    conn.close()
    return {"user_id": row["user_id"], "username": row["username"], "role": row["role"]}
