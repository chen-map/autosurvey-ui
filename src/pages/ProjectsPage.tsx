import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { Project, ProjectStatus } from '@/types';
import { listProjects } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { WorkflowProgress } from '@/components/WorkflowProgress';
import { FileText, Network, ListChecks, ShieldCheck } from 'lucide-react';

const statusBadge: Record<ProjectStatus, { variant: 'info' | 'ok' | 'neutral'; label: string }> = {
  running: { variant: 'info', label: '运行中' },
  completed: { variant: 'ok', label: '已完成' },
  draft: { variant: 'neutral', label: '草稿' },
};

function Stat({ icon: Icon, value, label }: { icon: typeof FileText; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-t2" title={label}>
      <Icon size={14} className="text-t3" />
      <span className="text-[13px] font-medium text-t1">{value}</span>
      <span className="text-[12px] text-t3">{label}</span>
    </div>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const navigate = useNavigate();
  const s = statusBadge[p.status];
  const claims = (p.stats ?? { claims: { verified: 0 } }).claims;
  const claimsText =
    claims.verified + claims.needsRevision + claims.shouldRemove > 0
      ? `${claims.verified + claims.needsRevision + claims.shouldRemove} 条`
      : '—';
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/projects/${p.id}/rq`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}/rq`)}
      className="flex cursor-pointer flex-col gap-3 p-5 transition-shadow hover:shadow-s2"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[16px] font-semibold leading-6">{p.title}</h3>
        <Badge variant={s.variant} withDot={p.status === 'running'}>
          {s.label}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {p.fieldTags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>

      <WorkflowProgress workflows={p.workflows ?? []} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-3">
        <Stat icon={FileText} value={String(p.stats.papers)} label="论文" />
        <Stat
          icon={Network}
          value={p.stats.kgEdges > 0 ? String(p.stats.kgEdges) : '—'}
          label="KG 边"
        />
        <Stat
          icon={ListChecks}
          value={p.stats.rqs > 0 ? String(p.stats.rqs) : p.status === 'running' ? '设计中' : '—'}
          label="RQ"
        />
        <Stat icon={ShieldCheck} value={claimsText} label="claims" />
      </div>

      <div className="text-[12px] text-t3">更新于 {p.updatedAt}</div>
    </Card>
  );
}

type SortKey = 'updated' | 'created' | 'title';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');

  useEffect(() => {
    let alive = true;
    listProjects().then((ps) => alive && setProjects(ps));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const list = (projects ?? []).filter((p) => p.title.includes(query.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      const ka = sort === 'updated' ? a.updatedAt : a.createdAt;
      const kb = sort === 'updated' ? b.updatedAt : b.createdAt;
      return kb.localeCompare(ka);
    });
  }, [projects, query, sort]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[24px] font-semibold leading-8">全部项目</h1>
        <span className="text-[13px] text-t3">
          {projects ? `共 ${projects.length} 个项目` : '加载中…'}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
          <Input
            className="pl-9"
            placeholder="搜索项目标题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-10 rounded-lg border border-line bg-card px-3 text-[13px] text-t2 focus:border-ink focus:outline-none"
          aria-label="排序方式"
        >
          <option value="updated">最近更新 ↓</option>
          <option value="created">创建时间 ↓</option>
          <option value="title">名称 A-Z</option>
        </select>
      </div>

      {projects === null ? (
        <div className="mt-16 text-center text-[13px] text-t3">加载中…</div>
      ) : shown.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-[14px] text-t2">
            {query ? `没有匹配「${query}」的项目` : '还没有项目，点击左侧「新建综述项目」开始'}
          </p>
        </div>
      ) : (
        <div className="stagger mt-6 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {projects !== null && shown.length > 0 && (
        <p className="mt-6 text-center text-[13px] text-t3">
          Showing {shown.length} out of {projects.length} projects
        </p>
      )}
    </div>
  );
}
