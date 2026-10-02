import { safeGet, safeSet } from './safeStorage';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  bgCard: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

export const themeTokens = {
  shiftColors: {
    emerald: {
      boxLight: 'bg-emerald-50 text-emerald-950 border-emerald-300/80 hover:bg-emerald-100/90 shadow-2xs',
      boxDark: 'dark:bg-emerald-950/70 dark:text-emerald-100 dark:border-emerald-700/80 dark:hover:bg-emerald-900/80',
      light: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-900',
        border: 'border-emerald-300',
        dot: 'bg-emerald-500',
      },
      dark: {
        bg: 'dark:bg-emerald-950/80',
        text: 'dark:text-emerald-200',
        border: 'dark:border-emerald-700',
        dot: 'dark:bg-emerald-400',
      },
    },
    amber: {
      boxLight: 'bg-amber-50 text-amber-950 border-amber-300/80 hover:bg-amber-100/90 shadow-2xs',
      boxDark: 'dark:bg-amber-950/70 dark:text-amber-100 dark:border-amber-700/80 dark:hover:bg-amber-900/80',
      light: {
        bg: 'bg-amber-100',
        text: 'text-amber-900',
        border: 'border-amber-300',
        dot: 'bg-amber-500',
      },
      dark: {
        bg: 'dark:bg-amber-950/80',
        text: 'dark:text-amber-200',
        border: 'dark:border-amber-700',
        dot: 'dark:bg-amber-400',
      },
    },
    blue: {
      boxLight: 'bg-blue-50 text-blue-950 border-blue-300/80 hover:bg-blue-100/90 shadow-2xs',
      boxDark: 'dark:bg-blue-950/70 dark:text-blue-100 dark:border-blue-700/80 dark:hover:bg-blue-900/80',
      light: {
        bg: 'bg-blue-100',
        text: 'text-blue-900',
        border: 'border-blue-300',
        dot: 'bg-blue-500',
      },
      dark: {
        bg: 'dark:bg-blue-950/80',
        text: 'dark:text-blue-200',
        border: 'dark:border-blue-700',
        dot: 'dark:bg-blue-400',
      },
    },
    purple: {
      boxLight: 'bg-purple-50 text-purple-950 border-purple-300/80 hover:bg-purple-100/90 shadow-2xs',
      boxDark: 'dark:bg-purple-950/70 dark:text-purple-100 dark:border-purple-700/80 dark:hover:bg-purple-900/80',
      light: {
        bg: 'bg-purple-100',
        text: 'text-purple-900',
        border: 'border-purple-300',
        dot: 'bg-purple-500',
      },
      dark: {
        bg: 'dark:bg-purple-950/80',
        text: 'dark:text-purple-200',
        border: 'dark:border-purple-700',
        dot: 'dark:bg-purple-400',
      },
    },
    rose: {
      boxLight: 'bg-rose-50 text-rose-950 border-rose-300/80 hover:bg-rose-100/90 shadow-2xs',
      boxDark: 'dark:bg-rose-950/70 dark:text-rose-100 dark:border-rose-700/80 dark:hover:bg-rose-900/80',
      light: {
        bg: 'bg-rose-100',
        text: 'text-rose-900',
        border: 'border-rose-300',
        dot: 'bg-rose-500',
      },
      dark: {
        bg: 'dark:bg-rose-950/80',
        text: 'dark:text-rose-200',
        border: 'dark:border-rose-700',
        dot: 'dark:bg-rose-400',
      },
    },
    indigo: {
      boxLight: 'bg-indigo-50 text-indigo-950 border-indigo-300/80 hover:bg-indigo-100/90 shadow-2xs',
      boxDark: 'dark:bg-indigo-950/70 dark:text-indigo-100 dark:border-indigo-700/80 dark:hover:bg-indigo-900/80',
      light: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-900',
        border: 'border-indigo-300',
        dot: 'bg-indigo-500',
      },
      dark: {
        bg: 'dark:bg-indigo-950/80',
        text: 'dark:text-indigo-200',
        border: 'dark:border-indigo-700',
        dot: 'dark:bg-indigo-400',
      },
    },
  },
};

export function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const saved = safeGet('coop_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    if (body) {
      body.classList.add('dark');
      body.setAttribute('data-theme', 'dark');
    }
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
    if (body) {
      body.classList.remove('dark');
      body.setAttribute('data-theme', 'light');
    }
  }
  safeSet('coop_theme', theme);
}
