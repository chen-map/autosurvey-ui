#!/usr/bin/env bash
# AutoSurvey 服务器端引导脚本（Ubuntu 24.04 测试通过）
# 用法: 在解压后的 asv-deploy 目录里  bash bootstrap.sh
set -e
cd "$(dirname "$0")"

APP_DIR="$HOME/asv-app"
ASV="$HOME/autoSurvey_v2"
ENV_DIR="$HOME/asv-env"

echo "== 1. 目录布局"
mkdir -p "$APP_DIR"
cp -r repo/backend "$APP_DIR/"
cp -r repo/dist "$APP_DIR/"
cp -r autoSurvey_v2 "$HOME/"
mkdir -p "$HOME/skills/auto_survey_skills/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts"
cp "$ASV/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts/kg_common.py" \
   "$HOME/skills/auto_survey_skills/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts/kg_common.py"
echo "   app=$APP_DIR  scripts=$ASV  shim=$HOME/skills/..."

echo "== 2. Python 虚拟环境 + 依赖"
python3 -m venv "$ENV_DIR" 2>/dev/null || pip3 install --user virtualenv
"$ENV_DIR/bin/pip" install --upgrade pip -q
"$ENV_DIR/bin/pip" install -r "$APP_DIR/backend/requirements.txt" -q

echo "== 3. kg_common shim（env 注入 LLM 配置）"
cat > "$HOME/skills/auto_survey_skills/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts/kg_common.py" << 'SHIM'
"""kg_common 转发 shim（服务器部署版）。AS_LLM_* 环境变量覆盖默认配置。"""
import importlib.util
import os
_REAL = os.path.expanduser("~/autoSurvey_v2/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts/kg_common.py")
_spec = importlib.util.spec_from_file_location("_kg_common_real_srv", _REAL)
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
if os.environ.get("AS_LLM_BASE_URL"):
    _m.DEFAULT_LLM_BASE_URL = os.environ["AS_LLM_BASE_URL"]
if os.environ.get("AS_LLM_API_KEY"):
    _m.DEFAULT_LLM_API_KEY = os.environ["AS_LLM_API_KEY"]
if os.environ.get("AS_LLM_MODELS"):
    _m.DEFAULT_LLM_MODELS = [x for x in os.environ["AS_LLM_MODELS"].split(",") if x]
for _k in [k for k in dir(_m) if not k.startswith("__")]:
    globals()[_k] = getattr(_m, _k)
SHIM

echo "== 4. 启动（0.0.0.0:8000，nohup 后台）"
cd "$APP_DIR/backend"
pkill -f "uvicorn api.main:app" 2>/dev/null || true
sleep 1
AS_SCRIPTS_ROOT="$ASV" nohup "$ENV_DIR/bin/python" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 > "$APP_DIR/uvicorn.log" 2>&1 &
sleep 6
curl -s -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w "frontend: %{http_code}\n" http://127.0.0.1:8000/

echo "== 完成。访问 http://$(hostname -I | awk '{print $1}'):8000/"
echo "   演示账号 demo/123456（首次登录后请注册自己的账号）"
echo "   日志: $APP_DIR/uvicorn.log | 重启: bash $APP_DIR/restart.sh"
