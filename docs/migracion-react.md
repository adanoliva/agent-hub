# Guía de migración: Vanilla JS → React

**Agent Hub v1.4.0 — Electron + Express + Vanilla JS a Electron + React**

---

## 1. Resumen ejecutivo

Agent Hub funciona hoy con un renderer de Vanilla JS donde cada vista se construye concatenando strings HTML en `innerHTML`. Este enfoque tiene un techo claro: cualquier actualización parcial de la UI requiere rerenderizar la vista entera, los event listeners en HTML (`onclick="fn()"`) están acoplados al scope global, y el objeto `S` mutable sin reactividad hace imposible actualizar un componente sin invocar manualmente la función de render correcta.

**Qué aporta React en este contexto concreto:**

- **Actualizaciones quirúrgicas.** Hoy `renderDrawer()` regenera 300+ líneas de HTML para cambiar una badge de estado. Con React solo se actualiza el nodo del DOM que cambió.
- **Encapsulación de comportamiento.** La lógica de `projectCard()`, su estado local (hover, loading) y sus handlers viven juntos en un componente. No hay funciones globales `openVSCode`, `confirmDeleteProject`, etc.
- **Estado reactivo.** Zustand notifica a los componentes que dependen de un slice concreto del estado. `renderProjectsView()` no existe: los componentes se suscriben a los datos que necesitan.
- **DX.** TypeScript opcional, hot module replacement durante el desarrollo, errores con stack traces claros.

**Lo que NO cambia:** todo `src/main/` (main.js, server.js, agents.js, projects.js, ai.js, config.js), la API REST en puerto 3737, `preload.js`, `window.api`, `config.json` y el sistema de temas CSS.

---

## 2. Decisiones de arquitectura

### 2.1 Estructura de carpetas propuesta

```
src/
├── main/                        # Sin cambios
│   ├── main.js
│   ├── server.js
│   ├── agents.js
│   ├── projects.js
│   ├── ai.js
│   ├── config.js
│   ├── preload.js
│   └── ...
└── renderer/                    # Reescrito con React
    ├── index.html               # Punto de entrada Vite (mínimo)
    ├── main.tsx                 # ReactDOM.createRoot
    ├── App.tsx                  # Shell + HashRouter + layout
    ├── styles.css               # Sin cambios (variables CSS de tema)
    ├── api.ts                   # req() tipado, igual que hoy
    ├── store/
    │   └── index.ts             # Store Zustand (equivalente a S)
    ├── hooks/
    │   ├── useApi.ts            # Wrapper async sobre req()
    │   └── useElectron.ts       # Wrapper sobre window.api
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx
    │   │   ├── Topbar.tsx
    │   │   └── Statusbar.tsx
    │   ├── ui/
    │   │   ├── Toast.tsx        # Sistema de toasts
    │   │   ├── Modal.tsx        # Modal genérico
    │   │   ├── Drawer.tsx       # Drawer lateral
    │   │   └── Badge.tsx
    │   ├── projects/
    │   │   ├── ProjectsView.tsx
    │   │   ├── ProjectCard.tsx
    │   │   ├── ProjectDrawer.tsx
    │   │   └── CreateProjectModal.tsx
    │   ├── agents/
    │   │   ├── AgentsView.tsx
    │   │   ├── AgentTree.tsx
    │   │   └── AgentEditor.tsx
    │   ├── chat/
    │   │   └── ChatView.tsx
    │   ├── settings/
    │   │   └── SettingsView.tsx
    │   └── wizard/
    │       └── Wizard.tsx
    └── pages/                   # Rutas de React Router
        ├── Projects.tsx
        ├── Agents.tsx
        ├── Chat.tsx
        └── Settings.tsx
```

### 2.2 Bundler: Vite + vite-plugin-electron-renderer

**Por qué Vite y no webpack:**

| Criterio | Vite | webpack |
|---|---|---|
| Arranque en dev | Instantáneo (ESM nativo) | 5-15 s según tamaño del proyecto |
| HMR | Sub-segundo | 1-3 s |
| Config para Electron | `vite-plugin-electron-renderer` estable | Requiere ajustes manuales de `target` y externals |
| Config base | ~30 líneas | ~150 líneas |
| Soporte TypeScript | Nativo sin plugin extra | Requiere `ts-loader` o `babel-loader` |

El plugin `vite-plugin-electron-renderer` resuelve automáticamente los módulos de Node que el main process expone, evitando errores de `require is not defined` en el renderer.

### 2.3 Gestión de estado: Zustand

El objeto `S` actual es un plain object mutable. Cualquier componente puede leerlo y modificarlo sin que nadie más sea notificado. Eso funciona cuando el render es manual y total, pero rompe el modelo de React.

**Comparativa:**

