import { useEffect, useMemo, useState } from 'react';
import { X, FileText, Bookmark } from 'lucide-react';
import type { PaperRecord, ScreenStage, PrismaLevel } from '@/types/data';
import { getCorpus } from '@/services/api';
import { useLibrary } from '@/store/library';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const STAGES: ScreenStage[] = ['标题筛选', '摘要筛选', '可获取性', '全文筛选', '质量评估', '已纳入'];

function stageVariantOf(s: ScreenStage): 'neutral' | 'ok' {
  return s === '已纳入' ? 'ok' : 'neutral';
}

export function CorpusPage() {
  const { items: libItems, toggleSave } = useLibrary();
  const savedIdx = useMemo(() => new Set(libItems.map((i) => i.paperIdx)), [libItems]);
  const [data, setData] = useState<{ papers: PaperRecord[]; funnel: PrismaLevel[] } | null>(null);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'ALL' | ScreenStage>('ALL');
  const [active, setActive] = useState<PaperRecord | null>(null);

  useEffect(() => {
    let alive = true;
    getCorpus().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const list = (data?.papers ?? []).filter(
      (p) =>
        (stage === 'ALL' || p.stage === stage) &&
        (p.title.toLowerCase().includes(query.toLowerCase()) || p.authors.toLowerCase().includes(query.toLowerCase())),
    );
    return list;
  }, [data, query, stage]);

  if (!data) return <div className="py-16 text-center text-[13px] text-t3">加载中…</div>;
  const max = Math.max(...data.funnel.map((f) => f.count));

  return (
    <div className="flex gap-6">
      {/* PRISMA 筛选漏斗 */}
      <Card className="h-fit w-60 shrink-0 p-5">
        <div className="text-[14px] font-medium">PRISMA 筛选漏斗</div>
        <div className="mt-4 space-y-3">
          {data.funnel.map((f, i) => (
            <div key={f.stage} className="anim-rise" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-t2">{f.stage}</span>
                <span className="font-semibold tabular-nums">{f.count.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-black/5">
                <div
                  className={cn('h-2 rounded-full', i === data.funnel.length - 1 ? 'bg-ok' : 'bg-ink/80')}
                  style={{ width: `${Math.max((f.count / max) * 100, 2)}%` }}
                />
              </div>
              {f.note && <div className="mt-0.5 text-[11px] text-t3">{f.note}</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* 论文表 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <Input placeholder="搜索标题 / 作者…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as 'ALL' | ScreenStage)}
            className="h-10 rounded-lg border border-line bg-card px-3 text-[13px] text-t2 focus:border-ink focus:outline-none"
            aria-label="筛选阶段"
          >
            <option value="ALL">全部阶段</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <Card className="mt-4 overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line/60 text-[12px] uppercase tracking-wide text-t3">
                <th className="px-4 py-2.5 font-medium">标题</th>
                <th className="px-2 py-2.5 font-medium">作者</th>
                <th className="px-2 py-2.5 font-medium">年份</th>
                <th className="px-2 py-2.5 font-medium">发表处</th>
                <th className="px-2 py-2.5 font-medium">引用</th>
                <th className="px-2 py-2.5 font-medium">筛选阶段</th>
                <th className="px-4 py-2.5 font-medium">收藏</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => {
                const idx = Number(p.id.replace('paper-', '')) - 1;
                const saved = savedIdx.has(idx);
                return (
                <tr
                  key={p.id}
                  className="anim-rise cursor-pointer border-b border-line/40 last:border-0 transition-colors hover:bg-black/[0.03]"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  onClick={() => setActive(p)}
                >
                  <td className="max-w-[340px] truncate px-4 py-2.5 font-medium text-t1" title={p.title}>{p.title}</td>
                  <td className="px-2 py-2.5 text-t2">{p.authors}</td>
                  <td className="px-2 py-2.5 tabular-nums text-t2">{p.year}</td>
                  <td className="px-2 py-2.5 text-t2">{p.venue}</td>
                  <td className="px-2 py-2.5 tabular-nums text-t2">{p.citations}</td>
                  <td className="px-2 py-2.5"><Badge variant={stageVariantOf(p.stage)}>{p.stage}</Badge></td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      title={saved ? '从知识库移除' : '收藏到知识库'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSave({ paperIdx: idx, title: p.title, authors: p.authors, venue: p.venue, year: p.year, citations: p.citations });
                      }}
                      className="rounded p-1.5 text-t3 transition-colors hover:bg-black/5"
                    >
                      <Bookmark size={14} className={saved ? 'fill-ink text-ink' : ''} />
                    </button>
                  </td>
                </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-t3">没有匹配的论文</td></tr>
              )}
            </tbody>
          </table>
          <div className="px-4 py-2.5 text-[12px] text-t3">
            Showing {shown.length} out of {data.papers.length} papers
          </div>
        </Card>
      </div>

      {/* 论文详情抽屉（含 Paper Card） */}
      {active && <PaperDrawer paper={active} onClose={() => setActive(null)} />}
    </div>
  );
}

const CARD_TABS = [
  ['problems', '问题'],
  ['methods', '方法'],
  ['datasets', '数据集'],
  ['metrics', '指标'],
  ['limitations', '局限'],
  ['assumptions', '假设'],
] as const;

function PaperDrawer({ paper, onClose }: { paper: PaperRecord; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof CARD_TABS)[number][0]>('problems');
  const { items: libItems, toggleSave } = useLibrary();
  const idx = Number(paper.id.replace('paper-', '')) - 1;
  const saved = libItems.some((i) => i.paperIdx === idx);
  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/45" style={{ animation: 'rise .15s ease-out' }} onClick={onClose} />
      <aside
        className="absolute right-0 top-0 h-full w-[460px] overflow-y-auto border-l border-line bg-card shadow-s3"
        style={{ animation: 'slideIn .2s ease-out' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/60 p-5">
          <div>
            <h3 className="text-[16px] font-semibold leading-6">{paper.title}</h3>
            <div className="mt-1.5 text-[12px] text-t3">
              {paper.authors} · {paper.venue} {paper.year} · 被引 {paper.citations}
            </div>
            <Badge variant={stageVariantOf(paper.stage)} className="mt-2">{paper.stage}</Badge>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-t3 hover:bg-black/5 hover:text-t1" title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-line/60 p-5">
          <div className="text-[13px] font-medium text-t2">摘要</div>
          <p className="mt-1.5 text-[13px] leading-5 text-t2">{paper.abstract}</p>
        </div>

        {/* Paper Card：六类结构化对象（W2 产出） */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <FileText size={14} className="text-t3" />
            Paper Card · 结构化对象
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {CARD_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                  tab === key ? 'bg-ink text-white' : 'text-t2 hover:bg-black/5',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {(paper.card[tab] as string[]).map((item) => (
              <li key={item} className="flex gap-2 rounded-lg bg-page px-3 py-2 text-[13px] text-t1">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/70" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line/60 p-5">
          <div className="flex items-center gap-2">
            <Button
              variant={saved ? 'secondary' : 'primary'}
              size="sm"
              onClick={() =>
                toggleSave({ paperIdx: idx, title: paper.title, authors: paper.authors, venue: paper.venue, year: paper.year, citations: paper.citations })
              }
            >
              <Bookmark size={13} className={saved ? 'fill-ink' : ''} />
              {saved ? '已在知识库' : '收藏到知识库'}
            </Button>
            <span className="text-[12px] text-t3">PDF 全文预览在语料库深化阶段接入</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
