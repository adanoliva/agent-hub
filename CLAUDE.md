# Agent Hub — Contexto del proyecto

> Versión actual: **1.4.0** · Actualizar este campo en cada release.

## Qué es esto

**Agent Hub** (nombre de paquete: `agent-hub`) es una aplicación de escritorio **Electron + Express + Vanilla JS** para gestionar agentes de IA y proyectos de desarrollo. Distribuida como portable `.exe` para Windows x64.

Permite:
- Organizar proyectos por categorías y tecnologías
- Crear/editar agentes Claude Code (`.md` con frontmatter YAML)
- Sincronizar agentes a los directorios `.claude/agents/` de cada proyecto
- Chatear con IA (Claude CLI, Anthropic API, o GitHub Copilot) con historial por proyecto
- Generar y optimizar prompts de agente automáticamente con IA
- Generar ficheros de contexto (CLAUDE.md / copilot-instructions.md) desde análisis del proyecto
- Sugerir agentes específicos para cada proyecto usando su documentación como contexto

---

## Arquitectura

```
Electron main process
  ├── main.js          — BrowserWindow, IPC handlers, auto-updater
  ├── server.js        — Express en localhost:3737 (API REST)
  ├── config.js        — Gestión de config.json (portable-aware)
  ├── agents.js        — CRUD de agentes (.md con frontmatter)
  ├── projects.js      — CRUD de proyectos, sync de agentes
  ├── ai.js            — Integración IA (CLI/API/GitHub)
  ├── tray.js          — Icono de bandeja del sistema
  ├── preload.js       — Context bridge (window.api)
  ├── defaults.js      — Agentes por defecto al inicializar
  └── templates.js     — Plantillas CLAUDE.md / copilot-instructions.md

Renderer (Vanilla JS, sin frameworks)
  src/renderer/
  ├── index.html       — Shell de la app
  ├── styles.css       — Todos los estilos + variables CSS de tema
  └── js/
      ├── state.js         — Estado global S (único objeto mutable)
      ├── api.js           — Helper req(method, path, body)
      ├── utils.js         — esc(), renderMarkdown(), applyTheme(), setTheme()
      ├── init.js          — Arranca la app, carga config, aplica tema
      ├── view-manager.js  — switchView()
      ├── projects-view.js — Vista de proyectos
      ├── agents-view.js   — Vista de agentes (árbol + editor)
      ├── settings-view.js — Vista de ajustes (tabs: general/cats/ext-agents)
      ├── chat-view.js     — Vista de chat IA (@mention, contexto de agentes, historial por proyecto, acciones)
      ├── wizard.js        — Wizard de primer arranque
      ├── update.js        — Banner de actualización
      ├── toast.js         — Sistema de notificaciones toast
      ├── modal.js         — Modales genéricos
      └── category-helpers.js — Helpers de categorías
```

---

## Flujo de arranque

1. `main.js` → `readConfig()` → `bootstrapDirectories()` → `migrateAgentFiles()` → `seedDefaultAgents()` → `syncGlobalAgentsToClaudeDir()` → `startServer()` → `createWindow()`
2. BrowserWindow carga `http://localhost:3737` (servido por Express)
3. `index.html` carga scripts en orden: `utils → state → api → toast → modal → category-helpers → view-manager → projects-view → agents-view → settings-view → chat-view → wizard → update → init`
4. `init()` llama `GET /api/health`, `GET /api/config`, `GET /api/projects`, aplica tema, renderiza vista de proyectos

---

## Estado global (`src/renderer/js/state.js`)

```js
const S = {
  view: 'projects',           // vista activa
  config: null,               // objeto de config.json (cargado en init)
  projects: [],               // lista de proyectos
  appVersion: null,
  // agents view
  treeExpanded: Set,          // nodos expandidos en árbol
  selectedNode: { level, categoryId, techId, projectId },
  agents: [], suggestions: [], suggestionsLoading: false,
  selectedAgent: null, editorAgent: null,
  editorIsNew: false, editorDirty: false, editorLang: 'en',
  // drawer
  drawerProject: null, drawerTab: 'claude',
  // settings
  settingsTab: 'general',     // 'general' | 'cats' | 'ext-agents'
  // wizard
  wizStep: 0, cliFound: false, cliPath: null, aiChoice: 'cli',
};
```

---

