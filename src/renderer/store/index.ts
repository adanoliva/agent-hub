import { create } from 'zustand';
import { req } from '../api';
import type { Config, Project, Toast, ToastType, View } from '../types';

interface AppState {
  // Core
  view: View;
  config: Config | null;
  projects: Project[];
  appVersion: string | null;

  // Toasts
  toasts: Toast[];

  // Actions
  setView: (v: View) => void;
  setConfig: (c: Config) => void;
  setProjects: (p: Project[]) => void;
  setAppVersion: (v: string) => void;
  fetchProjects: () => Promise<void>;
  addToast: (msg: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<AppState>((set) => ({
  view: 'projects',
  config: null,
  projects: [],
  appVersion: null,
  toasts: [],

  setView: (view) => set({ view }),
  setConfig: (config) => set({ config }),
  setProjects: (projects) => set({ projects }),
  setAppVersion: (appVersion) => set({ appVersion }),

  fetchProjects: async () => {
    const projects = await req<Project[]>('GET', '/projects');
    set({ projects });
  },

  addToast: (msg, type = 'ok') => {
    const id = `${Date.now()}-${Math.random()}`;
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, type === 'err' || type === 'warn' ? 5000 : 3500);
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