| Criterio | Objeto `S` actual | Context API | Redux Toolkit | Zustand |
|---|---|---|---|---|
| Boilerplate | Ninguno | Poco | Alto | Mínimo |
| Reactividad | No (manual) | Sí, pero rerenderiza todo el árbol | Sí, con selectores | Sí, con selectores por slice |
| DevTools | No | No | Sí | Sí (redux devtools) |
| Curva de aprendida | Ninguna | Baja | Alta | Baja |
| Idóneo para | Scripts globales | Estado UI simple | Apps grandes con equipos | Apps medianas, migración incremental |

Zustand gana porque: la API es casi idéntica al objeto `S` (get/set directo), permite selectores granulares que evitan renders innecesarios, y no requiere envolver la app en providers.

### 2.4 Routing: React Router v6 con HashRouter

En Electron el renderer carga desde `http://localhost:3737` (Express local). Si se usa `BrowserRouter`, al refrescar la ventana Express no sabe qué servir para `/agents` y devuelve 404. `HashRouter` pone la ruta en el fragmento URL (`/#/agents`), que el servidor ignora completamente.

```tsx
// App.tsx
import { HashRouter, Routes, Route } from 'react-router-dom';

<HashRouter>
  <Routes>
    <Route path="/"         element={<Projects />} />
    <Route path="/agents"   element={<Agents />} />
    <Route path="/chat"     element={<Chat />} />
    <Route path="/settings" element={<Settings />} />
  </Routes>
</HashRouter>
```

### 2.5 Estilos: styles.css global + CSS Modules por componente

El `styles.css` actual define las variables CSS de tema (`:root` y `body.light`) y clases globales de layout. Ese archivo no se toca. Cada componente nuevo añade un archivo `.module.css` junto a él para sus estilos específicos, evitando colisiones de nombres sin romper el sistema de temas existente.

```
ProjectCard.tsx
ProjectCard.module.css   ← .card, .name, .meta (scoped)
styles.css               ← --accent, --bg1, .badge (global, sin cambios)
```

---

## 3. Plan de migración por fases

> Cada fase termina con la app funcionando. No hay un momento en que la app esté rota.

### Fase 0: Setup tooling

**Objetivo:** Vite sirve el renderer React mientras Electron sigue funcionando.

**Tareas:**

1. Instalar dependencias de desarrollo:
   ```bash
   npm install --save-dev vite @vitejs/plugin-react vite-plugin-electron-renderer
   npm install react react-dom react-router-dom zustand
   npm install --save-dev @types/react @types/react-dom typescript
   ```

2. Crear `vite.config.ts` (ver sección 6).

3. Crear `tsconfig.json` en `src/renderer/`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "jsx": "react-jsx",
       "strict": true,
       "skipLibCheck": true
     },
     "include": ["src/renderer/**/*"]
   }
   ```

4. Actualizar `package.json` — script de dev:
   ```json
   "dev": "concurrently \"vite\" \"cross-env NODE_ENV=development electron .\""
   ```

5. Actualizar `main.js` para cargar Vite en dev o Express en producción:
   ```js
   const RENDERER_URL = process.env.NODE_ENV === 'development'
     ? 'http://localhost:5173'
     : 'http://localhost:3737';
   win.loadURL(RENDERER_URL);
   ```

**Criterio de éxito:** `npm run dev` arranca Electron cargando una página React mínima (`<h1>Agent Hub</h1>`). Express sigue corriendo en 3737 y responde a `GET /api/health`.

---

### Fase 1: Shell y routing

**Objetivo:** Reemplazar `index.html` + `view-manager.js` por `App.tsx` con las 4 rutas y el layout (sidebar, topbar, statusbar).

**Tareas:**

1. Crear `src/renderer/index.html` mínimo (punto de entrada Vite):
   ```html
   <!DOCTYPE html>
   <html lang="es">
   <head>
     <meta charset="UTF-8" />
     <meta name="viewport" content="width=device-width, initial-scale=1.0" />
     <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@400;500;600;700&display=swap" rel="stylesheet">
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.6.0/dist/tabler-icons.min.css">
     <link rel="stylesheet" href="/styles.css">
     <title>Agent Hub</title>
   </head>
   <body>
     <div id="root"></div>
     <script type="module" src="/main.tsx"></script>
   </body>
   </html>
   ```

2. Crear `main.tsx`:
   ```tsx
   import React from 'react';
   import ReactDOM from 'react-dom/client';
   import App from './App';
   import './styles.css';

   ReactDOM.createRoot(document.getElementById('root')!).render(
     <React.StrictMode>
       <App />
     </React.StrictMode>
   );
   ```

3. Crear `App.tsx` con `HashRouter`, layout y rutas.

4. Migrar `Sidebar.tsx`, `Topbar.tsx`, `Statusbar.tsx` desde el HTML existente. Los estilos `.sidebar`, `.topbar`, `.statusbar` ya están en `styles.css`, así que los componentes solo añaden la estructura JSX.

5. Crear las 4 páginas vacías (`Projects.tsx`, `Agents.tsx`, `Chat.tsx`, `Settings.tsx`) que devuelven `<div>Próximamente</div>`.

**Criterio de éxito:** La app muestra el sidebar y la topbar. Navegar entre las 4 secciones cambia la ruta (visible en `#/agents`, etc.) sin recargar la página.

