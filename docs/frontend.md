# Documentación técnica — Frontend (`src/renderer/`)

> Stack: React 19 + Vite 8 + Zustand 5 + TypeScript
> Última actualización: 2026-10-18 · Versión: 2.7.1

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
│   ├── useCategoryHelpers.ts ← catName, catColor desde config
│   └── useElectron.ts      ← pickFolder, pickFile (IPC wrappers)
├── constants/tools.ts      ← ALL_TOOLS[], agentIcon(), MODEL_ICON, LEVEL_COLOR
├── components/
│   ├── layout/             ← Sidebar, Topbar, Statusbar
│   ├── ui/                 ← Toast, Modal, Wizard, CloseDialog
│   ├── projects/           ← ProjectCard, ProjectDrawer, modales
│   ├── agents/             ← AgentCard, AgentsTree, AgentsCenter, AgentEditor,
│   │                          AgentExecutePanel, SkillsCenter, SkillEditor
│   └── orchestrations/     ← OrchestrationList, NodeCanvas, ConnectionConfigurator,
│                              OrchestrationEditor, ExecutionPanel
└── pages/
    ├── Dashboard.tsx
    ├── Projects.tsx
    ├── Agents.tsx
    ├── Chat.tsx
    ├── Orchestrations.tsx
    └── Settings.tsx
```

**Flujo de datos:** renderer → `req()` (HTTP) → Express :3737 · renderer → `window.api` (IPC) → Electron main.

**Navegación:** sin React Router. El campo `view` del store Zustand controla qué página se renderiza. Las páginas se cargan con `React.lazy` + wrapper `.then(m => ({ default: m.PageName }))`.

**Wizard:** visible si `localStorage.getItem('cdm-wizard-done')` no existe, o si `store.showWizard === true`.

---

## Comunicación API (`src/renderer/api.ts`)

```typescript
import { req, API_BASE } from './api';

// req() ya añade /api — no incluir ese prefijo
const projects = await req<Project[]>('GET', '/projects');

// Para EventSource u otras APIs nativas, usar API_BASE
const es = new EventSource(`${API_BASE}/orchestrations/${id}/execute/stream`);
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
  pendingAction:          string | null;
  pendingAgentToEdit:     PendingAgentToEdit | null;
  pendingNewAgentDraft:   PendingNewAgentDraft | null;
  pendingChatAgent:       string | null;

  setView, setConfig, setProjects, setAppVersion,
  fetchProjects(): Promise<void>;
  setShowWizard(v: boolean): void;
  addToast(msg: string, type?: 'ok'|'err'|'info'|'warn'): void;
  removeToast(id: string): void;
  navigateTo(view: View, action?: string): void;
  setPendingAction(a: string | null): void;
  setPendingAgentToEdit(p: PendingAgentToEdit | null): void;
  setPendingNewAgentDraft(p: PendingNewAgentDraft | null): void;
  setPendingChatAgent(name: string | null): void;
}
```

---

## Tipos compartidos (`types.ts`)

```ts
interface Agent {
  name: string; description: string; model?: string; tools?: string[]; system?: string;
  optimized?: boolean;
  level?: 'global' | 'section' | 'project' | 'uncategorized';
  categoryId?: string | null; projectId?: string | null;
  suggested?: boolean;
  skills?: string[];   // solo relevante en agentes de nivel proyecto
}

interface Skill {
  name:        string;
  description: string;
  content:     string;
}

interface Project {
  id: string; name: string; categoryId: string; path: string;
  description?: string; status: 'active' | 'paused' | 'archived';
  aiProviders: string[];
  skills?: string[];        // nombres de skills inyectadas en ejecución
  selectedAgents?: string[]; excludedAgents?: string[]; includedAgents?: string[];
  agentHashes?: Record<string, string>;
  createdAt: string;
  pendingUpdates?: number;  // calculado en servidor
  pathExists?: boolean;     // calculado en servidor
  gitEnabled?: boolean;
  /** @deprecated — mantenido por compatibilidad con proyectos existentes */
  techId?: string;
}

interface Config {
  version: string; aiProvider: AIProvider;
  customProviders?: CustomAIProvider[];
  apiKey: string; githubToken: string; githubModel: string;
  closeAction?: 'ask' | 'tray' | 'quit';
  agentsDirectoryUrl?: string; agentsDirectoryEnabled?: boolean;
  categories: Category[]; projects: Project[];
}

interface Category {
  id: string; name: string; icon: string; color: string;
  technologies: Technology[];  // campo legacy, no usado en UI nueva
}

interface SelectedNode {
  level:      'global' | 'section' | 'project' | 'uncategorized';
  categoryId: string | null;
  projectId:  string | null;
}

interface PendingAgentToEdit {
  name:       string;
  level:      'global' | 'section' | 'uncategorized' | 'project';
  categoryId?: string | null;
  projectId?: string | null;
}

interface SyncPreviewAgent { name: string; level: string; categoryId: string | null; }
interface SyncPreview {
  summary: { toAdd: number; toUpdate: number; excluded: number; local: number; upToDate: number; total: number };
  toAdd: SyncPreviewAgent[]; toUpdate: SyncPreviewAgent[];
  excluded: SyncPreviewAgent[]; local: SyncPreviewAgent[]; upToDate: SyncPreviewAgent[];
}

