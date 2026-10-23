import { create } from 'zustand';
import { api, ApiError } from '../api/client';

export interface User {
  id: string;
  email: string;
  /** admin = tenant admin, fde = forward deployed engineer (builder), user = end user. */
  role: 'admin' | 'fde' | 'user';
}

interface AuthState {
  /** undefined while the session check is in flight, null when signed out. */
  user: User | null | undefined;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: undefined,
  load: async () => {
    try {
      set({ user: (await api<{ user: User }>('/api/auth/me')).user });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) set({ user: null });
      else throw err;
    }
  },
  login: async (email, password) => {
    set({ user: (await api<{ user: User }>('/api/auth/login', { body: { email, password } })).user });
  },
  logout: async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    set({ user: null });
  },
}));
