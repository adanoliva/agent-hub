# Documentación técnica — Frontend (`src/renderer/`)

> Stack: React 19 + Vite 8 + Zustand 5 + TypeScript
> Última actualización: 2026-05-23

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
│   └── useCategoryHelpers.ts ← catName, catColor, techName desde config
├── constants/tools.ts      ← ALL_TOOLS[], agentIcon(), MODEL_ICON, LEVEL_COLOR
├── components/
│   ├── layout/             ← Sidebar, Topbar, Statusbar
│   ├── ui/                 ← Toast, Modal, Wizard, CloseDialog
│   ├── projects/           ← ProjectCard, ProjectDrawer, modales
│   └── agents/             ← AgentCard, AgentsTree, AgentsCenter, AgentEditor
└── pages/
    ├── Projects.tsx
    ├── Agents.tsx
    ├── Chat.tsx
    └── Settings.tsx
```

**Flujo de datos:** renderer → `req()` (HTTP) → Express :3737 · renderer → `window.api` (IPC) → Electron main. El renderer nunca accede directamente al FS ni al IPC sin pasar por estos dos canales.

**Navegación:** sin React Router. El campo `view` del store Zustand controla qué página se renderiza. Las páginas se cargan con `React.lazy` + wrapper `.then(m => ({ default: m.PageName }))` porque usan named exports.

**Wizard:** visible si `localStorage.getItem('cdm-wizard-done')` no existe, o si `store.showWizard === true` (relanzado desde Ajustes).

---

## Estado global (`store/index.ts`)

```ts
interface AppState {
  view:       'projects' | 'agents' | 'chat' | 'settings';
  config:     Config | null;
  projects:   Project[];
  appVersion: string | null;
  toasts:     Toast[];
  showWizard: boolean;

