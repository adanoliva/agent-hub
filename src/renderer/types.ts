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
  /** @deprecated techId is no longer used in new projects — kept for backward compat */
  techId?: string;
  path: string;
  description?: string;
  status: 'active' | 'paused' | 'archived';
  aiProviders: string[]; // Replaces aiProvider
  skills?: string[];
  selectedAgents?: string[];
  excludedAgents?: string[];
  includedAgents?: string[];
  agentHashes?: Record<string, string>;
  createdAt: string;
  // enriched by listProjectsWithStatus
  pendingUpdates?: number;
  pathExists?: boolean;
  gitEnabled?: boolean;
}

export interface ProjectProvider {
  id: string;
  label: string;
  icon: string;
  agentDir: string[];
  contextFile: string;
  templateType: 'claude' | 'github' | 'gemini' | 'openai';
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
  level?: 'global' | 'section' | 'project' | 'uncategorized';
  categoryId?: string;
  projectId?: string;
  suggested?: boolean;
  skills?: string[];
  mcp_servers?: string[];
}

export interface Skill {
  name:        string;
  description: string;
  content:     string;
}

export type AIProvider =
  | 'cli'          // Claude Code CLI
  | 'gemini-cli'   // Gemini CLI
  | 'codex-cli'    // OpenAI Codex CLI
  | 'copilot-cli'  // GitHub Copilot CLI
  | 'aider-cli'    // Aider CLI
  | 'cline-cli'    // Cline CLI
  | 'goose-cli'    // Goose CLI
  | 'api'          // Anthropic API
  | 'openai'       // OpenAI API
  | 'github'       // GitHub Models
  | 'gemini-api'   // Gemini API
  | 'mistral'      // Mistral API
  | 'grok'         // Grok (xAI)
  | 'deepseek'     // DeepSeek API
  | 'groq'         // Groq API
  | 'openrouter'   // OpenRouter API
  | 'perplexity'   // Perplexity API
  | string;         // Dynamic custom providers

export interface CustomAIProvider {
  id: string;
  name: string;
  type: 'api' | 'cli';
  isOpenAICompatible?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  cliBin?: string;
  cliArgs?: string[];
  icon?: string;
}

export interface Config {
  version: string;
  aiProvider: AIProvider;
  customProviders?: CustomAIProvider[];

  // Anthropic API
  apiKey: string;
  apiModel?: string;

  // OpenAI API
  openaiKey?: string;
  openaiModel?: string;

  // GitHub Models
  githubToken: string;
  githubModel: string;

  // Gemini API
  geminiApiKey?: string;
  geminiApiModel?: string;

  // Mistral API
  mistralKey?: string;
  mistralModel?: string;

  // Grok (xAI)
  grokKey?: string;
  grokModel?: string;

  // DeepSeek API
  deepseekKey?: string;
  deepseekModel?: string;

  // Groq API
  groqKey?: string;
  groqModel?: string;

  // OpenRouter API
  openrouterKey?: string;
  openrouterModel?: string;

  // Perplexity API
  perplexityKey?: string;
  perplexityModel?: string;

  // CLI models
  geminiCliModel?: string;
  codexCliModel?: string;

