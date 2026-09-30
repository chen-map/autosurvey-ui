import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play, RotateCcw, FileText, Network, Clock } from 'lucide-react';
import type { PipelineRun, PhaseState } from '@/types/data';
import { getPipeline, startRun, getW4Reports, fetchW4ReportHtml, getCorpus, type W4Report } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// skipped：可选阶段降级跳过（runner optional 机制）；未知状态一律回退 pending，防 undefined 崩溃
const statusStyle: Record<string, { dot: string; label: string }> = {
  pending: { dot: 'bg-line', label: '待执行' },
  running: { dot: 'bg-run animate-pulse', label: '运行中' },
  done: { dot: 'bg-ok', label: '完成' },
  failed: { dot: 'bg-danger', label: '失败' },
  checkpoint: { dot: 'bg-warn-fg', label: 'checkpoint' },
  skipped: { dot: 'bg-warn-fg', label: '已降级跳过' },
};

function Stat({ icon: Icon, value, label }: { icon: typeof FileText; value: string; label: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <Icon size={20} className="text-t3" />
      <div>
        <div className="text-[20px] font-semibold leading-7">{value}</div>
        <div className="text-[12px] text-t3">{label}</div>
      </div>
    </Card>
  );
}

function fmt(sec?: number) {
  if (!sec) return '';
  return sec > 3600 ? `${(sec / 3600).toFixed(1)}h` : `${Math.round(sec / 60)}m`;
}

const WORKFLOW_TABS: { key: 'w1' | 'w2' | 'w3' | 'w4' | 'w5'; label: string; hint: string }[] = [
  { key: 'w1', label: 'W1 语料构建', hint: '该项目还没有 W1 运行记录（或 runner 正在初始化）。启动后将自动执行语料库构建的 7 个 Phase。' },
  { key: 'w2', label: 'W2 事实记忆', hint: '该项目还没有 W2 运行记录。W2 消费 W1 下载的 PDF，产出六类对象知识图谱（KG 图谱页展示）。建议先完成 W1。' },
  { key: 'w3', label: 'W3 框架与RQ', hint: '该项目还没有 W3 运行记录。W3 消费 W2 知识图谱，产出 Gap 分析、RQ 体系（Macro/Sub）、证据矩阵与综述大纲（analyze_report/）。建议先完成 W2。' },
  { key: 'w4', label: 'W4 工作记忆', hint: '该项目还没有 W4 运行记录。W4 消费 W3 冻结的证据矩阵，逐 RQ 抽取证据、综合结构化答案并做 claim 四维核查（working_memory/）。建议先完成 W3。' },
  { key: 'w5', label: 'W5 综述写作', hint: '该项目还没有 W5 运行记录。W5 消费 W3 大纲与 W4 工作记忆，确定性装配 LaTeX 综述全文（survey_paper/）。建议先完成 W4。' },
];