## API REST (Express en puerto 3737)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |
| GET/PUT | `/api/config` | Leer/actualizar config |
| GET | `/api/detect-cli` | Detectar Claude CLI en PATH |
| POST | `/api/setup` | Setup del wizard |
| GET/POST | `/api/categories` | Categorías |
| PUT/DELETE | `/api/categories/:id` | Editar/borrar categoría |
| POST/DELETE | `/api/categories/:catId/technologies` | Tecnologías |
| GET | `/api/agents` | Agentes por nivel (`?level=global\|section\|tech&categoryId&techId`) |
| GET | `/api/agents/applicable` | Agentes aplicables a un proyecto |
| POST/PUT/DELETE | `/api/agents` | CRUD de agentes |
| POST | `/api/agents/import-url` | Importar agente desde URL |
| GET/POST/PUT/DELETE | `/api/projects/:id/agents` | Agentes de proyecto |
| GET/POST | `/api/projects` | Proyectos |
| POST | `/api/projects/import` | Importar proyecto existente |
| PUT/DELETE | `/api/projects/:id` | Editar/borrar proyecto |
| GET/POST | `/api/projects/:id/sync-status` | Estado de sync |
| POST | `/api/projects/:id/sync` | Sincronizar agentes al proyecto |
| POST | `/api/sync-all` | Sync de todos los proyectos |
| GET/PUT | `/api/projects/:id/context` | CLAUDE.md / copilot-instructions.md |
| GET | `/api/ai/status` | Estado del proveedor de IA |
| POST | `/api/ai/generate-prompt` | Generar prompt de agente desde descripción |
| POST | `/api/ai/optimize-agent` | Optimizar system prompt existente con IA |
| GET | `/api/ai/suggestions?level=&categoryId=&techId=` | Sugerencias de agentes por nivel |
| POST | `/api/ai/suggestions/refresh` | Forzar regeneración de sugerencias |
| DELETE | `/api/ai/suggestions/cache` | Limpiar caché de sugerencias |
| GET | `/api/ai/project-suggestions?projectId=` | Sugerencias específicas para un proyecto |
| POST | `/api/ai/project-suggestions/refresh` | Forzar regeneración de sugerencias de proyecto |
| POST | `/api/projects/:id/generate-context` | Generar CLAUDE.md / copilot-instructions con IA |
| POST | `/api/chat` | Chat multi-turno |
| GET/PUT/DELETE | `/api/chat/history?projectId=` | Historial de chat por proyecto (global si no se pasa projectId) |
| GET | `/api/agents/flat` | Todos los agentes de todos los niveles aplanados (para @mention autocomplete) |

El helper del renderer es: `req(method, path, body?)` → hace fetch a `http://localhost:3737/api{path}`.

---

## config.json

Localización:
- **Dev**: raíz del proyecto (`config.json`)
- **Portable/Producción**: junto al `.exe` (variable `PORTABLE_EXECUTABLE_DIR`)

Estructura completa:

