"""W2 LLM 注入桥：把用户加密库存的 url+apikey+model 注入存量脚本。

背景（用户裁决：url+apikey+model 统一执行器；存量脚本零改动）：
build_structured_papers.py / build_paper_kg.py 不接受 LLM 参数，依赖 kg_common
的内置默认配置。本包装在其导入后、执行前覆盖 kg_common 模块级默认值，
使 W2 使用 autosurvey.db 里用户自己存的 LLM 配置（Fernet 解密）。

用法（phase_defs 调起）：
  python llm_wrap.py --target <legacy_script.py> [原始脚本参数...]
"""
from __future__ import annotations

import json
import os
import runpy
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def _run_user_id() -> int:
    """当前运行归属用户：_spawn_runner 注入 AS_RUN_USER_ID；缺失时回落 1（旧单机数据兼容）。"""
    try:
        return int(os.environ.get("AS_RUN_USER_ID", "1"))
    except ValueError:
        return 1


def load_llm_config_full(use_case: str, user_id: int | None = None) -> tuple[str, str, list[str], str]:
    """load_llm_config 的 provider 版：返回 (base, key, models, provider)。

    W2 内置服务器本地 Qwen（用户裁决：全员免配置，W2 不读用户配置表）——
    AS_W2_LOCAL_BASE / AS_W2_LOCAL_MODEL / AS_W2_LOCAL_KEY 环境变量可覆盖默认。
    """
    if use_case == "w2":
        base = os.environ.get("AS_W2_LOCAL_BASE", "http://127.0.0.1:11434/v1")
        model = os.environ.get("AS_W2_LOCAL_MODEL", "qwen3.6:35b")
        key = os.environ.get("AS_W2_LOCAL_KEY", "local-ollama-qwen-no-key-needed")
        return base, key, [model], "openai"

    from db.crypto import decrypt  # noqa: PLC0415
    from db.database import DB_PATH  # noqa: PLC0415 — 单一事实源

    uid = user_id if user_id is not None else _run_user_id()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    rows = {r["use_case"]: r for r in conn.execute(
        "SELECT use_case, base_url, api_key_encrypted, model, provider FROM llm_configs WHERE user_id=?", (uid,)).fetchall()}
    conn.close()
    for uc in (use_case, "default"):
        r = rows.get(uc)
        if r is None:
            continue
        key = decrypt(r["api_key_encrypted"])
        if r["base_url"] and key and r["model"]:
            provider = r["provider"] if "provider" in r.keys() else "openai"
            return r["base_url"], key, [r["model"]], provider
    return "", "", [], "openai"


def load_llm_config(use_case: str, user_id: int | None = None) -> tuple[str, str, list[str]]:
    """按使用点读 llm-config，解析链：环节专属 → default。DB_PATH 与 API 层同源。
    user_id 缺省时取 AS_RUN_USER_ID（项目归属用户），多用户不串号。
    需要 provider 时用 load_llm_config_full。"""
    base, key, models, _provider = load_llm_config_full(use_case, user_id)
    return base, key, models


def main() -> None:
    argv = sys.argv[1:]
    if "--target" not in argv:
        raise SystemExit("llm_wrap: 缺少 --target")
    i = argv.index("--target")
    target = Path(argv[i + 1]).resolve()
    rest = argv[:i] + argv[i + 2:]
    use_case = "default"
    if "--use-case" in rest:
        j = rest.index("--use-case")
        use_case = rest[j + 1]
        rest = rest[:j] + rest[j + 2:]

    target_dir = str(target.parent)
    if target_dir not in sys.path:
        sys.path.insert(0, target_dir)
    # 可选：跨工作流共享的 kg_common 所在目录（如 W3 rq_card_linker 复用 W2 的 kg_common）
    if "--kg-common-path" in rest:
        j = rest.index("--kg-common-path")
        kg_dir = rest[j + 1]
        rest = rest[:j] + rest[j + 2:]
        if kg_dir and kg_dir not in sys.path:
            sys.path.insert(0, kg_dir)
    import kg_common  # noqa: PLC0415 — 目标脚本同目录的共享 LLM 配置

    base, key, models = load_llm_config(use_case)
    print(json.dumps({"llm_wrap": True, "use_case": use_case, "user_id": _run_user_id()}, ensure_ascii=False), file=sys.stderr)
    if base:
        kg_common.DEFAULT_LLM_BASE_URL = base
    if key:
        kg_common.DEFAULT_LLM_API_KEY = key
    if models:
        kg_common.DEFAULT_LLM_MODELS = models
    print(json.dumps({"llm_wrap": True, "base_url": kg_common.DEFAULT_LLM_BASE_URL,
                      "model": kg_common.DEFAULT_LLM_MODELS,
                      "key_from_db": bool(key)}, ensure_ascii=False),
          file=sys.stderr)

    sys.argv = [str(target), *rest]
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
