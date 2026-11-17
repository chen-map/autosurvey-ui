import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Lock, Pencil, Plus, Trash2, BookOpen, RefreshCw } from 'lucide-react';
import type { AnswerabilityLevel, RQBundle } from '@/types/data';
import { getRQBundle, USE_MOCK, mutateRq, rescoreRq, listKgPapers, editRqEvidence, rematchRqEvidence, addRqPaper, suggestRqText, rematchBatch, type RematchCandidate } from '@/services/api';
import { RqEditDialog } from '@/components/RqEditDialog';
import { HumanLoopSidebar } from '@/components/HumanLoopSidebar';
import { Card } from '@/components/ui/Card';
import { confirmDialog, promptDialog, toast } from '@/components/ui/feedback';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

export type { AnswerabilityLevel };

export const levelVariant: Record<AnswerabilityLevel, 'ok' | 'warn' | 'danger'> = {
  strong: 'ok',
  weak: 'warn',
  blocked: 'danger',
};
export const levelLabel: Record<AnswerabilityLevel, string> = {
  strong: 'strong',
  weak: 'weak',
  blocked: 'blocked',
};

// Answerability 大分卡（SVG 圆环，挂载时 250ms 填充动画）
export function Gauge({ score, level, size = 72 }: { score: number; level: AnswerabilityLevel; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = level === 'strong' ? 'var(--ok)' : level === 'weak' ? 'var(--warn-fg)' : 'var(--danger)';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-light)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - score)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="[animation:gauge_250ms_ease-out]"
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-t1 text-[16px] font-semibold">
        {score.toFixed(2)}
      </text>
    </svg>
  );
}