  closeAction?: 'ask' | 'tray' | 'quit';
  agentsDirectoryUrl?: string;
  agentsDirectoryEnabled?: boolean;
  dismissedDashboardNotifications?: string[];
  // Browser automation
  browserPreferredBrowser?: 'auto' | 'chrome' | 'edge' | 'brave' | 'firefox';
  browserCdpPort?: number;
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

export type View = 'dashboard' | 'projects' | 'agents' | 'chat' | 'settings' | 'orchestrations';

// ── Browser automation types ────────────────────────────────────────────────────────

export interface BrowserTab {
  id:    string;
  url:   string;
  title: string;
}

export interface BrowserInstalled {
  key:    string;
  name:   string;
  engine: string;
}

export interface BrowserStatus {
  connected:  boolean;
  cdpActive:  boolean;
  cdpPort:    number;
  browserKey: string | null;
  tabs:       BrowserTab[];
  installed:  BrowserInstalled[];
}

// ── Orchestration types ───────────────────────────────────────────────────────

export interface DataFlow {
  agentOutput:    boolean;
  filesModified:  boolean;
  projectContext:       boolean;
}

export interface FixedContext {
  freeText: string;
  files:    string[];
}

export interface TemporalContext {
  id:          string;
  type:        'file' | 'text';
  label:       string;
  placeholder?: string;
  required:    boolean;
}

export interface ContextExtra {
  fixed:    FixedContext;
  temporal: TemporalContext[];
}

/** @deprecated Formato lineal — migrado automáticamente a OrchestrationNode al leer */
export interface OrchestrateNode {
  id:           string;
  from:         number;
  to:           number;
  dataFlow:     DataFlow;
  contextExtra: ContextExtra;
  gateAfter?:   boolean;
  scriptParams?: Record<string, unknown>;
}

/** Nodo del grafo DAG de orquestación paralela */
export interface OrchestrationNode {
  id:            string;          // UUID estable del nodo
  agentName:     string;          // nombre del agente o "__script:name__"
  dependsOn:     string[];        // ids de nodos predecesores ([] = nodo raíz)
  x?:            number;          // posición en el canvas (px)
  y?:            number;
  dataFlow:      DataFlow;
  contextExtra:  ContextExtra;
  gateAfter?:    boolean;
  scriptParams?: Record<string, unknown>;
}

export interface ExecutionConfig {
  stopOnError:           boolean;
  validateAfterEachStep: boolean;
  maxTurns:              number;
  timeout:               number;
  maxContextChars?:      number;  // max chars for user message per step (default 12 000)
  requiresBrowser?:      boolean;
}

export interface Orchestration {
  id:                   string;
  projectId:            string;
  name:                 string;
  description:          string;
  enabled:              boolean;
  nodes:                OrchestrationNode[];   // DAG — único formato desde v2.3
  executionConfig:      ExecutionConfig;
  createdAt:            string;
  updatedAt:            string;
  lastExecutedAt?:      string;
  lastExecutionStatus?: 'success' | 'partial' | 'failed';
  executionCount:       number;
  lastExecutionCost?:         number;
  lastExecutionCostIsApprox?: boolean;
  // Campos legacy (formato lineal) — presentes solo al leer ficheros antiguos
  // antes de que migrateOrchestration() los transforme. No usar directamente.
  /** @deprecated */ agents?:    string[];
  /** @deprecated */ inputNode?: OrchestrateNode;
}

export interface QualityScore {
  score:         number;
  grade:         'green' | 'amber' | 'red';
  filesProduced: number;
  filesExpected: number;
  jsonValid:     boolean | null;
  coverageRatio: number | null;
  checks:        Array<{ name: string; passed: boolean; detail?: string }>;
}

export interface ExecutionState {
  executionId:       string;
  orchestrationId:   string;
  projectId:         string;
  status:            'running' | 'completed' | 'failed' | 'paused_gate';
  lastCompletedStep: number;
  startedAt:         string;
  pauseStartedAt?:   string;
  pausedAtStep?:     number;
  steps:             Record<string, { status: 'success' | 'error' | 'warning'; filesModified: string[] }>;
}

export interface StepRevision {
  at:                    string;
  feedback:              string | null;
  previousFilesModified: string[];
}

export interface StepResult {
  stepIndex:     number;
  nodeId?:       string;   // id del nodo DAG (disponible desde v2.3)
  agentName:     string;
  input:         { systemPrompt: string; userMessage: string };
  output:        { response: string; handoff?: { done: string; changed: string[]; issues: string[]; next: string }; toolCalls?: unknown[]; toolResults?: unknown[] };
  filesModified: string[];
  tokensUsed:    { input: number; output: number };
  estimatedCost: number;
  duration:      number;
  status:        'success' | 'error' | 'warning';
  error?:        { message: string; category: string; recoverable: boolean };
  backupPath:    string | null;
  qualityScore?: QualityScore;
  revisions?:    StepRevision[];
  gitCommitSha?: string;
}

export interface ExecutionSummary {
  filesModified: number;
  filesCreated:  number;
  filesDeleted:  number;
  linesAdded:    number;
  linesRemoved:  number;
}

export interface ExecutionResult {
  orchestrationId: string;
  projectId:       string;
  executionId:     string;
  startedAt:       string;
  completedAt:     string;
  duration:        number;
  status:          'success' | 'partial' | 'failed';
  stepsCompleted:  number;
  totalSteps:      number;
  totalTokensUsed: { input: number; output: number };
  estimatedCost:   number;
  results:         StepResult[];
  errors:          Array<{ message: string; category: string; recoverable: boolean }>;
  summary:         ExecutionSummary;
  changes:         Array<{ path: string; status: string }>;
  backups:         Record<string, string | null>;
}

export interface ExecutionLog {
  timestamp: string;
  level:     'info' | 'warn' | 'error' | 'debug';
  message:   string;
  data?:     unknown;
}

export interface PendingAgentToEdit {
  name: string;
  level: 'global' | 'section' | 'uncategorized' | 'project';
  categoryId?: string | null;
  projectId?: string | null;
}

export interface PendingNewAgentDraft {
  name?: string;
  description?: string;
  system?: string;
  tools?: string[];
  model?: string;
}

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
}

