// ============================================================
// API service 层 —— REST 语义契约（见 docs/requirements.md「数据需求」）
//
//   GET  /projects                 → listProjects()
//   POST /auth/login               → login()
//
// 当前实现：mock 内存数据 + 200–400ms 模拟延迟。
// 后端（FastAPI 包装层）定稿后，逐个函数替换为 fetch 实现，
// 函数签名与返回类型保持不变（F0-4，docs/requirements.md）。
// ============================================================
import type { Project } from '@/types';
import { MOCK_PROJECTS } from '@/mock/data';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

export async function listProjects(): Promise<Project[]> {
  await delay();
  return [...MOCK_PROJECTS];
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
