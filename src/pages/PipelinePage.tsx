import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Play, RotateCcw, FileText, Network, Clock , Pause } from 'lucide-react';
import type { PipelineRun, PhaseState } from '@/types/data';
import { getPipeline, startRun, rerunWorkflow, getBuildConfig, updateBuildConfig, getW4Reports, fetchW4ReportHtml, getCorpus, USE_MOCK, type W4Report } from '@/services/api';
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

  const [alerts, setAlerts] = useState<{ kind: 'fail' | 'warn'; text: string }[]>([]);
  const prevStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const load = () =>
      getPipeline(projectId, workflow)
        .then((r) => {
          if (!alive) return;
          setRun(r); setNotStarted(false);
          // 失败主动提醒：轮询发现阶段从非失败 → 失败（页面开着就能看到，无需盯着）
          const wf = r.workflows.find((w) => w.id === workflow.toUpperCase());
          if (wf) {
            const cur: Record<string, string> = {};
            for (const ph of wf.phases) {
              cur[ph.id] = ph.status;
              const prev = prevStatusRef.current[ph.id];
              if (ph.status === 'failed' && prev && prev !== 'failed' && prev !== 'pending') {
                const errLine = (ph as unknown as { error?: string }).error ? `：${(ph as unknown as { error: string }).error.slice(0, 80)}` : '';
                setAlerts((a) => [...a.filter((x) => !x.text.startsWith(ph.id)), {
                  kind: 'fail', text: `${ph.id} 失败${errLine}——请查看该阶段卡与日志`,
                }]);
                if ('Notification' in window && Notification.permission === 'granted') {
                  try { new Notification('AutoSurvey', { body: `${ph.id} 失败，请回平台查看` }); } catch { /* 忽略 */ }
                }
              }
              prevStatusRef.current[ph.id] = ph.status;
            }
          }
        })
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
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={cn('flex items-center justify-between rounded-lg border px-4 py-2.5 text-[13px]',
              a.kind === 'fail' ? 'border-warn-fg/40 bg-warn-fg/10 text-warn-fg' : 'border-amber-300 bg-amber-50 text-amber-800')}>
              <span>{a.kind === 'fail' ? '⚠ ' : 'ℹ '}{a.text}</span>
              <button type="button" onClick={() => setAlerts((arr) => arr.filter((_, j) => j !== i))}
                className="shrink-0 text-[11px] underline opacity-70 hover:opacity-100">关闭</button>
            </div>
          ))}
        </div>
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
                  <div className="flex items-center gap-2.5">
                    {wfKeyOf(w.id) === 'w1'
                      ? <W1RebuildButton projectId={projectId} running={w.status === 'running'} />
                      : ['w3', 'w4', 'w5'].includes(wfKeyOf(w.id))
                        ? <RerunButton projectId={projectId} wfKey={wfKeyOf(w.id)} running={w.status === 'running'} />
                        : null}
                    <Badge variant={w.status === 'done' ? 'ok' : w.status === 'running' ? 'info' : 'neutral'} withDot={w.status === 'running'}>
                      {w.status === 'done' ? '完成' : w.status === 'running' ? '进行中' : '待执行'} · {w.progress}%
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  {w.phases.map((p) => (
                    <PhaseChip key={p.id} phase={p} projectId={projectId} workflow={workflow}
                      onRetried={() => {
                        if (workflow === 'w2') {
                          setAlerts((a) => [...a.filter((x) => x.kind !== 'warn'), {
                            kind: 'warn', text: 'W2 已重跑——W3/W4/W5 基于 W2 产物，W2 完成后需要重跑 W3/W4/W5',
                          }]);
                        }
                        // 触发一次立即刷新
                        getPipeline(projectId, workflow).then((r) => setRun(r)).catch(() => {});
                      }} />
                  ))}
                </div>
              </Card>
            ))}
          </div>

          {/* W4 Agent 分析报告（HTML 小论文，每 RQ 一份） */}
          {workflow === 'w4' && <W4ReportsSection projectId={projectId} />}

          {/* W2 补充构建：手动上传新论文后提示增量提取 */}
          {!USE_MOCK && workflow === 'w2' && run && <W2SupplementCard projectId={projectId} w2Failed={run.workflows.find((w) => w.id === 'W2')?.status === 'failed'} />}

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

const wfKeyOf = (id: string) => id.toLowerCase();