---

### Fase 2: Store Zustand

**Objetivo:** Reemplazar el objeto `S` por un store reactivo equivalente.

**Tareas:**

1. Crear `src/renderer/store/index.ts` (ver ejemplo completo en sección 5.2).

2. Migrar `api.ts` como función utilitaria tipada (no hook, igual que hoy).

3. Crear `useElectron.ts` y `useApi.ts` (ver sección 5.4).

4. Cargar config y proyectos en el arranque desde `App.tsx`:
   ```tsx
   useEffect(() => {
     useStore.getState().loadConfig();
     useStore.getState().loadProjects();
   }, []);
   ```

**Criterio de éxito:** `useStore(s => s.projects)` devuelve los proyectos cargados desde Express. El store es accesible desde cualquier componente sin props drilling.

---

### Fase 3: Migrar vistas (orden recomendado)

Migrar de más simple a más compleja. Cada vista reemplaza el `<div>Próximamente</div>` de su página.

**Orden:**

| Orden | Vista | Justificación |
|---|---|---|
| 1 | `Settings` | Sin estado complejo, sin sub-componentes propios. Valida el patrón form + PUT /api/config. |
| 2 | `Projects` | Mayor impacto visual. Valida `ProjectCard`, modales y drawer. |
| 3 | `Agents` | Árbol anidado con estado de expansión local. El más complejo en estado local. |
| 4 | `Chat` | Depende de agentes ya migrados (`@mention`). Migrar al final evita dependencias circulares. |

**Para cada vista:**

1. Crear el componente página principal.
2. Extraer sub-componentes (cards, filas, formularios).
3. Conectar al store (`useStore`) para lectura y a `req()` para escritura.
4. Eliminar la función global equivalente de Vanilla JS.

**Criterio de éxito:** La vista muestra los mismos datos que la versión Vanilla y todas las acciones (crear, editar, borrar, sync) funcionan.

---

### Fase 4: Modales, toasts y drawer como componentes

**Objetivo:** Reemplazar `showModal()`, `toast()` y `renderDrawer()` imperativos por componentes declarativos.

**Tareas:**

1. **Toast:** Crear un `ToastContext` o una slice Zustand de `toasts[]`. El componente `<ToastContainer />` se renderiza en `App.tsx` y consume esa slice. Exportar un hook `useToast()` que devuelve `{ show(msg, type) }`.

2. **Modal:** Crear un componente `<Modal>` controlado por props (`isOpen`, `title`, `onConfirm`, `children`). El estado de apertura vive en el componente padre que lo invoca. Para el patrón imperativo actual (llamar `showModal()` desde cualquier sitio), usar una slice Zustand `modal: { isOpen, config }`.

3. **Drawer:** Crear `<ProjectDrawer projectId={string} onClose={() => void}>`. El drawer lee el proyecto desde el store por ID. `S.drawerProject` pasa a ser `drawerProjectId: string | null` en el store.

**Criterio de éxito:** No existe ninguna función global `showModal`, `toast`, `closeModal` o `renderDrawer`. Todos los modales se abren mediante estado declarativo.

---

### Fase 5: Cleanup y optimización

**Objetivo:** Eliminar código muerto y mejorar rendimiento percibido.

**Tareas:**

1. **Lazy loading de rutas:**
   ```tsx
   const Agents   = lazy(() => import('./pages/Agents'));
   const Chat     = lazy(() => import('./pages/Chat'));
   const Settings = lazy(() => import('./pages/Settings'));
   ```
   Solo `Projects` se carga en el arranque. El resto se descarga la primera vez que se navega a ellas.

2. **Memoización selectiva:**
   - `ProjectCard` con `React.memo`: evita rerenders cuando el array de proyectos cambia pero este proyecto concreto no.
   - `useCallback` en handlers de eventos que se pasan como props a listas largas.

3. **Eliminar archivos Vanilla JS:** borrar `src/renderer/js/`, `src/renderer/index.html` original.

4. **Content Security Policy:** actualizar el `meta` CSP en el nuevo `index.html` para incluir `http://localhost:5173` en dev.

5. **Auditoría de bundle:** `vite build --report` para verificar que el bundle del renderer no supere ~1 MB sin assets.

