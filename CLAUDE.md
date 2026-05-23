# Agent Hub — Contexto del proyecto

> Versión actual: **1.6.1** · Actualizar este campo en cada release.

@docs/backend.md
@docs/frontend.md

## Qué es esto

**Agent Hub** (nombre de paquete: `agent-hub`) es una aplicación de escritorio **Electron + Express + React 19 + TypeScript** para gestionar agentes de IA y proyectos de desarrollo. Distribuida como portable `.exe` para Windows x64.

Permite:
- Organizar proyectos por categorías y tecnologías
- Crear/editar agentes Claude Code (`.md` con frontmatter YAML)
- Sincronizar agentes a los directorios `.claude/agents/` de cada proyecto
- Chatear con IA (Claude CLI, Anthropic API, o GitHub Copilot) con historial por proyecto
- Generar y optimizar prompts de agente automáticamente con IA
- Generar ficheros de contexto (CLAUDE.md / copilot-instructions.md) desde análisis del proyecto
- Sugerir agentes específicos para cada proyecto usando su documentación como contexto
- Sincronizar agentes desde un repositorio externo (directorio de agentes)

---

## Arquitectura

```
src/backend/                  — Electron main process + Express API
  ├── main.js                 — BrowserWindow, IPC handlers, auto-updater
  ├── server.js               — Express en localhost:3737 (API REST)
  ├── config.js               — Gestión de config.json (portable-aware, CDM_DATA_DIR)
  ├── agents.js               — CRUD de agentes (.md con frontmatter)
  ├── agents-sync.js          — Sync de agentes desde repositorio externo (GitHub)
  ├── projects.js             — CRUD de proyectos, sync de agentes
  ├── ai.js                   — Integración IA (CLI/API/GitHub)
  ├── tray.js                 — Icono de bandeja del sistema
  ├── preload.js              — Context bridge (window.api)
  ├── defaults.js             — Agentes por defecto al inicializar
  ├── templates.js            — Plantillas CLAUDE.md / copilot-instructions.md
  └── icon.js                 — Generación de icono de ventana

src/renderer/                 — React 19 + TypeScript + Vite + Zustand
  ├── main.tsx                — Entry point React
  ├── App.tsx                 — Router, estado global inicial, wizard, close dialog
  ├── index.html              — Shell de la app
  ├── styles.css              — Todos los estilos + variables CSS de tema
  ├── api.ts                  — Helper req(method, path, body?)
  ├── types.ts                — Tipos TypeScript compartidos
  ├── vite-env.d.ts
  ├── store/
  │   └── index.ts            — Zustand store global (view, config, projects, toasts, wizard)
  ├── hooks/
  │   ├── useCategoryHelpers.ts
  │   ├── useElectron.ts
  │   └── useToast.ts
  ├── constants/
  │   └── tools.ts            — Lista de herramientas disponibles para agentes
  ├── pages/
  │   ├── Projects.tsx        — Vista de proyectos
  │   ├── Agents.tsx          — Vista de agentes (árbol + editor + sync directorio)
  │   ├── Chat.tsx            — Vista de chat IA (@mention, acciones, historial)
  │   └── Settings.tsx        — Vista de ajustes (general / categorías / directorio agentes)
  └── components/
      ├── layout/
      │   ├── Sidebar.tsx     — Navegación lateral
      │   ├── Topbar.tsx      — Cabecera con selector de proyecto (usada en Chat)
      │   └── Statusbar.tsx   — Barra de estado inferior
      ├── agents/
      │   ├── AgentsTree.tsx  — Árbol de niveles global/sección/tech/proyecto
      │   ├── AgentsCenter.tsx — Panel central con lista + sugerencias
      │   ├── AgentCard.tsx   — Tarjeta de agente
      │   └── AgentEditor.tsx — Editor de agente (frontmatter + system prompt)
      ├── projects/
      │   ├── ProjectCard.tsx
      │   ├── ProjectDrawer.tsx — Drawer lateral con agentes y contexto del proyecto
      │   ├── CreateProjectModal.tsx
      │   ├── EditProjectModal.tsx
      │   ├── ImportProjectModal.tsx
      │   ├── ExcludeAgentModal.tsx
      │   └── StatusBadge.tsx
      └── ui/
          ├── Wizard.tsx      — Wizard de primer arranque (siempre visible, "no mostrar" en checkbox)
          ├── Modal.tsx       — Modal genérico
          ├── Toast.tsx       — Sistema de notificaciones toast
          └── CloseDialog.tsx — Diálogo de confirmación al cerrar
```