// W1 修改配置重建：打开编辑弹窗（用户裁决：W1 重跑 = 改配置从头构建，
// 会作废 W2-W5 产物，需重新运行下游——弹窗内明确警示）
function W1RebuildButton({ projectId, running }: { projectId: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  if (running) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="修改主题/关键词/年份等构建配置，从头重建语料库（W2-W5 产物将作废）"
        className="rounded border border-line px-2.5 py-1 text-[12px] font-medium text-t3 transition-colors hover:border-ink hover:text-ink"
      >
        修改配置重建
      </button>
      {open && <BuildConfigModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function BuildConfigModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [cfg, setCfg] = useState<{
    title?: string; description?: string; kws?: string; y0?: string; y1?: string; cap?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    getBuildConfig(projectId)
      .then((c) => {
        if (!alive) return;
        const yr = c.year_range ?? [];
        setCfg({
          title: c.title ?? c.topic ?? '',
          description: c.description ?? '',
          kws: (c.search_keywords ?? []).join('\n'),
          y0: String(yr[0] ?? ''), y1: String(yr[1] ?? ''),
          cap: String(c.corpus_cap ?? 500),
        });
      })
      .catch(() => alive && setErr('读取配置失败'));
    return () => { alive = false; };
  }, [projectId]);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  const save = async () => {
    setBusy(true);
    try {
      await updateBuildConfig(projectId, {
        title: cfg?.title?.trim() || undefined,
        topic: cfg?.title?.trim() || undefined,
        description: cfg?.description?.trim() || '',
        search_keywords: (cfg?.kws ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
        year_range: [cfg?.y0 || '2020', cfg?.y1 || String(new Date().getFullYear())],
        corpus_cap: Number(cfg?.cap) > 0 ? Number(cfg?.cap) : undefined,
      });
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[16px] font-semibold">修改构建配置</div>
        <div className="mt-1 text-[12.5px] text-t3">调整后 W1 将按新配置从头检索构建。</div>
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] leading-5 text-danger">
          ⚠ 重建会作废下游产物：W2 知识图谱、W3 大纲与证据矩阵、W4/W5 报告都需要重新运行（旧产物已自动归档，不会丢失）。
        </div>
        {!cfg ? (
          <div className="py-8 text-center text-[13px] text-t3">{err || '加载中…'}</div>
        ) : (
          <div className="mt-4 space-y-3.5">
            <label className="block">
              <span className="text-[12.5px] font-medium text-t2">综述主题</span>
              <input className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-ink"
                value={cfg.title ?? ''} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[12.5px] font-medium text-t2">补充说明（可选）</span>
              <textarea rows={2} className="mt-1 w-full resize-none rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-ink"
                value={cfg.description ?? ''} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[12.5px] font-medium text-t2">检索关键词（每行一个）</span>
              <textarea rows={4} className="mt-1 w-full resize-none rounded-lg border border-line px-3 py-2 font-mono text-[12.5px] outline-none focus:border-ink"
                value={cfg.kws ?? ''} onChange={(e) => setCfg({ ...cfg, kws: e.target.value })}
                placeholder={'例如：\nCRISPR delivery\noff-target effects\nimmunogenicity'} />
            </label>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-[12.5px] font-medium text-t2">年份范围</span>
                <div className="mt-1 flex items-center gap-2">
                  <input className="w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-ink" placeholder="2020"
                    value={cfg.y0 ?? ''} onChange={(e) => setCfg({ ...cfg, y0: e.target.value })} />
                  <span className="text-t3">—</span>
                  <input className="w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-ink" placeholder="2026"
                    value={cfg.y1 ?? ''} onChange={(e) => setCfg({ ...cfg, y1: e.target.value })} />
                </div>
              </label>
              <label className="w-32">
                <span className="text-[12.5px] font-medium text-t2">语料上限</span>
                <input type="number" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-ink"
                  value={cfg.cap ?? ''} onChange={(e) => setCfg({ ...cfg, cap: e.target.value })} />
              </label>
            </div>
          </div>
        )}
        {err && cfg && <div className="mt-2 text-[12px] text-danger">{err}</div>}
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-[13px] text-t2 hover:border-ink">取消</button>
          <button type="button" disabled={busy || !cfg}
            onClick={() => (confirming ? save() : setConfirming(true))}
            className={cn('rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50',
              confirming ? 'bg-danger' : 'bg-ink')}>
            {busy ? '重建中…' : confirming ? '再点一次确认重建（下游作废）' : '保存并重建 W1'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 整工作流重跑（两段式确认防误触）：第一次点击进入确认态并 5s 超时回退，
// 再点执行。增量语义——已下载 PDF / 已提取论文由各阶段内部 checkpoint 自动跳过
function RerunButton({ projectId, wfKey, running }: { projectId: string; wfKey: string; running: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 8000);
    return () => clearTimeout(t);
  }, [confirming]);
  if (USE_MOCK) return null; // 公开快照只读
  if (running) return null; // 运行中不提供重跑（先暂停）
  const go = async (force = false) => {
    setBusy(true);
    try {
      await rerunWorkflow(projectId, wfKey, force);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '重跑失败');
      setBusy(false);
      setConfirming(false);
      setTimeout(() => setErr(''), 4000);
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => (confirming ? go() : setConfirming(true))}
        title="重跑整个工作流（增量：已有产物自动跳过，只补缺失/失败部分）"
        className={cn(
          'rounded border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50',
          confirming
            ? 'border-danger/60 bg-danger/5 text-danger'
            : 'border-line text-t3 hover:border-ink hover:text-ink',
        )}
      >
        {busy ? '重启中…' : confirming
          ? wfKey === 'w1' ? '确认重跑？（将重新检索）' : '确认重跑？（增量·已有产物跳过）'
          : '重跑'}
      </button>
      {confirming && (
        <button
          type="button"
          disabled={busy}
          onClick={() => go(true)}
          title="完全重跑：清除断点与缓存产物后全部重做（换模型/改配置后想要全新结果时用；已下载 PDF 不会重复下载）"
          className="rounded border border-danger/60 bg-danger/5 px-2.5 py-1 text-[12px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {busy ? '重启中…' : '完全重跑'}
        </button>
      )}
      {err && <div className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-danger px-2 py-1 text-[11px] text-white">{err}</div>}
    </div>
  );
}

type W2FailReason = { kind: 'unreachable' | 'auth' | 'risk_filter' | 'other' | 'unknown'; message: string };

function W2SupplementCard({ projectId, w2Failed }: { projectId: string; w2Failed: boolean }) {
  const [info, setInfo] = useState<{ pending: number; duplicates?: number; total_cards: number; extracted: number; fail_reason?: W2FailReason | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const API = import.meta.env.VITE_API_BASE ?? '/api';
    const tk = localStorage.getItem('as.token') ?? '';
    fetch(`${API}/projects/${projectId}/w2-pending`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setInfo(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  if (!info || info.pending === 0) return null;
  const isFailed = w2Failed;
  const supplement = async () => {
    setBusy(true);
    try {
      const API = import.meta.env.VITE_API_BASE ?? '/api';
      const tk = localStorage.getItem('as.token') ?? '';
      // 新论文必须重跑 P0→P3：P0 解析新 PDF，P1 增量提取，P2/P3 重建候选与 KG。
      // 只 reset P0/P1 会让 P2/P3 保持 done，新论文不会进入知识图谱。
      await fetch(`${API}/projects/${projectId}/workflows/w2/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({ force: false }),
      });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className={cn('p-5', isFailed && 'border-danger/40')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {isFailed ? (
            <div className="text-[14px] font-medium text-danger">
              {info.fail_reason?.kind === 'auth' ? (
                <>W2 提取失败——模型服务鉴权失败（API Key 无效），{info.pending} 篇论文等待提取</>
              ) : info.fail_reason?.kind === 'unreachable' ? (
                <>W2 提取失败——你配置的模型服务器连不上，{info.pending} 篇论文等待提取</>
              ) : info.fail_reason?.kind === 'risk_filter' ? (
                <>W2 提取失败——部分论文被大模型服务商内容风控拦截（已自动跳过），{info.pending} 篇论文等待提取</>
              ) : info.fail_reason?.message ? (
                <>W2 提取失败——{info.fail_reason.message.slice(0, 80)}</>
              ) : (
                <>W2 提取失败——上次因大模型不可用而中断，{info.pending} 篇论文等待提取</>
              )}
            </div>
          ) : (
            <div className="text-[14px] font-medium">
              检测到 {info.pending} 篇论文卡尚未完成提取
            </div>
          )}
          {isFailed && (
            <div className="mt-1.5 text-[12.5px] text-t3">
              {info.fail_reason?.kind === 'auth' ? (
                <>排查：你配置的模型服务要求鉴权但 Key 无效（401 Invalid API Key）。到个人中心 W2 配置核对该服务要求的 API Key；若是自建网关还需确认模型名映射正确。修复后点击右侧按钮重跑。</>
              ) : info.fail_reason?.kind === 'unreachable' ? (
                <>排查：自建 Ollama 需机器在线并设置 OLLAMA_HOST=0.0.0.0（默认只允许本机访问）、防火墙放行 11434；配的 API 则检查地址/密钥是否有效。验证：在能联网的机器执行 curl &lt;你的模型地址&gt;/api/tags 能返回结果即通。修复后点击右侧按钮重跑。</>
              ) : info.fail_reason?.kind === 'risk_filter' ? (
                <>说明：个别论文正文触发了服务商内容审核（如含安全攻击样本的论文），系统会跳过这些篇并继续提取其余论文。点击右侧按钮重跑即可，多次被拦的少数论文不影响整体知识图谱。</>
              ) : (
                <>点击下方按钮重新执行提取。</>
              )}
            </div>
          )}
          <div className="mt-1 text-[12.5px] text-t3">
            共 {info.total_cards} 篇论文卡，已提取 {info.extracted} 篇{info.duplicates ? `，${info.duplicates} 篇重复卡已自动合并` : ''}。点击下方按钮重新执行提取。
          </div>
        </div>
        <button
          type="button"
          onClick={supplement}
          disabled={busy}
          className={cn(
            'shrink-0 rounded px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50',
            isFailed ? 'bg-danger' : 'bg-ink',
          )}
        >
          {busy ? '执行中…' : isFailed ? '重跑提取' : '补充构建 KG'}
        </button>
      </div>
    </Card>
  );
}

function W4ReportsSection({ projectId }: { projectId: string }) {
  const [reports, setReports] = useState<W4Report[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [htmlCache, setHtmlCache] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    getW4Reports(projectId).then((r) => alive && setReports(r));
    return () => { alive = false; };
  }, [projectId]);

  const toggle = async (r: W4Report) => {
    if (expanded === r.dir) { setExpanded(null); return; }
    setBusy(r.dir);
    try {
      const html = htmlCache[r.dir] ?? (await fetchW4ReportHtml(projectId, r.dir));
      setHtmlCache((c) => ({ ...c, [r.dir]: html }));
      setExpanded(r.dir);
    } finally { setBusy(''); }
  };

  if (!reports.length) return null;
  return (
    <Card className="p-5">
      <div className="flex items-baseline gap-2.5">
        <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">W4-P1</span>
        <h3 className="text-[15px] font-semibold">KG 分析 Agent 报告（每 RQ 一份 HTML 小论文，点击展开）</h3>
      </div>
      <div className="mt-4 space-y-3">
        {reports.map((r) => (
          <div key={r.dir} className="rounded-card border border-line/60 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(r)}
              disabled={busy === r.dir}
              className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-page"
            >
              <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 font-mono text-[12px] font-semibold">{r.rq_id}</span>
              <Badge variant="info" className="shrink-0 font-mono text-[11px]">{r.skill}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] text-t1">{r.rq_text}</span>
              <span className="shrink-0 text-[11px] text-t3">{r.rounds}轮 · {r.duration}s</span>
              <span className={cn('shrink-0 text-t3 transition-transform', expanded === r.dir && 'rotate-90')}>›</span>
            </button>
            {expanded === r.dir && (
              <div className="border-t border-line/40 bg-white">
                <div className="px-4 py-2 text-[11.5px] leading-4 text-t2">
                  {r.skill_reason && <span>选型依据：{r.skill_reason}</span>}
                </div>
                <iframe
                  title={r.rq_id}
                  srcDoc={htmlCache[r.dir] ?? ''}
                  className="w-full border-0"
                  style={{ height: '70vh' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PhaseChip({ phase, projectId, workflow, onRetried }: { phase: PhaseState; projectId: string; workflow: string; rerunning?: boolean; onRetried?: () => void }) {
  const st = statusStyle[phase.status] ?? statusStyle.pending;
  const failedLike = phase.status === 'failed' || phase.status === 'checkpoint' || phase.status === 'skipped';
  const [retrying, setRetrying] = useState(false);
  const [pausing, setPausing] = useState(false);
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
      {phase.status === 'running' && (
        <Button variant="ghost" size="sm" className="shrink-0 px-2"
          title="暂停该阶段（终止进程，已提取产物保留在磁盘，恢复时从断点续传）"
          onClick={async () => {
            setPausing(true);
            try {
              const API = import.meta.env.VITE_API_BASE ?? '/api';
              const tk = localStorage.getItem('as.token') ?? '';
              await fetch(`${API}/projects/${projectId}/phases/${phase.id}/pause?workflow=${workflow}`, {
                method: 'POST', headers: tk ? { Authorization: `Bearer ${tk}` } : {},
              });
              onRetried?.();
            } finally { setPausing(false); }
          }}
          disabled={pausing}
        >
          <Pause size={13} className={pausing ? 'animate-spin' : ''} />
        </Button>
      )}
    </div>
  );
}
