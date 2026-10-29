import { create } from 'zustand';

export type Role = 'researcher' | 'admin';

interface AuthState {
  user: string | null;
  role: Role | null;
  login: (username: string, role?: Role) => void;
  logout: () => void;
}

const KEY = 'as.user';
const ROLE_KEY = 'as.role';

export const useAuth = create<AuthState>((set) => ({
  user: localStorage.getItem(KEY),
  role: (localStorage.getItem(ROLE_KEY) as Role | null) ?? null,
  login: (username, role) => {
    localStorage.setItem(KEY, username);
    if (role) localStorage.setItem(ROLE_KEY, role);
    set({ user: username, role: role ?? (localStorage.getItem(ROLE_KEY) as Role | null) ?? null });
  },
  logout: () => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ROLE_KEY);
    set({ user: null, role: null });
  },
}));
