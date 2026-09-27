#!/usr/bin/env bash
# 服务器增量更新（服务器上跑）：备份先行 → 解包覆盖 → 主密钥体检 → 重启 → 验证
# 用法（本机远程执行）:
#   scp deploy/asv-update.tar.gz deploy/asv-dist-update.tar.gz G2024hq@222.20.126.64:~/asv-app/
#   ssh G2024hq@222.20.126.64 'bash -s' < deploy/update_server.sh
set -e
APP_DIR="$HOME/asv-app"
ASV="$HOME/autoSurvey_v2"
ENV_DIR="$HOME/asv-env"
TS=$(date +%Y%m%d-%H%M%S)

echo "== 1. 备份先行（backend + DB + 主密钥 → ~/asv-backup/$TS）"
BK="$HOME/asv-backup/$TS"
mkdir -p "$BK"
cp -a "$APP_DIR/backend" "$BK/backend" 2>/dev/null || true
[ -f "$APP_DIR/autosurvey.db" ] && cp -a "$APP_DIR/autosurvey.db" "$BK/" || true
[ -f "$APP_DIR/backend/.master_key" ] && cp -a "$APP_DIR/backend/.master_key" "$BK/" || true
[ -f "$HOME/asv-app/.master_key" ] && cp -a "$HOME/asv-app/.master_key" "$BK/" || true
echo "备份于 $BK"

echo "== 2. 解包覆盖"
cd "$APP_DIR"
tar -xzf asv-update.tar.gz
mkdir -p "$APP_DIR/repo/dist.new" && tar -xzf asv-dist-update.tar.gz -C "$APP_DIR/repo/dist.new"
rm -rf "$APP_DIR/repo/dist.old" && mv "$APP_DIR/repo/dist" "$APP_DIR/repo/dist.old" 2>/dev/null || true
mv "$APP_DIR/repo/dist.new" "$APP_DIR/repo/dist"

echo "== 3. 主密钥体检（必须是服务器本地生成的，绝不能是 git 泄露过的那把）"
KEYF=""
[ -f "$APP_DIR/backend/.master_key" ] && KEYF="$APP_DIR/backend/.master_key"
[ -z "$KEYF" ] && [ -f "$HOME/.master_key" ] && KEYF="$HOME/.master_key"
LEAKED_SHA="需比对（本仓库曾泄露两把：根目录与 backend/ 下）"
if [ -n "$KEYF" ]; then
  echo "密钥文件: $KEYF (sha256 $(sha256sum "$KEYF" | cut -c1-16)...)"
  echo "⚠️ 请人工核对该密钥不是已泄露的（泄露值开头: YGg9ogWBauV / txLHGSjrDH0O）。"
  echo "   若匹配泄露值: rm '$KEYF' 后重启服务自动生成新钥，并在网页重新录入 LLM Key。"
else
  echo "未找到密钥文件——服务启动时会自动生成（首次启动后请确认 .master_key 权限 600）。"
fi

echo "== 4. 存量脚本补丁落地（W2 文件锁治本版，之前传到 asv-deploy 的）"
PATCHED="$HOME/asv-deploy/build_paper_kg.py.patched"
TARGET="$ASV/workflow_2_factual_memory_construction/paper-cards-kg-builder/scripts/build_paper_kg.py"
if [ -f "$PATCHED" ] && [ -f "$TARGET" ]; then
  cp -a "$TARGET" "$TARGET.bak-$TS"
  cp "$PATCHED" "$TARGET"
  echo "已替换 build_paper_kg.py（原文件备份 .bak-$TS）"
else
  echo "跳过（$PATCHED 或目标不存在——若已手工替换可忽略）"
fi

echo "== 5. 重启服务"
cd "$APP_DIR/backend"
pkill -f "uvicorn api.main:app" 2>/dev/null || true
sleep 1
AS_SCRIPTS_ROOT="$ASV" nohup "$ENV_DIR/bin/python" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 > "$APP_DIR/uvicorn.log" 2>&1 &
sleep 6

echo "== 6. 验证"
curl -s -o /dev/null -w "health:   %{http_code}\n" http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w "frontend: %{http_code}\n" http://127.0.0.1:8000/
curl -s -X POST http://127.0.0.1:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"123456"}' -o /dev/null -w "login:    %{http_code}\n"
echo "== 可选配置提醒（写进启动环境/面板生效）:"
echo "   找回密码真发信: AS_SMTP_HOST / AS_SMTP_PORT(465) / AS_SMTP_USER / AS_SMTP_PASS / AS_MAIL_FROM"
echo "   重置链接域名:   AS_PUBLIC_URL=https://<对外地址>（Cloudflare Tunnel 配好后填）"
echo "完成。日志: tail -50 $APP_DIR/uvicorn.log"