**Criterio de éxito:** `npm run build` produce el `.exe` portable. La app arranca en menos de 2 segundos. No hay referencias a funciones globales de Vanilla JS en el código.

---

## 4. Guía de equivalencias

### Tabla de patrones

| Patrón Vanilla JS | Equivalente React |
|---|---|
| `document.getElementById('view-projects').innerHTML = html` | Componente `<ProjectsView />` renderizado por el router |
| Template literal con `${esc(p.name)}` | JSX: `{p.name}` (React escapa por defecto) |
| `onclick="openProjectDrawer('${p.id}')"` | `onClick={() => openDrawer(p.id)}` como prop |
| `S.projects` (lectura directa) | `const projects = useStore(s => s.projects)` |
| `S.projects = await req(...)` (escritura directa) | `useStore.getState().setProjects(data)` o acción del store |
| `req('GET', '/projects')` | `await req('GET', '/projects')` — sin cambios, es una función pura |
| `window.api.pickFolder()` | `const { pickFolder } = useElectron(); await pickFolder()` |
| `renderMarkdown(text)` + `innerHTML` | `<div dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />` |
| `toast('Mensaje', 'err')` | `const { show } = useToast(); show('Mensaje', 'err')` |
| `showModal('Título', ..., onConfirm)` | `<Modal isOpen={open} onConfirm={handleConfirm}>...</Modal>` |
| `switchView('agents')` | `navigate('/agents')` (React Router) |
| `S.drawerProject = p; renderDrawer()` | `setDrawerProjectId(p.id)` en el store → `<ProjectDrawer>` reacciona |
| `applyTheme(theme)` | `useEffect(() => { document.body.classList.toggle('light', theme === 'light') }, [theme])` |
| `document.getElementById('btn').disabled = true` | `const [loading, setLoading] = useState(false)` → `<button disabled={loading}>` |
| Event listener manual en `useEffect` cleanup | `useEffect(() => { window.api.onUpdateAvailable(cb); }, [])` |

### Por qué `dangerouslySetInnerHTML` para Markdown

`renderMarkdown()` escapa primero el HTML con `esc()` y luego aplica transformaciones seguras (negritas, code, etc.). El resultado es HTML ya sanitizado. En React, `dangerouslySetInnerHTML` es la forma oficial de insertar HTML ya procesado. No es peligroso cuando la cadena de entrada viene de un campo que el propio usuario escribió y ya fue escapada. Si en el futuro se acepta HTML arbitrario de terceros, añadir `DOMPurify`.

---

## 5. Ejemplos de código concretos

### 5.1 Tarjeta de proyecto: antes y después

**Antes — Vanilla JS (`projects-view.js`):**

```js
function projectCard(p) {
  const pending  = p.pendingUpdates || 0;
  const exists   = p.pathExists !== false;
  const provIcon = PROVIDER_ICONS[p.aiProvider || 'claude'] || PROVIDER_ICONS.claude;
  return `<div class="proj-card" onclick="openProjectDrawer('${p.id}')">
    <div class="proj-card-head">
      <div class="proj-card-name">${esc(p.name)}</div>
      ${pending > 0 ? `<span class="proj-pending"><i class="ti ti-refresh"></i>${pending}</span>` : ''}
    </div>
    <div class="proj-card-meta">
      ${p.techId
        ? `<span class="badge blue"><i class="ti ti-code"></i>${esc(techName(p.categoryId, p.techId))}</span>`
        : `<span class="badge gray"><i class="ti ti-folder"></i>${esc(catName(p.categoryId))}</span>`}
      ${STATUS_BADGE[p.status] || STATUS_BADGE.active}
      <span class="badge gray">${provIcon}</span>
      ${!exists ? `<span class="badge coral"><i class="ti ti-map-pin-off"></i>ruta no encontrada</span>` : ''}
    </div>
    <div class="proj-card-actions" onclick="event.stopPropagation()">
      <button class="btn sm ghost" onclick="openVSCode('${p.id}')"><i class="ti ti-brand-vscode"></i></button>
      <button class="btn sm ghost" onclick="openFolder('${p.id}')"><i class="ti ti-folder-open"></i></button>
      ${pending > 0
        ? `<button class="btn sm" onclick="syncProject('${p.id}')" style="color:var(--amber)">
             <i class="ti ti-refresh"></i> Sync
           </button>`
        : ''}
    </div>
  </div>`;
}
// Uso: html += projs.map(p => projectCard(p)).join('')
// Luego: document.getElementById('view-projects').innerHTML = html
```

**Después — React (`ProjectCard.tsx`):**

