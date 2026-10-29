// 品类功能目录沉淀的数据快照：两个项目（全流程完成 / W3 进行中）
import type { PipelineRun, PaperRecord, PrismaLevel, OutlineNode, ReviewRound, AgentRun, UserRecord, WorkflowRun, PhaseStatus, ScreenStage } from '@/types/data';

const wf = (
  id: string,
  name: string,
  phases: [string, string, PhaseStatus, number?][],
  progress: number,
): WorkflowRun => ({
  id,
  name,
  progress,
  status: phases.some((p) => p[2] === 'running')
    ? 'running'
    : phases.some((p) => p[2] === 'failed')
      ? 'failed'
      : phases.every((p) => p[2] === 'done' || p[2] === 'checkpoint')
        ? 'done'
        : 'pending',
  phases: phases.map(([pid, pname, st, dur]) => ({ id: pid, name: pname, status: st, durationSec: dur })),
});

export const RUNNING_PIPELINE: PipelineRun = {
  id: 'run-llm-01',
  projectId: 'proj-llm-agent-safety',
  startedAt: '2026-09-10 11:20',
  elapsedSec: 11244,
  metrics: { papers: 154, pairs: 11252, edges: 289 },
  workflows: [
    wf('W1', '语料库构建', [
      ['W1-P1', 'Golden Set 检索式构建', 'done', 312],
      ['W1-P2', '七数据库检索', 'done', 1840],
      ['W1-P3', '记录归一与去重', 'done', 640],
      ['W1-P4', '六阶段筛选', 'done', 2210],
      ['W1-P5', '滚雪球扩展', 'done', 905],
      ['W1-P6', '论文下载（六级降级）', 'checkpoint', 1180],
      ['W1-P7', '本地论文合并', 'done', 95],
    ], 100),
    wf('W2', '事实记忆(KG)', [
      ['W2-P0', 'PDF 批量解析', 'done', 2044],
      ['W2-P1', '结构化对象提取', 'done', 5412],
      ['W2-P2', '候选对象筛选', 'done', 310],
      ['W2-P3', '知识图谱构建（N²）', 'done', 13120],
    ], 100),
    wf('W3', '框架与RQ', [
      ['W3-P1', 'Gap 分析', 'done', 415],
      ['W3-P2', 'RQ 设计', 'running'],
      ['W3-P3', 'RQ-KG 验证与冻结', 'pending'],
      ['W3-P4', 'RQ 修正循环', 'pending'],
      ['W3-P5', '大纲骨架生成', 'pending'],
    ], 35),
    wf('W4', 'RQ证据', [
      ['W4-P1', '证据抽取', 'pending'],
      ['W4-P2', '答案综合', 'pending'],
      ['W4-P3', '声明四维核查', 'pending'],
    ], 0),
    wf('W5', '综述写作', [
      ['W5-P1', 'LaTeX 生成', 'pending'],
      ['W5-P2', '图表生成', 'pending'],
      ['W5-P3', '引用渲染', 'pending'],
      ['W5-P4', '编译', 'pending'],
      ['W5-P5', '自动审查循环', 'pending'],
    ], 0),
  ],
  logs: [
    { t: '14:02:11', phase: 'W3-P2', line: '设计 Macro-RQ（3–5 个）: 基于 KG_SUMMARY 聚类结果生成候选…' },
    { t: '14:02:40', phase: 'W3-P2', line: '候选 RQ-3: LLM Agent 攻击面分类体系（覆盖 412 个 problem 节点）' },
    { t: '14:03:02', phase: 'W3-P2', line: '候选 RQ-5: 防御机制与攻击演化对照（pending KG 路径验证）' },
    { t: '14:03:30', phase: 'W3-P2', line: '预设证据类型: node_set + relation_path，候选查询路径 6 条' },
    { t: '14:03:31', phase: 'W3-P2', line: '等待 LLM 返回 Sub-RQ 细化结果…（checkpoint: w3p2.ckpt@14:02:10）' },
  ],
};

