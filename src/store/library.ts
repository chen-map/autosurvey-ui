import { create } from 'zustand';

// 知识库：个人收藏的论文（localStorage 持久化；后端接入后切 API，见 docs/backend-todo.md）
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
    set({ items: next });
    return added;
  },
  addManual: (item) => {
    const next = [
      { ...item, collection: item.collection ?? '未分类', key: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toLocaleString() },
      ...get().items,
    ];
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    set({ items: next });
  },
  remove: (key) => {
    const next = get().items.filter((i) => i.key !== key);
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    set({ items: next });
  },
  moveTo: (key, collection) => {
    const next = get().items.map((i) => (i.key === key ? { ...i, collection } : i));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    set({ items: next });
  },
  addCollection: (name) => {
    const c = get().collections;
    const name0 = name.trim();
    if (!name0 || c.includes(name0)) return;
    const next = [...c, name0];
    localStorage.setItem(COLLS_KEY, JSON.stringify(next));
    set({ collections: next });
  },
}));
