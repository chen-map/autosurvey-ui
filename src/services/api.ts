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
import {
  asset, isShowcaseProject, loadManifest, showcaseFile, showcaseJson, showcaseText,
} from './showcase';

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

// 证据截图走 <img>，带不了 Authorization 头，改用 ?t=<token>
// 公开快照里的证据图是站内静态资源（showcase/...），直接走 BASE_URL。
export function evidenceImageUrl(path: string): string {
  if (path.startsWith('showcase/')) return asset(path);
  const token = getToken();
  return `${API}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

/** 综述 PDF 地址：公开快照为静态文件，真实后端需带 token 拉 blob。 */
export async function surveyPdfSource(projectId: string): Promise<{ url: string; auth: boolean }> {
  if (USE_MOCK && (await isShowcaseProject(projectId))) {
    return { url: showcaseFile(projectId, 'survey.pdf'), auth: false };
  }
  return { url: `${API}/projects/${projectId}/survey-pdf?t=${Date.now()}`, auth: true };
}

async function realFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    // 会话失效：清掉本地登录态并回登录页——否则 API 全 401，界面看起来像“后端断掉了”
    setToken(null);
    try {
      localStorage.removeItem('as.user');
      localStorage.removeItem('as.role');
    } catch { /* 忽略存储异常 */ }
    if (!window.location.hash.includes('/login')) {
      try { sessionStorage.setItem('as.flash', '登录已过期，请重新登录'); } catch { /* 忽略 */ }
      window.location.hash = '#/login';
    }
  }
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw;
    try {
      const j = JSON.parse(raw);
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch { /* 非 JSON 保持原文 */ }
    throw new Error(msg.length > 200 ? `${msg.slice(0, 200)}…` : msg);
  }
  return res.json();
}

// ---- listProjects ----
export async function listProjects(): Promise<Project[]> {
  if (!USE_MOCK) return realFetch<Project[]>('/projects');
  await delay();
  try {
    const m = await loadManifest();
    // 公开站以真实快照为主；没有快照时才退回旧的纯前端演示数据
    if (m.projects.length) return [...m.projects];
  } catch {
    /* fallthrough */
  }
  return [...MOCK_PROJECTS];
}

// ---- deleteProject ----
export async function deleteProject(id: string): Promise<void> {
  if (!USE_MOCK) {
    await realFetch<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });
    return;
  }
  if (await isShowcaseProject(id)) {
    throw new Error('公开快照为只读演示数据，不能删除');
  }
  await delay();
}

export async function getProject(id: string): Promise<Project | undefined> {
  if (!USE_MOCK) {
    const list = await realFetch<Project[]>('/projects');
    return list.find((p) => p.id === id);
  }
  await delay(140);
  const all = await listProjects();
  return all.find((p) => p.id === id);
}

// ---- createProject ----
export interface NewProjectInput {
  seedFiles?: string[];
  searchKeywords?: string[];
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
        search_keywords: input.searchKeywords ?? [],
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

// ---- register（注册成功即自动登录） ----
export async function register(username: string, password: string, email: string): Promise<LoginResult> {
  if (!USE_MOCK) {
    try {
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, message: d.detail ?? `注册失败 (${r.status})` };
      return login(username, password); // 注册即建数据分区，随后自动登录
    } catch {
      return { ok: false, message: '后端不可达，请确认已启动 FastAPI' };
    }
  }
  await delay(320);
  return { ok: true, username, role: 'researcher' };
}

// ---- 忘记密码 / 重置密码 ----
export async function forgotPassword(username: string): Promise<{ ok: boolean; message?: string }> {
  if (!USE_MOCK) {
    try {
      const r = await fetch(`${API}/auth/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, message: d.message ?? d.detail };
    } catch {
      return { ok: false, message: '后端不可达，请确认已启动 FastAPI' };
    }
  }
  await delay();
  return { ok: true, message: '（演示模式）重置链接已"发送"' };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; message?: string }> {
  if (!USE_MOCK) {
    try {
      const r = await fetch(`${API}/auth/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, message: d.message ?? d.detail };
    } catch {
      return { ok: false, message: '后端不可达，请确认已启动 FastAPI' };
    }
  }
  await delay();
  return { ok: true, message: '（演示模式）密码已重置' };
}

// ---- 绑定邮箱（找回密码通道；存量用户在个人中心补填） ----
export async function getProfile(): Promise<{ username: string; email: string }> {
  if (!USE_MOCK) return realFetch('/me/profile');
  await delay();
  return { username: 'demo', email: '' };
}

export async function putEmail(email: string): Promise<{ ok: boolean; email?: string; message?: string }> {
  if (!USE_MOCK) {
    try {
      const d = await realFetch<{ ok: boolean; email: string }>('/me/email', {
        method: 'PUT',
        body: JSON.stringify({ email }),
      });
      return { ok: true, email: d.email };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  await delay();
  return { ok: true, email };
}

// ---- pipeline ----
async function responseError(res: Response, fallback: string): Promise<Error> {
  const raw = await res.text().catch(() => '');
  let detail = raw;
  try {
    const j = JSON.parse(raw);
    detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
  } catch { /* 非 JSON 保持原文 */ }
  return new Error((detail || '').trim() || `${fallback} (${res.status})`);
}

export async function startRun(projectId: string, workflow: 'w1' | 'w2' | 'w3' | 'w4' | 'w5' = 'w1',
  opts: { w2MaxPairs?: number } = {}): Promise<void> {
  if (!USE_MOCK) {
    const token = getToken();
    const res = await fetch(`${API}/projects/${projectId}/run?workflow=${workflow}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: JSON.stringify(opts.w2MaxPairs != null ? { w2_max_pairs: opts.w2MaxPairs } : {}),
    });
    if (res.status === 401) throw new Error('未登录或会话过期，请重新登录');
    if (!res.ok) throw await responseError(res, '启动失败');
    return;
  }
  await delay(200);
}

