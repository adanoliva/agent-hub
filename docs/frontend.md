# Documentación técnica — Frontend (`src/renderer/`)

> Stack: React 19 + Vite 8 + Zustand 5 + TypeScript
> Última actualización: 2026-05-30 · Versión: 1.9.4

---

## Estructura

```
src/renderer/
├── index.html              ← shell HTML (CSP, fuentes, Tabler Icons CDN v3.6.0)
├── main.tsx                ← ReactDOM.createRoot
├── App.tsx                 ← ErrorBoundary + AppInner + lazy pages
├── styles.css              ← todos los estilos (variables CSS + clases globales)
├── api.ts                  ← req<T>(method, path, body?): fetch tipado a /api/*
├── types.ts                ← tipos compartidos
├── store/index.ts          ← Zustand store global
├── hooks/
│   ├── useToast.ts         ← devuelve addToast directamente (no objeto)
│   ├── useCategoryHelpers.ts ← catName, catColor, techName desde config
│   └── useElectron.ts      ← pickFolder, pickFile (IPC wrappers)
├── constants/tools.ts      ← ALL_TOOLS[], agentIcon(), MODEL_ICON, LEVEL_COLOR
├── components/
│   ├── layout/             ← Sidebar, Topbar, Statusbar
│   ├── ui/                 ← Toast, Modal, Wizard, CloseDialog
│   ├── projects/           ← ProjectCard, ProjectDrawer, modales
│   ├── agents/             ← AgentCard, AgentsTree, AgentsCenter, AgentEditor, AgentExecutePanel
│   └── orchestrations/     ← OrchestrationList, NodeCanvas, ConnectionConfigurator, OrchestrationEditor, ExecutionPanel
└── pages/
    ├── Dashboard.tsx
    ├── Projects.tsx
    ├── Agents.tsx
    ├── Chat.tsx
    ├── Orchestrations.tsx
    └── Settings.tsx
```

**Flujo de datos:** renderer → `req()` (HTTP) → Express :3737 · renderer → `window.api` (IPC) → Electron main. El renderer nunca accede directamente al FS ni al IPC sin pasar por estos dos canales.

**Navegación:** sin React Router. El campo `view` del store Zustand controla qué página se renderiza. Las páginas se cargan con `React.lazy` + wrapper `.then(m => ({ default: m.PageName }))` porque usan named exports.

**Wizard:** visible si `localStorage.getItem('cdm-wizard-done')` no existe, o si `store.showWizard === true` (relanzado desde Ajustes).

---

## Comunicación API (`src/renderer/api.ts`)

Todas las peticiones deben usar el helper `req()`.

**Reglas Críticas:**
- **Sin prefijo redundante**: `req()` ya añade `/api`. Usar `req('GET', '/projects')`, NO `req('GET', '/api/projects')`.
- **APIs Nativas**: Para casos como `new EventSource()` o `fetch()` manual, usar la constante exportada `API_BASE`.

```typescript
import { req, API_BASE } from './api';

// Correcto
const projects = await req<Project[]>('GET', '/projects');

// Correcto para SSE
const es = new EventSource(`${API_BASE}/stream`);
```

---

## Estado global (`store/index.ts`)

```ts
interface AppState {
  view:          'dashboard' | 'projects' | 'agents' | 'chat' | 'settings' | 'orchestrations';
  config:        Config | null;
  projects:      Project[];
  appVersion:    string | null;
  toasts:        Toast[];
  showWizard:    boolean;
  pendingAction:       string | null;          // 'new-agent' | 'new-project' | null
  pendingAgentToEdit:  PendingAgentToEdit | null; // agente a abrir en editor (consumido por Agents al montar)
  pendingChatAgent:    string | null;          // nombre del agente a precargar al entrar en Chat

  setView, setConfig, setProjects, setAppVersion,
  fetchProjects(): Promise<void>;   // GET /projects → actualiza store
  setShowWizard(v: boolean): void;
  addToast(msg: string, type?: 'ok'|'err'|'info'|'warn'): void;  // auto-dismiss 3.5s / 5s para err|warn
  removeToast(id: string): void;
  navigateTo(view: View, action?: string): void;  // setView + setPendingAction en un solo paso
  setPendingAction(a: string | null): void;
  setPendingAgentToEdit(p: PendingAgentToEdit | null): void;  // usado desde Dashboard para navegar a agente concreto
  setPendingChatAgent(name: string | null): void;  // usado desde Agents para precargar agente en Chat
}
```

Uso: `useStore(s => s.campo)` para leer (solo rerenderiza cuando cambia ese slice). Acceso imperativo: `useStore.getState().addToast(...)`.

---

## Tipos compartidos (`types.ts`)