```tsx
import React, { memo } from 'react';
import { useStore } from '../../store';
import { useElectron } from '../../hooks/useElectron';
import { req } from '../../api';
import { useToast } from '../../hooks/useToast';
import type { Project } from '../../types';

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  claude: <><i className="ti ti-robot" /> Claude</>,
  github: <><i className="ti ti-brand-github" /> Copilot</>,
  both:   <><i className="ti ti-git-merge" /> Ambos</>,
};

const STATUS_BADGE: Record<string, React.ReactNode> = {
  active:   <span className="badge green"><i className="ti ti-circle-check" />activo</span>,
  paused:   <span className="badge amber"><i className="ti ti-player-pause" />pausado</span>,
  archived: <span className="badge gray"><i className="ti ti-archive" />archivado</span>,
};

interface Props {
  project: Project;
  onOpen: (id: string) => void;
}

export const ProjectCard = memo(function ProjectCard({ project: p, onOpen }: Props) {
  const loadProjects = useStore(s => s.loadProjects);
  const { openVSCode, openPath } = useElectron();
  const { show: toast } = useToast();
  const categories = useStore(s => s.config?.categories ?? []);

  const pending = p.pendingUpdates ?? 0;
  const exists  = p.pathExists !== false;
  const cat     = categories.find(c => c.id === p.categoryId);
  const tech    = cat?.technologies.find(t => t.id === p.techId);

  async function handleSync(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const r = await req('POST', `/projects/${p.id}/sync`);
      toast(`Sync completado: ${r.updated} actualizado${r.updated !== 1 ? 's' : ''}, ${r.added} nuevo${r.added !== 1 ? 's' : ''}`);
      await loadProjects();
    } catch (err: any) {
      toast(err.message, 'err');
    }
  }

  return (
    <div className="proj-card" onClick={() => onOpen(p.id)}>
      <div className="proj-card-head">
        <div className="proj-card-name">{p.name}</div>
        {pending > 0 && (
          <span className="proj-pending">
            <i className="ti ti-refresh" />{pending}
          </span>
        )}
      </div>

      <div className="proj-card-meta">
        {tech
          ? <span className="badge blue"><i className="ti ti-code" />{tech.name}</span>
          : <span className="badge gray"><i className="ti ti-folder" />{cat?.name ?? '—'}</span>
        }
        {STATUS_BADGE[p.status] ?? STATUS_BADGE.active}
        <span className="badge gray">{PROVIDER_ICONS[p.aiProvider ?? 'claude']}</span>
        {!exists && (
          <span className="badge coral">
            <i className="ti ti-map-pin-off" />ruta no encontrada
          </span>
        )}
      </div>

      <div className="proj-card-actions" onClick={e => e.stopPropagation()}>
        <button className="btn sm ghost" onClick={() => openVSCode(p.path)} title="Abrir en VS Code">
          <i className="ti ti-brand-vscode" />
        </button>
        <button className="btn sm ghost" onClick={() => openPath(p.path)} title="Abrir carpeta">
          <i className="ti ti-folder-open" />
        </button>
        {pending > 0 && (
          <button className="btn sm" onClick={handleSync} style={{ color: 'var(--amber)' }}>
            <i className="ti ti-refresh" /> Sync
          </button>
        )}
      </div>
    </div>
  );
});
```

**Diferencias clave:**
- `esc()` desaparece: JSX escapa automáticamente todas las expresiones `{}`.
- Los handlers son funciones reales con tipos, no strings en atributos HTML.
- `memo()` evita que la tarjeta se rerenderice cuando otro proyecto cambia.
- El componente sabe qué datos necesita y los pide directamente al store.

---

### 5.2 Store Zustand equivalente al objeto S