---

## Flujo de arranque

1. `main.js` → `readConfig()` → `bootstrapDirectories()` → `migrateAgentFiles()` → `syncGlobalAgentsToClaudeDir()` → `startServer()` → `createWindow()`
2. En producción, Express sirve el renderer desde `dist/renderer/` (Vite build)
3. En dev, Vite dev server corre en puerto 5173 y el BrowserWindow carga desde allí
4. `App.tsx` monta, carga `GET /config` y `GET /projects`, aplica tema, muestra wizard si corresponde

---

## Estado global (`src/renderer/store/index.ts`)

Zustand store. Acceso via `useStore(s => s.campo)`.

```ts
interface AppState {
  view: View;              // 'projects' | 'agents' | 'chat' | 'settings'
  config: Config | null;
  projects: Project[];
  appVersion: string | null;
  showWizard: boolean;     // true si localStorage 'cdm-wizard-done' no existe
  toasts: Toast[];

  setView, setConfig, setProjects, setAppVersion,
  fetchProjects,           // GET /projects y actualiza store
  setShowWizard,           // usado desde Settings para relanzar el wizard
  addToast,                // ok: 3.5s · err/warn: 5s
  removeToast,
}
```

El wizard siempre se muestra al arrancar a menos que `localStorage.getItem('cdm-wizard-done')` exista. El checkbox "No mostrar al inicio" del wizard escribe/borra esa clave.

---

## API REST (Express en puerto 3737)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |
| GET/PUT | `/api/config` | Leer/actualizar config |
| GET | `/api/detect-cli` | Detectar Claude CLI en PATH |
| POST | `/api/setup` | Setup del wizard (crea dirs + inicia sync) |
| GET/POST | `/api/categories` | Categorías |
| PUT/DELETE | `/api/categories/:id` | Editar/borrar categoría |
| POST/DELETE | `/api/categories/:catId/technologies` | Tecnologías |
| GET | `/api/agents-directory/status` | Estado del directorio de agentes externo |
| POST | `/api/agents-directory/sync` | Forzar sync con repositorio externo |
| POST | `/api/agents-directory/resolve-conflict` | Resolver conflicto (keep\|update) |
| GET | `/api/agents` | Agentes por nivel (`?level=global\|section\|tech&categoryId&techId`) |
| GET | `/api/agents/applicable` | Agentes aplicables a un proyecto |
| GET | `/api/agents/flat` | Todos los agentes aplanados (para @mention autocomplete) |
| POST/PUT/DELETE | `/api/agents` | CRUD de agentes |
| POST | `/api/agents/import-url` | Importar agente desde URL |
| GET/POST/PUT | `/api/projects/:id/agents` | Agentes de proyecto |
| DELETE | `/api/projects/:id/agents/:name` | Borrar agente de proyecto |
| GET/POST | `/api/projects` | Proyectos |
| POST | `/api/projects/import` | Importar proyecto existente |
| PUT/DELETE | `/api/projects/:id` | Editar/borrar proyecto |
| GET | `/api/projects/:id/sync-status` | Estado de sync de agentes del proyecto |
| POST | `/api/projects/:id/sync` | Sincronizar agentes al proyecto |
| POST | `/api/sync-all` | Sync de todos los proyectos |
| GET/PUT | `/api/projects/:id/context` | CLAUDE.md / copilot-instructions.md |
| POST | `/api/projects/:id/generate-context` | Generar contexto con IA (`?type=claude\|github`) |
| GET | `/api/ai/status` | Estado del proveedor de IA |
| POST | `/api/ai/generate-prompt` | Generar prompt de agente desde descripción |
| POST | `/api/ai/optimize-agent` | Optimizar system prompt existente con IA |
| GET | `/api/ai/suggestions` | Sugerencias de agentes por nivel |
| POST | `/api/ai/suggestions/refresh` | Forzar regeneración de sugerencias |
| DELETE | `/api/ai/suggestions/cache` | Limpiar caché de sugerencias |
| GET | `/api/ai/project-suggestions` | Sugerencias específicas para un proyecto |
| POST | `/api/ai/project-suggestions/refresh` | Forzar regeneración de sugerencias de proyecto |
| POST | `/api/chat` | Chat multi-turno |
| GET/PUT/DELETE | `/api/chat/history` | Historial de chat por proyecto (`?projectId=`) |

