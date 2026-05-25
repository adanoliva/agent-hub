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
  includedAgents?: string[];
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
  agentsDirectoryUrl?: string;
  agentsDirectoryEnabled?: boolean;
  dismissedDashboardNotifications?: string[];
  categories: Category[];
  projects: Project[];
}

export interface SyncConflict {
  fileKey:    string;
  localPath:  string;
  remotePath: string;
  remoteSHA:  string;
  localSHA:   string;
  name:       string;
}

export interface AgentSyncProgress {
  done:    number;
  total:   number;
  current: string;
}

export interface AgentDirectoryStatus {
  enabled:          boolean;
  url:              string;
  syncing:          boolean;
  firstSync:        boolean;
  progress:         AgentSyncProgress;
  lastSync:         string | null;
  repoCommitSHA:    string | null;
  agentCount:       number;
  pendingConflicts: SyncConflict[];
  lastResult:       { updated: number; skipped: number; errors: { path: string; error: string }[]; error?: string; upToDate?: boolean } | null;
}

export type View = 'dashboard' | 'projects' | 'agents' | 'chat' | 'settings';

export interface DashboardNotification {
  id:         string;
  type:       'critical' | 'optimization' | 'info';
  target:     'agent' | 'project';
  targetName: string;
  scopeLabel?: string;
  targetId?:  string;
  message:    string;
  action:     'open-agent' | 'open-project' | 'sync-project' | 'generate-context' | 'optimize-agent';
  level?:     string;
  categoryId?: string | null;
  techId?:    string | null;
}

export interface DashboardData {
  agents:    { total: number; global: number; section: number; tech: number; uncategorized: number };
  projects:  { total: number; active: number; paused: number; archived: number; withPending: number; totalPending: number };
  lastSyncAt: string | null;
  dirStatus: { enabled: boolean; syncing: boolean; lastSync: string | null; pendingConflicts: SyncConflict[]; lastResult: any };
  notifications: DashboardNotification[];
  hiddenNotifications?: number;
}

export interface SelectedNode {
  level: 'global' | 'section' | 'tech' | 'project' | 'uncategorized';
  categoryId: string | null;
  techId: string | null;
  projectId: string | null;
}

export interface AIUsageEntry {
  calls:            number;
  inputTokens:      number;
  outputTokens:     number;
  estimatedCostUSD: number;
  since:            string;
}

export interface AIUsage {
  cumulative: AIUsageEntry;
  session:    AIUsageEntry;
}

export interface ProjectContextInfo {
  content:    string;
  type:       'claude' | 'github';
  label:      string;
  filePath:   string;
  mismatch:   boolean;
  mismatchDetails: { appProvider: string; projectProvider: string; message: string } | null;
  isEmpty:    boolean;
  isDefault:  boolean;
  sizeBytes:  number;
  lastUpdated: string | null;
}

export type ToastType = 'ok' | 'err' | 'info' | 'warn';

export interface Toast {
  id: string;
  msg: string;
  type: ToastType;
}
