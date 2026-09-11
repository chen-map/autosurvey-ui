import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Handle, Position,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { buildKgGraph, TYPE_COLORS, TYPE_LABELS, EDGE_KIND_LABELS, type KgGraphNode, type KgType } from '@/mock/kg';
import { getCorpus } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

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

// ---- 页面 ----
export function KgPage() {
  const { projectId = '' } = useParams();
  const graph = useMemo(() => buildKgGraph(), []);
  const [nodes, , onNodesChange] = useNodesState(graph.nodes as Node[]);
  const [edges, , onEdgesChange] = useEdgesState(graph.edges as Edge[]);
  const [hiddenTypes, setHiddenTypes] = useState<Set<KgType>>(new Set());
  const [onlyContradicts, setOnlyContradicts] = useState(false);
  const [rqHighlight, setRqHighlight] = useState<'ALL' | string>('ALL');
  const [selected, setSelected] = useState<KgGraphNode | null>(null);
  const [papers, setPapers] = useState<{ id: string; title: string }[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCorpus().then((d) => setPapers(d.papers.map((p, i) => ({ id: `p-${i}`, title: p.title }))));
  }, []);

  // 过滤 + RQ 高亮（派生显示状态）
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
      return {
        ...e,
        hidden: onlyContradicts ? kind !== 'contradicts' : !bothVisible,
      };
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
    setSelected(node.data as unknown as KgGraphNode);
  }, []);

  const fullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
  };

  const selectedPaper = selected?.paperIdx !== undefined ? papers[selected.paperIdx] : null;
  const contradictsCount = graph.edges.filter((e) => (e.data as { kind: string }).kind === 'contradicts').length;

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
        <div className="ml-auto flex items-center gap-2">
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
            只看矛盾边（{contradictsCount}）
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

      {/* 画布 */}
      <div className="h-[560px] overflow-hidden rounded-card border border-line/60 bg-card">
        <ReactFlow
          nodes={display.shownNodes}
          edges={display.shownEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
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
      </div>

      {/* 选中节点面板 */}
      {selected && (
        <Card className="anim-rise p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: TYPE_COLORS[selected.kgType] }} />
                <span className="text-[15px] font-semibold">{selected.label}</span>
                <Badge variant="neutral">{TYPE_LABELS[selected.kgType]}</Badge>
                {selected.rqTags.map((r) => (
                  <Badge key={r} variant="info">{r}</Badge>
                ))}
              </div>
              {selected.kgType === 'paper' ? (
                <div className="mt-2 space-y-1.5 text-[13px] text-t2">
                  <div>完整标题：{selectedPaper?.title ?? selected.label}</div>
                  <div>
                    关联语料库论文：
                    <Link to={`/projects/${projectId}/corpus`} className="ml-1 text-info-fg underline">前往语料库查看 →</Link>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[13px] text-t2">
                  点击画布中的黑色论文节点可查看论文详情；用顶部「按 RQ 高亮」可查看该研究问题的证据子图。
                </div>
              )}
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-[12px] text-t3 hover:text-t1">关闭</button>
          </div>
        </Card>
      )}

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
      </div>
    </div>
  );
}
