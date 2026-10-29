// ============================================================
// GitHub Pages 公开快照：真实运行产物的只读静态副本
//
// 与 mock 数据的区别：这些是 .64 上真实跑完的项目，导出为 JSON/PDF/证据图，
// 由 tools/export_showcase.py 生成，不含后端源码、账号、路径或密钥。
// ============================================================
import type { Project } from '@/types';

export interface ShowcaseEndpoint {
  method: string;
  path: string;
  static: string;
  desc: string;
}

export interface ShowcaseManifest {
  generatedAt: string;
  note: string;
  projects: Project[];
  endpoints: ShowcaseEndpoint[];
}

const BASE = import.meta.env.BASE_URL || '/';
let cache: ShowcaseManifest | null = null;
let pending: Promise<ShowcaseManifest> | null = null;

export function asset(rel: string): string {
  return `${BASE}${rel.replace(/^\//, '')}`;
}

export function loadManifest(): Promise<ShowcaseManifest> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch(asset('showcase/manifest.json'), { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`showcase manifest ${r.status}`);
        return r.json() as Promise<ShowcaseManifest>;
      })
      .then((m) => {
        cache = m;
        return m;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

export async function isShowcaseProject(id: string): Promise<boolean> {
  try {
    const m = await loadManifest();
    return m.projects.some((p) => p.id === id);
  } catch {
    return false;
  }
}

export async function showcaseJson<T>(id: string, file: string): Promise<T> {
  const r = await fetch(asset(`showcase/${id}/${file}`), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`showcase ${file} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function showcaseText(id: string, file: string): Promise<string> {
  const r = await fetch(asset(`showcase/${id}/${file}`), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`showcase ${file} ${r.status}`);
  return r.text();
}

export function showcaseFile(id: string, file: string): string {
  return asset(`showcase/${id}/${file}`);
}

export function showcaseRaw(rel: string): string {
  return asset(rel);
}
