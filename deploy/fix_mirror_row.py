# -*- coding: utf-8 -*-
import sqlite3

c = sqlite3.connect('/home/G2024hq/asv-app/autosurvey.db')
uid = c.execute("SELECT id FROM users WHERE username='test'").fetchone()[0]
c.execute("INSERT OR REPLACE INTO projects (project_id, user_id, title, workspace_rel) VALUES (?,?,?,?)",
          ('proj-demo-multiedge', uid, '多智能体协作（演示项目）', 'u3/proj-1790652141048/w1'))
c.commit()
r = c.execute("SELECT project_id, user_id, title FROM projects WHERE project_id='proj-demo-multiedge'").fetchone()
print('镜像行:', tuple(r))
