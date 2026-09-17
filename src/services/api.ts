// ============================================================
// API service 层 —— 双模式：mock（演示） / real（后端 FastAPI）
//
// 切换：VITE_USE_MOCK=0 走真实后端；默认走 mock 演示数据。
// 后端 API 契约见 docs/backend-todo.md。
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

// ---- 模式切换 ----
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== '0';
const API = import.meta.env.VITE_API_BASE ?? '/api';

async function realFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- listProjects ----
export async function listProjects(): Promise<Project[]> {
  if (!USE_MOCK) return realFetch<Project[]>('/projects');
  await delay();
  return [...MOCK_PROJECTS];
}

export async function getProject(id: string): Promise<Project | undefined> {
  if (!USE_MOCK) {
    const list = await realFetch<Project[]>('/projects');
    return list.find((p) => p.id === id);
  }
  await delay(140);
  return MOCK_PROJECTS.find((p) => p.id === id);
}

// ---- createProject ----
export interface NewProjectInput {
  title: string;
  fieldTags: string[];
  description?: string;
  platforms?: string[];
  searchCap?: number;
  corpusCap?: number;
  prescore?: number;
  localDir?: string;
}
export async function createProject(input: NewProjectInput): Promise<Project> {
  if (!USE_MOCK) {
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        field_tags: input.fieldTags,
        description: input.description,
        platforms: input.platforms ?? [],
        search_cap: input.searchCap ?? 2000,
        corpus_cap: input.corpusCap ?? 500,
        prescore: input.prescore ?? 0.25,
        local_dir: input.localDir ?? '',
      }),
    });
    if (!res.ok) throw new Error(`createProject 失败: ${res.status}`);
    const data = await res.json();
    return { id: data.project_id, title: input.title, fieldTags: input.fieldTags,
             description: input.description, status: 'draft',
             createdAt: new Date().toLocaleString(), updatedAt: new Date().toLocaleString(),
             stats: { papers: 0, kgEdges: 0, rqs: 0, claims: { verified: 0, needsRevision: 0, shouldRemove: 0 } },
             workflows: [], };
  }
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

// ---- login ----
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

// ---- pipeline ----
export async function getPipeline(projectId: string): Promise<PipelineRun> {
  if (!USE_MOCK) return realFetch<PipelineRun>(`/projects/${projectId}/run`);
  await delay();
  return getPipelineData(projectId);
}

export async function getCorpus(): Promise<{ papers: PaperRecord[]; funnel: PrismaLevel[] }> {
  if (!USE_MOCK) return realFetch<{ papers: PaperRecord[]; funnel: PrismaLevel[] }>('/projects/corpus');
  await delay();
  return { papers: PAPERS, funnel: PRISMA };
}

export async function getRQBundle(projectId: string): Promise<RQBundle | null> {
  if (!USE_MOCK) return realFetch<RQBundle | null>(`/projects/${projectId}/rqs`);
  await delay();
  return RQ_BUNDLES[projectId] ?? null;
}

export async function getReport(): Promise<{ outline: OutlineNode[]; reviews: ReviewRound[] }> {
  if (!USE_MOCK) return realFetch<{ outline: OutlineNode[]; reviews: ReviewRound[] }>('/projects/report');
  await delay();
  return { outline: OUTLINE, reviews: REVIEW_ROUNDS };
}

export async function getAgentRun(): Promise<AgentRun> {
  if (!USE_MOCK) return realFetch<AgentRun>('/projects/agent-runs');
  await delay();
  return AGENT_RUN;
}

export async function listUsers(): Promise<UserRecord[]> {
  if (!USE_MOCK) return realFetch<UserRecord[]>('/users');
  await delay();
  return [...USERS];
}