```ts
// src/renderer/store/index.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { req } from '../api';
import type { Config, Project, Agent } from '../types';

interface AgentNode {
  level: 'global' | 'section' | 'tech' | 'project';
  categoryId: string | null;
  techId: string | null;
  projectId: string | null;
}

interface AppState {
  // — Equivalente a S —
  config:             Config | null;
  projects:           Project[];
  appVersion:         string | null;

  // agents view
  treeExpanded:       Set<string>;
  selectedNode:       AgentNode;
  agents:             Agent[];
  suggestions:        Agent[];
  suggestionsLoading: boolean;
  selectedAgent:      Agent | null;
  editorAgent:        Agent | null;
  editorIsNew:        boolean;
  editorDirty:        boolean;
  editorLang:         'en' | 'es';

  // drawer
  drawerProjectId:    string | null;   // antes: drawerProject (el objeto completo)
  drawerTab:          string;

  // settings
  settingsTab:        'general' | 'cats' | 'ext-agents';

  // wizard
  wizStep:            number;
  cliFound:           boolean;
  cliPath:            string | null;
  aiChoice:           'cli' | 'api' | 'github';

  // — Acciones —
  loadConfig:         () => Promise<void>;
  loadProjects:       () => Promise<void>;
  setConfig:          (config: Config) => void;
  setProjects:        (projects: Project[]) => void;
  setDrawerProjectId: (id: string | null) => void;
  setDrawerTab:       (tab: string) => void;
  setSettingsTab:     (tab: AppState['settingsTab']) => void;
  toggleTreeNode:     (key: string) => void;
  setSelectedNode:    (node: AgentNode) => void;
  setEditorAgent:     (agent: Agent | null, isNew?: boolean) => void;
  markEditorDirty:    (dirty: boolean) => void;
}

export const useStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Estado inicial — equivalente al objeto S
      config:             null,
      projects:           [],
      appVersion:         null,
      treeExpanded:       new Set(['global', 'cats', 'projs']),
      selectedNode:       { level: 'global', categoryId: null, techId: null, projectId: null },
      agents:             [],
      suggestions:        [],
      suggestionsLoading: false,
      selectedAgent:      null,
      editorAgent:        null,
      editorIsNew:        false,
      editorDirty:        false,
      editorLang:         'en',
      drawerProjectId:    null,
      drawerTab:          'claude',
      settingsTab:        'general',
      wizStep:            0,
      cliFound:           false,
      cliPath:            null,
      aiChoice:           'cli',

      // Acciones
      loadConfig: async () => {
        const config = await req('GET', '/config');
        set({ config });
      },
      loadProjects: async () => {
        const projects = await req('GET', '/projects');
        set({ projects });
      },
      setConfig:          (config)   => set({ config }),
      setProjects:        (projects) => set({ projects }),
      setDrawerProjectId: (id)       => set({ drawerProjectId: id }),
      setDrawerTab:       (tab)      => set({ drawerTab: tab }),
      setSettingsTab:     (tab)      => set({ settingsTab: tab }),
      toggleTreeNode: (key) => {
        const next = new Set(get().treeExpanded);
        next.has(key) ? next.delete(key) : next.add(key);
        set({ treeExpanded: next });
      },
      setSelectedNode:  (node)        => set({ selectedNode: node }),
      setEditorAgent:   (agent, isNew = false) => set({ editorAgent: agent, editorIsNew: isNew, editorDirty: false }),
      markEditorDirty:  (dirty)       => set({ editorDirty: dirty }),
    }),
    { name: 'AgentHub' }
  )
);
```

**Uso desde un componente:**
```tsx
// Leer un slice concreto — solo rerenderiza cuando `projects` cambia
const projects = useStore(s => s.projects);

// Leer una acción
const loadProjects = useStore(s => s.loadProjects);

// Acceso imperativo desde fuera de un componente (p.ej. en un callback async)
useStore.getState().loadProjects();
```

---

### 5.3 Toast: de función imperativa a componente + hook

**Antes — Vanilla JS (`toast.js`):**
```js
function toast(msg, type = 'ok') {
  const icons = { ok:'ti-circle-check', err:'ti-alert-circle', info:'ti-info-circle', warn:'ti-alert-triangle' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ti ${icons[type]||'ti-info-circle'}"></i><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' || type === 'warn' ? 5000 : 3500);
}
// Uso desde cualquier sitio: toast('Sync completado')
```

**Después — React:**

```ts
// src/renderer/store/toastSlice.ts  (o dentro del store principal)
interface ToastItem {
  id:      string;
  message: string;
  type:    'ok' | 'err' | 'info' | 'warn';
}

// Añadir al store Zustand:
toasts: ToastItem[];
addToast: (message: string, type?: ToastItem['type']) => void;
removeToast: (id: string) => void;

// Implementación:
addToast: (message, type = 'ok') => {
  const id = crypto.randomUUID();
  set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
  const delay = type === 'err' || type === 'warn' ? 5000 : 3500;
  setTimeout(() => get().removeToast(id), delay);
},
removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
```

```tsx
// src/renderer/hooks/useToast.ts
import { useStore } from '../store';

export function useToast() {
  const addToast = useStore(s => s.addToast);
  return { show: addToast };
}
```

```tsx
// src/renderer/components/ui/Toast.tsx
import { useStore } from '../../store';

const ICONS = {
  ok:   'ti-circle-check',
  err:  'ti-alert-circle',
  info: 'ti-info-circle',
  warn: 'ti-alert-triangle',
};

export function ToastContainer() {
  const toasts      = useStore(s => s.toasts);
  const removeToast = useStore(s => s.removeToast);

  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => removeToast(t.id)}>
          <i className={`ti ${ICONS[t.type]}`} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// App.tsx — un único ToastContainer en la raíz
<HashRouter>
  {/* ... rutas ... */}
  <ToastContainer />
</HashRouter>
```

**Uso en cualquier componente:**
```tsx
const { show: toast } = useToast();
// ...
toast('Sync completado');
toast(error.message, 'err');
```

---

### 5.4 Llamadas a window.api desde un componente

