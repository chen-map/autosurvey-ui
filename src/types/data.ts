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

export interface SubRQ {
  id: string;
  text: string;
  score: number;
  level: AnswerabilityLevel;
  paperCount: number;
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
