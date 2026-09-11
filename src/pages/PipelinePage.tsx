import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RotateCcw, FileText, Network, Clock } from 'lucide-react';
import type { PipelineRun, PhaseState } from '@/types/data';
import { getPipeline } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const statusStyle: Record<string, { dot: string; label: string }> = {
  pending: { dot: 'bg-line', label: '待执行' },
  running: { dot: 'bg-run animate-pulse', label: '运行中' },
  done: { dot: 'bg-ok', label: '完成' },
  failed: { dot: 'bg-danger', label: '失败' },
  checkpoint: { dot: 'bg-warn-fg', label: 'checkpoint' },
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

export function PipelinePage() {
  const { projectId = '' } = useParams();
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [logPhase, setLogPhase] = useState('ALL');
  const [reruns, setReruns] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    getPipeline(projectId).then((r) => alive && setRun(r));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const logs = useMemo(
    () => (run ? run.logs.filter((l) => logPhase === 'ALL' || l.phase === logPhase) : []),
    [run, logPhase],
  );

  if (!run) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;

  const elapsed = reruns['W3-P2'] ? run.elapsedSec + 300 : run.elapsedSec;

  return (
    <div className="space-y-6">
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
                <PhaseChip key={p.id} phase={p} rerunning={reruns[p.id]} onRerun={() => setReruns((s) => ({ ...s, [p.id]: true }))} />
              ))}
            </div>
          </Card>
        ))}
      </div>

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
    </div>
  );
}

function PhaseChip({ phase, rerunning, onRerun }: { phase: PhaseState; rerunning?: boolean; onRerun: () => void }) {
  const st = statusStyle[phase.status];
  const failedLike = phase.status === 'failed' || phase.status === 'checkpoint';
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
      {failedLike && (
        <Button variant="ghost" size="sm" className="shrink-0 px-2" title="从 checkpoint 重跑" onClick={onRerun}>
          <RotateCcw size={13} className={rerunning ? 'animate-spin' : ''} />
        </Button>
      )}
    </div>
  );
}
