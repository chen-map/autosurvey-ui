// 个人 API Key 库 —— 真实模式：后端加密存储（Fernet at rest，接口只回掩码）；
// 演示模式：本浏览器 localStorage。掩码镜像写回同一 localStorage 键，供向导/个人中心 UI 显示。
import { USE_MOCK } from '@/services/api';

const LS_APIKEYS = 'as.apikeys';
const API = import.meta.env.VITE_API_BASE ?? '/api';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('as.token') ?? '';
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function readApiKeys(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_APIKEYS) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveApiKey(platform: string, key: string) {
  const all = readApiKeys();
  if (key.trim()) all[platform] = key.trim();
  else delete all[platform];
  localStorage.setItem(LS_APIKEYS, JSON.stringify(all));
  return all;
}

// 真实模式：从后端拉掩码镜像到本地（真实模式启动时调用）
export async function syncKeysFromBackend(): Promise<Record<string, string>> {
  if (USE_MOCK) return readApiKeys();
  const res = await fetch(`${API}/me/api-keys`, { headers: authHeaders() });
  if (!res.ok) return readApiKeys();
  const d = await res.json();
  localStorage.setItem(LS_APIKEYS, JSON.stringify(d.keys ?? {}));
  return d.keys ?? {};
}

// 真实模式：保存到后端加密库，掩码镜像回本地；演示模式仅本地
export async function pushKeyToBackend(platform: string, key: string): Promise<Record<string, string>> {
  if (USE_MOCK) return saveApiKey(platform, key);
  if (!key.trim()) {
    await fetch(`${API}/me/api-keys/${encodeURIComponent(platform)}`, { method: 'DELETE', headers: authHeaders() });
  } else {
    const res = await fetch(`${API}/me/api-keys`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ platform, key: key.trim() }),
    });
    if (!res.ok) throw new Error(`保存失败 ${res.status}`);
  }
  return syncKeysFromBackend();
}