interface DashboardNotification {
  id: string; type: 'critical' | 'optimization' | 'info';
  target: 'agent' | 'project'; targetId?: string; targetName: string;
  scopeLabel?: string; message: string;
  action: 'open-agent' | 'open-project' | 'sync-project' | 'generate-context' | 'optimize-agent';
  level?: string; categoryId?: string | null;
}

// ── v2.4.0 — Orquestaciones DAG paralelas ───────────────────────────────

interface QualityScore {
  score:         number;          // 0–100
  grade:         'green' | 'amber' | 'red';
  filesProduced: number;
  filesExpected: number;
  jsonValid:     boolean | null;
  coverageRatio: number | null;
  checks:        Array<{ name: string; passed: boolean; detail?: string }>;
}

interface AtomicOp {
  id:              string;
  executionId:     string;
  orchestrationId: string;
  stepIndex:       number;
  agentName:       string;
  kind:            'modify';
  filePath:        string;
  status:          'applied' | 'reverted';
  createdAt:       string;
  revertedAt?:     string;
}

interface OpsLedger {
  ops:             AtomicOp[];
  lastUpdated:     string;
  orchestrationId: string;
}

interface OrchestrationNode {
  id:            string;                    // UUID estable, e.g. "node-abc123"
  agentName:     string;                    // nombre del agente o "__script:name__"
  dependsOn:     string[];                  // ids de nodos predecesores
  isRoot?:       boolean;                   // true/undefined = conectado al Orquestador; false = nodo flotante sin conexión
  x?:            number;                    // posición en el canvas (px)
  y?:            number;
  dataFlow:      DataFlow;
  contextExtra:  ContextExtra;
  gateAfter?:    boolean;
  scriptParams?: Record<string, unknown>;
}

interface Orchestration {
  id:              string;
  projectId:       string;
  name:            string;
  description:     string;
  nodes:           OrchestrationNode[];     // DAG — único formato desde v2.3
  executionConfig: ExecutionConfig;
  executionCount:  number;
  lastExecutionStatus?: 'success' | 'partial' | 'failed';
  lastExecutedAt?: string;
  createdAt:       string;
  updatedAt:       string;
}