```ts
interface Agent {
  name: string; description: string; model: string; tools: string[]; system: string;
  optimized?: boolean;   // true → el editor no muestra el botón "Optimizar con IA"
  level?: 'global' | 'section' | 'tech' | 'project' | 'uncategorized';
  categoryId?: string | null; techId?: string | null; projectId?: string | null;
  suggested?: boolean;   // agente sugerido por IA, no guardado aún
}

interface Project {
  id: string; name: string; categoryId: string; techId?: string; path: string;
  description: string; status: 'active' | 'paused' | 'archived';
  aiProvider: 'claude' | 'github' | 'both';
  selectedAgents: string[]; excludedAgents: string[];
  agentHashes: Record<string, string>;
  createdAt: string;
  pendingUpdates?: number;   // calculado en servidor
  pathExists?: boolean;      // calculado en servidor
}

interface Config {
  version: string; aiProvider: AIProvider;
  customProviders?: CustomAIProvider[];
  apiKey: string; githubToken: string; githubModel: string;
  closeAction?: 'ask' | 'tray' | 'quit';
  agentsDirectoryUrl?: string; agentsDirectoryEnabled?: boolean;
  categories: Category[]; projects: Project[];
}

interface AgentDirectoryStatus {
  enabled: boolean; url: string; syncing: boolean;
  firstSync: boolean;   // true si cache/agents-meta.json no existía al iniciar
  progress: { done: number; total: number; current: string };
  lastSync: string | null; repoCommitSHA: string | null; agentCount: number;
  pendingConflicts: SyncConflict[];
  lastResult: { updated: number; skipped: number; errors: {...}[]; error?: string; upToDate?: boolean } | null;
}

interface SyncConflict { fileKey: string; localPath: string; remotePath: string; remoteSHA: string; localSHA: string; name: string; }
type SyncStatus = Record<string, { status: 'ok'|'outdated'|'new'|'local'|'excluded'; agent: Agent }>;
interface SelectedNode { level: 'global'|'section'|'tech'|'project'|'uncategorized'; categoryId: string|null; techId: string|null; projectId: string|null; }

interface PendingAgentToEdit {
  name: string;
  level: 'global' | 'section' | 'tech' | 'uncategorized' | 'project';
  categoryId?: string | null;
  techId?: string | null;
  projectId?: string | null;
}

interface SyncPreviewAgent { name: string; level: string; categoryId: string | null; techId: string | null; }
interface SyncPreview {
  summary: { toAdd: number; toUpdate: number; excluded: number; local: number; upToDate: number; total: number };
  toAdd: SyncPreviewAgent[]; toUpdate: SyncPreviewAgent[]; excluded: SyncPreviewAgent[];
  local: SyncPreviewAgent[]; upToDate: SyncPreviewAgent[];
}

interface AIUsageEntry {
  calls: number; inputTokens: number; outputTokens: number;
  estimatedCostUSD: number;  // siempre 0 para cli y github
  since: string | null;      // ISO timestamp del primer registro
}
interface AIUsage { cumulative: AIUsageEntry; session: AIUsageEntry; }

interface ProjectContextInfo {
  content: string; type: 'claude' | 'github'; label: string; filePath: string;
  mismatch: boolean;
  mismatchDetails?: { message: string; projectGroup: string; appGroup: string };
  isEmpty: boolean;     // el fichero de contexto no existe
  isDefault: boolean;   // el contenido es la plantilla genérica sin editar
  sizeBytes: number; lastUpdated: string | null;
}

interface DashboardNotification {
  id: string; type: 'critical' | 'optimization' | 'info';
  target: 'agent' | 'project'; targetId?: string; targetName: string;
  message: string;
  action: 'open-agent' | 'open-project' | 'sync-project' | 'generate-context' | 'optimize-agent';
}

// Browser CDP
interface BrowserTab {
  id:    string;
  url:   string;
  title: string;
}
interface BrowserInstalled {
  key:    string;
  name:   string;
  engine: string;
}
interface BrowserStatus {
  connected:  boolean;
  cdpActive:  boolean;
  cdpPort:    number;
  browserKey: string | null;
  tabs:       BrowserTab[];
  installed:  BrowserInstalled[];
}

interface DashboardData {
  agents: { total: number; global: number; section: number; tech: number; uncategorized: number };
  projects: { total: number; active: number; paused: number; archived: number; totalPending: number; withPending: number };
  dirStatus: AgentDirectoryStatus;
  projectHealth?: Array<{ projectId: string; name: string; status: 'healthy'|'warning'|'critical'; pathExists: boolean; pendingUpdates: number; staleSync: boolean; contextState: 'ok'|'thin'|'missing'; lastSyncAt: string|null; issues: string[] }>;
  notifications: DashboardNotification[];
  hiddenNotifications?: number;
  hiddenDismissed?: number;
  hiddenSnoozed?: number;
  lastSyncAt: string | null;
}

// Orquestaciones
interface DataFlow {
  agentOutput:    boolean;   // incluir la salida del agente anterior como entrada
  filesModified:  boolean;   // incluir lista de ficheros modificados por el agente anterior
  claudeMd:       boolean;   // incluir CLAUDE.md del proyecto
  selectiveFiles: string[];  // ficheros adicionales específicos (paths)
}
interface FixedContext {
  freeText: string;   // texto libre de contexto estático
  files:    string[]; // rutas absolutas o relativas de ficheros de contexto
}
interface TemporalContext {
  id:          string;
  type:        'file' | 'text';  // tipo de campo que rellena el usuario antes de ejecutar
  label:       string;
  placeholder?: string;
  required:    boolean;
}
interface ContextExtra {
  fixed:    FixedContext;      // contexto estático que siempre se incluye
  temporal: TemporalContext[]; // campos dinámicos que se piden al usuario en cada ejecución
}
interface OrchestrateNode {
  id:           string;  // node-{from}-{to}-{timestamp}
  from:         number;  // índice del agente origen en agents[]
  to:           number;  // índice del agente destino en agents[]
  dataFlow:     DataFlow;
  contextExtra: ContextExtra;
}
interface ExecutionConfig {
  stopOnError:           boolean;
  validateAfterEachStep: boolean;
  maxTurns:              number;   // máx. turnos por paso (default 10)
  timeout:               number;   // ms totales (default 300 000)
}
interface Orchestration {
  id:                   string;   // orch-{timestamp}-{hex}
  projectId:            string;
  name:                 string;
  description:          string;
  enabled:              boolean;
  agents:               string[]; // nombres de agentes en orden de ejecución
  nodes:                OrchestrateNode[]; // agents.length - 1 nodos
  executionConfig:      ExecutionConfig;
  createdAt:            string;
  updatedAt:            string;
  lastExecutedAt?:      string;
  lastExecutionStatus?: 'success' | 'partial' | 'failed';
  executionCount:       number;
}
interface StepResult {
  stepIndex: number; agentName: string;
  input:  { systemPrompt: string; userMessage: string };
  output: { response: string; toolCalls?: unknown[]; toolResults?: unknown[] };
  filesModified: string[];
  tokensUsed: { input: number; output: number };
  duration: number;
  status: 'success' | 'error' | 'warning';
  error?: { message: string; category: string; recoverable: boolean };
  backupPath: string | null;
}
interface ExecutionSummary {
  filesModified: number; filesCreated: number; filesDeleted: number;
  linesAdded: number; linesRemoved: number;
}
interface ExecutionResult {
  orchestrationId: string; projectId: string; executionId: string;
  startedAt: string; completedAt: string; duration: number;
  status: 'success' | 'partial' | 'failed';
  stepsCompleted: number; totalSteps: number;
  totalTokensUsed: { input: number; output: number };
  estimatedCost: number;
  results: StepResult[];
  errors: Array<{ message: string; category: string; recoverable: boolean }>;
  summary: ExecutionSummary;
  changes: Array<{ path: string; status: string }>;
  backups: Record<string, string | null>;
}
interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}
```

