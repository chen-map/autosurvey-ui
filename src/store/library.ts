import { create } from 'zustand';
import { USE_MOCK } from '@/services/api';

// 知识库：个人收藏的论文。持久化：演示模式 localStorage；真实模式后端 KV 同步（启动拉取 + 变更推送）
// source：corpus=语料库收藏（paperIdx 关联语料库）；upload=上传 PDF；manual=手动录入
export interface LibraryItem {
  key: string;
  paperIdx?: number;
  source: 'corpus' | 'upload' | 'manual';
  title: string;
  authors?: string;
  venue?: string;
  year?: number;
  citations?: number;
  collection: string;
  savedAt: string;
}

const ITEMS_KEY = 'as.library-items';
const COLLS_KEY = 'as.library-collections';

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export interface NewLibraryInput {
  paperIdx?: number;
  source: LibraryItem['source'];
  title: string;
  authors?: string;
  venue?: string;
  year?: number;
  citations?: number;
  collection?: string;
}

interface LibraryState {
  items: LibraryItem[];
  collections: string[];
  toggleSave: (item: NewLibraryInput) => boolean;
  addManual: (item: NewLibraryInput) => void;
  remove: (key: string) => void;
  moveTo: (key: string, collection: string) => void;
  addCollection: (name: string) => void;
}

function pushLibrary(items: LibraryItem[], collections: string[]) {
  if (USE_MOCK) return;
  const API = import.meta.env.VITE_API_BASE ?? '/api';
  const token = localStorage.getItem('as.token') ?? '';
  fetch(`${API}/me/library`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ items, collections }),
  }).catch(() => {});
}

async function pullLibrary(set: (s: Partial<LibraryState>) => void) {
  if (USE_MOCK) return;
  const API = import.meta.env.VITE_API_BASE ?? '/api';
  const token = localStorage.getItem('as.token') ?? '';
  try {
    const res = await fetch(`${API}/me/library`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const d = await res.json();
    if (Array.isArray(d.items) && d.items.length > 0) {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(d.items));
      if (Array.isArray(d.collections) && d.collections.length > 0) localStorage.setItem(COLLS_KEY, JSON.stringify(d.collections));
      set({ items: d.items, collections: d.collections?.length ? d.collections : read(COLLS_KEY, ['方法参考', '待精读']) });
    }
  } catch { /* 后端不可达时保留本地 */ }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  items: read(ITEMS_KEY, []),
  collections: read(COLLS_KEY, ['方法参考', '待精读']),
  toggleSave: (item) => {
    const items = get().items;
    const existing = items.find((i) => i.source === 'corpus' && i.paperIdx === item.paperIdx);
    let next: LibraryItem[];
    let added: boolean;
    if (existing) {
      next = items.filter((i) => i.key !== existing.key);
      added = false;
    } else {
      next = [
        { ...item, key: `lib-c-${item.paperIdx}`, collection: '未分类', savedAt: new Date().toLocaleString() },
        ...items,
      ];
      added = true;
    }
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    pushLibrary(next, get().collections);
    set({ items: next });
    return added;
  },
  addManual: (item) => {
    const next = [
      { ...item, collection: item.collection ?? '未分类', key: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toLocaleString() },
      ...get().items,
    ];
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    pushLibrary(next, get().collections);
    set({ items: next });
  },
  remove: (key) => {
    const next = get().items.filter((i) => i.key !== key);
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    pushLibrary(next, get().collections);
    set({ items: next });
  },
  moveTo: (key, collection) => {
    const next = get().items.map((i) => (i.key === key ? { ...i, collection } : i));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    pushLibrary(next, get().collections);
    set({ items: next });
  },
  addCollection: (name) => {
    const c = get().collections;
    const name0 = name.trim();
    if (!name0 || c.includes(name0)) return;
    const next = [...c, name0];
    localStorage.setItem(COLLS_KEY, JSON.stringify(next));
    pushLibrary(get().items, next);
    set({ collections: next });
  },
}));

// 真实模式：启动时从后端拉取收藏覆盖本地
void pullLibrary(useLibrary.setState);