// StepResult — incluye nodeId para identificar el nodo en el DAG
interface StepResult {
  stepIndex:     number;
  agentName:     string;
  nodeId?:       string;                   // v2.3: id del nodo DAG
  input:         { systemPrompt: string; userMessage: string };
  output:        { response: string; handoff?: object };
  filesModified: string[];
  tokensUsed:    { input: number; output: number };
  estimatedCost: number;
  costUnavailable?: boolean;   // CLI no-Claude: la UI muestra "coste n/d"
  duration:      number;
  status:        'success' | 'error' | 'warning';
  error?:        { message: string; category: string; recoverable: boolean };
  backupPath:    string | null;
  gitCommitSha?: string;
  qualityScore?: QualityScore;
  revisions?:    Array<{ at: string; feedback: string | null; previousFilesModified: string[] }>;
}
```

---

## Constantes (`constants/tools.ts`)

- **`ALL_TOOLS`**: `['Bash','Read','Write','Grep','Edit','MultiEdit','WebFetch','WebSearch','TodoRead','TodoWrite']`
- **`agentIcon(name)`**: mapea palabras clave a icono Tabler
- **`MODEL_ICON`**: `haiku→ti-leaf`, `sonnet→ti-bolt`, `opus→ti-brain`
- **`LEVEL_COLOR`**: `global→var(--accent)`, `section→var(--blue)`, `project→var(--amber)`, `uncategorized→var(--text3)`

El nivel `tech` fue eliminado; su entrada en `LEVEL_COLOR` ya no existe.

`constants/projects.ts` exporta además `NATIVE_CLI_PROVIDERS` (`cli`, `copilot-cli`, `antigravity-cli`), el espejo de `CLI_ADAPTERS` del backend. Lo usan `Statusbar` y `ExecutionPanel` para saber si el motor es un CLI nativo.

---

## Sistema de estilos (`styles.css`)

Un único fichero CSS global. Tema oscuro con variables en `:root`.

Variables principales: `--bg0..5`, `--text0..3`, `--accent` (#7c6af7), `--green`, `--amber`, `--blue`, `--coral`, `--border/2/3`.

**Clases de botón:** `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.sm`.

**Árbol de agentes:**
- `.tree-mode-toggle` — tabs Agentes / Skills en la parte superior del panel izquierdo.
- `.tree-mode-btn` / `.tree-mode-btn.active` — botón de tab.
- `.tree-search` — buscador (`margin: 10px 8px 8px` — separación deliberada respecto al toggle de tabs).
- `.tree-search-input` / `.tree-search-icon` / `.tree-search-clear`.
- `.tree-node` / `.tree-node.active` / `.tree-indent` / `.tree-chevron` / `.tree-label` / `.tree-badge`.

**Panel de agentes/skills:**
- `.agents-center` — panel central con cabecera y grid.
- `.agents-panel-head` — cabecera con título (incluye contador) y acciones.
- `.agents-panel-title` — título con número de agentes en monospace gris.
- `.agents-grid` — grid de cards.
- `.agent-card` / `.agent-card.selected` — borde izquierdo coloreado por nivel.
- `.agent-card-head` / `.agent-icon` / `.agent-desc` / `.agent-card-actions`.

**Editor de agentes/skills:**
- `.agent-editor` / `.editor-head` / `.editor-body` / `.editor-foot`.
- `.lang-toggle` / `.lang-btn` / `.lang-btn.active` — selector ES/EN para generación con IA.
- `.ai-gen-area` / `.ai-gen-input` — área de descripción + botón generar.

**Clases de orquestaciones:** `.orch-*` (ver sección Componentes de orquestaciones).

---

## Componentes de layout

- **`Sidebar`**: nav vertical 48px. Iconos: `ti-layout-grid` (proyectos), `ti-cpu` (agentes), `ti-topology-ring-2` (orquestaciones), `ti-message-chatbot` (chat), `ti-settings` (ajustes).
- **`Topbar`**: props `title`, `sub?`, `actions?`.
- **`Statusbar`**: polling `GET /health`, `GET /ai/status`, `GET /ai/usage` cada 30s. Muestra: conexión servidor, estado proveedor, tokens acumulados, tokens de sesión, versión.

---

## Hooks

- **`useToast`**: devuelve `addToast(msg, type?)`. Tipos: `'ok'` (3.5s), `'err'`/`'warn'` (5s), `'info'` (3.5s).
- **`useCategoryHelpers`**: expone `catName(id)` y `catColor(id)`. El helper `techName` se mantiene pero ya no se usa en la UI principal.
- **`useElectron`**: `pickFolder(): Promise<string|null>` y `pickFile(): Promise<string|null>`. Devuelven `null` si el usuario cancela o si la app corre fuera de Electron.

---

## Componentes UI genéricos

### `Modal.tsx`

Props: `title`, `sub?`, `onClose`, `onConfirm?: () => Promise<void>`, `confirmLabel?`, `confirmClass?`, `modalClassName?`, `bodyClassName?`, `hideFooter?`, `children`. Con `hideFooter` no se renderiza el pie (Cancelar / Confirmar), para modales de solo elección.

**Patrón crítico:** `onConfirm` debe lanzar `throw new Error()` (no `return`) para mantener el modal abierto cuando la validación falla.

---

## Componentes de proyectos

- **`ProjectCard`**: tarjeta clickable que abre `ProjectDrawer`. Badge coral si `!pathExists`. Badge con count si `pendingUpdates > 0`.
- **`ProjectDrawer`**: panel 560px. Tab contexto (editable + generación IA). Tab sync/agentes con preview dry-run.
- **`CreateProjectModal`**: selector de categoría (sin tecnología). `POST /projects` con `{ name, categoryId, projectPath, aiProviders }`.
- **`EditProjectModal`**: grid 2 columnas. Selector de categoría (sustituye al antiguo selector de tecnología). `PUT /projects/:id`.
- **`ImportProjectModal`**: selector de categoría (sin tecnología). `POST /projects/import`.
- **`ExcludeAgentModal`**: radio entre "excluir + eliminar archivo" o "solo excluir".

---

## Componentes de agentes

### `AgentsTree.tsx`

Árbol colapsable en el panel izquierdo de la página Agents. Tiene **dos modos** controlados desde `Agents.tsx`:

**Modo `agents`:**
- Jerarquía: Global → Categorías (section, planas — sin sub-nodos de tecnología) → Proyectos → Sin categoría.
- Toggle de modo en la parte superior.
- Buscador `tree-search` con 10px de margen superior respecto al toggle.

**Modo `skills`:**
- Solo muestra el toggle de modo y el buscador (mismo CSS, misma separación).
- No hay nodos de árbol; el panel central muestra `SkillsCenter` con las skills filtradas.

**Props:**
```ts
interface Props {
  selected:       SelectedNode;
  expanded:       Set<string>;
  onSelect:       (node: SelectedNode) => void;
  onToggle:       (key: string) => void;
  search:         string;
  onSearchChange: (v: string) => void;
  mode:           'agents' | 'skills';
  onModeChange:   (m: 'agents' | 'skills') => void;
}
```

El árbol no gestiona el toggle ni el buscador para el modo skills — esos están implementados directamente en `Agents.tsx` con el mismo markup y clases CSS para que sean visualmente idénticos.

### `AgentsCenter.tsx`

Grid central de agentes. Props:

```ts
interface Props {
  node:               SelectedNode;
  agents:             Agent[];
  suggestions:        Agent[];
  suggestionsLoading: boolean;
  selectedAgent:      string | null;
  onSelectAgent:      (agent: Agent) => void;
  onUseSuggestion:    (agent: Agent) => void;
  onNewAgent:         () => void;
  onRefreshSuggestions: () => void;
  onChatWithAgent?:   (agent: Agent) => void;
  searchActive?:      boolean;
}
```

**Contador en cabecera:** cuando `!searchActive && agents.length > 0`, muestra el número de agentes junto al título en monospace gris — el mismo patrón que `SkillsCenter`.

**Badge de origen en búsqueda:** cuando `searchActive`, cada card muestra un badge en la esquina superior derecha con el nivel del agente:
- `global` → etiqueta "Global" en `--green`
- `section` → nombre de categoría en `catColor(categoryId)`
- `project` → nombre de proyecto en `--amber`
- `uncategorized` → "Sin categoría" en `--text3`

El `node` pasado a `AgentCard` se sustituye por uno construido con el nivel real del agente, para que el color del borde de la card sea correcto.

### `AgentCard.tsx`

Borde izquierdo según `LEVEL_COLOR[level]`. Tool pills (máx 3 + "+N más"). Cuando `node.level === 'project'` y el agente no es sugerido, muestra `.agent-card-actions` con botones **Chat** y **Ejecutar**.

**Badge MCP:** si `agent.mcp_servers?.length > 0`, se muestra un pill con icono `ti-plug-connected` y el conteo de servidores en verde, con tooltip que lista sus nombres.

### `AgentEditor.tsx`

Editor en overlay modal. Campos: nombre, descripción, modelo, herramientas, system prompt.

- **Generar con IA:** toggle ES/EN + input de descripción + botón → `POST /ai/generate-prompt`.
- **Optimizar:** botón visible solo si `!agent.optimized && agent.system` → `POST /ai/optimize-agent`.
- **Skills (solo nivel proyecto):** selector multi-chip para `agent.skills[]`. Se carga con `GET /skills/flat` únicamente cuando `node.level === 'project'`.
- **Servidores MCP (todos los niveles):** selector multi-chip para `agent.mcp_servers[]`. Se carga con `GET /mcp/servers?projectId=` (con `projectId` opcional) en todos los niveles — no solo en agentes de proyecto. Permite asociar servidores MCP al agente para que se activen automáticamente al ejecutarlo.
- **Tip de orquestación:** recuadro acento al pie del system prompt cuando el agente se va a usar en orquestaciones.

### `SkillsCenter.tsx`

Grid de skills. Props:

```ts
interface Props {
  skills:        Skill[];   // ya filtradas por búsqueda desde Agents.tsx
  totalSkills:   number;    // total sin filtrar, para mostrar "X / total"
  selectedSkill: string | null;
  onSelectSkill: (skill: Skill) => void;
  onNewSkill:    () => void;
  searchActive?: boolean;
}
```

- Cabecera: icono `ti-puzzle` + "Skills" + contador `{skills.length}` (o `{filtradas} / {total}` en búsqueda).
- Botón "Nuevo skill" oculto durante búsqueda activa.
- Estado vacío diferencia "Sin skills" de "Sin resultados".

### `SkillEditor.tsx`

Editor en overlay modal. Campos: nombre, descripción, contenido (textarea).

**Generar con IA** (mismo patrón que `AgentEditor`):
1. Toggle **ES / EN** (default EN — los skills de código van en inglés).
2. Input de descripción libre (`genDesc`) — requerido antes de generar.
3. Botón "Generar contenido" → `POST /ai/generate-skill { name, description, language }`.
4. El contenido generado se inyecta en el textarea (editable antes de guardar).

`Enter` en el input de descripción dispara la generación.

### `AgentExecutePanel.tsx`

Panel de ejecución que sustituye al centro+editor cuando hay un agente seleccionado para ejecutar. Máquina de estados: `validating → warn-* → ready → running → result | error`.

---

## Páginas

### `Dashboard.tsx`

Vista de inicio. Carga en paralelo `GET /dashboard` y `GET /ai/usage`. Auto-refresca cada 30s.

**Navegación directa a agente:** al hacer click en una notificación de tipo agente, llama `setPendingAgentToEdit({ name, level, categoryId })` antes de `setView('agents')`.

### `Projects.tsx`

Grid de proyectos agrupados por categoría. Sin selector de tecnología — la categoría es el único nivel de clasificación.

### `Agents.tsx`

Página de tres paneles (árbol / centro / editor). Gestiona dos modos: `agents` y `skills`.

**Sistema de búsqueda:**
- `search` — valor crudo del input (actualizado en cada keystroke).
- `debouncedSearch` — versión con delay de 250ms calculada por `useEffect`. Se usa para filtrar, no `search`.
- `allAgents` — catálogo completo cargado **una sola vez** al montar (`GET /agents/flat`). No se recarga al buscar.
- `filteredAgents` — derivado de `allAgents` cuando hay `searchTerm`, o `agents` (del nodo activo) en caso contrario.
- `filteredSkills` — derivado de `skills` filtrando por `debouncedSearch`.
- La función `matchSearch(name, description)` busca el término en nombre **y** descripción.

**Panel izquierdo en modo skills:** se renderiza inline en `Agents.tsx` (no usa `AgentsTree`) con el mismo markup CSS que el modo agentes: toggle de modo + buscador con la misma clase `tree-search`.

**Polling de sync:** `setInterval(600ms)` sobre `GET /agents-directory/status`. Cuando `syncing` pasa de `true` a `false`, recarga agentes del nodo activo.

**Overlay de primer arranque:** cuando `firstSync && syncing`, bloquea la UI y muestra barra de progreso `done/total`.

**Modal de conflictos:** botón badge coral en topbar cuando `pendingConflicts.length > 0`.

**AbortController por nodo:** al cambiar nodo se aborta la petición de sugerencias en curso.

**Sugerencias no repetitivas:** `handleRefreshSuggestions` captura las sugerencias actuales y las pasa como `alreadySuggested` al backend.

**Flujo editor:** click card → `setEditorAgent(agent)`. El editor se muestra en overlay modal (`.overlay` + `.agent-editor-modal`).

**Flujo skills:** click skill → `setEditorSkill(skill)`. "Nuevo skill" → `setEditorSkill(NEW_SKILL)`. El editor se muestra en el mismo tipo de overlay.

**Navegación desde Dashboard:** cuando el store tiene `pendingAgentToEdit` al montar, la página construye el `targetNode`, expande los nodos del árbol y selecciona el nodo. Cuando los agentes cargan, un segundo `useEffect` busca el agente por nombre y abre el editor.

### `Settings.tsx`

Cuatro tabs: **General**, **Categorías**, **Directorio de Agentes**, **MCP**.

**Tab General → Proveedor de IA:** la columna de CLIs muestra solo los verificados (Claude Code, Copilot CLI y Antigravity CLI), más los CLIs personalizados. Gemini CLI, Codex, Aider, Cline y Goose ya no aparecen; quien los tuviera seleccionados se migra al arrancar (backend §8).

**Tab General → Prueba real:** botón visible con cualquier proveedor, también los CLIs. Guarda el formulario (`persistPending`, compartido con *Guardar* y *Probar conexión*) y llama a `POST /ai/smoke-test`. El resultado ("Lee el proyecto correctamente (9.1s)" o el error) se muestra en la misma línea que *Probar conexión*, que solo hace ping a las APIs.

**Tab General → CLI de terminal:** tarjeta visible solo si `GET /cli` devuelve `supported: true` (Windows). Botón *Instalar CLI* / *Desinstalar* → `POST` / `DELETE /cli`; muestra badge "Instalado" y la carpeta destino. Estado `cliStatus` + `cliBusy`, cargado al entrar en la tab. Ver backend §19.

**Tab General → Extensión de VS Code:** tarjeta visible si `GET /vscode` devuelve `supported: true` (el `.vsix` va incluido en la app). Estados: sin comando `code` (explica cómo instalarlo desde VS Code), no instalada (*Instalar extensión*), instalada (badge *Instalada* + *Desinstalar*) y desactualizada respecto a la app (*Actualizar*). Estado `vscodeStatus` + `vscodeBusy`. Ver backend §20.

**GitHub Models (tab General):** al seleccionar el proveedor `github`, el selector de modelo se rellena dinámicamente con `POST /api/ai/models`. Usa primero el token introducido en el formulario (sin necesidad de guardar) y, si está vacío, el backend intenta `gh auth token`. Si la detección falla, usa una lista fallback local y muestra el error en línea.

**Tab Categorías:** lista simple de categorías con nombre, icono y color. Sin gestión de tecnologías (eliminada). Solo permite crear y eliminar categorías.

**Import de agentes desde URL:** el selector de destino muestra Global y las secciones de cada categoría. No hay opciones `tech:` (eliminadas).

**Tab Directorio:** toggle habilitado, URL del repo, estado de última sync, botón "Sincronizar ahora", resolución de conflictos inline, import desde URL individual.

**Tab MCP:** gestión de servidores MCP en tres bloques:
- **Catálogo:** grid de servidores predefinidos (tab "Sin credenciales" / "Con credenciales"). Cada card tiene un icono `.info-icon` con tooltip (`entry.tip`) que explica para qué sirve el servidor. Botón "Añadir" pre-rellena el modal con la configuración del catálogo.
- **Mis servidores:** toggle Global/Proyecto + lista de servidores configurados. Cada item muestra el `.info-icon` con tooltip si `srv.config.description` o `catalogEntry?.tip` existe. CRUD completo con modal de add/edit.
- **Modal add/edit:** campos nombre, tipo (stdio/url), descripción (opcional — aparece como tooltip en la lista), comando/args/env o URL/headers, y botón "Probar conexión" que llama a `POST /api/mcp/servers/:name/test` y muestra las herramientas descubiertas.
- Estado `mcpProjectId` controla qué proyecto está activo en la sección de servidores de proyecto.
- El campo `description` del modal se persiste en `srv.config.description` del servidor; al abrir el modal de edición se pre-rellena desde `srv.config.description`.

### `Chat.tsx`

Chat multi-turno con @mention de agentes, historial por proyecto e indicador de contexto.

Con un proyecto seleccionado, `POST /chat` se ejecuta **dentro del proyecto en solo lectura** con cualquier proveedor: lee sus ficheros, el contexto (`AGENTS.md`…) y las skills, pero no modifica nada. Puede tardar más que una respuesta de texto (hasta 5 min). Sin proyecto es una conversación de texto.

### `Orchestrations.tsx`

Tres sub-vistas: `list` / `editor` / `execution`. La paleta del editor carga agentes aplicables (`GET /agents/applicable?projectId=`) y agentes del proyecto. La sección CDP se activa si algún agente tiene herramientas `browser_*`.

**Scripts en la paleta:** además de los agentes, la paleta carga `GET /scripts` y muestra los scripts en tabs separados (built-in y personalizados). Los scripts se arrastran al lienzo igual que los agentes y pueden repetirse (a diferencia de los agentes).

---

## Componentes de orquestaciones

El sistema de orquestaciones usa un modelo **DAG** (grafo dirigido acíclico) donde cada nodo declara sus dependencias explícitamente mediante `dependsOn: string[]`. Los nodos sin dependencias son raíces y pueden ejecutarse en paralelo.

### `OrchestrationList.tsx`

Si la orquestación tiene `activeExecutionId` (en marcha, lanzada desde la app, VS Code o la API), la tarjeta muestra el badge *En ejecución* y el botón ▶ pasa a ser ⏹ *Detener la ejecución* (`POST /orchestrations/:id/cancel?executionId=`). La página refresca la lista cada 5 s mientras está en la vista de lista, para reflejar ejecuciones que empiezan o acaban fuera. El modal de creación usa `.overlay` (antes `modal-backdrop`, una clase sin estilos que lo dejaba descolocado).

### `OrchestrationEditor.tsx`

Layout tres paneles: paleta (agentes y scripts arrastrables) | lienzo (`NodeCanvas`) | configurador de conexión (`ConnectionConfigurator`).

**Carga de agentes para la paleta:**
1. `GET /agents/applicable?projectId=` — global + section aplicables.
2. `GET /projects/:id/agents` — agentes propios del proyecto.
3. `GET /scripts` — scripts determinísticos (built-in + externos).

Los agentes del proyecto tienen prioridad (aparecen primero). Los agentes excluidos del proyecto no aparecen.

**Paleta con tabs:** dos tabs — *Agentes* y *Scripts*. La tab Scripts divide los scripts en dos grupos: "Scripts" (built-in) y "Scripts personalizados" (externos). Los scripts externos con warnings muestran un icono ámbar junto al nombre.

**Paleta colapsable:** botón `ti-layout-sidebar-left-collapse` en la cabecera colapsa la paleta a una tira vertical con los iconos de tab. Se re-expande desde la tira.

**Drag-and-drop desde paleta:** al arrastrar un agente o script sobre el canvas, se crea un nodo en la posición de suelta con `isRoot: false` (flotante, sin conexión). Si se suelta sobre un nodo existente, el nuevo nodo se coloca debajo y se conecta automáticamente con `dependsOn = [targetNode.id]`. Un agente solo puede aparecer una vez en el canvas (los scripts sí pueden repetirse).

**Purga del canvas:** al cargar, si un agente del canvas ya no existe en disco, se elimina automáticamente. Sus conexiones (`dependsOn`) también se limpian.

**Ajustes de ejecución:** el botón *Ejecución* (`ti-adjustments-horizontal`) de la cabecera despliega una barra con el timeout total y el timeout por paso (en minutos), los turnos máximos por paso (1–100), el **presupuesto máximo** en dólares (vacío = sin límite; solo con Claude) y *Detener ante el primer error*. Estado `execConfig`, con los mismos valores por defecto que el backend (30 min, 10 min, 10 turnos) para las orquestaciones guardadas antes de que existieran esos campos. Se guarda con *Guardar* y *Validar* (`executionConfig` en `PUT /orchestrations/:id`). Si el timeout por paso supera al total se avisa en ámbar: cada paso recibe como mucho lo que queda del total.

**Estado:** `dagNodes: OrchestrationNode[]` — único estado del canvas. `selectedEdge: SelectedEdge | null` — arista o nodo raíz seleccionado (controla qué muestra `ConnectionConfigurator`).

**`getScriptParamsForAgent(agentName)`** — extrae el schema de parámetros del script desde `scripts[]` para pasarlo al configurador.

**`scriptsWithRequiredParams: Set<string>`** — conjunto de nombres de scripts con parámetros obligatorios sin configurar; se pasa al canvas para mostrar advertencias visuales.

### `ConnectionConfigurator.tsx`

Configura una arista del DAG (la conexión entre dos nodos) o el nodo de entrada (Orquestador → nodo raíz).

**DataFlow:** checkboxes `agentOutput` y `filesModified`.

**Gate HITL (`gateAfter`):** toggle al final del configurador para conexiones inter-agente (no disponible en `isInputNode`). Cuando está activo, el orquestador pausa tras ese agente y espera `POST /executions/:execId/gate`. El toggle persiste en `node.gateAfter: boolean`.

**Parámetros de script (`scriptParams`):** cuando el nodo destino es un script con parámetros declarados (p.ej. `budget-guard`), el configurador muestra una sección adicional con los campos del schema. Los valores se guardan en `node.scriptParams: Record<string, unknown>`. Campos obligatorios marcados con `*` en ámbar si están vacíos. El schema `ScriptParamSchema[]` viene de `GET /scripts`.

```ts
export interface ScriptParamSchema {
  key:          string;
  label:        string;
  type:         'number' | 'text' | 'boolean';
  required:     boolean;
  placeholder?: string;
  hint?:        string;
}
```

**Prop `isInputNode`:** `true` para el nodo de entrada (Orquestador → nodo raíz). Deshabilita checkboxes de agente anterior y el toggle de gate. La sección de "Contexto fijo" se llama "Descripción de la tarea" en este modo.

**Auto-save con refs:** al cambiar de nodo (`useEffect` con `[node.id]`), el cleanup persiste el estado `dirty` vía refs antes de desmontar. Evita pérdida de cambios al clicar otra arista.

### `NodeCanvas.tsx`

Lienzo 2D interactivo basado en HTML absoluto + SVG overlay para las aristas.

**Nodo Orquestador:** nodo estático (no en `dagNodes`) que representa el punto de entrada. Se posiciona centrado sobre los nodos raíz (`isRoot !== false`). No es arrastrable. Cuando hay nodos flotantes, muestra un port-out en la parte inferior para conectarlos: click en el port-out del Orquestador → click en el nodo flotante → el nodo pasa a `isRoot: true` (raíz real).

**Nodos flotantes:** nodos con `isRoot: false` y `dependsOn: []`. Se muestran con borde discontinuo y la etiqueta "sin conectar". No reciben arista del Orquestador. Al seleccionar la arista Orquestador→raíz (click en el punto central), aparece un botón `✕` para desconectar ese nodo del Orquestador (vuelve a flotante).

**Nodos de usuario:** div absolutos draggables. Cada nodo tiene:
- Handle de arrastre (`ti-grip-vertical`) + índice topológico.
- Port-out en la parte inferior (click → modo conexión activa, dibuja línea hacia el cursor).
- Port-in visible solo cuando hay una conexión en progreso desde otro nodo.
- Botón `×` para eliminar.
- Badge de modelo (`haiku` / `sonnet` / `opus`) o `script` / `personalizado` para scripts.
- Icono `ti-alert-triangle` en ámbar si el script tiene parámetros obligatorios sin configurar.

**Aristas SVG:** curvas Bézier cúbicas (`C`) con:
- Halo de 6px en `rgba(124,106,247,.12)`.
- Línea de flujo animada con `strokeDasharray`.
- Flecha en el nodo destino.
- Punto central clickable para seleccionar la arista. Si tiene contexto configurado muestra `⚙`, si no `↓`.
- Icono `⏸` ámbar si `node.gateAfter`.
- Al seleccionar: aparece botón `✕` (coral) para eliminar la conexión.

**Aristas Orquestador→raíz:** misma representación pero no tienen botón de eliminar. Click selecciona la arista con `fromId: null`.

**Auto-layout:** `autoLayoutNodes(nodes)` calcula posiciones topológicas con `topologicalLevels()`. Deja espacio sobre los nodos raíz para el nodo Orquestador (`PAD_Y = 20 + NODE_H + 100`). Centrado horizontal por nivel. Disponible como botón "Reordenar" (`ti-layout-distribute-vertical`) cuando hay más de 1 nodo.

**Detección de ciclos:** `hasCycle(nodes, fromId, toId)` — BFS desde el nodo destino; previene crear aristas que formarían un ciclo.

**Estado visual de ejecución:** prop `executionState?: Map<string, 'pending' | 'running' | 'done' | 'error'>` — añade clases `exec-running` / `exec-done` / `exec-error` / `exec-pending` al nodo correspondiente.

**Funciones exportadas:**
- `getAgentIcon(name): string` — mapea nombre de agente a icono Tabler.
- `autoLayoutNodes(nodes): OrchestrationNode[]` — layout topológico.
- `NODE_W = 244`, `NODE_H = 80` — dimensiones de nodo.

### `ExecutionPanel.tsx`

Cuatro estados: formulario previo → corriendo (SSE) → **gate HITL / browser pause** (si activo) → resultado.

**Ejecución paralela:** `computeLevels(nodes)` calcula niveles topológicos. Durante la ejecución, los nodos se agrupan por nivel con `<div class="orch-step-level parallel">` cuando el nivel tiene más de un nodo. `activeNodeIds: Set<string>` rastrea qué nodos están corriendo simultáneamente.

**`canExecute`:**
| Condición | Descripción |
|---|---|
| `!agentsLoading` | Agentes cargados |
| `missingFields.length === 0` | Campos temporales requeridos completos |
| `!browserBlocked` | Navegador conectado (si `needsBrowser && !isNativeCLI`) |
| `!browserLoading` | Estado del navegador cargado |

**Contexto temporal agrupado por nodo:** en el formulario previo, los campos temporales se agrupan por `nodeId` y se muestran en el orden topológico de los nodos. La clave en `temporalValues` es `${nodeId}-${tempId}`.

**Gate HITL en la UI:** cuando el SSE emite `gate-open` (con `nodeId` y `agentName`), el panel muestra un bloque con tres botones: *Aprobar*, *Revisar* (muestra textarea para feedback) y *Cancelar*. La decisión se envía a `POST /executions/:execId/gate { action, feedbackText?, nodeId }`.

**Browser pause:** cuando el SSE emite `browser-required`, el panel muestra el panel de autenticación con estado del navegador y lista de tabs. "Continuar ejecución" llama a `POST /orchestrations/:id/browser-continue?executionId=`.

**Estimación de coste:** en el formulario previo, `GET /orchestrations/:id/estimate` muestra la media de las ejecuciones anteriores (o, la primera vez, que depende de los turnos), el mínimo de tokens de entrada con su coste y un desglose por paso plegable (`<details>`). Sin precio conocido muestra "coste n/d".

**Diff por paso:** si el paso tiene `gitCommitSha` (proyecto con Git activado), su tarjeta incluye *Cambios del paso (diff)*. El componente `StepDiff` carga `GET /orchestrations/:id/executions/:execId/steps/:stepIndex/diff` al abrirse y colorea las líneas añadidas, eliminadas y de cabecera de hunk (`.orch-step-diff .add/.del/.hunk`).

**Presupuesto:** con `maxBudgetUSD`, el formulario previo muestra el límite (y "sin efecto con este proveedor" si no hay precio) y avisa en ámbar si la media de las ejecuciones anteriores ya lo supera. Al agotarse, se muestra el mismo banner que con `budget-guard`.

**Quality Score:** componente `QualityBadge` por paso. Click expande los checks individuales.

**Ops Ledger:** dos tabs en el resultado — `steps` y `ops`. Ops muestra cada operación con icono según `kind` (`add` / `remove` / `modify`), path, agente, estado y botón revertir.

**Banner de presupuesto agotado:** cuando el SSE emite `cancelled` con `reason: 'budget_exceeded'`, `cancelReason` captura `{ type, spent, limit }`. Se muestra `.orch-budget-exceeded-banner` en coral en la vista de resultado. Se resetea al ejecutar de nuevo.

---

## Capturas de pantalla (`npm run screenshots`)

`scripts/screenshots/capture.js` regenera las capturas de `docs/screenshots/` y `docs/web/screenshots/` (1920×1080) con la interfaz real, sin datos del usuario ni gasto de tokens:

- `seed.js` crea en `%TEMP%/agent-hub-screenshots` un directorio de datos de demostración (`CDM_DATA_DIR`): 5 proyectos inventados con su stack real (para que se detecten las skills), agentes en los tres niveles con una marca `[rol:…]` en el prompt, el catálogo de skills del repo, servidores MCP, historial de chat y uso acumulado.
- `fake-claude.js` sustituye a `claude` delante en el PATH del backend (puerto 3799, así no choca con la app abierta). Responde en el formato JSON de Claude según la marca del agente, escribe ficheros en modo agente (hay diff de verdad) y espera lo que diga `fake-delay.txt`, que el script sube a 9 s para capturar el nivel paralelo en marcha.
- Recorre la app con Playwright y el Chrome instalado (`SCREENSHOT_BROWSER=msedge` para Edge): wizard, dashboard, proyectos, agentes y editores, orquestaciones, canvas con una conexión seleccionada, formulario con estimación, ejecución paralela, resultado con diff, chat y ajustes. Antes de cada captura sustituye en la página las rutas locales y el nombre de usuario por genéricos.
- Requiere `dist/renderer` (`npm run build:renderer`). `npm run screenshots -- 03-agents 10-chat` rehace solo esas; `SCREENSHOT_OUT=<carpeta>` las deja en otra carpeta para revisarlas sin tocar las de la documentación. `12-syncro-conflicts` (conflictos del directorio) no se genera.

## Modo incrustado (`embed.ts`)

`?embed=1&project=<id>&orch=<id>&mode=editor|execution|new` muestra solo las orquestaciones de un proyecto, para la extensión de VS Code (backend §20). `EMBED` se lee una vez: el store arranca en `orchestrations` sin wizard, `App` no pinta `Sidebar` ni `Statusbar`, y `Orchestrations` fija el proyecto, oculta su selector y, tras la primera carga de la lista, abre la orquestación en `editor` o `execution` (o el modal de creación con `new`). El contenido espera a que el proyecto esté cargado: en modo incrustado el id llega antes que la lista de proyectos.

## Patrones recurrentes

**No actualización optimista** — esperar confirmación del servidor antes de actualizar estado local.

**`window.api` con optional chaining** — `const api = (window as any).api; api?.method?.()`.

**Modal controlado** — `onConfirm` lanza `throw new Error()` para impedir cierre cuando falla validación.

**Búsqueda debounced** — 250ms de delay entre el keystroke y el filtrado. `allAgents` se carga una vez al montar, no en cada búsqueda.

**Iconografía** — solo `<i className="ti ti-nombre" />`. Sin SVGs inline, sin emojis.
