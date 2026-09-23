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
// 类型对齐 autoSurvey_v2 W3 真实产物（WORKFLOW3_GUIDE.md §二/§三）：
//   analyze_report/rq_evidence_matrix.json（冻结）· rq_query_registry.json · survey_outline.json
// 其余字段来自 markdown 产物（gap_summary.md / design_report.md / rq_reflection_log.md），均为可选注解。
export type AnswerabilityLevel = 'strong' | 'weak' | 'blocked';

// rq_query_registry.json 中每个 Sub-RQ 的查询计划（结构化）
export interface QueryPlan {
  queryIntent?: string;      // 查询意图描述
  focusTerms?: string[];     // focus_terms 关键词列表
  nodeTypes?: string[];      // 目标 KG 节点类型
  edgeTypes?: string[];      // 目标 KG 边类型
  candidatePaths?: string[]; // 候选图路径模式
}

export interface SubRQ {
  id: string;                // 真实约定："RQ1.1"（点号层级）
  text: string;              // sub_rq_text
  score: number;             // answerability_score（W3-P3）
  level: AnswerabilityLevel; // 由 score 派生展示（strong ≥0.85 / weak ≥0.45 / blocked）
  paperIds: string[];        // 冻结 Paper ID 集合（rq_evidence_matrix.json）
  kgNodeCount: number;       // kg_node_ids 数
  kgEdgeCount: number;       // kg_edge_ids 数
  section: string;           // 绑定二级章节号，如 "4.1"（matrix.section + survey_outline.json）
  // ---- markdown 产物注解（可选，后端从对应 .md 抽取） ----
  summary?: string;          // design_report.md：Sub-RQ 简述
  motivation?: string;       // gap_summary.md：回应的 gap（W3-P1）
  roleInSurvey?: string;     // design_report.md：在综述中的角色
  definition?: string;       // design_report.md：口径与边界
  includedScope?: string[];  // design_report.md：纳入清单
  excludedScope?: string[];  // design_report.md：排除清单
  query?: QueryPlan;         // rq_query_registry.json：完整查询计划
  suggestedArtifact?: string;// survey_outline.json：建议综合产物（taxonomy_table 等）
  revisionNote?: string;     // rq_reflection_log.md：W3-P4 修订记录
}

export interface MacroRQ {
  id: string;                // 真实约定："RQ1"
  text: string;              // rq_text
  subs: SubRQ[];
  chapter?: string;          // 对应核心章节（W3-P2：每个 Macro 对应一个章节）
  summary?: string;          // design_report.md
  role?: string;             // design_report.md
  decompositionNote?: string;// design_report.md：Sub 拆分依据
  synthesisPlan?: string;    // design_report.md：Sub 答案 → Macro 结论的组织策略
  deficiencies?: string[];
}

// 冻结矩阵元信息（论文集合内嵌在各 Sub-RQ 上，与真实文件同构）
export interface FrozenMatrix { frozenAt: string }

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

export interface EvidencePaper {
  id: string; title: string; venue: string; year: number;
  authors?: string;   // 卡片作者（W3 证据增强）
  arxivId?: string;   // arXiv 编号（url 解析）
  doi?: string;       // download_ready.csv 锚定 DOI
}

export interface RQBundle {
  macros: MacroRQ[];
  matrix: FrozenMatrix | null;   // null = W3 未冻结
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
