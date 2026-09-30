"""认证路由：登录/注册/token 管理。

会话持久化：token 存 SQLite sessions 表（含过期时间），后端重启不丢会话。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
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


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email.strip()))


class RegisterRequest(AuthRequest):
    role: str = "researcher"
    email: str = ""


class ForgotRequest(BaseModel):
    username: str


class ResetRequest(BaseModel):
    token: str
    new_password: str


# ---- 发信通道：配 AS_SMTP_* 环境变量走真实 SMTP；缺省打后端日志（本地开发模式） ----

RESET_TTL_MINUTES = 30


def _send_reset_mail(to_email: str, reset_link: str) -> str:
    """发送重置链接。返回通道标识（smtp/log）。"""
    host = os.environ.get("AS_SMTP_HOST", "")
    user = os.environ.get("AS_SMTP_USER", "")
    pwd = os.environ.get("AS_SMTP_PASS", "")
    sender = os.environ.get("AS_MAIL_FROM", user)
    body = (f"您（或他人）正在重置 AutoSurvey 账号密码。\n\n"
            f"重置链接（30 分钟内有效，仅可使用一次）：\n{reset_link}\n\n"
            f"若非本人操作，请忽略本邮件。")
    if host and user and pwd:
        import smtplib
        from email.message import EmailMessage
        port = int(os.environ.get("AS_SMTP_PORT", "465"))
        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = to_email
        msg["Subject"] = "AutoSurvey 密码重置"
        msg.set_content(body)
        with smtplib.SMTP_SSL(host, port) as smtp:
            smtp.login(user, pwd)
            smtp.send_message(msg)
        return "smtp"
    # 本地开发模式：重置链接打后端日志（server.log / uvicorn 控制台）
    print(f"[auth] === 密码重置邮件（本地开发模式，收件人 {to_email}）===\n{body}", flush=True)
    return "log"


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
def register(body: RegisterRequest):
    username = body.username.strip()
    email = body.email.strip().lower()
    if len(username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(body.password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    if not _valid_email(email):
        raise HTTPException(400, "邮箱格式不正确")
    conn = get_db()
    dup = conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (username,)
    ).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, "用户名已存在")
    dup_mail = conn.execute(
        "SELECT 1 FROM users WHERE email = ?", (email,)
    ).fetchone()
    if dup_mail:
        conn.close()
        raise HTTPException(409, "该邮箱已被注册")
    pw_hash = hash_password(body.password)
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, role, email) VALUES (?,?,?,?)",
        (username, pw_hash, "researcher", email),
    )
    uid = cur.lastrowid
    # 预置 W2 默认配置：服务器本地 Qwen（免费但慢）——用户可随时在个人中心换成自己的 API
    from db.crypto import encrypt as _enc
    conn.execute(
        "INSERT OR IGNORE INTO llm_configs (user_id, use_case, base_url, api_key_encrypted, model, provider) "
        "VALUES (?,?,?,?,?,?)",
        (uid, "w2", "http://127.0.0.1:11434/v1",
         _enc("local-ollama-qwen-no-key-needed"), "qwen3.6:35b", "openai"))
    conn.commit()
    conn.close()
    # 开数据分区（注册即建，网站基本原则）
    part = provision_user_partition(uid)
    return {"ok": True, "user_id": uid, "partition": part.name}


@router.post("/forgot")
def forgot_password(body: ForgotRequest):
    """忘记密码：发重置链接。防枚举——用户不存在时响应完全一致。"""
    conn = get_db()
    row = conn.execute(
        "SELECT id, email FROM users WHERE username = ?", (body.username.strip(),)
    ).fetchone()
    conn.close()
    if row and row["email"]:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires = (datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES)).isoformat()
        conn = get_db()
        conn.execute(
            "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)",
            (row["id"], token_hash, expires))
        conn.commit()
        conn.close()
        base = os.environ.get("AS_PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")
        link = f"{base}/#/reset?token={token}"
        _send_reset_mail(row["email"], link)
    return {"ok": True, "message": "若该账号存在且已绑定邮箱，重置链接已发送（30 分钟内有效）"}


@router.post("/reset")
def reset_password(body: ResetRequest):
    """重置密码：校验一次性令牌（哈希比对 + 未过期未用）→ 改密 + 踢全部会话。"""
    if len(body.new_password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    conn = get_db()
    row = conn.execute(
        "SELECT id, user_id, expires_at, used FROM password_resets WHERE token_hash = ?",
        (token_hash,)).fetchone()
    if row is None or row["used"] or row["expires_at"] < datetime.utcnow().isoformat():
        conn.close()
        raise HTTPException(400, "重置链接无效或已过期")
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (row["id"],))
    conn.execute("UPDATE users SET password_hash=? WHERE id=?",
                 (hash_password(body.new_password), row["user_id"]))
    conn.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
    # 顺手清掉该用户所有过期未用的重置令牌
    conn.execute("DELETE FROM password_resets WHERE user_id=? AND used=0", (row["user_id"],))
    conn.commit()
    conn.close()
    return {"ok": True, "message": "密码已重置，请用新密码登录"}


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
