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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [data, setData] = useState<{ outline: OutlineNode[]; reviews: { round: number; date: string; verdict: string; improvements: string[] }[] } | null>(null);

  useEffect(() => {
    let alive = true;
    getReport(projectId).then((d) => alive && setData(d)).catch(() => alive && setData({ outline: [], reviews: [] }));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // PDF 需带 Authorization 拉取 → blob URL（iframe/open 无法自定义 header）
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const API = import.meta.env.VITE_API_BASE ?? '/api';
    const token = localStorage.getItem('as.token') ?? '';
    setPdfState('loading');
    fetch(`${API}/projects/${projectId}/survey-pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (r.status === 404) { setPdfState('missing'); throw new Error('missing'); }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        if (!alive) { URL.revokeObjectURL(URL.createObjectURL(b)); return; }
        objectUrl = URL.createObjectURL(b);
        setPdfUrl(objectUrl);
        setPdfState('ready');
      })
      .catch(() => { if (alive) setPdfState('error'); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
        {/* 综述论文 PDF 预览（W5-P4 tectonic 编译产物） */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5">
            <span className="text-[13px] font-medium">综述论文 main.pdf（真实编译产物）</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pdfState !== 'ready'}
              onClick={() => pdfUrl && window.open(pdfUrl, '_blank')}
            >
              <Download size={13} />
              新窗口打开 / 下载
            </Button>
          </div>
          {pdfState === 'loading' && (
            <div className="flex h-[760px] items-center justify-center text-[13px] text-t3">PDF 加载中…</div>
          )}
          {pdfState === 'missing' && (
            <div className="flex h-[760px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-[14px] text-t2">综述 PDF 尚未编译</p>
              <p className="max-w-sm text-[12.5px] leading-5 text-t3">
                到流水线页 W5 标签确认 W5-P4（编译综述 PDF）已完成——未安装 tectonic 时该阶段会跳过。
              </p>
            </div>
          )}
          {pdfState === 'ready' && pdfUrl && (
            <iframe src={`${pdfUrl}#view=FitH`} className="h-[760px] w-full border-0 bg-black/5" title="Survey PDF Preview" />
          )}
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
