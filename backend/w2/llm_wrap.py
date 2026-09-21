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
import runpy
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def load_llm_config() -> tuple[str, str, list[str]]:
    """读最近一条有效 llm-config（单机应用：取最新的）。DB_PATH 与 API 层同源。"""
    from db.crypto import decrypt  # noqa: PLC0415
    from db.database import DB_PATH  # noqa: PLC0415 — 单一事实源

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT base_url, api_key_encrypted, model FROM llm_configs "
        "WHERE base_url != '' ORDER BY updated_at DESC LIMIT 1").fetchone()
    conn.close()
    if row is None:
        return "", "", []
    key = decrypt(row["api_key_encrypted"])
    models = [row["model"]] if row["model"] else []
    return row["base_url"], key, models


def main() -> None:
    argv = sys.argv[1:]
    if "--target" not in argv:
        raise SystemExit("llm_wrap: 缺少 --target")
    i = argv.index("--target")
    target = Path(argv[i + 1]).resolve()
    rest = argv[:i] + argv[i + 2:]

    target_dir = str(target.parent)
    if target_dir not in sys.path:
        sys.path.insert(0, target_dir)
    import kg_common  # noqa: PLC0415 — 目标脚本同目录的共享 LLM 配置

    base, key, models = load_llm_config()
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
