import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Handle, Position,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import { Maximize2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { buildKgGraph, buildStressGraph, TYPE_COLORS, TYPE_LABELS, EDGE_KIND_LABELS, type KgGraphNode, type KgType } from '@/mock/kg';
import { getCorpus } from '@/services/api';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { PaperRecord } from '@/types/data';

// ---- 自定义节点：论文（黑）与概念（六类色） ----
function PaperNode({ data }: NodeProps) {
  const d = data as unknown as KgGraphNode;
  return (
    <div className="flex flex-col items-center">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-none !bg-transparent" isConnectable={false} />
      <div
        className="h-10 w-10 rounded-full border-2 border-white shadow-s2"
        style={{ background: TYPE_COLORS.paper }}
        title={d.label}
      />
      <div className="mt-1 max-w-[120px] truncate text-center text-[11px] font-medium text-t1">{d.label}</div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-none !bg-transparent" isConnectable={false} />
    </div>
  );
}

function ConceptNode({ data }: NodeProps) {
  const d = data as unknown as KgGraphNode;
  return (
    <div className="flex flex-col items-center">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-none !bg-transparent" isConnectable={false} />
      <div
        className="h-7 w-7 rounded-full border-2 border-white shadow-s1"
        style={{ background: TYPE_COLORS[d.kgType] }}
        title={`${TYPE_LABELS[d.kgType]}：${d.label}`}
      />
      <div className="mt-1 max-w-[100px] truncate text-center text-[10.5px] text-t2">{d.label}</div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-none !bg-transparent" isConnectable={false} />
    </div>
  );
}

const nodeTypes = { paper: PaperNode, concept: ConceptNode };

type Scale = 'demo' | '500' | '1000';

const SCALE_OPTIONS: { value: Scale; label: string; papers?: number }[] = [
  { value: 'demo', label: '演示子集（34 节点）' },
  { value: '500', label: '压力快照：500 论文（≈2500 节点）', papers: 500 },
  { value: '1000', label: '压力快照：1000 论文（≈5000 节点）', papers: 1000 },
];

export function KgPage() {
  const { projectId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const initial = (searchParams.get('stress') as '500' | '1000') ?? null;
  const [scale, setScale] = useState<Scale>(initial ?? 'demo');

  // 图构建计时（implementation-guide §8 大数据实测）
  const { graph, buildMs } = useMemo(() => {
    const t0 = performance.now();
    const papers = scale === 'demo' ? undefined : Number(scale);
    const g = papers ? buildStressGraph(papers) : buildKgGraph();
    return { graph: g, buildMs: Math.round(performance.now() - t0) };
  }, [scale]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges as Edge[]);
  useEffect(() => {
    setNodes(graph.nodes as Node[]);
    setEdges(graph.edges as Edge[]);
  }, [graph, setNodes, setEdges]);

  const [hiddenTypes, setHiddenTypes] = useState<Set<KgType>>(new Set());
  const [onlyContradicts, setOnlyContradicts] = useState(false);
  const [rqHighlight, setRqHighlight] = useState<'ALL' | string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [papers, setPapers] = useState<PaperRecord[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCorpus().then((d) => setPapers(d.papers));
  }, []);

  const nodeMap = useMemo(() => new Map((nodes as Node[]).map((n) => [n.id, n])), [nodes]);

  const applyState = useCallback((ns: Node[], es: Edge[]) => {
    const dim = rqHighlight !== 'ALL';
    const shownNodes = ns.map((n) => {
      const d = n.data as unknown as KgGraphNode;
      const typeHidden = hiddenTypes.has(d.kgType);
      const faded = dim && !d.rqTags.includes(rqHighlight);
      return { ...n, hidden: typeHidden, style: { ...n.style, opacity: faded ? 0.08 : 1 } };
    });
    const visible = new Set(shownNodes.filter((n) => !n.hidden).map((n) => n.id));
    const shownEdges = es.map((e) => {
      const kind = (e.data as { kind: string }).kind;
      const bothVisible = visible.has(e.source) && visible.has(e.target);
      return { ...e, hidden: onlyContradicts ? kind !== 'contradicts' : !bothVisible };
    });
    return { shownNodes, shownEdges };
  }, [hiddenTypes, onlyContradicts, rqHighlight]);

  const display = useMemo(() => applyState(nodes, edges), [nodes, edges, applyState]);
  const toggleType = (t: KgType) =>
    setHiddenTypes((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedId(node.id);
  }, []);

  const fullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
  };

  // 选中节点与邻居
  const selected = selectedId ? (nodeMap.get(selectedId)?.data as unknown as KgGraphNode | undefined) : null;
  const neighbors = useMemo(() => {
    if (!selectedId) return null;
    const paperNeighbors: Node[] = [];
    const conceptNeighbors: Node[] = [];
    edges.forEach((e) => {
      if (e.source === selectedId) {
        const t = nodeMap.get(e.target);
        if (t) ((t.data as unknown as KgGraphNode).kgType === 'paper' ? paperNeighbors : conceptNeighbors).push(t);
      } else if (e.target === selectedId) {
        const s = nodeMap.get(e.source);
        if (s) ((s.data as unknown as KgGraphNode).kgType === 'paper' ? paperNeighbors : conceptNeighbors).push(s);
      }
    });
    return { paperNeighbors, conceptNeighbors };
  }, [selectedId, edges, nodeMap]);

  // 论文节点 → 语料库 Paper Card
  const selectedPaperRecord: PaperRecord | null = useMemo(() => {
    if (!selected || selected.kgType !== 'paper' || selected.paperIdx === undefined) return null;
    return papers[selected.paperIdx] ?? null;
  }, [selected, papers]);

  const scaleBadge =
    scale === 'demo' ? `演示子集 ${graph.nodes.length} 节点` : `${scale} 论文 · ${graph.nodes.length} 节点`;

  return (
    <div ref={shellRef} className="space-y-4">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(TYPE_COLORS) as KgType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-all',
                hiddenTypes.has(t) ? 'border-line text-t3 line-through' : 'border-line text-t1 hover:border-ink/60',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as Scale)}
            className="h-8 rounded-lg border border-line bg-card px-2 text-[12.5px] text-t2 focus:border-ink focus:outline-none"
            aria-label="图谱规模（压力快照）"
            title="implementation-guide §8 大数据实测"
          >
            {SCALE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Badge variant="neutral">
            {scaleBadge} · {graph.edges.length} 边 · 构建 {buildMs}ms
          </Badge>
          <select
            value={rqHighlight}
            onChange={(e) => setRqHighlight(e.target.value)}
            className="h-8 rounded-lg border border-line bg-card px-2 text-[12.5px] text-t2 focus:border-ink focus:outline-none"
            aria-label="按 RQ 高亮子图"
          >
            <option value="ALL">显示全部</option>
            {['RQ1', 'RQ2', 'RQ3', 'RQ4'].map((r) => (
              <option key={r} value={r}>仅高亮 {r} 子图</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOnlyContradicts((v) => !v)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              onlyContradicts ? 'border-danger bg-[#fff2f0] text-danger' : 'border-line text-t2 hover:border-ink/60',
            )}
          >
            只看矛盾边
          </button>
          <button
            type="button"
            onClick={fullscreen}
            title="全屏展示（答辩模式）"
            className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] text-t2 transition-colors hover:border-ink hover:text-t1"
          >
            <Maximize2 size={12} />
            全屏
          </button>
        </div>
      </div>

      {/* 画布 + 详情面板 */}
      <div className="relative h-[560px] overflow-hidden rounded-card border border-line/60 bg-card">
        <ReactFlow
          nodes={display.shownNodes}
          edges={display.shownEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background gap={24} size={1} color="var(--border-light)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => TYPE_COLORS[(n.data as unknown as KgGraphNode).kgType] ?? 'var(--border)'}
            className="!bg-card"
          />
        </ReactFlow>

        {/* 节点详情侧面板（点节点出现，右上角悬浮） */}
        {selected && (
          <aside className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-80 overflow-y-auto rounded-xl border border-line/70 bg-card p-4 shadow-s3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="h-3 w-3 rounded-full" style={{ background: TYPE_COLORS[selected.kgType] }} />
                <span className="text-[14px] font-semibold">{selected.label}</span>
                <Badge variant="neutral">{TYPE_LABELS[selected.kgType]}</Badge>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="rounded p-1 text-t3 hover:bg-black/5 hover:text-t1" title="关闭">
                <X size={14} />
              </button>
            </div>

            {selected.kgType === 'paper' ? (
              <>
                {selectedPaperRecord ? (
                  <div className="mt-3 space-y-3">
                    <div className="text-[13px] leading-5 text-t1">{selectedPaperRecord.title}</div>
                    <div className="text-[12px] text-t3">
                      {selectedPaperRecord.authors} · {selectedPaperRecord.venue} {selectedPaperRecord.year} · 被引 {selectedPaperRecord.citations}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={selectedPaperRecord.stage === '已纳入' ? 'ok' : 'neutral'}>{selectedPaperRecord.stage}</Badge>
                    </div>
                    <div className="space-y-2 border-t border-line/40 pt-2.5">
                      {([['problems', '问题'], ['methods', '方法'], ['datasets', '数据集'], ['metrics', '指标'], ['limitations', '局限'], ['assumptions', '假设']] as const).map(([key, label]) => (
                        <div key={key}>
                          <div className="text-[11.5px] font-medium text-t3">{label}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {selectedPaperRecord.card[key].map((item) => (
                              <span key={item} className="rounded bg-page px-1.5 py-0.5 text-[11.5px] text-t2">{item}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Link
                      to={`/projects/${projectId}/corpus`}
                      className="inline-block text-[12.5px] text-info-fg underline"
                      onClick={() => setSelectedId(null)}
                    >
                      在语料库中查看 →
                    </Link>
                  </div>
                ) : (
                  <div className="mt-2 text-[12.5px] text-t3">（该论文不在当前语料库快照中）</div>
                )}
              </>
            ) : (
              neighbors && (
                <div className="mt-3 space-y-3 text-[13px]">
                  <div className="flex gap-1.5">
                    {selected.rqTags.map((r) => (
                      <Badge key={r} variant="info">{r}</Badge>
                    ))}
                  </div>
                  <div>
                    <div className="text-[11.5px] font-medium text-t3">关联论文（{neighbors.paperNeighbors.length}）</div>
                    <ul className="mt-1 space-y-1">
                      {neighbors.paperNeighbors.slice(0, 6).map((n) => (
                        <li key={n.id} className="truncate text-[12.5px] text-t1">
                          · {(n.data as unknown as KgGraphNode).label}
                        </li>
                      ))}
                      {neighbors.paperNeighbors.length > 6 && (
                        <li className="text-[12px] text-t3">…等 {neighbors.paperNeighbors.length} 篇</li>
                      )}
                    </ul>
                  </div>
                  {neighbors.conceptNeighbors.length > 0 && (
                    <div>
                      <div className="text-[11.5px] font-medium text-t3">相邻概念（{neighbors.conceptNeighbors.length}）</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {neighbors.conceptNeighbors.map((n) => (
                          <span key={n.id} className="rounded bg-page px-1.5 py-0.5 text-[11.5px] text-t2">
                            {(n.data as unknown as KgGraphNode).label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </aside>
        )}
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-t3">
        <span className="font-medium text-t2">边类型：</span>
        {Object.entries(EDGE_KIND_LABELS).map(([kind, label]) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-6"
              style={kind === 'contradicts' ? { background: 'var(--danger)', height: 2.5 } : kind === 'supports' ? { background: 'var(--ok)' } : { background: 'var(--border)', borderTop: kind.includes('compares') ? '2px dashed var(--border)' : undefined }}
            />
            {label}
          </span>
        ))}
        <span className="ml-auto">点击节点查看详情 · 拖拽/滚轮缩放画布</span>
      </div>
    </div>
  );
}