export function RqPage() {
  const { projectId = '' } = useParams();
  const [bundle, setBundle] = useState<RQBundle | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getRQBundle(projectId)
      .then((b) => {
        if (!alive) return;
        setBundle(b);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Human Loop 应用修改后即时刷新（RQ 文本真正落盘 → 界面所见即所得）
  useEffect(() => {
    const h = () => getRQBundle(projectId).then((b) => setBundle(b)).catch(() => {});
    window.addEventListener('as:rq-updated', h);
    return () => window.removeEventListener('as:rq-updated', h);
  }, [projectId]);

  // ── RQ 结构编辑（用户大修：增删改排序 / 重评分 / 证据增删）──────────
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    getRQBundle(projectId).then((b) => setBundle(b)).catch(() => {});
  }, [projectId]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      reload();
      return r as { hint?: string } | undefined;
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作失败');
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const addMacro = async () => {
    const text = await promptDialog({ title: '新增宏观研究问题（RQ）', label: 'RQ 文本', value: '' });
    if (!text || !text.trim()) return;
    void run(() => mutateRq(projectId, { op: 'add_macro', rq_text: text.trim() }));
  };
  const addSub = (rqId: string) => {
    const macro = bundle?.macros.find((m) => m.id === rqId);
    setDlg({
      mode: 'expand_sub', rqId, subId: '', title: `为 ${rqId} 新增子问题`,
      hint: '写出子问题，或让 AI 基于该宏观问题生成候选',
      initial: '', macroText: macro?.text || '',
    });
  };
  const delMacro = async (rqId: string) => {
    setBusy(true);
    try {
      const d = await mutateRq(projectId, { op: 'delete', rq_id: rqId, dry_run: true });
      const im = d.impact || { papers: 0, blocks: 0 };
      if (!(await confirmDialog({ title: `删除 ${rqId} 及其全部子问题？`, body: `影响：${im.papers} 篇证据论文、${im.blocks} 个论文编排块（编排里的块需手动移除）。
此操作有备份，可恢复。`, danger: true }))) return;
      const r = await mutateRq(projectId, { op: 'delete', rq_id: rqId });
      reload();
      if (r.hint) toast(r.hint);
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };
  const delSub = async (rqId: string, subId: string) => {
    setBusy(true);
    try {
      const d = await mutateRq(projectId, { op: 'delete', rq_id: rqId, sub_rq_id: subId, dry_run: true });
      const im = d.impact || { papers: 0, blocks: 0 };
      if (!(await confirmDialog({ title: `删除子问题 ${subId}？`, body: `影响：${im.papers} 篇证据论文、${im.blocks} 个编排块。`, danger: true }))) return;
      const r = await mutateRq(projectId, { op: 'delete', rq_id: rqId, sub_rq_id: subId });
      reload();
      if (r.hint) toast(r.hint);
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };
  const moveMacro = (idx: number, dir: -1 | 1) => {
    if (!bundle) return;
    const ids = bundle.macros.map((m) => m.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void run(() => mutateRq(projectId, { op: 'reorder', rq_ids: ids }));
  };
  const doRescore = async () => {
    setRescoring({
      title: '正在重新评分…',
      detail: '按每个子问题当前的证据量重算 Answerability（≥8 篇 strong · 4-7 篇 weak · <4 篇 blocked）',
    });
    setBusy(true);
    try {
      const r = await rescoreRq(projectId);
      reload();
      toast(`已重新评分 ${r.rescored} 个子问题（≥8 篇 strong、4-7 weak、<4 blocked）`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '评分失败');
    } finally {
      setBusy(false);
      setRescoring(null);
    }
  };
  // 支撑论文挑选弹窗
  const [evOpen, setEvOpen] = useState<{ rqId: string; subId: string; text: string; current: string[] } | null>(null);
  const [evList, setEvList] = useState<{ paper_id: string; title: string; year: number | null; relevance?: number; reason?: string }[]>([]);
  const [evSel, setEvSel] = useState<string[]>([]);
  const [evQ, setEvQ] = useState('');
  const openEvidence = async (rqId: string, subId: string, text: string, current: string[]) => {
    setEvOpen({ rqId, subId, text, current });
    setEvSel(current);
    setEvQ('');
    try {
      const d = await listKgPapers(projectId, '');
      setEvList(d.items);
    } catch {
      setEvList([]);
    }
  };
  const filterEvList = async (q: string) => {
    setEvQ(q);
    try {
      const d = await listKgPapers(projectId, q);
      setEvList(d.items);
    } catch {
      setEvList([]);
    }
  };
  // 智能匹配（按 RQ 文本在 KG 检索命题/论文）
  const [rmBusy, setRmBusy] = useState(false);
  const [rmTerms, setRmTerms] = useState<string[]>([]);
  const [rmSuggest, setRmSuggest] = useState<{ score: number; level: string; papers: number; candidates?: number } | null>(null);
  const runRematch = async () => {
    if (!evOpen) return;
    setRmBusy(true);
    try {
      const d = await rematchRqEvidence(projectId, evOpen.rqId, evOpen.subId);
      setRmTerms(d.terms);
      setRmSuggest(d.suggest);
      // 只预选 LLM 判定为强相关（2/3）的候选；背景相关（1）留给用户自己勾
      const cand: { paper_id: string; title: string; year: number | null; relevance?: number; reason?: string }[] = d.candidates.map((c: RematchCandidate) => ({
        paper_id: c.paper_id, title: c.title, year: c.year, relevance: c.relevance, reason: c.reason,
      }));
      setEvList(cand);
      const strong = d.candidates.filter((c) => (c.relevance ?? 2) >= 2).slice(0, 8).map((c) => c.paper_id);
      setEvSel((v) => Array.from(new Set([...v, ...strong])));
    } catch (e) {
      toast(e instanceof Error ? e.message : '匹配失败');
    } finally {
      setRmBusy(false);
    }
  };
  // 加新论文（暗中入库 + 建关联边）
  const addNewPaper = async () => {
    if (!evOpen) return;
    const title = await promptDialog({ title: '添加新论文', label: '论文标题', value: '' });
    if (!title || !title.trim()) return;
    const abstract = await promptDialog({ title: '粘贴摘要', label: '≥60 字，KG 需要摘要才能提取节点建立关联', value: '' });
    if (!abstract || abstract.trim().length < 60) { toast('摘要太短，至少 60 字'); return; }
    setRmBusy(true);
    try {
      const r = await addRqPaper(projectId, { title: title.trim(), abstract: abstract.trim(), rq_id: evOpen.rqId, sub_rq_id: evOpen.subId });
      toast(r.hint || '已入库');
      setEvSel((v) => [...v, r.paper_id]);
      const d = await listKgPapers(projectId, '');
      setEvList(d.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : '入库失败');
    } finally {
      setRmBusy(false);
    }
  };

  const saveEvidence = async () => {
    if (!evOpen) return;
    const add = evSel.filter((x) => !evOpen.current.includes(x));
    const remove = evOpen.current.filter((x) => !evSel.includes(x));
    if (!add.length && !remove.length) { setEvOpen(null); return; }
    await run(async () => {
      const r = await editRqEvidence(projectId, evOpen.rqId, evOpen.subId, add, remove);
      if (r?.hint) toast(r.hint);
      return r;
    });
    setEvOpen(null);
  };

  // ── 大厂风 UI 状态：行内编辑 + Toast（全局反馈系统） ──────────
  const showToast = useCallback((msg: string) => toast(msg), []);
  const [cascade, setCascade] = useState<{ rqId: string; subId: string; isMacro: boolean; subCount: number } | null>(null);
  const [dlg, setDlg] = useState<{ mode: 'rewrite' | 'expand_sub'; rqId: string; subId: string; title: string; hint?: string; initial: string; macroText?: string } | null>(null);
  // 重匹配/重评分期间的阻塞式进度遮罩：不允许关闭/刷新/跳走
  const [rescoring, setRescoring] = useState<{ title: string; detail: string } | null>(null);
  useEffect(() => {
    if (!rescoring) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [rescoring]);
  if (!loaded) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;
  if (failed)
    return (
      <div className="mx-auto max-w-lg px-8 py-20 text-center">
        <Card className="p-8">
          <p className="text-[15px] font-medium">RQ 体系尚未生成</p>
          <p className="mt-2 text-[13px] leading-5 text-t3">
            该项目还没有可用的证据矩阵——请先完成 W3（综述框架与研究问题设计），再回到本页。
          </p>
        </Card>
      </div>
    );
  if (!bundle || bundle.macros.length === 0)
    return (
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 px-8 py-16 text-center">
        <Badge variant="info" withDot>W3 进行中</Badge>
        <p className="text-[14px] text-t2">RQ 体系设计与证据矩阵冻结尚未完成</p>
        <p className="max-w-md text-[13px] leading-5 text-t3">
          流水线 W3-P2「RQ 设计」完成后，此处将展示 Macro/Sub 研究问题树、Answerability 评分与已冻结的证据矩阵。
        </p>
      </Card>
    );

  const allSubs = bundle.macros.flatMap((m) => m.subs);
  const totalPapers = new Set(allSubs.flatMap((s) => s.paperIds)).size;
  const avgScore = allSubs.length ? allSubs.reduce((n, s) => n + s.score, 0) / allSubs.length : 0;
  const strongN = allSubs.filter((s) => s.level === 'strong').length;
  const blockedN = allSubs.filter((s) => s.level === 'blocked').length;
  const coverPct = allSubs.length ? Math.round((strongN / allSubs.length) * 100) : 0;

  return (
    <div className="flex items-stretch gap-5">
      <div className="min-w-0 flex-1 space-y-5">
        {/* 页头：标题 + 全局动作 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-t1">研究问题体系</h1>
            <p className="mt-0.5 text-[12.5px] text-t3">
              研究问题与证据的单一事实源 · 下游 W4/W5 从此处读取
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {bundle.matrix && (
              <span className="flex items-center gap-1 rounded-full bg-[#eef7f0] px-2.5 py-1 text-[11px] font-medium text-[#0a5a2d]">
                <Lock size={11} /> 已冻结 {bundle.matrix.frozenAt?.slice(0, 10)}
              </span>
            )}
            <button type="button" disabled={busy} onClick={() => void doRescore()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-t2 transition-colors hover:border-ink/30 hover:text-t1"
              title="按当前证据量重新计算每个子问题的可信度">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> 重新评分
            </button>
            <button type="button" disabled={busy} onClick={() => addMacro()}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm transition-colors hover:bg-brand-strong">
              <Plus size={13} /> 新增观察方向
            </button>
          </div>
        </div>

        {/* 统计条（4 卡）：一眼看到体系健康度 */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '宏观 RQ', value: String(bundle.macros.length), sub: `${allSubs.length} 个子问题` },
            { label: '证据论文', value: String(totalPapers), sub: '去重后论文集合' },
            { label: '平均可答性', value: avgScore.toFixed(2), sub: `strong ${strongN} · blocked ${blockedN}` },
            { label: '证据覆盖', value: `${coverPct}%`, sub: 'strong 子问题占比' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-line/60 bg-card px-4 py-3 shadow-s1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-t3">{c.label}</div>
              <div className="mt-1 text-[24px] font-semibold leading-7 tabular-nums text-t1">{c.value}</div>
              <div className="mt-0.5 text-[11px] text-t3">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* 覆盖率进度条 */}
        <div className="rounded-xl border border-line/60 bg-card px-4 py-3 shadow-s1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-medium text-t2">证据体系健康度</span>
            <span className="text-t3">
              strong {strongN} · weak {allSubs.length - strongN - blockedN} · blocked {blockedN}
            </span>
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="bg-[#16a34a]" style={{ width: `${allSubs.length ? (strongN / allSubs.length) * 100 : 0}%` }} />
            <div className="bg-[#d9a92f]" style={{ width: `${allSubs.length ? ((allSubs.length - strongN - blockedN) / allSubs.length) * 100 : 0}%` }} />
            <div className="bg-[#e53935]" style={{ width: `${allSubs.length ? (blockedN / allSubs.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* RQ 树：Linear 式行——状态点 + 文本 + 指标 + hover 操作 */}
        <div className="overflow-hidden rounded-xl border border-line/60 bg-card shadow-s1">
          <div className="flex items-center justify-between border-b border-line/50 px-4 py-2.5">
            <span className="text-[12.5px] font-medium text-t2">研究问题树</span>
            <span className="text-[11px] text-t3">点击行进入详情 · hover 显示操作</span>
          </div>
          {bundle.macros.map((m, idxM) => (
            <div key={m.id} className="group border-b border-line/40 last:border-0">
              {/* Macro 行 */}
              <div className="flex items-center gap-2.5 px-4 py-3 transition-colors hover:bg-black/[0.025]">
                <span className={cn('h-2 w-2 shrink-0 rounded-full',
                  m.subs.length && m.subs.every((s) => s.level === 'strong') ? 'bg-[#16a34a]'
                    : m.subs.some((s) => s.level === 'blocked') ? 'bg-[#e53935]' : 'bg-[#d9a92f]')} />
                <span className="shrink-0 rounded bg-ink px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-white">{m.id}</span>
                <Link to={m.id} className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-t1 hover:underline" title={m.text}>
                  {m.text}
                </Link>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-t3">
                  <span className="tabular-nums">{m.subs.length} 子问题</span>
                  <span className="tabular-nums">{new Set(m.subs.flatMap((x) => x.paperIds)).size} 篇</span>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" disabled={busy} title="上移" onClick={() => moveMacro(idxM, -1)}
                      className="rounded p-1 hover:bg-black/10 hover:text-t1">↑</button>
                    <button type="button" disabled={busy} title="下移" onClick={() => moveMacro(idxM, 1)}
                      className="rounded p-1 hover:bg-black/10 hover:text-t1">↓</button>
                    <button type="button" disabled={busy} title="改文本" onClick={() => setDlg({ mode: 'rewrite', rqId: m.id, subId: '', title: '修改宏观研究问题', initial: m.text, hint: '直接在框里改，或在下方写修改意见让 AI 改——确认保存后可级联重匹配子问题证据' })}
                      className="rounded p-1 hover:bg-black/10 hover:text-t1"><Pencil size={12} /></button>
                    <button type="button" disabled={busy} title="新增子问题" onClick={() => addSub(m.id)}
                      className="rounded p-1 hover:bg-black/10 hover:text-brand"><Plus size={12} /></button>
                    <button type="button" disabled={busy} title="删除" onClick={() => void delMacro(m.id)}
                      className="rounded p-1 hover:bg-danger/10 hover:text-danger"><Trash2 size={12} /></button>
                  </div>
                  <Link to={m.id} className="text-t3 hover:text-t1"><ChevronRight size={14} /></Link>
                </div>
              </div>
              {/* Sub 行 */}
              {m.subs.map((s) => (
                <div key={s.id} className="group/sub flex items-center gap-2.5 border-t border-line/30 bg-[#fcfcfb] py-2 pl-11 pr-4 transition-colors hover:bg-black/[0.02]">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                    s.level === 'strong' ? 'bg-[#16a34a]' : s.level === 'weak' ? 'bg-[#d9a92f]' : 'bg-[#e53935]')} />
                  <span className="w-[52px] shrink-0 font-mono text-[11px] text-t3">{s.id}</span>
                  <Link to={s.id} className="min-w-0 flex-1 truncate text-[12.5px] text-t2 hover:text-t1 hover:underline" title={s.text}>
                    {s.text}
                  </Link>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
                    s.level === 'strong' ? 'bg-[#eef7f0] text-[#0a5a2d]'
                      : s.level === 'weak' ? 'bg-[#fdf6e3] text-[#8a6a1f]' : 'bg-[#fdecea] text-[#b3261e]')}>
                    {s.score.toFixed(2)}
                  </span>
                  <span className="w-[86px] shrink-0 text-right text-[11px] tabular-nums text-t3">{s.paperIds.length} 篇 · §{s.section}</span>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/sub:opacity-100">
                    <button type="button" disabled={busy} title="改文本" onClick={() => setDlg({ mode: 'rewrite', rqId: m.id, subId: s.id, title: '修改子问题', macroText: m.text, initial: s.text, hint: '直接在框里改，或在下方写修改意见让 AI 改——确认保存后自动重匹配证据并重算评分' })}
                      className="rounded p-1 hover:bg-black/10 hover:text-t1"><Pencil size={11} /></button>
                    <button type="button" disabled={busy} title="增删支撑论文（智能匹配）"
                      onClick={() => void openEvidence(m.id, s.id, s.text, s.paperIds)}
                      className="rounded p-1 hover:bg-black/10 hover:text-brand"><BookOpen size={11} /></button>
                    <button type="button" disabled={busy} title="删除子问题" onClick={() => void delSub(m.id, s.id)}
                      className="rounded p-1 hover:bg-danger/10 hover:text-danger"><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
              {/* 行内新增子问题 */}
              <div className="border-t border-line/30 bg-[#fcfcfb] py-1.5 pl-11 pr-4">
                <button type="button" disabled={busy} onClick={() => addSub(m.id)}
                  className="flex items-center gap-1 text-[11.5px] text-t3 transition-colors hover:text-brand">
                  <Plus size={11} /> 添加子问题
                </button>
              </div>
            </div>
          ))}
          {/* 空状态 */}
          {bundle.macros.length === 0 && (
            <div className="px-4 py-10 text-center text-[12.5px] text-t3">
              还没有研究问题——点右上「新增观察方向」开始
            </div>
          )}
        </div>

        {/* 证据矩阵：去竖线的数据表（大厂风） */}
        {bundle.matrix && (
          <div className="overflow-hidden rounded-xl border border-line/60 bg-card shadow-s1">
            <div className="flex items-center justify-between border-b border-line/50 px-4 py-2.5">
              <span className="text-[12.5px] font-medium text-t2">证据矩阵（Canonical Registry）</span>
              <span className="text-[11px] text-t3">下游仅从此处恢复论文集合 · 防证据漂移</span>
            </div>
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line/40 text-[10.5px] uppercase tracking-wider text-t3">
                  <th className="px-4 py-2 font-medium">子问题</th>
                  <th className="px-3 py-2 font-medium">章节</th>
                  <th className="px-3 py-2 font-medium">可答性</th>
                  <th className="px-3 py-2 text-right font-medium">论文</th>
                  <th className="px-4 py-2 font-medium">冻结论文集合</th>
                </tr>
              </thead>
              <tbody>
                {allSubs.map((s) => (
                  <tr key={s.id} className="border-b border-line/25 transition-colors last:border-0 hover:bg-black/[0.02]">
                    <td className="max-w-[260px] px-4 py-2">
                      <div className="truncate text-t1" title={s.text}>{s.text}</div>
                      <div className="font-mono text-[10.5px] text-t3">{s.id}</div>
                    </td>
                    <td className="px-3 py-2 text-t3">§{s.section}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
                        s.level === 'strong' ? 'bg-[#eef7f0] text-[#0a5a2d]'
                          : s.level === 'weak' ? 'bg-[#fdf6e3] text-[#8a6a1f]' : 'bg-[#fdecea] text-[#b3261e]')}>
                        {s.score.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-t2">{s.paperIds.length}</td>
                    <td className="max-w-[360px] truncate px-4 py-2 font-mono text-[11px] text-t3" title={s.paperIds.join('\n')}>
                      {s.paperIds.slice(0, 3).join(' · ')}{s.paperIds.length > 3 ? ` +${s.paperIds.length - 3}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!USE_MOCK && <HumanLoopSidebar projectId={projectId} />}

      {/* 保存后的级联执行：大方向改了 → 小方向重匹配证据；子问题改了 → 本子问题重匹配 */}
      {cascade && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 backdrop-blur-[2px]"
          onClick={() => setCascade(null)}>
          <div className="w-[520px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-t1">
              {cascade.isMacro ? '大方向已修改' : '子问题已修改'}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-t3">
              {cascade.isMacro
                ? <>该宏观 RQ 下 <b className="text-t2">{cascade.subCount}</b> 个子问题的证据可能与新方向不再匹配。建议统一重新匹配证据并重算评分。</>
                : '本子问题的证据可能已与新表述不匹配。建议重新匹配证据。'}
            </p>
            <div className="mt-3 rounded-xl border border-line/60 bg-[#fafaf8] p-3 text-[11.5px] leading-5 text-t2">
              {cascade.isMacro
                ? <>将执行：按新文本在 KG 多跳检索 → LLM 判定每篇相关性 → 只保留强相关证据（可能少于 5 篇）→ 按真实覆盖重算评分</>
                : <>将执行：KG 多跳检索 → LLM 相关性裁决 → 只保留强相关证据 → 重算评分</>}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button type="button" className="text-[11.5px] text-t3 hover:text-t1" onClick={() => setCascade(null)}>
                稍后手动处理
              </button>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setCascade(null)}>跳过</Button>
                <Button size="sm" className="bg-brand text-white hover:bg-brand-strong border-transparent"
                  disabled={busy}
                  onClick={() => {
                    const c = cascade;
                    setCascade(null);
                    setRescoring({
                      title: c.isMacro ? '正在重新匹配全部子问题…' : '正在重新匹配证据并重算评分…',
                      detail: 'KG 多跳检索（论文/节点/边）→ LLM 逐篇判定相关性 → 只采纳强相关证据 → 重算 Answerability；约 1-3 分钟，期间请不要关闭或切换页面。',
                    });
                    void run(async () => {
                      const d = await rematchBatch(projectId, c.rqId, 5, c.isMacro ? '' : c.subId);
                      const items = (d.results || []).filter((x) => x.sub_rq_id);
                      const detail = items.slice(0, 6)
                        .map((x) => `${x.sub_rq_id}: ${x.total ?? 0} 篇${typeof x.score === 'number' ? ` · ${x.score.toFixed(2)}` : ''}`)
                        .join('；');
                      toast(d.hint || (detail ? `已重匹配并评分 — ${detail}` : '已重新匹配证据并重算评分'));
                      return d;
                    }).then(() => reload()).finally(() => setRescoring(null));
                  }}>
                  {busy ? '处理中…' : cascade.isMacro ? `重新匹配 ${cascade.subCount} 个子问题并评分` : '重新匹配证据并评分'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重评分阻塞遮罩：加载动画 + 禁止离开（beforeunload 另拦刷新/关闭） */}
      {rescoring && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
          <div className="w-[440px] max-w-[92vw] rounded-2xl bg-white p-6 text-center shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <div className="mt-3 text-[14px] font-semibold text-t1">{rescoring.title}</div>
            <div className="mt-1.5 whitespace-pre-line text-[12px] leading-5 text-t3">{rescoring.detail}</div>
            <div className="mt-4 flex justify-center gap-1.5">
              {['KG 检索', '采用证据', '重算评分'].map((s, i) => (
                <span key={s} className="rounded-full bg-page px-2 py-0.5 text-[10.5px] text-t3"
                  style={{ animation: `pulse 1.6s ease-in-out ${i * 0.25}s infinite` }}>{i + 1}. {s}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 编辑对话框：内置 AI 建议（替代原生 prompt） */}
      <RqEditDialog
        open={!!dlg}
        mode={dlg?.mode || 'rewrite'}
        title={dlg?.title || ''}
        hint={dlg?.hint}
        initial={dlg?.initial || ''}
        busy={busy}
        onCancel={() => setDlg(null)}
        onSave={(text) => {
          if (!dlg) return;
          const d = dlg;
          setDlg(null);
          void run(async () => {
            if (d.mode === 'expand_sub') {
              const r = await mutateRq(projectId, { op: 'add_sub', rq_id: d.rqId, sub_rq_text: text });
              if (r?.hint) showToast(r.hint);
              return r;
            }
            const r = await mutateRq(projectId, { op: 'update', rq_id: d.rqId, sub_rq_id: d.subId, text });
            if (r?.hint) showToast(r.hint);
            const macro = bundle?.macros.find((x) => x.id === d.rqId);
            setCascade({ rqId: d.rqId, subId: d.subId, isMacro: !d.subId, subCount: macro?.subs.length || 0 });
            return r;
          });
        }}
        onSuggest={async (instruction) => {
          if (!dlg) return '';
          if (dlg.mode === 'expand_sub') {
            // 新增子问题：按用户意见从宏观 RQ 生成一个候选
            const d = await suggestRqText(projectId, 'expand_sub', dlg.macroText || '', {
              instruction, macroText: dlg.macroText || '',
            });
            return d.options?.[0] || '';
          }
          // 修改现有文本：按意见改写
          const d = await suggestRqText(projectId, 'revise', dlg.initial, { instruction, macroText: dlg.macroText || '' });
          return d.text || d.options?.[0] || '';
        }}
      />

      {/* 支撑论文挑选：从 KG 勾选（增删都走这里，不用 AI 对话） */}
      {evOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[10vh]" onClick={() => setEvOpen(null)}>
          <div className="flex max-h-[76vh] w-[660px] max-w-[94vw] flex-col rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium text-t1">支撑论文 · <span className="font-mono text-[11.5px] text-t3">{evOpen.subId}</span></div>
                <button type="button" className="text-t3 hover:text-t1" onClick={() => setEvOpen(null)}>✕</button>
              </div>
              <div className="mt-0.5 line-clamp-1 text-[11.5px] text-t3" title={evOpen.text}>{evOpen.text}</div>
              <div className="mt-2 flex items-center gap-2">
                <input autoFocus value={evQ} onChange={(e) => void filterEvList(e.target.value)}
                  placeholder="搜索 KG 论文（标题或 ID）…"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-page px-2.5 py-1.5 text-[12.5px] text-t1" />
                <Button variant="secondary" size="sm" disabled={rmBusy} onClick={() => void runRematch()}
                  title="按当前 RQ 文本在 KG 里检索相关命题与论文，自动预选高相关候选">
                  {rmBusy ? '匹配中…' : '✨ 智能匹配'}
                </Button>
                <Button variant="ghost" size="sm" disabled={rmBusy} onClick={() => void addNewPaper()}
                  title="新论文直接写入 KG 并与当前证据论文建立关联">
                  ＋ 新论文
                </Button>
              </div>
              {(rmTerms.length > 0 || rmSuggest) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-t3">
                  <span>检索词 {rmTerms.join(' / ') || '—'}</span>
                  {rmSuggest && (
                    <span className="rounded-full bg-[#eef7f0] px-2 py-0.5 text-[#0a5a2d]">
                      强相关 {rmSuggest.papers} 篇 / 候选 {rmSuggest.candidates ?? '—'} → 建议 {rmSuggest.score.toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {evList.map((p2) => {
                const checked = evSel.includes(p2.paper_id);
                return (
                  <label key={p2.paper_id}
                    className={cn('mb-1 flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-[12px] leading-4 transition-colors',
                      checked ? 'bg-[#eef7f0]' : 'hover:bg-black/[0.04]')}>
                    <input type="checkbox" className="mt-0.5" checked={checked}
                      onChange={(e) => setEvSel((v) => (e.target.checked ? [...v, p2.paper_id] : v.filter((x) => x !== p2.paper_id)))} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-t1">{p2.title || p2.paper_id}</span>
                        {typeof p2.relevance === 'number' && (
                          <span className={cn('shrink-0 rounded px-1 py-0.5 text-[9.5px]',
                            p2.relevance >= 2 ? 'bg-[#e5f2e0] text-[#138a07]' : 'bg-black/5 text-t3')}
                            title={p2.reason || ''}>
                            {p2.relevance >= 3 ? '直接相关' : p2.relevance === 2 ? '强相关' : '背景'}
                          </span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-t3">{p2.paper_id}{p2.year ? ` · ${p2.year}` : ''}</span>
                      {p2.reason && <span className="mt-0.5 block truncate text-[10px] text-t3" title={p2.reason}>依据：{p2.reason}</span>}
                    </span>
                  </label>
                );
              })}
              {evList.length === 0 && <div className="p-6 text-center text-[12px] text-t3">没有匹配的论文（KG 为空或搜索无结果）</div>}
            </div>
            <div className="flex items-center justify-between border-t border-line/60 px-4 py-2.5">
              <span className="text-[11px] text-t3">已选 {evSel.length} 篇 · 保存后自动重算评分</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEvOpen(null)}>取消</Button>
                <Button size="sm" className="bg-brand text-white hover:bg-brand-strong border-transparent"
                  disabled={busy} onClick={() => void saveEvidence()}>保存选择</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
