export interface Technology {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  technologies: Technology[];
}

export interface Project {
  id: string;
  name: string;
  categoryId: string;
  techId?: string;
  path: string;
  description?: string;
  status: 'active' | 'paused' | 'archived';
  aiProvider?: string;
  selectedAgents?: string[];
  excludedAgents?: string[];
  agentHashes?: Record<string, string>;
  createdAt: string;
  // enriched by listProjectsWithStatus
  pendingUpdates?: number;
  pathExists?: boolean;
}

export interface SyncEntry {
  status: 'ok' | 'outdated' | 'new' | 'local' | 'excluded';
  agent?: { level: string; [k: string]: unknown };
}

export type SyncStatus = Record<string, SyncEntry>;

export interface Agent {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  system?: string;
  optimized?: boolean;
  level?: 'global' | 'section' | 'tech' | 'project';
  categoryId?: string;
  techId?: string;
  projectId?: string;
  suggested?: boolean;
}

export interface Config {
  version: string;
  aiProvider: 'cli' | 'api' | 'github';
  apiKey: string;
  githubToken: string;
  githubModel: string;
  theme: 'dark' | 'light';
  closeAction?: 'ask' | 'tray' | 'quit';
  categories: Category[];
  projects: Project[];
}

export type View = 'projects' | 'agents' | 'chat' | 'settings';

export interface SelectedNode {
  level: 'global' | 'section' | 'tech' | 'project';
  categoryId: string | null;
  techId: string | null;
  projectId: string | null;
}

export type ToastType = 'ok' | 'err' | 'info' | 'warn';

export interface Toast {
  id: string;
  msg: string;
  type: ToastType;
}
