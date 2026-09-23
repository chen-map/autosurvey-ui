import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Lock, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, FileText,
  FileQuestion, GitBranch, Compass, ListChecks, Route, Database, MessageSquareText,
  GitMerge, Layers, Search,
} from 'lucide-react';
import type { Claim, ClaimStatus, MacroRQ, SubRQ } from '@/types/data';
import { getRQBundle } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Gauge, levelVariant, levelLabel } from './RqPage';

// 每个分节标注真实来源产物（analyze_report/ 下，见 WORKFLOW3_GUIDE.md §二）
const SRC = {
  design: 'design_report.md',
  gap: 'gap_summary.md',
  registry: 'rq_query_registry.json',
  matrix: 'rq_evidence_matrix.json',
  outline: 'survey_outline.json',
  reflection: 'rq_reflection_log.md',
} as const;

function SourceTag({ file }: { file: string }) {
  return <span className="font-mono text-[11px] text-t3">analyze_report/{file}</span>;
}

const claimStatusMeta: Record<ClaimStatus, { label: string; variant: 'ok' | 'warn' | 'danger'; icon: typeof CheckCircle2 }> = {
  verified: { label: 'verified', variant: 'ok', icon: CheckCircle2 },
  needs_revision: { label: 'needs_revision', variant: 'warn', icon: AlertTriangle },
  should_remove: { label: 'should_remove', variant: 'danger', icon: XCircle },
};

// ---- 小件 ----

function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="text-[14px] leading-[24px] text-t1">
      {parts.map((part, i) =>
        /^\[\d+\]$/.test(part) ? (
          <sup key={i} className="mx-0.5 rounded bg-info px-1 text-[11px] font-medium text-info-fg">{part}</sup>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function DimDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px]', ok ? 'text-ok' : 'text-danger')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-ok' : 'bg-danger')} />
      {label}{ok ? '✓' : '✗'}
    </span>
  );
}

