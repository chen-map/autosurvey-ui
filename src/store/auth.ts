import { create } from 'zustand';

interface AuthState {
  user: string | null;
  login: (username: string) => void;
  logout: () => void;
}

const KEY = 'as.user';

export const useAuth = create<AuthState>((set) => ({
  user: localStorage.getItem(KEY),
  login: (username) => {
    localStorage.setItem(KEY, username);
    set({ user: username });
  },
  logout: () => {
    localStorage.removeItem(KEY);
    set({ user: null });
  },
}));