El helper del renderer es: `req<T>(method, path, body?)` en `src/renderer/api.ts` → hace fetch a `http://localhost:3737/api{path}`.

---

## config.json

Localización:
- **Dev**: raíz del proyecto (o `CDM_DATA_DIR` si está definida)
- **Portable/Producción**: junto al `.exe` (`PORTABLE_EXECUTABLE_DIR`)

Estructura completa:

```json
{
  "version": "1.6.1",
  "aiProvider": "cli",
  "apiKey": "",
  "githubToken": "",
  "githubModel": "gpt-4o-mini",
  "theme": "dark",
  "closeAction": "ask",
  "agentsDirectoryUrl": "https://github.com/adanoliva/agents-directory",
  "agentsDirectoryEnabled": true,
  "categories": [
    {
      "id": "games",
      "name": "Juegos",
      "icon": "ti-device-gamepad-2",
      "color": "#3ecf8e",
      "technologies": [{ "id": "unity", "name": "Unity" }]
    }
  ],
  "projects": [
    {
      "id": "p...",
      "name": "Mi Proyecto",
      "categoryId": "web",
      "techId": "react",
      "path": "C:/ruta/proyecto",
      "description": "",
      "status": "active",
      "aiProvider": "claude",
      "selectedAgents": [],
      "excludedAgents": [],
      "agentHashes": {},
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

Campos editables por `PUT /api/config`: `apiKey`, `aiProvider`, `githubToken`, `githubModel`, `theme`, `closeAction`, `agentsDirectoryUrl`, `agentsDirectoryEnabled`.

---

## Agentes — formato de archivo

Los agentes son archivos `.md` con frontmatter YAML:

```markdown
---
name: nombre-del-agente
description: Descripción breve
model: claude-sonnet-4-20250514
tools:
  - Bash
  - Read
  - Write
optimized: true        # opcional — presente solo si fue optimizado con IA
---

System prompt del agente aquí.
```

Modelos disponibles: `haiku` → `claude-haiku-4-5-20251001`, `sonnet` → `claude-sonnet-4-20250514`, `opus` → `claude-opus-4-20250514`.

El campo `optimized: true` lo escribe `serializeAgent()` cuando el agente ha pasado por `POST /api/ai/optimize-agent`. Si está presente, el editor no muestra el botón "Optimizar con IA".

### Niveles de agentes (jerarquía)

| Nivel | Directorio | Scope |
|-------|-----------|-------|
| `global` | `agents/global/` | Todos los proyectos |
| `section` | `agents/section-{catId}/` | Proyectos de esa categoría |
| `tech` | `agents/tech-{catId}-{techId}/` | Proyectos de esa tecnología |
| `project` | `{projectPath}/.claude/agents/` o `{projectPath}/.github/agents/` | Un proyecto concreto |

Los globales también se sincronizan a `~/.claude/agents/` para que Claude Code los cargue automáticamente.

---

## Directorio de agentes externo (`agents-sync.js`)

Permite sincronizar agentes desde un repositorio GitHub público. Configurado en Ajustes → Directorio de agentes.

- **URL configurable**: por defecto `https://github.com/adanoliva/agents-directory`
- **Primera sync**: ocurre al finalizar el wizard (paso 3), descarga todos los agentes
- **Syncs posteriores**: compara SHA del commit remoto con el local (`.sync-meta.json`)
- **Conflictos**: si un agente local fue modificado respecto al remoto, se crea un conflicto. El usuario elige: `keep` (conservar local) o `update` (usar remoto)
- **Estado**: `GET /api/agents-directory/status` devuelve `AgentDirectoryStatus`
- **Metadata**: guardada en `agents/global/.sync-meta.json`

