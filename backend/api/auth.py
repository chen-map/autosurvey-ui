"""认证路由：登录/注册/token 管理。"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.crypto import hash_password, verify_password
from db.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 简易 session token（生产环境换 JWT / OAuth）
SECRET = os.environ.get("AS_SECRET", secrets.token_hex(32))
_sessions: dict[str, dict] = {}  # token → {user_id, username, role, created}


class AuthRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(AuthRequest):
    role: str = "researcher"


def _make_token(username: str) -> str:
    raw = f"{username}:{time.time()}:{SECRET}"
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
    _sessions[token] = {"user_id": row["id"], "username": row["username"], "role": row["role"]}
    return {"token": token, "username": row["username"], "role": row["role"]}


@router.post("/register")
def register(body: AuthRequest):
    conn = get_db()
    dup = conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (body.username,)
    ).fetchone()
    conn.close()
    if dup:
        raise HTTPException(409, "用户名已存在")
    pw_hash = hash_password(body.password)
    conn = get_db()
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
        (body.username, pw_hash, "researcher"),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


def get_current_user(token: str) -> dict | None:
    """从 token 查用户（简化版：不做 JWT，生产换 JWT/OAuth）。"""
    return _sessions.get(token)
