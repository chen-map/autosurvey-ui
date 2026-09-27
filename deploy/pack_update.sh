#!/usr/bin/env bash
# 打增量更新包（本机跑）：把待同步文件打包成 asv-update.tar.gz
# 用法: bash deploy/pack_update.sh  → 产出 deploy/asv-update.tar.gz
set -e
cd "$(dirname "$0")/.."

LIST=(
  backend/api/main.py
  backend/api/auth.py
  backend/db/database.py
  backend/w2/llm_wrap.py
  backend/w1/runner.py
  backend/w1/phase_defs.py
  backend/w1/arxiv_batch.py
  backend/w1/arxiv_search.py
  backend/w1/simple_screen.py
  backend/requirements.txt
  deploy/restart.sh
  deploy/update_server.sh
)

tar -czf deploy/asv-update.tar.gz "${LIST[@]}"
# dist 前端单独打（解压到 repo/dist）
tar -czf deploy/asv-dist-update.tar.gz -C dist .
echo "打包完成:"
ls -la deploy/asv-update.tar.gz deploy/asv-dist-update.tar.gz
tar -tzf deploy/asv-update.tar.gz
