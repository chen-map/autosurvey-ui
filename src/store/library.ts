import { create } from 'zustand';

// 知识库：个人收藏的论文（localStorage 持久化；后端接入后切 API，见 docs/backend-todo.md）
export interface LibraryItem {
  key: string;
  paperIdx: number;
  title: string;
  authors: string;
  venue: string;
  year: number;
  citations: number;
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

interface LibraryState {
  items: LibraryItem[];
  collections: string[];
  toggleSave: (item: Omit<LibraryItem, 'key' | 'collection' | 'savedAt'>) => boolean;
  remove: (key: string) => void;
  moveTo: (key: string, collection: string) => void;
  addCollection: (name: string) => void;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  items: read(ITEMS_KEY, []),
  collections: read(COLLS_KEY, ['方法参考', '待精读']),
  toggleSave: (item) => {
    const items = get().items;
    const existing = items.find((i) => i.paperIdx === item.paperIdx);
    let next: LibraryItem[];
    let added: boolean;
    if (existing) {
      next = items.filter((i) => i.paperIdx !== item.paperIdx);
      added = false;
    } else {
      next = [
        { ...item, key: `lib-${item.paperIdx}`, collection: '未分类', savedAt: new Date().toLocaleString() },
        ...items,
      ];
      added = true;
    }
    localStorage.setItem(ITEMS_KEY, JSON.stringify(next));
    set({ items: next });
    return added;
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
