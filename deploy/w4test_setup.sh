#!/bin/bash
set -e
PID=proj-w4v3-test
W=$HOME/asv-app/backend/wm/u1/$PID/w1
mkdir -p $W
tar -xzf $HOME/w4test-inputs.tar.gz -C $W
cat > $W/w1_config.json <<'CFG'
{"project_id": "proj-w4v3-test", "title": "W4 v3 服务器验证", "workspace_rel": "retrieval_workspace", "scripts_root": "/home/G2024hq/autoSurvey_v2"}
CFG
cd $HOME/asv-app/backend
$HOME/asv-env/bin/python - <<'PYEOF'
import sys
sys.path.insert(0, '.')
from db.database import get_db
conn = get_db()
conn.execute("INSERT OR REPLACE INTO projects (project_id, user_id, title, workspace_rel) VALUES ('proj-w4v3-test', 1, 'W4 v3 服务器验证', 'u1/proj-w4v3-test/w1')")
conn.commit()
conn.close()
print('project row ok')
PYEOF
ls $W
du -sh $W
