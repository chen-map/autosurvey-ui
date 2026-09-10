import { create } from 'zustand';

// F0-3 只读演示模式：投屏/答辩时隐藏一切写操作
interface UiState {
  readOnly: boolean;
  toggleReadOnly: () => void;
}

const KEY = 'as.readonly';

export const useUi = create<UiState>((set) => ({
  readOnly: localStorage.getItem(KEY) === '1',
  toggleReadOnly: () =>
    set((s) => {
      const next = !s.readOnly;
      localStorage.setItem(KEY, next ? '1' : '0');
      return { readOnly: next };
    }),
}));
