// KG 图谱 mock：12 篇论文 + 六类概念节点，d3-force 预计算布局
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Edge } from '@xyflow/react';

export type KgType = 'paper' | 'problem' | 'method' | 'dataset' | 'metric' | 'limitation' | 'assumption';

export const TYPE_COLORS: Record<KgType, string> = {
  paper: 'var(--ink)',
  problem: '#2563eb',
  method: '#16a34a',
  dataset: '#d97706',
  metric: '#9333ea',
  limitation: '#dc2626',
  assumption: '#0891b2',
};

export const TYPE_LABELS: Record<KgType, string> = {
  paper: '论文',
  problem: '问题',
  method: '方法',
  dataset: '数据集',
  metric: '指标',
  limitation: '局限',
  assumption: '假设约束',
};

export interface KgGraphNode {
  id: string;
  kgType: KgType;
  label: string;
  rqTags: string[];
  paperIdx?: number;
}

interface KgEdge { source: string; target: string; kind: 'proposes' | 'evaluated_on' | 'measured_by' | 'addresses' | 'extends' | 'compares_with' | 'contradicts' | 'supports' }

const PAPER_NAMES = [
  'GNNExplainer', 'PGExplainer', 'ParamExplainer', 'PGM-Explainer', 'GraphMask',
  'SubgraphX', 'RCExplainer', 'DSAA Eval', 'Robustness ICLR23', 'KDD Benchmark',
  'CSUR Survey', 'Causal Attention',
];

const CONCEPTS: [KgType, string[]][] = [
  ['problem', ['解释不稳定', '合成基准依赖', '跨图泛化弱', '计算开销高', '人类对齐差']],
  ['method', ['梯度归因', '软掩码学习', '子图搜索', '代理模型近似', '反事实解释']],
  ['dataset', ['BA-Shapes', 'BA-Community', 'Tree-Cycle', 'Cora', 'PubMed']],
  ['metric', ['Fidelity+', 'Fidelity−', 'Sparsity', 'Accuracy@K']],
  ['limitation', ['稳定性未评估', '可扩展性差']],
  ['assumption', ['k-hop 局部性假设']],
];

const RQ_CYCLE = ['RQ1', 'RQ2', 'RQ3', 'RQ4'];

export function buildKgGraph() {
  const nodes: KgGraphNode[] = [];
  const edges: KgEdge[] = [];

  PAPER_NAMES.forEach((name, i) => {
    nodes.push({ id: `p-${i}`, kgType: 'paper', label: name, rqTags: [RQ_CYCLE[i % 4], RQ_CYCLE[(i + 1) % 4]], paperIdx: i });
  });
  CONCEPTS.forEach(([type, names]) => {
    names.forEach((label, j) => {
      nodes.push({ id: `c-${type}-${j}`, kgType: type, label, rqTags: [RQ_CYCLE[j % 4]] });
    });
  });

  const methods = nodes.filter((n) => n.kgType === 'method').map((n) => n.id);
  const datasets = nodes.filter((n) => n.kgType === 'dataset').map((n) => n.id);
  const metrics = nodes.filter((n) => n.kgType === 'metric').map((n) => n.id);
  const problems = nodes.filter((n) => n.kgType === 'problem').map((n) => n.id);

  nodes.filter((n) => n.kgType === 'paper').forEach((p, i) => {
    edges.push({ source: p.id, target: methods[i % methods.length], kind: 'proposes' });
    if (i % 3 === 0) edges.push({ source: p.id, target: methods[(i + 1) % methods.length], kind: 'proposes' });
  });
  methods.forEach((m, i) => {
    edges.push({ source: m, target: datasets[i % datasets.length], kind: 'evaluated_on' });
    edges.push({ source: m, target: metrics[i % metrics.length], kind: 'measured_by' });
    edges.push({ source: m, target: problems[i % problems.length], kind: 'addresses' });
  });
  const papers = nodes.filter((n) => n.kgType === 'paper').map((n) => n.id);
  edges.push({ source: papers[1], target: papers[0], kind: 'extends' });
  edges.push({ source: papers[2], target: papers[1], kind: 'extends' });
  edges.push({ source: papers[5], target: papers[1], kind: 'extends' });
  edges.push({ source: papers[4], target: papers[3], kind: 'extends' });
  edges.push({ source: papers[8], target: papers[6], kind: 'contradicts' });
  edges.push({ source: papers[9], target: papers[0], kind: 'contradicts' });
  edges.push({ source: papers[5], target: papers[3], kind: 'contradicts' });
  edges.push({ source: papers[7], target: papers[1], kind: 'compares_with' });
  edges.push({ source: papers[10], target: papers[8], kind: 'compares_with' });
  edges.push({ source: papers[11], target: papers[9], kind: 'supports' });
  edges.push({ source: papers[6], target: papers[10], kind: 'supports' });

  // d3-force 预计算布局（一次性同步跑 320 轮）
  type SimNode = KgGraphNode & { x?: number; y?: number };
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
  const simLinks = edges.map((e) => ({ ...e }));
  const sim = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-420))
    .force('link', forceLink(simLinks).id((d: unknown) => (d as { id: string }).id).distance(110).strength(0.4))
    .force('center', forceCenter(480, 340))
    .stop();
  sim.tick(320);

  const pos = new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));

  const rfNodes = nodes.map((n) => ({
    id: n.id,
    position: pos.get(n.id)!,
    data: { ...n },
    type: n.kgType === 'paper' ? 'paper' : 'concept',
  }));

  const rfEdges: Edge[] = edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    kind: 'straight' as const,
    style: edgeStyle(e.kind),
    data: { kind: e.kind },
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

function edgeStyle(kind: KgEdge['kind']) {
  if (kind === 'contradicts') return { stroke: 'var(--danger)', strokeWidth: 2.5 };
  if (kind === 'extends') return { stroke: 'var(--border)', strokeWidth: 1.5 };
  if (kind === 'compares_with') return { stroke: 'var(--border)', strokeWidth: 1.5, strokeDasharray: '6 4' };
  if (kind === 'supports') return { stroke: 'var(--ok)', strokeWidth: 1.5 };
  if (kind === 'addresses') return { stroke: '#2563eb55', strokeWidth: 1.5 };
  return { stroke: 'var(--border)', strokeWidth: 1 };
}

export const EDGE_KIND_LABELS: Record<KgEdge['kind'], string> = {
  proposes: 'proposes 提出',
  evaluated_on: 'evaluated_on 评测于',
  measured_by: 'measured_by 度量',
  addresses: 'addresses 解决',
  extends: 'extends 扩展',
  compares_with: 'compares_with 对比',
  contradicts: 'contradicts 矛盾',
  supports: 'supports 支持',
};