**Antes — Vanilla JS:**
```js
async function openVSCode(id) {
  const p = S.projects.find(x => x.id === id);
  if (!p) return;
  if (window.api) {
    const r = await window.api.openVSCode(p.path);
    if (!r.ok) toast(r.error, 'err');
  } else {
    toast('Función disponible en la app de escritorio', 'info');
  }
}
// Invocación desde HTML: onclick="openVSCode('${p.id}')"
```

**Después — hook `useElectron`:**

```ts
// src/renderer/hooks/useElectron.ts

// Declaración de tipos para window.api (extrae lo que expone preload.js)
declare global {
  interface Window {
    api?: {
      getVersion:        () => Promise<string>;
      getAppDir:         () => Promise<string>;
      isDev:             () => Promise<boolean>;
      minimize:          () => void;
      hide:              () => void;
      openPath:          (p: string) => void;
      openExternal:      (url: string) => void;
      openVSCode:        (p: string) => Promise<{ ok: boolean; error?: string }>;
      pickFolder:        () => Promise<string | null>;
      checkForUpdate:    () => void;
      downloadUpdate:    () => void;
      installUpdate:     () => void;
      onUpdateAvailable: (cb: (info: unknown) => void) => void;
      onUpdateProgress:  (cb: (pct: number) => void) => void;
      onUpdateReady:     (cb: () => void) => void;
      onUpdateError:     (cb: (msg: string) => void) => void;
    };
  }
}

export function useElectron() {
  const isElectron = typeof window !== 'undefined' && !!window.api;

  async function openVSCode(path: string): Promise<void> {
    if (!window.api) {
      console.warn('openVSCode: no disponible fuera de Electron');
      return;
    }
    const r = await window.api.openVSCode(path);
    if (!r.ok) throw new Error(r.error ?? 'Error al abrir VS Code');
  }

  async function pickFolder(): Promise<string | null> {
    if (!window.api) return null;
    return window.api.pickFolder();
  }

  function openPath(path: string): void {
    window.api?.openPath(path);
  }

  return { isElectron, openVSCode, pickFolder, openPath };
}
```

**Uso en componente:**
```tsx
export function ProjectCard({ project }: { project: Project }) {
  const { openVSCode, openPath } = useElectron();
  const { show: toast } = useToast();

  async function handleVSCode() {
    try {
      await openVSCode(project.path);
    } catch (err: any) {
      toast(err.message, 'err');
    }
  }

  return (
    <div className="proj-card">
      {/* ... */}
      <button className="btn sm ghost" onClick={handleVSCode}>
        <i className="ti ti-brand-vscode" />
      </button>
    </div>
  );
}
```

---

## 6. Configuración de Vite + Electron

```ts
// vite.config.ts  (en la raíz del proyecto)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rendererPlugin } from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    rendererPlugin(),   // resuelve módulos Node en el renderer correctamente
  ],

  root: path.resolve(__dirname, 'src/renderer'),

  server: {
    port: 5173,
    // Proxy para no tener problemas de CORS en dev con Express en 3737
    proxy: {
      '/api': {
        target: 'http://localhost:3737',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },

  // Necesario para que Electron cargue los assets con rutas relativas
  base: command === 'build' ? './' : '/',
}));
```

**Actualizar Express para servir el build en producción (`server.js`):**

```js
// Al inicio de startServer(), antes de las rutas API:
if (process.env.NODE_ENV !== 'development') {
  const rendererDist = path.join(__dirname, '../../dist/renderer');
  app.use(express.static(rendererDist));
  // Para HashRouter no hace falta catch-all: el fragmento # nunca llega al servidor
}
```

**Actualizar `electron-builder.yml` para incluir el build de Vite:**

```yaml
# electron-builder.yml
files:
  - src/main/**/*
  - dist/renderer/**/*    # añadir esto
  - assets/**/*
  - package.json
extraResources: []
```

**Scripts `package.json` actualizados:**

```json
{
  "scripts": {
    "dev":     "concurrently \"vite\" \"cross-env NODE_ENV=development electron .\"",
    "build:renderer": "vite build",
    "build":   "npm run build:renderer && electron-builder --win portable",
    "release": "npm run build:renderer && electron-builder --win portable --publish always"
  }
}
```

> **Nota sobre el proxy en dev:** En desarrollo, `req('GET', '/api/health')` hace fetch a `http://localhost:5173/api/health`, que Vite reenvía a `http://localhost:3737/api/health`. En producción, el renderer se sirve desde Express directamente, así que la URL de la API es la misma origen. El helper `req()` puede simplificarse a usar rutas relativas en ambos casos:
>
> ```ts
> // api.ts — funciona en dev (proxy Vite) y producción (Express)
> const BASE = '/api';
> export async function req<T>(method: string, ep: string, body?: unknown): Promise<T> {
>   const r = await fetch(BASE + ep, {
>     method,
>     headers: { 'Content-Type': 'application/json' },
>     body: body ? JSON.stringify(body) : undefined,
>   });
>   const d = await r.json();
>   if (!r.ok) throw new Error(d.error ?? 'Error');
>   return d as T;
> }
> ```

