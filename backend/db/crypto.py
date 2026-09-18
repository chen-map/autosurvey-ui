"""Fernet 对称加密 + PBKDF2 密码哈希（标准库 + cryptography，无额外依赖）。"""
from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

KEY_FILE = Path(os.environ.get("AS_KEYFILE", str(Path(__file__).resolve().parents[2] / ".master_key")))


def _get_or_create_key() -> bytes:
    """获取或自动生成 Fernet 主密钥（存 .master_key，chmod 600）。"""
    if KEY_FILE.exists():
        return KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_bytes(key)
    os.chmod(KEY_FILE, 0o600)
    return key


_MASTER = _get_or_create_key()
_FERNET = Fernet(_MASTER)


def encrypt(plaintext: str) -> str:
    """加密明文 → base64 密文。"""
    return _FERNET.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    """解密 base64 密文 → 明文。解密失败返回空串（不抛异常，调用方判空）。"""
    try:
        return _FERNET.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def hash_password(password: str) -> str:
    """PBKDF2-SHA256 100k 迭代 → base64(salt + hash)，不可逆。"""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return base64.b64encode(salt + dk).decode("utf-8")


def verify_password(password: str, stored: str) -> bool:
    """验证密码是否匹配存储的哈希。"""
    try:
        raw = base64.b64decode(stored)
        salt, dk = raw[:16], raw[16:]
        test = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return dk == test
    except Exception:
        return False


def mask_key(key: str) -> str:
    """掩码显示：前 4 字符 + •••• + 后 4 字符。"""
    if len(key) <= 8:
        return "••••"
    return key[:4] + "••••" + key[-4:]