---

## Constantes (`constants/tools.ts`)

- **`ALL_TOOLS`**: `['Bash','Read','Write','Grep','Edit','MultiEdit','WebFetch','WebSearch','TodoRead','TodoWrite']`
- **`agentIcon(name)`**: mapea palabras clave del nombre a icono Tabler (`review`→`ti-eye`, `git`→`ti-git-commit`, `test`→`ti-test-pipe`, `doc`/`writer`→`ti-file-text`, `security`→`ti-shield`, `debug`→`ti-bug`, resto→`ti-robot`)
- **`MODEL_ICON`**: `haiku→ti-leaf`, `sonnet→ti-bolt`, `opus→ti-brain`
- **`LEVEL_COLOR`**: `global→var(--accent)`, `section→var(--blue)`, `tech→var(--green)`, `project→var(--amber)`, `uncategorized→var(--text3)`

---

## Sistema de estilos (`styles.css`)

Un único fichero CSS global. Tema oscuro definido mediante variables en `:root`.

Variables principales: `--bg0..5` (fondos), `--text0..3` (textos), `--accent` (#7c6af7), `--green`, `--amber`, `--blue`, `--coral`, `--border/2/3`.

**Clases de botón:** `.btn` (base), `.btn.primary` (accent), `.btn.ghost` (sin fondo), `.btn.danger` (coral), `.btn.sm`.
**Badges:** `.badge.{green|amber|blue|accent|gray|coral}` — siempre con icono dentro.
**Model pills:** `.tool-pill.model-{haiku|sonnet|opus}`.
**Toasts:** `.toast.{ok|err|warn|info}` en esquina inferior derecha, `z-index: 9999`.

Layout shell: `#app` (flex row) → `.sidebar` (48px) + `.main` (flex: 1, flex column) → `.topbar` (44px) + contenido + `.statusbar` (22px).

**Clases de agentes:**
- `.agent-card` — `display:flex; flex-direction:column` para que el contenido interno se apile verticalmente.
- `.agent-desc` — `flex:1` para empujar `.agent-card-actions` al fondo de la card.
- `.agent-card-actions` — fila de botones Chat/Ejecutar, siempre al pie de la card. Solo visible en agentes de nivel proyecto no-sugeridos.

**Clases del panel de ejecución (`.exec-*`):**
- `.exec-panel` — contenedor principal del `AgentExecutePanel`.
- `.exec-loading` — spinner centrado con texto.
- `.exec-warning-box.coral` / `.exec-warning-box.amber` — cajas de aviso con icono y acciones.
- `.exec-summary` / `.exec-row` / `.exec-row-label` / `.exec-row-value` — tabla de resumen previo a la ejecución.
- `.exec-task-desc` — preview de la tarea predefinida con icono.
- `.exec-result-header` / `.exec-result-body` / `.exec-result-foot` — cabecera, cuerpo markdown y pie del resultado.
- `.exec-section-label` — etiqueta de sección.

**Clases del chat:**
- `.chat-mismatch-banner` — banner ámbar encima del input cuando hay mismatch de proveedor.

**Clases de orquestaciones (`.orch-*`):**
- `.orch-page` — contenedor raíz con topbar y vista activa.
- `.orch-list` — grid de tarjetas `.orch-card` / `.orch-card-empty` / `.orch-card-header` / `.orch-card-meta` / `.orch-card-actions`.
- `.orch-editor` — layout 3 columnas (paleta | lienzo | configurador).
- `.orch-palette-panel` — panel izquierdo: buscador + lista de `.orch-palette-card` (cada card tiene icono cuadrado, nombre, descripción y grip handle `ti-grip-vertical`).
- `.orch-canvas-panel` — panel central: scroll vertical, recibe todos los eventos drag-and-drop.
- `.orch-node-canvas` — SVG + nodos superpuestos. Exportado: `CANVAS_W_CONST=270`, `CANVAS_SLOT_H=100`, `CANVAS_PAD_TOP=10`, `CANVAS_ZONE_H=32`.
- `.orch-node-agent` — nodo de agente en el lienzo: badge de índice, icono, nombre, botón de eliminar (visible en hover). Atributo `draggable`. Tiene `.orch-grip` como handle.
- `.orch-drop-zone` — zona visual de drop (solo visual, `pointer-events:none`). Con `.dragging-active` muestra borde discontinuo; con `.active` muestra fondo de acento.
- `.orch-conn-panel` — panel derecho: título de la conexión seleccionada + secciones configurables.
- `.orch-conn-section` / `.orch-conn-section-title` — secciones plegables del configurador de conexiones.
- `.orch-conn-row` — fila con checkbox y etiqueta para DataFlow.
- `.orch-conn-actions` — pie del panel con botón "Aplicar cambios" / "Guardado".
- `.orch-config-*` — formulario de config de ejecución: `orch-config-row`, `orch-config-label`, `orch-config-input`.
- `.orch-file-item` / `.orch-file-name` / `.orch-file-remove` — líneas de fichero en el selector de contexto fijo.
- `.orch-exec-panel` — panel de ejecución. Estados: formulario previo → corriendo (logs SSE) → resultado.
- `.orch-exec-header` / `.orch-exec-log` / `.orch-exec-log-entry.{info|warn|error|debug}` — cabecera y visor de logs.
- `.orch-exec-node-label` — encabezado de grupo dentro del formulario de contexto temporal. Muestra el tramo del nodo (`Orquestador → agente-X`) con icono y borde superior separador. La primera instancia no lleva borde superior.
- `.orch-exec-result-*` — tarjetas de resultado por paso (`.orch-exec-step-card`, `.orch-exec-step-status.{success|error|warning}`).
- `.orch-error-banner` — banner coral de error.

---

## Componentes de layout

- **`Sidebar`**: nav vertical 48px. Íonos: `ti-robot` (logo→proyectos), `ti-layout-grid` (proyectos), `ti-cpu` (agentes), `ti-topology-ring-2` (orquestaciones), `ti-message-chatbot` (chat), `ti-settings` (ajustes). Clase `.active` según `view`.
- **`Topbar`**: props `title`, `sub?`, `actions?` (ReactNode en el extremo derecho — cada página inyecta sus controles aquí).
- **`Statusbar`**: al montar llama `GET /health`, `GET /ai/status` y `GET /ai/usage`. Muestra: conexión servidor, estado proveedor IA (punto verde si `ready`), tokens totales acumulados (entrada/salida), tokens de sesión (entrada/salida), versión. El polling de usage se repite cada 30s.

---

## Hooks

- **`useToast`**: devuelve `addToast(msg, type?)` directamente. Tipos: `'ok'` (3.5s), `'err'`/`'warn'` (5s), `'info'` (3.5s).
- **`useCategoryHelpers`**: lee `config` del store y expone `catName(id)`, `catColor(id)`, `techName(catId, techId)`.
- **`useElectron`**: encapsula las llamadas IPC vía `window.api`. Expone `pickFolder(): Promise<string|null>` (selector de carpeta) y `pickFile(): Promise<string|null>` (selector de fichero individual). Ambos devuelven `null` si el usuario cancela o si la app corre fuera de Electron.

---

## Componentes UI genéricos

### `Modal.tsx`

Props: `title`, `sub?`, `onClose`, `onConfirm: () => Promise<void>`, `confirmLabel?`, `confirmClass?`, `modalClassName?`, `bodyClassName?`, `children`. Las props `modalClassName` y `bodyClassName` añaden clases CSS extra al `.modal` y `.modal-body` respectivamente (usadas p.ej. por `EditProjectModal`).

**Patrón crítico:** `onConfirm` debe lanzar `throw new Error()` (no `return`) para mantener el modal abierto cuando la validación falla. Si resuelve sin error, el modal se cierra solo.

### `Wizard.tsx`

Overlay de primer arranque, 3 pasos: bienvenida → proveedor IA (detecta CLI vía `GET /detect-cli`) → configurando (`POST /setup`). El checkbox "No mostrar al inicio" escribe/borra `localStorage['cdm-wizard-done']`.

### `CloseDialog.tsx`

Aparece vía IPC `app:close-requested`. Responde con `window.api.closeResponse(action, remember)`. Si `remember`, el main process persiste `closeAction` en `config.json`.

---

## Componentes de proyectos

- **`StatusBadge`**: tres sub-componentes. `ProjectStatusBadge` (active/paused/archived). `SyncStatusBadge` (ok/outdated/new/local/excluded). `ProviderBadge` (claude/github/both).
- **`ProjectCard`**: tarjeta clickable que abre `ProjectDrawer`. Badge coral si `!pathExists`. Badge con count si `pendingUpdates > 0`.
- **`ProjectDrawer`**: panel 560px. Tab contexto (CLAUDE.md / copilot-instructions.md, editable + generación IA). Tab sync/agentes: carga en paralelo `sync-status` y `sync-preview` (`SyncPreview`) al montar; muestra preview dry-run con contadores antes de sincronizar; botón de agregar agentes cruzados (`showCrossAdd`). Footer: VS Code, carpeta, editar, eliminar.
- **`CreateProjectModal`**: ruta final = `basePath + '/' + slugify(name)`, mostrada como preview. `POST /projects`.
- **`EditProjectModal`**: rediseño en grid 2 columnas (nombre + estado en primera fila, descripción + tecnología + proveedor a pantalla completa). Usa `modalClassName="project-edit-modal"` y `bodyClassName="project-edit-body"`. Si cambia `aiProvider`, avisa que los agentes se migrarán. `PUT /projects/:id`.
- **`ImportProjectModal`**: para proyectos ya existentes en disco. `POST /projects/import`.
- **`ExcludeAgentModal`**: radio entre "excluir + eliminar archivo" (`DELETE /projects/:id/agents/:name`) o "solo excluir" (persiste en `excludedAgents`).

---

## Componentes de agentes

- **`AgentCard`**: borde izquierdo según `LEVEL_COLOR[level]`. Tool pills (máx 3 + "+N más"). Badge "sugerido" si `agent.suggested`. Cuando `node.level === 'project'` y el agente no es sugerido, muestra `.agent-card-actions` en la parte inferior con los botones **Chat** (`ti-message-chatbot`) y **Ejecutar** (`ti-zap`). El click en estos botones detiene la propagación para no abrir el editor.
- **`AgentsTree`**: árbol colapsable. Nodos: Global → Categorías (section) → Tecnologías (tech) → Proyectos → Sin categoría (uncategorized, `ti-folder-question`, siempre al final). Al entrar en la vista, el Set inicial de nodos expandidos incluye `'cats'`, `'projs'` y un `'cat-{id}'` por cada categoría del config.
- **`AgentsCenter`**: grid de agentes reales + separador + grid de sugeridos IA (o spinner). Click en sugerido → editor en modo nuevo con campos precargados. Pasa `onChatWithAgent` y `onExecuteAgent` a cada `AgentCard`.
- **`AgentEditor`**: campos nombre, descripción, modelo, herramientas. Botón "Generar" (`POST /ai/generate-prompt`). Botón "Optimizar" solo si `!agent.optimized && agent.system` (`POST /ai/optimize-agent`). Tras guardar con `optimized: true`, el botón desaparece. Al final del campo "System prompt" aparece un tip con borde acento (`ti-topology-ring-2`) recordando que si el agente se usará en una orquestación, el prompt debe declarar explícitamente: qué lee del contexto del proyecto, qué recibe del paso anterior y qué produce para el siguiente.
- **`AgentExecutePanel`**: panel de ejecución que sustituye al centro+editor cuando hay un agente seleccionado para ejecutar. Máquina de estados con fases: `validating → warn-no-model | warn-no-context | warn-default | warn-mismatch | ready → running → result | error`. En `ready` muestra resumen de agente, modelo, contexto, proyecto y proveedor. Botón **Ejecutar** lanza `POST /projects/:id/execute-task`. En `result` renderiza el resultado en markdown con botones Copiar, "Discutir en chat" (→ `setPendingChatAgent` + `navigateTo('chat')`) y Volver.

---

## Páginas

### `Dashboard.tsx`

Vista de inicio (view = `'dashboard'`). Carga en paralelo `GET /api/dashboard` y `GET /api/ai/usage`. Se refresca automáticamente cada 30 s con `setInterval`.

**Tarjetas:**
- **Estado General** — contadores de agentes (global/section/tech) y proyectos (activos/pausados/archivados). Click → navega a la vista correspondiente.
- **Sincronización** — estado de sync de agentes y proyectos, estado del directorio externo. Botón "Sincronizar todo" → `POST /sync-all`. Nota "Salud en vivo: actualización cada 30s".
- **Salud de Proyectos** — lista `projectHealth[]` con dot indicators (`healthy`=verde, `warning`=ámbar, `critical`=coral). Muestra hasta 6 proyectos con su primer issue.
- **Oportunidades de Mejora** — lista de `DashboardNotification[]`. Las críticas se muestran en rojo, optimizaciones en ámbar, info en azul. Máx 5 visibles; botón "Ver todas" para expandir. Cada notificación tiene botones **Descartar** (permanente) y **Aplazar** (7 días por defecto) vía `POST /dashboard/notifications/snooze`. Cuando hay ocultas, se muestra desglose "Ocultas / Aplazadas".
- **Acciones Rápidas** — botones que llaman `navigateTo(view, action)` para abrir modales directamente desde otra página.
- **Uso de IA** — `UsageCard` con filas de tokens (entrada/salida/coste) para acumulado y sesión. Botones "Reiniciar sesión" y "Reiniciar total".

**`navigateTo`**: usado desde las acciones rápidas del dashboard para abrir modales en otras páginas. Las páginas destino consumen `pendingAction` en `useEffect` al montar.

**Navegación directa a agente** — al hacer click en una notificación de tipo agente, llama `setPendingAgentToEdit({ name, level, categoryId, techId })` antes de `setView('agents')`. La página `Agents` detecta este valor al montar, expande los nodos del árbol necesarios y abre el editor del agente directamente.

### `Projects.tsx`

Grid de proyectos agrupados por categoría. Tras cualquier mutación → `fetchProjects()`. Estado local: `drawerProjectId`, `showCreate`, `showImport`, `editProject`.

### `Agents.tsx`

Tres paneles (árbol / centro / editor), o panel de ejecución en su lugar cuando hay un agente en ejecución. Patrones no obvios:

**Polling de sync** — `setInterval(600ms)` sobre `GET /api/agents-directory/status`. Cuando `syncing` pasa de `true` a `false`, recarga agentes del nodo activo. Se limpia en cleanup del `useEffect`.

**Overlay de primer arranque** — cuando `firstSync && syncing`, bloquea la UI y muestra barra de progreso determinada (`done/total`) y nombre del archivo en proceso.

**Modal de conflictos** — botón badge coral en topbar cuando `pendingConflicts.length > 0`. Cada conflicto tiene "Usar remoto" (`action: 'update'`) o "Mantener local" (`action: 'keep'`). Cuando se resuelven todos, se recarga.

**Categorías desplegadas al entrar** — el `useState` inicial de `expanded` lee `config.categories` y precarga `'cats'`, `'projs'` y `'cat-{id}'` por cada categoría. Todas las secciones del árbol aparecen abiertas desde el primer render.

**AbortController por nodo** — al cambiar nodo se aborta la petición de sugerencias en curso. Evita condiciones de carrera. Las sugerencias se omiten en `uncategorized` (sin contexto de categoría/tech).

**Sugerencias no repetitivas** — `handleRefreshSuggestions` captura `const current = suggestions` antes de limpiar el estado, y llama `loadSuggestions(node, true, current)`. El backend recibe `alreadySuggested: current.map(s => s.name)` y los excluye junto con los agentes ya guardados en disco.

**Eliminar sugerencia al guardar** — `handleSaved` llama `setSuggestions(prev => prev.filter(s => s.name !== saved.name))` justo después de marcar el agente como guardado, antes de recargar la lista.

**Flujo de ejecución:** `handleExecuteAgent(agent)` limpia editor y activa `executeAgent`. Cuando `executeAgent && project` se renderiza `AgentExecutePanel` en lugar del centro+editor. `handleBackFromExecute` limpia `executeAgent`. `handleChatWithAgent` llama `setPendingChatAgent(agent.name)` y `navigateTo('chat')`.

**Flujo editor:** click card → `setEditorAgent(agent)`. "Nuevo agente" → `setEditorAgent(NEW_AGENT)`. `onSave` → recarga nodo. `onClose` → `setEditorAgent(null)`. El editor se muestra en un overlay modal (`.overlay` + `.agent-editor-modal`) en lugar de un panel lateral fijo — click fuera cierra.

**Navegación desde Dashboard** — cuando el store tiene `pendingAgentToEdit` al montar, la página: (1) construye el `targetNode` con level/categoryId/techId, (2) expande los nodos del árbol necesarios con `setExpanded`, (3) llama `selectNode(targetNode)`. Cuando los agentes se cargan, un segundo `useEffect` busca el agente por nombre y llama `openEditor(agentToOpen)`, luego limpia `pendingAgentToEdit`. Usa refs (`pendingAgentNameRef`, `pendingNodeRef`) para evitar cierre sobre estado stale.

### `Chat.tsx`

Chat multi-turno. Estado local: `messages`, `input`, `loading`, `activeAgents`, `mention`/`mentionList`/`mentionIdx` (dropdown @mention), `projectId`, `allAgents`, `ctxInfo`, `showMismatch`.

**Precarga de agente desde ejecución** — cuando el store tiene `pendingChatAgent`, el `useEffect` que carga `allAgents` busca el agente por nombre, lo añade a `activeAgents` y llama `setPendingChatAgent(null)`. Permite que "Discutir en chat" en el panel de ejecución llegue al chat con el agente ya activo.

**@mention:** detecta `@texto` en onChange → filtra `allAgents`. Teclado ↑↓ navega, Enter selecciona, Escape cierra. El agente va a `activeAgents[]` como chip removible.

**System prompt:** `buildSystem(agents)` concatena system prompts de agentes activos + instrucción de sugerir acciones (`<!--ACTIONS:[{label,type}]-->`).

**Indicador de contexto** — al cambiar `projectId`, el componente llama `GET /projects/:id/context?type=auto` y almacena `ctxInfo: ProjectContextInfo`. Si el proyecto tiene contexto, muestra un badge debajo del selector de proyecto:
- Verde (`ti-check`): contexto disponible y proveedor compatible.
- Ámbar (`ti-alert-triangle`): mismatch de proveedor.
- Coral (`ti-file-off`): sin fichero de contexto.

**Banner de mismatch** — cuando `showMismatch && ctxInfo?.mismatchDetails`, se muestra `.chat-mismatch-banner` encima del área de input con el mensaje de mismatch y un enlace a Ajustes.

**Historial:** al cambiar proyecto, guarda el actual (`PUT /chat/history`) y carga el nuevo (`GET /chat/history?projectId=`). Historial global en `chat-global.json`.

**Action buttons** extraídos de `<!--ACTIONS:...-->`: `create-agent` (abre editor), `open-agents`, `open-settings`.

**renderMarkdown:** escapa HTML primero, luego aplica transformaciones. Seguro para `dangerouslySetInnerHTML`.

### `Settings.tsx`

Cuatro secciones principales: **General** (proveedor IA, comportamiento cierre, versión/actualizaciones, botón "Ver wizard"), **Categorías**, **Directorio de Agentes**, **Cómo usar los agentes**.

Tab Directorio: toggle habilitado, input URL del repo, estado de última sync, botón "Sincronizar ahora" (polling 600ms hasta `syncing: false`), resolución de conflictos inline, sección importar desde URL individual.

**Sección guías de editor** — tres tabs seleccionables (`editorTab: 'vscode' | 'intellij' | 'eclipse'`). El contenido de cada tab se adapta al proveedor de IA configurado (Claude vs. GitHub Copilot). En IntelliJ y Eclipse, se muestran instrucciones del plugin/extension correspondiente si está disponible, o instrucciones de terminal CLI como fallback.

Toggle de tema inyectado en `Topbar` vía prop `actions`.

### `Orchestrations.tsx`

Página de gestión de orquestaciones. Tres sub-vistas internas controladas por `subView: 'list' | 'editor' | 'execution'`.

**Topbar:** selector de proyecto (auto-selecciona el primer proyecto activo al montar) + botón "Nueva orquestación" que abre `CreateOrchestrationModal` (inline en la página).

**CreateOrchestrationModal:** modal genérico con un campo de nombre y uno de descripción. `POST /orchestrations` con el `projectId` activo. Al crear, navega directamente a la sub-vista `'editor'`.

**Cambio de proyecto:** cuando cambia `projectId`, recarga la lista de orquestaciones y resetea a sub-vista `'list'`.

---

## Componentes de orquestaciones

### `OrchestrationList.tsx`

Grid de tarjetas. Cada tarjeta muestra: nombre, descripción, badge de estado (`lastExecutionStatus`: green=success, coral=failed, amber=partial), contador de ejecuciones, fecha de última ejecución. Acciones: editar (navega a `'editor'`), ejecutar (navega a `'execution'`), eliminar.

El botón de eliminar usa `Modal` (no `confirm()` nativo) con mensaje de confirmación. Estados internos: `deleting`, `confirmDeleteId`.

### `OrchestrationEditor.tsx`

Editor principal con layout de tres paneles:

**Panel izquierdo — Paleta de agentes:** buscador + grid de `.orch-palette-card`. Cada card muestra icono cuadrado (`getAgentIcon`), nombre, descripción truncada y grip handle. Son **arrastrables** (`draggable`), iniciando un drag de tipo `palette`.

**Panel central — Lienzo:** `NodeCanvas` envuelto en `.orch-canvas-panel`. Este panel recibe todos los eventos DnD directamente:
- `onDragOver` — calcula la zona de drop a partir de `e.clientY - panelRect.top - 20 + panel.scrollTop`. Fórmula: `zone = clamp(round((yRel - PAD_TOP - SLOT_H/4) / SLOT_H), 0, n)` donde `n = agents.length`.
- `onDrop` — distingue entre drop de paleta (inserción de nuevo agente) y reordenación de nodo existente (`splice` + desplazamiento).

Estado DnD: `isDragging`, `draggingNodeIdx`, `dragOverZone`, `draggingRef`, `canvasPanelRef`.

`rebuildNodes()` — cuando cambia el array `agents`, preserva las configuraciones de nodo existentes mapeando por posición.

**Panel derecho — Configurador de conexión:** `ConnectionConfigurator` cuando hay una conexión seleccionada (`selectedNodeId`), o placeholder si no hay nodos.

### `NodeCanvas.tsx`

Canvas visual. Renderiza SVG de conexiones + nodos HTML superpuestos.

**Constantes exportadas:**
- `CANVAS_SLOT_H = 100` — altura en px de cada slot de agente.
- `CANVAS_PAD_TOP = 10` — padding superior del canvas.
- `CANVAS_ZONE_H = 32` — altura visual de cada zona de drop.
- `CANVAS_W_CONST = 270` — ancho del canvas.

**Función exportada:** `getAgentIcon(name: string): string` — igual que `agentIcon` de `constants/tools.ts`.

Lineas SVG (`<path>`) conectan los nodos con curvas cubicas Bézier. `pointerEvents: isDragging ? 'none' : 'all'` evita que el SVG bloquee los eventos de drop durante el drag.

Zonas de drop (`.orch-drop-zone`): `pointer-events: none` siempre — son puramente visuales. Las clases `dragging-active` y `active` las controla `OrchestrationEditor` desde fuera.

Nodos (`.orch-node-agent`): `draggable`, badge de índice, icono, nombre. Botón de eliminar visible en hover. Click en nodo (no en eliminar ni grip) dispara `onSelectNode(nodeId)`.

### `ConnectionConfigurator.tsx`

Panel de configuración para la conexión entre dos agentes. Auto-guarda al cambiar de nodo usando refs.

**Auto-save:** refs `dataFlowRef`, `contextExtraRef`, `dirtyRef`, `nodeRef`, `onUpdateRef`. El cleanup del `useEffect` de nodo llama `onUpdate` si `dirtyRef.current === true` antes de desmontar/cambiar de nodo.

**`normalizeContextExtra(raw)`:** migra datos legacy donde `fixed` podía ser `null` — devuelve `{ freeText: '', files: [] }` como valor seguro.

**Prop `isInputNode?: boolean`:** se pasa como `true` desde `OrchestrationEditor` cuando el nodo seleccionado es el de entrada (`selectedNode === -1`, "Orquestador → Agente 1"). Cuando es `true`, los checkboxes "Respuesta del agente anterior" y "Lista de archivos modificados" se deshabilitan y muestran sin marcar (no hay agente previo que haya producido output), y la sección adopta la variante visual de "nodo de entrada" (icono `ti-circuit-diode`, título "Descripción de la tarea").

**Sección DataFlow:** checkboxes para `agentOutput` y `filesModified`. El checkbox "Contexto del proyecto (CLAUDE.md…)" fue eliminado — el agente debe gestionar esa lectura en su propio system prompt.

**Sección Contexto fijo:** textarea para `freeText` + componente `FilePicker`. `FilePicker` muestra un botón "Añadir archivo" que llama `pickFile()` (IPC nativo). Cada archivo se lista en una sola línea con icono, nombre truncado (tooltip = ruta completa) y botón de eliminar.

**Sección Contexto temporal:** tabla de campos dinámicos (tipo, etiqueta, placeholder, requerido). Botón añadir / eliminar filas.

**Botón de guardar:** muestra `"Guardado"` cuando `!dirty`, `"Aplicar cambios"` cuando `dirty`.

### `ExecutionPanel.tsx`

Panel de ejecución de una orquestación. Tres estados internos:

1. **Formulario previo:** muestra la configuración de ejecución, los campos de contexto temporal pendientes de rellenar y (condicionalmente) la sección de navegador CDP. Los campos temporales se agrupan por nodo con un encabezado `.orch-exec-node-label` que muestra el tramo exacto (`Orquestador → agente-X` o `agente-X → agente-Y`), de modo que queda claro a qué paso pertenece cada entrada. Botón "Comenzar ejecución" llama `POST /orchestrations/:id/execute { projectId, temporalContextValues }` y almacena el `executionId` devuelto.
2. **Corriendo (SSE):** abre `EventSource` apuntando a `GET /orchestrations/:id/execute/stream?executionId=`. Recibe eventos `step-start`, `step-progress`, `step-complete`, `step-error`, `complete`, `error`. Los logs se muestran en `.orch-exec-log` con clase según nivel. Botón "Rollback" por paso completado llama `POST /orchestrations/:id/executions/:execId/rollback { stepIndex }`.
3. **Resultado:** muestra resumen (`ExecutionResult`), tarjetas por paso con estado, ficheros modificados, tokens y botones de rollback.

**Detección de herramientas browser (`needsBrowser`):**

Al montar, el panel carga los objetos de agente completos desde las mismas fuentes que usa la paleta del editor:

```
GET /agents/applicable?projectId=   ← agentes global + section + tech aplicables
GET /projects/:id/agents            ← agentes propios del proyecto
```

Ambas listas se fusionan (deduplicadas por nombre) y se filtran por `orchestration.agents` para obtener solo los que pertenecen a esta orquestación. Si alguno de ellos tiene una herramienta cuyo nombre empieza por `browser_`, se activa `needsBrowser = true`.

**Sección CDP (solo visible si `needsBrowser`):**

Muestra el estado de la conexión (`GET /api/browser/status`) con un badge verde/coral. Incluye el botón **"Reiniciar con CDP"** que llama `POST /api/browser/launch { browserKey, port }` con un selector del navegador instalado. Tras el lanzamiento sondea el estado hasta que `connected = true`.

**Gate de ejecución (`canExecute`):**

El botón "Comenzar ejecución" se desactiva hasta que se cumplen todas estas condiciones:

| Condición | Descripción |
|---|---|
| `missingFields.length === 0` | Todos los campos temporales requeridos están rellenos |
| `!browserBlocked` | Si `needsBrowser`: el navegador está conectado por CDP |
| `!browserLoading` | Si `needsBrowser`: el estado del navegador ya se ha cargado |

El atributo `title` del botón explica el motivo de bloqueo al pasar el cursor.

---

## Patrones recurrentes

**No actualización optimista** — siempre esperar confirmación del servidor antes de actualizar estado local. Tras mutaciones: `fetchProjects()` o recarga de lista.

**`window.api` con optional chaining** — el renderer puede correr sin Electron. Siempre: `const api = (window as any).api; api?.method?.()`.

**Modal controlado** — `onConfirm` lanza `throw new Error()` para impedir el cierre cuando falla validación (no `return`).

**AbortController para sugerencias** — cancelar petición anterior al navegar entre nodos (ver `Agents.tsx`).

**Iconografía** — solo `<i className="ti ti-nombre" />` (Tabler Icons CDN). Sin SVGs inline, sin emojis en la UI.
