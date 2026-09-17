// API 契约类型（对应 docs/requirements.md「数据需求」节）
// service 层按 REST 语义命名，后端定稿后仅替换实现、类型不变

export type WorkflowId = 'W1' | 'W2' | 'W3' | 'W4' | 'W5';
export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'checkpoint';
export type ProjectStatus = 'running' | 'completed' | 'draft';

export interface WorkflowSummary {
  id: WorkflowId;
  name: string;
  status: PhaseStatus;
  progress: number; // 0–100
}

export interface ClaimStats {
  verified: number;
  needsRevision: number;
  shouldRemove: number;
}

export interface Project {
  id: string;
  title: string;
  fieldTags: string[];
  description?: string; // 领域描述/研究目标 → W1 关键词提取与 Gap 分析的输入
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  stats: {
    papers: number;
    kgEdges: number;
    rqs: number;
    claims: ClaimStats;
  };
  workflows: WorkflowSummary[];
}
