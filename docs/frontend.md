# Documentación técnica — Frontend (`src/renderer/`)

> Stack: React 19 + Vite 8 + Zustand 5 + TypeScript
> Última actualización: 2026-05-23

---

## Índice

1. [Visión general](#1-visión-general)
2. [Punto de entrada](#2-punto-de-entrada)
3. [Estado global (`store/`)](#3-estado-global-store)
4. [Capa de API (`api.ts`)](#4-capa-de-api-apits)
5. [Tipos compartidos (`types.ts`)](#5-tipos-compartidos-typests)
6. [Constantes y hooks](#6-constantes-y-hooks)
7. [Sistema de estilos (`styles.css`)](#7-sistema-de-estilos-stylescss)
8. [Componentes de layout](#8-componentes-de-layout)
9. [Componentes UI genéricos](#9-componentes-ui-genéricos)
10. [Componentes de proyectos](#10-componentes-de-proyectos)
11. [Componentes de agentes](#11-componentes-de-agentes)
12. [Páginas](#12-páginas)
13. [Patrones recurrentes](#13-patrones-recurrentes)

---

## 1. Visión general

El frontend es el proceso renderer de Electron, compilado con Vite y servido desde Express en producción. No usa React Router para la navegación entre vistas: el estado `view` del store Zustand controla qué página se renderiza, y las páginas se cargan bajo demanda con `React.lazy`.

```
src/renderer/
├── index.html              ← shell HTML (CSP, fuentes, Tabler Icons CDN)
├── main.tsx                ← ReactDOM.createRoot
├── App.tsx                 ← ErrorBoundary + shell + lazy pages
├── styles.css              ← todos los estilos (variables CSS + clases globales)
├── api.ts                  ← req<T>(): fetch tipado a /api/*
├── types.ts                ← tipos compartidos entre todos los módulos
├── store/index.ts          ← Zustand: estado global de la app
├── hooks/
│   ├── useToast.ts
│   └── useCategoryHelpers.ts
├── constants/tools.ts      ← ALL_TOOLS, iconos, colores de nivel
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

### Flujo de datos

```
Express :3737 (API REST)
    ↕ fetch via req()
Zustand store  ←→  React components
    ↕ window.api (IPC bridge)
Electron main process
```

El renderer nunca accede directamente al sistema de archivos ni al IPC. Toda comunicación con el backend ocurre a través de `req()` (HTTP) o `window.api` (IPC bridge expuesto por `preload.js`).

---

## 2. Punto de entrada

### `index.html`

Shell mínimo. Carga recursos externos antes de montar React:

```html
<!-- Fuentes -->
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono...&family=Syne...">

<!-- Iconografía (exclusivamente Tabler Icons v3.6.0) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.6.0/...">

<!-- React entry point -->
<div id="root"></div>
<script type="module" src="/main.tsx"></script>
```

La CSP (`Content-Security-Policy`) permite `localhost`, `unsafe-inline` y `unsafe-eval` (necesarios para Vite HMR en dev y para el CDN de fuentes e iconos).

### `main.tsx`

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `App.tsx`

Tres responsabilidades:

**ErrorBoundary** — captura errores de renderizado no controlados y muestra un panel de error en monospace con el stack trace. Evita que la ventana quede en blanco.

**AppInner** — shell de la aplicación:

```tsx
useEffect(() => {
  // 1. Versión de la app (IPC)
  api?.getVersion?.().then(setVersion);

  // 2. Configuración y tema
  req<Config>('GET', '/config').then(cfg => {
    setConfig(cfg);
    document.body.classList.toggle('light', cfg.theme === 'light');
  });

  // 3. Lista de proyectos
  req<Project[]>('GET', '/projects').then(setProjects);

  // 4. Listener del diálogo de cierre (IPC)
  api?.onCloseRequested?.(() => setShowCloseDialog(true));
}, []);
```

Renderiza el layout principal y, según `view`, la página activa bajo `<Suspense>`:

```tsx
<div id="app">
  <Sidebar />
  <div className="main">
    <Suspense fallback={null}>
      {view === 'projects' && <Projects />}
      {view === 'agents'   && <Agents />}
      {view === 'chat'     && <Chat />}
      {view === 'settings' && <Settings />}
    </Suspense>
    <Statusbar />
  </div>
  <ToastContainer />
  {showWizard      && <Wizard onDone={...} />}
  {showCloseDialog && <CloseDialog onRespond={...} />}
</div>
```

**Lazy loading de páginas** con wrapper para exports nombrados:

```tsx
const Projects = lazy(() => import('./pages/Projects').then(m => ({ default: m.Projects })));
const Agents   = lazy(() => import('./pages/Agents').then(m => ({ default: m.Agents })));
const Chat     = lazy(() => import('./pages/Chat').then(m => ({ default: m.Chat })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
```

`React.lazy` requiere default exports. Como las páginas usan named exports (`export function Projects()`), el `.then()` crea el default export dinámicamente.

**Wizard** — se muestra si `localStorage.getItem('cdm-wizard-done')` no existe (primer arranque). Una vez completado o saltado, guarda la clave y no vuelve a aparecer.

---

## 3. Estado global (`store/`)

### `store/index.ts`

Store Zustand con el estado mínimo genuinamente global. El estado específico de cada vista (árbol de agentes, mensajes de chat, etc.) vive en `useState` local de cada página.

```ts
interface AppState {
  // Navegación
  view:       'projects' | 'agents' | 'chat' | 'settings';

  // Datos globales
  config:     Config | null;
  projects:   Project[];
  appVersion: string | null;

  // Sistema de toasts
  toasts:     Toast[];

  // Acciones
  setView:        (view: View) => void;
  setConfig:      (config: Config) => void;
  setProjects:    (projects: Project[]) => void;
  setAppVersion:  (v: string) => void;
  fetchProjects:  () => Promise<void>;
  addToast:       (msg: string, type?: ToastType) => void;
  removeToast:    (id: string) => void;
}
```

### Sistema de toasts

`addToast` crea un toast con UUID, lo añade al array y programa su auto-dismiss:

```ts
addToast: (msg, type = 'ok') => {
  const id = crypto.randomUUID();
  set(s => ({ toasts: [...s.toasts, { id, msg, type }] }));
  const delay = type === 'err' || type === 'warn' ? 5000 : 3500;
  setTimeout(() => get().removeToast(id), delay);
}
```

### Uso desde componentes

```ts
// Leer un slice — solo rerenderiza cuando ese dato cambia
const config   = useStore(s => s.config);
const projects = useStore(s => s.projects);

// Leer una acción (referencia estable, no causa rerender)
const setView     = useStore(s => s.setView);
const fetchProjects = useStore(s => s.fetchProjects);

// Acceso imperativo fuera de un componente
useStore.getState().addToast('Operación completada');
```

---

## 4. Capa de API (`api.ts`)

```ts
const BASE = '/api';

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}
```

- En desarrollo, Vite proxea `/api/*` → `http://localhost:3737/api/*`.
- En producción, Express sirve tanto la API como el renderer desde el mismo origen.
- Los errores del servidor (`{ error: string }`) se relanzán como `Error` para que los componentes puedan capturarlos con `catch`.

---

## 5. Tipos compartidos (`types.ts`)

### Tipos principales

```ts
interface Agent {
  name:        string;
  description: string;
  model:       string;           // ID completo del modelo
  tools:       string[];
  system:      string;           // system prompt
  optimized?:  boolean;          // true si fue optimizado con IA
  // Solo en agentes de la lista (no en editor)
  level?:      'global' | 'section' | 'tech' | 'project' | 'uncategorized';
  categoryId?: string | null;
  techId?:     string | null;
  projectId?:  string | null;
  suggested?:  boolean;          // agente sugerido por IA, no guardado aún
}

interface Project {
  id:             string;
  name:           string;
  categoryId:     string;
  techId?:        string;
  path:           string;
  description:    string;
  status:         'active' | 'paused' | 'archived';
  aiProvider:     'claude' | 'github' | 'both';
  selectedAgents: string[];
  excludedAgents: string[];
  agentHashes:    Record<string, string>;
  createdAt:      string;
  // Calculados en el servidor al listar
  pendingUpdates?: number;
  pathExists?:     boolean;
}

interface Config {
  version:                 string;
  aiProvider:              'cli' | 'api' | 'github';
  apiKey:                  string;
  githubToken:             string;
  githubModel:             string;
  theme:                   'dark' | 'light';
  closeAction?:            'ask' | 'tray' | 'quit';
  agentsDirectoryUrl?:     string;   // URL del repo GitHub de agentes externos
  agentsDirectoryEnabled?: boolean;  // false para deshabilitar sync al inicio
  categories:              Category[];
  projects:                Project[];
}

interface SyncEntry {
  status: 'ok' | 'outdated' | 'new' | 'local' | 'excluded';
  agent:  Agent;
}
type SyncStatus = Record<string, SyncEntry>;

interface SelectedNode {
  level:      'global' | 'section' | 'tech' | 'project' | 'uncategorized';
  categoryId: string | null;
  techId:     string | null;
  projectId:  string | null;
}

// Sync del directorio de agentes (agents-sync.js)
interface SyncConflict {
  fileKey:    string;   // clave única: ruta relativa en el repo remoto
  localPath:  string;   // ruta absoluta en disco
  remotePath: string;   // ruta relativa en el repo
  remoteSHA:  string;   // git blob SHA del archivo remoto actual
  localSHA:   string;   // git blob SHA del archivo en disco actual
  name:       string;   // nombre del agente
}

interface AgentSyncProgress {
  done:    number;
  total:   number;
  current: string;  // nombre del archivo en proceso
}

interface AgentDirectoryStatus {
  enabled:          boolean;
  url:              string;
  syncing:          boolean;
  firstSync:        boolean;   // true si cache/agents-meta.json no existía al iniciar
  progress:         AgentSyncProgress;
  lastSync:         string | null;      // ISO timestamp
  repoCommitSHA:    string | null;
  agentCount:       number;
  pendingConflicts: SyncConflict[];
  lastResult: {
    updated:   number;
    skipped:   number;
    errors:    Array<{ file: string; error: string }>;
    error?:    string;   // error global (ej. fallo de red)
    upToDate?: boolean;  // sin cambios
  } | null;
}
```

---

## 6. Constantes y hooks

### `constants/tools.ts`

**`ALL_TOOLS`** — array de las 10 herramientas disponibles para agentes:
`['Bash', 'Read', 'Write', 'Grep', 'Edit', 'MultiEdit', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite']`

**`agentIcon(name)`** — mapea el nombre del agente a una clase de icono Tabler según palabras clave:

| Palabras clave en el nombre | Icono |
|---|---|
| `review`, `audit` | `ti-eye` |
| `git`, `commit` | `ti-git-commit` |
| `test` | `ti-test-pipe` |
| `doc`, `writer` | `ti-file-text` |
| `refactor` | `ti-refresh` |
| `chat`, `assistant` | `ti-message` |
| `security` | `ti-shield` |
| `debug` | `ti-bug` |
| `design`, `ux` | `ti-palette` |
| (otros) | `ti-robot` |

**`MODEL_ICON`** — icono por modelo:

| Clave | Icono | Semántica |
|---|---|---|
| haiku | `ti-leaf` | Ligero, rápido |
| sonnet | `ti-bolt` | Equilibrado |
| opus | `ti-brain` | Potente |

**`LEVEL_COLOR`** — color de borde/acento por nivel de agente:

| Nivel | Color |
|---|---|
| `global` | `var(--accent)` |
| `section` | `var(--blue)` |
| `tech` | `var(--green)` |
| `project` | `var(--amber)` |
| `uncategorized` | `var(--text3)` |

### `hooks/useToast.ts`

```ts
export function useToast() {
  const addToast = useStore(s => s.addToast);
  return addToast;
}
// Uso: const toast = useToast(); toast('Guardado', 'ok');
```

Devuelve directamente la función `addToast` (no un objeto). Tipo de toast: `'ok' | 'err' | 'info' | 'warn'`.

### `hooks/useCategoryHelpers.ts`

```ts
export function useCategoryHelpers() {
  const categories = useStore(s => s.config?.categories ?? []);

  const catName  = (id: string) => categories.find(c => c.id === id)?.name ?? id;
  const catColor = (id: string) => categories.find(c => c.id === id)?.color ?? 'var(--text3)';
  const techName = (catId: string, techId: string) =>
    categories.find(c => c.id === catId)?.technologies.find(t => t.id === techId)?.name ?? techId;

  return { catName, catColor, techName };
}
```

---

## 7. Sistema de estilos (`styles.css`)

Un único fichero CSS global sin preprocesadores. Las variables CSS permiten cambiar el tema sin tocar ningún componente.

### Variables de tema

```css
/* Tema oscuro (por defecto, en :root) */
:root {
  --bg0: #0d0d0f;    /* fondo más profundo (body) */
  --bg1: #111113;    /* sidebar, statusbar */
  --bg2: #16161a;    /* cards, drawers */
  --bg3: #1c1c21;    /* inputs, hover */
  --bg4: #242429;    /* bordes hover, scrollbar thumb */
  --bg5: #2a2a31;    /* bordes activos */

  --text0: #f0f0f5;  /* texto principal */
  --text1: #c8c8d4;  /* texto secundario */
  --text2: #8888a0;  /* texto terciario, labels */
  --text3: #55556a;  /* placeholder, iconos inactivos */

  --accent:     #7c6af7;  /* violeta: color de marca */
  --accent-dim: rgba(124,106,247,.12);
  --green:  #3ecf8e;
  --amber:  #f59e0b;
  --blue:   #3b82f6;
  --coral:  #fb7185;

  --border:  rgba(255,255,255,.06);
  --border2: rgba(255,255,255,.09);
  --border3: rgba(255,255,255,.14);

  --mono: 'JetBrains Mono', monospace;
  --sans: 'Syne', sans-serif;
}

/* Tema claro (body.light) */
body.light {
  --bg0: #f4f4f8;
  --bg1: #ebebf0;
  /* ... overrides de todas las variables */
  --accent: #6c5ce7;
}
```

El cambio de tema se activa/desactiva con `document.body.classList.toggle('light', theme === 'light')`.

### Estructura del layout shell

```
#app (display: flex, height: 100vh)
├── .sidebar (48px, flex-direction: column)
└── .main (flex: 1, flex-direction: column)
    ├── .view.active (flex: 1, display: flex, flex-direction: column)
    │   ├── .topbar (44px de alto)
    │   └── contenido de la vista (flex: 1, overflow-y: auto)
    └── .statusbar (22px de alto)
```

### Clases de botón

| Clase | Descripción |
|---|---|
| `.btn` | Botón base: relleno `var(--bg3)`, borde `var(--border2)` |
| `.btn.primary` | Fondo `var(--accent)`, texto blanco |
| `.btn.ghost` | Sin fondo ni borde, solo hover con `var(--bg3)` |
| `.btn.danger` | Color de texto `var(--coral)` |
| `.btn.sm` | Padding reducido, fuente 12px |

Reset global de `<button>`:
```css
button { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
```
Imprescindible porque los navegadores aplican `background: buttonface` por defecto.

### Badges

```css
.badge            /* base: inline-flex, border-radius 6px, padding 2px 8px */
.badge.green      /* border: green, texto verde */
.badge.amber      /* border: amber */
.badge.blue       /* border: blue */
.badge.accent     /* border: accent (violeta) */
.badge.gray       /* border: border2, texto text2 */
.badge.coral      /* border: coral, texto coral */
```

### Model pills

```css
.tool-pill            /* chip de herramienta: bg3, border, font-size 10px */
.tool-pill.model-haiku   /* verde: cli ligero */
.tool-pill.model-sonnet  /* accent: equilibrado */
.tool-pill.model-opus    /* amber: potente */
```

### Toasts

Se posicionan en la esquina inferior derecha:
```css
.toast-wrap { position: fixed; bottom: 36px; right: 20px; z-index: 9999; }
.toast      { /* flex, border-radius 10px, border-left 3px colored */ }
.toast.ok   { border-left-color: var(--green); }
.toast.err  { border-left-color: var(--coral); }
.toast.warn { border-left-color: var(--amber); }
.toast.info { border-left-color: var(--blue);  }
```

---

## 8. Componentes de layout

### `Sidebar.tsx`

Barra de navegación vertical de 48px de ancho. Botones de icono con tooltip en `title`.

```
.sidebar
├── .nav-btn [logo ti-robot]         → setView('projects')
├── .nav-btn [ti-layout-grid]        → setView('projects')  (activo si view='projects')
├── .nav-btn [ti-cpu]                → setView('agents')
├── .nav-btn [ti-message-chatbot]    → setView('chat')
├── .sidebar-spacer (flex: 1)
└── .nav-btn [ti-settings]           → setView('settings')
```

El botón activo recibe la clase `.active` basada en `view` del store.

### `Topbar.tsx`

```tsx
interface TopbarProps {
  title:    string;
  sub?:     string;          // subtítulo en monospace, separado por |
  actions?: React.ReactNode; // botones en el extremo derecho
}
```

```
.topbar
├── .topbar-title  "{title}"
├── .topbar-sep    ("|" visual)
├── .topbar-sub    "{sub}"   (opcional)
├── .topbar-spacer (flex: 1)
└── .topbar-actions {actions} (opcional)
```

El prop `actions` permite que cada página añada sus propios controles al topbar sin modificar el componente. Ejemplo: Settings pasa el toggle de tema; Chat pasa el selector de proyecto.

### `Statusbar.tsx`

Barra inferior de 22px. Consulta el servidor al montar y reactualiza el indicador de IA cuando cambia `config?.aiProvider`.

```
.statusbar
├── .status-item [sdot verde/rojo] "Conectado / Desconectado"
├── .status-item [sdot verde/ámbar] "Claude CLI / Anthropic API / GitHub Copilot"
├── .status-item [ti-folder] "{appDir}"
└── .status-item [marginLeft: auto] "v{appVersion}"
```

**Indicador de proveedor IA:**

| Config `aiProvider` | Texto mostrado |
|---|---|
| `cli` | Claude CLI |
| `api` | Anthropic API |
| `github` | GitHub Copilot |

El punto es verde si `GET /ai/status` devuelve `ready: true`, ámbar si no.

---

## 9. Componentes UI genéricos

### `Toast.tsx` — `<ToastContainer />`

Lee `toasts` del store y renderiza cada uno en `.toast-wrap`. Click sobre un toast lo descarta llamando a `removeToast(id)`.

```tsx
const ICONS = { ok: 'ti-circle-check', err: 'ti-alert-circle', info: 'ti-info-circle', warn: 'ti-alert-triangle' };
```

### `Modal.tsx`

Modal reutilizable controlado por props del padre.

```tsx
interface ModalProps {
  title:          string;
  sub?:           string;           // HTML permitido en subtítulo
  onClose:        () => void;
  onConfirm:      () => Promise<void>;
  confirmLabel?:  string;           // default: "Confirmar"
  confirmClass?:  string;           // default: "primary"
  children:       React.ReactNode;
}
```

**Comportamiento:**
- Click en overlay → `onClose()`.
- Click en "Confirmar" → llama `onConfirm()`. Si resuelve sin error, cierra automáticamente. Si lanza, mantiene el modal abierto y muestra el estado de carga en el botón.
- El estado `loading` deshabilita ambos botones mientras se espera la promesa.

**Patrón de validación:** los handlers `onConfirm` deben lanzar `throw new Error('...')` (no `return`) para mantener el modal abierto cuando la validación falla.

```tsx
async function handleConfirm() {
  if (!name.trim()) {
    toast('El nombre es obligatorio', 'err');
    throw new Error('validation'); // ← impide que Modal se cierre
  }
  await req('POST', '/agents', { ... });
}
```

### `Wizard.tsx`

Overlay de primer arranque (`z-index: 1000`). Tres pasos:

**Paso 0 — Bienvenida:**
Grid de tarjetas de características (agentes, proyectos, chat, sync). Botón "Empezar".

**Paso 1 — Proveedor de IA:**
- Detecta Claude CLI en mount (`GET /detect-cli`). Muestra botón de instalación si no está.
- Selector de GitHub Models (token + modelo).
- Selector de Anthropic API (API key).

**Paso 2 — Configurando:**
- En mount, llama `POST /setup` con las credenciales elegidas.
- Muestra un log de progreso en tiempo real.
- Botón "Finalizar" activo solo cuando el setup ha terminado.

Al completar o saltar: `localStorage.setItem('cdm-wizard-done', '1')` + `onDone()`.

### `CloseDialog.tsx`

Diálogo personalizado para el comportamiento al cerrar la ventana. Aparece cuando el main process envía `app:close-requested` por IPC.

```tsx
interface Props {
  onRespond: (action: 'tray' | 'quit', remember: boolean) => void;
}
```

Dos opciones en estilo radio-button:
- **Minimizar al tray** — la app sigue corriendo en segundo plano.
- **Salir completamente** — cierra la app y el servidor.

Checkbox "Recordar mi elección" — si está marcado, `remember: true` se envía al main process, que persiste `closeAction` en `config.json`.

El botón "Cancelar" llama `onRespond('tray', false)` — oculta la ventana sin guardar preferencia.

---

## 10. Componentes de proyectos

### `StatusBadge.tsx`

Tres badges de solo lectura:

**`ProjectStatusBadge`:**

| Estado | Color | Icono |
|---|---|---|
| `active` | green | `ti-circle-check` |
| `paused` | amber | `ti-player-pause` |
| `archived` | gray | `ti-archive` |

**`SyncStatusBadge`:**

| Estado | Color | Icono | Significado |
|---|---|---|---|
| `ok` | green | `ti-circle-check` | Actualizado |
| `outdated` | amber | `ti-refresh` | Hay versión más nueva |
| `new` | blue | `ti-sparkles` | No está en el proyecto |
| `local` | gray | `ti-device-laptop` | Solo existe en el proyecto |
| `excluded` | gray | `ti-eye-off` | Excluido del sync |

**`ProviderBadge`:**

| Provider | Color | Icono |
|---|---|---|
| `claude` | accent | `ti-robot` |
| `github` | gray | `ti-brand-github` |
| `both` | blue | `ti-git-merge` |

### `ProjectCard.tsx`

Tarjeta en el grid de proyectos.

```
.proj-card
├── .proj-card-head
│   ├── .proj-card-name      "{project.name}"
│   └── .proj-pending        "{pendingUpdates}" (si > 0)
├── .proj-card-meta
│   ├── badge tech/cat
│   ├── ProjectStatusBadge
│   ├── ProviderBadge
│   └── badge coral "ruta no encontrada" (si !pathExists)
└── .proj-card-actions (onClick stopPropagation)
    ├── btn ghost [ti-brand-vscode]  → window.api.openVSCode(path)
    ├── btn ghost [ti-folder-open]   → window.api.openPath(path)
    └── btn sm [ti-refresh] "Sync"  → POST /projects/:id/sync (si pendingUpdates > 0)
```

Click en la tarjeta (fuera de actions) → abre `ProjectDrawer`.

### `ProjectDrawer.tsx`

Panel lateral de 560px que aparece deslizándose desde la derecha.

**Tabs:**

**Tab "CLAUDE.md" / "copilot-instructions.md":**
- Textarea con el contenido actual (`GET /projects/:id/context`).
- Botón "Guardar" → `PUT /projects/:id/context`.
- Botón "Generar con IA" → `POST /projects/:id/generate-context?type=claude|github`.

**Tab "Sync / Agentes":**
- Lista de agentes con su `SyncStatusBadge`.
- Para agentes incluidos: botón "Excluir" abre `ExcludeAgentModal`.
- Para agentes excluidos: botón "Incluir" → quita de `excludedAgents` + `POST /projects/:id/sync`.
- Botón "Sincronizar todos" → `POST /projects/:id/sync`.

**Footer:**
- Abrir en VS Code / Abrir carpeta / Editar → `EditProjectModal` / Eliminar.

### `CreateProjectModal.tsx`

Campos: nombre, categoría, tecnología, carpeta base (picker), descripción, provider.

La ruta final del proyecto se construye como `basePath + '/' + slugify(name)` y se muestra como preview antes de confirmar. `POST /projects`.

### `EditProjectModal.tsx`

Edita nombre, descripción, estado (`active`/`paused`/`archived`), tecnología y provider.

Si el provider cambia, muestra un aviso explicando que los agentes se migrarán de directorio. `PUT /projects/:id`.

### `ImportProjectModal.tsx`

Para proyectos ya existentes en disco. Permite seleccionar la carpeta con el picker nativo y configura nombre, categoría y provider. `POST /projects/import`.

### `ExcludeAgentModal.tsx`

Modal con dos opciones (radio):
1. **Excluir y eliminar el archivo** → añade a `excludedAgents` + `DELETE /projects/:id/agents/:name`.
2. **Solo excluir** → añade a `excludedAgents` (el fichero permanece en disco).

---

## 11. Componentes de agentes

### `AgentCard.tsx`

Tarjeta para mostrar un agente en la cuadrícula central.

```
.agent-card (border-left de color según nivel)
├── header
│   ├── <i> agentIcon(name)
│   ├── nombre
│   └── badge "sugerido" (si agent.suggested)
├── descripción (2 líneas con ellipsis)
├── tool pills (máx. 3 visibles, luego "+N más")
└── model pill (haiku/sonnet/opus con icono)
```

El color del borde izquierdo viene de `LEVEL_COLOR[agent.level]`.

### `AgentsTree.tsx`

Panel izquierdo de la vista de agentes. Árbol de nodos navegables:

```
[Global]                          ← nivel global
▾ Categorías
  ▾ Web                           ← nivel section
      React                       ← nivel tech
      Next.js
  ▸ Juegos
▾ Proyectos
    Mi App                        ← nivel project
    Otro Proyecto  [2↑]           ← badge de pendingUpdates
Sin categoría                     ← nivel uncategorized (ti-folder-question)
```

Cada nodo es clickable y selecciona el `SelectedNode` activo. Los nodos de categoría y la sección "Proyectos" son colapsables con estado en `Set<string>` local.

`isActive(node)` compara el nodo dado con el seleccionado para aplicar `.active`.

**Nodo "Sin categoría":** se muestra siempre al final del árbol (con `marginTop: 8`). Representa los agentes descargados del directorio remoto que no siguen la nomenclatura estándar de carpetas (`global/`, `section-*/`, `tech-*-*/`). Usa el icono `ti-folder-question` y color `var(--text3)`. Al seleccionarlo se carga el nivel `uncategorized` desde el backend (`GET /api/agents?level=uncategorized`).

### `AgentsCenter.tsx`

Panel central. Muestra los agentes del nodo seleccionado y las sugerencias de IA.

```
.agents-center
├── .agents-center-head
│   ├── título (nombre del nodo)
│   ├── btn "Nuevo agente"
│   └── btn "Sugerencias" (refresh)
├── grid de AgentCards (agentes reales)
├── separador "— Sugeridos por IA —"
└── grid de AgentCards (sugeridos, con badge especial)
     o spinner si suggestionsLoading
```

Click en una `AgentCard` → abre el editor con ese agente. Click en una sugerida → abre el editor en modo "nuevo" con los campos precargados.

### `AgentEditor.tsx`

Panel derecho. Editor completo de un agente.

**Campos:**
- Nombre (input)
- Descripción (input)
- Modelo: selector haiku / sonnet / opus
- Herramientas: checkboxes con `ALL_TOOLS`

**Generación con IA:**
- Input de descripción informal + toggle idioma (ES/EN).
- Botón "Generar" → `POST /ai/generate-prompt` → rellena el textarea del system prompt.

**Optimización con IA:**
- Botón "Optimizar con IA" (solo si `!agent.optimized && agent.system`).
- `POST /ai/optimize-agent` → actualiza descripción y system prompt en el editor.
- Tras guardar, el fichero incluye `optimized: true` en el frontmatter y el botón desaparece.

**Guardado:**
- Agente global/section/tech: `POST /agents` (nuevo) o `PUT /agents` (editar).
- Agente de proyecto: `POST /projects/:id/agents` o `PUT /projects/:id/agents/:name`.

**Eliminación:** `DELETE /agents` o `DELETE /projects/:id/agents/:name`. Pide confirmación nativa.

---

## 12. Páginas

### `Projects.tsx`

Vista principal de proyectos.

**Topbar actions:** botones "Nuevo proyecto", "Importar", "Sync todos".

**Layout:**
```
.projects-view
└── para cada categoría con proyectos:
    .category-group
    ├── .category-head (icono + nombre + color)
    └── .proj-grid
        └── <ProjectCard> por proyecto
```

**Estado local:**
- `drawerProjectId: string | null` — proyecto abierto en el drawer.
- `showCreate / showImport: boolean` — visibilidad de los modales.
- `editProject: Project | null` — proyecto en el modal de edición.

Después de cualquier mutación (crear, editar, borrar, sync) llama a `fetchProjects()` del store para refrescar la lista.

### `Agents.tsx`

Vista de tres paneles.

**Estado local (todo en `useState` / `useRef`):**

```ts
const [node,               setNode]               = useState<SelectedNode>(DEFAULT_NODE);
const [expanded,           setExpanded]           = useState<Set<string>>(new Set(['global', 'cats', 'projs']));
const [agents,             setAgents]             = useState<Agent[]>([]);
const [suggestions,        setSuggestions]        = useState<Agent[]>([]);
const [suggestionsLoading, setSuggestionsLoading] = useState(false);
const [selectedAgent,      setSelectedAgent]      = useState<Agent | null>(null);
const [editorAgent,        setEditorAgent]        = useState<Agent | null>(null);
const [editorIsNew,        setEditorIsNew]        = useState(false);
// Directorio de agentes externos
const [syncStatus,         setSyncStatus]         = useState<AgentDirectoryStatus | null>(null);
const [showConflicts,      setShowConflicts]      = useState(false);
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

**Polling del estado de sync:** al montar la página, se inicia un `setInterval` de 600 ms que llama a `GET /api/agents-directory/status`. Cuando `syncing` pasa de `true` a `false`, se recargan los agentes del nodo activo. El intervalo se limpia en el `useEffect` de cleanup.

```ts
useEffect(() => {
  pollRef.current = setInterval(async () => {
    const st = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
    setSyncStatus(prev => {
      if (prev?.syncing && !st.syncing) loadAgents(node); // sync terminó → recargar
      return st;
    });
  }, 600);
  return () => { if (pollRef.current) clearInterval(pollRef.current); };
}, []);
```

**Overlay de primer arranque:** cuando `syncStatus.firstSync && syncStatus.syncing` es `true`, se renderiza un overlay de pantalla completa que bloquea la interacción. Muestra una barra de progreso determinada (`done / total`) y el nombre del archivo en proceso (`current`).

```tsx
{syncStatus?.firstSync && syncStatus.syncing && (
  <div className="sync-overlay">
    <i className="ti ti-cloud-download" />
    <p>Descargando directorio de agentes…</p>
    <div className="sync-progress-bar">
      <div style={{ width: `${(syncStatus.progress.done / syncStatus.progress.total) * 100}%` }} />
    </div>
    <span>{syncStatus.progress.done} / {syncStatus.progress.total} — {syncStatus.progress.current}</span>
  </div>
)}
```

**Modal de conflictos:** cuando `syncStatus.pendingConflicts.length > 0`, aparece un botón en el topbar `"N conflictos"` (badge coral). Al hacer click abre `showConflicts = true`. El modal lista cada conflicto con dos botones:
- **Usar remoto** → `POST /api/agents-directory/resolve-conflict { fileKey, action: 'remote' }`
- **Mantener local** → `POST /api/agents-directory/resolve-conflict { fileKey, action: 'local' }`

Tras resolver todos, el modal se cierra y se recargan los agentes.

```ts
async function resolveConflict(fileKey: string, action: 'remote' | 'local') {
  await req('POST', '/agents-directory/resolve-conflict', { fileKey, action });
  const updated = await req<AgentDirectoryStatus>('GET', '/agents-directory/status');
  setSyncStatus(updated);
  if (updated.pendingConflicts.length === 0) {
    setShowConflicts(false);
    loadAgents(node);
  }
}
```

**`loadAgents`:** acepta `level === 'uncategorized'` → llama `GET /api/agents?level=uncategorized`. Las sugerencias de IA se omiten cuando el nivel es `uncategorized` (no hay contexto de categoría/tecnología para generarlas).

**AbortController por nodo:** cada vez que cambia el nodo seleccionado, se aborta la petición de sugerencias en curso y se lanza una nueva. Evita condiciones de carrera si el usuario navega rápido.

```ts
const abortRef = useRef<AbortController | null>(null);

function selectNode(n: SelectedNode) {
  abortRef.current?.abort();
  abortRef.current = new AbortController();
  setNode(n);
  loadAgents(n);
  if (n.level !== 'uncategorized') loadSuggestions(n, abortRef.current.signal);
}
```

**Flujo de edición:**
1. Click en `AgentCard` → `setEditorAgent(agent)`, `setEditorIsNew(false)`.
2. Click en "Nuevo agente" → `setEditorAgent(NEW_AGENT)`, `setEditorIsNew(true)`.
3. `AgentEditor` llama `onSave()` → recarga agentes del nodo actual.
4. `AgentEditor` llama `onClose()` → `setEditorAgent(null)`.

### `Chat.tsx`

Interfaz de chat multi-turno con contexto de agentes.

**Estado local:**

```ts
const [messages,      setMessages]      = useState<Message[]>([]);
const [input,         setInput]         = useState('');
const [loading,       setLoading]       = useState(false);
const [activeAgents,  setActiveAgents]  = useState<Agent[]>([]);
const [mention,       setMention]       = useState('');   // texto de @búsqueda
const [mentionList,   setMentionList]   = useState<Agent[]>([]);
const [mentionIdx,    setMentionIdx]    = useState(0);
const [projectId,     setProjectId]     = useState<string | null>(null);
const [allAgents,     setAllAgents]     = useState<Agent[]>([]);
```

**Topbar actions:** selector de proyecto (dropdown) que carga/guarda el historial al cambiar.

**Sistema de @mention:**

```
Usuario escribe "@re" en el textarea
  ↓
onChange detecta "@" seguido de texto
setMention('re') → filtra allAgents donde name.includes('re')
  ↓
Dropdown con resultados (teclado: ↑↓ para navegar, Enter para seleccionar, Escape para cerrar)
  ↓
Agente seleccionado → añadido a activeAgents[], @mención sustituida en el input
```

Los agentes activos aparecen como chips en la barra de contexto. Click en un chip → lo quita de `activeAgents`.

**`buildSystem(agents)`** — construye el system prompt concatenando los prompts de todos los agentes activos más la instrucción de sugerir acciones:

```ts
function buildSystem(agents: Agent[]): string {
  const parts = agents.map(a => `## Agente: ${a.name}\n${a.system}`);
  parts.push(`Al final de cada respuesta, si corresponde, incluye acciones sugeridas...`);
  return parts.join('\n\n---\n\n');
}
```

**Historial por proyecto:**
- Al cambiar de proyecto: guarda el historial actual (`PUT /chat/history`) y carga el del nuevo (`GET /chat/history?projectId=`).
- El historial global (sin proyecto) se guarda en `chat-global.json`.

**Renderizado de mensajes:**
- `renderMarkdown(text)` — escapa HTML, convierte `**bold**`, `*italic*`, `` `code` ``, bloques de código, listas y saltos de línea a HTML seguro. Se inserta con `dangerouslySetInnerHTML`.
- `parseActions(content)` — extrae comentarios HTML del tipo `<!--ACTIONS:[{...}]-->` que la IA puede incluir al final de su respuesta. Devuelve array de `{ label, action }`.

**Action buttons:**

| `action` | Efecto |
|---|---|
| `create-agent` | Navega a la vista de agentes con el editor abierto |
| `open-agents` | `setView('agents')` |
| `open-settings` | `setView('settings')` |

**Quick prompts** (botones predefinidos en la barra de input):
- Optimizar agente, Crear CLAUDE.md, Revisar prompt, Nuevo agente, Limpiar historial.

**Flujo de envío:**

```ts
async function handleSend() {
  const withUser = [...messages, { role: 'user', content: input }];
  setMessages(withUser);
  setInput('');
  setLoading(true);
  try {
    const data = await req<{ reply: string }>('POST', '/chat', {
      messages: withUser,
      systemPrompt: buildSystem(activeAgents),
    });
    const updated = [...withUser, { role: 'assistant', content: data.reply }];
    setMessages(updated);
    saveHistory(updated, projectId);
  } catch (err: any) {
    setMessages([...withUser, { role: 'assistant', content: `⚠️ Error: ${err.message}` }]);
  } finally {
    setLoading(false);
  }
}
```

### `Settings.tsx`

Tres tabs: **General**, **Categorías**, **Directorio de Agentes**.

> El tab se llamaba "Agentes externos" hasta la v1.5. Renombrado a "Directorio de Agentes" a partir de v1.6 para reflejar la integración con el repositorio remoto configurable.

**Estado local:**

```ts
const [tab,        setTab]        = useState<Tab>('general');
const [aiStatus,   setAiStatus]   = useState<{ provider: string; ready: boolean } | null>(null);
const [updateMsg,  setUpdateMsg]  = useState('');
const [ghToken,    setGhToken]    = useState('');
const [ghModel,    setGhModel]    = useState('gpt-4o-mini');
const [apiKey,     setApiKey]     = useState('');
// Directorio de agentes
const [dirUrl,     setDirUrl]     = useState('');
const [dirEnabled, setDirEnabled] = useState(true);
const [dirStatus,  setDirStatus]  = useState<AgentDirectoryStatus | null>(null);
const [dirSyncing, setDirSyncing] = useState(false);
// + estados de modales: addCat, addTech, importReview
```

**Tab General:**

```
Row 1 (grid 1fr 1fr):
├── Proveedor de IA (CLI / GitHub / Anthropic API)
│   ├── ProviderOption × 3
│   ├── inputs de credenciales (según provider activo)
│   └── estado: "Listo" / "No configurado" + botones
└── Cómo usar en VS Code
    ├── instrucciones CLI
    └── instrucciones GitHub / API

Row 2 (full-width):
└── Comportamiento al cerrar (radio: Preguntar / Tray / Salir)

Row 3 (full-width):
└── Actualizaciones (comprobar / descargar / instalar)
```

**Toggle de tema** — en el `Topbar` de esta página a través de la prop `actions`:

```tsx
<Topbar
  title="Ajustes"
  actions={
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <i className={`ti ${theme === 'dark' ? 'ti-sun' : 'ti-moon'}`} />
      {theme === 'dark' ? 'Claro' : 'Oscuro'}
    </button>
  }
/>
```

**Tab Categorías:** lista todas las categorías con sus tecnologías. Modales para añadir/borrar categorías y tecnologías. `POST/DELETE /categories`, `POST/DELETE /categories/:id/technologies`.

**Tab Directorio de Agentes:**

Al abrir este tab se llama `GET /api/agents-directory/status` para obtener el estado actual y poblar `dirUrl` y `dirEnabled` desde la configuración.

```
Sección "Repositorio":
├── Toggle "Habilitar sincronización" → PUT /api/config { agentsDirectoryEnabled }
└── Input URL del repositorio + botón "Guardar"
    → PUT /api/config { agentsDirectoryUrl }
    → Valida que sea URL de GitHub válida antes de guardar

Sección "Estado":
├── Última sincronización (ISO → formato legible)
├── Commit SHA del repo (últimas 7 chars)
├── Número de agentes descargados (si > 0)
└── Botón "Sincronizar ahora" → POST /api/agents-directory/sync
    (deshabilitado si dirSyncing o !dirEnabled)

Sección "Conflictos" (solo si pendingConflicts.length > 0):
└── Lista de conflictos, por cada uno:
    ├── Nombre del agente + ruta remota
    ├── btn "Usar remoto" → POST /api/agents-directory/resolve-conflict { action: 'remote' }
    └── btn "Mantener local" → POST /api/agents-directory/resolve-conflict { action: 'local' }

Separador "— Importar agente externo —"

Sección "Importar desde URL":
├── Input URL de un agente .md individual
├── Botón "Importar" → POST /api/agents/import-url
└── Modal de revisión con campos editables + selector de destino
    → POST /api/agents con el agente revisado
```

`saveDirConfig()` guarda la URL y el estado habilitado. `triggerSync()` lanza el sync y espera polling del estado cada 600 ms hasta que `syncing` vuelva a `false`, actualizando `dirStatus`.

**`ProviderOption`** — sub-componente inline:

```tsx
function ProviderOption({ value, label, description, active, onClick }) {
  // Card clicable con borde accent si active
}
```

**Validación de modales:** todos los handlers `onConfirm` lanzan `throw new Error('validation')` si faltan datos requeridos, manteniendo el modal abierto y mostrando un toast de error.

---

## 13. Patrones recurrentes

### Actualización optimista vs. refetch

El frontend no actualiza el estado local antes de que el servidor confirme la operación. Siempre espera la respuesta y luego llama a `fetchProjects()` o recarga la lista afectada. Esto evita inconsistencias si el servidor rechaza la operación.

### Patrón de modal controlado

```tsx
// En el padre
const [showModal, setShowModal] = useState(false);

<Modal
  title="Crear categoría"
  onClose={() => setShowModal(false)}
  onConfirm={async () => {
    if (!name.trim()) { toast('Nombre requerido', 'err'); throw new Error(); }
    await req('POST', '/categories', { name });
    await refreshConfig();
    // Modal se cierra automáticamente al resolver sin error
  }}
>
  <input value={name} onChange={e => setName(e.target.value)} />
</Modal>
```

### Acceso a `window.api`

El renderer no puede asumir que `window.api` existe (puede ejecutarse en un browser sin Electron durante desarrollo o tests). Siempre se accede con optional chaining:

```ts
const api = (window as any).api;
api?.openVSCode?.(path);
api?.pickFolder?.().then(setPath);
```

### `dangerouslySetInnerHTML` para Markdown

Solo se usa en mensajes de chat. `renderMarkdown()` primero escapa el HTML (`&`, `<`, `>`, `"`) y luego aplica transformaciones seguras. El resultado es HTML sanitizado, no contenido de terceros arbitrario.

```tsx
<div
  className="message-body"
  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
/>
```

### Cancelación de peticiones con AbortController

En la vista de Agentes, las sugerencias se cargan de forma asíncrona y pueden tardar varios segundos. Si el usuario cambia de nodo antes de que llegue la respuesta, el controller anterior se aborta:

```ts
const abortRef = useRef<AbortController | null>(null);

function selectNode(n: SelectedNode) {
  abortRef.current?.abort();
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  // pasar ctrl.signal a fetch si la API lo soporta
  loadSuggestions(n).catch(e => {
    if (e.name === 'AbortError') return; // ignorar
  });
}
```

### Iconografía

**Solo Tabler Icons** (`ti ti-*`) vía CDN. Nunca SVGs inline ni otras librerías. Los iconos se insertan como `<i className="ti ti-nombre" />`. No usar emojis en la UI.