export function PipelinePage() {
  const { projectId = '' } = useParams();
  const [workflow, setWorkflow] = useState<'w1' | 'w2' | 'w3' | 'w4' | 'w5'>('w1');
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [notStarted, setNotStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [logPhase, setLogPhase] = useState('ALL');

  useEffect(() => {
    let alive = true;
    const load = () =>
      getPipeline(projectId, workflow)
        .then((r) => alive && (setRun(r), setNotStarted(false)))
        // 真实模式：该工作流尚未启动（无状态文件）——必须清掉上一个工作流的 run 残留，
        // 否则切 tab 后引导卡下面还挂着别的 W 的阶段卡（用户报的"W2 页面显示无关流程"）
        .catch(() => alive && (setRun(null), setNotStarted(true)));
    load();
    // 轮询刷新：运行中页面实时跟进状态；未启动时等 runner 写出首个状态文件
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [projectId, workflow]);

  const [w2Limit, setW2Limit] = useState<'all' | '3000'>('all');
  const [corpusN, setCorpusN] = useState(0);

  useEffect(() => {
    if (!notStarted || workflow !== 'w2') return;
    let alive = true;
    getCorpus(projectId, { page: 1, pageSize: 1 })
      .then((d) => alive && setCorpusN(d.total))
      .catch(() => {});
    return () => { alive = false; };
  }, [notStarted, workflow, projectId]);

  const start = async () => {
    setStarting(true);
    try {
      await startRun(projectId, workflow, workflow === 'w2' && w2Limit === '3000' ? { w2MaxPairs: 3000 } : {});
      setNotStarted(false); // 轮询会在 runner 写出状态文件后自动接管
    } finally {
      setStarting(false);
    }
  };

  const logs = useMemo(
    () => (run ? run.logs.filter((l) => logPhase === 'ALL' || l.phase === logPhase) : []),
    [run, logPhase],
  );

  if (!run && !notStarted) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;
  const tabMeta = WORKFLOW_TABS.find((t) => t.key === workflow)!;
  const elapsed = run?.elapsedSec ?? 0;

  return (
    <div className="space-y-6">
      {/* 工作流切换：W1 语料 / W2 事实记忆 */}
      <div className="flex items-center gap-2" role="tablist" aria-label="工作流">
        {WORKFLOW_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={workflow === t.key}
            onClick={() => setWorkflow(t.key)}
            className={cn(
              'rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors',
              workflow === t.key ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notStarted && (
        <Card className="mx-auto max-w-lg p-8 text-center">
          <div className="text-[15px] font-medium">{tabMeta.key.toUpperCase()} 尚未启动</div>
          <div className="mt-1.5 text-[13px] leading-5 text-t3">{tabMeta.hint}</div>

          {workflow === 'w2' && (
            <div className="mt-5 space-y-2 rounded-lg border border-line/60 bg-page/60 p-4 text-left">
              <div className="text-[12.5px] font-medium">KG 论文对规模</div>
              {([
                ['all', '全量配对（默认）', 'KG 最完整，覆盖全部论文组合'],
                ['3000', '限量 3000 对（提速）', '等不及时的选择——预评分上限 3000 对，KG 覆盖缩小'],
              ] as const).map(([val, label, desc]) => (
                <label key={val} className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="w2limit" checked={w2Limit === val}
                    onChange={() => setW2Limit(val)} className="mt-0.5" />
                  <span>
                    <span className="text-[13px] text-t1">{label}</span>
                    <span className="ml-1.5 text-[11.5px] text-t3">{desc}</span>
                  </span>
                </label>
              ))}
              <div className="rounded bg-warn/15 px-3 py-2 text-[11.5px] leading-5 text-t2">
                {corpusN > 1 && <>当前语料 {corpusN} 篇 → 全量 {Math.round((corpusN * (corpusN - 1)) / 2).toLocaleString()} 对。{''}</>}
                用默认的本地 Qwen 实测约 95 秒/对（全量可能要数天）；在个人中心 W2 卡换成自己的 API 约 1 秒/对（全量数小时、限量 3000 对约 1 小时）。
              </div>
            </div>
          )}

          <Button className="mx-auto mt-4" onClick={start} disabled={starting}>
            <Play size={14} />
            {starting ? '启动中…' : `启动 ${tabMeta.key.toUpperCase()}`}
          </Button>
        </Card>
      )}
      {run && (
        <>
          {/* 规模指标卡 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat icon={FileText} value={String(run.metrics.papers)} label="语料论文" />
            <Stat icon={Network} value={run.metrics.pairs.toLocaleString()} label="论文对（N²）" />
            <Stat icon={Network} value={String(run.metrics.edges)} label="KG 关系边" />
            <Stat icon={Clock} value={`${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`} label="累计耗时" />
          </div>

          {/* 5W 阶段 */}
          <div className="stagger space-y-4">
            {run.workflows.map((w) => (
              <Card key={w.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-[12px] font-semibold">{w.id}</span>
                    <span className="text-[15px] font-medium">{w.name}</span>
                  </div>
                  <Badge variant={w.status === 'done' ? 'ok' : w.status === 'running' ? 'info' : 'neutral'} withDot={w.status === 'running'}>
                    {w.status === 'done' ? '完成' : w.status === 'running' ? '进行中' : '待执行'} · {w.progress}%
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  {w.phases.map((p) => (
                    <PhaseChip key={p.id} phase={p} projectId={projectId} workflow={workflow} />
                  ))}
                </div>
              </Card>
            ))}
          </div>

          {/* W4 Agent 分析报告（HTML 小论文，每 RQ 一份） */}
          {workflow === 'w4' && <W4ReportsSection projectId={projectId} />}

          {/* 日志面板（黑底等宽：黑白账本语言中的"终端"元素） */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
              <span className="text-[13px] font-medium">运行日志</span>
              <div className="flex gap-1">
                {['ALL', ...Array.from(new Set(run.logs.map((l) => l.phase)))].map((ph) => (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => setLogPhase(ph)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[12px] transition-colors',
                      logPhase === ph ? 'bg-ink text-white' : 'text-t2 hover:bg-black/5',
                    )}
                  >
                    {ph}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto bg-ink p-4 font-mono text-[12.5px] leading-5 text-white/80">
              {logs.map((l, i) => (
                <div key={i} className="anim-rise" style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="text-white/40">{l.t}</span>
                  <span className="mx-2 text-white/30">[{l.phase}]</span>
                  {l.line}
                </div>
              ))}
              {logs.length === 0 && <div className="text-white/40">该阶段暂无日志</div>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function W4ReportsSection({ projectId }: { projectId: string }) {
  const [reports, setReports] = useState<W4Report[]>([]);
  const [open, setOpen] = useState<{ title: string; html: string } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    getW4Reports(projectId).then((r) => alive && setReports(r));
    return () => { alive = false; };
  }, [projectId]);

  const view = async (r: W4Report) => {
    setBusy(r.dir);
    try {
      const html = await fetchW4ReportHtml(projectId, r.dir);
      setOpen({ title: `${r.rq_id} · ${r.skill}`, html });
    } finally {
      setBusy('');
    }
  };

  if (!reports.length) return null;
  return (
    <Card className="p-5">
      <div className="flex items-baseline gap-2.5">
        <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">W4-P1</span>
        <h3 className="text-[15px] font-semibold">KG 分析 Agent 报告（每 RQ 一份 HTML 小论文）</h3>
      </div>
      <div className="mt-4 space-y-3">
        {reports.map((r) => (
          <div key={r.dir} className="rounded-card border border-line/60 p-4 transition-shadow hover:shadow-s2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[12px] font-semibold">{r.rq_id}</span>
              <Badge variant="info" className="font-mono text-[11px]">Skill {r.skill}</Badge>
              <span className="text-[12px] text-t3">{r.rounds} 轮工具 · {r.calls} 次调用 · {r.duration}s · {r.model}</span>
              <button
                type="button"
                onClick={() => view(r)}
                disabled={busy === r.dir}
                className="ml-auto rounded bg-ink px-3 py-1 text-[12.5px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {busy === r.dir ? '加载中…' : '查看 HTML 报告'}
              </button>
            </div>
            <div className="mt-2 text-[13.5px] leading-5 text-t1">{r.rq_text}</div>
            {r.skill_reason && (
              <div className="mt-2 rounded-lg bg-page px-3 py-2 text-[12.5px] leading-5 text-t2">
                <span className="font-medium text-t1">为何选 {r.skill}：</span>{r.skill_reason}
              </div>
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 md:p-8" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between rounded-t-xl bg-white px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
            <span className="font-mono text-[13px] font-semibold">{open.title}</span>
            <button type="button" onClick={() => setOpen(null)} className="rounded px-2 py-0.5 text-[13px] text-t2 hover:bg-black/5">关闭 ✕</button>
          </div>
          <iframe
            title={open.title}
            srcDoc={open.html}
            className="min-h-0 w-full flex-1 rounded-b-xl bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  );
}

function PhaseChip({ phase, projectId, workflow, onRetried }: { phase: PhaseState; projectId: string; workflow: string; rerunning?: boolean; onRetried?: () => void }) {
  const st = statusStyle[phase.status] ?? statusStyle.pending;
  const failedLike = phase.status === 'failed' || phase.status === 'checkpoint' || phase.status === 'skipped';
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      const API = import.meta.env.VITE_API_BASE ?? '/api';
      const token = localStorage.getItem('as.token') ?? '';
      await fetch(`${API}/projects/${projectId}/phases/${phase.id}/retry?workflow=${workflow}`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      onRetried?.();
    } finally { setRetrying(false); }
  };
  return (
    <div className={cn(
      'group flex items-center justify-between gap-2 rounded-lg border border-line/60 px-3 py-2 transition-colors',
      phase.status === 'running' && 'border-run/40 bg-info/30',
      failedLike && 'border-warn-fg/30',
    )}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', st.dot)} />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-t1" title={`${phase.id} ${phase.name}`}>{phase.name}</div>
          <div className="text-[11px] text-t3">
            {phase.id} · {st.label}
            {phase.durationSec ? ` · ${fmt(phase.durationSec)}` : ''}
          </div>
        </div>
      </div>
      {phase.progress && (
        <div className="shrink-0 text-right">
          <div className="tabular-nums text-[13px] font-medium text-t1">
            {phase.progress.downloaded + phase.progress.placeholder}/{phase.progress.total}
          </div>
          <div className="text-[10.5px] text-t3">
            {phase.progress.downloaded} 篇 PDF{phase.progress.placeholder ? ` + ${(phase.progress.placeholder)} 占位` : ''}
          </div>
        </div>
      )}
      {failedLike && (
        <Button variant="ghost" size="sm" className="shrink-0 px-2" title="重跑该阶段（从 checkpoint 断点续传）" onClick={() => void retry()} disabled={retrying}>
          <RotateCcw size={13} className={retrying ? 'animate-spin' : ''} />
        </Button>
      )}
    </div>
  );
}
