import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { Layers, Loader2, Maximize2, Play, Search, X, ZoomIn } from 'lucide-react';
import type { KgGraphData } from '@/services/api';
import { getKg, startRun, USE_MOCK } from '@/services/api';
import { edgeColor, mapNodeType, TYPE_COLORS, TYPE_LABELS, type KgType } from '@/mock/kg';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// ---- Obsidian 风格 KG 画布（canvas 版）----
// 大图策略（100 篇 ≈ 1000 节点，500 篇 ≈ 5000+）：
//   1. 渲染走 <canvas> 命令式重绘（rAF + 脏标记），React 不参与每帧循环；
//   2. 概览模式（默认）：只画 Paper 层 + 度数 Top-K 概念，其余按需展开——
//      选中/搜索任一节点时把它的一跳邻域临时加入可见集，清空即收起；
//   3. 标签按 LOD 绘制（缩放不足像素高时只画重点节点的标签）。

interface SimNode extends SimulationNodeDatum {
  id: string;
  type: KgType;
  label: string;
  description?: string;
  degree: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { type: string };

const ALL_TYPES: KgType[] = ['paper', 'problem', 'method', 'dataset', 'metric', 'limitation', 'assumption'];
const OVERVIEW_CONCEPT_CAP = 300;   // 概览模式可见概念上限（度数 Top-K）
const OVERVIEW_THRESHOLD = 400;     // 节点数超过此值才启用概览模式
const PRE_LAYOUT_TICKS = 300;

function radiusOf(deg: number, type: KgType): number {
  const base = type === 'paper' ? 7 : 5.5;
  return base + Math.min(deg, 12) * 1.1;
}

const endId = (v: SimNode | string | number) => String(typeof v === 'object' ? v.id : v);

export function KgPage() {
  const { projectId = '' } = useParams();
  const [data, setData] = useState<KgGraphData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [w2Starting, setW2Starting] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  // 数据加载（真实 404 → 空态；启动 W2 后轮询直至 KG 产出）
  const load = useCallback(() => {
    getKg(projectId)
      .then((d) => { setData(d); setLoaded(true); })
      .catch(() => { setData(null); setLoaded(true); });
  }, [projectId]);
  useEffect(() => {
    setLoaded(false);
    setQuery('');
    setSelectedId(null);
    setHoverId(null);
    setHidden(new Set());
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

  // 类型筛选 + 搜索 + 视图模式
  const [hidden, setHidden] = useState<Set<KgType>>(new Set());
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'overview' | 'full'>('overview');

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
      const s = endId(e.source); const t = endId(e.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [simLinks]);

  // 概览基集：Paper 层 + 度数 Top-K 概念（类型被隐藏的不进基集）
  const overviewBase = useMemo(() => {
    if (simNodes.length <= OVERVIEW_THRESHOLD) return null; // 小图全量即可
    const papers = simNodes.filter((n) => n.type === 'paper' && !hidden.has(n.type));
    const concepts = simNodes
      .filter((n) => n.type !== 'paper' && !hidden.has(n.type))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, OVERVIEW_CONCEPT_CAP);
    return new Set([...papers, ...concepts].map((n) => n.id));
  }, [simNodes, hidden]);

  const bigGraph = simNodes.length > OVERVIEW_THRESHOLD;
  useEffect(() => {
    // 大图默认概览（Paper 层 + Top 概念），小图全量；仅随规模翻转，不覆盖用户手动切换后的稳态
    setMode(bigGraph ? 'overview' : 'full');
  }, [bigGraph]);

  // 力导向仿真：同步预跑得到确定性布局 → 自适应视野；拖拽时再热。
  // tick 不再触发 React 渲染，只标脏等 rAF 重绘。
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const dirtyRef = useRef(true);
  const requestDraw = useCallback(() => { dirtyRef.current = true; }, []);

  const viewRef = useRef({ k: 1, x: 0, y: 0 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const downPtRef = useRef<{ x: number; y: number } | null>(null);  // down 点，用于位移阈值判定点击
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const nodesRef = useRef(simNodes);
  nodesRef.current = simNodes;

  const fitView = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const xs = nodesRef.current.map((n) => n.x).filter((x): x is number => x != null);
    const ys = nodesRef.current.map((n) => n.y).filter((y): y is number => y != null);
    if (!xs.length) return;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const bw = Math.max(maxX - minX, 10), bh = Math.max(maxY - minY, 10);
    const k = Math.min(w / bw, h / bh) * 0.88;
    viewRef.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
    requestDraw();
  }, [requestDraw]);

  useEffect(() => {
    if (!simNodes.length) return;
    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(58).strength(0.6))
      .force('charge', forceManyBody<SimNode>().strength(-150))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('collide', forceCollide<SimNode>((d) => radiusOf(d.degree, d.type) + 8))
      // 弱向心力：把互不连通的论文星簇聚拢（断连分量的 Obsidian 观感）
      .force('x', forceX(size.w / 2).strength(0.12))
      .force('y', forceY(size.h / 2).strength(0.16))
      .on('tick', () => { dirtyRef.current = true; });
    simRef.current = sim;
    sim.stop();
    const ticks = simNodes.length > 2500 ? 160 : PRE_LAYOUT_TICKS; // 大图减少预跑换取首屏
    for (let i = 0; i < ticks; i++) sim.tick();
    dirtyRef.current = true;
    setTimeout(fitView, 0);
    return () => { sim.stop(); };
  }, [simNodes, simLinks, size.w, size.h, fitView]);

  const reheat = () => simRef.current?.alpha(0.4).restart();

  // 高亮：悬停/选中节点 → 邻域；搜索 → 匹配（驱动 canvas 与详情卡）
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

  const visibleType = (t: KgType) => !hidden.has(t);
  const q = query.trim().toLowerCase();

  // 概览模式的展开集：焦点节点一跳邻域 + 搜索命中（上限 40 个）
  const expanded = useMemo(() => {
    if (mode !== 'overview' || !overviewBase) return null;
    const s = new Set<string>();
    if (focusId) neighborIds.get(focusId)?.forEach((id) => s.add(id));
    if (q) {
      let n = 0;
      for (const node of simNodes) {
        if (n >= 40) break;
        if (visibleType(node.type) && node.label.toLowerCase().includes(q)) { s.add(node.id); n++; }
      }
    }
    return s;
  }, [mode, overviewBase, focusId, neighborIds, q, simNodes]);

  const nodeHidden = (n: SimNode) => {
    if (!visibleType(n.type)) return true;
    if (mode === 'overview' && overviewBase && !overviewBase.has(n.id) && !expanded?.has(n.id)) return true;
    return false;
  };
  const nodeDim = (n: SimNode) => {
    if (nodeHidden(n)) return true;
    if (q && !expanded?.has(n.id) && !n.label.toLowerCase().includes(q)) return true;
    if (activeSet) return !activeSet.has(n.id);
    return false;
  };
  const edgeDim = (s: SimNode, t: SimNode) => {
    if (nodeHidden(s) || nodeHidden(t)) return true;
    if (activeSet) return !(activeSet.has(s.id) && activeSet.has(t.id));
    if (q) return !(s.label.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
    return false;
  };

  // ---- canvas 绘制（命令式，每帧读 ref，不经过 React）----
  // 可见性/高亮逻辑每轮渲染重建，经 ref 传入 rAF 循环，避免闭包过期
  const helpersRef = useRef({ nodeHidden, nodeDim, edgeDim });
  helpersRef.current = { nodeHidden, nodeDim, edgeDim };
  const stateRef = useRef({ activeSet, focusId, selectedId, mode, q, simNodes, simLinks, byId });
  stateRef.current = { activeSet, focusId, selectedId, mode, q, simNodes, simLinks, byId };

  useEffect(() => {
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      // canvas 在数据加载后才挂载，ctx 必须惰性获取（挂载时可能是 null）
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      dirtyRef.current = false;
      const st = stateRef.current;
      const hp = helpersRef.current;
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const view = viewRef.current;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);
      ctx.lineCap = 'round';

      const focus = st.focusId;
      const labelPx = 10.5 * view.k;

      // 边
      for (const e of st.simLinks) {
        const s = st.byId.get(endId(e.source));
        const t = st.byId.get(endId(e.target));
        if (!s || !t) continue;
        const sx = s.x, sy = s.y, tx = t.x, ty = t.y;
        if (sx == null || sy == null || tx == null || ty == null) continue;
        if (hp.nodeHidden(s) || hp.nodeHidden(t)) continue;
        const dim = hp.edgeDim(s, t);
        if (st.activeSet && dim) {
          ctx.globalAlpha = 0.05;
        } else if (st.activeSet) {
          ctx.globalAlpha = 0.95;
        } else if (st.q !== '' && dim) {
          ctx.globalAlpha = 0.06;
        } else {
          ctx.globalAlpha = 0.4;
        }
        ctx.strokeStyle = edgeColor(e.type);
        ctx.lineWidth = st.activeSet && !dim ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      // 节点 + 标签（LOD：缩放像素高不足时只画焦点邻域/概览 Paper 的标签）
      for (const n of st.simNodes) {
        if (hp.nodeHidden(n) || n.x == null || n.y == null) continue;
        const dim = hp.nodeDim(n);
        const r = radiusOf(n.degree, n.type);
        ctx.globalAlpha = dim ? 0.08 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLORS[n.type];
        ctx.fill();
        ctx.lineWidth = focus === n.id ? 2.5 : 1.2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        const important = focus === n.id || (st.activeSet?.has(n.id) ?? false)
          || (st.mode === 'overview' && n.type === 'paper')
          || (st.q !== '' && n.label.toLowerCase().includes(st.q));
        if (!dim && (labelPx >= 5.5 || important)) {
          ctx.globalAlpha = 1;
          ctx.font = '10.5px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          const text = n.label.length > 16 ? `${n.label.slice(0, 16)}…` : n.label;
          const ly = n.y + r + 11;
          ctx.strokeText(text, n.x, ly);
          ctx.fillStyle = '#111318';
          ctx.fillText(text, n.x, ly);
        }
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => { requestDraw(); }, [simNodes, simLinks, hidden, query, mode, selectedId, hoverId, size, requestDraw]);

  // 命中检测：屏幕坐标 → 绘制顺序的逆序查找（nodeHidden 经 ref 取最新值）
  const hitTest = useCallback((mx: number, my: number): SimNode | null => {
    const view = viewRef.current;
    const wx = (mx - view.x) / view.k;
    const wy = (my - view.y) / view.k;
    const nodes = nodesRef.current;
    const isHidden = nodeHiddenRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (isHidden(n) || n.x == null || n.y == null) continue;
      const r = radiusOf(n.degree, n.type) + 4 / view.k;
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, []);

  const nodeHiddenRef = useRef(nodeHidden);
  nodeHiddenRef.current = nodeHidden;

  // 指针交互：节点拖拽 / 空白平移 / 点选 / 悬停
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    downPtRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      dragRef.current = hit.id;
      (e.target as Element).setPointerCapture(e.pointerId);
    } else {
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragRef.current) {
      const n = byId.get(dragRef.current);
      if (n) {
        const view = viewRef.current;
        n.fx = (mx - view.x) / view.k;
        n.fy = (my - view.y) / view.k;
        reheat();
      }
      return;
    }
    if (panRef.current) {
      const { sx, sy, ox, oy } = panRef.current;
      viewRef.current = { ...viewRef.current, x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) };
      requestDraw();
      return;
    }
    const hit = hitTest(mx, my);
    const id = hit?.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHoverId(id);
      requestDraw();
    }
    const el = canvasRef.current;
    if (el) el.style.cursor = id ? 'pointer' : 'grab';
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const dragId = dragRef.current;
    dragRef.current = null;
    panRef.current = null;
    if (dragId != null) {
      const n = byId.get(dragId);
      if (n) { n.fx = undefined; n.fy = undefined; }
      reheat();
    }
    // 位移 <=4px 视为点击（手抖/合成事件的小位移不吞点击），否则是拖拽/平移
    const d0 = downPtRef.current;
    downPtRef.current = null;
    if (!d0) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const dx = e.clientX - rect.left - d0.x, dy = e.clientY - rect.top - d0.y;
    if (dx * dx + dy * dy > 16) return;
    const hit = hitTest(d0.x, d0.y);
    setSelectedId((s) => (hit ? (s === hit.id ? null : hit.id) : null));
    requestDraw();
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const v = viewRef.current;
    const k = Math.min(3, Math.max(0.3, v.k * (1 - e.deltaY * 0.0012)));
    viewRef.current = { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    requestDraw();
  };

  const selected = selectedId ? byId.get(selectedId) : null;

  // InternAtlas 式详情面板：选中节点的关系行（关系类型 → 对端节点，可点击跳转）
  const PANEL_W = 340;
  const EDGE_LABELS: Record<string, string> = {
    addresses: '解决问题', proposes: '提出方法', targets: '作用于', evaluated_on: '评测于',
    measured_by: '度量于', has_limitation: '存在局限', requires: '依赖', relaxes: '放宽',
    constrains: '约束', related: '相关', contradicts: '矛盾', supports: '支持',
    uses_component: '使用组件', extends: '扩展', compares_with: '对比',
  };
  const relations = useMemo(() => {
    if (!selectedId) return [];
    const out: { type: string; dir: 'out' | 'in'; id: string; label: string; nodeType: KgType }[] = [];
    for (const e of simLinks) {
      const s = endId(e.source);
      const t = endId(e.target);
      if (s === selectedId) out.push({ type: e.type, dir: 'out', id: t, label: byId.get(t)?.label ?? t, nodeType: byId.get(t)?.type ?? 'method' });
      else if (t === selectedId) out.push({ type: e.type, dir: 'in', id: s, label: byId.get(s)?.label ?? s, nodeType: byId.get(s)?.type ?? 'method' });
    }
    return out;
  }, [selectedId, simLinks, byId]);

  // 把某节点居中（面板展开时给右侧面板让位）
  // 调试/测试钩子：按标签子串选中并居中（window.__kg.select('...')）
  useEffect(() => {
    (window as unknown as { __kg: unknown }).__kg = {
      select: (label: string) => {
        const n = simNodes.find((x) => x.label.toLowerCase().includes(label.toLowerCase()));
        if (n) { setSelectedId(n.id); focusOn(n.id); }
        return n?.label ?? null;
      },
      nodes: simNodes.length,
    };
  });

  const focusOn = useCallback((id: string) => {
    const n = byId.get(id);
    if (!n || n.x == null || n.y == null) return;
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const k = Math.max(viewRef.current.k, 1.1);
    viewRef.current = { k, x: (w - PANEL_W) / 2 - n.x * k, y: h / 2 - n.y * k };
    requestDraw();
  }, [byId, requestDraw]);
  const showModeToggle = bigGraph;

  return (
    <div className="space-y-4">
      {/* 工具条：类型筛选 + 视图模式 + 搜索 + 统计 */}
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
          {showModeToggle && (
            <div className="flex items-center overflow-hidden rounded-lg border border-line text-[12px]" role="group" aria-label="视图粒度">
              <button
                type="button"
                onClick={() => setMode('overview')}
                className={cn('flex items-center gap-1 px-2.5 py-1 transition-colors',
                  mode === 'overview' ? 'bg-ink text-white' : 'text-t2 hover:bg-page')}
              >
                <Layers size={12} /> 概览
              </button>
              <button
                type="button"
                onClick={() => setMode('full')}
                className={cn('px-2.5 py-1 transition-colors',
                  mode === 'full' ? 'bg-ink text-white' : 'text-t2 hover:bg-page')}
              >
                全部
              </button>
            </div>
          )}
          <Badge variant="neutral">{simNodes.length} 节点 · {simLinks.length} 边{data?.paperCount ? ` · 论文 ${data.paperCount} 篇` : ''}</Badge>
          <Button size="sm" variant="secondary" onClick={fitView} title="缩放至全部节点可见">
            <Maximize2 size={13} />
          </Button>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-t3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索节点…" className="w-44 pl-7" />
          </div>
        </div>
      </div>

      {/* 画布（canvas 命令式渲染：大图不经过 React 每帧循环） */}
      <div
        ref={wrapRef}
        className="relative h-[560px] touch-none select-none overflow-hidden rounded-xl border border-line/60 bg-page"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.055) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          const rect = wrapRef.current!.getBoundingClientRect();
          const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
          if (hit) { setSelectedId(hit.id); focusOn(hit.id); }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          dragRef.current = null;
          panRef.current = null;
          if (hoverRef.current) { hoverRef.current = null; setHoverId(null); }
          requestDraw();
        }}
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
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-grab"
            style={{ width: size.w, height: size.h }}
          />
        )}

        {/* 左下：边类型图例 */}
        {simNodes.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-card/90 px-3 py-1.5 text-[11px] text-t2 shadow-s1 backdrop-blur">
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#b9bec4' }} />结构关系</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#2e7d32' }} />支持</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: '#e53935' }} />矛盾</span>
            <span className="text-t3">滚轮缩放 · 拖拽平移 · 点选详情{mode === 'overview' ? ' · 点节点展开邻域' : ''} · 双击居中</span>
          </div>
        )}

        {/* 右侧：InternAtlas 式节点详情抽屉 */}
        {selected && (
          <Card className="absolute bottom-3 right-3 top-3 flex w-[340px] flex-col overflow-hidden p-0 shadow-s2">
            <div className="flex items-start justify-between gap-2 border-b border-line/60 px-4 py-3">
              <Badge variant="neutral">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[selected.type] }} />
                {TYPE_LABELS[selected.type]}
              </Badge>
              <div className="flex items-center gap-1">
                <button type="button" title="在图谱中居中" className="text-t3 hover:text-t1" onClick={() => focusOn(selected.id)}>
                  <ZoomIn size={14} />
                </button>
                <button type="button" title="关闭" className="text-t3 hover:text-t1" onClick={() => setSelectedId(null)}>
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="text-[15px] font-semibold leading-6">{selected.label}</div>
              <div className="mt-2 rounded-lg border border-line/60 bg-page px-3 py-2 font-mono text-[11.5px] leading-5 text-t2">
                <div>NODE ID&nbsp;&nbsp;{selected.id.slice(0, 34)}{selected.id.length > 34 ? '…' : ''}</div>
                <div>连接度&nbsp;&nbsp;&nbsp;{selected.degree}</div>
                <div>关系数&nbsp;&nbsp;&nbsp;{relations.length}</div>
              </div>
              {selected.description && (
                <p className="mt-3 text-[12.5px] leading-5 text-t2">{selected.description}</p>
              )}
              <div className="mt-4 text-[12.5px] font-medium text-t2">关系（{relations.length}）</div>
              <div className="mt-2 space-y-1">
                {relations.length === 0 && <div className="text-[12px] text-t3">暂无关系边</div>}
                {relations.map((r, i) => (
                  <button
                    key={`${r.dir}-${r.type}-${r.id}-${i}`}
                    type="button"
                    onClick={() => { setSelectedId(r.id); focusOn(r.id); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line/60 hover:bg-page"
                  >
                    <span className="w-20 shrink-0 font-mono text-[10.5px] uppercase text-t3">
                      {EDGE_LABELS[r.type] ?? r.type}
                    </span>
                    <span className={r.dir === 'out' ? 'text-t3' : 'text-t3 rotate-180'}>{r.dir === 'out' ? '→' : '←'}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[r.nodeType] }} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-t1">{r.label}</span>
                    <span className="shrink-0 text-[11px] text-t3">{TYPE_LABELS[r.nodeType]}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