export const COMPLETED_PIPELINE: PipelineRun = {
  ...RUNNING_PIPELINE,
  id: 'run-gnn-01',
  projectId: 'proj-gnn-survey',
  startedAt: '2026-08-19 08:30',
  elapsedSec: 22140,
  metrics: { papers: 162, pairs: 13041, edges: 313 },
  workflows: RUNNING_PIPELINE.workflows.map((w) => ({
    ...w,
    status: 'done' as const,
    progress: 100,
    phases: w.phases.map((p) => ({ ...p, status: 'done' as const, durationSec: p.durationSec ?? 600 })),
  })),
  logs: [
    { t: '18:41:02', phase: 'W5-P5', line: '审查轮次 2/2 完成：证据密度达标，格式合规' },
    { t: '18:39:47', phase: 'W5-P4', line: 'pdflatex ×2 + bibtex 编译通过，21 页（限 25 页）' },
    { t: '18:40:20', phase: 'W5-P5', line: '输出 main.pdf → wm/proj-gnn-survey/main.pdf' },
  ],
};

export function getPipeline(projectId: string): PipelineRun {
  return projectId === 'proj-gnn-survey' ? COMPLETED_PIPELINE : RUNNING_PIPELINE;
}

// ---------- 语料库 ----------
export const PRISMA: PrismaLevel[] = [
  { stage: '数据库检索', count: 48213, note: '7 库联合检索' },
  { stage: '去重后', count: 6210 },
  { stage: '标题筛选', count: 812 },
  { stage: '摘要筛选', count: 224 },
  { stage: '全文+质量评估', count: 189 },
  { stage: '最终纳入（含滚雪球）', count: 162 },
];

const CARDS = {
  problems: ['可解释性缺乏系统评测基准', '解释结果与人类直觉不一致', '大规模图上解释开销过高'],
  methods: ['梯度归因', '软掩码学习', '子图搜索', '代理模型近似'],
  datasets: ['BA-Shapes', 'BA-Community', 'Tree-Cycle', 'Cora', 'PubMed'],
  metrics: ['Fidelity+', 'Fidelity−', 'Sparsity', 'Accuracy@K'],
  limitations: ['基准数据集过于合成', '解释稳定性未评估', '跨图泛化能力弱'],
  assumptions: ['重要子结构集中于 k-hop 邻域', '边权与重要性单调相关'],
};

const RAW_PAPERS: [string, string, string, number, number, ScreenStage][] = [
  ['GNNExplainer: Generating Explanations for Graph Neural Networks', 'Ying et al.', 'NeurIPS', 2019, 3120, '已纳入'],
  ['PGExplainer: Towards Post-hoc Explanation on Graph Neural Networks', 'Luo et al.', 'NeurIPS', 2020, 1450, '已纳入'],
  ['Parameterized Explainer for Graph Neural Network', 'Luo et al.', 'ICLR', 2020, 980, '已纳入'],
  ['PGM-Explainer: Probabilistic Graphical Model Explanations', 'Vu & Thai', 'NeurIPS', 2020, 760, '已纳入'],
  ['GraphMask: Learning to Dropout Edges via Differentiable Masks', 'Schlichtkrull et al.', 'ICLR', 2021, 640, '已纳入'],
  ['SubgraphX: Explaining Graph Neural Networks via Subgraph Exploration', 'Yuan et al.', 'ICLR', 2021, 890, '已纳入'],
  ['RCExplainer: Robust Counterfactual Explanations for GNNs', 'Bajaj et al.', 'NeurIPS', 2021, 420, '已纳入'],
  ['Evaluating Explainability for Graph Neural Networks', 'Amara et al.', 'DSAA', 2022, 310, '质量评估'],
  ['A Unified Framework for Adversarial Robustness of GNN Explanations', 'Ma et al.', 'ICLR', 2023, 118, '全文筛选'],
  ['Benchmarking GNN Explainers: Aligning with Human Intuition', 'Huang et al.', 'KDD', 2023, 96, '摘要筛选'],
  ['Towards Multi-relational GNN Explanation', 'Zhou et al.', 'WWW', 2023, 74, '标题筛选'],
  ['Causal Attention for Graph Classification', 'Lin et al.', 'KDD', 2021, 520, '已纳入'],
  ['On the Stability of Explanation Methods for GNNs', 'Gui et al.', 'TNNLS', 2024, 33, '摘要筛选'],
  ['Survey on GNN Interpretability: A Taxonomy', 'Yuan et al.', 'ACM CSUR', 2022, 1580, '已纳入'],
];

