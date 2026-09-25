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
  WorkflowRun, PhaseState,
} from '@/types/data';
import { MOCK_PROJECTS } from '@/mock/data';
import { getPipeline as getPipelineData, PAPERS, PRISMA } from '@/mock/detail';
import { RQ_BUNDLES } from '@/mock/rq';
import { MOCK_KG_GRAPH } from '@/mock/kg';
import { OUTLINE, REVIEW_ROUNDS, AGENT_RUN, USERS } from '@/mock/detail';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

// ---- 模式切换 ----
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== '0';
const API = import.meta.env.VITE_API_BASE ?? '/api';

const TOKEN_KEY = 'as.token';
export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function realFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) setToken(null); // 会话过期
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
  seedFiles?: string[];
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
    const token = getToken();
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        title: input.title,
        field_tags: input.fieldTags,
        description: input.description,
        platforms: input.platforms ?? [],
        search_cap: input.searchCap ?? 2000,
        corpus_cap: input.corpusCap ?? 500,
        prescore: input.prescore ?? 0.25,
        local_dir: input.localDir ?? '',
        seed_files: input.seedFiles ?? [],
      }),
    });
    if (res.status === 401) throw new Error('未登录或会话过期，请重新登录');
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
  if (!USE_MOCK) {
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) return { ok: false, message: '账号或密码不正确' };
      const d = await r.json();
      setToken(d.token);
      return { ok: true, username: d.username, role: d.role === 'admin' ? 'admin' : 'researcher' };
    } catch {
      return { ok: false, message: '后端不可达，请确认已启动 FastAPI' };
    }
  }
  await delay(320);
  if (username === DEMO_ACCOUNT.username && password === DEMO_ACCOUNT.password) {
    return { ok: true, username, role: DEMO_ACCOUNT.role };
  }
  return { ok: false, message: '账号或密码不正确' };
}

// ---- pipeline ----
export async function startRun(projectId: string, workflow: 'w1' | 'w2' | 'w3' | 'w4' | 'w5' = 'w1'): Promise<void> {
  if (!USE_MOCK) {
    const token = getToken();
    const res = await fetch(`${API}/projects/${projectId}/run?workflow=${workflow}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) throw new Error('未登录或会话过期，请重新登录');
    if (!res.ok) throw new Error(`startRun 失败: ${res.status}`);
    return;
  }
  await delay(200);
}

// 后端 /run 返回 runner 的裸状态文件（phases 平铺），这里适配成前端 PipelineRun 契约
const WORKFLOW_META: Record<'w1' | 'w2' | 'w3' | 'w4' | 'w5', { id: string; name: string }> = {
  w1: { id: 'W1', name: '语料构建（检索 → 筛选 → 下载 → 入库）' },
  w2: { id: 'W2', name: '事实记忆构建（解析 → 提取 → 筛选 → KG）' },
  w3: { id: 'W3', name: '框架与 RQ 规划（Gap → RQ 设计 → 证据矩阵 → 评审）' },
  w4: { id: 'W4', name: '工作记忆构建（证据抽取 → 答案综合 → claim 核查）' },
  w5: { id: 'W5', name: '综述写作（大纲 → LaTeX 全文装配 → 自审）' },
};

interface RawPhase {
  id: string;
  name?: string;
  status?: string;
  duration_sec?: number;
  ended_at?: string;
  started_at?: string;
  note?: string;
}

function aggregateStatus(phases: { status: PhaseState['status'] }[]): PhaseState['status'] {
  if (!phases.length) return 'pending';
  if (phases.some((p) => p.status === 'failed')) return 'failed';
  if (phases.some((p) => p.status === 'running')) return 'running';
  if (phases.every((p) => p.status === 'done')) return 'done';
  return 'pending';
}

export async function getPipeline(projectId: string, workflow: 'w1' | 'w2' | 'w3' | 'w4' | 'w5' = 'w1'): Promise<PipelineRun> {
  if (USE_MOCK) {
    await delay();
    return getPipelineData(projectId);
  }
  const raw = await realFetch<{ project_id: string; started_at: string; updated_at: string; phases: RawPhase[] }>(
    `/projects/${projectId}/run?workflow=${workflow}`,
  );
  const meta = WORKFLOW_META[workflow];
  const phases: PhaseState[] = (raw.phases ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    status: (p.status ?? 'pending') as PhaseState['status'],
    durationSec: p.duration_sec,
  }));
  const wf: WorkflowRun = {
    id: meta.id,
    name: meta.name,
    status: aggregateStatus(phases),
    progress: phases.length ? Math.round((phases.filter((p) => p.status === 'done').length / phases.length) * 100) : 0,
    phases,
  };
  // 指标：语料（成功下载）与 KG（论文/边）尽力取数，缺哪个都不阻塞页面
  let papers = 0;
  let edges = 0;
  let kgPapers = 0;
  const [corpus, kg] = await Promise.all([
    getCorpus(projectId).catch(() => null),
    getKg(projectId).catch(() => null),
  ]);
  if (corpus) {
    const done = corpus.funnel?.find((f) => f.stage === '成功下载');
    papers = done?.count ?? 0;
  }
  if (kg) {
    kgPapers = kg.paperCount ?? kg.nodes.filter((n) => n.type.toLowerCase() === 'paper').length;
    edges = kg.edges.length;
    if (workflow === 'w2') papers = kgPapers;
  }
  const logs = (raw.phases ?? [])
    .map((p) => ({
      t: p.ended_at || p.started_at || raw.started_at,
      phase: p.id,
      line:
        (p.status === 'done' ? `✅ ${p.id} 完成` : p.status === 'failed' ? `❌ ${p.id} 失败` : `⏳ ${p.id} ${p.status ?? 'pending'}`) +
        (p.duration_sec != null ? ` · ${Math.round(p.duration_sec)}s` : '') +
        (p.note ? ` · ${p.note}` : ''),
    }))
    .reverse();
  const startedMs = Date.parse(String(raw.started_at).replace(' ', 'T'));
  const updatedMs = Date.parse(String(raw.updated_at || raw.started_at).replace(' ', 'T'));
  const elapsedSec = Number.isFinite(startedMs) && Number.isFinite(updatedMs) ? Math.max(0, (updatedMs - startedMs) / 1000) : 0;
  return {
    id: meta.id,
    projectId,
    startedAt: raw.started_at,
    elapsedSec,
    metrics: { papers, pairs: Math.round((papers * (papers - 1)) / 2), edges },
    workflows: [wf],
    logs,
  };
}

// ---- KG 图谱（W2 产物，Obsidian 风格力导向图数据） ----
export interface KgGraphEdge { source: string; target: string; type: string; confidence?: number }
export interface KgGraphData {
  nodes: { id: string; type: string; label: string; description?: string }[];
  edges: KgGraphEdge[];
  paperCount?: number;
}
export async function getKg(projectId: string): Promise<KgGraphData> {
  if (!USE_MOCK) return realFetch<KgGraphData>(`/projects/${projectId}/kg`);
  await delay(400);
  return MOCK_KG_GRAPH;
}

export async function getCorpus(projectId: string): Promise<{ papers: PaperRecord[]; funnel: PrismaLevel[] }> {
  if (!USE_MOCK) return realFetch<{ papers: PaperRecord[]; funnel: PrismaLevel[] }>(`/projects/${projectId}/corpus`);
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
