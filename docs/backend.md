# Documentación técnica — Backend (`src/backend/`)

> Stack: Electron main process + Express 4 en `localhost:3737`
> Última actualización: 2026-06-08 · Versión: 2.3.0-dev

---

## Índice

1. [Visión general](#1-visión-general)
2. [Arranque y ciclo de vida (`main.js`)](#2-arranque-y-ciclo-de-vida-mainjs)
3. [Configuración (`config.js`)](#3-configuración-configjs)
4. [API REST (`server.js`)](#4-api-rest-serverjs)
5. [Gestión de agentes (`agents.js`)](#5-gestión-de-agentes-agentsjs)
5b. [Skills (`skills.js`)](#5b-skills-skillsjs)
6. [Sincronización del directorio de agentes (`agents-sync.js`)](#6-sincronización-del-directorio-de-agentes-agents-syncjs)
7. [Gestión de proyectos (`projects.js`)](#7-gestión-de-proyectos-projectsjs)
8. [Integración IA (`ai.js`)](#8-integración-ia-aijs)
8b. [Prompts centralizados (`prompts.js`)](#8b-prompts-centralizados-promptsjs)
9. [Servicio de filesystem (`api-fs.js`)](#9-servicio-de-filesystem-api-fsjs)
10. [Subsistema CLI (`subsystem-cli.js`)](#10-subsistema-cli-subsystem-clijs)
11. [Orquestaciones — CRUD (`workflows.js`)](#11-orquestaciones--crud-workflowsjs)
12. [Orquestaciones — Motor de ejecución (`orchestrator.js`)](#12-orquestaciones--motor-de-ejecución-orchestratorjs)
12b. [Scripts determinísticos (`scripts-registry.js`)](#12b-scripts-determinísticos-scripts-registryjs)
12c. [Git Checkpointer (`git-checkpointer.js`)](#12c-git-checkpointer-git-checkpointerjs)
12d. [Ops Ledger (`ops-ledger.js`)](#12d-ops-ledger-ops-ledgerjs)
13. [Bandeja del sistema (`tray.js`)](#13-bandeja-del-sistema-trayjs)
13b. [Automatización de navegador vía CDP (`browser.js`)](#13b-automatización-de-navegador-vía-cdp-browserjs)
14. [Bridge IPC (`preload.js`)](#14-bridge-ipc-preloadjs)
15. [Agentes por defecto (`defaults.js`)](#15-agentes-por-defecto-defaultsjs)
16. [Plantillas de contexto (`templates.js`)](#16-plantillas-de-contexto-templatesjs)
17. [Flujos clave end-to-end](#17-flujos-clave-end-to-end)
18. [Dashboard y seguimiento de uso](#18-dashboard-y-seguimiento-de-uso)

---

## 1. Visión general

El backend es el proceso principal de Electron (`main process`). Corre en Node.js y tiene acceso completo al sistema de archivos y a las APIs nativas. Expone dos interfaces hacia el renderer:

- **API REST HTTP** en `localhost:3737` (Express). El renderer hace `fetch('/api/...')` y Vite lo proxea en dev.
- **IPC bridge** (`preload.js`). Para operaciones nativas que no pasan por HTTP: abrir carpetas, dialogs de sistema, control de ventana, actualizaciones.

```
Electron main process (Node.js)
  │
  ├── main.js          ← punto de entrada, BrowserWindow, ciclo de vida
  ├── server.js        ← Express: todas las rutas /api/* y /api-fs/*
  ├── config.js        ← lectura/escritura de config.json
  ├── agents.js        ← CRUD de agentes (.md con frontmatter YAML)
  ├── agents-sync.js   ← sincronización con el Directorio de Agentes (GitHub)
  ├── skills.js        ← CRUD de skills (bloques de contexto inyectables)
  ├── projects.js      ← CRUD de proyectos, sync de agentes a proyectos
  ├── ai.js            ← llamadas a IA (CLI / Anthropic API / GitHub)
  ├── api-fs.js        ← operaciones de filesystem para el Subsistema CLI
  ├── subsystem-cli.js ← CLI virtual multi-turno para providers API/GitHub
  ├── prompts.js       ← prompts centralizados para todas las operaciones IA
  ├── workflows.js     ← CRUD de orquestaciones (JSON en .agent-hub/)
  ├── orchestrator.js  ← motor de ejecución de orquestaciones + SSE streaming
  ├── scripts-registry.js ← scripts determinísticos para orquestaciones (sin IA)
  ├── git-checkpointer.js ← commits automáticos tras cada paso (gitEnabled)
  ├── ops-ledger.js    ← registro append-only de operaciones atómicas por orquestación
  ├── tray.js          ← icono en la bandeja del sistema
  ├── preload.js       ← contextBridge: window.api expuesto al renderer
  ├── defaults.js      ← vacío (agentes ahora vienen del directorio externo)
  └── templates.js     ← plantillas CONTEXTO.md / CLAUDE.md / etc.
```

### Dos modos de ejecución

| Variable | Valor | Efecto |
|---|---|---|
| `isDev` | `!app.isPackaged` | Abre DevTools, permite ejecutar Vite |
| `isViteDev` | `NODE_ENV === 'development'` | Electron carga `http://localhost:5173` en vez de Express |

En producción (`npm run build`), Express sirve el build de Vite desde `dist/renderer/` además de la API.

---

## 2. Arranque y ciclo de vida (`main.js`)

### Secuencia de arranque

```
app.whenReady()
  │
  ├── readConfig()                        ← lee config.json
  ├── bootstrapDirectories(cfg)           ← crea carpetas necesarias
  ├── migrateAgentFiles()                 ← actualiza formato de .md antiguos
  ├── startServer()                       ← levanta Express en :3737
  ├── createWindow()                      ← BrowserWindow 1280×800
  ├── createTray(mainWindow)              ← icono en bandeja
  ├── setupAutoUpdater()                  ← solo en producción
  └── agentsSync.triggerSync(url, isFirstSync)  ← sync async del directorio
```

**Nota sobre el sync del directorio:** la sincronización es completamente asíncrona. El servidor ya está levantado y la ventana visible cuando el sync comienza. El renderer detecta si está en curso consultando `GET /api/agents-directory/status` y muestra un overlay de progreso si es el primer arranque.

`isFirstSync = !agentsSync.metaExists()` — es `true` si no existe aún `cache/agents-meta.json`. En ese caso el renderer muestra el overlay de descarga.

### BrowserWindow

```js
new BrowserWindow({
  width: 1280, height: 800,
  minWidth: 900, minHeight: 600,
  backgroundColor: '#0d0d0f',
  frame: true,
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: 'preload.js',
    devTools: isDev,
  },
})
```

### Comportamiento al cerrar

```
mainWindow.on('close') → handleClose()
  │
  ├── cfg.closeAction === 'tray'  → mainWindow.hide()
  ├── cfg.closeAction === 'quit'  → app.isQuiting = true; app.quit()
  └── cfg.closeAction === 'ask'   → webContents.send('app:close-requested')
                                     ipcMain.once('app:close-response', handler)
```

El renderer muestra `<CloseDialog>` y responde con `{ action, remember }` vía IPC. Si `remember` es `true`, se persiste `closeAction` en `config.json`.

### Auto-updater

Solo activo en producción. Comprueba actualizaciones en el repo privado `adanoliva/cdm`. La descarga e instalación las dispara el renderer a través de los handlers IPC `update:check`, `update:download`, `update:install`.

### IPC handlers registrados en main.js

| Canal | Acción |
|---|---|
| `app:version` | `app.getVersion()` |
| `app:appDir` | `APP_DIR` |
| `app:isDev` | `isDev` |
| `window:minimize` | `mainWindow.minimize()` |
| `window:hide` | `mainWindow.hide()` |
| `shell:openPath` | `shell.openPath(p)` |
| `shell:openExternal` | `shell.openExternal(url)` |
| `shell:openVSCode` | `exec('code "path"')` |
| `dialog:pickFolder` | `dialog.showOpenDialog({ openDirectory })` |
| `dialog:pickFile` | `dialog.showOpenDialog({ openFile })` |
| `update:check` | `autoUpdater.checkForUpdates()` |
| `update:download` | `autoUpdater.downloadUpdate()` |
| `update:install` | `autoUpdater.quitAndInstall()` |

---

## 3. Configuración (`config.js`)

### Localización de APP_DIR

```js
// Producción portable (.exe): junto al ejecutable
process.env.PORTABLE_EXECUTABLE_DIR ?? ruta calculada

// Dev: raíz del proyecto (dos niveles arriba de src/backend/)
path.resolve(__dirname, '../../')
```

### Rutas derivadas

| Constante | Ruta |
|---|---|
| `APP_DIR` | Directorio base de datos de la app |
| `CONFIG_FILE` | `APP_DIR/config.json` |
| `AGENTS_DIR` | `APP_DIR/agents/` |
| `SKILLS_DIR` | `APP_DIR/agents/skills/` |
| `CACHE_DIR` | `APP_DIR/cache/` |

### Estructura de `config.json`

```json
{
  "version": "1.9.5",
  "aiProvider": "cli",
  "apiKey": "",
  "closeAction": "ask",
  "agentsDirectoryUrl": "https://github.com/adanoliva/agents-directory",
  "agentsDirectoryEnabled": true,
  "categories": [
    { "id": "frontend", "name": "Frontend", "icon": "ti-layout",           "color": "#60a5fa", "technologies": [] },
    { "id": "backend",  "name": "Backend",  "icon": "ti-server",           "color": "#34d399", "technologies": [] },
    { "id": "mobile",   "name": "Mobile",   "icon": "ti-device-mobile",    "color": "#a78bfa", "technologies": [] },
    { "id": "devops",   "name": "DevOps",   "icon": "ti-settings-2",       "color": "#fbbf24", "technologies": [] },
    { "id": "data",     "name": "Data / IA","icon": "ti-chart-bar",        "color": "#fb923c", "technologies": [] },
    { "id": "games",    "name": "Games",    "icon": "ti-device-gamepad-2", "color": "#f472b6", "technologies": [] }
  ],
  "projects": [...]
}
```

El campo `technologies` se mantiene por compatibilidad con instalaciones existentes pero la UI ya no lo gestiona. Las categorías por defecto ya no incluyen `docs` (sus agentes pasaron a `global`).

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readConfig()` | Lee y parsea `config.json`; si no existe, devuelve `DEFAULT_CONFIG` |
| `writeConfig(cfg)` | Serializa y escribe `config.json` |
| `getAgentDir(level, catId)` | Calcula la ruta de carpeta de agentes según nivel |
| `bootstrapDirectories(cfg)` | Crea `agents/global/`, `agents/section-*`, `agents/skills/`, `agents/uncategorized/` y `cache/` |
| `ensureDir(p)` | `fs.mkdirSync(p, { recursive: true })` |

### `getAgentDir` — lógica de nivel

```js
level === 'global'        → agents/global/
level === 'section'       → agents/section-{catId}/
level === 'uncategorized' → agents/uncategorized/
```

El nivel `tech` fue eliminado. La especificidad tecnológica se gestiona mediante el sistema de skills del proyecto.

---

## 4. API REST (`server.js`)

Express corre en el puerto `3737` (constante `PORT`). Todos los endpoints tienen el prefijo `/api`.

### Tabla completa de endpoints

#### Health y configuración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | `{ status: 'ok', port }` |
| GET | `/api/config` | Config completa |
| PUT | `/api/config` | Actualiza campos de configuración |
| GET | `/api/detect-cli` | `{ found: bool, path? }` — busca CLIs en PATH |
| POST | `/api/setup` | Wizard: guarda proveedor + credenciales y dispara sync del directorio |

#### Categorías

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/categories` | Array de categorías |
| POST | `/api/categories` | Crea categoría `{ id, name, icon, color }` |
| PUT | `/api/categories/:id` | Actualiza nombre, icono, color |
| DELETE | `/api/categories/:id` | Elimina categoría |

#### Directorio de Agentes

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/agents-directory/status` | Estado del sync: `{ enabled, url, syncing, firstSync, progress, lastSync, agentCount, pendingConflicts, lastResult }` |
| POST | `/api/agents-directory/sync` | Dispara una sincronización manual (no bloqueante) |
| POST | `/api/agents-directory/resolve-conflict` | Resuelve un conflicto: `{ fileKey, action: 'keep'\|'update' }` |

#### Agentes (niveles 1–2 + Sin categoría)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/agents?level=&categoryId=` | Lista agentes de un nivel (incluye `level=uncategorized`) |
| GET | `/api/agents/flat` | Todos los agentes de todos los niveles (para búsqueda global y @mention) |
| GET | `/api/agents/applicable?projectId=` | Global + section aplicables al proyecto |
| POST | `/api/agents` | Crea agente `{ level, categoryId?, agent }` |
| PUT | `/api/agents` | Actualiza agente `{ level, categoryId?, oldName, agent }` |
| DELETE | `/api/agents` | Elimina fichero .md `{ level, categoryId?, name }` |
| POST | `/api/agents/import-url` | Descarga .md desde URL y parsea `{ agent }` |

#### Skills

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/skills` | Lista todos los skills (`agents/skills/*.md`) |
| POST | `/api/skills` | Crea skill `{ skill: { name, description, content } }` |
| PUT | `/api/skills` | Actualiza skill existente |
| DELETE | `/api/skills?name=` | Elimina fichero de skill |
| GET | `/api/skills/flat` | Alias de GET `/api/skills` — para selector en AgentEditor de proyectos |

#### Agentes de proyecto (nivel proyecto)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects/:id/agents` | Lista agentes del proyecto (`.claude/agents/` o `.github/agents/`) |
| POST | `/api/projects/:id/agents` | Crea agente local al proyecto |
| PUT | `/api/projects/:id/agents` | Actualiza agente local (`{ oldName, agent }`) |
| DELETE | `/api/projects/:id/agents/:name` | Elimina fichero .md del proyecto |

#### Proyectos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects` | Array de proyectos con `pendingUpdates` y `pathExists` |
| POST | `/api/projects` | Crea proyecto `{ name, categoryId, projectPath, description?, status?, aiProviders?, selectedAgents?, skills? }` |
| POST | `/api/projects/import` | Importa proyecto existente en disco (mismos campos) |
| PUT | `/api/projects/:id` | Edita metadata: `name`, `description`, `status`, `categoryId`, `skills`, `aiProviders`, `excludedAgents`, `includedAgents`, `gitEnabled` |
| DELETE | `/api/projects/:id` | Elimina proyecto (con opción `deleteFolder`) |

#### Sync

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects/:id/sync-status` | Estado por agente: `ok`/`outdated`/`new`/`local`/`excluded` |
| GET | `/api/projects/:id/sync-preview` | Preview dry-run del sync; devuelve `SyncPreview` sin modificar archivos |
| POST | `/api/projects/:id/sync` | Copia agentes aplicables al proyecto; devuelve `{ added, updated, skipped }` |
| POST | `/api/sync-all` | Sync de todos los proyectos en batch |

#### Contexto y ejecución del proyecto

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects/:id/context?type=auto` | Detecta proveedor y devuelve `ProjectContextInfo` completo |
| PUT | `/api/projects/:id/context` | Guarda el fichero de contexto |
| POST | `/api/projects/:id/generate-context?type=` | Genera con IA analizando el directorio del proyecto |
| POST | `/api/projects/:id/execute-task` | Ejecuta un agente sobre el proyecto. Devuelve `{ result, task, durationMs }` |

#### Dashboard

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/dashboard` | `DashboardData`: estadísticas, sync, notificaciones, salud de proyectos |
| POST | `/api/dashboard/notifications/dismiss` | Descarta permanentemente una notificación `{ id }` |
| POST | `/api/dashboard/notifications/dismiss-group` | Descarta un grupo de notificaciones |
| POST | `/api/dashboard/notifications/snooze` | Aplaza una notificación N días `{ id, days }` |
| POST | `/api/dashboard/notifications/restore` | Restaura todas las notificaciones ocultas y aplazadas |

#### IA

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/ai/status` | `{ provider, ready: bool }` |
| GET | `/api/ai/usage` | `AIUsage`: `{ cumulative, session }` con tokens y coste estimado |
| POST | `/api/ai/usage/reset` | Reinicia contadores de sesión |
| POST | `/api/ai/usage/reset-all` | Reinicia todo; borra `cache/ai-usage.json` |
| POST | `/api/ai/generate-prompt` | Genera system prompt desde descripción `{ description, name, level, tools, language }` |
| POST | `/api/ai/generate-skill` | Genera contenido Markdown de una skill `{ name, description, language }` → `{ content }` |
| POST | `/api/ai/optimize-agent` | Mejora system prompt y description existentes |
| GET | `/api/ai/suggestions?level=&categoryId=` | 3 sugerencias de agentes (con caché) |
| POST | `/api/ai/suggestions/refresh` | Invalida caché y regenera. Body opcional: `{ alreadySuggested: string[] }` |
| DELETE | `/api/ai/suggestions/cache` | Limpia toda la caché de sugerencias |
| GET | `/api/ai/project-suggestions?projectId=` | Sugerencias usando CLAUDE.md como contexto |
| POST | `/api/ai/project-suggestions/refresh` | Invalida caché de proyecto. Body opcional: `{ alreadySuggested: string[] }` |

#### Chat

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/chat` | Conversación multi-turno `{ messages, systemPrompt }` → `{ reply }` |
| GET | `/api/chat/history?projectId=` | Carga historial (`cache/chat-{projectId}.json`) |
| PUT | `/api/chat/history` | Guarda historial `{ projectId, messages }` |
| DELETE | `/api/chat/history?projectId=` | Borra fichero de historial |

#### Orquestaciones

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/orchestrations?projectId=` | Lista todas las orquestaciones de un proyecto |
| POST | `/api/orchestrations` | Crea una orquestación |
| GET | `/api/orchestrations/:id` | Lee una orquestación por id (requiere `?projectId=`) |
| PUT | `/api/orchestrations/:id` | Actualiza la orquestación |
| DELETE | `/api/orchestrations/:id` | Elimina la orquestación y su JSON del disco |
| POST | `/api/orchestrations/:id/validate` | Valida sin ejecutar. Devuelve `{ valid, errors[] }` |
| POST | `/api/orchestrations/:id/execute` | Lanza la ejecución. Devuelve `{ executionId, status: 'started' }` |
| GET | `/api/orchestrations/:id/execute/stream?executionId=` | SSE stream de progreso |
| GET | `/api/orchestrations/:id/executions` | Lista el historial de ejecuciones |
| GET | `/api/orchestrations/:id/executions/:executionId` | Lee el resultado completo de una ejecución |
| POST | `/api/orchestrations/:id/executions/:execId/resume` | Reanuda una ejecución interrumpida |
| POST | `/api/orchestrations/:id/executions/:execId/gate` | Resuelve un gate HITL: `{ action: 'approve'\|'revise'\|'cancel', feedbackText?, stepIndex }` |
| GET | `/api/scripts` | Lista los scripts disponibles (built-in + externos). Devuelve `{ scripts, warnings }` |
| GET | `/api/scripts/validate` | Valida estáticamente los scripts externos y devuelve informe con issues por fichero |
| GET | `/api/orchestrations/:id/ops` | Lee el ops-ledger |
| POST | `/api/orchestrations/:id/ops/:opId/revert` | Marca una operación atómica como revertida |

#### Subsistema CLI (API-FS)

Endpoints bajo el prefijo `/api-fs`. Requieren que el proyecto exista en config.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api-fs/projects/:id/files/read?path=` | Lee un fichero del proyecto |
| GET | `/api-fs/projects/:id/files/list?pattern=` | Lista ficheros del proyecto |
| POST | `/api-fs/projects/:id/files/write` | Escribe fichero con backup automático |
| POST | `/api-fs/projects/:id/bash` | Ejecuta comando de la whitelist |
| POST | `/api-fs/projects/:id/grep` | Busca patrón en ficheros |
| POST | `/api-fs/projects/:id/execute-agent` | Ejecuta el loop completo del Subsistema CLI |

---

## 5. Gestión de agentes (`agents.js`)

### Formato de fichero `.md`

```markdown
---
name: nombre-del-agente
description: Descripción breve del agente
model: claude-sonnet-4-20250514
tools:
  - Read
  - Write
  - Bash
optimized: true
---

System prompt del agente aquí.
```

### Modelos disponibles (alias → ID completo)

| Alias | Model ID |
|---|---|
| `haiku` | `claude-haiku-4-5-20251001` |
| `sonnet` | `claude-sonnet-4-20250514` |
| `opus` | `claude-opus-4-20250514` |

### Jerarquía de niveles

| Nivel | Carpeta | Aplica a |
|---|---|---|
| `global` | `agents/global/` | Todos los proyectos |
| `section` | `agents/section-{catId}/` | Proyectos de esa categoría |
| `uncategorized` | `agents/uncategorized/` | Agentes del directorio sin carpeta estándar |
| `project` | `{projectPath}/.claude/agents/` o `.github/agents/` | Un proyecto concreto |

El nivel `tech` fue eliminado. La especificidad tecnológica se delega al sistema de skills del proyecto (`project.skills[]`).

### Funciones principales

**Parseo y serialización:**
- `parseAgentFile(filePath)` — lee un `.md`, extrae frontmatter YAML y body.
- `parseAgentFromString(content, fallbackName)` — misma lógica desde string (usado en import-url).
- `serializeAgent(agent)` — construye el string `.md` con frontmatter + body.
- `hashAgent(agent)` — SHA-256 del string serializado.

**CRUD niveles global/section/uncategorized:**
- `listAgentsByLevel(level, catId)` — lista `.md` de la carpeta correspondiente.
- `getApplicableAgents(categoryId)` — combina global + section del proyecto.
- `createAgent(level, catId, _techId, agent)` — valida unicidad y escribe el fichero. `_techId` ignorado.
- `updateAgent(level, catId, _techId, oldName, agent)` — sobreescribe el fichero existente.
- `deleteAgent(level, catId, _techId, name)` — elimina el fichero.

**Nivel de proyecto:**
- `listProjectAgents(projectPath, providers)` — lee las carpetas de agentes de cada proveedor.
- `saveProjectAgent(projectPath, name, agent, providers)` — escribe en la carpeta del proyecto.
- `deleteProjectAgent(projectPath, name, providers)` — elimina el fichero del proyecto.

**Migración y sincronización:**
- `migrateAgentFiles()` — detecta agentes en formato antiguo y los convierte.
- `syncGlobalAgentsToClaudeDir()` — copia todos los agentes globales a `~/.claude/agents/`.

---

## 5b. Skills (`skills.js`)

Las skills son bloques de contexto Markdown que se inyectan en el system prompt de los agentes cuando se ejecutan en un proyecto que las tiene configuradas. Permiten separar el conocimiento tecnológico (React, PostgreSQL, Docker…) del comportamiento del agente.

### Estructura de un fichero de skill

```markdown
---
name: react
description: React 18 con TypeScript, hooks y patrones modernos
---

## Technology context — React 18

This project uses **React 18** with TypeScript.
- Functional components with hooks — never classes
...
```

### Ubicación en disco

Todos los skills viven en una estructura plana:

```
APP_DIR/agents/skills/
  ├── react.md
  ├── vue.md
  ├── postgresql.md
  ├── unity.md
  └── ...
```

`SKILLS_DIR = path.join(AGENTS_DIR, 'skills')` — exportado desde `config.js` y usado por `skills.js` y `agents-sync.js`.

### Convención de idioma

- Skills relacionados con código → **inglés** (se inyectan en system prompts de agentes de código).
- Skills relacionados con documentación → **español** (si aplica).

### Funciones exportadas

| Función | Descripción |
|---|---|
| `listSkills()` | Lista todos los `.md` de `SKILLS_DIR`. Llama `migrateSkillsFromSubdirs()` antes |
| `listAllSkills()` | Alias de `listSkills()` para compatibilidad |
| `createSkill(skill)` | Escribe `{name}.md` en `SKILLS_DIR`; lanza error si ya existe |
| `updateSkill(skill)` | Sobreescribe el fichero; lanza error si no existe |
| `deleteSkill(name)` | Elimina el fichero; lanza error si no existe |
| `migrateSkillsFromSubdirs()` | Migra skills legacy desde subdirectorios a la raíz plana |

### Inyección en ejecución

Cuando un agente se ejecuta (execute-task, orquestación, subsistema CLI), el motor lee `project.skills[]`, carga el contenido de cada skill y lo concatena al system prompt del agente antes de la llamada a la IA.

---

## 6. Sincronización del directorio de agentes (`agents-sync.js`)

Este módulo gestiona la descarga y versionado de agentes y skills desde un repositorio GitHub externo.

### Algoritmo de versionado

El versionado se hace por archivo usando **git blob SHA** — el mismo algoritmo que GitHub usa internamente:

```js
function gitBlobSHA(content) {
  const buf    = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = `blob ${buf.length}\0`;
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}
```

### Mapeo de rutas remotas → locales

| Ruta en el repo | Destino local |
|---|---|
| `skills/{name}.md` | `agents/skills/{name}.md` |
| `agents/global/{name}.md` | `agents/global/{name}.md` |
| `global/{name}.md` | `agents/global/{name}.md` |
| `agents/section-{x}/{name}.md` | `agents/section-{x}/{name}.md` |
| Cualquier otra ruta (incluidas `tech-*`) | `agents/uncategorized/{name}.md` |

Las rutas `tech-*` del repositorio remoto se redirigen a `uncategorized`. El repositorio externo ya no debe tener carpetas `tech-*`.

### Detección de conflictos

| Condición | Acción |
|---|---|
| `remoteSHA === meta.remoteSHA` | Sin cambios upstream → saltar |
| `remoteSHA !== meta.remoteSHA` + `diskSHA === meta.localSHA` | Actualización segura → descargar |
| `remoteSHA !== meta.remoteSHA` + `diskSHA !== meta.localSHA` | **Conflicto** → encolar |
| Archivo no existe en disco | Nuevo → descargar |

### Funciones exportadas

| Función | Descripción |
|---|---|
| `metaExists()` | `true` si existe `cache/agents-meta.json` |
| `readMeta()` | Lee y parsea el meta JSON |
| `getSyncState()` | Snapshot del estado en memoria |
| `triggerSync(url, isFirst)` | Dispara el sync async; sin-op si ya hay uno en curso |
| `resolveConflict(fileKey, action, url)` | Resuelve un conflicto pendiente |

---

## 7. Gestión de proyectos (`projects.js`)

### Estructura de un proyecto en config.json

```js
{
  id: 'p1234567890abc',
  name: 'Mi Proyecto',
  categoryId: 'frontend',
  skills: ['react', 'tailwind', 'typescript'],  // skills inyectadas en agentes al ejecutar
  path: 'C:/proyectos/mi-proyecto',
  description: '',
  status: 'active',                   // active | paused | archived
  aiProviders: ['claude', 'github'],
  selectedAgents: [],
  excludedAgents: [],
  agentHashes: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  lastSyncAt: '2025-01-01T00:00:00.000Z',
}
```

El campo `techId` fue eliminado. La especificidad tecnológica la aportan las skills del proyecto. Proyectos existentes con `techId` en disco son ignorados sin error.

### Sync de agentes

```
syncProject(projectId)
  │
  ├── getApplicableAgents(project.categoryId)   ← global + section
  ├── listProjectAgents(project)                ← nivel proyecto
  ├── para cada proveedor en project.aiProviders:
  │   ├── asegurar directorio de agentes del proveedor
  │   ├── adaptar formato del agente (agent-adapters.js)
  │   └── escribir archivo .md
  ├── actualizar agentHashes
  └── devuelve { added, updated }
```

**`getProjectSyncStatus(project)`** devuelve el estado por agente sin modificar nada:

| Estado | Significado |
|---|---|
| `ok` | El hash coincide; el agente está actualizado |
| `outdated` | El hash difiere; hay una versión más nueva |
| `new` | El agente no existe aún en el proyecto |
| `local` | El agente existe en el proyecto pero no en los niveles globales |
| `excluded` | El agente está en `excludedAgents` |

### Ciclo de vida de un proyecto

**`createProject({ name, categoryId, projectPath, skills?, aiProviders?, ... })`** — genera id, crea carpeta, escribe fichero de contexto, sincroniza agentes, persiste en config.

**`importProject(...)`** — como `createProject` pero la carpeta ya existe; adopta contexto existente si lo encuentra.

**`updateProject(id, changes)`** — campos permitidos: `name`, `description`, `status`, `categoryId`, `skills`, `aiProviders`, `excludedAgents`, `includedAgents`, `gitEnabled`. Si `aiProviders` cambia, migra los agentes de nivel proyecto al nuevo directorio.

**`deleteProject(id, { deleteFolder })`** — elimina de config. Si `deleteFolder: true`, borra el directorio del disco.

### Ficheros de contexto

| Provider | Ruta |
|---|---|
| **Maestro** | `{path}/CONTEXTO.md` |
| `claude` | `{path}/CLAUDE.md` |
| `github` | `{path}/.github/copilot-instructions.md` |
| `gemini` | `{path}/GEMINI.md` |
| `openai` | `{path}/.instructions.md` |

---

## 8. Integración IA (`ai.js`)

### Proveedores soportados

| Provider | Config necesaria | Backend |
|---|---|---|
| `cli` | Claude Code instalado en PATH | Spawn de proceso `claude --print` |
| `api` | `config.apiKey` (Anthropic) | `@anthropic-ai/sdk` |
| `github` | `config.githubToken` | `fetch` a Azure inference endpoint |
| **Nativos** | DeepSeek, Groq, OpenRouter, Perplexity | `fetch` compatible OpenAI |
| **CLIs** | Aider, Cline, Goose | Spawn de proceso nativo |
| **Custom** | Dinámicos (API/CLI) | Soporta Azure, Headers custom |

### `callAI(prompt, systemPrompt?)`

Punto de entrada único. Lee `config.aiProvider` y delega a la rama correspondiente. Captura uso de tokens y llama a `trackUsage()`.

### `callCLI(prompt, opts?)`

- `opts.extraArgs` — argumentos adicionales para `claude --print`.
- `opts.cwd` — directorio de trabajo del proceso spawneado.
- `opts.timeout` — timeout en ms (por defecto 60 000).

### Funciones de generación

- `generateAgentPrompt({ description, level, tools, language })` — genera system prompt. Usa `prompts.agentPrompt()`.
- `generateSuggestions({ level, categoryId, existingAgents, alreadySuggested? })` — 3 agentes sugeridos. Usa `prompts.agentSuggestions()`.
- `generateProjectSuggestions({ project, contextContent, existingAgents, alreadySuggested? })` — sugerencias contextualizadas. Usa `prompts.projectSuggestions()`.
- `optimizeAgent({ name, description, system, tools, model })` — mejora system prompt y descripción. Usa `prompts.optimizeAgent()`.

### Seguimiento de uso de tokens

```js
cumulative  // persiste en cache/ai-usage.json entre sesiones
session     // solo en memoria, se reinicia con la app

trackUsage({ inputTokens, outputTokens, costUSD })
resetSessionUsage()
resetAllUsage()
getSessionUsage()  // → { cumulative, session }
```

**Coste estimado** (solo para `api`):

| Modelo | Input $/1M | Output $/1M |
|---|---|---|
| claude-sonnet-4-20250514 | $3 | $15 |
| claude-haiku-4-5-20251001 | $0.25 | $1.25 |
| claude-opus-4-20250514 | $15 | $75 |

---

## 8b. Prompts centralizados (`prompts.js`)

Módulo de solo lectura que centraliza todos los prompts enviados a la IA. No expone endpoints — es requerido internamente por `ai.js`, `server.js` y `orchestrator.js`.

### Funciones exportadas

| Función | Usada por | Descripción |
|---|---|---|
| `agentPrompt({ name, description, level, toolsNote, langInstr })` | `ai.js` | Genera system prompt de agente desde descripción informal |
| `optimizeAgent({ name, model, toolList, description, system, langTarget })` | `server.js` | Reescribe system prompt para ser token-eficiente (50-100 palabras) |
| `agentSuggestions({ context, existing })` | `ai.js` | 3 sugerencias de agentes en JSON |
| `projectSuggestions({ project, contextSection, existing, categoryName, techName })` | `ai.js` | Sugerencias contextualizadas al CLAUDE.md del proyecto |
| `generateContext({ fileLabel, projectInfo, existingContext, structure, dependencies, existingReadme })` | `server.js` | Genera o reescribe el fichero de contexto del proyecto (máx. 100 líneas) |
| `skillContent({ name, description, language })` | `server.js · POST /ai/generate-skill` | Genera el bloque Markdown de una skill (h2 heading + bullets + ejemplos, 20-40 líneas, sin frontmatter) |
| `adaptForProvider({ agent, targetProvider })` | `ai.js` | Reescribe el system prompt para el proveedor destino |
| `agentHandoffInstruction()` | `orchestrator.js` | Bloque HANDOFF inyectado en agentes no-finales de orquestaciones |
| `formatHandoffAsInput(handoff, fromAgent)` | `orchestrator.js` | Formatea handoff como mensaje compacto para el siguiente agente |

### Convención de idioma en `skillContent`

El parámetro `language` acepta `'es'` o `'en'`. Los skills de código se generan en inglés por defecto; los de documentación en español.

---

## 9. Servicio de filesystem (`api-fs.js`)

Encapsula todas las operaciones de I/O para el Subsistema CLI. Valida la ruta antes de cada operación.

### Seguridad y restricciones

- **Path traversal**: rechaza rutas con `..`.
- **Directorios excluidos**: `node_modules`, `dist`, `.git`, `.next`, `build`, etc.
- **Archivos binarios**: `.exe`, `.bin`, imágenes, audio, vídeo, fuentes, comprimidos.
- **Tamaño máximo**: 10 MB por fichero.
- **Bash whitelist**: solo `ls`, `dir`, `find`, `grep`, `cat`, `type`, `wc`, `head`, `tail`, `file`, `echo`, `pwd`.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readFile(projectPath, filePath)` | Lee fichero. Devuelve `{ path, content, size, hash, language, modified }` |
| `writeFile(projectPath, filePath, content)` | Escribe con backup automático. Devuelve `{ saved, path, hash, backupPath }` |
| `listFiles(projectPath, pattern?)` | Recorre el proyecto (máx. profundidad 5). Máx. 500 resultados |
| `bashCommand(projectPath, command)` | Ejecuta comando de la whitelist. Timeout 30 s |
| `grepFiles(projectPath, pattern, glob?)` | Búsqueda regex. Máx. 300 coincidencias |

---

## 10. Subsistema CLI (`subsystem-cli.js`)

Emula la interfaz de herramientas de Claude Code para proveedores sin acceso nativo al filesystem. Implementa un loop multi-turno en el que la IA solicita operaciones de archivo y el subsistema las ejecuta.

### Formato de tool calls

```
TOOL: read
PATH: src/main.ts
---
TOOL: write
PATH: src/utils.ts
CONTENT:
[contenido]
---
TOOL: bash
COMMAND: find src -name "*.ts"
---
TOOL: grep
PATTERN: export const
FILE: src/**/*.ts
```

### Loop multi-turno

```
execute(prompt, systemPrompt, config)
  │
  ├── while (turn < maxTurns):
  │   ├── calcular tiempo restante → si agotado, break
  │   ├── callAIRaw(messages, systemPrompt, { timeout: remaining })
  │   ├── parseAgentResponse() ← extraer tool calls
  │   ├── si no hay tool calls → completedNormally=true, break
  │   ├── para cada tool call → executeToolCall()
  │   └── buildToolResultsMessage() → añadir a messages
  └── RETORNAR SubsystemCLIResult
```

---

## 11. Orquestaciones — CRUD (`workflows.js`)

Gestiona la persistencia de las definiciones de orquestación en `{projectPath}/.agent-hub/orchestrations/{id}.json`.

**Migración automática de formato lineal → DAG:** `migrateOrchestration(raw)` detecta orquestaciones en formato antiguo (`agents: string[]` + `nodes: OrchestrateNode[]`) y las convierte al nuevo modelo DAG en el momento de lectura (no modifica el JSON en disco hasta el próximo guardado). La migración:
- Por cada `agents[i]`: crea `OrchestrationNode` con `id = "node-i"`, `agentName = agents[i]`, `dependsOn = i === 0 ? [] : ["node-(i-1)"]`.
- El `inputNode` antiguo (Orquestador → Agent[0]) mapea sus `dataFlow`/`contextExtra` al nodo raíz.
- Las conexiones `nodes[i]` pasan a ser `dataFlow`/`contextExtra`/`gateAfter`/`scriptParams` del nodo destino.

`migrateOrchestration` se aplica en `read()`, `list()` y `create()` (si el payload viene en formato antiguo). Es transparente para el motor.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `create(projectId, projectPath, data)` | Genera id y escribe el JSON |
| `read(orchId, projectPath)` | Lee JSON por id |
| `update(orchId, projectPath, changes)` | Merge + actualiza `updatedAt` |
| `remove(orchId, projectPath)` | Elimina el fichero JSON |
| `list(projectId, projectPath)` | Lista todos los JSONs del directorio |
| `listExecutions(orchId, projectPath)` | Lista el historial de ejecuciones |
| `readExecution(orchId, executionId, projectPath)` | Lee el `result.json` de una ejecución |
| `saveExecution(orchId, projectPath, result)` | Escribe resultado y actualiza contadores |

---

## 12. Orquestaciones — Motor de ejecución (`orchestrator.js`)

Implementa la ejecución **DAG** de una orquestación: los nodos sin dependencias entre sí se ejecutan en paralelo usando `Promise.allSettled`. Extiende `EventEmitter` para emitir eventos de progreso vía SSE.

### Modelo de ejecución DAG

El motor calcula los **niveles topológicos** del grafo al inicio. Cada nivel es un conjunto de nodos que pueden ejecutarse en paralelo porque sus dependencias ya han completado. El algoritmo:

```
1. Filtrar nodos flotantes (isRoot === false)
2. Calcular niveles topológicos (BFS desde nodos raíz)
3. Para cada nivel:
   a. Promise.allSettled([ejecutarNodo(n) for n in nivel])
   b. Cada nodo corre de forma independiente (tokensUsed, cost, handoff propios)
4. Si algún nodo falla y stopOnError=true → abortar niveles siguientes
```

Los handoffs de un nivel anterior se agregan (merged) para los nodos del siguiente nivel que los consuman.

### Nodos flotantes

Un nodo con `isRoot: false` y `dependsOn: []` es un **nodo flotante** — existe en el JSON de la orquestación pero no forma parte del flujo de ejecución. El motor los filtra antes de calcular los niveles topológicos. La validación (`POST /orchestrations/:id/validate`) los detecta y devuelve un error por cada nodo flotante encontrado: `"El nodo X está sin conectar"`.

Un nodo se convierte en raíz real cuando el usuario conecta el port-out del nodo Orquestador a ese nodo en el canvas (lo que establece `isRoot: true`). La desconexión del Orquestador vuelve a poner `isRoot: false`.

### Eventos emitidos

| Evento | Payload |
|---|---|
| `step-start` | `{ stepIndex, agentName, nodeId, totalSteps }` |
| `step-input` | `{ stepIndex, agentName, nodeId, userMessage }` |
| `step-done` | `{ stepIndex, result: StepResult }` — `StepResult.nodeId` identifica el nodo |
| `step-warning` | `{ stepIndex, nodeId, issues }` |
| `gate-open` | `{ stepIndex, agentName, nodeId, executionId }` — gate HITL activo |
| `browser-required` | `{ stepIndex, agentName, executionId }` |
| `browser-continued` | `{ executionId }` |
| `complete` | `ExecutionResult` |
| `cancelled` | `{ executionId, reason?, data? }` — `reason='budget_exceeded'` si aplica |
| `error` | `{ message }` |
| `log` | `{ timestamp, level, message, data? }` — persiste en `logs.jsonl` |

### Protocolo HANDOFF

Cada agente no-final recibe la instrucción de terminar con:

```
HANDOFF: {"done":"...","changed":["ruta"],"issues":["..."],"next":"..."}
```

`extractHandoff(response)` extrae y parsea. `stripHandoff(response)` lo elimina del texto visible en la UI.

### Construcción del prompt del paso

- **Paso 0**: contextos temporales del nodo de entrada + tarea fija. Incluye `CLAUDE.md` si `dataFlow.projectContext !== false`.
- **Pasos i > 0**: handoff del agente anterior + archivos modificados + contextos temporales del nodo.
- **Skills de agente**: si el agente tiene `skills[]` en su frontmatter, su contenido se concatena al system prompt antes de la llamada.
- **Límite**: `maxContextChars` (defecto 4 000) trunca el mensaje de usuario si supera el límite.

### Timeout global

El `timeout` de `executionConfig` aplica a **toda la orquestación**. El tiempo restante se pasa a cada paso. **El tiempo de espera en gates HITL no descuenta del reloj global** — el `startTime` se incrementa con la duración de la pausa.

### Scripts determinísticos

Si `agentName` comienza por `__script:`, el paso se delega a `scripts-registry.js` en lugar de llamar a la IA. Los scripts son sincrónicos, no consumen tokens y siempre producen un `StepResult` con `tokensUsed: { input: 0, output: 0 }`. Ver §12b.

### Quality Score automático

Tras completar cada paso IA, el orquestador ejecuta el script `quality-score` y adjunta el resultado a `stepResult.qualityScore`. No es bloqueante — un error al calcularlo no falla el paso.

### Gates HITL (`gateAfter`)

Si `orchestration.nodes[i].gateAfter === true` y no es el último paso:
1. Se escribe el estado `paused_gate` en `execution-state.json`.
2. Se emite `gate-open`.
3. La ejecución se bloquea en `_waitForGate(executionId, stepIndex)` hasta que el servidor recibe `POST /executions/:execId/gate`.
4. Decisiones: `approve` → continúa, `revise` → revierte al snapshot y re-ejecuta el paso con feedback, `cancel` → rompe el loop.

### Reanudación de ejecuciones

`_resumeFromStep` se establece antes de llamar a `execute()`. Los pasos `i < _resumeFromStep` se restauran desde `_executionState.steps[i]` sin llamar a la IA. La ejecución continúa normalmente desde el punto de interrupción.

### Ejecución CLI vs. API/GitHub

- **CLI nativo** (`cli`, `gemini-cli`, `aider-cli`…): `callAIRich` con `cwd` del proyecto y timeout restante.
- **API/GitHub/Custom**: `callAIWithSubsystemCLI` con loop multi-turno.
- Si el agente usa herramientas `browser_*`: el CLI nativo lanza el navegador CDP automáticamente; el subsistema CLI inyecta las cookies y el contenido de la página activa en el prompt.

---

## 12b. Scripts determinísticos (`scripts-registry.js`)

Módulo de scripts Node.js sin llamadas a IA para usar como pasos en orquestaciones. Incluye scripts **built-in** (empaquetados con la app) y **scripts externos** (archivos `.js` en `APP_DIR/user-scripts/` creados por el usuario).

### Contrato de un script (built-in y externo)

```js
async function script({ projectPath, orchestration, stepIndex, prevResult, agentOutputs, fs, path }) {
  return { output: string, filesModified: string[], data: any };
}
```

Los scripts externos se ejecutan dentro de un sandbox `node:vm` (ver §12b.1).

### Scripts built-in incluidos

| Nombre | Descripción |
|---|---|
| `prepare-context` | Analiza el proyecto (lenguaje, framework, tests, convenciones). Guarda `canonical.json` en `.agent-hub/context/`. |
| `generate-file-index` | Lista todos los archivos del proyecto con tamaño, extensión y fecha. Devuelve JSON estructurado. |
| `diff-since-step` | Compara el filesystem actual con los archivos modificados en un paso de referencia. |
| `validate-json` | Verifica que el output del paso anterior es JSON válido. Devuelve `{ valid, error? }`. |
| `quality-score` | Calcula puntuación 0–100 del paso anterior: respuesta producida, JSON válido, archivos modificados, longitud. Grade: verde ≥75, ámbar ≥50, rojo <50. |
| `validate-output` | Valida el output según reglas configurables. Devuelve `{ passed, issues[] }`. |
| `budget-guard` | **Requiere `maxBudgetUSD` (param obligatorio).** Suma el `estimatedCost` de todos los pasos anteriores y lanza `budget_exceeded` si el total supera el límite. El orquestador emite `cancelled` con razón `budget_exceeded` y detiene la ejecución limpiamente. |

### 12b.1 Scripts externos

Los scripts externos son archivos `.js` CommonJS en `APP_DIR/user-scripts/`. Se cargan bajo demanda en cada llamada a `GET /api/scripts` (recarga en caliente sin reiniciar).

**Contrato del fichero externo:**

```js
exports.label       = 'Nombre en UI';        // requerido
exports.description = 'Descripción breve';   // requerido
exports.timeout     = 120_000;               // opcional — override de timeout (máx. 300 000 ms)

exports.run = async (context) => {
  const { projectPath, prevResult, agentOutputs, fs, path } = context;
  return { output: 'resultado', filesModified: [], data: {} };
};
```

**API `fs` disponible en el sandbox:**

| Operación | Descripción |
|---|---|
| `fs.readFile(relPath)` | Lee fichero como string UTF-8 |
| `fs.writeFile(relPath, data)` | Escribe (crea directorios intermedios) |
| `fs.exists(relPath)` | `→ Promise<boolean>` |
| `fs.listDir(relPath)` | `→ Promise<string[]>` |
| `fs.readJSON(relPath)` | `→ Promise<object>` |
| `fs.writeJSON(relPath, data)` | Escribe JSON pretty-print |

Todas las rutas son relativas a `projectPath`. Las rutas con `..` que escapan del proyecto lanzan `Error: ruta fuera del proyecto`.

**Prioridad de nombres:** un script externo con el mismo nombre que un built-in es ignorado. `GET /api/scripts` devuelve el conflicto en el campo `warnings[]`.

**Timeout:** se resuelve de más específico a más general: `exports.timeout` del script → `config.externalScriptsTimeoutMs` (default 60 000 ms). Máximo absoluto: 300 000 ms.

### API pública

| Función | Descripción |
|---|---|
| `isScript(agentName)` | `true` si `agentName` empieza por `__script:` |
| `getScriptName(agentName)` | Extrae el nombre del script del identificador |
| `hasScript(name)` | `true` si el script está registrado (built-in o externo) |
| `run(name, context)` | Ejecuta el script (built-in directo; externo en sandbox) |
| `listScripts()` | Devuelve `{ scripts: [...], warnings: [] }` con todos los scripts y campo `builtin` |
| `loadExternalScripts()` | Recarga scripts externos desde disco; devuelve `{ loaded, errors, warnings }` |
| `validateExternalScripts()` | Valida estáticamente todos los ficheros externos; devuelve informe completo |

---

## 12c. Git Checkpointer (`git-checkpointer.js`)

Realiza commits automáticos tras cada paso completado cuando `project.gitEnabled === true` y el directorio es un repositorio git.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `isGitRepo(projectPath)` | `true` si existe `.git/` en el directorio |
| `checkpoint(projectPath, message)` | `git add -A` + `git commit --author="AgentHub <agenthub@local>"`. Devuelve el SHA del commit o `null` si no había cambios. |
| `rollbackToSha(projectPath, sha)` | `git reset --hard {sha}` — restaura el estado exacto de ese commit |

### Integración en el orquestador

- Tras cada paso exitoso: `checkpoint(project.path, "[orchName] paso N/M: agentName")` → el SHA se guarda en `stepResult.gitCommitSha`.
- En rollback: si `stepResult.gitCommitSha` existe, se usa `rollbackToSha` en lugar del snapshot JSON.

---

## 12d. Ops Ledger (`ops-ledger.js`)

Registro append-only de operaciones atómicas (modificaciones de fichero) por orquestación. Persiste en `{projectPath}/.agent-hub/ops/{orchId}-ledger.json`.

### Estructura de una entrada

```json
{
  "id": "op-a1b2c3d4",
  "executionId": "exec-...",
  "orchestrationId": "orch-...",
  "stepIndex": 1,
  "agentName": "refactor-expert",
  "kind": "modify",
  "filePath": "src/utils.ts",
  "status": "applied",
  "createdAt": "2026-06-03T10:00:00Z"
}
```

`status` puede ser `applied` o `reverted` (con campo `revertedAt` adicional).

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readLedger(projectPath, orchId)` | Lee el ledger completo; devuelve `{ ops: [] }` si no existe |
| `appendOps(projectPath, orchId, newOps[])` | Añade operaciones al ledger de forma atómica (tmp → rename) |
| `markOpReverted(projectPath, orchId, opId)` | Cambia el `status` de una op a `reverted` y registra `revertedAt` |

---

## 13. Bandeja del sistema (`tray.js`)

Icono en la bandeja de Windows. Click izquierdo muestra la ventana; click derecho abre menú con "Abrir", "Reiniciar" y "Salir". `destroyTray()` se llama desde `app.on('before-quit')`.

---

## 13b. Automatización de navegador vía CDP (`browser.js`)

Gestiona la conexión Playwright a un navegador con `--remote-debugging-port` activo.

### Navegadores soportados

| Clave | Motor |
|---|---|
| `chrome` | Chromium (CDP completo) |
| `edge` | Chromium (CDP completo) |
| `brave` | Chromium (CDP completo) |
| `firefox` | Protocolo propio (parcial) |

### Funciones exportadas

| Función | Descripción |
|---|---|
| `getBrowserStatus()` | Snapshot del estado en memoria |
| `getInstalledBrowsers()` | Lista navegadores encontrados en el sistema |
| `connectCdp(port?, browserKey?)` | Conecta Playwright al puerto CDP |
| `disconnectCdp()` | Cierra la conexión (navegador sigue abierto) |
| `launchBrowserWithCdp(browserKey, port?)` | Lanza navegador con perfil dedicado y puerto CDP |
| `getBrowserTabs()` | Lista pestañas abiertas |
| `getActivePage()` | Devuelve `_page` o lanza error |
| `browserGet(url, selector?, format?)` | Navega y extrae texto/HTML |
| `browserAction(action, selector?, value?, script?)` | Interactúa con el DOM |
| `browserScreenshot(selector?)` | Captura de pantalla (base64 PNG) |

---

## 14. Bridge IPC (`preload.js`)

`contextBridge.exposeInMainWorld('api', {...})` expone `window.api` al renderer.

```ts
window.api = {
  getVersion()             → Promise<string>
  getAppDir()              → Promise<string>
  isDev()                  → Promise<boolean>
  minimize()               → void
  hide()                   → void
  openPath(p)              → void
  openExternal(url)        → void
  openVSCode(p)            → Promise<{ ok: boolean; error?: string }>
  pickFolder()             → Promise<string | null>
  pickFile()               → Promise<string | null>
  onCloseRequested(cb)     → void
  closeResponse(action, remember) → void
  checkForUpdate()         → Promise<any>
  downloadUpdate()         → Promise<any>
  installUpdate()          → void
  onUpdateAvailable(cb)    → void
  onUpdateProgress(cb)     → void
  onUpdateReady(cb)        → void
  onUpdateError(cb)        → void
}
```

---

## 15. Agentes por defecto (`defaults.js`)

`DEFAULT_AGENTS` está vacío. Los agentes provienen del Directorio de Agentes externo descargado en el arranque. El fichero se conserva para no romper la importación en `agents.js`.

---

## 16. Plantillas de contexto (`templates.js`)

Genera el contenido inicial de `CLAUDE.md` al crear un proyecto. Sin plantillas específicas por tecnología (el stack se documenta en el contexto del proyecto y en las skills).

---

## 17. Flujos clave end-to-end

### Primer arranque con Directorio de Agentes

```
main.js: app.whenReady()
  │
  ├── bootstrapDirectories()  ← crea agents/global/, agents/skills/, etc.
  ├── startServer()           ← Express levantado
  ├── createWindow()          ← ventana visible
  └── agentsSync.triggerSync(url, isFirst=true)
        ├── fetchHeadSHA()
        ├── fetchTree()
        └── para cada .md:
            ├── si skills/ → escribe en agents/skills/
            ├── si global|section → escribe en agents/{nivel}/
            └── resto → agents/uncategorized/

  Renderer: GET /api/agents-directory/status → { firstSync: true, syncing: true }
    └── overlay de progreso → polling 600ms → recarga al terminar
```

### Crear un proyecto nuevo

```
Frontend: POST /api/projects { name, categoryId, skills, aiProviders }
  │
  server.js → projects.createProject(data)
    ├── makeProjectId()
    ├── fs.mkdirSync(path, recursive)
    ├── escribe CONTEXTO.md y replica a CLAUDE.md, etc.
    ├── syncProject(id)
    │   └── getApplicableAgents(categoryId)  → global + section
    │       para cada agente → adapta y guarda en {project}/
    └── writeConfig(cfg con nuevo proyecto)
  ← { project }
```

### Ejecución de agente con skills inyectadas

```
POST /api/projects/:id/execute-task { agent }
  │
  server.js:
    ├── getContextAuto() → leer contexto
    ├── cargar project.skills[] → leer contenido de cada .md de skills
    ├── buildSystemPrompt = agent.system + skillsBlock + contextContent
    └── callAIChat([{ role:'user', content: task }], systemPrompt, opts)
  ← { result, task, durationMs }
```

---

## 18. Dashboard y seguimiento de uso

### Dashboard (`GET /api/dashboard`)

`buildDashboardNotifications(cfg)` genera `DashboardNotification[]`:

**Para cada agente:**
- **Optimization**: sin herramientas configuradas (`tools: []`).
- **Optimization**: prompt no optimizado con IA.

**Para cada proyecto activo:**
- **Critical**: sin `CLAUDE.md` o `copilot-instructions.md`.
- **Optimization**: fichero de contexto < 80 caracteres.
- **Optimization**: agentes pendientes de sync.

### Notificaciones — dismiss vs. snooze

- `dismissedDashboardNotifications: string[]` — descartados permanentemente.
- `snoozedDashboardNotifications: Record<string, string>` — aplazados con fecha de expiración.

### Salud de proyectos (`buildProjectHealth`)

| Estado | Condición |
|---|---|
| `healthy` | Sin incidencias detectadas |
| `warning` | Sync desactualizado, contexto delgado, o agentes sin herramientas |
| `critical` | Ruta no encontrada, contexto ausente, o agentes corruptos |

### Seguimiento de uso (`ai.js`)

Fichero de persistencia: `cache/ai-usage.json`. Solo `cumulative` se persiste; `session` vive en memoria.
