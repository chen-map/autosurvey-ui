import { useEffect, useState } from 'react';
import type { UserRecord } from '@/types/data';
import type { Project } from '@/types';
import { listProjects, listUsers } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { WorkflowProgress } from '@/components/WorkflowProgress';

export function AdminPage() {
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    listUsers().then((u) => alive && setUsers(u));
    listProjects().then((p) => alive && setProjects(p));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (username: string) =>
    setUsers((s) => (s ?? []).map((u) => (u.username === username ? { ...u, status: u.status === 'active' ? 'disabled' : 'active' } : u)));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-[24px] font-semibold leading-8">管理后台</h1>
        <p className="mt-1 text-[13px] text-t3">管理员视角：全项目总览与用户管理（深度用户管理在变更池 v2）</p>
      </div>

      {/* 项目总览 */}
      <Card className="p-5">
        <div className="text-[14px] font-medium">全项目总览</div>
        <div className="mt-4 space-y-3">
          {(projects ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-4 rounded-lg border border-line/60 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{p.title}</div>
                <div className="mt-1"><WorkflowProgress workflows={p.workflows} /></div>
              </div>
              <div className="shrink-0 text-right text-[12px] text-t3">
                <div>{p.stats.papers} papers · {p.stats.kgEdges} edges</div>
                <div>{p.updatedAt}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 用户管理 */}
      <Card className="overflow-hidden">
        <div className="border-b border-line/60 px-5 py-3 text-[14px] font-medium">用户管理</div>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line/60 text-[12px] uppercase tracking-wide text-t3">
              <th className="px-5 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">角色</th>
              <th className="px-3 py-2.5 font-medium">最近活跃</th>
              <th className="px-5 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.username} className="border-b border-line/40 last:border-0">
                <td className="px-5 py-2.5 font-medium text-t1">{u.username}</td>
                <td className="px-3 py-2.5">
                  <Badge variant={u.role === 'admin' ? 'info' : 'neutral'}>{u.role === 'admin' ? '管理员' : '研究者'}</Badge>
                </td>
                <td className="px-3 py-2.5 text-t2">{u.lastActive}</td>
                <td className="px-5 py-2.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-t2">
                    <input
                      type="checkbox"
                      checked={u.status === 'active'}
                      onChange={() => toggle(u.username)}
                      className="h-4 w-4 accent-black"
                    />
                    {u.status === 'active' ? '启用' : '停用'}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
