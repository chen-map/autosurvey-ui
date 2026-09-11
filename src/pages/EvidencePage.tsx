import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, CheckCircle2, AlertTriangle, XCircle, ChevronDown, FileText } from 'lucide-react';
import type { Claim, ClaimStatus } from '@/types/data';
import { getRQBundle } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Gauge, levelVariant, levelLabel } from './RqPage';

const claimStatusMeta: Record<ClaimStatus, { label: string; variant: 'ok' | 'warn' | 'danger'; icon: typeof CheckCircle2 }> = {
  verified: { label: 'verified', variant: 'ok', icon: CheckCircle2 },
  needs_revision: { label: 'needs_revision', variant: 'warn', icon: AlertTriangle },
  should_remove: { label: 'should_remove', variant: 'danger', icon: XCircle },
};

// 带 [n] 引用角标的答案渲染
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
      {/* 展开追溯链（grid-rows 过渡，200ms） */}
      <div
        className={cn('grid transition-[grid-template-rows] duration-200', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
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

export function EvidencePage() {
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

  const sub = useMemo(() => bundle?.macros.flatMap((m) => m.subs).find((s) => s.id === rqId), [bundle, rqId]);
  const claims = useMemo(
    () => (bundle?.claims ?? []).filter((c) => filter === 'ALL' || c.status === filter),
    [bundle, filter],
  );

  if (!bundle || !sub) {
    return (
      <Card className="px-8 py-16 text-center">
        <p className="text-[14px] text-t2">该 Sub-RQ 的证据工作记忆尚未生成（W4 未运行）</p>
      </Card>
    );
  }

  const counts = {
    all: bundle.claims.length,
    verified: bundle.claims.filter((c) => c.status === 'verified').length,
    needs_revision: bundle.claims.filter((c) => c.status === 'needs_revision').length,
    should_remove: bundle.claims.filter((c) => c.status === 'should_remove').length,
  };

  return (
    <div className="space-y-5">
      {/* 头部：分卡 + 冻结状态 */}
      <Card className="flex flex-wrap items-center gap-6 p-5">
        <Gauge score={sub.score} level={sub.level} size={84} />
        <div className="min-w-0">
          <div className="text-[12px] text-t3">{sub.id} · Answerability</div>
          <div className="mt-0.5 text-[15px] font-medium leading-6">{sub.text}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge variant={levelVariant[sub.level]}>{levelLabel[sub.level]}</Badge>
            {bundle.matrix && (
              <Badge variant="ok">
                <Lock size={12} />
                已冻结 {bundle.matrix.frozenAt}
              </Badge>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-6">
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">{bundle.evidencePapers.length}</div>
            <div className="text-[12px] text-t3">证据论文（≥5 ✓）</div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-semibold leading-7">
              {counts.verified}<span className="text-[14px] text-t3">/{counts.all}</span>
            </div>
            <div className="text-[12px] text-t3">claims 验证通过</div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* 左：综合答案 + claims */}
        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <div className="text-[14px] font-medium">综合答案（overall_answer）</div>
            <div className="mt-2">
              <AnswerText text={bundle.overallAnswer} />
            </div>
          </Card>

          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">Key Claims</span>
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

          <div className="space-y-3">
            {claims.map((c, i) => (
              <ClaimRow key={c.id} claim={c} index={i} />
            ))}
          </div>
        </div>

        {/* 右：证据池 + 缺口 */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-[13px] font-medium">证据池（{bundle.evidencePapers.length} 篇）</div>
            <ul className="mt-2.5 space-y-2">
              {bundle.evidencePapers.map((p, i) => (
                <li key={p.id} className="anim-rise text-[12.5px] leading-4" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                  <span className="mr-1.5 font-mono text-[11px] text-t3">[{i + 1}]</span>
                  <span className="text-t1">{p.title}</span>
                  <span className="block pl-6 text-t3">{p.venue} {p.year}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4">
            <div className="text-[13px] font-medium">Evidence Gaps（{bundle.evidenceGaps.length}）</div>
            <ul className="mt-2.5 space-y-1.5">
              {bundle.evidenceGaps.map((g) => (
                <li key={g} className="flex gap-2 text-[12.5px] leading-4 text-t2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn-fg" />
                  {g}
                </li>
              ))}
              {bundle.evidenceGaps.length === 0 && <li className="text-[12.5px] text-t3">无明显缺口</li>}
            </ul>
          </Card>

          <Card className="p-4">
            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-t2">综合答案 Prompt 模板（讲解用）</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-page p-3 font-mono text-[11.5px] leading-4 text-t2">{`角色：学术综述综合器
输入：rq_id + evidence_pool（冻结矩阵恢复）
规则：
  1. 仅使用证据池内论文，禁止外部知识
  2. 每条 key_claim 标注 [paper_n]
  3. 冲突结论显式呈现，不写成定论
输出：overall_answer(500-800字) + key_claims`}</pre>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