export interface DashboardData {
  agents:         { total: number; global: number; section: number; tech: number; uncategorized: number };
  projects:       { total: number; active: number; paused: number; archived: number; withPending: number; totalPending: number };
  orchestrations: { total: number; success: number; failed: number; partial: number; neverRun: number; totalCost: number; totalCostIsApprox: boolean };
  lastSyncAt: string | null;
  dirStatus: { enabled: boolean; syncing: boolean; lastSync: string | null; pendingConflicts: SyncConflict[]; lastResult: any };
  projectHealth?: Array<{
    projectId: string;
    name: string;
    status: 'healthy' | 'warning' | 'critical';
    pathExists: boolean;
    pendingUpdates: number;
    staleSync: boolean;
    contextState: 'ok' | 'thin' | 'missing';
    lastSyncAt: string | null;
    issues: string[];
  }>;
  notifications: DashboardNotification[];
  hiddenNotifications?: number;
  hiddenDismissed?: number;
  hiddenSnoozed?: number;
}

export interface SyncPreviewAgent {
  name: string;
  level: string;
  categoryId: string | null;
}

export interface SyncPreview {
  summary: {
    toAdd: number;
    toUpdate: number;
    excluded: number;
    local: number;
    upToDate: number;
    total: number;
  };
  toAdd: SyncPreviewAgent[];
  toUpdate: SyncPreviewAgent[];
  excluded: SyncPreviewAgent[];
  local: SyncPreviewAgent[];
  upToDate: SyncPreviewAgent[];
}

export interface SelectedNode {
  level: 'global' | 'section' | 'project' | 'uncategorized';
  categoryId: string | null;
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

export interface AtomicOp {
  id:              string;
  executionId:     string;
  orchestrationId: string;
  stepIndex:       number;
  agentName:       string;
  kind:            'add' | 'modify' | 'remove';
  filePath:        string;
  status:          'applied' | 'reverted';
  createdAt:       string;
  appliedAt:       string;
  revertedAt?:     string;
}

export interface OpsLedger {
  projectId?:       string;
  orchestrationId:  string;
  ops:              AtomicOp[];
  lastUpdated?:     string;
}

export type ToastType = 'ok' | 'err' | 'info' | 'warn';

export interface Toast {
  id: string;
  msg: string;
  type: ToastType;
}
