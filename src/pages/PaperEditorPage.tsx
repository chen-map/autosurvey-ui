import { useEffect, useRef, useState, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { indentWithTab, history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { Card } from '@/components/ui/Card';
import { confirmDialog, promptDialog, toast } from '@/components/ui/feedback';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import {
  getPaperFiles, getPaperFile, savePaperFile, compilePaper, getPaperCompileStatus,
  generateSection, getProject, surveyPdfSource,
  getWorkbenchOutline, adoptOutline, createPaperSection, saveWorkbenchOutline,
  getPaperMaterials, uploadPaperMaterial, distillMaterial, getMaterialDistill,
  rewriteParagraph, applyOutlineOrder, initPaper, resetPaper, checkConsistency,
  generateAbstract, generateClosingChapters,
  addPaperBib,
  type ConsistencyIssue,
  getWorkbench, saveWorkbench, type WorkbenchState, type WorkbenchStats,
  getArrangement, saveArrangement, analyzeInsight, autoArrange, composeOutline, landAllOutline,
  type Arrangement, type ArrBlock,
  getPaperSkeletons,
  getPaperBibkeys, getChapterPlan, generateChapterPlan, saveChapterPlan, writeParagraph,
  getSkillStudio, type SkillFile,
  type MaterialItem, type DistillResult, type OutlineEntry, type ChapterPlan,
  type PlanParagraph,
} from '@/services/api';
import { useProjectEvents } from '@/hooks/useProjectEvents';
import { PdfPaperView } from '@/components/PdfPaperView';
import { EditorToolbar } from '@/components/EditorToolbar';
import { latexEditorExtensions } from '@/lib/latexTheme';

const fmtSize = (n: number) => (n > 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
type WBStage = 'outline' | 'arrange' | 'write' | 'refine';

// ── 白盒子流水线条：四阶段 + 产物统计（点任意阶段直接跳转）────────
function StageBar({ stage, stats, locked, compileFailed, onStage }: {
  stage: WBStage; stats: WorkbenchStats; locked: boolean; compileFailed: boolean; onStage: (s: WBStage) => void;
}) {
  const items = [
    { k: 'outline' as const, n: '大纲', stat: `${stats.outline_entries} 章${locked ? ' · 已锁定' : ''}` },
    { k: 'arrange' as const, n: '编排', stat: `${stats.blocks_assigned}/${stats.blocks_total} 块` },
    { k: 'write' as const, n: '逐段写作', stat: `${stats.inserted}/${stats.paragraphs} 段` },
    { k: 'refine' as const, n: '精修编译',
      stat: stats.compile === 'done' ? '编译完成' : stats.compile === 'error' || compileFailed ? '编译失败' : stats.compile === 'running' ? '编译中' : '未编译' },
  ];
  return (
    <div className="flex shrink-0 items-center border-b border-line/60 bg-card px-4 py-1.5">
      <span className="mr-3 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-t3">白盒流水线</span>
      {items.map((it, i) => (
        <Fragment key={it.k}>
          {i > 0 && <span className="mx-1.5 h-px w-6 shrink-0 bg-line" />}
          <button type="button" onClick={() => onStage(it.k)}
            className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors',
              stage === it.k ? 'bg-brand-weak ring-1 ring-brand/30' : 'hover:bg-black/5')}>
            <span className={cn('grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-semibold',
              stage === it.k ? 'bg-brand text-white' : 'bg-black/10 text-t2')}>{i + 1}</span>
            <span className={cn('text-[12px]', stage === it.k ? 'font-medium text-brand-fg' : 'text-t2')}>{it.n}</span>
            <span className={cn('text-[10.5px]', it.k === 'refine' && it.stat === '编译失败' ? 'text-danger' : 'text-t3')}>{it.stat}</span>
          </button>
        </Fragment>
      ))}
      <span className="ml-auto shrink-0 text-[10px] text-t3">白盒：每个阶段的产物和数量实时可见</span>
    </div>
  );
}

// ── 编排看板（S1）：章内内容序列（先→后）+ 块池 + 我的见解 ────────
function ArrangeBoard({ projectId, chapterFile, onSelectChapter, onGoWrite }: {
  projectId: string; chapterFile: string | null; onSelectChapter: (file: string) => void; onGoWrite: () => void;
}) {
  const qc = useQueryClient();
  const arrQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'arrangement'],
    queryFn: () => getArrangement(projectId),
  });
  const [arr, setArr] = useState<Arrangement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insight, setInsight] = useState('');
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, { related: string[]; position: string; evidence_needed: string } | 'loading'>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [emptyAfterAuto, setEmptyAfterAuto] = useState<{ file: string; title: string }[]>([]);
  const [autoMsg, setAutoMsg] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { if (arrQ.data) setArr(arrQ.data); }, [arrQ.data]);
  // 初始化写盘后刷新白盒统计
  useEffect(() => {
    if (arrQ.data) void qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'workbench'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrQ.data]);

  const persist = async (next: Arrangement) => {
    setArr(next);
    setSaving(true);
    try {
      await saveArrangement(projectId, next);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'workbench'] });
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'arrangement'] });
    } finally {
      setSaving(false);
    }
  };

  if (arrQ.isLoading || (!arr && !arrQ.isError)) {
    return <div className="flex h-full items-center justify-center text-[12.5px] text-t3">加载编排…</div>;
  }
  if (arrQ.isError || !arr) {
    return <div className="flex h-full items-center justify-center text-[12.5px] text-danger">编排数据加载失败——刷新重试</div>;
  }
  // 章节选择统一由 activePath 驱动（左栏点击/看板下拉同一状态源）
  const foundIdx = arr.chapters.findIndex((c) => c.file === chapterFile);
  const safeIdx = foundIdx >= 0 ? foundIdx : 0;
  const chapter = arr.chapters[safeIdx];
  if (!chapter) {
    return <div className="flex h-full items-center justify-center text-[12.5px] text-t3">编排尚未初始化——先回阶段①创建论文骨架并落地大纲章节</div>;
  }

  const moveBlock = (from: number, to: number) => {
    if (to < 0 || to >= chapter.blocks.length || from === to) return;
    const blocks = [...chapter.blocks];
    const [b] = blocks.splice(from, 1);
    blocks.splice(to, 0, b);
    const next = { ...arr, chapters: arr.chapters.map((c, i) => (i === safeIdx ? { ...c, blocks } : c)) };
    void persist(next);
  };
  const removeBlock = (i: number) => {
    const blocks = [...chapter.blocks];
    const [b] = blocks.splice(i, 1);
    const next = { ...arr, chapters: arr.chapters.map((c, k) => (k === safeIdx ? { ...c, blocks } : c)), pool: [...arr.pool, b] };
    void persist(next);
  };
  const addFromPool = (pid: string) => {
    const b = arr.pool.find((x) => x.id === pid);
    if (!b) return;
    const next = {
      chapters: arr.chapters.map((c, i) => (i === safeIdx ? { ...c, blocks: [...c.blocks, b] } : c)),
      pool: arr.pool.filter((x) => x.id !== pid),
    };
    void persist(next);
  };
  const addInsight = () => {
    if (!insight.trim()) return;
    const b: ArrBlock = { id: `ins:${Date.now()}`, kind: 'insight', title: insight.trim(), source: '我的见解', note: '', papers: 0 };
    setInsight('');
    void persist({ ...arr, chapters: arr.chapters.map((c, i) => (i === safeIdx ? { ...c, blocks: [...c.blocks, b] } : c)) });
  };
  const saveNote = (i: number, note: string) => {
    const blocks = chapter.blocks.map((b, k) => (k === i ? { ...b, note } : b));
    void persist({ ...arr, chapters: arr.chapters.map((c, k) => (k === safeIdx ? { ...c, blocks } : c)) });
  };
  const runAnalysis = async (b: ArrBlock) => {
    setAnalysis((m) => ({ ...m, [b.id]: 'loading' }));
    try {
      const d = await analyzeInsight(projectId, b.title + (b.note ? `（${b.note}）` : ''));
      setAnalysis((m) => ({ ...m, [b.id]: d }));
    } catch (e) {
      setAnalysis((m) => ({ ...m, [b.id]: { related: [], position: e instanceof Error ? e.message : '分析失败', evidence_needed: '' } }));
    }
  };
  const savePlan = async () => {
    if (!arr) return;
    await persist(arr);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2200);
  };
  const editBlockTitle = async (i: number) => {
    const t = await promptDialog({ title: '编辑这一块的内容', label: '也是给 AI 的写作依据', value: chapter.blocks[i].title });
    if (t === null || !t.trim()) return;
    const blocks = chapter.blocks.map((b, k) => (k === i ? { ...b, title: t.trim() } : b));
    void persist({ ...arr, chapters: arr.chapters.map((c, k) => (k === safeIdx ? { ...c, blocks } : c)) });
  };
  const runAuto = async () => {
    if (!(await confirmDialog({ title: 'AI 语义预编排', body: '把 RQ 证据块和你的见解块重新分配到语义最相关的章节（见解块若原章合适会保留原位），之后仍可手动拖拽。' }))) return;
    setAutoBusy(true); setAutoMsg('');
    try {
      const d = await autoArrange(projectId);
      setArr({ chapters: d.chapters, pool: d.pool });
      // 跳到变化后第一个有内容的章，避免停在空章上误以为"没反应"
      const firstFilled = d.chapters.findIndex((c) => c.blocks.length > 0);
      if (firstFilled >= 0) onSelectChapter(d.chapters[firstFilled].file);
      const parts = d.summary.map((s) => `${s.title.slice(0, 12)} ${s.count}块`).join('、');
      setEmptyAfterAuto(d.empty_chapters || []);
      setAutoMsg(`AI 分配完成：${d.assigned} 块已归位（${d.changed} 块换了章节）｜${parts}`
        + ((d.empty_chapters?.length) ? `｜⚠ ${d.empty_chapters.length} 个章仍空（见下方提示）` : ''));
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'workbench'] });
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'arrangement'] });
    } catch (e) {
      setAutoMsg(e instanceof Error ? e.message : '预编排失败');
    } finally {
      setAutoBusy(false);
    }
  };
  const totalBlocks = arr.chapters.reduce((n, c) => n + c.blocks.length, 0) + arr.pool.length;
  const assigned = totalBlocks - arr.pool.length;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {autoBusy && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/85 backdrop-blur-[1px]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <div className="mt-3 text-[13px] font-medium text-t1">AI 正在读大纲和所有内容块…</div>
          <div className="mt-1 text-[11.5px] text-t3">把每块放到语义最相关的章节，约需 1–2 分钟</div>
        </div>
      )}
      {/* 章节选择 + 完成度 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line/60 px-4 py-2">
        <span className="text-[11px] text-t3">编排章节：</span>
        <select value={safeIdx} onChange={(e) => onSelectChapter(arr.chapters[Number(e.target.value)]?.file ?? '')}
          className="min-w-0 max-w-[380px] flex-1 rounded border border-line bg-page px-2 py-1 text-[12.5px] text-t1">
          {arr.chapters.map((c, i) => (
            <option key={c.file} value={i}>{i + 1}. {c.title}（{c.blocks.length} 块）</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" className="shrink-0" disabled={autoBusy} onClick={() => void runAuto()}
          title="AI 读每块的小 RQ 内容与各章标题/摘要，把块放进语义最相关的章节；见解块不动">
          {autoBusy ? 'AI 编排中…' : '✨ AI 语义预编排'}
        </Button>
        <Button size="sm" className="shrink-0 bg-brand text-white hover:bg-brand-strong border-transparent"
          disabled={saving} onClick={() => void savePlan()}>
          {saving ? '保存中…' : savedFlash ? '✓ 已保存' : '保存本章规划'}
        </Button>
        <span className="ml-auto shrink-0 text-[11px] text-t3">已编排 {assigned}/{totalBlocks} 块{saving ? ' · 保存中…' : ''}</span>
      </div>
      {autoMsg && (
        <div className="shrink-0 border-b border-line/40 bg-[#f2f7f3] px-4 py-1.5 text-[11px] leading-4 text-t2">{autoMsg}</div>
      )}
      {emptyAfterAuto.length > 0 && (
        <div className="shrink-0 border-b border-[#f0e0c0] bg-[#fffdf5] px-4 py-2">
          <div className="text-[11.5px] leading-4 text-[#8a6a1f]">
            这些章分配后仍为空：{emptyAfterAuto.map((e) => e.title.slice(0, 18)).join('、')}
            —— 它们的子问题已被更具体的主题章吸收，建议删除以免论文里出现空章。
          </div>
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" variant="secondary" disabled={saving}
              onClick={() => {
                const drop = new Set(emptyAfterAuto.map((e) => e.title));
                const keep = arr.chapters.filter((c) => !drop.has(c.title));
                void persist({ ...arr, chapters: keep, pool: arr.pool });
                setEmptyAfterAuto([]);
                setAutoMsg('已删除空章（大纲里对应条目仍保留，可在阶段①再调整）');
              }}>
              从编排中删除这些空章
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEmptyAfterAuto([])}>保留（我自己写概述）</Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[760px]">
          <div className="mb-2 text-[13px] font-semibold text-t1">
            「{chapter.title}」内容序列 <span className="text-[11px] font-normal text-t3">（先 → 后，拖拽调整）</span>
          </div>
          {chapter.blocks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-5 text-center text-[12px] leading-5 text-t3">
              本章还没有内容块——从下方块池加入 RQ 证据，或写下你自己的见解。
            </div>
          ) : (
            <div className="space-y-2">
              {chapter.blocks.map((b, i) => {
                const a = analysis[b.id];
                return (
                  <div key={b.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragIdx !== null) moveBlock(dragIdx, i); setDragIdx(null); }}
                    className={cn('w-full cursor-grab rounded-xl border bg-white p-3 shadow-sm transition-colors',
                      b.kind === 'insight' ? 'border-[#e7d9ad] bg-[#fffdf4]' : 'border-line/60',
                      dragIdx === i && 'opacity-50')}>
                    <div className="flex items-start gap-2">
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        b.kind === 'insight' ? 'bg-[#f5ead0] text-[#8a6a1f]' : 'bg-info text-info-fg')}>
                        {b.kind === 'insight' ? '见解' : 'RQ 证据'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[12.5px] leading-5 text-t1">{b.title}</div>
                        {b.source && <div className="mt-0.5 text-[10.5px] text-t3">{b.source}</div>}
                        {b.note && <div className="mt-1 rounded bg-page px-2 py-1 text-[11px] leading-4 text-t2">写作提示：{b.note}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button type="button" title="上移" className="px-1 text-[12px] text-t3 hover:text-t1" onClick={() => moveBlock(i, i - 1)}>↑</button>
                        <button type="button" title="下移" className="px-1 text-[12px] text-t3 hover:text-t1" onClick={() => moveBlock(i, i + 1)}>↓</button>
                        <button type="button" title="移回块池" className="px-1 text-[12px] text-t3 hover:text-danger" onClick={() => removeBlock(i)}>✕</button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <button type="button" className="text-[10.5px] text-t3 hover:text-t1"
                        onClick={() => editBlockTitle(i)}>✎ 编辑内容</button>
                      <button type="button" className="text-[10.5px] text-t3 hover:text-t1"
                        onClick={() => {
                          void promptDialog({ title: '这一块的写作提示', label: '给 AI 的补充说明（可空）', value: b.note })
                            .then((note) => { if (note !== null) saveNote(i, note); });
                        }}>✎ 写作提示</button>
                      {b.kind === 'insight' && (
                        <button type="button" className="text-[10.5px] text-brand hover:underline"
                          onClick={() => void runAnalysis(b)}>
                          AI 分析关联
                        </button>
                      )}
                    </div>
                    {a === 'loading' && <div className="mt-1.5 text-[10.5px] text-t3">分析中…</div>}
                    {a && a !== 'loading' && (
                      <div className="mt-1.5 space-y-1 rounded-lg bg-[#f2f7f3] p-2 text-[11px] leading-4 text-t2">
                        {a.related?.length > 0 && <div>相关研究问题：{a.related.join('、')}</div>}
                        {a.position && <div>建议位置：{a.position}</div>}
                        {a.evidence_needed && <div>建议补充：{a.evidence_needed}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex gap-1.5">
            <input value={insight} onChange={(e) => setInsight(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addInsight(); }}
              placeholder="＋ 我的见解：这章里我想补充的观点/数据/侧重点，回车加入"
              className="min-w-0 flex-1 rounded-lg border border-line bg-page px-2.5 py-2 text-[12.5px] text-t1" />
            <Button variant="secondary" size="sm" disabled={!insight.trim()} onClick={addInsight}>＋ 加为见解</Button>
          </div>

          {/* 待分配块池 */}
          <div className="mt-5 border-t border-line/60 pt-3">
            <div className="mb-2 text-[12px] font-semibold text-t2">待分配块池（W4 证据 · 加入其他章节时先切到该章）</div>
            {arr.pool.length === 0 ? (
              <div className="rounded-lg bg-page p-2.5 text-[11px] leading-4 text-t3">块池空了——所有证据块都已编排进章节。</div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {arr.pool.map((b) => (
                  <div key={b.id} className="rounded-lg border border-line/60 bg-white p-2.5">
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0 rounded bg-info px-1.5 py-0.5 text-[10px] text-info-fg">RQ 证据</span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[11.5px] leading-4 text-t1">{b.title}</div>
                        <div className="mt-0.5 text-[10px] text-t3">{b.source}</div>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" className="mt-1.5 w-full" onClick={() => addFromPool(b.id)}>
                      ＋ 加入本章
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部：完成编排 */}
      <div className="flex shrink-0 items-center justify-between border-t border-line/60 bg-[#fafaf8] px-4 py-2.5">
        <span className="text-[11px] text-t3">编排结果 = 逐段写作的分段依据（写某段时用哪些块一目了然）</span>
        <Button size="sm" className="min-w-[200px] bg-brand text-white hover:bg-brand-strong border-transparent"
          onClick={onGoWrite}>
          完成编排，进入 ③ 写作 →
        </Button>
      </div>
    </div>
  );
}

// ── LaTeX 编辑器（CodeMirror 6 + stex + 撤销历史）────────────────
function LatexEditor({
  value, onChange, viewRef,
}: { value: string; onChange: (v: string) => void; viewRef: { current: EditorView | null } }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view0 = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          StreamLanguage.define(stexMath),
          ...latexEditorExtensions,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    view.current = view0;
    viewRef.current = view0;
    return () => view0.destroy();
    // 仅挂载一次：内容变化通过外部受控同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full overflow-auto bg-white" />;
}

// ── 蒸馏结果视图（含摘录）────────────────────────────────────────
function DistillView({ d }: { d: DistillResult }) {
  return (
    <div className="space-y-2 text-[11.5px] leading-4">
      {d.outline.map((n, i) => (
        <div key={i}>
          <div className="font-medium text-t1">{i + 1}. {n.title}</div>
          {n.summary && <div className="pl-3 text-t3">{n.summary}</div>}
          {n.children?.map((c, j) => (
            <div key={j} className="pl-3">
              <div className="text-t2">· {c.title}</div>
              {c.summary && <div className="pl-3 text-t3">{c.summary}</div>}
            </div>
          ))}
        </div>
      ))}
      {d.dimensions?.length > 0 && (
        <div className="text-t3"><span className="font-medium text-t2">分类维度：</span>{d.dimensions.join('；')}</div>
      )}
      {d.style_notes?.length > 0 && (
        <div className="text-t3"><span className="font-medium text-t2">论证套路：</span>{d.style_notes.join('；')}</div>
      )}
      {d.excerpts && d.excerpts.length > 0 && (
        <div>
          <div className="font-medium text-t2">值得借鉴的段落（逐字摘录）</div>
          {d.excerpts.map((ex, i) => (
            <div key={i} className="mt-1 rounded bg-white/70 p-1.5">
              <div className="text-[10px] text-t3">{ex.where}｜{ex.why}</div>
              <div className="mt-0.5 text-[11px] italic leading-4 text-t2">"{ex.text}"</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 素材卡片：蒸馏 → 查看 → 采用 ─────────────────────────────────
function MaterialCard({ projectId, m, onAdopted, selected, onToggle }: {
  projectId: string; m: MaterialItem; onAdopted: (name: string, n: number) => void;
  selected?: boolean; onToggle?: (checked: boolean) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const dQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'material', m.id, 'distill'],
    queryFn: () => getMaterialDistill(projectId, m.id),
    enabled: open && m.distilled,
  });

  const distill = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await distillMaterial(projectId, m.id);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'materials'] });
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'material', m.id, 'distill'] });
      setOpen(true);
      setMsg(d.distill.relevance?.level === 'low'
        ? `蒸馏完成，但⚠️ 这篇素材与本项目主题不相关：${d.distill.relevance.reason || ''}——不建议采用它的结构`
        : '蒸馏完成——下面是提炼出的骨架与摘录');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '蒸馏失败');
    } finally {
      setBusy(false);
    }
  };

  const adopt = async (force = false) => {
    if (!force && m.relevance?.level === 'low') {
      const ok = await confirmDialog({
        title: '这篇素材与项目主题不相关',
        body: `${m.relevance.reason || 'AI 判定它与本项目的研究方向基本无关。'}
采用它的结构会把大纲带偏（之前出现过整份大纲变成另一篇论文的情况）。仍要采用吗？`,
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true); setMsg('');
    try {
      const d = await adoptOutline(projectId, m.id, force);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'outline'] });
      onAdopted(m.name, d.entries.length);
    } catch (e) {
      const msg0 = e instanceof Error ? e.message : '采用失败';
      if (msg0.includes('素材与本项目主题不相关')) {
        setMsg(msg0);
        const ok = await confirmDialog({ title: '仍要采用这份不相关素材？', body: msg0, danger: true });
        if (ok) { setBusy(false); return adopt(true); }
      } else {
        setMsg(msg0);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line/60 bg-[#fafaf8] p-2">
      <div className="flex items-center gap-1.5">
        {m.distilled && onToggle && (
          <input type="checkbox" checked={!!selected} title="勾选后可与其它素材综合成一份大纲"
            onChange={(e) => onToggle(e.target.checked)} className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-t1" title={m.name}>{m.name}</span>
        {m.relevance?.level === 'high' && <span className="shrink-0 rounded bg-[#e5f2e0] px-1 text-[10px] text-[#138a07]" title={m.relevance.reason}>主题相关</span>}
        {m.relevance?.level === 'medium' && <span className="shrink-0 rounded bg-[#fdf0e0] px-1 text-[10px] text-[#b45309]" title={m.relevance.reason}>部分相关</span>}
        {m.relevance?.level === 'low' && <span className="shrink-0 rounded bg-[#fdecea] px-1 text-[10px] text-[#b3261e]" title={m.relevance.reason}>主题不相关</span>}
        <span className="shrink-0 rounded bg-black/5 px-1 text-[10px] uppercase text-t3">{m.kind}</span>
        {m.distilled && <span className="shrink-0 rounded bg-[#e5f2e0] px-1 text-[10px] text-[#138a07]">已蒸馏</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {!m.distilled ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void distill()}>
            {busy ? '蒸馏中…' : '蒸馏'}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? '收起' : '查看'}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void adopt()}>
              {busy ? '采用中…' : '采用为大纲'}
            </Button>
          </>
        )}
      </div>
      {open && m.distilled && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded bg-page p-2">
          {dQ.isLoading ? (
            <div className="text-[11px] text-t3">加载中…</div>
          ) : dQ.data ? (
            <DistillView d={dQ.data} />
          ) : (
            <div className="text-[11px] text-t3">暂无蒸馏结果</div>
          )}
        </div>
      )}
      {msg && <div className="mt-1.5 text-[11px] leading-4 text-t3">{msg}</div>}
    </div>
  );
}