  setView, setConfig, setProjects, setAppVersion,
  fetchProjects(): Promise<void>;   // GET /projects → actualiza store
  setShowWizard(v: boolean): void;
  addToast(msg: string, type?: 'ok'|'err'|'info'|'warn'): void;  // auto-dismiss 3.5s / 5s para err|warn
  removeToast(id: string): void;
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
  version: string; aiProvider: 'cli' | 'api' | 'github';
  apiKey: string; githubToken: string; githubModel: string;
  theme: 'dark' | 'light'; closeAction?: 'ask' | 'tray' | 'quit';
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
```

---

## Constantes (`constants/tools.ts`)

- **`ALL_TOOLS`**: `['Bash','Read','Write','Grep','Edit','MultiEdit','WebFetch','WebSearch','TodoRead','TodoWrite']`
- **`agentIcon(name)`**: mapea palabras clave del nombre a icono Tabler (`review`→`ti-eye`, `git`→`ti-git-commit`, `test`→`ti-test-pipe`, `doc`/`writer`→`ti-file-text`, `security`→`ti-shield`, `debug`→`ti-bug`, resto→`ti-robot`)
- **`MODEL_ICON`**: `haiku→ti-leaf`, `sonnet→ti-bolt`, `opus→ti-brain`
- **`LEVEL_COLOR`**: `global→var(--accent)`, `section→var(--blue)`, `tech→var(--green)`, `project→var(--amber)`, `uncategorized→var(--text3)`

---

## Sistema de estilos (`styles.css`)

Un único fichero CSS global. Tema oscuro en `:root`, claro en `body.light`. El cambio se aplica con `document.body.classList.toggle('light', ...)`.

Variables principales: `--bg0..5` (fondos), `--text0..3` (textos), `--accent` (#7c6af7 dark / #6c5ce7 light), `--green`, `--amber`, `--blue`, `--coral`, `--border/2/3`.

**Clases de botón:** `.btn` (base), `.btn.primary` (accent), `.btn.ghost` (sin fondo), `.btn.danger` (coral), `.btn.sm`.
**Badges:** `.badge.{green|amber|blue|accent|gray|coral}` — siempre con icono dentro.
**Model pills:** `.tool-pill.model-{haiku|sonnet|opus}`.
**Toasts:** `.toast.{ok|err|warn|info}` en esquina inferior derecha, `z-index: 9999`.

Layout shell: `#app` (flex row) → `.sidebar` (48px) + `.main` (flex: 1, flex column) → `.topbar` (44px) + contenido + `.statusbar` (22px).

---

## Componentes de layout

- **`Sidebar`**: nav vertical 48px. Íconos: `ti-robot` (logo→proyectos), `ti-layout-grid` (proyectos), `ti-cpu` (agentes), `ti-message-chatbot` (chat), `ti-settings` (ajustes). Clase `.active` según `view`.
- **`Topbar`**: props `title`, `sub?`, `actions?` (ReactNode en el extremo derecho — cada página inyecta sus controles aquí).
- **`Statusbar`**: `GET /ai/status` al montar. Muestra: conexión servidor, estado proveedor IA (punto verde si `ready`), `appDir`, versión.

---

## Componentes UI genéricos

### `Modal.tsx`

Props: `title`, `sub?`, `onClose`, `onConfirm: () => Promise<void>`, `confirmLabel?`, `confirmClass?`, `children`.

**Patrón crítico:** `onConfirm` debe lanzar `throw new Error()` (no `return`) para mantener el modal abierto cuando la validación falla. Si resuelve sin error, el modal se cierra solo.

### `Wizard.tsx`

Overlay de primer arranque, 3 pasos: bienvenida → proveedor IA (detecta CLI vía `GET /detect-cli`) → configurando (`POST /setup`). El checkbox "No mostrar al inicio" escribe/borra `localStorage['cdm-wizard-done']`.

### `CloseDialog.tsx`

Aparece vía IPC `app:close-requested`. Responde con `window.api.closeResponse(action, remember)`. Si `remember`, el main process persiste `closeAction` en `config.json`.

---

## Componentes de proyectos

- **`StatusBadge`**: tres sub-componentes. `ProjectStatusBadge` (active/paused/archived). `SyncStatusBadge` (ok/outdated/new/local/excluded). `ProviderBadge` (claude/github/both).
- **`ProjectCard`**: tarjeta clickable que abre `ProjectDrawer`. Badge coral si `!pathExists`. Badge con count si `pendingUpdates > 0`.
- **`ProjectDrawer`**: panel 560px. Tab contexto (CLAUDE.md / copilot-instructions.md, editable + generación IA). Tab sync/agentes (lista con badges, excluir/incluir, sync todos). Footer: VS Code, carpeta, editar, eliminar.
- **`CreateProjectModal`**: ruta final = `basePath + '/' + slugify(name)`, mostrada como preview. `POST /projects`.
- **`EditProjectModal`**: si cambia `aiProvider`, avisa que los agentes se migrarán. `PUT /projects/:id`.
- **`ImportProjectModal`**: para proyectos ya existentes en disco. `POST /projects/import`.
- **`ExcludeAgentModal`**: radio entre "excluir + eliminar archivo" (`DELETE /projects/:id/agents/:name`) o "solo excluir" (persiste en `excludedAgents`).

---

## Componentes de agentes

- **`AgentCard`**: borde izquierdo según `LEVEL_COLOR[level]`. Tool pills (máx 3 + "+N más"). Badge "sugerido" si `agent.suggested`.
- **`AgentsTree`**: árbol colapsable. Nodos: Global → Categorías (section) → Tecnologías (tech) → Proyectos → Sin categoría (uncategorized, `ti-folder-question`, siempre al final).
- **`AgentsCenter`**: grid de agentes reales + separador + grid de sugeridos IA (o spinner). Click en sugerido → editor en modo nuevo con campos precargados.
- **`AgentEditor`**: campos nombre, descripción, modelo, herramientas. Botón "Generar" (`POST /ai/generate-prompt`). Botón "Optimizar" solo si `!agent.optimized && agent.system` (`POST /ai/optimize-agent`). Tras guardar con `optimized: true`, el botón desaparece.

---

## Páginas

### `Projects.tsx`

Grid de proyectos agrupados por categoría. Tras cualquier mutación → `fetchProjects()`. Estado local: `drawerProjectId`, `showCreate`, `showImport`, `editProject`.

### `Agents.tsx`

Tres paneles (árbol / centro / editor). Patrones no obvios:

**Polling de sync** — `setInterval(600ms)` sobre `GET /api/agents-directory/status`. Cuando `syncing` pasa de `true` a `false`, recarga agentes del nodo activo. Se limpia en cleanup del `useEffect`.

**Overlay de primer arranque** — cuando `firstSync && syncing`, bloquea la UI y muestra barra de progreso determinada (`done/total`) y nombre del archivo en proceso.

**Modal de conflictos** — botón badge coral en topbar cuando `pendingConflicts.length > 0`. Cada conflicto tiene "Usar remoto" (`action: 'update'`) o "Mantener local" (`action: 'keep'`). Cuando se resuelven todos, se recarga.

**AbortController por nodo** — al cambiar nodo se aborta la petición de sugerencias en curso. Evita condiciones de carrera. Las sugerencias se omiten en `uncategorized` (sin contexto de categoría/tech).

**Flujo editor:** click card → `setEditorAgent(agent)`. "Nuevo agente" → `setEditorAgent(NEW_AGENT)`. `onSave` → recarga nodo. `onClose` → `setEditorAgent(null)`.

### `Chat.tsx`

Chat multi-turno. Estado local: `messages`, `input`, `loading`, `activeAgents`, `mention`/`mentionList`/`mentionIdx` (dropdown @mention), `projectId`, `allAgents`.

**@mention:** detecta `@texto` en onChange → filtra `allAgents`. Teclado ↑↓ navega, Enter selecciona, Escape cierra. El agente va a `activeAgents[]` como chip removible.

**System prompt:** `buildSystem(agents)` concatena system prompts de agentes activos + instrucción de sugerir acciones (`<!--ACTIONS:[{label,type}]-->`).

**Historial:** al cambiar proyecto, guarda el actual (`PUT /chat/history`) y carga el nuevo (`GET /chat/history?projectId=`). Historial global en `chat-global.json`.

**Action buttons** extraídos de `<!--ACTIONS:...-->`: `create-agent` (abre editor), `open-agents`, `open-settings`.

**renderMarkdown:** escapa HTML primero, luego aplica transformaciones. Seguro para `dangerouslySetInnerHTML`.

### `Settings.tsx`

Tres tabs: **General** (proveedor IA, comportamiento cierre, versión/actualizaciones, botón "Ver wizard"), **Categorías**, **Directorio de Agentes**.

Tab Directorio: toggle habilitado, input URL del repo, estado de última sync, botón "Sincronizar ahora" (polling 600ms hasta `syncing: false`), resolución de conflictos inline, sección importar desde URL individual.

Toggle de tema inyectado en `Topbar` vía prop `actions`.

---

## Patrones recurrentes

**No actualización optimista** — siempre esperar confirmación del servidor antes de actualizar estado local. Tras mutaciones: `fetchProjects()` o recarga de lista.

**`window.api` con optional chaining** — el renderer puede correr sin Electron. Siempre: `const api = (window as any).api; api?.method?.()`.

**Modal controlado** — `onConfirm` lanza `throw new Error()` para impedir el cierre cuando falla validación (no `return`).

**AbortController para sugerencias** — cancelar petición anterior al navegar entre nodos (ver `Agents.tsx`).

**Iconografía** — solo `<i className="ti ti-nombre" />` (Tabler Icons CDN). Sin SVGs inline, sin emojis en la UI.
