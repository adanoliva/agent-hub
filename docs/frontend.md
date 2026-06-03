# Documentación técnica — Frontend (`src/renderer/`)

> Stack: React 19 + Vite 8 + Zustand 5 + TypeScript
> Última actualización: 2026-06-03 · Versión: 2.1.0

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

// ── v2.1.0 — Orquestaciones avanzadas ───────────────────────────────────

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

// StepResult extiende la definición base con los campos de v2.1.0
interface StepResult {
  stepIndex:     number;
  agentName:     string;
  input:         { systemPrompt: string; userMessage: string };
  output:        { response: string; handoff?: object };
  filesModified: string[];
  tokensUsed:    { input: number; output: number };
  estimatedCost: number;
  duration:      number;
  status:        'success' | 'error' | 'warning';
  error?:        { message: string; category: string; recoverable: boolean };
  backupPath:    string | null;
  gitCommitSha?: string;           // v2.1.0: SHA del commit de checkpoint
  qualityScore?: QualityScore;     // v2.1.0: puntuación automática
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

Props: `title`, `sub?`, `onClose`, `onConfirm: () => Promise<void>`, `confirmLabel?`, `confirmClass?`, `modalClassName?`, `bodyClassName?`, `children`.

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

### `AgentEditor.tsx`

Editor en overlay modal. Campos: nombre, descripción, modelo, herramientas, system prompt.

- **Generar con IA:** toggle ES/EN + input de descripción + botón → `POST /ai/generate-prompt`.
- **Optimizar:** botón visible solo si `!agent.optimized && agent.system` → `POST /ai/optimize-agent`.
- **Skills (solo nivel proyecto):** selector multi-chip para `agent.skills[]`. Se carga con `GET /skills/flat` únicamente cuando `node.level === 'project'`.
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

Tres tabs: **General**, **Categorías**, **Directorio de Agentes**.

**Tab Categorías:** lista simple de categorías con nombre, icono y color. Sin gestión de tecnologías (eliminada). Solo permite crear y eliminar categorías.

**Import de agentes desde URL:** el selector de destino muestra Global y las secciones de cada categoría. No hay opciones `tech:` (eliminadas).

**Tab Directorio:** toggle habilitado, URL del repo, estado de última sync, botón "Sincronizar ahora", resolución de conflictos inline, import desde URL individual.

### `Chat.tsx`

Chat multi-turno con @mention de agentes, historial por proyecto e indicador de contexto.

### `Orchestrations.tsx`

Tres sub-vistas: `list` / `editor` / `execution`. La paleta del editor carga agentes aplicables (`GET /agents/applicable?projectId=`) y agentes del proyecto. La sección CDP se activa si algún agente tiene herramientas `browser_*`.

**Scripts en la paleta:** además de los agentes, la paleta carga `GET /scripts` y muestra los scripts determinísticos en una sección separada. Los scripts se arrastran al lienzo igual que los agentes.

---

## Componentes de orquestaciones

### `OrchestrationEditor.tsx`

Layout tres paneles: paleta (agentes arrastrables) | lienzo (`NodeCanvas`) | configurador de conexión (`ConnectionConfigurator`).

**Carga de agentes para la paleta:**
1. `GET /agents/applicable?projectId=` — global + section aplicables.
2. `GET /projects/:id/agents` — agentes propios del proyecto.

Los agentes del proyecto tienen prioridad (aparecen primero). Los agentes excluidos del proyecto no aparecen.

**Purga del canvas:** al cargar, si un agente del canvas ya no existe en disco, se elimina automáticamente.

### `ConnectionConfigurator.tsx`

**DataFlow:** checkboxes `agentOutput` y `filesModified`.

**Gate HITL (`gateAfter`):** toggle al final del configurador para conexiones inter-agente (no disponible en `isInputNode`). Cuando está activo, el orquestador pausa tras ese agente y espera `POST /executions/:execId/gate`. El toggle persiste en `node.gateAfter: boolean`.

**Prop `isInputNode`:** `true` para el nodo de entrada (Orquestador → Agente 1). Deshabilita los checkboxes de agente anterior y el toggle de gate.

**Auto-save:** el cleanup del `useEffect` de nodo persiste cambios pendientes con refs antes de desmontar.

### `NodeCanvas.tsx`

Lienzo vertical del editor. Los nodos de tipo script (`agentName.startsWith('__script:')`) se renderizan con clase `.orch-node-script` y badge `model-script`. Los nodos agente/script se distinguen visualmente pero comparten la misma interfaz de arrastre.

`fmtAgentName(name)` formatea los nombres `__script:quality-score__` → `quality score` para mostrar en el lienzo.

### `ExecutionPanel.tsx`

Cuatro estados: formulario previo → corriendo (SSE) → **gate HITL** (si activo) → resultado.

**`canExecute`:**
| Condición | Descripción |
|---|---|
| `!agentsLoading` | Agentes cargados |
| `missingFields.length === 0` | Campos temporales requeridos completos |
| `!browserBlocked` | Navegador conectado (si `needsBrowser`) |
| `!browserLoading` | Estado del navegador cargado |

**Gate HITL en la UI:** cuando el SSE emite `gate-open`, el panel muestra un bloque ámbar con el nombre del agente completado y tres botones: *Aprobar y continuar*, *Revisar y rehacer* (muestra textarea para feedback) y *Cancelar orquestación*. La decisión se envía a `POST /executions/:execId/gate`.

**Quality Score:** cada tarjeta de paso en el resultado muestra el componente `QualityBadge` si `stepResult.qualityScore` existe. Al hacer clic se expanden los checks individuales con su estado.

**Ops Ledger:** el resultado final tiene dos tabs: `steps` (comportamiento previo) y `ops` (operaciones del ledger). Cada entrada del ledger muestra id, fichero, agente, paso y estado, con botón de revertir que llama a `POST /ops/:opId/revert`.

**Tabs estado global:** `opsTab: 'steps' | 'ops'` controla la vista activa en el resultado.

---

## Patrones recurrentes

**No actualización optimista** — esperar confirmación del servidor antes de actualizar estado local.

**`window.api` con optional chaining** — `const api = (window as any).api; api?.method?.()`.

**Modal controlado** — `onConfirm` lanza `throw new Error()` para impedir cierre cuando falla validación.

**Búsqueda debounced** — 250ms de delay entre el keystroke y el filtrado. `allAgents` se carga una vez al montar, no en cada búsqueda.

**Iconografía** — solo `<i className="ti ti-nombre" />`. Sin SVGs inline, sin emojis.
