import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { OutlineNode } from '@/types/data';
import { getReport } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

function OutlineTree({ nodes, depth = 0, rqHref }: { nodes: OutlineNode[]; depth?: number; rqHref: (rq: string) => string }) {
  return (
    <ul className={cn(depth > 0 && 'ml-4 border-l border-line/60 pl-3')}>
      {nodes.map((n) => (
        <li key={n.id} className="py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('text-[13.5px]', depth === 0 ? 'font-medium text-t1' : 'text-t2')}>{n.title}</span>
            <span className="shrink-0 text-[11px] text-t3">
              {n.rq && (
                <Link
                  to={rqHref(n.rq)}
                  title={`跳转到 ${n.rq} 的证据页`}
                  className="mr-2 rounded bg-black/5 px-1.5 py-0.5 text-info-fg transition-colors hover:bg-info"
                >
                  {n.rq} →
                </Link>
              )}
              {n.papers} 篇
            </span>
          </div>
          {n.children && <OutlineTree nodes={n.children} depth={depth + 1} rqHref={rqHref} />}
        </li>
      ))}
    </ul>
  );
}

export function ReportPage() {
  const { projectId = '' } = useParams();
  const [data, setData] = useState<{ outline: OutlineNode[]; reviews: { round: number; date: string; verdict: string; improvements: string[] }[] } | null>(null);

  useEffect(() => {
    let alive = true;
    getReport().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (!data) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {/* 大纲树 */}
      <Card className="h-fit p-5">
        <div className="text-[14px] font-medium">综述大纲（章节 → RQ → 论文）</div>
        <p className="mt-1 text-[12px] text-t3">点击章节的 RQ 标记可直接跳转到对应证据页</p>
        <div className="mt-3">
          <OutlineTree
            nodes={data.outline}
            rqHref={(rq) => `/projects/${projectId}/rq/${rq.toLowerCase()}-1`}
          />
        </div>
      </Card>

      <div className="space-y-5">
        {/* PDF 预览（mock：合成论文首页） */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
            <span className="text-[13px] font-medium">main.pdf 预览</span>
            <Button variant="secondary" size="sm">
              <Download size={13} />
              下载 PDF
            </Button>
          </div>
          <div className="flex justify-center bg-black/5 p-6">
            {/* 合成论文首页（真实 PDF 由 W5 产出后经 /report/pdf 提供） */}
            <div className="w-full max-w-[520px] rounded bg-card p-8 shadow-s2">
              <div className="text-center text-[17px] font-bold leading-6">Interpretability of Graph Neural Networks: A Survey</div>
              <div className="mt-2 text-center text-[11px] text-t3">Anonymous · AutoSurvey v3 · 21 pages</div>
              <div className="mt-5 text-[12px] font-semibold">Abstract</div>
              <div className="mt-1 space-y-1.5">
                {[92, 100, 96, 88, 97, 64].map((w, i) => (
                  <div key={i} className="h-2 rounded bg-black/10" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="mt-4 text-[12px] font-semibold">1 Introduction</div>
              <div className="mt-1 space-y-1.5">
                {[100, 94, 98, 70].map((w, i) => (
                  <div key={i} className="h-2 rounded bg-black/10" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="mt-4 rounded border border-dashed border-line px-3 py-2 text-center text-[11px] text-t3">
                Fig. 1 Taxonomy overview（W5-P2 图表能力待后端增强）
              </div>
            </div>
          </div>
        </Card>

        {/* 审查轮次 */}
        <Card className="p-5">
          <div className="text-[14px] font-medium">自动审查改进循环（MAX_IMPROVEMENT_ROUNDS = 2）</div>
          <div className="mt-3 space-y-3">
            {data.reviews.map((r) => (
              <div key={r.round} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {r.verdict === 'accept' ? (
                    <CheckCircle2 size={16} className="text-ok" />
                  ) : (
                    <AlertTriangle size={16} className="text-warn-fg" />
                  )}
                  <div className="mt-1 w-px flex-1 bg-line/60" />
                </div>
                <div className="pb-2">
                  <div className="flex items-center gap-2 text-[13.5px]">
                    <span className="font-medium">轮次 {r.round}</span>
                    <Badge variant={r.verdict === 'accept' ? 'ok' : 'warn'}>
                      {r.verdict === 'accept' ? '通过' : 'needs_revision'}
                    </Badge>
                    <span className="text-[12px] text-t3">{r.date}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {r.improvements.map((im) => (
                      <li key={im} className="text-[13px] text-t2">· {im}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
