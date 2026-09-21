// KG 图谱数据与视觉映射 —— 数据结构与 W2-P3 产物 paper_kg.json 同构
// ({nodes:[{id,type,label,description}], edges:[{source,target,type,confidence}]})

export type KgType = 'paper' | 'problem' | 'method' | 'dataset' | 'metric' | 'limitation' | 'assumption';

// 黑白账本基调 + 六类彩色证据（Obsidian 分组观感）
export const TYPE_COLORS: Record<KgType, string> = {
  paper: '#1a1a1a',
  problem: '#e53935',
  method: '#1e88e5',
  dataset: '#43a047',
  metric: '#fb8c00',
  limitation: '#8e24aa',
  assumption: '#6d7f8f',
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

// W2 真实 node_type（build_paper_kg.py）→ 前端 KgType
export function mapNodeType(realType: string): KgType {
  const lower = realType.toLowerCase() as KgType;
  if (lower in TYPE_COLORS) return lower; // 已是前端 KgType（mock/演示数据）
  const m: Record<string, KgType> = {
    Paper: 'paper', Problem: 'problem', Method: 'method',
    AssumptionConstraint: 'assumption', DatasetBenchmark: 'dataset',
    Metric: 'metric', Limitation: 'limitation', RQ: 'problem',
  };
  return m[realType] ?? 'method';
}

// 边类型视觉：矛盾红 / 支持绿 / 其余灰
export function edgeColor(type: string): string {
  if (type === 'contradicts') return '#e53935';
  if (type === 'supports') return '#2e7d32';
  return '#b9bec4';
}

export const EDGE_LABELS: Record<string, string> = {
  addresses: '研究该问题', proposes: '提出', targets: '针对',
  requires: '依赖约束', relaxes: '放宽约束', evaluated_on: '评估于',
  measured_by: '度量', has_limitation: '存在局限', extends: '扩展',
  compares_with: '对比', contradicts: '矛盾', supports: '支持', related: '关联',
};

export interface KgGraphNode { id: string; type: KgType; label: string; description?: string }
export interface KgGraphEdge { source: string; target: string; type: string; confidence?: number }

// 演示图谱：LLM Agent 安全主题（与 RQ mock 同一论文集）
const P = (id: string, label: string): KgGraphNode => ({ id, type: 'paper', label });
const N = (id: string, type: KgType, label: string, description = ''): KgGraphNode => ({ id, type, label, description });

export const MOCK_KG_GRAPH: { nodes: KgGraphNode[]; edges: KgGraphEdge[]; paperCount: number } = {
  nodes: [
    // 论文（8 篇，与 RQ mock 证据池一致）
    P('arXiv:2302.12173', 'Not What You\'ve Signed Up For（间接注入）'),
    P('arXiv:2306.05499', 'Prompt Injection Attack（LLM 集成应用）'),
    P('arXiv:2403.02691', 'InjecAgent（工具注入基准）'),
    P('arXiv:2402.10753', 'ToolSword（工具学习安全）'),
    P('arXiv:2406.13352', 'AgentDojo（攻防评测环境）'),
    P('arXiv:2401.10019', 'R-Judge（风险意识基准）'),
    P('arXiv:2403.14720', 'Spotlighting（注入防御）'),
    P('arXiv:2406.09187', 'GuardAgent（Agent 护栏）'),
    // 问题
    N('prob-inject', 'problem', '间接提示注入', '经工具返回值/检索内容污染 Agent 上下文'),
    N('prob-tool', 'problem', '工具链攻击', '恶意工具返回与参数滥用'),
    N('prob-jailbreak', 'problem', '越狱与对齐失效', '模型层安全对齐被绕过'),
    N('prob-longhorizon', 'problem', '长程任务防御失效', '多步任务中防御累积失效'),
    N('prob-coverage', 'problem', '基准覆盖不足', '现有基准对多步/中文场景覆盖弱'),
    // 方法
    N('m-spotlight', 'method', 'Spotlighting（数据标记）'),
    N('m-instr-hier', 'method', '指令层级分隔'),
    N('m-filter', 'method', '输入过滤判别器'),
    N('m-guard', 'method', 'GuardAgent 护栏架构'),
    // 数据集 / 基准
    N('ds-agentdojo', 'dataset', 'AgentDojo'),
    N('ds-rjudge', 'dataset', 'R-Judge'),
    N('ds-injecagent', 'dataset', 'InjecAgent'),
    // 指标
    N('mt-asr', 'metric', '攻击成功率'),
    N('mt-utility', 'metric', '任务性能保持'),
    // 局限 / 假设
    N('lim-synthetic', 'limitation', '基准场景偏合成', '真实任务分布覆盖有限'),
    N('lim-onestep', 'limitation', '单步评测为主', '缺少多步长程评测'),
    N('asm-trust', 'assumption', '假设：工具返回可信', '被间接注入直接打破'),
  ],
  edges: [
    // 论文 ─addresses→ 问题
    { source: 'arXiv:2302.12173', target: 'prob-inject', type: 'addresses' },
    { source: 'arXiv:2306.05499', target: 'prob-inject', type: 'addresses' },
    { source: 'arXiv:2403.02691', target: 'prob-inject', type: 'addresses' },
    { source: 'arXiv:2403.02691', target: 'prob-tool', type: 'addresses' },
    { source: 'arXiv:2402.10753', target: 'prob-tool', type: 'addresses' },
    { source: 'arXiv:2406.13352', target: 'prob-coverage', type: 'addresses' },
    { source: 'arXiv:2401.10019', target: 'prob-coverage', type: 'addresses' },
    { source: 'arXiv:2406.09187', target: 'prob-longhorizon', type: 'addresses' },
    // 论文 ─proposes→ 方法
    { source: 'arXiv:2403.14720', target: 'm-spotlight', type: 'proposes' },
    { source: 'arXiv:2406.09187', target: 'm-guard', type: 'proposes' },
    // 方法 ─targets→ 问题
    { source: 'm-spotlight', target: 'prob-inject', type: 'targets' },
    { source: 'm-instr-hier', target: 'prob-inject', type: 'targets' },
    { source: 'm-filter', target: 'prob-inject', type: 'targets' },
    { source: 'm-guard', target: 'prob-longhorizon', type: 'targets' },
    { source: 'm-guard', target: 'prob-tool', type: 'targets' },
    // 评估关系
    { source: 'arXiv:2403.14720', target: 'ds-agentdojo', type: 'evaluated_on' },
    { source: 'arXiv:2406.13352', target: 'ds-agentdojo', type: 'evaluated_on' },
    { source: 'arXiv:2403.02691', target: 'ds-injecagent', type: 'evaluated_on' },
    { source: 'arXiv:2401.10019', target: 'ds-rjudge', type: 'evaluated_on' },
    { source: 'm-spotlight', target: 'mt-asr', type: 'measured_by' },
    { source: 'm-spotlight', target: 'mt-utility', type: 'measured_by' },
    { source: 'm-guard', target: 'mt-asr', type: 'measured_by' },
    { source: 'arXiv:2406.13352', target: 'mt-asr', type: 'measured_by' },
    // 局限与假设
    { source: 'ds-agentdojo', target: 'lim-onestep', type: 'has_limitation' },
    { source: 'ds-injecagent', target: 'lim-synthetic', type: 'has_limitation' },
    { source: 'arXiv:2302.12173', target: 'asm-trust', type: 'contradicts' },
    // 论文间关系
    { source: 'arXiv:2403.02691', target: 'arXiv:2302.12173', type: 'extends' },
    { source: 'arXiv:2406.13352', target: 'arXiv:2403.02691', type: 'extends' },
    { source: 'arXiv:2403.14720', target: 'arXiv:2302.12173', type: 'supports' },
    { source: 'arXiv:2406.09187', target: 'arXiv:2403.14720', type: 'compares_with' },
    { source: 'arXiv:2306.05499', target: 'arXiv:2403.14720', type: 'contradicts' },
    { source: 'arXiv:2402.10753', target: 'arXiv:2406.13352', type: 'compares_with' },
    { source: 'arXiv:2401.10019', target: 'arXiv:2406.13352', type: 'compares_with' },
  ],
  paperCount: 8,
};
