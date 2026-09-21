import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { Loader2, Play, Search, X, ZoomIn } from 'lucide-react';
import type { KgGraphData } from '@/services/api';
import { getKg, startRun, USE_MOCK } from '@/services/api';
import { edgeColor, mapNodeType, TYPE_COLORS, TYPE_LABELS, type KgType } from '@/mock/kg';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// ---- Obsidian 风格 KG 画布：d3-force 力导向 + 类型着色 + 悬停高亮邻域 + 缩放平移 ----

interface SimNode extends SimulationNodeDatum {
  id: string;
  type: KgType;
  label: string;
  description?: string;
  degree: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { type: string };

const ALL_TYPES: KgType[] = ['paper', 'problem', 'method', 'dataset', 'metric', 'limitation', 'assumption'];

function radiusOf(deg: number, type: KgType): number {
  const base = type === 'paper' ? 7 : 5.5;
  return base + Math.min(deg, 12) * 1.1;
}

export function KgPage() {
  const { projectId = '' } = useParams();
  const [data, setData] = useState<KgGraphData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [w2Starting, setW2Starting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  // 数据加载（真实 404 → 空态；启动 W2 后轮询直至 KG 产出）
  const load = useCallback(() => {
    getKg(projectId)
      .then((d) => { setData(d); setLoaded(true); })
      .catch(() => { setData(null); setLoaded(true); });
  }, [projectId]);
  useEffect(() => {
    setLoaded(false);
    load();
  }, [load]);

  const startW2 = async () => {
    setW2Starting(true);
    try {
      await startRun(projectId, 'w2');
      const timer = setInterval(() => {
        getKg(projectId).then((d) => {
          if (d.nodes?.length) { clearInterval(timer); setData(d); }
        }).catch(() => {});
      }, 5000);
    } finally {
      setW2Starting(false);
    }
  };

  // 容器尺寸
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 类型筛选 + 搜索
  const [hidden, setHidden] = useState<Set<KgType>>(new Set());
  const [query, setQuery] = useState('');

  // 图结构（度数在全集上计算）
  const { simNodes, simLinks, typeCounts } = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const links = data?.edges ?? [];
    const deg = new Map<string, number>();
    for (const e of links) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id, type: mapNodeType(n.type), label: n.label,
      description: n.description, degree: deg.get(n.id) ?? 0,
    }));
    const simLinks: SimLink[] = links.map((e) => ({ source: e.source, target: e.target, type: e.type }));
    const typeCounts = {} as Record<KgType, number>;
    for (const n of simNodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    return { simNodes, simLinks, typeCounts };
  }, [data]);

  const byId = useMemo(() => new Map(simNodes.map((n) => [n.id, n])), [simNodes]);
  const neighborIds = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of simLinks) {
      const s = String(typeof e.source === 'object' ? e.source.id : e.source);
      const t = String(typeof e.target === 'object' ? e.target.id : e.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [simLinks]);

  // 力导向仿真（每 tick 重渲染；alpha 衰减后自动停）
  const [, setTick] = useState(0);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  useEffect(() => {
    if (!simNodes.length) return;
    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(92).strength(0.35))
      .force('charge', forceManyBody<SimNode>().strength(-300))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('collide', forceCollide<SimNode>((d) => radiusOf(d.degree, d.type) + 8))
      .on('tick', () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => { sim.stop(); };
  }, [simNodes, simLinks, size.w, size.h]);

  const reheat = () => simRef.current?.alpha(0.4).restart();

  // 节点拖拽（按住固定，松开释放）
  const dragRef = useRef<string | null>(null);
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    dragRef.current = id;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const n = byId.get(dragRef.current);
    if (!n) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    n.fx = (e.clientX - rect.left - view.x) / view.k;
    n.fy = (e.clientY - rect.top - view.y) / view.k;
    reheat();
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    const n = byId.get(dragRef.current);
    if (n) { n.fx = undefined; n.fy = undefined; }
    dragRef.current = null;
    reheat();
  };

  // 缩放（光标锚点）+ 空白平移
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.3, v.k * (1 - e.deltaY * 0.0012)));
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onBgPointerDown = (e: React.PointerEvent) => {
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onBgPointerMove = (e: React.PointerEvent) => {
    if (!panRef.current) return;
    const { sx, sy, ox, oy } = panRef.current;
    setView((v) => ({ ...v, x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) }));
  };

  // 高亮：悬停/选中节点 → 邻域；搜索 → 匹配
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusId = hoverId ?? selectedId;
  const activeSet = useMemo(() => {
    if (focusId) {
      const s = new Set([focusId]);
      neighborIds.get(focusId)?.forEach((id) => s.add(id));
      return s;
    }
    return null;
  }, [focusId, neighborIds]);

  const visible = (t: KgType) => !hidden.has(t);
  const q = query.trim().toLowerCase();
  const nodeDim = (n: SimNode) => {
    if (!visible(n.type)) return true;
    if (q && !n.label.toLowerCase().includes(q)) return true;
    if (activeSet) return !activeSet.has(n.id);
    return false;
  };
  const edgeDim = (e: SimLink) => {
    const s = typeof e.source === 'object' ? e.source : byId.get(e.source as string);
    const t = typeof e.target === 'object' ? e.target : byId.get(e.target as string);
    if (!s || !t) return true;
    if (hidden.has(s.type) || hidden.has(t.type)) return true;
    if (activeSet) return !(activeSet.has(s.id) && activeSet.has(t.id));
    return false;
  };

  const selected = selectedId ? byId.get(selectedId) : null;

  return (
    <div className="space-y-4">
      {/* 工具条：类型筛选 + 搜索 + 统计 */}
      <div className="flex flex-wrap items-center gap-2">
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setHidden((h) => {
              const next = new Set(h);
              if (next.has(t)) next.delete(t); else next.add(t);
              return next;
            })}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-all',
              hidden.has(t) ? 'border-line/60 text-t3 opacity-45' : 'border-line text-t2 hover:border-ink',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
            {TYPE_LABELS[t]}
            <span className="text-t3">{typeCounts[t] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="neutral">{simNodes.length} 节点 · {simLinks.length} 边{data?.paperCount ? ` · 论文 ${data.paperCount} 篇` : ''}</Badge>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-t3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索节点…" className="w-44 pl-7" />
          </div>
        </div>
      </div>

      {/* 画布 */}
      <div
        ref={wrapRef}
        className="relative h-[560px] touch-none select-none overflow-hidden rounded-xl border border-line/60 bg-page"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.055) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        onWheel={onWheel}
        onPointerMove={(e) => { onPointerMove(e); onBgPointerMove(e); }}
        onPointerUp={() => { onPointerUp(); panRef.current = null; }}
        onPointerLeave={() => { onPointerUp(); panRef.current = null; }}
      >
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-[13px] text-t3">
            <Loader2 size={15} className="mr-2 animate-spin" /> 加载图谱…
          </div>
        ) : simNodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[14px] text-t2">知识图谱尚未构建</p>
            <p className="max-w-sm text-[12.5px] leading-5 text-t3">
              运行 W2（事实记忆构建）后，此处将展示 Obsidian 风格的论文-概念图谱：六类对象节点 + 论文间关系边。
            </p>
            {!USE_MOCK && (
              <Button onClick={startW2} disabled={w2Starting}>
                {w2Starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {w2Starting ? '启动中…' : '启动 W2'}
              </Button>
            )}
          </div>
        ) : (
          <svg
            width={size.w}
            height={size.h}
            className={cn('block', panRef.current ? 'cursor-grabbing' : 'cursor-grab')}
            onPointerDown={onBgPointerDown}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* 边 */}
              {simLinks.map((e, i) => {
                const s = typeof e.source === 'object' ? e.source : byId.get(e.source as string);
                const t = typeof e.target === 'object' ? e.target : byId.get(e.target as string);
                if (!s || !t || nodeDim(s) || nodeDim(t)) return null;
                return (
                  <line
                    key={i}
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    stroke={edgeColor(e.type)}
                    strokeWidth={activeSet ? 1.6 : 1}
                    opacity={edgeDim(e) ? (activeSet ? 0.9 : 0.18) : 0.06}
                  />
                );
              })}
              {/* 节点 + 标签（标签在节点下方，Obsidian 式） */}
              {simNodes.map((n) => {
                const dim = nodeDim(n);
                const r = radiusOf(n.degree, n.type);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                    opacity={dim ? 0.08 : 1}
                    className="cursor-pointer"
                    onPointerDown={(e) => onNodePointerDown(e, n.id)}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onClick={() => setSelectedId((s) => (s === n.id ? null : n.id))}
                  >
                    <circle r={r + 3} fill="transparent" />
                    <circle
                      r={r}
                      fill={TYPE_COLORS[n.type]}
                      stroke="#fff"
                      strokeWidth={focusId === n.id ? 2.5 : 1.2}
                    />
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      className="pointer-events-none fill-t1"
                      fontSize={10.5}
                      style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.85)', strokeWidth: 3 }}
                    >
                      {n.label.length > 16 ? `${n.label.slice(0, 16)}…` : n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* 左下：边类型图例 */}
        {simNodes.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-card/90 px-3 py-1.5 text-[11px] text-t2 shadow-s1 backdrop-blur">
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#b9bec4' }} />结构关系</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#2e7d32' }} />支持</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#e53935' }} />矛盾</span>
            <span className="text-t3">滚轮缩放 · 拖拽平移 · 点选查看</span>
          </div>
        )}

        {/* 右下：点选详情 */}
        {selected && (
          <Card className="absolute bottom-3 right-3 w-72 p-4 shadow-s2">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="neutral">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[selected.type] }} />
                {TYPE_LABELS[selected.type]}
              </Badge>
              <button type="button" className="text-t3 hover:text-t1" onClick={() => setSelectedId(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="mt-2 text-[14px] font-medium leading-5">{selected.label}</div>
            {selected.description && (
              <p className="mt-1.5 text-[12.5px] leading-5 text-t3">{selected.description}</p>
            )}
            <div className="mt-2.5 flex items-center gap-2 text-[12px] text-t3">
              <ZoomIn size={12} />
              连接度 {selected.degree} ·
              {(() => {
                const types = new Map<string, number>();
                for (const e of simLinks) {
                  const s = String(typeof e.source === 'object' ? e.source.id : e.source);
                  const t = String(typeof e.target === 'object' ? e.target.id : e.target);
                  if (s !== selected.id && t !== selected.id) continue;
                  const other = s === selected.id ? t : s;
                  types.set(byId.get(other)?.type ?? '?', (types.get(byId.get(other)?.type ?? '?') ?? 0) + 1);
                }
                return [...types.entries()].map(([t, n]) => ` ${TYPE_LABELS[t as KgType] ?? t}×${n}`).join(' ·');
              })()}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