---

## Chat IA (`src/renderer/pages/Chat.tsx`)

El chat soporta conversación multi-turno con el proveedor configurado. Estado local con `useState` (no en Zustand).

**Características:**
- **Historial por proyecto**: se guarda en `cache/chat-{projectId}.json` (o `chat-global.json`). Al cambiar de proyecto se guarda el actual y se carga el nuevo.
- **@mention de agentes**: escribe `@nombre` para añadir un agente como contexto activo. Dropdown autocomplete filtrado desde `GET /api/agents/flat`. Los agentes activos aparecen como chips y se incluyen en el system prompt de cada mensaje.
- **Acciones sugeridas**: la IA puede incluir `<!--ACTIONS:[{"label":"...","type":"..."}]-->`. El renderer los extrae y muestra como botones. Tipos soportados: `create-agent`, `open-agents`, `open-settings`.
- **Quick prompts**: botones de acceso rápido para casos frecuentes (optimizar agente, crear CLAUDE.md, etc.)
- **Selector de proyecto**: en el topbar, permite cambiar el proyecto activo sin salir de la vista.

**System prompt:** `buildSystem()` concatena los system prompts de todos los agentes activos + instrucción base de rol.

---

## Agentes — funciones IA adicionales

### Optimizar agente (`POST /api/ai/optimize-agent`)
Recibe `{name, description, system, tools, model}`. Construye un prompt que pide a la IA mejorar el system prompt y la descripción. Devuelve `{description, system}`. El editor muestra el botón solo si `!agent.optimized && agent.system`. Tras guardar, el fichero `.md` incluye `optimized: true`.

### Generar contexto del proyecto (`POST /api/projects/:id/generate-context?type=claude|github`)
Analiza el directorio del proyecto: detecta lenguajes (por extensión), lee `package.json` / `requirements.txt` / `pyproject.toml`, detecta testing, linting, build tool, CI/CD y Docker. Genera el contenido del fichero para revisión manual.

### Sugerencias por proyecto (`GET /api/ai/project-suggestions?projectId=`)
Lee el CLAUDE.md o copilot-instructions.md del proyecto como contexto principal. Cache en `cache/suggestions.json` con clave `project::{projectId}`.

### Exclusión de agentes con opciones
Al excluir un agente desde el drawer de proyecto, modal con dos opciones:
1. **Excluir y eliminar archivo** → `DELETE /api/projects/:id/agents/:name`
2. **Solo excluir** → añade a `project.excludedAgents[]`, el archivo permanece

Al volver a incluir se llama `POST /api/projects/:id/sync` para restaurar el archivo si fue borrado.

---

## Sistema de iconos y badges

Iconografía exclusivamente via **Tabler Icons** (`ti ti-*`) desde CDN v3.6.0.

### Badges (`.badge`)
Variantes: `green`, `amber`, `blue`, `accent`, `gray`, `coral`. Siempre incluir icono dentro del badge.

| Concepto | Color | Icono |
|----------|-------|-------|
| Activo / ok | green | `ti-circle-check` |
| Pausado / actualizar | amber | `ti-player-pause` / `ti-refresh` |
| Archivado / excluido | gray | `ti-archive` / `ti-eye-off` |
| Nuevo / sugerido | blue / accent | `ti-sparkles` |
| Error / ruta no encontrada | coral | `ti-alert-circle` / `ti-map-pin-off` |
| Local | gray | `ti-device-laptop` |