// ── 全屏专注页：写这段后直接占据整个界面（大字阅读 + 可编辑）──────
function FocusOverlay({ idx, total, chapter, intent, cites, bib, text, busy, error, onText, onConfirm, onInsert, onRewrite, onClose }: {
  idx: number; total: number; chapter: string; intent: string;
  cites: string[]; bib: Record<string, string>; text: string; busy: boolean; error?: string;
  onText: (t: string) => void; onConfirm: () => void; onInsert: () => void;
  onRewrite: () => void; onClose: () => void;
}) {
  const [phase, setPhase] = useState<'edit' | 'ready'>('edit');
  const [draft, setDraft] = useState(text);
  useEffect(() => { setDraft(text); setPhase('edit'); }, [text, idx]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* 顶栏 */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line/60 px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#138a07]/10 text-[12px] font-medium text-[#138a07]">{idx + 1}</span>
          <span className="truncate text-[13px] font-medium text-t1">{chapter}</span>
          <span className="shrink-0 text-[11px] text-t3">第 {idx + 1}/{total} 段</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-[11px] text-t3 sm:inline">Esc 关闭</span>
          <button type="button" onClick={onClose} className="text-t3 transition-colors hover:text-t1">✕</button>
        </div>
      </div>
      {/* 意图条 */}
      <div className="shrink-0 border-b border-line/40 bg-[#fafaf8] px-5 py-2.5">
        <div className="mx-auto max-w-[760px] text-[12.5px] leading-5 text-t2">
          <span className="mr-1.5 rounded bg-black/5 px-1.5 py-0.5 text-[10.5px] text-t3">本段任务</span>
          {intent}
        </div>
        {cites.length > 0 && (
          <div className="mx-auto mt-1.5 flex max-w-[760px] flex-wrap gap-1">
            {cites.map((c) => (
              <span key={c} className="rounded bg-[#eef3ee] px-1.5 py-0.5 font-mono text-[10.5px] text-[#2a6041]" title={bib[c] || '（标题未知）'}>{c}</span>
            ))}
          </div>
        )}
      </div>
      {/* 正文：大字衬线可编辑 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#138a07] border-t-transparent" />
              <div className="mt-3 text-[13px] text-t2">正在写这一段…</div>
            </div>
          </div>
        ) : (
          <>
          {error && (
            <div className="mx-auto mt-4 max-w-[760px] rounded-xl border border-[#e5b4ad] bg-[#fdecea] px-4 py-3 text-[12.5px] leading-5 text-[#b3261e]">
              <div className="font-medium">这一段没有生成出来</div>
              <div className="mt-0.5">{error}</div>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (phase === 'ready') setPhase('edit'); }}
            spellCheck={false}
            className="mx-auto block min-h-full w-full max-w-[760px] resize-none bg-white px-6 py-8 font-serif text-[17px] leading-[1.95] text-t1 outline-none"
          />
          </>
        )}
      </div>
      {/* 底部操作条 */}
      <div className="flex h-[68px] shrink-0 items-center justify-center gap-3 border-t border-line/60 bg-[#fafaf8] px-5">
        {busy ? (
          <span className="text-[12.5px] text-t3">生成后可直接在此修改</span>
        ) : phase === 'edit' ? (
          <>
            {error && (
              <Button variant="secondary" size="md" onClick={onRewrite}>重试生成</Button>
            )}
            <Button size="md" disabled={!draft.trim()}
              className="min-w-[160px] bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent disabled:opacity-40"
              onClick={() => { onText(draft); onConfirm(); setPhase('ready'); }}>
              确定
            </Button>
            <Button variant="ghost" size="md" onClick={onClose}>先放一放</Button>
          </>
        ) : (
          <>
            <Button size="md" className="min-w-[160px] bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent"
              onClick={() => { onInsert(); onClose(); }}>
              插入本章
            </Button>
            <Button variant="secondary" size="md" onClick={() => { setPhase('edit'); }}>继续修改</Button>
            <Button variant="ghost" size="md" onClick={onRewrite}>重写</Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 段落计划卡片（STORM 式逐段确认的核心单元）────────────────────
function PlanCard({ idx, para, bib, busy, onWrite, onInsert, onRewrite, onUpdate, onDelete, onOpenEdit }: {
  idx: number;
  para: PlanParagraph;
  bib: Record<string, string>;
  busy: boolean;
  onWrite: () => void;
  onInsert: () => void;
  onRewrite: () => void;
  onUpdate: (p: PlanParagraph) => void;
  onDelete: () => void;
  onOpenEdit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftIntent, setDraftIntent] = useState(para.intent);

  return (
    <div className={cn(
      'rounded-xl border p-3.5 shadow-sm transition-colors',
      para.status === 'inserted' ? 'border-[#cfe8c8] bg-[#f4faf2]'
        : para.status === 'generated' ? 'border-[#c4d9f2] bg-[#f5f9fe]'
        : 'border-line/60 bg-white',
    )}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] text-t2">{idx + 1}</span>
        {editing ? (
          <div className="min-w-0 flex-1">
            <textarea
              value={draftIntent}
              onChange={(e) => setDraftIntent(e.target.value)}
              className="h-16 w-full resize-none rounded border border-line bg-white px-2 py-1.5 text-[12px] leading-4 text-t1"
            />
            <div className="mt-1 flex gap-1">
              <Button size="sm" onClick={() => { onUpdate({ ...para, intent: draftIntent.trim() || para.intent }); setEditing(false); }}>保存</Button>
              <Button variant="ghost" size="sm" onClick={() => { setDraftIntent(para.intent); setEditing(false); }}>取消</Button>
            </div>
          </div>
        ) : (
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(true)} title="点击修改这段的写作意图">
            <div className="line-clamp-2 text-[12.5px] leading-4 text-t1">{para.intent || '（空的段落，点这里写意图）'}</div>
          </button>
        )}
        {para.status === 'inserted' && (
          <span className="shrink-0 text-[10px] text-[#138a07]">已插入</span>
        )}
      </div>
      {para.cites.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {para.cites.slice(0, 3).map((c) => (
            <span key={c} className="group flex max-w-full items-center rounded bg-[#eef3ee] px-1.5 py-0.5 font-mono text-[10px] text-[#2a6041]" title={bib[c] || '（标题未知）'}>
              <span className="max-w-[180px] truncate">{c}</span>
              <button type="button" className="ml-1 shrink-0 text-t3 hover:text-danger" onClick={() => onUpdate({ ...para, cites: para.cites.filter((x) => x !== c) })}>×</button>
            </span>
          ))}
          {para.cites.length > 3 && (
            <span className="rounded bg-[#eef3ee] px-1.5 py-0.5 font-mono text-[10px] text-[#2a6041]" title={para.cites.slice(3).join('\n') + '\n（点 × 可删引用）'}>
              +{para.cites.length - 3}
            </span>
          )}
        </div>
      )}
      {para.status === 'generated' && para.latex && (
        <button type="button" onClick={onOpenEdit}
          className="mt-2 block w-full rounded-lg bg-page/70 p-3 text-left font-serif text-[13.5px] leading-[1.85] text-t2 transition-colors hover:bg-page"
          title="点击全屏查看/编辑">
          <span className="line-clamp-3">{para.latex.replace(/\\cite\{[^}]*\}/g, '').replace(/[\\{}%&$#_^]/g, '').trim().slice(0, 200)}…</span>
          <span className="mt-1 block font-sans text-[10.5px] text-t3">点开全屏阅读和修改 →</span>
        </button>
      )}
      <div className="mt-2 flex gap-1">
        {para.status === 'pending' && (
          <Button size="sm" className="flex-1 bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent" onClick={onWrite} disabled={busy}>
            {busy ? '写作中…' : '写这段'}
          </Button>
        )}
        {para.status === 'generated' && (
          <>
            <Button size="sm" className="flex-1 bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent" onClick={onOpenEdit}>打开编辑</Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={onInsert} disabled={busy}>插入</Button>
            <Button variant="ghost" size="sm" onClick={onDelete} title="不采用，从计划里去掉">丢弃</Button>
          </>
        )}
        {para.status === 'inserted' && (
          <Button variant="secondary" size="sm" className="flex-1" onClick={onRewrite} disabled={busy}>重新写</Button>
        )}
      </div>
    </div>
  );
}

export function PaperEditorPage() {
  const { projectId = '' } = useParams();
  const qc = useQueryClient();
  const token = localStorage.getItem('as.token') ?? '';
  const projQ = useQuery({
    queryKey: ['project', projectId, 'meta'],
    queryFn: () => getProject(projectId),
  });
  const projectTitle = projQ.data?.title ?? projectId;

  useProjectEvents(projectId, token);

  // ── 基础数据 ──────────────────────────────────────────────────
  const filesQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'files'],
    queryFn: () => getPaperFiles(projectId),
  });
  const files = filesQ.data?.files ?? [];
  const existingPaths = new Set(files.map((f) => f.path));
  const [active, setActive] = useState<string | null>(null);
  const activePath = active ?? files.find((f) => f.path.startsWith('sections/'))?.path
    ?? files.find((f) => f.path !== 'main.tex')?.path ?? files[0]?.path ?? null;

  const fileQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'file', activePath],
    queryFn: () => getPaperFile(projectId, activePath!),
    enabled: !!activePath,
    retry: false,
  });
  const serverContent = fileQ.data?.content ?? '';
  const [content, setContent] = useState('');
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  useEffect(() => {
    if (activePath && fileQ.isSuccess) { setContent(serverContent); setLoadedPath(activePath); }
    else if (activePath && fileQ.isError) { setContent(''); setLoadedPath(activePath); }
  }, [activePath, fileQ.isSuccess, fileQ.isError, serverContent]);
  const dirty = loadedPath === activePath && content !== serverContent;
  const fileMissing = !!activePath && activePath !== 'main.tex' && !existingPaths.has(activePath);

  const outlineQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'outline'],
    queryFn: () => getWorkbenchOutline(projectId),
  });
  const outline = outlineQ.data?.entries ?? [];
  const doneCount = outline.filter((e) => e.status === 'done').length;

  const bibQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'bibkeys'],
    queryFn: () => getPaperBibkeys(projectId),
  });
  const bibMap: Record<string, string> = {};
  (bibQ.data?.keys ?? []).forEach((k) => { bibMap[k.key] = k.title; });

  const matsQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'materials'],
    queryFn: () => getPaperMaterials(projectId),
  });
  const materials = matsQ.data?.materials ?? [];

  const compileQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'compile'],
    queryFn: () => getPaperCompileStatus(projectId),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });
  const compiling = compileQ.data?.status === 'running';
  const compileErrors = compileQ.data?.errors ?? [];

  // PDF 预览
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfKey, setPdfKey] = useState(0);
  const [pdfWide, setPdfWide] = useState(false);
  // 按编译完成时间戳刷新（状态一直是 done 时布尔跳变检测不到重新编译）
  const compileStamp = (compileQ.data as { ended_at?: string } | undefined)?.ended_at ?? '';
  useEffect(() => { if (compileStamp) setPdfKey((n) => n + 1); }, [compileStamp]);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    (async () => {
      const tk = localStorage.getItem('as.token') ?? '';
      const src = await surveyPdfSource(projectId);
      const res = await fetch(`${src.url}${src.url.includes('?') ? '&' : '?'}v=${pdfKey}`, {
        headers: tk ? { Authorization: `Bearer ${tk}` } : {},
      }).catch(() => null);
      if (!res || !res.ok || !alive) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (alive) setPdfUrl(objectUrl);
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, pdfKey, compileQ.data?.status]);

  // 保存
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!activePath) return;
    setSaving(true);
    try {
      await savePaperFile(projectId, activePath, content);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'file', activePath] });
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'files'] });
    } finally {
      setSaving(false);
    }
  };
  const saveAndCompile = async () => {
    await save();
    await compilePaper(projectId);
    qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'compile'] });
  };

  // ── 大纲编辑（本地改 → PUT 全量）───────────────────────────────
  const saveOutline = async (entries: OutlineEntry[]) => {
    await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'outline'] });
    await saveWorkbenchOutline(projectId, entries.map((e, i) => ({ ...e, order: i + 1 })));
    await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'outline'] });
  };
  const moveEntry = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= outline.length) return;
    const next = [...outline];
    [next[i], next[j]] = [next[j], next[i]];
    await saveOutline(next);
  };
  const removeEntry = async (i: number) => {
    await saveOutline(outline.filter((_, k) => k !== i));
  };
  const renameEntry = async (i: number, title: string) => {
    if (!title.trim()) return;
    const next = outline.map((e, k) => (k === i ? { ...e, title: title.trim() } : e));
    await saveOutline(next);
  };
  const markDone = async (i: number) => {
    const next = outline.map((e, k) => (k === i ? { ...e, status: e.status === 'done' ? 'planned' : 'done' } : e));
    await saveOutline(next);
  };
  const [applying, setApplying] = useState(false);
  const applyOrder = async () => {
    setApplying(true);
    try {
      const d = await applyOutlineOrder(projectId);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'file', 'main.tex'] });
      setOutlineMsg(`已按大纲顺序重排正文（${d.moved} 章）——「保存并编译」后 PDF 顺序即生效`);
    } catch (e) {
      setOutlineMsg(e instanceof Error ? e.message : '重排失败');
    } finally {
      setApplying(false);
    }
  };
  // 从零初始化：survey_paper/main.tex 不存在时（filesQ 404）显示 CTA
  const [initBusy, setInitBusy] = useState(false);
  const doInit = async () => {
    setInitBusy(true);
    try {
      await initPaper(projectId);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'files'] });
      setOutlineMsg('论文骨架已创建——现在可点「落地全部章节」，或逐章点开写作');
    } catch (e) {
      setOutlineMsg(e instanceof Error ? e.message : '初始化失败');
    } finally {
      setInitBusy(false);
    }
  };
  const [landAllBusy, setLandAllBusy] = useState(false);
  const landAll = async () => {
    setLandAllBusy(true);
    try {
      const d = await landAllOutline(projectId);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
      setOutlineMsg(d.landed ? `已落地 ${d.landed} 个章节文件` : '所有章节都已落地');
    } catch (e) {
      setOutlineMsg(e instanceof Error ? e.message : '落地失败');
    } finally {
      setLandAllBusy(false);
    }
  };
  // 清空重写：PDF 只保留我自己写的内容（旧稿整目录备份可回滚；大纲与引用池保留）
  const [resetBusy, setResetBusy] = useState(false);
  const doReset = async () => {
    if (!(await confirmDialog({ title: '清空重写', body: '当前论文全部内容（W5 初稿等）会整目录备份到 survey_paper-backup-<时间戳>/，然后重置为空骨架。大纲、段落计划、引用池保留。', danger: true }))) return;
    setResetBusy(true);
    try {
      const d = await resetPaper(projectId);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
      setOutlineMsg(`已清空重写（旧稿备份为 ${d.backup}/）——现在 PDF 里只会出现你自己写的内容`);
    } catch (e) {
      setOutlineMsg(e instanceof Error ? e.message : '重置失败');
    } finally {
      setResetBusy(false);
    }
  };

  // 大纲来源面板
  const [srcPanel, setSrcPanel] = useState<boolean>(false);
  const [composeSel, setComposeSel] = useState('rq_only');
  const [lastAnalysis, setLastAnalysis] = useState<string[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const skQ = useQuery({
    queryKey: ['paper', 'skeletons'],
    queryFn: () => getPaperSkeletons(projectId),
  });
  const skeletons = skQ.data?.skeletons ?? [];
  const [draftInstr, setDraftInstr] = useState('');
  const [srcBusy, setSrcBusy] = useState(false);
  const [srcMsg, setSrcMsg] = useState('');
  const [outlineMsg, setOutlineMsg] = useState('');
  // ── 章写作（STORM 式：段落计划 → 逐段确认）─────────────────────
  const [mode, setMode] = useState<'write' | 'code'>('write');
  const [plan, setPlan] = useState<ChapterPlan | null>(null);
  const planQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'plan', activePath],
    queryFn: () => getChapterPlan(projectId, activePath!),
    enabled: mode === 'write' && !!activePath,
  });
  useEffect(() => { if (planQ.data?.plan) setPlan(planQ.data.plan); }, [planQ.data]);
  const [planInstr, setPlanInstr] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [writeMsg, setWriteMsg] = useState('');
  const [writingIdx, setWritingIdx] = useState(-1);
  // 逐节写作技能：只加载选中的 user skill（内置 w5_academic_writing 始终保留）
  const [writerSkill, setWriterSkill] = useState('');
  const skillQ = useQuery({
    queryKey: ['project', projectId, 'skills'],
    queryFn: () => getSkillStudio(projectId),
  });
  const w5Slot = skillQ.data?.slots.find((s) => s.key === 'w5.write');
  const writeSkills: SkillFile[] = (() => {
    const all = skillQ.data?.skills ?? [];
    const bound = new Set(w5Slot?.bound ?? []);
    return bound.size ? all.filter((s) => bound.has(s.name)) : all;
  })();
  // 全屏专注页：写这段后直接占据整个界面
  const [focus, setFocus] = useState<{ idx: number } | null>(null);
  const [focusText, setFocusText] = useState('');
  const [focusErr, setFocusErr] = useState('');

  const activeEntry = outline.find((e) => e.file === activePath);
  const chapterTitle = activeEntry?.title
    ?? (fileQ.data?.content ? (fileQ.data.content.match(/\\section\{([^}]+)\}/)?.[1] ?? activePath) : activePath);

  const doPlan = async () => {
    if (!activePath) return;
    setPlanBusy(true); setWriteMsg('');
    try {
      const d = await generateChapterPlan(projectId, activePath, planInstr);
      setPlan(d.plan);
      setWriteMsg(`计划了 ${d.plan.paragraphs.length} 段（引用池 ${d.bib_total} 个键）——逐段确认后点「写这段」`);
      if (activeEntry && activeEntry.status !== 'done') {
        const i = outline.indexOf(activeEntry);
        if (i >= 0) await saveOutline(outline.map((e, k) => (k === i ? { ...e, status: 'planned' } : e)));
      }
    } catch (e) {
      setWriteMsg(e instanceof Error ? e.message : '规划失败');
    } finally {
      setPlanBusy(false);
    }
  };

  const patchPara = async (idx: number, p: PlanParagraph) => {
    if (!plan || !activePath) return;
    const paras = plan.paragraphs.map((x, k) => (k === idx ? p : x));
    setPlan({ ...plan, paragraphs: paras });
    await saveChapterPlan(projectId, activePath, paras);
  };

  const writePara = async (idx: number) => {
    if (!plan || !activePath) return;
    const p = plan.paragraphs[idx];
    setWritingIdx(idx); setWriteMsg('');
    setFocusText('');
    setFocusErr('');
    setFocus({ idx }); // 立即全屏：生成中转圈，完成后大字展示
    try {
      // 关联编排块：本章第一个 RQ 块 → 后端把该块证据论文注入上下文
      const blk = arrTree?.chapters.find((c) => c.file === activePath)?.blocks.find((b) => b.kind === 'rq');
      // 重写已插入的段落时，记住旧段落文本（插入时原位替换，避免新旧两段并存）
      const prevLatex = p.status === 'inserted' ? p.latex : (p.prev_latex || '');
      const d = await writeParagraph(projectId, activePath, p.intent, p.cites, {
        reference_texts: selectedRefs.map((r) => r.text),
        block_id: blk?.id,
        skill: writerSkill || undefined,
      });
      if (!d.latex || !d.latex.trim()) {
        throw new Error('模型返回了空段落（可能输出被截断）。请点「重试生成」，或先检查模型余额/配置。');
      }
      await patchPara(idx, { ...p, latex: d.latex, status: 'generated', prev_latex: prevLatex });
      setFocusText(d.latex);
      setFocus({ idx });
      const warn: string[] = [];
      if (d.cjk_warning) warn.push('模型两次输出仍含中文——建议重写');
      if (d.dropped_cites.length) warn.push(`引用键不在 .bib 已剔除：${d.dropped_cites.join('、')}`);
      if (d.unverified_numbers?.length) warn.push(`这些数字在参考摘录中找不到来源，请核对：${d.unverified_numbers.join('、')}`);
      const bits: string[] = [];
      if (d.claims_used) bits.push(`${d.claims_used} 条已核验 claims`);
      if (d.style_samples) bits.push(`${d.style_samples} 条风格样本`);
      const basis = bits.length ? `基于 ${bits.join(' + ')}` : '';
      setWriteMsg(warn.length ? `已生成${basis ? `（${basis}）` : ''}（注意：${warn.join('；')}）` : `已生成${basis ? `（${basis}）` : ''}——检查正文与引用，满意点「插入」`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '写作失败';
      setWriteMsg(msg);
      setFocusErr(msg);
    } finally {
      setWritingIdx(-1);
    }
  };

  const insertPara = async (idx: number) => {
    if (!plan || !activePath) return;
    const p = plan.paragraphs[idx];
    const frag = p.latex.trim();
    const probe = frag.slice(0, 80).replace(/\s+/g, ' ');
    // ① 重写场景：正文里还留着旧段落 → 原位替换（避免"旧+新"两段并存）
    const prev = (p.prev_latex || '').trim();
    if (prev && content.includes(prev)) {
      setContent((c) => c.replace(prev, frag));
      await patchPara(idx, { ...p, status: 'inserted', prev_latex: '' });
      setWriteMsg('已原位替换旧段落——点「保存」写盘');
      return;
    }
    // ② 防重复：正文里已有这段（之前插入过）就不再追加
    if (probe && content.replace(/\s+/g, ' ').includes(probe)) {
      await patchPara(idx, { ...p, status: 'inserted' });
      setWriteMsg('这段已经在正文里了（不重复插入）——如需重写请点「重新写」，插入时会原位替换');
      return;
    }
    // ③ 新段落：追加到末尾
    setContent((c) => (c.trim() ? c.replace(/\s*$/, '') + '\n\n' + frag + '\n' : frag + '\n'));
    await patchPara(idx, { ...p, status: 'inserted', prev_latex: '' });
    setWriteMsg('已插入编辑器内容末尾——点右上「保存」写盘，写完所有段后「保存并编译」');
  };

  // 参考摘录（素材蒸馏的逐字段语录，写作时的可选参考）
  const [showRefs, setShowRefs] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [allExcerpts, setAllExcerpts] = useState<{ label: string; text: string }[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<{ label: string; text: string }[]>([]);
  useEffect(() => {
    if (!showRefs) return;
    let alive = true;
    (async () => {
      const out: { label: string; text: string }[] = [];
      for (const m of materials.filter((x) => x.distilled)) {
        try {
          const d = await getMaterialDistill(projectId, m.id);
          for (const ex of d.excerpts ?? []) out.push({ label: `${m.name} · ${ex.where}（${ex.why}）`, text: ex.text });
        } catch { /* 忽略单份失败 */ }
      }
      if (alive) setAllExcerpts(out);
    })();
    return () => { alive = false; };
  }, [showRefs, projectId, materials]);

  // 源码模式：格式工具栏 + 引用选择器
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeQuery, setCiteQuery] = useState('');
  // ── 源码模式：选中段改写 ───────────────────────────────────────
  const editorViewRef = useRef<EditorView | null>(null);
  const [rewOpen, setRewOpen] = useState(false);
  const [rewInstr, setRewInstr] = useState('');
  const [rewBusy, setRewBusy] = useState(false);
  const [rewMsg, setRewMsg] = useState('');
  const doRewrite = async () => {
    const v = editorViewRef.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    if (from === to) { setRewMsg('请先在编辑器里用鼠标选中一段文字'); return; }
    setRewBusy(true); setRewMsg('');
    try {
      const d = await rewriteParagraph(projectId, v.state.doc.sliceString(from, to), rewInstr);
      v.dispatch({ changes: { from, to, insert: d.text } });
      setRewMsg('已替换选中段——不满意按 Ctrl+Z 撤销，满意记得保存');
    } catch (e) {
      setRewMsg(e instanceof Error ? e.message : '改写失败');
    } finally {
      setRewBusy(false);
    }
  };

  // 源码模式下的整章生成（进阶保留）
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const generate = async () => {
    if (!activePath || activePath === 'main.tex') {
      setGenMsg('main.tex 是骨架，请选择一个章节文件生成');
      return;
    }
    setGenerating(true); setGenMsg('');
    try {
      const d = await generateSection(projectId, activePath, instruction, writerSkill);
      setContent(d.latex);
      setGenMsg(`已生成（模型 ${d.model}，可用引用键 ${d.bib_keys} 个）——检查后点保存`
        + (d.copy_warning ? `；⚠ 与参考样例连续重叠：${d.copy_warning}，建议改写` : ''));
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  // 多篇素材综合（借鉴多篇风格）：勾选 ≥2 篇 → 结构综合 + 本项目 RQ 映射
  const [selMats, setSelMats] = useState<string[]>([]);
  const [synthBusy, setSynthBusy] = useState(false);
  const synthMaterials = async () => {
    if (selMats.length < 2) return;
    setSynthBusy(true);
    try {
      const d = await composeOutline(projectId, 'synth:' + selMats.join(','), '');
      setLastAnalysis(d.analysis ?? []);
      setOutlineMsg(`已综合 ${selMats.length} 篇素材的结构：${d.chapters} 章、预编排 ${d.blocks} 块｜RQ 覆盖 ${d.rq_used}/${d.rq_total}`);
      setSelMats([]);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
      setTab('outline');
    } catch (e) {
      toast(e instanceof Error ? e.message : '综合失败');
    } finally {
      setSynthBusy(false);
    }
  };

  // 素材上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const doUpload = async (fl: FileList | null) => {
    const f = fl?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadPaperMaterial(projectId, f);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'materials'] });
    } catch { /* 刷新失败不打断 */ } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const [tab, setTab] = useState<'outline' | 'materials' | 'files'>('outline');
  const tabs = [
    { k: 'outline' as const, label: '大纲' },
    { k: 'materials' as const, label: '素材' },
    { k: 'files' as const, label: '文件' },
  ];

  // ── 白盒子流水线：当前阶段（持久化）+ 跳转 ─────────────────────
  const wbQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'workbench'],
    queryFn: () => getWorkbench(projectId),
  });
  const [w4Bypass, setW4Bypass] = useState(false);
  // 左栏大纲树的内容块来源（与编排看板共用缓存）
  const arrTreeQ = useQuery({
    queryKey: ['project', projectId, 'paper', 'arrangement'],
    queryFn: () => getArrangement(projectId),
    retry: false,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const arrTree = arrTreeQ.data;
  const stage = (wbQ.data?.stage ?? 'outline') as WBStage;
  const gotoStage = (s: WBStage) => {
    if (filesQ.isError && s !== 'outline') {
      setTab('outline');
      setOutlineMsg('还没有论文骨架——先在中间工作区点「从零开始创建论文」');
      return;
    }
    qc.setQueryData(['project', projectId, 'paper', 'workbench'], (old: WorkbenchState | undefined) =>
      old ? { ...old, stage: s } : old);
    void saveWorkbench(projectId, { stage: s }).then(() =>
      qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'workbench'] }));
    if (s === 'outline') setTab('outline');
    if (s === 'write') setMode('write');
    if (s === 'refine') setMode('code');
  };
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const createSection = async (title?: string) => {
    const t = (title ?? newTitle).trim();
    if (!t) return;
    setCreating(true);
    try {
      const d = await createPaperSection(projectId, t);
      setNewTitle('');
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'outline'] });
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'files'] });
      setActive(d.file);
      setOutlineMsg(`已创建章节文件 ${d.file}`);
    } catch (e) {
      setOutlineMsg(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 摘要生成（④ 精修）
  const [absBusy, setAbsBusy] = useState(false);
  const [absMsg, setAbsMsg] = useState('');
  const runAbstract = async () => {
    setAbsBusy(true); setAbsMsg('');
    try {
      const d = await generateAbstract(projectId);
      setAbsMsg(`已写入摘要（${d.words} 词）——「保存并编译」后可在 PDF 首页看到`);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
    } catch (e) {
      setAbsMsg(e instanceof Error ? e.message : '摘要生成失败');
    } finally {
      setAbsBusy(false);
    }
  };

  // 收尾章节生成（④ 精修）
  const [closeBusy, setCloseBusy] = useState(false);
  const runClosing = async () => {
    setCloseBusy(true);
    try {
      const d = await generateClosingChapters(projectId);
      setAbsMsg(d.hint || `已生成 ${d.created.length} 个收尾章节`);
      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
    } catch (e) {
      setAbsMsg(e instanceof Error ? e.message : '生成失败');
    } finally {
      setCloseBusy(false);
    }
  };

  // 全文一致性检查（④ 精修）
  const [consistBusy, setConsistBusy] = useState(false);
  const [consistIssues, setConsistIssues] = useState<ConsistencyIssue[]>([]);
  const [consistChecked, setConsistChecked] = useState(0);
  const runConsistency = async () => {
    setConsistBusy(true);
    try {
      const d = await checkConsistency(projectId);
      setConsistIssues(d.issues ?? []);
      setConsistChecked(d.checked ?? 0);
    } catch (e) {
      setConsistIssues([{ type: 'error', a: '', b: '', why: e instanceof Error ? e.message : '检查失败', suggest: '' }]);
      setConsistChecked(0);
    } finally {
      setConsistBusy(false);
    }
  };

  const errCount = compileErrors.length;

  // ── 阶段①工作区：大纲编辑（宽屏版，原左栏大纲内容）─────────────
  const outlineWorkspace = (
    <div className="mx-auto max-w-[680px] space-y-2.5 p-5">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold text-t1">大纲工作区</div>
        <Button variant="secondary" size="sm" onClick={() => setSrcPanel((v) => !v)}>
          ＋ 大纲来源
        </Button>
      </div>
      {filesQ.isError && (
        <div className="rounded-xl border border-[#cfe8c8] bg-[#f2f9f0] p-3">
          <div className="text-[13px] font-semibold text-t1">从零开始写论文</div>
          <div className="mt-1 text-[11px] leading-4 text-t3">
            创建论文骨架（正文模板 + 参考文献），然后选一个大纲来源、逐章逐段开写——不需要先跑完流水线。
          </div>
          <Button size="sm" className="mt-2 w-full bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent"
            onClick={() => void doInit()} disabled={initBusy}>
            {initBusy ? '创建中…' : '从零开始创建论文'}
          </Button>
        </div>
      )}
      {filesQ.isSuccess && files.length > 0 && (
        <div className="rounded-lg bg-[#fdf8ec] px-2.5 py-2 text-[11px] leading-4 text-[#8a6a1f]">
          右侧 PDF = 论文目录全部内容（当前含 W5 初稿）。只想要自己写的 → 「清空重写」。
        </div>
      )}
      {filesQ.isSuccess && outline.some((e) => !e.file) && (
        <div className="flex items-center gap-3 rounded-lg border border-brand/20 bg-brand/[0.04] px-3 py-2">
          <div className="min-w-0 flex-1 text-[11px] leading-4 text-t2">
            大纲有 {outline.filter((e) => !e.file).length} 章尚未落地为 sections 文件。
          </div>
          <Button size="sm" disabled={landAllBusy} onClick={() => void landAll()}
            className="border-transparent bg-brand text-white hover:bg-brand-strong">
            {landAllBusy ? '落地中…' : '落地全部章节'}
          </Button>
        </div>
      )}
      {srcPanel && (
        <div className="space-y-2 rounded-xl border border-line/60 bg-[#fafaf8] p-3">
          <div className="text-[12px] font-semibold text-t1">生成大纲</div>
          <div className="rounded-lg bg-[#f2f7f3] px-2 py-1.5 text-[11px] leading-4 text-t2">
            大纲 = <b>结构</b> × <b>本项目 RQ</b>。选一个结构来源，系统会自动把 W4 的研究问题映射进去，
            每个 RQ 都有归属章节（没处放的会建议新增章）。
          </div>
          <select value={composeSel} onChange={(e) => setComposeSel(e.target.value)}
            className="w-full rounded border border-line bg-page px-2 py-1.5 text-[12.5px] text-t1">
            <option value="rq_only">纯 RQ 结构 · 每个研究问题一章</option>
            <option value="" disabled>── 预设 tex 模板 ──</option>
            {skeletons.map((s) => (
              <option key={s.id} value={`builtin:${s.id}`}>预设模板 · {s.name}（{s.chapters}章）</option>
            ))}
            <option value="" disabled>── 蒸馏结构 ──</option>
            {materials.length === 0 && (
              <option value="" disabled>（无素材——先在左栏「素材」页上传框架论文并蒸馏）</option>
            )}
            {materials.filter((m) => !m.distilled).map((m) => (
              <option key={m.id} value="" disabled>蒸馏结构 · {m.name}（未蒸馏，去左栏「素材」页点蒸馏）</option>
            ))}
            {materials.filter((m) => m.distilled).map((m) => (
              <option key={m.id} value={`distill:${m.id}`}>蒸馏结构 · {m.name}</option>
            ))}
            <option value="" disabled>── AI ──</option>
            <option value="ai_draft">AI 自由起草结构</option>
          </select>
          {composeSel.startsWith('builtin:') && (
            <div className="line-clamp-2 text-[10.5px] leading-4 text-t3">
              {skeletons.find((s) => `builtin:${s.id}` === composeSel)?.desc}
            </div>
          )}
          <textarea value={draftInstr} onChange={(e) => setDraftInstr(e.target.value)}
            placeholder="补充要求（可不填），例：侧重评测方法，7 章以内"
            className="h-12 w-full resize-none rounded border border-line bg-page px-2 py-1.5 text-[12px] leading-4 text-t1" />
          <Button size="sm" className="w-full" disabled={!composeSel || srcBusy}
            onClick={async () => {
              if (!(await confirmDialog({ title: '重建大纲', body: '现有大纲和编排会被替换（sections 里的文章内容不动）。' }))) return;
              setSrcBusy(true); setSrcMsg('');
              void composeOutline(projectId, composeSel, draftInstr).then((d) => {
                setLastAnalysis(d.analysis ?? []);
                setOutlineMsg(
                  `已生成：${d.chapters} 章、预编排 ${d.blocks} 块${d.pool ? `（${d.pool} 块入池）` : ''}｜RQ 覆盖 ${d.rq_used}/${d.rq_total}`
                  + (d.dropped_empty ? `｜已删除 ${d.dropped_empty} 个无 RQ 支撑的模板章` : ''));
                setSrcPanel(false);
                return qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
              }).catch(async (e) => {
                const msg0 = e instanceof Error ? e.message : '生成失败';
                if (msg0.includes('素材与本项目主题不相关')) {
                  setSrcMsg(msg0);
                  if (await confirmDialog({ title: '仍要用这份不相关素材生成大纲？', body: msg0, danger: true })) {
                    setSrcBusy(true); setSrcMsg('');
                    try {
                      const d2 = await composeOutline(projectId, composeSel, draftInstr, false, true);
                      setLastAnalysis(d2.analysis ?? []);
                      setOutlineMsg(`已生成：${d2.chapters} 章、预编排 ${d2.blocks} 块${d2.pool ? `（${d2.pool} 块入池）` : ''}｜RQ 覆盖 ${d2.rq_used}/${d2.rq_total}`
                        + (d2.dropped_empty ? `｜已删除 ${d2.dropped_empty} 个无 RQ 支撑的模板章` : ''));
                      setSrcPanel(false);
                      await qc.invalidateQueries({ queryKey: ['project', projectId, 'paper'] });
                    } catch (e2) { setSrcMsg(e2 instanceof Error ? e2.message : '生成失败'); }
                  }
                } else {
                  setSrcMsg(msg0);
                }
              })
                .finally(() => setSrcBusy(false));
            }}>
            {srcBusy ? '生成中…（综合结构 + 分配证据块）' : '生成大纲'}
          </Button>
          {srcMsg && <div className="text-[10.5px] leading-4 text-danger">{srcMsg}</div>}
        </div>
      )}

      <div className="text-[11px] text-t3">
        {outline.length ? `已完成 ${doneCount}/${outline.length} 章` : '还没有大纲'} · 拖动顺序后用「按大纲重排正文」写进 PDF
      </div>
      {filesQ.isSuccess && files.length > 0 && (
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" className="min-w-0 flex-1" disabled={applying}
            onClick={() => void applyOrder()} title="把大纲顺序写进 main.tex">
            {applying ? '重排中…' : '按大纲重排正文'}
          </Button>
          <Button variant="ghost" size="sm" className="shrink-0 text-t3 hover:text-danger"
            disabled={resetBusy} onClick={() => void doReset()}
            title="旧稿整目录备份后重置为空骨架；大纲、段落计划、引用池保留">
            {resetBusy ? '清空中…' : '清空重写'}
          </Button>
        </div>
      )}

      {outlineQ.isLoading ? (
        <div className="text-[12px] text-t3">加载中…</div>
      ) : outline.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-[12.5px] leading-5 text-t3">
          点上方「＋ 大纲来源」开始：内置骨架 / AI 起草 / 素材综合
        </div>
      ) : (
        <div className="space-y-1.5">
          {outline.map((e, i) => (
            <div key={`${e.file}-${i}`} className={cn('group relative flex items-center rounded-lg border bg-white px-3 py-2.5 shadow-sm',
              e.status === 'done' ? 'border-[#cfe8c8]' : 'border-line/60')}>
              <span className="mr-2.5 text-[12px] text-t3">{i + 1}.</span>
              <span className={cn('mr-2 h-[7px] w-[7px] shrink-0 rounded-full',
                e.status === 'done' ? 'bg-[#138a07]' : e.status === 'planned' ? 'bg-[#4a86d8]' : 'bg-black/15')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-t1">{e.title}</div>
                {e.summary && <div className="truncate text-[11px] text-t3" title={e.summary}>{e.summary}</div>}
              </div>
              {((e.rq_ids?.length ?? 0) > 0 || (e.sub_rq_ids?.length ?? 0) > 0) && (
                <span className={cn('mr-1 shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                  (e.sub_rq_ids?.length ?? 0) > 3 || (e.rq_ids?.length ?? 0) > 2 ? 'bg-[#fdf0e0] text-[#b45309]' : 'bg-info text-info-fg')}
                  title={`承载研究问题：${(e.rq_ids ?? []).join('、')}${(e.sub_rq_ids?.length ?? 0) > 0 ? `；证据块：${(e.sub_rq_ids ?? []).join('、')}` : ''}${(e.sub_rq_ids?.length ?? 0) > 3 ? '（偏多，建议拆分）' : ''}`}>
                  {e.rq_ids?.length ?? 0} RQ{(e.sub_rq_ids?.length ?? 0) > 0 ? ` · ${e.sub_rq_ids!.length} 子问` : ''}
                </span>
              )}
              {!e.file && <span className="mr-1 shrink-0 rounded bg-page px-1.5 py-0.5 text-[10px] text-t3">未落地</span>}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" title="上移" className="px-1 text-[12px] text-t3 hover:text-t1" onClick={() => void moveEntry(i, -1)}>↑</button>
                <button type="button" title="下移" className="px-1 text-[12px] text-t3 hover:text-t1" onClick={() => void moveEntry(i, 1)}>↓</button>
                <button type="button" title="改名" className="px-1 text-[12px] text-t3 hover:text-t1"
                  onClick={() => { void promptDialog({ title: '重命名章节', label: '新标题', value: e.title }).then((t) => { if (t !== null) void renameEntry(i, t); }); }}>✎</button>
                <button type="button" title="删除" className="px-1 text-[12px] text-t3 hover:text-danger" onClick={() => void removeEntry(i)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {outlineMsg && <div className="text-[11.5px] leading-4 text-t3">{outlineMsg}</div>}
      {lastAnalysis.length > 0 && (
        <div className="rounded-lg border border-line/60 bg-white p-2">
          <button type="button" className="flex w-full items-center justify-between text-left"
            onClick={() => setShowAnalysis((v) => !v)}>
            <span className="text-[11px] text-t2">AI 的 RQ 分配依据（{lastAnalysis.length} 条）</span>
            {showAnalysis ? <ChevronUp size={13} className="text-t3" /> : <ChevronDown size={13} className="text-t3" />}
          </button>
          {showAnalysis && (
            <ul className="mt-1 space-y-1">
              {lastAnalysis.map((a2, i2) => (
                <li key={i2} className="text-[10.5px] leading-4 text-t3">· {a2}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-1.5">
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) void createSection(); }}
          placeholder="或直接新增章节标题，回车落地"
          className="min-w-0 flex-1 rounded-lg border border-line bg-page px-2.5 py-2 text-[13px] text-t1" />
        <Button variant="secondary" size="sm" disabled={creating || !newTitle.trim()} onClick={() => void createSection()}>
          ＋ 落地
        </Button>
      </div>

      <div className="flex items-center justify-between border-t border-line/60 pt-3">
        <span className="text-[11px] leading-4 text-t3">
          大纲锁定后仍可随时回来改（阶段可回退）
        </span>
        <Button size="sm" className="min-w-[190px] bg-brand text-white hover:bg-brand-strong border-transparent"
          disabled={outline.length < 3}
          title={outline.length < 3 ? '至少 3 章才能完成大纲' : undefined}
          onClick={() => { void saveWorkbench(projectId, { locked_outline: true }); gotoStage('arrange'); }}>
          完成大纲，进入 ② 编排 →
        </Button>
      </div>
    </div>
  );

  // W4 门禁：没有 RQ 证据矩阵时，工作台的生成动作没有事实底座——先拦住
  if (wbQ.data && wbQ.data.w4_ready === false && !w4Bypass) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f5f1] px-6">
        <div className="w-[560px] max-w-full rounded-2xl border border-line/70 bg-white p-8 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between">
            <Link to={`/projects/${projectId}`} className="text-[12px] text-t3 hover:text-t1">← 返回项目</Link>
            <span className="rounded bg-[#fdecea] px-2 py-0.5 text-[10.5px] font-medium text-[#b3261e]">W4 未完成</span>
          </div>
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-t1">论文工作台要等 W4 完成后再用</h1>
          <p className="mt-2 text-[13px] leading-6 text-t2">
            工作台的每一章、每一段都从 W4 的 <b>RQ 证据块</b> 出发。现在还没有证据矩阵，
            自动生成只会凭空写，无法保证引用与事实来源。
          </p>
          <div className="mt-4 rounded-xl border border-line/60 bg-[#fafaf8] p-4 text-[12px] leading-6 text-t2">
            <div>当前状态：<b className="text-t1">{wbQ.data.w4?.sub_rqs ?? 0}</b> 个子问题 · <b className="text-t1">{wbQ.data.w4?.papers ?? 0}</b> 篇证据论文</div>
            <div className="text-t3">完成路径：W3 RQ 设计 → W4 证据矩阵（对齐/重匹配/评分）→ 再回工作台</div>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <Link to={`/projects/${projectId}/pipeline`}>
              <Button size="sm" className="border-transparent bg-brand text-white hover:bg-brand-strong">去流水线完成 W4</Button>
            </Link>
            <Link to={`/projects/${projectId}/rq`}>
              <Button size="sm" variant="secondary">先看 RQ 与证据</Button>
            </Link>
            <button type="button" className="ml-auto text-[11.5px] text-t3 underline-offset-2 hover:text-t1 hover:underline"
              onClick={() => setW4Bypass(true)}>仍然进入（手动模式）</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#1a1a1a]">
      {srcBusy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
          <div className="w-[430px] max-w-[90vw] rounded-2xl bg-white p-6 text-center shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)]">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <div className="mt-3 text-[14px] font-semibold text-t1">正在综合素材结构并分配证据块…</div>
            <div className="mt-1.5 text-[12px] leading-5 text-t3">
              读取每篇骨架的小节与分类维度 → 合并 6-10 章 → 按 Sub-RQ 证据块落章
              <br />模型较慢时约 2-3 分钟，请勿关闭页面
            </div>
          </div>
        </div>
      )}
      {wbQ.data?.w4_ready === false && w4Bypass && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-[#fdf0e0] px-4 py-1.5 text-[11.5px] text-[#8a5a00]">
          <span>⚠️ W4 未完成 · 当前为手动模式：自动生成可能缺少证据支撑</span>
          <Link to={`/projects/${projectId}/pipeline`} className="font-medium underline underline-offset-2">去跑 W4 →</Link>
        </div>
      )}
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between bg-gradient-to-r from-[#10281c] via-[#173625] to-[#1d4530] px-4 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/projects/${projectId}`} className="flex shrink-0 items-center gap-1 text-[12.5px] text-white/70 transition-colors hover:text-white">
            <ArrowLeft size={14} /> 返回
          </Link>
          <span className="truncate text-[13px] font-medium">{projectTitle}</span>
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px]">论文工作台</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={compiling ? 'info' : compileQ.data?.status === 'error' ? 'danger' : 'neutral'}>
            {compiling ? '编译中…' : compileQ.data?.status === 'error' ? '编译失败' : compileQ.data?.status === 'done' ? '编译完成' : '未编译'}
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button size="sm" onClick={() => void saveAndCompile()} disabled={saving || compiling || dirty}
            className={cn("bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent", (compiling || dirty) && "opacity-60")}>
            {compiling ? '编译中…' : dirty ? '先保存' : '保存并编译'}
          </Button>
        </div>
      </div>

      {filesQ.isError && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#cfe8c8] bg-[#f2f9f0] px-4 py-2">
          <div className="min-w-0 flex-1 text-[11.5px] leading-4 text-t2">
            论文骨架尚未创建：先创建 main.tex + sections + references.bib，之后才能编排和写作。
          </div>
          <Button size="sm" disabled={initBusy} onClick={() => void doInit()}
            className="border-transparent bg-[#138a07] text-white hover:bg-[#0f6e05]">
            {initBusy ? '创建中…' : '从零开始创建论文'}
          </Button>
        </div>
      )}

      {/* 白盒子流水线：四阶段 + 各阶段产物统计（点任意阶段跳转） */}
      <StageBar
        stage={stage}
        stats={wbQ.data?.stats ?? { outline_entries: 0, outline_landed: 0, blocks_total: 0, blocks_assigned: 0, paragraphs: 0, inserted: 0, compile: 'idle' }}
        locked={wbQ.data?.locked_outline ?? false}
        compileFailed={compileQ.data?.status === 'error'}
        onStage={gotoStage}
      />

      <div className="flex min-h-0 flex-1 gap-2 bg-page p-2">
        {/* 左栏：大纲（主视图）/ 素材 / 文件 */}
        <Card className="flex h-full w-80 shrink-0 flex-col overflow-hidden p-3">
          <div className="flex shrink-0 gap-0.5 rounded bg-black/5 p-0.5">
            {tabs.map((t) => (
              <button key={t.k} type="button" onClick={() => setTab(t.k)}
                className={cn('flex-1 rounded px-1 py-1 text-[11.5px] transition-colors',
                  tab === t.k ? 'bg-white font-medium text-t1 shadow-sm' : 'text-t3 hover:text-t2')}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
            {tab === 'outline' && (
              <>
                {stage === 'outline' && (
                  <div className="rounded-lg bg-[#fafaf8] p-2.5 text-[11px] leading-4 text-t3">
                    大纲编辑在<b className="text-t2">中间工作区</b>（阶段①）；这里是大纲树——展开看每章的内容块。
                  </div>
                )}
                {filesQ.isError && (
                  <div className="rounded-lg bg-[#f2f9f0] p-2.5 text-[11px] leading-4 text-t3">
                    还没有论文骨架——去中间工作区点「从零开始创建论文」。
                  </div>
                )}
                {outlineQ.isLoading ? (
                  <div className="text-[11px] text-t3">加载中…</div>
                ) : outline.length === 0 ? (
                  <div className="rounded bg-page p-2.5 text-[11px] leading-4 text-t3">
                    还没有大纲——点上方「＋ 大纲来源」开始
                  </div>
                ) : (
                  outline.map((e, i) => {
                    const isActive = e.file && e.file === activePath;
                    const open = !!expanded[e.file || `i${i}`];
                    const blocks = (e.file && arrTree ? (arrTree.chapters.find((c) => c.file === e.file)?.blocks ?? []) : []);
                    return (
                      <div key={`${e.file}-${i}`}>
                        <div className={cn('group relative flex items-center rounded-md px-1.5 py-[6px] transition-colors',
                          isActive ? 'bg-[#eef4ea]' : 'hover:bg-black/[0.035]')}
                          onClick={() => {
                            if (stage === 'outline') {
                              if (!e.file) void createSection(e.title);
                              else { setActive(e.file); setExpanded((m) => ({ ...m, [e.file]: true })); }
                            } else if (e.file) {
                              setActive(e.file);
                              setMode(stage === 'refine' ? 'code' : 'write');
                              setExpanded((m) => ({ ...m, [e.file]: true }));
                            } else {
                              void createSection(e.title);
                            }
                          }}>
                          {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[#138a07]" />}
                          {e.file ? (
                            <button type="button" title={open ? '折叠' : '展开'}
                              className="mr-1 shrink-0 rounded p-0.5 text-t3 hover:bg-black/10 hover:text-t1"
                              onClick={(ev) => { ev.stopPropagation(); setExpanded((m) => ({ ...m, [e.file]: !m[e.file] })); }}>
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          ) : (
                            <span className="mr-1 w-[18px] shrink-0" />
                          )}
                          <span className={cn('mr-1.5 h-[7px] w-[7px] shrink-0 rounded-full',
                            e.status === 'done' ? 'bg-[#138a07]' : e.status === 'planned' ? 'bg-[#4a86d8]' : 'bg-black/15')} />
                          <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] text-t1">
                            {e.title}
                          </button>
                          {blocks.length > 0 && (
                            <span className="shrink-0 rounded bg-black/5 px-1 text-[9.5px] text-t3">{blocks.length}</span>
                          )}
                          {stage === 'outline' && (
                            <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button type="button" title="上移" className="px-0.5 text-[11px] text-t3 hover:text-t1" onClick={(ev) => { ev.stopPropagation(); void moveEntry(i, -1); }}>↑</button>
                              <button type="button" title="下移" className="px-0.5 text-[11px] text-t3 hover:text-t1" onClick={(ev) => { ev.stopPropagation(); void moveEntry(i, 1); }}>↓</button>
                              <button type="button" title="改名" className="px-0.5 text-[11px] text-t3 hover:text-t1"
                                onClick={(ev) => { ev.stopPropagation(); void promptDialog({ title: '重命名章节', label: '新标题', value: e.title }).then((t) => { if (t !== null) void renameEntry(i, t); }); }}>✎</button>
                              <button type="button" title="删除" className="px-0.5 text-[11px] text-t3 hover:text-danger" onClick={(ev) => { ev.stopPropagation(); void removeEntry(i); }}>✕</button>
                            </div>
                          )}
                        </div>
                        {open && e.file && (
                          <div className="ml-7 border-l border-line/60 pl-2">
                            {blocks.length === 0 ? (
                              <div className="py-1 text-[10.5px] leading-4 text-t3">（该章还没有内容块——去 ② 编排）</div>
                            ) : (
                              blocks.map((b) => (
                                <div key={b.id} className="flex items-center gap-1.5 rounded px-1 py-[3px] hover:bg-black/[0.035]">
                                  <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full',
                                    b.kind === 'insight' ? 'bg-[#d9a92f]' : 'bg-[#4a86d8]')}
                                    title={b.kind === 'insight' ? '我的见解' : 'RQ 证据'} />
                                  <span className="min-w-0 flex-1 truncate text-[11.5px] leading-4 text-t2" title={b.title}>{b.title}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {stage === 'outline' && (
                  <div className="flex gap-1 pt-1">
                    <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) void createSection(); }}
                      placeholder="或直接新增章节标题"
                      className="min-w-0 flex-1 rounded border border-line bg-page px-2 py-1.5 text-[12px] text-t1" />
                    <Button variant="secondary" size="sm" disabled={creating || !newTitle.trim()} onClick={() => void createSection()}>
                      ＋
                    </Button>
                  </div>
                )}
              </>
            )}

            {tab === 'materials' && (
              <>
                <input ref={fileInputRef} type="file" accept=".pdf,.md,.txt" className="hidden"
                  onChange={(e) => void doUpload(e.target.files)} />
                <Button variant="secondary" size="sm" className="w-full" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading ? '上传中…' : '上传素材'}
                </Button>
                <div className="text-[10.5px] leading-4 text-t3">框架论文 PDF / 骨架 MD / TXT——蒸馏后得到大纲和写法摘录</div>
                {selMats.length > 0 && (
                  <div className="rounded-lg border border-brand/30 bg-[#f2f9f0] p-2">
                    <div className="text-[11px] text-t2">已选 {selMats.length} 篇素材</div>
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" className="flex-1 bg-brand text-white hover:bg-brand-strong border-transparent"
                        disabled={selMats.length < 2 || synthBusy}
                        onClick={() => void synthMaterials()}
                        title="把多篇骨架综合成一份结构，再结合本项目 RQ 生成大纲">
                        {synthBusy ? '综合中…' : selMats.length < 2 ? '至少选 2 篇' : `综合 ${selMats.length} 篇为大纲`}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelMats([])}>清空</Button>
                    </div>
                  </div>
                )}
                {/* 文献库（bib）：引用白名单——AI 只能引用这里面的文献 */}
                <div className="mt-1 rounded-lg border border-line/60 bg-white p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-t2">文献库 · {bibQ.data?.count ?? '…'} 条</span>
                    <button type="button" className="text-[10.5px] text-brand hover:underline"
                      onClick={() => {
                        void promptDialog({ title: '补充文献', label: '论文标题（AI 只能引用库内文献）', value: '' }).then((title) => {
                        if (!title || !title.trim()) return;
                        void addPaperBib(projectId, title.trim()).then((r) => {
                          void qc.invalidateQueries({ queryKey: ['project', projectId, 'paper', 'bibkeys'] });
                          toast(r.added ? `已加入文献库（${r.key}）` : `已在库中（${r.key}）`);
                        }).catch((e) => toast(e instanceof Error ? e.message : '添加失败'));
                        });
                      }}>＋ 添加文献</button>
                  </div>
                  <div className="mt-0.5 text-[10px] leading-4 text-t3">
                    引用只能来自这里（W1 语料 + 你上传/补充的文献）。上传的论文蒸馏后自动入库。
                  </div>
                </div>
                {matsQ.isLoading ? (
                  <div className="text-[11px] text-t3">加载中…</div>
                ) : materials.length === 0 ? (
                  <div className="rounded bg-page p-2 text-[11px] leading-4 text-t3">还没有素材。没有也没关系——大纲可以直接用「内置骨架」或「AI 起草」。</div>
                ) : (
                  materials.map((m) => (
                    <MaterialCard key={m.id} projectId={projectId} m={m}
                      selected={selMats.includes(m.id)}
                      onToggle={(c) => setSelMats((v) => (c ? [...v, m.id] : v.filter((x) => x !== m.id)))}
                      onAdopted={(name, n) => { setTab('outline'); setOutlineMsg(`已把「${name}」的骨架写进大纲（${n} 条）`); }} />
                  ))
                )}
              </>
            )}

            {tab === 'files' && (
              <>
                {files.map((f) => (
                  <button key={f.path} type="button" onClick={() => { setActive(f.path); setMode('write'); }}
                    className={cn('w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                      activePath === f.path ? 'bg-ink text-white' : 'text-t2 hover:bg-black/5')}>
                    <div className="truncate font-mono">{f.path.replace('sections/', '')}</div>
                    <div className="text-[10.5px] opacity-70">{fmtSize(f.size)} · {f.mtime}</div>
                  </button>
                ))}
                {files.length === 0 && !filesQ.isPending && (
                  <div className="text-[11px] text-t3">
                    {filesQ.isError ? '还没有论文骨架——去「大纲」页点「从零开始创建论文」' : '没有文件——在「大纲」页点击条目即可创建'}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 源码模式专用：整章生成（进阶） */}
          {mode === 'code' && (
            <div className="mt-3 shrink-0 border-t border-line/60 pt-3">
              <div className="text-[12px] font-semibold text-t2">AI 整章生成（进阶）</div>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
                placeholder="例：补充对抗性评估的对比，引用最新基准"
                className="mt-2 h-16 w-full resize-none rounded border border-line bg-page px-2 py-1.5 text-[12px] leading-4 text-t1" />
              <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => void generate()}
                disabled={generating || !activePath || activePath === 'main.tex'}>
                {generating ? '生成中…' : '生成/改写此章（按指令）'}
              </Button>
              {genMsg && <div className="mt-1.5 text-[11px] leading-4 text-t3">{genMsg}</div>}
            </div>
          )}
        </Card>

        {/* 中栏：写作模式（STORM 式）/ 源码模式 */}
        <Card className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/60 px-3 py-2">
            <div className="flex gap-0.5 rounded bg-black/5 p-0.5">
              {stage === 'write' && (
                <>
                  <button type="button" onClick={() => setMode('write')}
                    className={cn('rounded px-2 py-1 text-[11.5px]', mode === 'write' ? 'bg-white font-medium text-t1 shadow-sm' : 'text-t3')}>写作模式</button>
                  <button type="button" onClick={() => setMode('code')}
                    className={cn('rounded px-2 py-1 text-[11.5px]', mode === 'code' ? 'bg-white font-medium text-t1 shadow-sm' : 'text-t3')}>源码模式</button>
                </>
              )}
              {stage === 'outline' && <span className="px-2 py-1 text-[11.5px] font-medium text-brand-fg">① 大纲工作区</span>}
              {stage === 'arrange' && <span className="px-2 py-1 text-[11.5px] font-medium text-brand-fg">② 编排</span>}
              {stage === 'refine' && <span className="px-2 py-1 text-[11.5px] font-medium text-brand-fg">④ 精修</span>}
            </div>
            <div className="flex items-center gap-2">
              {stage === 'write' && (
                <label className="flex items-center gap-1 text-[11px] text-t3" title="只用选中的用户技能；内置学术写作技能始终生效">
                  <span>写作技能</span>
                  <select
                    value={writerSkill}
                    onChange={(e) => setWriterSkill(e.target.value)}
                    className="h-7 max-w-[150px] rounded border border-line bg-card px-1.5 text-[11px] text-t2"
                  >
                    <option value="">自动（w5.write 绑定）</option>
                    {writeSkills.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}（{s.chars} 字）</option>
                    ))}
                  </select>
                  <Link to={`/projects/${projectId}/skills`} className="text-brand hover:underline">技能库</Link>
                </label>
              )}
              {stage === 'refine' && (
                <>
                  <Button variant="secondary" size="sm" disabled={absBusy}
                    onClick={() => void runAbstract()}
                    title="基于全文正文生成英文摘要，写入 PDF 首页的 abstract 环境">
                    {absBusy ? '生成摘要中…' : '生成摘要'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={closeBusy}
                    onClick={() => void runClosing()}
                    title="基于全文统一生成 Discussion / Limitations / Future Research / Conclusion（这些章不占大纲）">
                    {closeBusy ? '生成中…' : '生成收尾章节'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={consistBusy}
                    onClick={() => void runConsistency()}
                    title="抽取各章每段首句，检查跨章矛盾/重复/口径不一（只报告不修改）">
                    {consistBusy ? '检查中…' : '全文一致性检查'}
                  </Button>
                  {absMsg && <span className="max-w-[260px] truncate text-[10.5px] text-t3" title={absMsg}>{absMsg}</span>}
                </>
              )}
              {activeEntry && (stage === 'write' || stage === 'refine') && (
                <Button variant="ghost" size="sm" onClick={() => void markDone(outline.indexOf(activeEntry))}>
                  {activeEntry.status === 'done' ? '取消完成' : '标记本章完成'}
                </Button>
              )}
              {mode === 'code' && dirty && <Badge variant="warn">未保存</Badge>}
              {mode === 'code' && (
                <Button variant={rewOpen ? 'secondary' : 'ghost'} size="sm"
                  onClick={() => { setRewOpen((v) => !v); setRewMsg(''); }}>
                  改写选中段
                </Button>
              )}
            </div>
          </div>

          {stage === 'outline' ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              {outlineWorkspace}
            </div>
          ) : stage === 'arrange' ? (
            <ArrangeBoard projectId={projectId} chapterFile={activePath} onSelectChapter={(f) => setActive(f)} onGoWrite={() => gotoStage('write')} />
          ) : mode === 'write' ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              <div className="mx-auto max-w-[760px] space-y-4 px-8 py-7">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-[15px] font-semibold text-t1">{chapterTitle}</div>
                    {fileMissing && <span className="shrink-0 rounded bg-[#fdf3e0] px-1.5 py-0.5 text-[10px] text-[#b45309]">新章节</span>}
                  </div>
                  {!bibQ.data?.count && (
                    <span className="shrink-0 text-[10.5px] text-[#b45309]" title="先完成流水线 W4 文献步骤，段落才能带真实引用">引用池为空</span>
                  )}
                </div>

                {/* 段落计划 */}
                {!plan || plan.paragraphs.length === 0 ? (
                  <div className="rounded-xl border border-line/60 bg-[#fafaf8] p-5">
                    <textarea value={planInstr} onChange={(e) => setPlanInstr(e.target.value)}
                      placeholder="补充要求（可不填）"
                      className="h-12 w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-5 text-t1" />
                    <Button size="sm" className="mt-3 w-full bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent"
                      onClick={() => void doPlan()} disabled={planBusy || !activePath || activePath === 'main.tex'}>
                      {planBusy ? '规划中…' : '生成本章段落计划'}
                    </Button>
                    <div className="mt-2 text-center text-[11px] text-t3">
                      {activePath === 'main.tex' ? 'main.tex 是骨架文件——在左侧选一个具体章节' : 'AI 先列分段提纲，你逐段确认后它才动笔'}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-t2">
                        段落计划 · 已写 {plan.paragraphs.filter((p) => p.status === 'inserted').length}/{plan.paragraphs.length}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => void doPlan()} disabled={planBusy}>
                        {planBusy ? '重新规划中…' : '重新规划'}
                      </Button>
                    </div>
                    {plan.paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => p.status !== 'skipped').map(({ p, i }) => (
                      <PlanCard key={i} idx={i} para={p} bib={bibMap} busy={writingIdx === i}
                        onWrite={() => void writePara(i)}
                        onInsert={() => void insertPara(i)}
                        onRewrite={() => void writePara(i)}
                        onUpdate={(np) => void patchPara(i, np)}
                        onDelete={() => void patchPara(i, { ...p, status: 'skipped' })}
                        onOpenEdit={() => { setFocusText(p.latex); setFocusErr(''); setFocus({ idx: i }); }} />
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => {
                      if (!plan || !activePath) return;
                      const paras = [...plan.paragraphs, { intent: '', cites: [], status: 'pending', latex: '' }];
                      setPlan({ ...plan, paragraphs: paras });
                      void saveChapterPlan(projectId, activePath, paras);
                    }}>＋ 加一段</Button>
                  </>
                )}

                {writeMsg && <div className="text-[11.5px] leading-4 text-t2">{writeMsg}</div>}

                {/* 参考摘录 */}
                <div className="rounded-xl border border-line/60 bg-[#fafaf8] p-3">
                  <button type="button" className="flex w-full items-center justify-between text-left"
                    onClick={() => setShowRefs((v) => !v)}>
                    <span className="text-[12px] text-t2">参考摘录{selectedRefs.length > 0 && ` · 已选 ${selectedRefs.length}`}</span>
                    {showRefs ? <ChevronUp size={14} className="text-t3" /> : <ChevronDown size={14} className="text-t3" />}
                  </button>
                  {showRefs && (
                    <div className="mt-2 space-y-1.5">
                      {allExcerpts.length === 0 && <div className="text-[11px] text-t3">暂无摘录——先在「素材」页上传论文并蒸馏</div>}
                      {allExcerpts.map((ex, i) => {
                        const sel = selectedRefs.some((r) => r.text === ex.text);
                        return (
                          <label key={i} className={cn('flex cursor-pointer gap-1.5 rounded p-1.5 text-[11px] leading-4', sel ? 'bg-[#f0f5ee]' : 'bg-page')}>
                            <input type="checkbox" className="mt-0.5" checked={sel}
                              onChange={(e) => setSelectedRefs((v) => (e.target.checked ? [...v, ex] : v.filter((r) => r.text !== ex.text)))} />
                            <div className="min-w-0">
                              <div className="truncate text-[10px] text-t3" title={ex.label}>{ex.label}</div>
                              <div className="line-clamp-2 italic text-t2">"{ex.text}"</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 本章正文（默认收起） */}
                <div className="rounded-xl border border-line/60 bg-[#fafaf8]">
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left"
                    onClick={() => setBodyOpen((v) => !v)}>
                    <span className="text-[12px] text-t2">本章正文 · {content.trim() ? `${content.length} 字` : '空'}</span>
                    {bodyOpen ? <ChevronUp size={14} className="text-t3" /> : <ChevronDown size={14} className="text-t3" />}
                  </button>
                  {bodyOpen && (
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-line/60 p-3 font-mono text-[11.5px] leading-5 text-t2">{content || '（还没有内容）'}</pre>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {(consistIssues.length > 0 || consistChecked > 0) && (
                <div className="max-h-52 shrink-0 overflow-y-auto border-b border-line/60 bg-[#fffdf5] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-t1">
                      全文一致性检查：扫描 {consistChecked} 段，发现 {consistIssues.length} 处问题
                    </span>
                    <button type="button" className="text-[10.5px] text-t3 hover:text-t1"
                      onClick={() => { setConsistIssues([]); setConsistChecked(0); }}>关闭</button>
                  </div>
                  {consistIssues.length === 0 && <div className="mt-1 text-[11px] text-t3">未发现跨章矛盾或重复。</div>}
                  <div className="mt-1.5 space-y-1.5">
                    {consistIssues.map((it, i) => (
                      <div key={i} className="rounded-lg border border-[#f0e0c0] bg-white p-2">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-[#fdf0e0] px-1.5 py-0.5 text-[9.5px] text-[#b45309]">{it.type}</span>
                          {it.why && <span className="min-w-0 flex-1 text-[10.5px] leading-4 text-t2">{it.why}</span>}
                        </div>
                        {it.a && <div className="mt-1 text-[10.5px] leading-4 text-t3">A：{it.a}</div>}
                        {it.b && <div className="text-[10.5px] leading-4 text-t3">B：{it.b}</div>}
                        {it.suggest && <div className="mt-0.5 text-[10.5px] leading-4 text-[#2a6041]">建议：{it.suggest}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rewOpen && (
                <div className="border-b border-line/60 bg-[#f4f7f2] px-3 py-2">
                  <div className="flex items-start gap-2">
                    <textarea value={rewInstr} onChange={(e) => setRewInstr(e.target.value)}
                      placeholder="改写指令，例：更学术、压缩到原来一半、加一句和上文的过渡"
                      className="h-14 min-w-0 flex-1 resize-none rounded border border-line bg-white px-2 py-1.5 text-[12px] leading-4 text-t1" />
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="sm" className="bg-[#138a07] text-white hover:bg-[#0f6e05] border-transparent" onClick={() => void doRewrite()} disabled={rewBusy}>
                        {rewBusy ? '改写中…' : '执行'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRewOpen(false)}>关闭</Button>
                    </div>
                  </div>
                  {rewMsg && <div className="mt-1 text-[11px] leading-4 text-t3">{rewMsg}</div>}
                </div>
              )}
              <div className="min-h-0 flex-1">
                {activePath ? (
                  <div className="flex h-full flex-col">
                    <EditorToolbar viewRef={editorViewRef} onCite={() => { setCiteOpen(true); setCiteQuery(''); }} />
                    <div className="min-h-0 flex-1">
                      <LatexEditor value={content} onChange={setContent} viewRef={editorViewRef} />
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-[12px] text-t3">选择左侧文件开始编辑</div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* 右栏：PDF */}
        <Card className={cn('flex h-full shrink-0 flex-col overflow-hidden', pdfWide ? 'w-[62%] min-w-[440px]' : 'w-[45%] min-w-[400px]')}>
          <div className="flex items-center justify-between border-b border-line/60 px-3 py-2">
            <span className="text-[12px] font-semibold text-t2">渲染预览</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPdfWide((v) => !v)}
                title={pdfWide ? '还原宽度' : '放大 PDF 面板'}>
                {pdfWide ? '还原' : '放大'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPdfKey((n) => n + 1)}>刷新</Button>
            </div>
          </div>
          {compileQ.data?.status === 'error' && (
            <div className="border-b border-line/60 bg-[#fff2f0] px-3 py-2 text-[11.5px] text-danger">
              编译失败{errCount ? `（${errCount} 处错误）` : ''}
              <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                {compileErrors.slice(0, 4).map((e, i) => (
                  <div key={i} className="truncate">{e.file}:{e.line} — {e.msg}</div>
                ))}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {pdfUrl ? (
              <PdfPaperView url={pdfUrl} />
            ) : (
              <div className="p-6 text-center text-[12px] text-t3">编译完成后这里显示 PDF</div>
            )}
          </div>
        </Card>
      </div>

      {/* 引用选择器：从文献库选 key 插入 \cite */}
      {citeOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[12vh]"
          onClick={() => setCiteOpen(false)}>
          <div className="w-[520px] max-w-[92vw] rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line/60 px-3 py-2">
              <input autoFocus value={citeQuery} onChange={(e) => setCiteQuery(e.target.value)}
                placeholder={`搜索文献库（${bibQ.data?.count ?? 0} 条）——回车插入第一项`}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setCiteOpen(false);
                  if (e.key === 'Enter') {
                    const first = (bibQ.data?.keys ?? []).find((k) =>
                      !citeQuery.trim() || k.key.toLowerCase().includes(citeQuery.toLowerCase())
                      || (k.title || '').toLowerCase().includes(citeQuery.toLowerCase()));
                    if (first) {
                      const v = editorViewRef.current;
                      if (v) {
                        const { from, to } = v.state.selection.main;
                        v.dispatch({ changes: { from, to, insert: `\cite{${first.key}}` } });
                        v.focus();
                      }
                      setCiteOpen(false);
                    }
                  }
                }}
                className="w-full rounded border border-line bg-page px-2.5 py-2 text-[13px] text-t1" />
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-1.5">
              {(bibQ.data?.keys ?? [])
                .filter((k) => !citeQuery.trim()
                  || k.key.toLowerCase().includes(citeQuery.toLowerCase())
                  || (k.title || '').toLowerCase().includes(citeQuery.toLowerCase()))
                .slice(0, 60)
                .map((k) => (
                  <button key={k.key} type="button"
                    className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-black/5"
                    onClick={() => {
                      const v = editorViewRef.current;
                      if (v) {
                        const { from, to } = v.state.selection.main;
                        v.dispatch({ changes: { from, to, insert: `\cite{${k.key}}` } });
                        v.focus();
                      }
                      setCiteOpen(false);
                    }}>
                    <span className="shrink-0 rounded bg-[#eef3ee] px-1.5 py-0.5 font-mono text-[10.5px] text-[#2a6041]">{k.key}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-t1">{k.title}</span>
                  </button>
                ))}
              {(bibQ.data?.count ?? 0) === 0 && (
                <div className="p-4 text-center text-[12px] text-t3">
                  文献库为空——先去「素材」页补充文献或完成 W1
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 全屏专注页：写这段 → 大字阅读/修改 → 确定 → 插入 */}
      {focus && plan && plan.paragraphs[focus.idx] && (
        <FocusOverlay
          idx={focus.idx}
          total={plan.paragraphs.length}
          chapter={String(chapterTitle)}
          intent={plan.paragraphs[focus.idx].intent}
          cites={plan.paragraphs[focus.idx].cites}
          bib={bibMap}
          text={focusText}
          busy={writingIdx === focus.idx}
          error={focusErr}
          onText={setFocusText}
          onConfirm={() => void patchPara(focus.idx, { ...plan.paragraphs[focus.idx], latex: focusText, status: 'generated' })}
          onInsert={() => void insertPara(focus.idx)}
          onRewrite={() => void writePara(focus.idx)}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}
