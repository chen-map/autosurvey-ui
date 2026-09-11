import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { Project } from '@/types';
import { getProject } from '@/services/api';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const TABS = [
  { to: 'rq', label: 'RQ 与证据' },
  { to: 'pipeline', label: '流水线' },
  { to: 'corpus', label: '语料库' },
  { to: 'kg', label: 'KG 图谱' },
  { to: 'report', label: '报告' },
  { to: 'agent', label: 'Agent 分析' },
];

const statusBadge: Record<string, { variant: 'info' | 'ok' | 'neutral'; label: string }> = {
  running: { variant: 'info', label: '运行中' },
  completed: { variant: 'ok', label: '已完成' },
  draft: { variant: 'neutral', label: '草稿' },
};

// 项目内布局：页头（返回/标题/状态）+ 页内标签导航 + 子页面
export function ProjectLayout() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let alive = true;
    if (projectId) getProject(projectId).then((p) => alive && setProject(p ?? undefined as unknown as Project));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const badge = project ? statusBadge[project.status] : null;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <button
        type="button"
        onClick={() => navigate('/projects')}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-t3 transition-colors hover:text-t1"
      >
        <ArrowLeft size={14} />
        全部项目
      </button>

      <div className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold leading-8">
          {project === null ? '加载中…' : project?.title}
        </h1>
        {badge && <Badge variant={badge.variant} withDot={project?.status === 'running'}>{badge.label}</Badge>}
      </div>

      <div className="mt-5 flex gap-1 border-b border-line/70">
        {TABS.map((t) => {
          const active = location.pathname.split('/').filter(Boolean).includes(t.to);
          return (
            <NavLink
              key={t.to}
              to={`/projects/${projectId}/${t.to}`}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[14px] text-t2 transition-colors hover:text-t1',
                active ? 'border-ink font-medium text-t1' : 'border-transparent',
              )}
            >
              {t.label}
            </NavLink>
          );
        })}
      </div>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