function ClaimRow({ claim, index }: { claim: Claim; index: number }) {
  const [open, setOpen] = useState(false);
  const meta = claimStatusMeta[claim.status];
  const Icon = meta.icon;
  const removed = claim.status === 'should_remove';
  return (
    <div
      className={cn(
        'anim-rise rounded-card border border-line/60 bg-card shadow-s1 transition-shadow hover:shadow-s2',
        removed && 'opacity-60',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full px-4 py-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <span className={cn('text-[14px] leading-6 text-t1', removed && 'line-through')}>
            <span className="mr-2 font-mono text-[12px] text-t3">{claim.id}</span>
            {claim.text}
          </span>
          <Badge variant={meta.variant} className="shrink-0">
            <Icon size={12} />
            {meta.label}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <DimDot label="引文" ok={claim.dims.citation} />
          <DimDot label="语义" ok={claim.dims.semantic} />
          <DimDot label="覆盖" ok={claim.dims.coverage} />
          <DimDot label="跨文" ok={claim.dims.crossPaper} />
          <ChevronDown size={14} className={cn('ml-auto text-t3 transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-200', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="space-y-2 border-t border-line/40 px-4 py-3">
            {claim.note && (
              <div className="rounded-lg bg-info px-3 py-2 text-[12.5px] leading-5 text-info-fg">{claim.note}</div>
            )}
            {claim.sources.map((s, i) => (
              <div key={i} className="rounded-lg bg-page px-3 py-2">
                <div className="text-[13px] text-t1">
                  <FileText size={13} className="mr-1.5 inline text-t3" />
                  {s.paperId} <span className="text-t3">{s.locator}</span>
                </div>
                <div className="mt-0.5 font-mono text-[12px] text-t3">KG 链：{s.kgPath}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 文档式分节：编号 + 图标 + 标题 + 来源产物标签
function Section({ id, no, icon: Icon, title, source, children }: {
  id: string; no: number; icon: typeof FileQuestion; title: string; source?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{no}</span>
          <Icon size={15} className="translate-y-[3px] shrink-0 text-t3" />
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {source && <SourceTag file={source} />}
        </div>
        <div className="mt-3.5">{children}</div>
      </Card>
    </section>
  );
}

function Bullets({ items, icon: Icon, tone }: { items: string[]; icon: typeof CheckCircle2; tone: 'in' | 'out' }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-[13.5px] leading-5 text-t2">
          <Icon size={14} className={cn('mt-0.5 shrink-0', tone === 'in' ? 'text-ok' : 'text-t3')} />
          {t}
        </li>
      ))}
    </ul>
  );
}

// 粘滞分节导航
function StickyNav({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <nav className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-line/60 bg-page/95 px-1 py-2 backdrop-blur">
      {items.map(([id, label], i) => (
        <button
          key={id}
          type="button"
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] text-t2 transition-colors hover:bg-black/5 hover:text-t1"
        >
          <span className="font-mono text-[11px] text-t3">{i + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}

// 答案与核查（W4 产出）
function AnswerSection({ no, bundle }: { no: number; bundle: NonNullable<Awaited<ReturnType<typeof getRQBundle>>> }) {
  const [filter, setFilter] = useState<'ALL' | ClaimStatus>('ALL');
  const counts = {
    all: bundle.claims.length,
    verified: bundle.claims.filter((c) => c.status === 'verified').length,
    needs_revision: bundle.claims.filter((c) => c.status === 'needs_revision').length,
    should_remove: bundle.claims.filter((c) => c.status === 'should_remove').length,
  };
  const claims = bundle.claims.filter((c) => filter === 'ALL' || c.status === filter);
  return (
    <Section id="s-answer" no={no} icon={MessageSquareText} title="答案与核查" source="W4 rq_answer.json">
      <div className="rounded-lg border border-line/60 p-4">
        <div className="text-[13px] font-medium">综合答案（overall_answer）</div>
        <div className="mt-2">
          {bundle.overallAnswer
            ? <AnswerText text={bundle.overallAnswer} />
            : <p className="text-[13px] text-t3">尚未生成（W4 未运行）。</p>}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-[13.5px] font-medium">Key Claims</span>
        {(['ALL', 'verified', 'needs_revision', 'should_remove'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[12px] transition-colors',
              filter === f ? 'bg-ink text-white' : 'text-t2 hover:bg-black/5',
            )}
          >
            {f === 'ALL' ? `全部 ${counts.all}` : `${claimStatusMeta[f].label} ${counts[f]}`}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {claims.map((c, i) => (
          <ClaimRow key={c.id} claim={c} index={i} />
        ))}
        {claims.length === 0 && <p className="text-[13px] text-t3">暂无 claims（W4 未运行）。</p>}
      </div>
    </Section>
  );
}

const SUB_NAV = [
  ['s-summary', 'RQ 简述'],
  ['s-why', '选择原因'],
  ['s-scope', '包含内容'],
  ['s-query', '查询计划'],
  ['s-evidence', '使用证据'],
  ['s-gaps', '修订与缺陷'],
  ['s-answer', '答案与核查'],
] as const;

const MACRO_NAV = [
  ['s-summary', 'Macro 简述'],
  ['s-decompose', '分解逻辑'],
  ['s-subs', 'Sub-RQ 分解'],
  ['s-evidence', '汇总证据'],
  ['s-synthesis', '怎么综合'],
  ['s-gaps', '缺陷'],
  ['s-answer', '答案与核查'],
] as const;

// ---- Sub 专页 ----
function SubPage({ sub, macro, bundle }: { sub: SubRQ; macro: MacroRQ; bundle: NonNullable<Awaited<ReturnType<typeof getRQBundle>>> }) {
  const byId = useMemo(() => new Map(bundle.evidencePapers.map((p) => [p.id, p])), [bundle]);
  const rows = sub.paperIds.map((id) => ({ id, paper: byId.get(id) }));

  return (
    <div className="space-y-5">
      {/* 头部：真实 ID + 章节号 + 冻结状态 */}
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <Gauge score={sub.score} level={sub.level} size={84} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-t3">
            <Link
              to={`../${macro.id}`}
              className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
              title={`返回 ${macro.id} 专页`}
            >
              {macro.id}
            </Link>
            <span>· Answerability</span>
            <span>· §{sub.section}</span>
            {sub.suggestedArtifact && <span>· 建议产物 {sub.suggestedArtifact}</span>}
          </div>
          <div className="mt-0.5 text-[15px] font-medium leading-6">{sub.text}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={levelVariant[sub.level]}>{levelLabel[sub.level]}</Badge>
            {bundle.matrix && (
              <Badge variant="ok"><Lock size={12} /> 已冻结 {bundle.matrix.frozenAt}</Badge>
            )}
          </div>
          <div className="mt-1.5 text-[12px] text-t3">归属 {macro.id}：{macro.text}</div>
        </div>
        <div className="ml-auto flex gap-6">
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{sub.paperIds.length}</div>
            <div className="text-[12px] text-t3">冻结论文</div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{sub.kgNodeCount}<span className="text-[14px] text-t3">/{sub.kgEdgeCount}</span></div>
            <div className="text-[12px] text-t3">KG 节点/边</div>
          </div>
        </div>
      </Card>

      <StickyNav items={SUB_NAV} />

      {/* 1 RQ 简述 ← design_report.md */}
      <Section id="s-summary" no={1} icon={FileQuestion} title="RQ 简述" source={SRC.design}>
        <p className="text-[14px] leading-[24px] text-t1">
          {sub.summary ?? `${sub.text}——该 RQ 的简述尚未生成（W3-P2 RQ Designer 产出）。`}
        </p>
      </Section>

      {/* 2 选择原因 ← gap_summary.md + design_report.md */}
      <Section id="s-why" no={2} icon={Compass} title="选择原因" source={SRC.gap}>
        {sub.motivation ? (
          <div>
            <div className="text-[12.5px] font-medium text-t3">回应的 Gap（W3-P1 Survey Gap Analyzer）</div>
            <p className="mt-1.5 text-[13.5px] leading-[22px] text-t1">{sub.motivation}</p>
          </div>
        ) : (
          <p className="text-[13px] text-t3">选择原因尚未生成。</p>
        )}
        {sub.roleInSurvey && (
          <div className="mt-4 rounded-lg bg-page px-4 py-3">
            <div className="text-[12.5px] font-medium text-t3">在综述中的角色</div>
            <p className="mt-1.5 text-[13.5px] leading-[22px] text-t1">{sub.roleInSurvey}</p>
          </div>
        )}
      </Section>

      {/* 3 包含内容 ← design_report.md */}
      <Section id="s-scope" no={3} icon={ListChecks} title="包含内容" source={SRC.design}>
        {sub.definition && <p className="text-[13.5px] leading-[22px] text-t1">{sub.definition}</p>}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {sub.includedScope && sub.includedScope.length > 0 && (
            <div className="rounded-lg border border-line/60 p-3.5">
              <div className="text-[12.5px] font-medium text-ok">纳入</div>
              <div className="mt-2"><Bullets items={sub.includedScope} icon={CheckCircle2} tone="in" /></div>
            </div>
          )}
          {sub.excludedScope && sub.excludedScope.length > 0 && (
            <div className="rounded-lg border border-line/60 p-3.5">
              <div className="text-[12.5px] font-medium text-t3">排除（及去向）</div>
              <div className="mt-2"><Bullets items={sub.excludedScope} icon={XCircle} tone="out" /></div>
            </div>
          )}
        </div>
      </Section>

      {/* 4 查询计划 ← rq_query_registry.json */}
      <Section id="s-query" no={4} icon={Search} title="查询计划" source={SRC.registry}>
        {sub.query ? (
          <>
            {sub.query.queryIntent && <p className="text-[13.5px] leading-[22px] text-t1">{sub.query.queryIntent}</p>}
            {sub.query.focusTerms && sub.query.focusTerms.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-t3">focus_terms</span>
                {sub.query.focusTerms.map((t) => (
                  <span key={t} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[12px] text-t2">{t}</span>
                ))}
              </div>
            )}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-line/60 p-3.5">
                <div className="text-[12.5px] font-medium text-t3">目标节点 / 边类型</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...(sub.query.nodeTypes ?? []).map((t) => `节点:${t}`), ...(sub.query.edgeTypes ?? []).map((t) => `边:${t}`)].map((t) => (
                    <span key={t} className="rounded bg-page px-2 py-0.5 font-mono text-[12px] text-t2">{t}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-line/60 p-3.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-t3">
                  <Route size={13} />
                  候选图路径
                </div>
                <ul className="mt-2 space-y-1.5">
                  {(sub.query.candidatePaths ?? []).map((p) => (
                    <li key={p} className="font-mono text-[12px] leading-4 text-t2">{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-t3">查询计划尚未生成（W3-P3 Graph Query Translation 产出）。</p>
        )}
      </Section>

      {/* 5 使用证据 ← rq_evidence_matrix.json */}
      <Section id="s-evidence" no={5} icon={Database} title="使用证据" source={SRC.matrix}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={levelVariant[sub.level]}>{levelLabel[sub.level]} {sub.score.toFixed(2)}</Badge>
          <span className="text-[13px] text-t2">{sub.paperIds.length} 篇冻结论文 · {sub.kgNodeCount} KG 节点 · {sub.kgEdgeCount} KG 边</span>
          {bundle.matrix && <Badge variant="ok"><Lock size={12} /> 冻结集合有效</Badge>}
        </div>
        <ul className="mt-3 space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.id} className="anim-rise flex items-baseline gap-2 rounded-lg bg-page px-3 py-2 text-[13px]" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <span className="shrink-0 font-mono text-[11px] text-t3">[{i + 1}]</span>
              {r.paper ? (
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-t1" title={r.paper.title}>{r.paper.title}</span>
                    <span className="shrink-0 text-[12px] text-t3">{r.paper.venue} {r.paper.year}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-t3">
                    {r.paper.authors && <span className="truncate" title={r.paper.authors}>{r.paper.authors}</span>}
                    {r.paper.arxivId && <span className="font-mono">arXiv:{r.paper.arxivId}</span>}
                    {r.paper.doi && (
                      <a className="font-mono text-info-fg hover:underline" href={`https://doi.org/${r.paper.doi}`} target="_blank" rel="noreferrer">
                        DOI:{r.paper.doi}
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-t3">{r.id}</span>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="text-[13px] text-t3">矩阵中无该 RQ 的冻结条目。</li>}
        </ul>
      </Section>

      {/* 6 修订与缺陷 ← rq_reflection_log.md */}
      <Section id="s-gaps" no={6} icon={AlertTriangle} title="修订与缺陷" source={SRC.reflection}>
        {sub.revisionNote ? (
          <div className="rounded-lg border border-warn-fg/30 bg-warn/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn-fg">
              <GitBranch size={13} />
              修订循环记录（W3-P4 Reflection Loop）
            </div>
            <p className="mt-1.5 text-[13px] leading-5 text-t2">{sub.revisionNote}</p>
          </div>
        ) : (
          <p className="text-[13px] text-t2">无修订记录（一次通过 Answerability 验证）。</p>
        )}
        {bundle.evidenceGaps.length > 0 && (
          <div className="mt-3">
            <div className="text-[12.5px] font-medium text-t3">证据池全局缺口</div>
            <ul className="mt-1.5 space-y-1">
              {bundle.evidenceGaps.map((g) => (
                <li key={g} className="flex gap-2 text-[12.5px] leading-4 text-t2">
                  <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn-fg" />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 7 答案与核查 */}
      <AnswerSection no={7} bundle={bundle} />
    </div>
  );
}

// ---- Macro 专页 ----
function MacroPage({ macro, bundle }: { macro: MacroRQ; bundle: NonNullable<Awaited<ReturnType<typeof getRQBundle>>> }) {
  const avgScore = macro.subs.reduce((n, s) => n + s.score, 0) / Math.max(macro.subs.length, 1);
  const avgLevel = avgScore >= 0.85 ? 'strong' : avgScore >= 0.45 ? 'weak' : 'blocked';
  const totalKgNodes = macro.subs.reduce((n, s) => n + s.kgNodeCount, 0);
  const totalKgEdges = macro.subs.reduce((n, s) => n + s.kgEdgeCount, 0);

  // 汇总证据：各 Sub 冻结集合去重合并
  const unionPapers = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const s of macro.subs) for (const pid of s.paperIds) if (!seen.has(pid)) { seen.add(pid); ids.push(pid); }
    return ids;
  }, [macro]);
  const byId = useMemo(() => new Map(bundle.evidencePapers.map((p) => [p.id, p])), [bundle]);

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <Gauge score={avgScore} level={avgLevel} size={84} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-t3">
            <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{macro.id}</span>
            <span>· Macro-RQ（Sub 均值）</span>
            {macro.chapter && <span>· {macro.chapter}</span>}
          </div>
          <div className="mt-0.5 text-[15px] font-medium leading-6">{macro.text}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={levelVariant[avgLevel]}>{levelLabel[avgLevel]}（均值）</Badge>
            {bundle.matrix && (
              <Badge variant="ok"><Lock size={12} /> 证据矩阵已冻结 {bundle.matrix.frozenAt}</Badge>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-6">
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{macro.subs.length}</div>
            <div className="text-[12px] text-t3">Sub-RQ</div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{unionPapers.length}</div>
            <div className="text-[12px] text-t3">去重证据论文</div>
          </div>
        </div>
      </Card>

      <StickyNav items={MACRO_NAV} />

      {/* 1 Macro 简述 ← design_report.md */}
      <Section id="s-summary" no={1} icon={FileQuestion} title="Macro 简述" source={SRC.design}>
        <p className="text-[14px] leading-[24px] text-t1">
          {macro.summary ?? `${macro.text}——该 Macro 的简述尚未生成（W3-P2 产出）。`}
        </p>
      </Section>

      {/* 2 分解逻辑 ← design_report.md */}
      <Section id="s-decompose" no={2} icon={GitMerge} title="分解逻辑" source={SRC.design}>
        <p className="text-[13.5px] leading-[22px] text-t1">
          {macro.decompositionNote ?? '分解逻辑尚未生成。'}
        </p>
        {macro.role && (
          <div className="mt-4 rounded-lg bg-page px-4 py-3">
            <div className="text-[12.5px] font-medium text-t3">在综述中的角色</div>
            <p className="mt-1.5 text-[13.5px] leading-[22px] text-t1">{macro.role}</p>
          </div>
        )}
      </Section>

      {/* 3 Sub-RQ 分解 */}
      <Section id="s-subs" no={3} icon={Layers} title="Sub-RQ 分解" source={SRC.matrix}>
        <div className="divide-y divide-line/40">
          {macro.subs.map((s) => (
            <Link key={s.id} to={`../${s.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-black/[0.03]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 text-[12px] text-t3">{s.id}</span>
                <span className="truncate text-[14px] text-t1" title={s.text}>{s.text}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[12px] text-t3">§{s.section}</span>
                <Badge variant={levelVariant[s.level]}>{levelLabel[s.level]} {s.score.toFixed(2)}</Badge>
                <span className="text-[12px] text-t3">{s.paperIds.length} 篇</span>
                <ChevronRight size={15} className="text-t3" />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* 4 汇总证据 ← rq_evidence_matrix.json */}
      <Section id="s-evidence" no={4} icon={Database} title="汇总证据" source={SRC.matrix}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-t2">{unionPapers.length} 篇去重后论文 · {totalKgNodes} KG 节点 · {totalKgEdges} KG 边（Sub 合计）</span>
          {bundle.matrix && <Badge variant="ok"><Lock size={12} /> 冻结集合有效</Badge>}
        </div>
        <ul className="mt-3 space-y-1.5">
          {unionPapers.map((id, i) => {
            const p = byId.get(id);
            return (
              <li key={id} className="anim-rise flex items-baseline gap-2 rounded-lg bg-page px-3 py-2 text-[13px]" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                <span className="shrink-0 font-mono text-[11px] text-t3">[{i + 1}]</span>
                {p ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-t1" title={p.title}>{p.title}</span>
                    <span className="shrink-0 text-[12px] text-t3">{p.venue} {p.year}</span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-t3">{id}</span>
                )}
              </li>
            );
          })}
          {unionPapers.length === 0 && <li className="text-[13px] text-t3">证据矩阵中暂无该 Macro 下 Sub 的条目。</li>}
        </ul>
      </Section>

      {/* 5 怎么综合 ← design_report.md */}
      <Section id="s-synthesis" no={5} icon={CheckCircle2} title="怎么综合" source={SRC.design}>
        <p className="text-[13.5px] leading-[22px] text-t1">
          {macro.synthesisPlan ?? '综合策略尚未生成。'}
        </p>
      </Section>

      {/* 6 缺陷 */}
      <Section id="s-gaps" no={6} icon={AlertTriangle} title="Macro 层缺陷">
        {macro.deficiencies && macro.deficiencies.length > 0 ? (
          <ul className="space-y-1.5">
            {macro.deficiencies.map((g) => (
              <li key={g} className="flex gap-2 text-[13.5px] leading-5 text-t2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn-fg" />
                {g}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-t3">未登记 Macro 层缺陷。</p>
        )}
      </Section>

      {/* 7 答案与核查 */}
      <AnswerSection no={7} bundle={bundle} />
    </div>
  );
}

// RQ 专页路由：rqId 命中 Sub（RQ1.1）→ Sub 专页；命中 Macro（RQ1）→ Macro 专页
export function RqDetailPage() {
  const { projectId = '', rqId = '' } = useParams();
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getRQBundle>>>(null);

  useEffect(() => {
    let alive = true;
    getRQBundle(projectId).then((b) => alive && setBundle(b));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const resolved = useMemo(() => {
    for (const m of bundle?.macros ?? []) {
      const s = m.subs.find((x) => x.id === rqId);
      if (s) return { kind: 'sub' as const, sub: s, macro: m };
    }
    const m = bundle?.macros.find((x) => x.id === rqId);
    if (m) return { kind: 'macro' as const, sub: undefined, macro: m };
    return { kind: 'none' as const, sub: undefined, macro: undefined };
  }, [bundle, rqId]);

  if (!bundle || resolved.kind === 'none') {
    return (
      <Card className="px-8 py-16 text-center">
        <p className="text-[14px] text-t2">该 RQ 不存在（或 W3 矩阵尚未冻结）</p>
      </Card>
    );
  }

  if (resolved.kind === 'macro') {
    return <MacroPage macro={resolved.macro} bundle={bundle} />;
  }
  return <SubPage sub={resolved.sub} macro={resolved.macro} bundle={bundle} />;
}