---

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **window.api undefined en tests/Storybook** | Alta | Medio | `useElectron` ya guarda con `window.api?.`. Crear un mock global en el entorno de test. |
| **CSP bloquea el bundle de Vite en producción** | Media | Alto | El `meta` CSP actual permite `'unsafe-inline'`. Vite inyecta scripts de tipo `module` desde `./` (origin relativo), lo que el CSP `'self'` permite. Verificar en el build de producción antes de publicar. |
| **Rutas absolutas `http://localhost:3737`** | Alta | Bajo | El helper `req()` actual usa `const API = 'http://localhost:3737/api'`. Cambiar a ruta relativa `/api` desde el primer día de la migración para que el proxy de Vite funcione. |
| **`innerHTML` residual mezclado con React** | Baja | Alto | React pierde el control del DOM si algo externo modifica `innerHTML` del nodo raíz. Nunca usar `innerHTML` en componentes React; usar solo `dangerouslySetInnerHTML` para Markdown. |
| **`Set` en Zustand no es serializable** | Media | Bajo | `treeExpanded` es un `Set`. Zustand lo persiste correctamente en memoria, pero si se añade `persist` middleware habrá que serializarlo a `Array`. Documentar este punto si se añade persistencia. |
| **Regresiones en agentes view (árbol complejo)** | Media | Alto | El árbol de agentes tiene estado de expansión local complejo. Migrar esta vista en último lugar (después de Settings y Projects) y añadir pruebas manuales de cada interacción antes de eliminar el código Vanilla. |
| **electron-builder no encuentra dist/renderer** | Baja | Alto | El script `build` debe ejecutar `vite build` antes que `electron-builder`. El `prebuild` script actual ejecuta `generate-icon.js`; añadir `build:renderer` en el mismo hook o como paso previo explícito. |

---

## 8. Criterios de éxito por fase

### Fase 0 — Setup tooling
- [ ] `npm run dev` arranca sin errores: Vite en 5173, Express en 3737, Electron carga 5173.
- [ ] Hot Module Replacement funciona: cambiar `App.tsx` actualiza la ventana sin recargar Electron.
- [ ] `GET http://localhost:3737/api/health` devuelve 200 desde el renderer React.

### Fase 1 — Shell y routing
- [ ] Las 4 rutas (`/`, `/agents`, `/chat`, `/settings`) son navegables desde el sidebar.
- [ ] El sidebar marca correctamente la ruta activa.
- [ ] La topbar muestra el título correcto según la ruta.
- [ ] No hay funciones globales `switchView` ni referencias a `.view` en el código.

### Fase 2 — Store Zustand
- [ ] `useStore(s => s.projects)` devuelve los proyectos reales cargados desde Express.
- [ ] `useStore(s => s.config)` devuelve el `config.json` real.
- [ ] El tema (dark/light) se aplica correctamente al arranque leyendo `config.theme`.
- [ ] El objeto `S` global no existe en ningún archivo del renderer.

### Fase 3 — Vistas
- [ ] **Settings:** cambiar el tema desde la UI persiste en `config.json` y se aplica visualmente.
- [ ] **Projects:** crear, editar, borrar y sincronizar proyectos funciona sin errores. La tarjeta muestra badges correctos.
- [ ] **Agents:** el árbol de categorías/tecnologías/proyectos se expande y contrae. El editor guarda y descarta cambios.
- [ ] **Chat:** los `@mention` de agentes funcionan. El historial se carga por proyecto.
- [ ] Ninguna vista llama a `renderXxxView()` — el render es reactivo.

### Fase 4 — Modales, toasts y drawer
- [ ] Los toasts aparecen y desaparecen con los tiempos correctos (3.5 s / 5 s).
- [ ] El modal de confirmación de borrado espera la respuesta del servidor antes de cerrarse.
- [ ] El drawer del proyecto muestra el estado de sync en tiempo real.
- [ ] No existen las funciones globales `showModal`, `closeModal`, `toast`, `renderDrawer`.

### Fase 5 — Cleanup
- [ ] `npm run build` produce `dist/agent-hub.exe` sin errores.
- [ ] El `.exe` portable arranca y carga la vista de proyectos en menos de 2 segundos.
- [ ] `vite build --report` muestra un bundle del renderer inferior a 1 MB (sin assets de fuentes/iconos CDN).
- [ ] No existen archivos en `src/renderer/js/` (código Vanilla eliminado).
- [ ] TypeScript no reporta errores (`tsc --noEmit`).
