'use client';

import { create } from 'zustand';

interface BreadcrumbState {
  /** Map of pathname to custom title string */
  customTitles: Record<string, string>;
  /** Set a custom title for a specific path */
  setCustomTitle: (path: string, title: string) => void;
  /** Remove a custom title */
  clearCustomTitle: (path: string) => void;
}

/**
 * Zustand store to manage dynamic breadcrumb titles.
 * Allows pages to override the automatically generated breadcrumb titles.
 */
export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  customTitles: {},
  setCustomTitle: (path, title) => {
    const normalizedPath = path.toLowerCase().replace(/\/+$/, '') || '/';
    set((state) => ({
      customTitles: { ...state.customTitles, [normalizedPath]: title }
    }));
  },
  clearCustomTitle: (path) => {
    const normalizedPath = path.toLowerCase().replace(/\/+$/, '') || '/';
    set((state) => {
      const newTitles = { ...state.customTitles };
      delete newTitles[normalizedPath];
      return { customTitles: newTitles };
    });
  }
}));
