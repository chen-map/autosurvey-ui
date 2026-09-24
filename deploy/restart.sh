#!/usr/bin/env bash
cd "$HOME/asv-app/backend"
pkill -f "uvicorn api.main:app" 2>/dev/null || true
sleep 1
AS_SCRIPTS_ROOT="$HOME/autoSurvey_v2" nohup "$HOME/asv-env/bin/python" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 > "$HOME/asv-app/uvicorn.log" 2>&1 &
sleep 5
curl -s -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:8000/api/health
