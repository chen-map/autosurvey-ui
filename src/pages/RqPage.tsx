import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { AnswerabilityLevel, RQBundle } from '@/types/data';
import { getRQBundle } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

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

  useEffect(() => {
    let alive = true;
    getRQBundle(projectId).then((b) => {
      if (!alive) return;
      setBundle(b);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (!loaded) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;

  // 运行中：W3 未完成，矩阵未冻结
  if (!bundle || bundle.macros.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <Badge variant="info" withDot>W3 进行中</Badge>
        <p className="text-[14px] text-t2">RQ 体系设计与证据矩阵冻结尚未完成</p>
        <p className="max-w-md text-[13px] leading-5 text-t3">
          流水线 W3-P2「RQ 设计」完成后，此处将展示 Macro/Sub 研究问题树、Answerability 评分与已冻结的证据矩阵。
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold">研究问题体系</h2>
          <Badge variant="neutral">{bundle.macros.length} Macro · {bundle.macros.reduce((n, m) => n + m.subs.length, 0)} Sub</Badge>
        </div>
        {bundle.matrix && (
          <Badge variant="ok">
            <Lock size={12} />
            证据矩阵已冻结 · {bundle.matrix.frozenAt}
          </Badge>
        )}
      </div>

      {/* Macro → Sub 树 */}
      <div className="stagger space-y-4">
        {bundle.macros.map((m) => (
          <Card key={m.id} className="p-5">
            <div className="flex items-baseline gap-2.5">
              <span className="rounded bg-ink px-1.5 py-0.5 text-[12px] font-semibold text-white">{m.id}</span>
              <span className="text-[15px] font-medium leading-6">{m.text}</span>
            </div>
            <div className="mt-3 divide-y divide-line/40">
              {m.subs.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="shrink-0 text-[12px] text-t3">{s.id}</span>
                    <span className="truncate text-[14px] text-t1" title={s.text}>{s.text}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={levelVariant[s.level]}>{levelLabel[s.level]} {s.score.toFixed(2)}</Badge>
                    <span className="text-[12px] text-t3">{s.paperCount} 篇</span>
                    <Link
                      to={`${s.id}`}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-[12px] text-t2 transition-colors',
                        'border-line hover:border-ink hover:text-t1',
                      )}
                    >
                      查看证据 →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* 冻结证据矩阵 */}
      {bundle.matrix && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/60 px-5 py-3">
            <span className="text-[14px] font-medium">冻结证据矩阵（Canonical Registry）</span>
            <span className="text-[12px] text-t3">下游 W4/W5 仅从此处恢复论文集合，防证据漂移</span>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line/60 text-[12px] uppercase tracking-wide text-t3">
                <th className="px-5 py-2.5 font-medium">Sub-RQ</th>
                <th className="px-3 py-2.5 font-medium">论文数</th>
                <th className="px-5 py-2.5 font-medium">论文 ID（冻结集合）</th>
              </tr>
            </thead>
            <tbody>
              {bundle.matrix.entries.map((e) => (
                <tr key={e.subRqId} className="border-b border-line/40 last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="text-t3">{e.subRqId}</span>
                    <span className="ml-2 text-t1">{e.subRqText}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-t2">{e.papers.length}</td>
                  <td className="max-w-[380px] truncate px-5 py-2.5 font-mono text-[12px] text-t2" title={e.papers.join(' · ')}>
                    {e.papers.join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