export interface BuildConfig {
  title?: string;
  topic?: string;
  description?: string;
  search_keywords?: string[];
  year_range?: (string | number)[];
  corpus_cap?: number;
  domain_tags?: string[];
}

// 读取构建配置（W1 向导信息），供「修改配置重建」弹窗预填
export type W4Depth = 'quick' | 'standard' | 'deep';
export const getW4Depth = (projectId: string) =>
  realFetch<{ depth: W4Depth }>(`/projects/${projectId}/w4-depth`);
export const setW4Depth = (projectId: string, depth: W4Depth) =>
  realFetch<{ ok: boolean; depth: W4Depth; hint?: string }>(`/projects/${projectId}/w4-depth`, {
    method: 'PUT', body: JSON.stringify({ depth }),
  });

export async function getBuildConfig(projectId: string): Promise<BuildConfig> {
  if (!USE_MOCK) {
    const token = getToken();
    const res = await fetch(`${API}/projects/${projectId}/build-config`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`读取构建配置失败: ${res.status}`);
    return res.json();
  }
  await delay();
  return {};
}

// 修改构建配置并重建 W1：后端归档全部产物（含 W2-W5），下游需重新运行
export async function updateBuildConfig(projectId: string, cfg: BuildConfig): Promise<void> {
  if (!USE_MOCK) {
    const token = getToken();
    const res = await fetch(`${API}/projects/${projectId}/build-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cfg),
    });
    if (res.status === 401) throw new Error('未登录或会话过期，请重新登录');
    if (!res.ok) throw new Error(`保存失败: ${res.status}`);
    return;
  }
  await delay(200);
}

// 整工作流重跑（增量）：后端把全部阶段标 pending 重启 runner，
// 各阶段内部 checkpoint/幂等保证已有产物（已下载 PDF、已提取论文）自动跳过
export async function rerunWorkflow(projectId: string, workflow: string, force = false): Promise<void> {
  if (!USE_MOCK) {
    const token = getToken();
    const res = await fetch(`${API}/projects/${projectId}/workflows/${workflow}/rerun`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (res.status === 401) throw new Error('未登录或会话过期，请重新登录');
    if (res.status === 404) throw new Error('该工作流还没有运行记录，请先启动');
    if (!res.ok) throw await responseError(res, '重跑失败');
    return;
  }
  await delay(200);
}

// 后端 /run 返回 runner 的裸状态文件（phases 平铺），这里适配成前端 PipelineRun 契约
// 项目指标缓存：轮询每 4s 一次，corpus+KG 全量读取在大项目上是重操作，缓存 30s
const metricCache = new Map<string, { t: number; papers: number; edges: number; kgPapers: number }>();

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
  error?: string;
  error_kind?: string;
  tail?: string[];
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
    if (await isShowcaseProject(projectId)) {
      try {
        return await showcaseJson<PipelineRun>(projectId, 'pipeline.json');
      } catch {
        /* 快照缺文件时回退原演示数据 */
      }
    }
    return getPipelineData(projectId);
  }
  const raw = await realFetch<{ project_id: string; started_at: string; updated_at: string; phases: RawPhase[]; stale?: boolean; stale_note?: string;
    metrics?: { papers?: number; total_pairs?: number; candidate_pairs?: number; completed_pairs?: number; relation_edges?: number; prescore_passed?: number; status?: string } }>(
    `/projects/${projectId}/run?workflow=${workflow}`,
  );
  const meta = WORKFLOW_META[workflow];
  const phases: PhaseState[] = (raw.phases ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    status: (p.status ?? 'pending') as PhaseState['status'],
    durationSec: p.duration_sec,
    error: p.error,
    errorKind: p.error_kind,
    tail: p.tail,
    note: p.note,
  }));
  const wf: WorkflowRun = {
    id: meta.id,
    name: meta.name,
    status: aggregateStatus(phases),
    progress: phases.length ? Math.round((phases.filter((p) => p.status === 'done').length / phases.length) * 100) : 0,
    phases,
  };
  // 指标：语料（成功下载）与 KG（论文/边）尽力取数，缺哪个都不阻塞页面。
  // 轮询 4s 一次，全量拉 corpus+KG 在大项目上是几 MB 级读取——30s 缓存足够新鲜。
  let papers = 0;
  let edges = 0;
  let kgPapers = 0;
  const mc = metricCache.get(projectId);
  const mcFresh = mc && Date.now() - mc.t < 30_000;
  if (mcFresh && mc) {
    papers = mc.papers;
    edges = mc.edges;
    kgPapers = mc.kgPapers;
  } else {
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
    }
    metricCache.set(projectId, { t: Date.now(), papers, edges, kgPapers });
  }
  if (workflow === 'w2') papers = kgPapers;
  let pairs = Math.round((papers * (papers - 1)) / 2);
  let metricsNote: string | undefined;
  if (workflow === 'w2' && raw.metrics) {
    papers = raw.metrics.papers ?? papers;
    pairs = raw.metrics.candidate_pairs || raw.metrics.total_pairs || pairs;
    metricsNote = [
      `理论上限 ${Number(raw.metrics.total_pairs ?? 0).toLocaleString()} 对`,
      `预评分通过 ${Number(raw.metrics.candidate_pairs ?? 0).toLocaleString()}`,
      `已完成 ${Number(raw.metrics.completed_pairs ?? 0).toLocaleString()}`,
      `论文对关系边 ${Number(raw.metrics.relation_edges ?? 0).toLocaleString()}`,
      `KG 总边 ${Number(edges).toLocaleString()}（含 compares_with/extends 等语义边）`,
    ].join('；');
  } else if (workflow === 'w1') {
    metricsNote = `论文对为理论 C(${papers},2)，按 W1 下载数估算；W2 实际处理量会因解析/抽取/预评分减少。`;
  }
  const logs = (raw.phases ?? [])
    .flatMap((p) => {
      const base = {
        t: p.ended_at || p.started_at || raw.started_at,
        phase: p.id,
      };
      const lines = [{
        ...base,
        line:
          (p.status === 'done' ? `✅ ${p.id} 完成` : p.status === 'failed' ? `❌ ${p.id} 失败` : `⏳ ${p.id} ${p.status ?? 'pending'}`) +
          (p.duration_sec != null ? ` · ${Math.round(p.duration_sec)}s` : '') +
          (p.note ? ` · ${p.note}` : ''),
      }];
      // 失败阶段把日志尾部直接带进面板——不用再 SSH 上服务器看原因
      if (p.error) lines.push({ ...base, line: `   ↳ ${p.error}` });
      if (p.status === 'failed' && Array.isArray(p.tail)) {
        for (const l of p.tail.slice(-4)) lines.push({ ...base, line: `   ↳ ${l}` });
      }
      return lines;
    })
    .reverse();
  const startedMs = Date.parse(String(raw.started_at).replace(' ', 'T'));
  // running 时以当前时间计（runner 只在阶段边界写盘，updated_at 会冻结）
  const isRunning = wf.status === 'running';
  const endMs = isRunning ? Date.now() : Date.parse(String(raw.updated_at || raw.started_at).replace(' ', 'T'));
  const elapsedSec = Number.isFinite(startedMs) && Number.isFinite(endMs) ? Math.max(0, (endMs - startedMs) / 1000) : 0;
  return {
    id: meta.id,
    projectId,
    startedAt: raw.started_at,
    elapsedSec,
    stale: raw.stale,
    staleNote: raw.stale_note,
    metrics: { papers, pairs, edges, note: metricsNote },
    workflows: [wf],
    logs,
  };
}

// ---- 论文工作台（S1：文件读写 + 编译调度 + 单段生成）----
export interface PaperFileInfo { path: string; size: number; mtime: string }

export async function getPaperFiles(projectId: string): Promise<{ files: PaperFileInfo[]; backups: string[] }> {
  const raw = await realFetch<{ files: PaperFileInfo[]; backups: string[] }>(`/projects/${projectId}/paper/files`);
  return raw;
}

export async function getPaperFile(projectId: string, path: string): Promise<{ path: string; content: string }> {
  return realFetch(`/projects/${projectId}/paper/file?path=${encodeURIComponent(path)}`);
}

export async function savePaperFile(projectId: string, path: string, content: string) {
  return realFetch(`/projects/${projectId}/paper/file`, {
    method: 'PUT', body: JSON.stringify({ path, content }),
  });
}

export async function compilePaper(projectId: string) {
  return realFetch(`/projects/${projectId}/paper/compile`, { method: 'POST' });
}

export interface CompileStatus { status: string; log?: string; errors?: { file: string; line: number; msg: string }[] }

export async function getPaperCompileStatus(projectId: string): Promise<CompileStatus> {
  return realFetch(`/projects/${projectId}/paper/compile/status`);
}

export async function generateSection(projectId: string, path: string, instruction: string, skill = ''): Promise<{ latex: string; model: string; bib_keys: number; skill?: string; rq_ids?: string[]; claims_used?: number; copy_warning?: string }> {
  return realFetch(`/projects/${projectId}/paper/sections/generate`, {
    method: 'POST', body: JSON.stringify({ path, instruction, skill }),
  });
}

// ---- 论文工作台 S2：素材蒸馏 / 工作台大纲 / 段落改写 ----
export interface MaterialItem { id: string; name: string; kind: string; uploaded_at: string; distilled?: boolean; relevance?: { level: string; reason?: string } }
export interface DistillOutlineNode { title: string; summary?: string; children?: { title: string; summary?: string }[] }
export interface DistillResult { material: string; outline: DistillOutlineNode[]; dimensions: string[]; style_notes: string[]; excerpts?: DistillExcerpt[]; relevance?: { level: string; reason?: string } }
export interface OutlineEntry { file: string; title: string; order?: number; status?: string; summary?: string; from_material?: string; rq_ids?: string[]; sub_rq_ids?: string[]; from_rq?: string }

export const getPaperMaterials = (projectId: string) =>
  realFetch<{ materials: MaterialItem[] }>(`/projects/${projectId}/paper/materials`);

export const uploadPaperMaterial = (projectId: string, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return realFetch<{ ok: boolean; id: string; name: string }>(`/projects/${projectId}/paper/materials`, {
    method: 'POST', body: fd,
  });
};

export const distillMaterial = (projectId: string, mid: string) =>
  realFetch<{ ok: boolean; distill: DistillResult }>(`/projects/${projectId}/paper/materials/${mid}/distill`, { method: 'POST' });

export const getMaterialDistill = (projectId: string, mid: string) =>
  realFetch<DistillResult>(`/projects/${projectId}/paper/materials/${mid}/distill`);

export const getWorkbenchOutline = (projectId: string) =>
  realFetch<{ entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline`);

export const saveWorkbenchOutline = (projectId: string, entries: OutlineEntry[]) =>
  realFetch<{ ok: boolean; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline`, {
    method: 'PUT', body: JSON.stringify({ entries }),
  });

export const adoptOutline = (projectId: string, materialId: string, force = false) =>
  realFetch<{ ok: boolean; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline/adopt`, {
    method: 'POST', body: JSON.stringify({ material_id: materialId, force }),
  });

export const applyOutlineOrder = (projectId: string) =>
  realFetch<{ ok: boolean; moved: number; order: string[] }>(`/projects/${projectId}/paper/outline/apply_order`, {
    method: 'POST',
  });

export const initPaper = (projectId: string) =>
  realFetch<{ ok: boolean }>(`/projects/${projectId}/paper/init`, { method: 'POST' });

// ---- 模型连接测试（真实发一次最小 chat 请求）----
export interface LlmTestResult {
  ok: boolean; latency_ms?: number; model?: string; provider?: string;
  reply?: string; note?: string; error?: string;
}
export const testLlmConnection = (body: {
  baseUrl: string; model: string; apiKey: string; provider: string; useCase: string;
}) => realFetch<LlmTestResult>('/me/llm-test', { method: 'POST', body: JSON.stringify(body) });

// ---- Skill 工坊（W3/W5 模块级技能库 + 绑定）----
export interface SkillSlot {
  key: string; group: string; label: string; desc: string;
  tools: string[]; builtin?: string; bound: string[];
}
export interface SkillFile { name: string; chars: number; bound: string[] }
export const getSkillStudio = (projectId: string) =>
  realFetch<{ slots: SkillSlot[]; skills: SkillFile[]; bindings: Record<string, string[]>; notice: string }>(
    `/projects/${projectId}/skills`);
export const getSkillContent = (projectId: string, name: string) =>
  realFetch<{ name: string; content: string }>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`);
export const createSkill = (projectId: string, body: { name: string; content: string; slot?: string }) =>
  realFetch<{ ok: boolean; name: string }>(`/projects/${projectId}/skills`, { method: 'POST', body: JSON.stringify(body) });
export const updateSkill = (projectId: string, name: string, content: string) =>
  realFetch<{ ok: boolean; name: string }>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`, {
    method: 'PUT', body: JSON.stringify({ content }),
  });
export const deleteSkill = (projectId: string, name: string) =>
  realFetch<{ ok: boolean }>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const bindSkill = (projectId: string, body: { slot: string; name: string; action: 'bind' | 'unbind' }) =>
  realFetch<{ ok: boolean; slot: string; bound: string[] }>(`/projects/${projectId}/skills/bind`, {
    method: 'POST', body: JSON.stringify(body),
  });

// ---- 工作台白盒子流水线（大纲→编排→写作→精修）----
export interface WorkbenchStats {
  outline_entries: number;
  outline_landed: number;
  blocks_total: number;
  blocks_assigned: number;
  paragraphs: number;
  inserted: number;
  compile: string;
}
export interface WorkbenchState {
  stage: 'outline' | 'arrange' | 'write' | 'refine';
  locked_outline: boolean;
  w4_ready?: boolean;
  w4?: { sub_rqs: number; papers: number };
  stats: WorkbenchStats;
}

export const getWorkbench = (projectId: string) =>
  realFetch<WorkbenchState>(`/projects/${projectId}/paper/workbench`);

export const saveWorkbench = (projectId: string, body: { stage?: string; locked_outline?: boolean }) =>
  realFetch<WorkbenchState>(`/projects/${projectId}/paper/workbench`, {
    method: 'PUT', body: JSON.stringify(body),
  });

// ---- 编排看板（S1）：W4 证据块 + 见解 → 章内序列 ----
export interface ArrBlock { id: string; kind: string; title: string; source: string; note: string; rq_id?: string; macro_rq?: string; papers?: number }
export interface ArrChapter { file: string; title: string; blocks: ArrBlock[] }
export interface Arrangement { chapters: ArrChapter[]; pool: ArrBlock[] }
export interface InsightAnalysis { ok: boolean; related: string[]; position: string; evidence_needed: string }

export const getArrangement = (projectId: string) =>
  realFetch<Arrangement>(`/projects/${projectId}/paper/arrangement`);

export const saveArrangement = (projectId: string, a: Arrangement) =>
  realFetch<{ ok: boolean }>(`/projects/${projectId}/paper/arrangement`, {
    method: 'PUT', body: JSON.stringify(a),
  });

export const autoArrange = (projectId: string, onlyRq = false) =>
  realFetch<{
    ok: boolean; assigned: number; changed: number;
    summary: { file: string; title: string; count: number }[];
    empty_chapters: { file: string; title: string }[];
  } & Arrangement>(`/projects/${projectId}/paper/arrangement/auto`, {
    method: 'POST', body: JSON.stringify({ only_rq: onlyRq }),
  });

export const analyzeInsight = (projectId: string, text: string) =>
  realFetch<InsightAnalysis>(`/projects/${projectId}/paper/insight/analyze`, {
    method: 'POST', body: JSON.stringify({ text }),
  });

export const resetPaper = (projectId: string) =>
  realFetch<{ ok: boolean; backup: string }>(`/projects/${projectId}/paper/reset`, { method: 'POST' });

export const landAllOutline = (projectId: string) =>
  realFetch<{ ok: boolean; landed: number; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline/land_all`, { method: 'POST' });

export const createPaperSection = (projectId: string, title: string) =>
  realFetch<{ ok: boolean; file: string }>(`/projects/${projectId}/paper/sections/create`, {
    method: 'POST', body: JSON.stringify({ title }),
  });

export const rewriteParagraph = (projectId: string, text: string, instruction: string) =>
  realFetch<{ ok: boolean; text: string }>(`/projects/${projectId}/paper/paragraph`, {
    method: 'POST', body: JSON.stringify({ text, instruction }),
  });

// ---- 论文工作台 S3：内置骨架 / AI 起草 / 综合蒸馏 / 段落计划 / 逐段写作 ----
export interface SkeletonInfo { id: string; name: string; desc: string; chapters: number }
export interface BibKeyInfo { key: string; title: string }
export interface PlanParagraph { intent: string; cites: string[]; status: string; latex: string; prev_latex?: string }
export interface ChapterPlan { path: string; title?: string; paragraphs: PlanParagraph[]; updated_at?: string }
export interface DistillExcerpt { where: string; text: string; why: string }

export const composeOutline = (projectId: string, structure: string, instruction = '', keepEmpty = false, force = false) =>
  realFetch<{
    ok: boolean; entries: OutlineEntry[]; chapters: number; blocks: number;
    pool: number; rq_total: number; rq_used: number;
    analysis: string[]; dropped_empty: number;
  }>(`/projects/${projectId}/paper/outline/compose`, {
    method: 'POST', body: JSON.stringify({ structure, instruction, keep_empty: keepEmpty, force }),
  });

export const outlineFromRq = (projectId: string) =>
  realFetch<{ ok: boolean; entries: OutlineEntry[]; chapters: number; blocks: number; pool: number }>(
    `/projects/${projectId}/paper/outline/from_rq`, { method: 'POST', body: '{}' },
  );

export const getPaperSkeletons = (projectId: string) =>
  realFetch<{ skeletons: SkeletonInfo[] }>(`/projects/${projectId}/paper/skeletons`);

export const adoptBuiltinSkeleton = (projectId: string, skeletonId: string, mode: 'replace' | 'merge' = 'replace') =>
  realFetch<{ ok: boolean; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline/adopt_builtin`, {
    method: 'POST', body: JSON.stringify({ skeleton_id: skeletonId, mode }),
  });

export const draftOutline = (projectId: string, instruction: string, mode: 'replace' | 'merge' = 'replace') =>
  realFetch<{ ok: boolean; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline/draft`, {
    method: 'POST', body: JSON.stringify({ instruction, mode }),
  });

export const synthesizeOutline = (projectId: string, materialIds: string[], mode: 'replace' | 'merge' = 'replace') =>
  realFetch<{ ok: boolean; entries: OutlineEntry[] }>(`/projects/${projectId}/paper/outline/synthesize`, {
    method: 'POST', body: JSON.stringify({ material_ids: materialIds, mode }),
  });

// ---- W3：RQ 结构编辑（增删改排序 / 重新评分 / 证据增删）----
export const mutateRq = (projectId: string, body: Record<string, unknown>) =>
  realFetch<{ ok: boolean; rq_id?: string; sub_rq_id?: string; impact?: { papers: number; blocks: number }; hint?: string }>(
    `/projects/${projectId}/w3/rq/mutate`, { method: 'POST', body: JSON.stringify(body) });

export const editRqAnswer = (projectId: string, rqId: string, answer: string, subRqId = '') =>
  realFetch<{ ok: boolean; hint?: string }>(`/projects/${projectId}/w3/rq/answer`, {
    method: 'POST', body: JSON.stringify({ rq_id: rqId, sub_rq_id: subRqId, answer }),
  });

export const rescoreRq = (projectId: string, rqId = '') =>
  realFetch<{ ok: boolean; rescored: number; items: { sub_rq_id: string; papers: number; score: number; level: string }[] }>(
    `/projects/${projectId}/w3/rq/rescore`, { method: 'POST', body: JSON.stringify({ rq_id: rqId }) });

export const listKgPapers = (projectId: string, q = '') =>
  realFetch<{ count: number; items: { paper_id: string; title: string; year: number | null; venue: string }[] }>(
    `/projects/${projectId}/w3/rq/kg-papers?q=${encodeURIComponent(q)}`);

export const suggestRqText = (
  projectId: string,
  mode: 'revise' | 'rewrite' | 'expand_sub',
  text: string,
  opts?: { instruction?: string; macroText?: string },
) =>
  realFetch<{ ok: boolean; options: string[]; text?: string }>(`/projects/${projectId}/w3/rq/suggest`, {
    method: 'POST',
    body: JSON.stringify({ mode, text, instruction: opts?.instruction || '', macro_text: opts?.macroText || '' }),
  });

export const rematchBatch = (projectId: string, rqId: string, topN = 5, subRqId = '') =>
  realFetch<{ ok: boolean; subs: number; results: { sub_rq_id: string; kept?: number; added?: number; total?: number; score?: number; error?: string }[]; hint?: string }>(
    `/projects/${projectId}/w3/rq/rematch-batch`, {
      method: 'POST', body: JSON.stringify({ rq_id: rqId, top_n: topN, sub_rq_id: subRqId }),
    });

export interface RematchCandidate { paper_id: string; title: string; year: number | null; score: number; why: string[]; relevance?: number; reason?: string; abstract?: string; node_names?: string[] }
export const rematchRqEvidence = (projectId: string, rqId: string, subRqId: string) =>
  realFetch<{
    ok: boolean; terms: string[]; candidates: RematchCandidate[];
    nodes: { node_id?: string; type?: string; name: string; paper_id?: string }[];
    suggest: { score: number; level: string; papers: number; candidates?: number; nodes_matched?: number };
  }>(`/projects/${projectId}/w3/rq/rematch`, {
    method: 'POST', body: JSON.stringify({ rq_id: rqId, sub_rq_id: subRqId }),
  });

export const addRqPaper = (projectId: string, body: {
  title: string; abstract: string; year?: string; doi?: string; rq_id: string; sub_rq_id: string;
}) =>
  realFetch<{
    ok: boolean; paper_id: string; title: string; w1_added?: boolean;
    nodes_added?: number; edges_added?: number; linked_edges: number; hint?: string;
  }>(`/projects/${projectId}/w3/rq/add-paper`, { method: 'POST', body: JSON.stringify(body) });

export const editRqEvidence = (projectId: string, rqId: string, subRqId: string, add: string[], remove: string[]) =>
  realFetch<{ ok: boolean; papers: number; hint?: string }>(`/projects/${projectId}/w3/rq/evidence`, {
    method: 'POST', body: JSON.stringify({ rq_id: rqId, sub_rq_id: subRqId, add_paper_ids: add, remove_paper_ids: remove }),
  });

export const getPaperBib = (projectId: string) =>
  realFetch<{ count: number; entries: { key: string; title: string }[] }>(`/projects/${projectId}/paper/bib`);

export const addPaperBib = (projectId: string, title: string, authors = '', year = '') =>
  realFetch<{ ok: boolean; key: string; added: boolean; count: number }>(`/projects/${projectId}/paper/bib`, {
    method: 'POST', body: JSON.stringify({ title, authors, year }),
  });

export const getPaperBibkeys = (projectId: string) =>
  realFetch<{ count: number; keys: BibKeyInfo[] }>(`/projects/${projectId}/paper/bibkeys`);

export const getChapterPlan = (projectId: string, path: string) =>
  realFetch<{ plan: ChapterPlan }>(`/projects/${projectId}/paper/plan?path=${encodeURIComponent(path)}`);

export const generateChapterPlan = (projectId: string, path: string, instruction = '') =>
  realFetch<{ ok: boolean; plan: ChapterPlan; bib: Record<string, string>; bib_total: number }>(`/projects/${projectId}/paper/plan`, {
    method: 'POST', body: JSON.stringify({ path, instruction }),
  });

export const saveChapterPlan = (projectId: string, path: string, paragraphs: PlanParagraph[]) =>
  realFetch<{ ok: boolean; plan: ChapterPlan }>(`/projects/${projectId}/paper/plan`, {
    method: 'PUT', body: JSON.stringify({ path, paragraphs }),
  });

export const writeParagraph = (
  projectId: string, path: string, intent: string, cites: string[],
  opts?: { guidance?: string; reference_texts?: string[]; block_id?: string; skill?: string },
) =>
  realFetch<{
    ok: boolean; latex: string; used_cites: string[]; dropped_cites: string[];
    cjk_warning?: boolean; unverified_numbers?: string[]; evidence_papers?: number; claims_used?: number;
    style_samples?: number; skill?: string; rq_ids?: string[];
    bib: Record<string, string>;
  }>(
    `/projects/${projectId}/paper/paragraph/write`,
    { method: 'POST', body: JSON.stringify({ path, intent, cites, ...opts }) },
  );

export interface ConsistencyIssue { type: string; a: string; b: string; why: string; suggest: string }
export const generateClosingChapters = (projectId: string, sections?: string[]) =>
  realFetch<{ ok: boolean; created: { file: string; title: string; chars: number }[]; hint?: string; copy_warnings?: { section: string; overlap: string }[] }>(
    `/projects/${projectId}/paper/closing-chapters`, {
      method: 'POST', body: JSON.stringify(sections ? { sections } : {}),
    });

export const generateAbstract = (projectId: string) =>
  realFetch<{ ok: boolean; abstract: string; words: number; copy_warning?: string }>(`/projects/${projectId}/paper/abstract`, {
    method: 'POST', body: '{}',
  });

export const checkConsistency = (projectId: string) =>
  realFetch<{ ok: boolean; checked: number; issues: ConsistencyIssue[] }>(
    `/projects/${projectId}/paper/consistency`, { method: 'POST', body: '{}' },
  );

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
  if (await isShowcaseProject(projectId)) {
    try {
      return await showcaseJson<KgGraphData>(projectId, 'kg.json');
    } catch {
      /* fallthrough */
    }
  }
  return MOCK_KG_GRAPH;
}

export async function getCorpus(
  projectId: string,
  opts: { page?: number; pageSize?: number; status?: string } = {},
): Promise<{ papers: PaperRecord[]; funnel: PrismaLevel[]; total: number; page: number; pageSize: number }> {
  if (!USE_MOCK) {
    const q = new URLSearchParams();
    if (opts.page) q.set('page', String(opts.page));
    if (opts.pageSize) q.set('page_size', String(opts.pageSize));
    if (opts.status) q.set('status', opts.status);
    return realFetch(`/projects/${projectId}/corpus?${q.toString()}`);
  }
  await delay();
  if (await isShowcaseProject(projectId)) {
    try {
      const all = await showcaseJson<{ papers: PaperRecord[]; funnel: PrismaLevel[]; total: number }>(
        projectId, 'corpus.json');
      const filtered = opts.status ? all.papers.filter((p) => p.status === opts.status) : all.papers;
      const page = Math.max(1, opts.page ?? 1);
      const size = Math.max(1, opts.pageSize ?? 20);
      return {
        papers: filtered.slice((page - 1) * size, page * size),
        funnel: all.funnel,
        total: filtered.length,
        page,
        pageSize: size,
      };
    } catch {
      /* fallthrough */
    }
  }
  return { papers: PAPERS, funnel: PRISMA, total: PAPERS.length, page: 1, pageSize: PAPERS.length };
}

export async function getRQBundle(projectId: string): Promise<RQBundle | null> {
  if (!USE_MOCK) return realFetch<RQBundle | null>(`/projects/${projectId}/rqs`);
  await delay();
  if (await isShowcaseProject(projectId)) {
    try {
      return await showcaseJson<RQBundle>(projectId, 'rqs.json');
    } catch {
      return null;
    }
  }
  return RQ_BUNDLES[projectId] ?? null;
}

export interface W4Report {
  dir: string; rq_id: string; rq_text: string; skill: string; skill_reason: string;
  model: string; duration: number; rounds: number; calls: number;
}

export async function getW4Reports(projectId: string): Promise<W4Report[]> {
  if (!USE_MOCK) {
    const d = await realFetch<{ reports: W4Report[] }>(`/projects/${projectId}/w4-reports`);
    return d.reports;
  }
  await delay();
  if (await isShowcaseProject(projectId)) {
    try {
      return await showcaseJson<W4Report[]>(projectId, 'reports.json');
    } catch {
      return [];
    }
  }
  return [];
}

function _reportWithAnchorGuard(html: string): string {
  if (html.includes("data-as-inframe-anchor")) return html;
  const script = `<script data-as-inframe-anchor>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;var id=a.getAttribute("href").slice(1);if(!id)return;var el=document.getElementById(id);if(!el)return;e.preventDefault();e.stopPropagation();el.scrollIntoView({behavior:"smooth",block:"start"});});<\/script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, script + "</body>") : html + script;
}

export async function fetchW4ReportHtml(projectId: string, dir: string): Promise<string> {
  if (USE_MOCK && (await isShowcaseProject(projectId))) {
    return _reportWithAnchorGuard(await showcaseText(projectId, `w4/${encodeURIComponent(dir)}.html`));
  }
  // HTML 报告需带 Authorization → text → blob URL（同 survey-pdf 模式）
  const API = import.meta.env.VITE_API_BASE ?? '/api';
  const token = localStorage.getItem('as.token') ?? '';
  const r = await fetch(`${API}/projects/${projectId}/w4-reports/${encodeURIComponent(dir)}/html`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return _reportWithAnchorGuard(await r.text());
}

export async function getReport(projectId: string): Promise<{ outline: OutlineNode[]; reviews: ReviewRound[] }> {
  if (!USE_MOCK) return realFetch<{ outline: OutlineNode[]; reviews: ReviewRound[] }>(`/projects/${projectId}/report`);
  await delay();
  if (await isShowcaseProject(projectId)) {
    try {
      return await showcaseJson<{ outline: OutlineNode[]; reviews: ReviewRound[] }>(projectId, 'report.json');
    } catch {
      /* fallthrough */
    }
  }
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