export const PAPERS: PaperRecord[] = RAW_PAPERS.map(([title, authors, venue, year, citations, stage], i) => ({
  id: `paper-${i + 1}`,
  title,
  authors,
  venue,
  year,
  citations,
  stage,
  abstract: `本文研究图神经网络可解释性方向的关键问题：如何在保证 fidelity 的同时产出人类可理解的解释。实验在 ${CARDS.datasets[i % CARDS.datasets.length]} 等基准上进行，并讨论了与现有范式的差异。`,
  card: {
    problems: [CARDS.problems[i % 3], CARDS.problems[(i + 1) % 3]],
    methods: [CARDS.methods[i % 4], CARDS.methods[(i + 2) % 4]],
    datasets: [CARDS.datasets[i % 5], CARDS.datasets[(i + 3) % 5]],
    metrics: [CARDS.metrics[i % 4]],
    limitations: [CARDS.limitations[i % 3]],
    assumptions: [CARDS.assumptions[i % 2]],
  },
}));

// ---------- 报告 ----------
export const OUTLINE: OutlineNode[] = [
  { id: 's1', title: '1 Introduction', papers: 8 },
  { id: 's2', title: '2 Background: GNNs and Interpretability', rq: 'RQ4', papers: 21, children: [
    { id: 's2-1', title: '2.1 Problem Formulation', rq: 'RQ4', papers: 9 },
    { id: 's2-2', title: '2.2 Evaluation Metrics', rq: 'RQ4', papers: 12 },
  ] },
  { id: 's3', title: '3 Gradient-based Methods', rq: 'RQ1', papers: 34 },
  { id: 's4', title: '4 Perturbation & Masking Methods', rq: 'RQ1', papers: 52 },
  { id: 's5', title: '5 Comparative Analysis', rq: 'RQ2', papers: 30, children: [
    { id: 's5-1', title: '5.1 Benchmark Performance', rq: 'RQ2', papers: 18 },
    { id: 's5-2', title: '5.2 Cross-dataset Generalization', rq: 'RQ2', papers: 12 },
  ] },
  { id: 's6', title: '6 Limitations and Open Problems', rq: 'RQ3', papers: 15 },
  { id: 's7', title: '7 Roadmap and Future Directions', rq: 'RQ3', papers: 2 },
];

export const REVIEW_ROUNDS: ReviewRound[] = [
  { round: 1, date: '2026-08-30', verdict: 'needs_revision', improvements: ['§4 缺少与梯度方法的定量对照（补 Table 3）', '§5.2 证据密度不足（新增 6 篇引用）', '引用格式统一为 venue:year'] },
  { round: 2, date: '2026-09-01', verdict: 'accept', improvements: ['语言质量润色完成', '图表清晰度达标', '页数 21/25 合规'] },
];

// ---------- Agent ----------
export const AGENT_RUN: AgentRun = {
  rq: '分析 BA-Shapes 基准上掩码类解释方法的 Fidelity+ 差异来源',
  skill: { id: 'B2.1-a', name: '范式抽象聚类', reason: 'RQ 指向"方法族横向比较"，与 B2.1-a 的多对象抽象聚类策略匹配度 0.91（37 个候选中最高）' },
  steps: [
    { tool: 'get_entity_by_type', args: '{ type: "Method", filter: "mask*" }', result: '返回 17 个方法节点' },
    { tool: 'get_relation', args: '{ edge: "evaluated_on" }', result: '获得 46 条方法-数据集边' },
    { tool: 'intersect', args: '{ sets: [maskMethods, evaluatedOn(BA-Shapes)] }', result: '交集 9 篇论文' },
    { tool: 'get_entity_by_constraint', args: '{ metric: "Fidelity+", gt: 0.85 }', result: '6 篇达标' },
    { tool: 'get_head_entity', args: '{ via: "measured_by" }', result: '聚合 Metric 节点 4 个' },
    { tool: 'count', args: '{ union(allSets) }', result: '覆盖 9/12 论文，缺口 3 篇标记 evidence_gap' },
  ],
};

export const USERS: UserRecord[] = [
  { username: 'demo', role: 'admin', status: 'active', lastActive: '2026-09-11 09:12' },
  { username: 'advisor_wang', role: 'researcher', status: 'active', lastActive: '2026-09-10 22:40' },
  { username: 'student_li', role: 'researcher', status: 'active', lastActive: '2026-09-09 16:05' },
  { username: 'guest_review', role: 'researcher', status: 'disabled', lastActive: '2026-08-30 11:02' },
];
