import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bot, AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { getKg, USE_MOCK, getW4Reports, fetchW4ReportHtml, type W4Report } from '@/services/api';
import type { KgGraphData } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// KG 分析 Agent：真实 W4-P1 产物展示（每子问题一份 HTML 小论文，手风琴内联渲染）
export function AgentPage() {
  const { projectId = '' } = useParams();
  const [reports, setReports] = useState<W4Report[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [htmlCache, setHtmlCache] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [kg, setKg] = useState<KgGraphData | null>(null);

  useEffect(() => {
    let alive = true;
    if (USE_MOCK) return;
    getW4Reports(projectId)
      .then((r) => { if (alive) setReports(r); })
      .catch(() => {});
    getKg(projectId).then((k) => alive && setKg(k)).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const toggle = async (r: W4Report) => {
    setBusy(r.dir);
    try {
      const html = htmlCache[r.dir] ?? (await fetchW4ReportHtml(projectId, r.dir));
      setHtmlCache((c) => ({ ...c, [r.dir]: html }));
      setExpanded(r.dir);
    } finally { setBusy(''); }
  };

  const hasReports = (reports?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold leading-8">KG 分析 Agent</h1>
        <p className="mt-1 text-[13px] text-t3">
          LLM 驱动的知识图谱深度分析：37 个分析 Skill 自动选型，逐子问题多轮工具调用，产出结构化 HTML 报告。
        </p>
      </div>

      {/* KG 底座状态 */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <Bot size={16} className="text-t3" />
          数据底座
        </div>
        {kg ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-[12.5px] text-t2">
            <Badge variant="ok" withDot>KG 已接入</Badge>
            <span>{kg.paperCount} 篇论文 · {kg.nodes.length} 概念节点 · {kg.edges.length} 关系边</span>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-warn-fg/30 bg-warn/10 px-3 py-2 text-[12.5px] text-t2">
            <AlertTriangle size={14} className="text-warn-fg" />
            该项目还没有 W2 知识图谱。
            <Link to={`/projects/${projectId}/kg`} className="text-info-fg hover:underline">去 KG 页 →</Link>
          </div>
        )}
      </Card>

      {/* Agent 报告列表 */}
      {!hasReports && reports !== null && (
        <Card className="p-8 text-center">
          <p className="text-[14px] text-t2">还没有 Agent 分析报告</p>
          <p className="mt-1 text-[13px] text-t3">在流水线页启动 W2 后，Agent 将对每个子问题产出一份 HTML 分析报告，此处展示。</p>
        </Card>
      )}
      {hasReports && (
        <div className="space-y-3">
          {reports!.map((r) => (
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
                {expanded === r.dir
                  ? <ChevronDown size={15} className="shrink-0 text-t3" />
                  : <ChevronRight size={15} className="shrink-0 text-t3" />}
              </button>
              {expanded === r.dir && (
                <div className="border-t border-line/40 bg-white">
                  <div className="flex items-center justify-between px-4 py-2">
                    <span className="text-[11.5px] leading-4 text-t2">
                      {r.skill_reason && <>选型依据：{r.skill_reason}</>}
                    </span>
                    <a
                      href={`data:text/html;charset=utf-8,${encodeURIComponent(htmlCache[r.dir] ?? '')}`}
                      target="_blank" rel="noopener noreferrer"
                      className="ml-2 shrink-0 text-info-fg hover:underline"
                    >
                      <ExternalLink size={13} className="inline mr-0.5" />新窗口
                    </a>
                  </div>
                  <iframe
                    title={r.rq_id}
                    srcDoc={htmlCache[r.dir] ?? ''}
                    className="w-full border-0"
                    style={{ height: '75vh' }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