```json
{
  "version": "1.1.0",
  "aiProvider": "cli",
  "apiKey": "",
  "githubToken": "",
  "githubModel": "gpt-4o-mini",
  "theme": "dark",
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

Campos editables por `PUT /api/config`: `apiKey`, `aiProvider`, `githubToken`, `githubModel`, `theme`.

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

## Chat IA (`chat-view.js`)

El chat soporta conversación multi-turno con el proveedor configurado. Estado en `chatState` (local al módulo, no en `S`).

**Características:**
- **Historial por proyecto**: se guarda en `cache/chat-{projectId}.json` (o `chat-global.json` si no hay proyecto). Al cambiar de proyecto se guarda el actual y se carga el nuevo.
- **@mention de agentes**: escribe `@nombre` en el input para añadir un agente como contexto activo. Se muestra un dropdown autocomplete filtrado. Los agentes activos aparecen como chips en la barra de contexto y se incluyen en el system prompt de cada mensaje.
- **Acciones sugeridas**: la IA puede incluir `<!--ACTIONS:[{"label":"...","action":"..."}]-->` al final de su respuesta. El renderer los extrae y muestra como botones clickables. Acciones soportadas: `create-agent`, `open-agents`, `open-settings`.
- **Selector de proyecto**: en el topbar del chat, permite cambiar el proyecto activo sin salir de la vista.

**Flujo de datos del system prompt:**
`chatBuildSystem()` concatena los system prompts de todos los agentes activos + instrucción para sugerir acciones → se envía como `systemPrompt` en `POST /api/chat`.

---

## Agentes — funciones IA adicionales

### Optimizar agente (`POST /api/ai/optimize-agent`)
Recibe `{name, description, system, tools, model}`. Construye un prompt que pide a la IA mejorar el system prompt y la descripción manteniendo el foco del agente. Devuelve `{description, system}`. El editor muestra el botón "Optimizar con IA" solo si `!agent.optimized && agent.system`. Tras guardar, el fichero `.md` incluye `optimized: true` en el frontmatter.

### Generar contexto del proyecto (`POST /api/projects/:id/generate-context?type=claude|github`)
Analiza el directorio del proyecto: detecta lenguajes (por extensión de archivo), lee `package.json` / `requirements.txt` / `pyproject.toml`, detecta framework de testing, linting, build tool, CI/CD y Docker. Construye el prompt con toda esa información y llama al proveedor de IA. Devuelve el contenido generado para que el usuario lo revise y guarde manualmente.

### Sugerencias por proyecto (`GET /api/ai/project-suggestions?projectId=`)
A diferencia de las sugerencias por nivel (global/section/tech), las sugerencias de proyecto leen el CLAUDE.md o copilot-instructions.md del proyecto como contexto principal. El prompt incluye nombre, categoría, tecnología, contenido del fichero de contexto (hasta 3000 chars) y los agentes ya existentes. Las sugerencias salen en español. Cache en `suggestions.json` con clave `project::{projectId}`.

### Exclusión de agentes con opciones
Al excluir un agente desde el drawer de proyecto, aparece un modal con dos opciones:
1. **Excluir y eliminar archivo** → llama `DELETE /api/projects/:id/agents/:name` (borra el `.md` del disco)
2. **Solo excluir** → añade a `project.excludedAgents[]` pero el archivo permanece

Al volver a incluir un agente se llama automáticamente `POST /api/projects/:id/sync` para restaurar el archivo si fue borrado.

---

## Sistema de iconos y badges

Iconografía exclusivamente via **Tabler Icons** (`ti ti-*`) desde CDN v3.6.0.

### Badges (`.badge`)
Variantes: `green`, `amber`, `blue`, `accent`, `gray`, `coral`. Siempre incluir icono dentro del badge para claridad visual.

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
- Nav Agentes: `ti-cpu` (diferenciado del logo)
- Nav Proyectos: `ti-layout-grid`
- Nav Chat: `ti-message-chatbot`
- Nav Ajustes: `ti-settings`

---

## Tema visual

Sistema de temas basado en variables CSS en `src/renderer/styles.css`:

- **Oscuro** (defecto): variables en `:root`
- **Claro**: variables en `body.light`

Funciones relevantes en `utils.js`:
- `applyTheme(theme)` — añade/quita clase `light` en `<body>`
- `setTheme(theme)` — aplica + persiste via `PUT /api/config`

Colores accent principal: `#7c6af7` (dark) / `#6c5ce7` (light).

---

## IPC — `window.api` (preload.js)

```js
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
```

---

## Build y distribución

```bash
npm run dev          # Electron en modo dev (devTools abiertos)
npm run build        # Portable .exe en dist/
npm run release      # Build + publish a GitHub Releases
```

- Salida: `dist/agent-hub.exe` (portable x64)
- Auto-updater: GitHub Releases (repo privado `adanoliva/cdm`)
- Icono: `assets/icon.ico` (generado por `scripts/generate-icon.js`)

---

## Convenciones de código

- **Sin frameworks en renderer**: Vanilla JS, sin React/Vue/etc.
- **Render = innerHTML**: Las vistas se renderizan como strings HTML con template literals.
- **Estado centralizado**: Todo en `S` (objeto global `state.js`). No hay props ni eventos entre módulos.
- **Estilos**: Una sola hoja `styles.css` con variables CSS; sin preprocesadores.
- **Sin comentarios redundantes**: Solo cuando el "por qué" no es obvio.
- **Español en UI**: Todos los textos de interfaz en español. Código en inglés.
- **Tabler Icons**: Iconografía via clase `ti ti-*` (CDN).
- **Fuentes**: JetBrains Mono (mono) + Syne (sans), ambas de Google Fonts.

---

## Checklist al actualizar versión

1. Actualizar `version` en `package.json`
2. Actualizar el campo `version` en `DEFAULT_CONFIG` de `src/main/config.js`
3. Actualizar la línea `> Versión actual:` al inicio de este archivo
4. Commit y tag git → `npm run release`
