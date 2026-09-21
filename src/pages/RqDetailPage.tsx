import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Lock, CheckCircle2, AlertTriangle, XCircle, ChevronDown, FileText,
  FileQuestion, GitBranch, Compass, ListChecks, Route, Database, Wrench, MessageSquareText,
} from 'lucide-react';
import type { Claim, ClaimStatus, EvidencePaper, RQType } from '@/types/data';
import { getRQBundle } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Gauge, levelVariant, levelLabel } from './RqPage';

export const rqTypeLabel: Record<RQType, string> = {
  descriptive: '描述型',
  comparative: '比较型',
  causal: '因果型',
  trend: '趋势型',
  evaluative: '评估型',
};

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

// 文档式分节：编号 + 图标 + 标题 + 侧注
function Section({ id, no, icon: Icon, title, note, children }: {
  id: string; no: number; icon: typeof FileQuestion; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{no}</span>
          <Icon size={15} className="translate-y-[3px] shrink-0 text-t3" />
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {note && <span className="text-[12px] text-t3">{note}</span>}
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

// ---- 页面 ----

const NAV = [
  ['s-summary', 'RQ 简述'],
  ['s-why', '选择原因'],
  ['s-scope', '包含内容'],
  ['s-method', '怎么分析'],
  ['s-evidence', '使用证据'],
  ['s-gaps', '当前缺陷'],
  ['s-answer', '答案与核查'],
] as const;

export function RqDetailPage() {
  const { projectId = '', rqId = '' } = useParams();
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getRQBundle>>>(null);
  const [filter, setFilter] = useState<'ALL' | ClaimStatus>('ALL');

  useEffect(() => {
    let alive = true;
    getRQBundle(projectId).then((b) => alive && setBundle(b));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const { sub, macro } = useMemo(() => {
    for (const m of bundle?.macros ?? []) {
      const s = m.subs.find((x) => x.id === rqId);
      if (s) return { sub: s, macro: m };
    }
    return { sub: undefined, macro: undefined };
  }, [bundle, rqId]);

  // 使用证据：冻结矩阵该 Sub-RQ 的论文集合 → 解析详情
  const evidence = useMemo(() => {
    if (!bundle || !sub) return { entry: undefined as typeof bundle extends null ? never : { papers: string[] } | undefined, rows: [] as (EvidencePaper | undefined)[] };
    const entry = bundle.matrix?.entries.find((e) => e.subRqId === sub.id);
    const byId = new Map(bundle.evidencePapers.map((p) => [p.id, p]));
    return { entry, rows: (entry?.papers ?? []).map((id) => byId.get(id)) };
  }, [bundle, sub]);

  const claims = useMemo(
    () => (bundle?.claims ?? []).filter((c) => filter === 'ALL' || c.status === filter),
    [bundle, filter],
  );

  if (!bundle || !sub || !macro) {
    return (
      <Card className="px-8 py-16 text-center">
        <p className="text-[14px] text-t2">该 Sub-RQ 不存在（或 W3 矩阵尚未冻结）</p>
      </Card>
    );
  }

  const counts = {
    all: bundle.claims.length,
    verified: bundle.claims.filter((c) => c.status === 'verified').length,
    needs_revision: bundle.claims.filter((c) => c.status === 'needs_revision').length,
    should_remove: bundle.claims.filter((c) => c.status === 'should_remove').length,
  };

  const goNav = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const frozenIds = evidence.entry?.papers ?? [];

  return (
    <div className="space-y-5">
      {/* 头部：身份 + 分卡 + 元信息 */}
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <Gauge score={sub.score} level={sub.level} size={84} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-t3">
            <span>{sub.id}</span>
            <span>·</span>
            <span>Answerability</span>
            {sub.rqType && <Badge variant="neutral">{rqTypeLabel[sub.rqType]}</Badge>}
            {sub.chapter && <span>· {sub.chapter}</span>}
          </div>
          <div className="mt-0.5 text-[15px] font-medium leading-6">{sub.text}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={levelVariant[sub.level]}>{levelLabel[sub.level]}</Badge>
            {bundle.matrix && (
              <Badge variant="ok">
                <Lock size={12} />
                已冻结 {bundle.matrix.frozenAt}
              </Badge>
            )}
          </div>
          <div className="mt-1.5 text-[12px] text-t3">归属 {macro.id}：{macro.text}</div>
        </div>
        <div className="ml-auto flex gap-6">
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{sub.paperCount}</div>
            <div className="text-[12px] text-t3">冻结证据（≥5 ✓）</div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">
              {counts.verified}<span className="text-[14px] text-t3">/{counts.all}</span>
            </div>
            <div className="text-[12px] text-t3">claims 验证通过</div>
          </div>
        </div>
      </Card>

      {/* 粘滞分节导航 */}
      <nav className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-line/60 bg-page/95 px-1 py-2 backdrop-blur">
        {NAV.map(([id, label], i) => (
          <button
            key={id}
            type="button"
            onClick={() => goNav(id)}
            className="flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] text-t2 transition-colors hover:bg-black/5 hover:text-t1"
          >
            <span className="font-mono text-[11px] text-t3">{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* 1 RQ 简述 */}
      <Section id="s-summary" no={1} icon={FileQuestion} title="RQ 简述">
        <p className="text-[14px] leading-[24px] text-t1">
          {sub.summary ?? `${sub.text}——该 RQ 的简述尚未生成（W3-P2 RQ 设计产出）。`}
        </p>
      </Section>

      {/* 2 选择原因 */}
      <Section id="s-why" no={2} icon={Compass} title="选择原因" note="为什么单独立这个 RQ">
        {sub.motivation && (
          <div>
            <div className="text-[12.5px] font-medium text-t3">来源 · Gap 分析（W3-P1）</div>
            <p className="mt-1.5 text-[13.5px] leading-[22px] text-t1">{sub.motivation}</p>
          </div>
        )}
        {sub.roleInSurvey && (
          <div className="mt-4 rounded-lg bg-page px-4 py-3">
            <div className="text-[12.5px] font-medium text-t3">在综述中的角色</div>
            <p className="mt-1.5 text-[13.5px] leading-[22px] text-t1">{sub.roleInSurvey}</p>
          </div>
        )}
        {!sub.motivation && !sub.roleInSurvey && (
          <p className="text-[13px] text-t3">选择原因尚未生成。</p>
        )}
      </Section>

      {/* 3 包含内容 */}
      <Section id="s-scope" no={3} icon={ListChecks} title="包含内容" note="口径与边界">
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
        {sub.focusTerms && sub.focusTerms.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-t3">焦点词</span>
            {sub.focusTerms.map((t) => (
              <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-t2">{t}</span>
            ))}
          </div>
        )}
      </Section>

      {/* 4 怎么分析 */}
      <Section id="s-method" no={4} icon={Wrench} title="怎么分析" note={sub.rqType ? `${rqTypeLabel[sub.rqType]}问题 · 答案组织策略` : undefined}>
        {sub.analysisPlan && <p className="text-[13.5px] leading-[22px] text-t1">{sub.analysisPlan}</p>}
        {sub.analysisSteps && sub.analysisSteps.length > 0 && (
          <ol className="mt-3 space-y-1.5">
            {sub.analysisSteps.map((s, i) => (
              <li key={s} className="flex gap-2.5 text-[13.5px] leading-5 text-t2">
                <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-ink font-mono text-[10px] text-white">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        )}
        {sub.kgQueryPaths && sub.kgQueryPaths.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-t3">
              <Route size={13} />
              KG 候选查询路径（每条路径预期拿到什么）
            </div>
            <ul className="mt-2 space-y-2">
              {sub.kgQueryPaths.map((p) => (
                <li key={p.path} className="rounded-lg bg-page px-3 py-2">
                  <div className="font-mono text-[12.5px] text-t1">{p.path}</div>
                  <div className="mt-0.5 text-[12px] text-t3">→ {p.expected}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 5 使用证据 */}
      <Section id="s-evidence" no={5} icon={Database} title="使用证据" note="从冻结矩阵恢复，不重新查询">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={levelVariant[sub.level]}>{levelLabel[sub.level]} {sub.score.toFixed(2)}</Badge>
          <span className="text-[13px] text-t2">{evidence.entry?.papers.length ?? 0} 篇冻结论文</span>
          {evidence.entry ? (
            <Badge variant="ok"><Lock size={12} /> 冻结集合有效</Badge>
          ) : (
            <Badge variant="danger">矩阵中无该 RQ 条目</Badge>
          )}
        </div>
        <ul className="mt-3 space-y-1.5">
          {(evidence.rows.length > 0 ? evidence.rows : frozenIds.map(() => undefined)).map((p, i) => (
            <li key={i} className="anim-rise flex items-baseline gap-2 rounded-lg bg-page px-3 py-2 text-[13px]" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <span className="shrink-0 font-mono text-[11px] text-t3">[{i + 1}]</span>
              {p ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-t1" title={p.title}>{p.title}</span>
                  <span className="shrink-0 text-[12px] text-t3">{p.venue} {p.year}</span>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-t3">{frozenIds[i]}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* 6 当前缺陷 */}
      <Section id="s-gaps" no={6} icon={AlertTriangle} title="具体缺陷" note="证据 / 数据 / 口径层面">
        {sub.deficiencies && sub.deficiencies.length > 0 ? (
          <ul className="space-y-1.5">
            {sub.deficiencies.map((g) => (
              <li key={g} className="flex gap-2 text-[13.5px] leading-5 text-t2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn-fg" />
                {g}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-t3">未登记具体缺陷。</p>
        )}
        {sub.revisionNote && (
          <div className="mt-3 rounded-lg border border-warn-fg/30 bg-warn/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn-fg">
              <GitBranch size={13} />
              修订循环动作（W3-P4）
            </div>
            <p className="mt-1.5 text-[13px] leading-5 text-t2">{sub.revisionNote}</p>
          </div>
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
      <Section id="s-answer" no={7} icon={MessageSquareText} title="答案与核查" note="W4 产出">
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
          {claims.length === 0 && <p className="text-[13px] text-t3">该 RQ 暂无 claims（W4 未运行）。</p>}
        </div>
      </Section>
    </div>
  );
}
