import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

/** Kept separate from the workflow store so "Clear canvas" doesn't reset it. */
export const THEME_STORAGE_KEY = 'wf-theme';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

const systemTheme = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: systemTheme(),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    }),
    { name: THEME_STORAGE_KEY, partialize: ({ theme }) => ({ theme }) },
  ),
);

// index.html sets data-theme before first paint; keep it in sync from here on.
applyTheme(useThemeStore.getState().theme);
useThemeStore.subscribe(({ theme }) => applyTheme(theme));
