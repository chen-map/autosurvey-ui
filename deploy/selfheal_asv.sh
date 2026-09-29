#!/bin/bash
# 开机自愈守护（cron 每分钟调）：uvicorn 拉活 + W2 runner 断点续传
# 关机/断电后开机 1 分钟内自动恢复，无需人工。僵尸进程不算活（shutdown 遗留 defunct 不挡拉起）。
PY=/home/G2024hq/asv-env/bin/python
APP=/home/G2024hq/asv-app
WS=$APP/backend/wm/u3/proj-1790652141048/w1
SCRIPTS=/home/G2024hq/autoSurvey_v2
NOTIFY=$APP/selfheal.log

note() { echo "$(date '+%F %T') $*" >> "$NOTIFY"; }

alive() {  # $1=pgrep -f 完整片段；只认非僵尸进程
  local pid st
  for pid in $(pgrep -f "$1" 2>/dev/null); do
    st=$(ps -o stat= -p "$pid" 2>/dev/null) || continue
    case "$st" in Z*) ;; *) return 0 ;; esac
  done
  return 1
}

# 1) 后端 uvicorn（未起才拉；拉起即恢复前端+API）
if ! alive "uvicorn api.main:app --host 0.0.0.0 --port 8000"; then
  cd "$APP/backend" && AS_SCRIPTS_ROOT=$SCRIPTS \
    setsid nohup "$PY" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 \
    > "$APP/uvicorn.log" 2>&1 < /dev/null &
  note "拉起 uvicorn"
fi

# 2) W2 runner（W2 四阶段未全完成且无存活 runner 才拉；checkpoint 断点续传，不重算已评对）
if [ -f "$WS/w2_state.json" ]; then
  ALLDONE=$("$PY" -c "import json;d=json.load(open('$WS/w2_state.json'));print('yes' if all(p.get('status')=='done' for p in d.get('phases',[])) else 'no')" 2>/dev/null)
  if [ "$ALLDONE" = "no" ] && ! alive "runner.py --config $WS/w1_config.json --workflow w2"; then
    cd "$WS" && AS_RUN_USER_ID=3 setsid nohup "$PY" "$APP/backend/w1/runner.py" \
      --config "$WS/w1_config.json" --workflow w2 --resume >> "$WS/runner_w2.log" 2>&1 < /dev/null &
    note "拉起 W2 runner（断点续传）"
  fi
fi
