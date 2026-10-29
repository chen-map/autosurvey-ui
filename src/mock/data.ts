import type { Project, WorkflowSummary } from '@/types';

export const WORKFLOW_NAMES = {
  W1: '语料库构建',
  W2: '事实记忆(KG)',
  W3: '框架与RQ',
  W4: 'RQ证据',
  W5: '综述写作',
} as const;

// 两个 mock 快照（workflow.md「推演中发现的缺口」：答辩讲到哪演到哪）
// 快照一：全流程已完成
const completedWorkflows = (['W1', 'W2', 'W3', 'W4', 'W5'] as const).map((id) => ({
  id,
  name: WORKFLOW_NAMES[id],
  status: 'done' as const,
  progress: 100,
}));

// 快照二：W3 进行中（W1/W2 完成，W3 P2 RQ 设计中）
const runningWorkflows: WorkflowSummary[] = [
  { id: 'W1', name: WORKFLOW_NAMES.W1, status: 'done' as const, progress: 100 },
  { id: 'W2', name: WORKFLOW_NAMES.W2, status: 'done' as const, progress: 100 },
  { id: 'W3', name: WORKFLOW_NAMES.W3, status: 'running' as const, progress: 35 },
  { id: 'W4', name: WORKFLOW_NAMES.W4, status: 'pending' as const, progress: 0 },
  { id: 'W5', name: WORKFLOW_NAMES.W5, status: 'pending' as const, progress: 0 },
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-llm-agent-safety',
    title: '大语言模型 Agent 安全综述',
    fieldTags: ['LLM 安全', '智能体', '对抗攻击'],
    status: 'running',
    createdAt: '2026-09-06 10:24',
    updatedAt: '2026-09-10 14:02',
    stats: {
      papers: 154,
      kgEdges: 289,
      rqs: 0, // W3 P2 进行中，矩阵未冻结
      claims: { verified: 0, needsRevision: 0, shouldRemove: 0 },
    },
    workflows: runningWorkflows,
  },
  {
    id: 'proj-gnn-survey',
    title: '图神经网络可解释性综述',
    fieldTags: ['GNN', '可解释性'],
    status: 'completed',
    createdAt: '2026-08-18 09:11',
    updatedAt: '2026-09-02 18:47',
    stats: {
      papers: 162,
      kgEdges: 313,
      rqs: 4,
      claims: { verified: 6, needsRevision: 1, shouldRemove: 1 },
    },
    workflows: completedWorkflows,
  },
  {
    id: 'proj-diffusion-draft',
    title: '扩散模型在时序预测中的应用（草稿）',
    fieldTags: ['扩散模型', '时序'],
    status: 'draft',
    createdAt: '2026-09-09 16:40',
    updatedAt: '2026-09-09 16:52',
    stats: {
      papers: 0,
      kgEdges: 0,
      rqs: 0,
      claims: { verified: 0, needsRevision: 0, shouldRemove: 0 },
    },
    workflows: (['W1', 'W2', 'W3', 'W4', 'W5'] as const).map((id) => ({
      id,
      name: WORKFLOW_NAMES[id],
      status: 'pending' as const,
      progress: 0,
    })),
  },
];
