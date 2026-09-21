// 业务数据类型（API 契约的一部分，见 docs/requirements.md 数据需求）
import type { ProjectStatus } from './index';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'checkpoint';

export interface PhaseState {
  id: string; // 如 W2-P3
  name: string;
  status: PhaseStatus;
  durationSec?: number;
}

export interface WorkflowRun {
  id: string; // W1..W5
  name: string;
  status: PhaseStatus;
  progress: number;
  phases: PhaseState[];
}

export interface PipelineRun {
  id: string;
  projectId: string;
  startedAt: string;
  elapsedSec: number;
  metrics: { papers: number; pairs: number; edges: number };
  workflows: WorkflowRun[];
  logs: { t: string; phase: string; line: string }[];
}

// ---------- 语料库 ----------
export type ScreenStage = '标题筛选' | '摘要筛选' | '可获取性' | '全文筛选' | '质量评估' | '已纳入';

export interface PaperRecord {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  citations: number;
  stage: ScreenStage;
  abstract: string;
  card: {
    problems: string[];
    methods: string[];
    datasets: string[];
    metrics: string[];
    limitations: string[];
    assumptions: string[];
  };
}

export interface PrismaLevel { stage: string; count: number; note?: string }

// ---------- RQ / 证据（W4 门面） ----------
export type AnswerabilityLevel = 'strong' | 'weak' | 'blocked';

export type RQType = 'descriptive' | 'comparative' | 'causal' | 'trend' | 'evaluative';

export interface KgQueryPath { path: string; expected: string }

export interface SubRQ {
  id: string;
  text: string;
  score: number;
  level: AnswerabilityLevel;
  paperCount: number;
  // ---- RQ 专页（主参考 W3-P2 RQ Designer / P3 Grounding 产出；后端可选提供） ----
  rqType?: RQType;
  summary?: string;             // RQ 简述（这个 RQ 在问什么的叙事概括）
  motivation?: string;          // 选择原因 · 来源（W3-P1 Gap 分析）
  roleInSurvey?: string;        // 选择原因 · 在综述中的角色（删去会怎样）
  definition?: string;          // 包含内容 · 总口径
  includedScope?: string[];     // 包含内容 · 纳入清单
  excludedScope?: string[];     // 包含内容 · 排除清单（及去向）
  focusTerms?: string[];        // 焦点词（P4 修订循环可扩展）
  analysisPlan?: string;        // 怎么分析 · 按 RQ 类型的答案组织策略
  analysisSteps?: string[];     // 怎么分析 · 执行步骤
  expectedEvidence?: string[];  // 预设 KG 证据类型
  kgQueryPaths?: KgQueryPath[]; // 候选 KG 查询路径
  deficiencies?: string[];      // 具体目前缺陷（证据/数据/口径层面）
  chapter?: string;             // 绑定大纲章节
  revisionNote?: string;        // P4 修订循环动作（blocked/weak 时）
}

export interface MacroRQ { id: string; text: string; subs: SubRQ[] }

export interface FrozenMatrix {
  frozenAt: string;
  entries: { subRqId: string; subRqText: string; papers: string[] }[];
}

export type ClaimStatus = 'verified' | 'needs_revision' | 'should_remove';

export interface ClaimDims { citation: boolean; semantic: boolean; coverage: boolean; crossPaper: boolean }

export interface ClaimSource { paperId: string; locator: string; kgPath: string }

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  dims: ClaimDims;
  sources: ClaimSource[];
  note?: string;
}

export interface EvidencePaper { id: string; title: string; venue: string; year: number }

export interface RQBundle {
  macros: MacroRQ[];
  matrix: FrozenMatrix | null;
  overallAnswer: string;
  claims: Claim[];
  evidencePapers: EvidencePaper[];
  evidenceGaps: string[];
}

// ---------- 报告 / Agent / 管理 ----------
export interface OutlineNode { id: string; title: string; rq?: string; papers?: number; children?: OutlineNode[] }

export interface ReviewRound { round: number; date: string; verdict: string; improvements: string[] }

export interface AgentStep { tool: string; args: string; result: string }

export interface AgentRun {
  rq: string;
  skill: { id: string; name: string; reason: string };
  steps: AgentStep[];
}

export interface UserRecord {
  username: string;
  role: 'researcher' | 'admin';
  status: 'active' | 'disabled';
  lastActive: string;
  projectStatus?: ProjectStatus;
}
