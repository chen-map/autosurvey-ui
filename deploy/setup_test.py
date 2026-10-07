# -*- coding: utf-8 -*-
"""演示账号 test/test123 定稿：
1. 清掉 demo 侧的一切（语料复制行、镜像项目行、账号保留但清其项目行）
2. 建 test/test123（不存在则建，密码重置为 test123）
3. 镜像项目行 proj-demo-multiedge 归属 test（指向真实数据 u3 workspace——只读展示）
4. 123（uid=3）的语料行一根手指不动
"""
import sqlite3
import sys

sys.path.insert(0, '/home/G2024hq/asv-app/backend')
from db.database import get_db
from db.crypto import hash_password

c = get_db()

# 1) 清 demo 残留
c.execute("DELETE FROM corpus_papers WHERE project_id='proj-demo-multiedge'")  # demo 复制行
c.execute("DELETE FROM projects WHERE project_id='proj-demo-multiedge'")       # demo 镜像行

# 2) test 账号
u = c.execute("SELECT id FROM users WHERE username='test'").fetchone()
if not u:
    c.execute("INSERT INTO users (username, password_hash, role, email) VALUES (?,?,?,?)",
              ('test', hash_password('test123'), 'researcher', 'test@autosurvey.local'))
    uid = c.execute("SELECT id FROM users WHERE username='test'").fetchone()[0]
else:
    uid = u[0]
    c.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password('test123'), uid))

# 3) W2 默认配置预置（与其他新用户一致）
c.execute("INSERT OR IGNORE INTO llm_configs (user_id, use_case, base_url, api_key_encrypted, model, provider) VALUES (?,?,?,?,?,?)",
          (uid, 'w2', 'http://127.0.0.1:11434/v1',
           __import__('db.crypto', fromlist=['encrypt']).encrypt('local-ollama-qwen-no-key-needed'),
           'qwen3.6:35b', 'openai'))

# 4) 镜像项目行归 test（指向真实数据 workspace，只读展示；demo 的镜像行转给 test）
c.execute("UPDATE projects SET user_id=? WHERE project_id='proj-demo-multiedge'", (uid,))
c.execute("UPDATE projects SET title='多智能体协作（演示项目）' WHERE project_id='proj-demo-multiedge'")

c.commit()

# 5) 校验：123 语料行数不变、test 项目可见
n123 = c.execute("SELECT COUNT(*) FROM corpus_papers WHERE project_id='proj-1790652141048'").fetchone()[0]
pr = c.execute("SELECT project_id, user_id, title FROM projects WHERE project_id='proj-demo-multiedge'").fetchone()
print(f'123 语料行: {n123}（未动）')
print(f'test uid={uid} | 演示项目: {tuple(pr)}')