### Model pills (agentes)
Clase `tool-pill model-{haiku|sonnet|opus}` con icono: `ti-leaf` (haiku), `ti-bolt` (sonnet), `ti-brain` (opus).

### Toasts
Tipos: `ok` (`ti-circle-check`), `err` (`ti-alert-circle`, 5 s), `info` (`ti-info-circle`), `warn` (`ti-alert-triangle`, 5 s).

### Navegación
- Logo: `ti-robot` (identidad de la app)
- Nav Agentes: `ti-cpu`
- Nav Proyectos: `ti-layout-grid`
- Nav Chat: `ti-message-chatbot`
- Nav Ajustes: `ti-settings`

---

## Tema visual

Sistema de temas basado en variables CSS en `src/renderer/styles.css`:

- **Oscuro** (defecto): variables en `:root`
- **Claro**: variables en `body.light`

El tema se aplica en `App.tsx` al cargar config: `document.body.classList.add/remove('light')`.

Colores accent principal: `#7c6af7` (dark) / `#6c5ce7` (light).

---

## IPC — `window.api` (preload.js)

```ts
window.api.getVersion()       // string
window.api.getAppDir()        // string (path)
window.api.isDev()            // boolean
window.api.minimize()
window.api.hide()
window.api.openPath(p)
window.api.openExternal(url)
window.api.openVSCode(p)
window.api.pickFolder()       // string | null
window.api.checkForUpdate()
window.api.downloadUpdate()
window.api.installUpdate()
window.api.onUpdateAvailable(cb)
window.api.onUpdateProgress(cb)
window.api.onUpdateReady(cb)
window.api.onUpdateError(cb)
window.api.onCloseRequested(cb)   // dispara CloseDialog cuando el usuario cierra la ventana
window.api.closeResponse(action, remember)  // responde al cierre: 'tray'|'quit'
```

---

## Build y distribución

```bash
npm run dev          # Electron + Vite dev server (devTools abiertos)
npm run build        # Portable .exe en dist/
npm run release      # Build + publish a GitHub Releases
```

En dev, los datos (config.json, agents/, cache/) se guardan en la raíz del proyecto por defecto. Para usar otra carpeta define `CDM_DATA_DIR`:

```powershell
$env:CDM_DATA_DIR = "C:\MiCarpetaDatos"
npm run dev
```

- Salida: `dist/agent-hub.exe` (portable x64)
- Auto-updater: GitHub Releases (repo privado `adanoliva/cdm`)
- Icono: `assets/icon.ico` (generado por `scripts/generate-icon.js`)

---

## Convenciones de código

- **React 19 + TypeScript**: renderer completamente en React con Vite. Sin Vanilla JS.
- **Estado centralizado**: Zustand store en `src/renderer/store/index.ts`. Estado local con `useState` solo cuando es realmente local a un componente.
- **Estilos**: Una sola hoja `styles.css` con variables CSS; sin preprocesadores ni CSS Modules.
- **Sin comentarios redundantes**: Solo cuando el "por qué" no es obvio.
- **Español en UI**: Todos los textos de interfaz en español. Código y tipos en inglés.
- **Tabler Icons**: Iconografía via clase `ti ti-*` (CDN).
- **Fuentes**: JetBrains Mono (mono) + Syne (sans), ambas de Google Fonts.

---

## Checklist al actualizar versión

1. Actualizar `version` en `package.json`
2. Actualizar el campo `version` en `DEFAULT_CONFIG` de `src/backend/config.js`
3. Actualizar la línea `> Versión actual:` al inicio de este archivo
4. Commit y tag git → `npm run release`

El token de GitHub para publicar releases está en `.token` (raíz del proyecto, ignorado por git). Antes de ejecutar `npm run release`:

```powershell
$env:GH_TOKEN = (Get-Content .token)
npm run release
```
