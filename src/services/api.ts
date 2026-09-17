// ============================================================
// API service 层 —— REST 语义契约（见 docs/requirements.md「数据需求」）
//
//   GET  /projects                    → listProjects()
//   GET  /projects/:id                → getProject()
//   POST /projects                    → createProject()
//   POST /auth/login                  → login()
//   GET  /projects/:id/run            → getPipeline()
//   GET  /projects/:id/corpus         → getCorpus()
//   GET  /projects/:id/kg             → getRQBundle()（KG 子图/矩阵同源，画布在里程碑 3）
//   GET  /projects/:id/rqs            → getRQBundle()
//   GET  /projects/:id/report         → getReport()
//   GET  /projects/:id/agent-runs     → getAgentRun()
//   GET  /users                       → listUsers()
//
// 当前实现：mock 内存数据 + 模拟延迟（VITE_USE_MOCK 接缝，后端定稿后逐函数替换实现，签名不变）
// ============================================================
import type { Project } from '@/types';
import type {
  PipelineRun, PaperRecord, PrismaLevel, RQBundle,
  OutlineNode, ReviewRound, AgentRun, UserRecord,
} from '@/types/data';
import { MOCK_PROJECTS } from '@/mock/data';
import { getPipeline as getPipelineData, PAPERS, PRISMA } from '@/mock/detail';
import { RQ_BUNDLES } from '@/mock/rq';
import { OUTLINE, REVIEW_ROUNDS, AGENT_RUN, USERS } from '@/mock/detail';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

export async function listProjects(): Promise<Project[]> {
  await delay();
  return [...MOCK_PROJECTS];
}

export async function getProject(id: string): Promise<Project | undefined> {
  await delay(140);
  return MOCK_PROJECTS.find((p) => p.id === id);
}

export interface NewProjectInput {
  title: string;
  fieldTags: string[];
  description?: string; // 领域描述 → W1 P1 关键词提取输入
  platforms?: string[];
  searchCap?: number;
  corpusCap?: number;
  prescore?: number;
  localDir?: string;
}
export async function createProject(input: NewProjectInput): Promise<Project> {
  await delay(500);
  const now = new Date();
  const fmt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const p: Project = {
    id: `proj-${Date.now()}`,
    title: input.title,
    fieldTags: input.fieldTags,
    description: input.description,
    status: 'draft',
    createdAt: fmt,
    updatedAt: fmt,
    stats: { papers: 0, kgEdges: 0, rqs: 0, claims: { verified: 0, needsRevision: 0, shouldRemove: 0 } },
    workflows: (['W1', 'W2', 'W3', 'W4', 'W5'] as const).map((id) => ({
      id, name: { W1: '语料库构建', W2: '事实记忆(KG)', W3: '框架与RQ', W4: 'RQ证据', W5: '综述写作' }[id],
      status: 'pending', progress: 0,
    })),
  };
  MOCK_PROJECTS.unshift(p);
  return p;
}

export interface LoginResult {
  ok: boolean;
  username?: string;
  role?: 'researcher' | 'admin';
  message?: string;
}

const DEMO_ACCOUNT = { username: 'demo', password: '123456', role: 'admin' as const };

export async function login(username: string, password: string): Promise<LoginResult> {
  await delay(320);
  if (username === DEMO_ACCOUNT.username && password === DEMO_ACCOUNT.password) {
    return { ok: true, username, role: DEMO_ACCOUNT.role };
  }
  return { ok: false, message: '账号或密码不正确' };
}

export async function getPipeline(projectId: string): Promise<PipelineRun> {
  await delay();
  return getPipelineData(projectId);
}

export async function getCorpus(): Promise<{ papers: PaperRecord[]; funnel: PrismaLevel[] }> {
  await delay();
  return { papers: PAPERS, funnel: PRISMA };
}

export async function getRQBundle(projectId: string): Promise<RQBundle | null> {
  await delay();
  return RQ_BUNDLES[projectId] ?? null;
}

export async function getReport(): Promise<{ outline: OutlineNode[]; reviews: ReviewRound[] }> {
  await delay();
  return { outline: OUTLINE, reviews: REVIEW_ROUNDS };
}

export async function getAgentRun(): Promise<AgentRun> {
  await delay();
  return AGENT_RUN;
}

export async function listUsers(): Promise<UserRecord[]> {
  await delay();
  return [...USERS];
}
