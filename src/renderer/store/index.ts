import { create } from 'zustand';
import { req } from '../api';
import type { Config, Project, Toast, ToastType, View } from '../types';

interface AppState {
  // Core
  view: View;
  config: Config | null;
  projects: Project[];
  appVersion: string | null;

  // Wizard
  showWizard: boolean;

  // Pending action (consumed by target page on mount)
  pendingAction: string | null;

  // Agent name to preload in Chat (consumed on mount)
  pendingChatAgent: string | null;

  // Toasts
  toasts: Toast[];

  // Actions
  setView: (v: View) => void;
  navigateTo: (v: View, action?: string) => void;
  setPendingAction: (a: string | null) => void;
  setPendingChatAgent: (name: string | null) => void;
  setConfig: (c: Config) => void;
  setProjects: (p: Project[]) => void;
  setAppVersion: (v: string) => void;
  fetchProjects: () => Promise<void>;
  setShowWizard: (v: boolean) => void;
  addToast: (msg: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<AppState>((set) => ({
  view: 'dashboard',
  config: null,
  projects: [],
  appVersion: null,
  showWizard: !localStorage.getItem('cdm-wizard-done'),
  pendingAction: null,
  pendingChatAgent: null,
  toasts: [],

  setView: (view) => set({ view }),
  navigateTo: (view, action) => set({ view, pendingAction: action ?? null }),
  setPendingAction: (pendingAction) => set({ pendingAction }),
  setPendingChatAgent: (pendingChatAgent) => set({ pendingChatAgent }),
  setConfig: (config) => set({ config }),
  setProjects: (projects) => set({ projects }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setShowWizard: (showWizard) => set({ showWizard }),

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
