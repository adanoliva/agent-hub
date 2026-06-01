# Documentación técnica — Backend (`src/backend/`)

> Stack: Electron main process + Express 4 en `localhost:3737`
> Última actualización: 2026-06-01 · Versión: 1.9.4

---

## Índice

1. [Visión general](#1-visión-general)
2. [Arranque y ciclo de vida (`main.js`)](#2-arranque-y-ciclo-de-vida-mainjs)
3. [Configuración (`config.js`)](#3-configuración-configjs)
4. [API REST (`server.js`)](#4-api-rest-serverjs)
5. [Gestión de agentes (`agents.js`)](#5-gestión-de-agentes-agentsjs)
6. [Sincronización del directorio de agentes (`agents-sync.js`)](#6-sincronización-del-directorio-de-agentes-agents-syncjs)
7. [Gestión de proyectos (`projects.js`)](#7-gestión-de-proyectos-projectsjs)
8. [Integración IA (`ai.js`)](#8-integración-ia-aijs)
8b. [Prompts centralizados (`prompts.js`)](#8b-prompts-centralizados-promptsjs)
9. [Servicio de filesystem (`api-fs.js`)](#9-servicio-de-filesystem-api-fsjs)
10. [Subsistema CLI (`subsystem-cli.js`)](#10-subsistema-cli-subsystem-clijs)
11. [Orquestaciones — CRUD (`workflows.js`)](#11-orquestaciones--crud-workflowsjs)
12. [Orquestaciones — Motor de ejecución (`orchestrator.js`)](#12-orquestaciones--motor-de-ejecución-orchestratorjs)
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
  ├── projects.js      ← CRUD de proyectos, sync de agentes a proyectos
  ├── ai.js            ← llamadas a IA (CLI / Anthropic API / GitHub)
  ├── api-fs.js        ← operaciones de filesystem para el Subsistema CLI
  ├── subsystem-cli.js ← CLI virtual multi-turno para providers API/GitHub
  ├── prompts.js       ← prompts centralizados para todas las operaciones IA
  ├── workflows.js     ← CRUD de orquestaciones (JSON en .agent-hub/)
  ├── orchestrator.js  ← motor de ejecución de orquestaciones + SSE streaming
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

**Nota sobre el sync del directorio:** a diferencia del arranque anterior (que bloqueaba con `seedDefaultAgents`), la sincronización es completamente asíncrona. El servidor ya está levantado y la ventana visible cuando el sync comienza. El renderer detecta si está en curso consultando `GET /api/agents-directory/status` y muestra un overlay de progreso si es el primer arranque.

`isFirstSync = !agentsSync.metaExists()` — es `true` si no existe aún `cache/agents-meta.json`. En ese caso el renderer muestra el overlay de descarga.

### BrowserWindow

```js
new BrowserWindow({
  width: 1280, height: 800,
  minWidth: 900, minHeight: 600,
  backgroundColor: '#0d0d0f',   // evita flash blanco al arrancar
  frame: true,
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,      // el renderer no puede usar require()
    contextIsolation: true,      // el renderer vive en un contexto aislado
    preload: 'preload.js',       // único puente al main process
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

Solo activo en producción. Comprueba actualizaciones en el repo privado `adanoliva/cdm` usando un token de solo lectura. La descarga e instalación las dispara el renderer a través de los handlers IPC `update:check`, `update:download`, `update:install`.

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
| `dialog:pickFile` | `dialog.showOpenDialog({ openFile })` — selector de fichero individual |
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
| `CACHE_DIR` | `APP_DIR/cache/` |

### Estructura de `config.json`

```json
{
  "version": "1.8.2",
  "aiProvider": "cli",
  "apiKey": "",
  "githubToken": "",
  "githubModel": "gpt-4o-mini",
  "closeAction": "ask",
  "agentsDirectoryUrl": "https://github.com/adanoliva/agents-directory",
  "agentsDirectoryEnabled": true,
  "categories": [
    {
      "id": "web",
      "name": "Web",
      "icon": "ti-world",
      "color": "#3b82f6",
      "technologies": [
        { "id": "react", "name": "React" }
      ]
    }
  ],
  "projects": [...]
}
```

Los campos `agentsDirectoryUrl` y `agentsDirectoryEnabled` se fusionan automáticamente desde `DEFAULT_CONFIG` si no están presentes en el JSON guardado (el merge se hace con spread en `readConfig()`).

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readConfig()` | Lee y parsea `config.json`; si no existe, devuelve `DEFAULT_CONFIG` |
| `writeConfig(cfg)` | Serializa y escribe `config.json` |
| `getAgentDir(level, catId, techId)` | Calcula la ruta de carpeta de agentes según nivel |
| `bootstrapDirectories(cfg)` | Crea `agents/global/`, `agents/section-*`, `agents/tech-*`, `agents/uncategorized/` y `cache/` si no existen |
| `ensureDir(p)` | `fs.mkdirSync(p, { recursive: true })` |

### `getAgentDir` — lógica de nivel

```js
level === 'global'        → agents/global/
level === 'section'       → agents/section-{catId}/
level === 'tech'          → agents/tech-{catId}-{techId}/
level === 'uncategorized' → agents/uncategorized/
```

---

## 4. API REST (`server.js`)

Express corre en el puerto `3737` (constante `PORT`). Todos los endpoints tienen el prefijo `/api`.

### Tabla completa de endpoints

#### Health y configuración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | `{ status: 'ok', port }` |
| GET | `/api/config` | Config completa |
| PUT | `/api/config` | Actualiza campos: `aiProvider`, `apiKey`, `githubToken`, `githubModel`, `closeAction`, `agentsDirectoryUrl`, `agentsDirectoryEnabled` |
| GET | `/api/detect-cli` | `{ found: bool, path? }` — busca `claude` en PATH |
| POST | `/api/setup` | Wizard: guarda proveedor + credenciales y dispara sync del directorio |

#### Categorías

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/categories` | Array de categorías con technologies |
| POST | `/api/categories` | Crea categoría `{ id, name, icon, color, technologies: [] }` |
| PUT | `/api/categories/:id` | Actualiza nombre, icono, color |
| DELETE | `/api/categories/:id` | Elimina categoría |
| POST | `/api/categories/:catId/technologies` | Añade `{ id, name }` a una categoría |
| DELETE | `/api/categories/:catId/technologies/:techId` | Elimina tecnología |

#### Directorio de Agentes

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/agents-directory/status` | Estado del sync: `{ enabled, url, syncing, firstSync, progress, lastSync, agentCount, pendingConflicts, lastResult }` |
| POST | `/api/agents-directory/sync` | Dispara una sincronización manual (no bloqueante) |
| POST | `/api/agents-directory/resolve-conflict` | Resuelve un conflicto: `{ fileKey, action: 'keep'\|'update' }` |

#### Agentes (niveles 1–3 + Sin categoría)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/agents?level=&categoryId=&techId=` | Lista agentes de un nivel (incluye `level=uncategorized`) |
| GET | `/api/agents/flat` | Todos los agentes de todos los niveles incluido `uncategorized` (para @mention y detección de herramientas) |
| GET | `/api/agents/applicable?projectId=` | Global + section + tech aplicables al proyecto |
| POST | `/api/agents` | Crea agente `{ level, categoryId?, techId?, agent }` |
| PUT | `/api/agents` | Actualiza agente existente (mismo payload) |
| DELETE | `/api/agents?level=&name=&categoryId=&techId=` | Elimina fichero .md |
| POST | `/api/agents/import-url` | Descarga .md desde URL y parsea `{ agent }` |

#### Agentes de proyecto (nivel 4)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects/:id/agents` | Lista agentes del proyecto (`.claude/agents/` o `.github/agents/`) |
| POST | `/api/projects/:id/agents` | Crea agente local al proyecto |
| PUT | `/api/projects/:id/agents/:name` | Actualiza agente local |
| DELETE | `/api/projects/:id/agents/:name` | Elimina fichero .md del proyecto |

#### Proyectos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects` | Array de proyectos con `pendingUpdates` y `pathExists` |
| POST | `/api/projects` | Crea proyecto nuevo (carpeta + templates + sync) |
| POST | `/api/projects/import` | Importa proyecto existente en disco |
| PUT | `/api/projects/:id` | Edita metadata; migra provider si cambia `aiProvider` |
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
| GET | `/api/projects/:id/context?type=claude\|github\|auto` | Contenido de CLAUDE.md o copilot-instructions.md. `type=auto` detecta el proveedor y devuelve `ProjectContextInfo` completo (mismatch, isEmpty, isDefault, sizeBytes…) |
| PUT | `/api/projects/:id/context` | Guarda el fichero de contexto |
| POST | `/api/projects/:id/generate-context?type=` | Genera con IA analizando el directorio del proyecto |
| POST | `/api/projects/:id/execute-task` | Ejecuta un agente sobre el proyecto. Body: `{ agent }`. Devuelve `{ result, task, durationMs }`. Usa `--dangerously-skip-permissions --max-turns 10`, `cwd` del proyecto y timeout de 5 min |

#### Dashboard

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/dashboard` | `DashboardData`: estadísticas, sync, notificaciones, salud de proyectos |
| POST | `/api/dashboard/notifications/dismiss` | Descarta permanentemente una notificación `{ id }` |
| POST | `/api/dashboard/notifications/dismiss-group` | Descarta un grupo de notificaciones |
| POST | `/api/dashboard/notifications/snooze` | Aplaza una notificación N días `{ id, days }` (1-30, por defecto 7) |
| POST | `/api/dashboard/notifications/restore` | Restaura todas las notificaciones ocultas y aplazadas |

`buildDashboardNotifications()` analiza el estado actual y genera `DashboardNotification[]`:
- **Critical**: proyecto sin `CLAUDE.md` (si `needsClaude`) o sin `copilot-instructions.md` (si `needsGithub`)
- **Optimization**: fichero de contexto existe pero tiene menos de 80 caracteres
- **Info**: agentes pendientes de sync, proyectos desactualizados

`buildProjectHealth()` genera para cada proyecto activo un objeto `{ projectId, name, status, pathExists, pendingUpdates, staleSync, contextState, lastSyncAt, issues[] }` donde `status` es `healthy | warning | critical`. Se incluye en la respuesta de `GET /api/dashboard` como `projectHealth[]`.

#### IA

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/ai/status` | `{ provider, ready: bool }` |
| GET | `/api/ai/usage` | `AIUsage`: `{ cumulative, session }` con tokens y coste estimado |
| POST | `/api/ai/usage/reset` | Reinicia contadores de sesión; devuelve `AIUsage` actualizado |
| POST | `/api/ai/usage/reset-all` | Reinicia todo (sesión + acumulado); borra `cache/ai-usage.json` |
| POST | `/api/ai/generate-prompt` | Genera system prompt desde descripción `{ description, level, tools, lang }` |
| POST | `/api/ai/optimize-agent` | Mejora system prompt y description existentes |
| GET | `/api/ai/suggestions?level=&categoryId=&techId=` | 3 sugerencias de agentes (con caché) |
| POST | `/api/ai/suggestions/refresh` | Invalida caché y regenera. Body opcional: `{ alreadySuggested: string[] }` — excluye esos nombres de las nuevas sugerencias para evitar repetición |
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
| POST | `/api/orchestrations` | Crea una orquestación `{ projectId, name, description?, agents?, nodes?, executionConfig? }` |
| GET | `/api/orchestrations/:id` | Lee una orquestación por id (requiere `?projectId=`) |
| PUT | `/api/orchestrations/:id` | Actualiza la orquestación (mismos campos que POST; requiere `?projectId=`) |
| DELETE | `/api/orchestrations/:id` | Elimina la orquestación y su JSON del disco (requiere `?projectId=`) |
| POST | `/api/orchestrations/:id/validate` | Valida la orquestación sin ejecutarla. Devuelve `{ valid, errors[] }` |
| POST | `/api/orchestrations/:id/execute` | Lanza la ejecución. Body: `{ projectId, temporalContextValues? }`. Devuelve `{ executionId, status: 'started' }` |
| GET | `/api/orchestrations/:id/execute/stream?executionId=` | SSE stream de progreso. Emite eventos `step-start`, `step-progress`, `step-complete`, `step-error`, `complete`, `error` |
| GET | `/api/orchestrations/:id/executions` | Lista el historial de ejecuciones de una orquestación (requiere `?projectId=`) |
| GET | `/api/orchestrations/:id/executions/:executionId` | Lee el resultado completo de una ejecución específica |

#### Subsistema CLI (API-FS)

Endpoints bajo el prefijo `/api-fs`. Requieren que el proyecto exista en config. Usan `api-fs.js` internamente. Todos responden con código `500` + `{ error, code }` en caso de fallo.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api-fs/projects/:id/files/read?path=` | Lee un fichero del proyecto. Devuelve `{ path, content, size, hash, language, modified }` |
| GET | `/api-fs/projects/:id/files/list?pattern=` | Lista ficheros del proyecto. `pattern` acepta globs simples (`*.ts`, `src/**`) |
| POST | `/api-fs/projects/:id/files/write` | Escribe fichero. Body: `{ path, content, metadata? }`. Crea backup automático. `422` si validación falla |
| POST | `/api-fs/projects/:id/bash` | Ejecuta comando de la whitelist. Body: `{ command }`. `403` si el comando no está permitido |
| POST | `/api-fs/projects/:id/grep` | Busca patrón en ficheros. Body: `{ pattern, file? }`. Devuelve `{ matches, count }` |
| POST | `/api-fs/projects/:id/execute-agent` | Ejecuta el loop completo del Subsistema CLI. Body: `{ prompt, agentSystemPrompt?, projectContext?, maxTurns?, timeout? }`. Solo para providers `api`/`github` |

### Servido de archivos estáticos

En producción, el catch-all sirve `dist/renderer/index.html` para todas las rutas no-API (compatibilidad con HashRouter).

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
| `tech` | `agents/tech-{catId}-{techId}/` | Proyectos de esa tecnología |
| `uncategorized` | `agents/uncategorized/` | Agentes del directorio sin carpeta estándar |
| `project` | `{projectPath}/.claude/agents/` o `.github/agents/` | Un proyecto concreto |

### Funciones principales

**Parseo y serialización:**
- `parseAgentFile(filePath)` — lee un `.md`, extrae frontmatter YAML y body. Devuelve `{ name, description, model, tools, system, optimized? }`.
- `parseAgentFromString(content, fallbackName)` — misma lógica desde string (usado en import-url).
- `serializeAgent(agent)` — construye el string `.md` con frontmatter + body.
- `hashAgent(agent)` — SHA-256 del string serializado. Usado para detectar si un agente ha cambiado respecto a la copia en el proyecto.

**CRUD niveles 1–3 + uncategorized:**
- `listAgentsByLevel(level, catId, techId)` — lista `.md` de la carpeta correspondiente. Funciona también para `level='uncategorized'`.
- `getApplicableAgents(project)` — combina global + section + tech del proyecto.
- `createAgent(level, catId, techId, agent)` — valida unicidad de nombre y escribe el fichero.
- `updateAgent(level, catId, techId, agent)` — sobreescribe el fichero existente.
- `deleteAgent(level, catId, techId, name)` — elimina el fichero.

**Nivel de proyecto (nivel 4):**
- `listProjectAgents(project)` — lee `.claude/agents/` o `.github/agents/` según `aiProvider`.
- `saveProjectAgent(project, agent)` — escribe en la carpeta del proyecto (formato GitHub si es `github`).
- `deleteProjectAgent(project, name)` — elimina el fichero del proyecto.

**Migración:**
- `migrateAgentFiles()` — detecta agentes en formato antiguo y los convierte al formato actual. Devuelve el número migrado.
- `syncGlobalAgentsToClaudeDir()` — copia todos los agentes globales a `~/.claude/agents/` para que Claude Code los cargue automáticamente. Se llama también después de cada sync del directorio.

### Formato GitHub vs. Claude

Los agentes para proyectos con `aiProvider: 'github'` se guardan en `.github/agents/` con un header simplificado. `saveProjectAgent` detecta el provider del proyecto y adapta el formato automáticamente.

---

## 6. Sincronización del directorio de agentes (`agents-sync.js`)

Este módulo gestiona la descarga y versionado de agentes desde un repositorio GitHub externo (por defecto `https://github.com/adanoliva/agents-directory`).

### Algoritmo de versionado

El versionado se hace por archivo usando **git blob SHA** — el mismo algoritmo que GitHub usa internamente:

```js
function gitBlobSHA(content) {
  const buf    = Buffer.from(content, 'utf8');
  const header = `blob ${buf.length}\0`;
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}
```

Esto permite comparar el SHA devuelto por la GitHub API con el SHA del archivo local sin descargar nada.

### Fichero de estado: `cache/agents-meta.json`

```json
{
  "directoryUrl": "https://github.com/adanoliva/agents-directory",
  "lastSync": "2026-05-23T10:00:00Z",
  "repoCommitSHA": "abc123...",
  "files": {
    "agents/global/doc-writer.md": {
      "remoteSHA": "def456...",
      "localSHA":  "def456...",
      "remotePath": "agents/global/doc-writer.md"
    }
  }
}
```

- `remoteSHA` — git blob SHA del archivo tal como está en el repo remoto en el momento del último sync.
- `localSHA` — git blob SHA del archivo tal como quedó escrito en disco (debería coincidir con `remoteSHA` salvo modificación local).

### Detección de conflictos

Para cada archivo `.md` del árbol remoto:

| Condición | Acción |
|---|---|
| `remoteSHA === meta.remoteSHA` | Sin cambios upstream → saltar |
| `remoteSHA !== meta.remoteSHA` + `diskSHA === meta.localSHA` | Actualización segura → descargar y escribir |
| `remoteSHA !== meta.remoteSHA` + `diskSHA !== meta.localSHA` | **Conflicto** → encolar, dejar en mano del usuario |
| Archivo no existe en disco | Nuevo → descargar y escribir |

### Mapeo de rutas remotas → locales

El repositorio remoto puede organizar los archivos de cualquier forma. La lógica de mapeo reconoce carpetas estándar y clasifica el resto como `uncategorized`:

| Ruta en el repo | Destino local |
|---|---|
| `agents/global/{name}.md` | `agents/global/{name}.md` |
| `global/{name}.md` | `agents/global/{name}.md` |
| `agents/section-{x}/{name}.md` | `agents/section-{x}/{name}.md` |
| `agents/tech-{x}-{y}/{name}.md` | `agents/tech-{x}-{y}/{name}.md` |
| Cualquier otra ruta | `agents/uncategorized/{name}.md` |

### Estado en memoria (para polling del renderer)

```js
const syncState = {
  syncing:          false,   // sync en curso
  firstSync:        false,   // true solo en el primer arranque (sin meta)
  progress:         { done: 0, total: 0, current: '' },
  lastResult:       null,    // resultado del último sync
  pendingConflicts: [],      // conflictos pendientes de resolución
};
```

El renderer consulta `GET /api/agents-directory/status` cada 600ms mientras `syncing: true`.

### Flujo del sync

```
triggerSync(url, isFirst)
  │
  ├── fetchHeadSHA()          ← GET /repos/{owner}/{repo}/commits/HEAD (1 req API)
  │   └── si SHA === meta.repoCommitSHA → upToDate, salir
  │
  ├── fetchTree(sha)          ← GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1 (1 req API)
  │
  └── para cada .md en el árbol:
      ├── comparar SHAs → skip / download / conflict
      ├── downloadRaw()       ← raw.githubusercontent.com (sin rate limit)
      └── writeFile() + actualizar meta
  │
  └── syncGlobalAgentsToClaudeDir()   ← si hubo actualizaciones
```

### Resolución de conflictos

`resolveConflict(fileKey, action, url)`:
- `action: 'keep'` — actualiza `localSHA` en meta al valor actual del disco, para que futuros syncs no lo re-detecten como conflicto.
- `action: 'update'` — descarga el archivo remoto, lo escribe y actualiza el meta.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `metaExists()` | `true` si existe `cache/agents-meta.json` (= no es primer arranque) |
| `readMeta()` | Lee y parsea el meta JSON |
| `getSyncState()` | Snapshot del estado en memoria (para el endpoint de status) |
| `triggerSync(url, isFirst)` | Dispara el sync async; sin-op si ya hay uno en curso |
| `resolveConflict(fileKey, action, url)` | Resuelve un conflicto pendiente |

---

## 7. Gestión de proyectos (`projects.js`)

### Estructura de un proyecto en config.json

```js
{
  id: 'p1234567890abc',
  name: 'Mi Proyecto',
  categoryId: 'web',
  techId: 'react',
  path: 'C:/proyectos/mi-proyecto',
  description: '',
  status: 'active',                   // active | paused | archived
  aiProviders: ['claude', 'github'],  // claude, github, gemini, openai
  selectedAgents: [],
  excludedAgents: [],
  agentHashes: {},                    // { agentName: sha256 }
  createdAt: '2025-01-01T00:00:00.000Z',
}
```

### Sync de agentes

```
syncProject(projectId)
  │
  ├── getApplicableAgents(project)       ← niveles 1, 2, 3
  ├── listProjectAgents(project)         ← nivel 4 (agentes locales)
  ├── para cada proveedor en project.aiProviders:
  │   ├── asegurar directorio de agentes del proveedor
  │   ├── adaptar formato del agente para el proveedor (agent-adapters.js)
  │   └── escribir archivo .md
  ├── actualizar agentHashes con el hash de la fuente original (Claude format)
  └── devuelve { added, updated, skipped }
```

**`getProjectSyncStatus(projectId)`** devuelve el estado por agente sin modificar nada:

| Estado | Significado |
|---|---|
| `ok` | El hash coincide; el agente está actualizado |
| `outdated` | El hash difiere; hay una versión más nueva |
| `new` | El agente no existe aún en el proyecto |
| `local` | El agente existe en el proyecto pero no en los niveles 1–3 |
| `excluded` | El agente está en `excludedAgents` |

### Ciclo de vida de un proyecto

**`createProject(data)`:** genera id, crea carpeta, escribe fichero de contexto, sincroniza agentes, persiste en config.

**`importProject(data)`:** como `createProject` pero la carpeta ya existe.

**`updateProject(id, changes)`:** si `aiProvider` cambia, migra los agentes de nivel 4 al nuevo directorio.

**`deleteProject(id, { deleteFolder })`:** elimina de config. Si `deleteFolder: true`, borra el directorio del disco.
### Ficheros de contexto

| Provider | Ruta | Origen |
|---|---|---|
| **Maestro** | `{path}/CONTEXTO.md` | Editado por el usuario |
| `claude` | `{path}/CLAUDE.md` | Replicado |
| `github` | `{path}/.github/copilot-instructions.md` | Replicado |
| `gemini` | `{path}/GEMINI.md` | Replicado |
| `openai` | `{path}/.instructions.md` | Replicado |

---

## 8. Integración IA (`ai.js`)
**`getContextAuto(project, appAiProvider)`** — detección automática de contexto para la ejecución de agentes:
- Determina el grupo del proyecto (`claude` ↔ `api|cli`, `github` ↔ `github`) y del proveedor global.
- Si los grupos no coinciden, marca `mismatch: true` con `mismatchDetails.message`.
- Lee el fichero de contexto correspondiente y devuelve `{ content, type, label, filePath, mismatch, mismatchDetails, isEmpty, isDefault, sizeBytes, lastUpdated }`.
- `isEmpty` — el fichero no existe.
- `isDefault` — el contenido coincide sustancialmente con la plantilla genérica (menos de 300 chars o solo cabecera).

**`deriveAgentTask(agent)`** — infiere la tarea predefinida de un agente a partir de su nombre y descripción:

| Keyword regex | Tarea derivada |
|---|---|
| `seo\|meta.?tag\|schema.?org\|…` | SEO técnico |
| `review\|revisar\|code.?review` | Code review |
| `test\|spec\|testing` | Plan de tests |
| `doc\|readme\|wiki` | Documentación |
| `\bperf\b\|performance\|rendimiento\|benchmark` | Rendimiento |
| `security\|seguridad\|\bauth\b` | Seguridad |
| `refactor\|clean\|architect` | Refactorización |
| `debug\|\bfix\b\|\bbug\b` | Búsqueda de bugs |
| (fallback) | Tarea principal del agente |

Todas las tareas terminan con `' Implementa los cambios directamente sin pedir confirmación previa.'` para evitar que el agente pause la ejecución solicitando permiso.

---

## 8. Integración IA (`ai.js`)

### Proveedores soportados

| Provider | Config necesaria | Backend |
|---|---|---|
| `cli`... | Claude Code instalado en PATH | Spawn de proceso `claude --print` |
| `api` | `config.apiKey` (Anthropic) | `@anthropic-ai/sdk` |
| `github` | `config.githubToken` | `fetch` a Azure inference endpoint |
| **Nativos** | DeepSeek, Groq, OpenRouter, Perplexity | `fetch` compatible OpenAI |
| **CLIs** | Aider, Cline, Goose | Spawn de proceso nativo |
| **Custom** | Dinámicos (API/CLI) | Soporta Azure, Headers custom y JSON import |

### `callAI(prompt, systemPrompt?)`

Punto de entrada único. Lee `config.aiProvider` y delega a `callCLI`, `callAPI` o `callGitHub`. Cada rama captura el uso de tokens y llama a `trackUsage()`.

### `callCLI(prompt, opts?)`

Acepta un objeto de opciones:
- `opts.extraArgs` — array de argumentos adicionales añadidos al comando `claude --print`. Usado por `execute-task` para pasar `['--dangerously-skip-permissions', '--max-turns', '10']`.
- `opts.cwd` — directorio de trabajo para el proceso spawneado. Usado por `execute-task` para que el agente opere en el directorio del proyecto.
- `opts.timeout` — timeout en ms (por defecto 60 000; `execute-task` pasa 300 000). El mensaje de error incluye el tiempo: `` `timed out after ${Math.round(timeout/1000)}s` ``.

### Chat multi-turno (`callAIChat`)

Para API y GitHub usa mensajes estructurados. Para CLI aplana la conversación en texto plano. También registra tokens en cada llamada.

### Chat con tokens (`callAIChatWithTokens`)

Función interna utilizada por el Subsistema CLI. Igual que `callAIChat` pero devuelve un objeto `{ text, inputTokens, outputTokens }` en lugar del texto plano, permitiendo al loop multi-turno acumular el conteo de tokens por turno. Solo funciona con providers `api` y `github`; lanza error si se invoca con `cli`.

Acepta `opts.timeout` para aplicar un deadline a la llamada individual:
- **`api` (Anthropic SDK)**: se usa un `AbortController` que aborta tras `opts.timeout` ms. Valor por defecto: `CALL_TIMEOUT_MS` (60 s).
- **Providers OpenAI-compat** (`github`, etc.): se pasa a `AbortSignal.timeout()` en el `fetch`.

### Subsistema CLI (`callAIWithSubsystemCLI`)

Punto de entrada público que ejecuta el loop multi-turno completo sobre un proyecto. Delega en `subsystem-cli.execute()`.

```js
callAIWithSubsystemCLI(prompt, agentSystemPrompt, {
  projectPath,      // requerido: ruta absoluta al proyecto
  projectContext,   // contenido de CLAUDE.md / copilot-instructions.md
  provider,         // 'api' | 'github'
  maxTurns,         // default: 10
  timeout,          // ms, default: 300 000
})
// → Promise<SubsystemCLIResult>
```

Devuelve `SubsystemCLIResult`:

```ts
{
  success:       boolean;
  finalResponse: string;       // última respuesta del agente
  turns:         number;
  toolCalls:     ParsedToolCall[];
  results:       OperationResult[];
  errors:        ToolExecutionError[];
  tokens:        { input, output, total };
  duration:      number;       // ms
  filesModified: string[];     // paths relativos modificados
  backups:       string[];     // paths de backups creados en .agent-hub/backups/
  error?:        string;       // 'MAX_TURNS_EXCEEDED' | 'TIMEOUT_EXCEEDED' | mensaje
}
```

### Funciones de generación

Todas delegan la construcción del prompt en `prompts.js` (ver sección 8b). `ai.js` solo aporta la lógica de llamada al proveedor, extracción de tokens y respuesta final.

- `generateAgentPrompt({ description, level, tools, lang })` — genera un system prompt desde descripción informal. Usa `prompts.agentPrompt()`.
- `generateSuggestions({ level, categoryId, techId, existingNames, alreadySuggested? })` — 3 agentes sugeridos en JSON. `alreadySuggested` se fusiona con `existingNames` para garantizar que las sugerencias nuevas no repitan ni lo guardado en disco ni lo ya visible en la UI. Usa `prompts.agentSuggestions()`.
- `generateProjectSuggestions({ project, contextContent, existingNames, alreadySuggested? })` — sugerencias contextualizadas con el CLAUDE.md del proyecto. Mismo patrón de deduplicación. Usa `prompts.projectSuggestions()`.
- `optimizeAgent({ name, description, system, tools, model })` — mejora system prompt y descripción. Devuelve `{ description, system }`. Usa `prompts.optimizeAgent()`.

### Seguimiento de uso de tokens

```js
// Estructuras en memoria + disco
cumulative  // persiste en cache/ai-usage.json entre sesiones
session     // solo en memoria, se reinicia con la app

// API de uso
trackUsage({ inputTokens, outputTokens, costUSD })  // actualiza ambas + guarda cumulative
resetSessionUsage()    // reinicia solo session
resetAllUsage()        // reinicia ambas + borra cache/ai-usage.json
getSessionUsage()      // devuelve { cumulative, session } (tipo AIUsage)
```

**Extracción de tokens por proveedor:**
- `cli` — usa `--output-format json`; extrae `parsed.usage.input_tokens / output_tokens`
- `api` — `message.usage.input_tokens / output_tokens` del SDK de Anthropic
- `github` — `data.usage.prompt_tokens / completion_tokens` (formato OpenAI)

**Coste estimado** (solo para `api`): tabla `ANTHROPIC_PRICING` keyed por model ID completo:

| Modelo | Input $/1M | Output $/1M |
|---|---|---|
| claude-sonnet-4-20250514 | $3 | $15 |
| claude-haiku-4-5-20251001 | $0.25 | $1.25 |
| claude-opus-4-20250514 | $15 | $75 |

### Caché de sugerencias

Fichero `cache/suggestions.json`. Clave de caché:

```js
key = `${level}::${categoryId ?? ''}::${techId ?? ''}`  // niveles 1-3
key = `project::${projectId}`                            // nivel proyecto
```

---

## 8b. Prompts centralizados (`prompts.js`)

Módulo de solo lectura que centraliza todos los prompts que la app envía a la IA. **No expone ningún endpoint HTTP ni IPC** — es un módulo interno requerido por `ai.js`, `server.js` y `orchestrator.js`.

La razón de existir: antes los prompts estaban dispersos como template literals inline en esos tres ficheros. Ahora para ajustar el comportamiento de cualquier botón "Generar con IA" u "Optimizar con IA" basta con editar `prompts.js` y hacer build.

### Funciones exportadas

| Función | Usada por | Descripción |
|---|---|---|
| `agentPrompt({ name, description, level, toolsNote, existingNote, langInstr })` | `ai.js` · `generateAgentPrompt` | Genera el system prompt de un agente desde una descripción informal. Devuelve un JSON con campos `role`, `objective`, `responsibilities`, `boundaries`, `outputFormat` |
| `optimizeAgent({ name, model, toolList, description, system, langTarget })` | `server.js` · `POST /ai/optimize-agent` | Reescribe el system prompt del agente para ser token-eficiente (objetivo: 50-100 palabras). Devuelve `{ description, system }` |
| `agentSuggestions({ context, existing })` | `ai.js` · `generateSuggestions` | Pide 3 sugerencias de agentes para un nivel dado. JSON array con `name`, `description`, `tools`, `model`, `system` |
| `projectSuggestions({ project, contextSection, existing, categoryName, techName })` | `ai.js` · `generateProjectSuggestions` | Igual que `agentSuggestions` pero contextualizado al CLAUDE.md del proyecto |
| `generateContext({ fileLabel, projectInfo, existingContext, structure, dependencies, existingReadme })` | `server.js` · `POST /projects/:id/generate-context` | Dos ramas: si `existingContext` existe → reescribe y reduce a máx. 100 líneas; si no existe → genera desde cero con la misma restricción |
| `adaptForProvider({ agent, targetProvider })` | `ai.js` · `ADAPTATION_PROMPTS` | Reescribe el system prompt del agente para el proveedor destino (actualmente solo `'github'`). Devuelve `null` si el proveedor no requiere adaptación |
| `agentHandoffInstruction()` | `orchestrator.js` · `_buildSystemPrompt` | Devuelve el bloque de texto que se inyecta al final del system prompt de cada agente no-final en una orquestación. Define el protocolo HANDOFF (ver sección 12) |
| `formatHandoffAsInput(handoff, fromAgent)` | `orchestrator.js` · `_buildUserMessage` | Formatea el handoff extraído del paso anterior como mensaje de usuario compacto para el siguiente agente |

### Reglas de diseño de los prompts

- **Sin tutoriales básicos**: los prompts no explican al modelo cómo funciona JSON, markdown, etc.
- **Siempre con restricción de formato**: cada prompt termina con una instrucción de respuesta exacta (solo JSON, sin explicaciones, etc.).
- **Idioma adaptativo**: las funciones que lo necesitan reciben `lang` o `langTarget` para emitir el prompt final en español o inglés según el contexto.
- **Token-eficientes**: los prompts de generación apuntan a respuestas de 40-120 palabras para system prompts de agentes.

---

## 9. Servicio de filesystem (`api-fs.js`)

Encapsula todas las operaciones de I/O que el Subsistema CLI necesita para que los agentes puedan leer, escribir y buscar en el proyecto. Todas las operaciones validan la ruta antes de ejecutarse.

### Seguridad y restricciones

- **Path traversal**: rechaza cualquier ruta que contenga `..`.
- **Fuera de proyecto**: rechaza rutas que no resuelvan dentro de `projectPath`.
- **Directorios excluidos**: `node_modules`, `dist`, `.git`, `.next`, `build`, `__pycache__`, `.venv`, `venv`, `out`, `coverage`, `.svelte-kit`, `target`, `.nuxt`.
- **Archivos binarios**: extensiones `.exe`, `.bin`, `.o`, `.so`, `.dll`, imágenes, audio, vídeo, fuentes, archivos comprimidos.
- **Tamaño máximo**: 10 MB por fichero.
- **Bash whitelist**: solo `ls`, `dir`, `find`, `grep`, `cat`, `type`, `wc`, `head`, `tail`, `file`, `echo`, `pwd`. Además, patrones prohibidos (`rm`, `del`, `sudo`, `npm install`, `git push`, `curl`, `wget`, encadenamiento con `;`, `|`, `&`).

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readFile(projectPath, filePath)` | Lee un fichero de texto. Devuelve `{ path, content, size, hash, language, modified, encoding }` |
| `writeFile(projectPath, filePath, content, metadata?)` | Escribe, crea backup del anterior y valida JSON si aplica. Devuelve `{ saved, path, hash, changes, backupPath, validations }` |
| `listFiles(projectPath, pattern?)` | Recorre el proyecto (máx. profundidad 5) respetando exclusiones. Acepta globs simples (`*.ts`, `src/**`). Máx. 500 resultados |
| `bashCommand(projectPath, command)` | Ejecuta un comando de la whitelist en el directorio del proyecto. Timeout 30 s. Devuelve `{ stdout, stderr, exitCode }` |
| `grepFiles(projectPath, pattern, glob?)` | Búsqueda de patrón regex en los ficheros del proyecto. Máx. 300 coincidencias. Devuelve `{ matches, count }` |

### Backups automáticos

Antes de cada `writeFile` se crea una copia del fichero existente en `{projectPath}/.agent-hub/backups/{nombre}_{timestamp}.bak`. La función devuelve el `backupPath` relativo al proyecto.

---

## 10. Subsistema CLI (`subsystem-cli.js`)

Emula la interfaz de herramientas de Claude Code CLI para proveedores que no tienen acceso nativo al filesystem (Anthropic API, GitHub Models). Implementa un loop multi-turno en el que la IA puede solicitar operaciones de archivo y el subsistema las ejecuta, devolviendo los resultados en el siguiente mensaje.

### Formato de tool calls en las respuestas de la IA

La IA emite bloques separados por `---` (solos en su línea):

```
TOOL: read
PATH: src/main.ts

---

TOOL: write
PATH: src/utils.ts
CONTENT:
[contenido completo del archivo]

---

TOOL: bash
COMMAND: find src -name "*.ts" -type f

---

TOOL: grep
PATTERN: export const
FILE: src/**/*.ts
```

Cuando la IA no emite ningún bloque `TOOL:`, el loop termina y esa respuesta es la final.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `parseAgentResponse(text)` | Extrae bloques `TOOL:` del texto. Devuelve `{ text, toolCalls, hasClosed }` |
| `executeToolCall(toolCall, projectPath)` | Traduce un tool call a una operación `api-fs`. Devuelve `OperationResult` |
| `buildToolResultsMessage(results)` | Formatea los resultados de un turno en texto para el siguiente mensaje al modelo |
| `buildSubsystemSystemPrompt(agentSystemPrompt, projectContext?)` | Inyecta las instrucciones de herramientas al system prompt del agente |
| `execute(prompt, agentSystemPrompt, config)` | Loop multi-turno completo. `config` requiere `projectPath` y `callAIRaw` |

### Loop multi-turno

```
execute(prompt, systemPrompt, config)
  │
  ├── while (turn < maxTurns):
  │   ├── calcular tiempo restante → si agotado, break (completedNormally=false)
  │   ├── callAIRaw(messages, systemPrompt, { timeout: remaining })
  │   ├── parseAgentResponse()                    ← extraer tool calls
  │   ├── si no hay tool calls → completedNormally=true, break
  │   ├── para cada tool call → executeToolCall()  ← operar en disco
  │   ├── buildToolResultsMessage()
  │   └── añadir respuesta IA + resultados a messages
  └── RETORNAR
      success = completedNormally
      error   = 'MAX_TURNS_EXCEEDED' | 'TIMEOUT_EXCEEDED' (solo si !completedNormally)
```

**Garantía de consistencia**: `success: true` solo cuando el loop termina normalmente (sin tool calls pendientes). Si el agente termina su trabajo pero el tiempo total ya expiró, sigue siendo `success: true` — el timeout se evalúa solo al _inicio_ de cada turno, nunca invalida trabajo ya completado.

**Parámetros de `config`:**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `projectPath` | `string` | Requerido. Ruta absoluta al proyecto |
| `callAIRaw` | `Function` | Requerido. `async (messages, systemPrompt, opts?) → { text, inputTokens, outputTokens }`. Recibe `opts.timeout` con el tiempo restante de la orquestación |
| `projectContext` | `string` | Contenido del fichero de contexto del proyecto |
| `maxTurns` | `number` | Máx. iteraciones (default: 10) |
| `timeout` | `number` | Ms totales (default: 300 000) |

### Estructura de directorios generados en el proyecto

```
{projectPath}/
└── .agent-hub/
    └── backups/
        ├── src_main_ts_1748450000000.bak
        └── src_utils_ts_1748450001000.bak
```

---

## 13. Orquestaciones — CRUD (`workflows.js`)

Gestiona la persistencia de las definiciones de orquestación. Cada orquestación se almacena como fichero JSON en:

```
{projectPath}/.agent-hub/orchestrations/{id}.json
```

El historial de ejecuciones se guarda en:

```
{projectPath}/.agent-hub/executions/{timestamp}-{orchId}/
  ├── result.json      ← ExecutionResult completo
  └── snapshot.json    ← snapshot del estado del filesystem antes de ejecutar
```

### Estructura de una orquestación en disco

```json
{
  "id": "orch-1748450000000-a1b2c3d4",
  "projectId": "p1234567890abc",
  "name": "CI Full",
  "description": "",
  "enabled": true,
  "agents": ["code-reviewer", "test-writer", "doc-writer"],
  "nodes": [
    {
      "id": "node-0-1-1748450000001",
      "from": 0, "to": 1,
      "dataFlow": { "agentOutput": true, "filesModified": true, "claudeMd": true, "selectiveFiles": [] },
      "contextExtra": {
        "fixed": { "freeText": "", "files": [] },
        "temporal": []
      }
    }
  ],
  "executionConfig": {
    "stopOnError": true,
    "validateAfterEachStep": false,
    "maxTurns": 10,
    "timeout": 300000
  },
  "createdAt": "2026-05-28T10:00:00Z",
  "updatedAt": "2026-05-28T10:00:00Z",
  "executionCount": 0
}
```

### Funciones exportadas

| Función | Descripción |
|---|---|
| `create(projectId, projectPath, data)` | Genera id, establece defaults y escribe el JSON |
| `read(orchId, projectPath)` | Lee un JSON por id; devuelve `null` si no existe |
| `update(orchId, projectPath, changes)` | Merge de cambios + actualiza `updatedAt` |
| `remove(orchId, projectPath)` | Elimina el fichero JSON |
| `list(projectId, projectPath)` | Lista todos los JSONs del directorio de orquestaciones |
| `listExecutions(orchId, projectPath)` | Lista el historial de ejecuciones (metadatos básicos sin resultados completos) |
| `readExecution(orchId, executionId, projectPath)` | Lee el `result.json` de una ejecución específica |
| `saveExecution(orchId, projectPath, result)` | Escribe `result.json` en el directorio de la ejecución y actualiza el JSON de la orquestación (`lastExecutedAt`, `lastExecutionStatus`, `executionCount`) |

---

## 12. Orquestaciones — Motor de ejecución (`orchestrator.js`)

Implementa la ejecución secuencial de una orquestación, paso a paso. Extiende `EventEmitter` para emitir eventos de progreso que el servidor envía al renderer vía SSE.

### Clase `OrchestrationExecutor`

```js
new OrchestrationExecutor(orchestration, project, temporalContextValues?)
```

- `orchestration` — objeto `Orchestration` completo.
- `project` — objeto `Project` del config.
- `temporalContextValues` — mapa `{ tempContextId: value }` con los valores recogidos del usuario antes de ejecutar.

### Eventos emitidos

| Evento | Payload | Descripción |
|---|---|---|
| `step-start` | `{ stepIndex, agentName, totalSteps }` | Comienza un paso |
| `step-progress` | `{ stepIndex, message }` | Progreso interno (lectura de archivos, etc.) |
| `step-complete` | `{ stepIndex, result: StepResult }` | Paso completado con éxito |
| `step-error` | `{ stepIndex, error }` | Error en un paso |
| `complete` | `ExecutionResult` | Ejecución completa |
| `error` | `{ message }` | Error fatal antes de comenzar |

### Flujo de ejecución

```
executor.execute()
  │
  ├── validate()                            ← comprueba agentes, nodos, paths y ficheros de contexto
  │   └── si hay errores → emite 'error'
  │
  ├── takeSnapshot()                        ← crea snapshot del filesystem para rollback
  │
  └── para cada agente (i = 0..n-1):
      ├── emit 'step-start'
      ├── _buildSystemPrompt(i)             ← system prompt del agente
      ├── _buildUserMessage(i)              ← salida del paso anterior + contexto fijo + temporal
      ├── callAI() / callAIWithSubsystemCLI()
      ├── detecta ficheros modificados
      ├── emit 'step-complete'
      └── si error y stopOnError → romper bucle
  │
  └── emit 'complete' con ExecutionResult
```

### Protocolo HANDOFF entre agentes

Para minimizar los tokens de contexto entre pasos, el orquestador usa un protocolo estructurado de salida. Cada agente no-final recibe al final de su system prompt (inyectado por `prompts.agentHandoffInstruction()`) la instrucción de terminar su respuesta con una línea JSON:

```
HANDOFF: {"done":"<qué lograste, máx 15 palabras>","changed":["<ruta/relativa.ext>"],"issues":["<problema crítico>"],"next":"<instrucción concreta para el siguiente agente, máx 20 palabras>"}
```

**Funciones de soporte en `orchestrator.js`:**

- `extractHandoff(response)` — busca la línea con `/^HANDOFF:\s*(\{.+\})\s*$/m`, parsea el JSON y devuelve `{ done, changed, issues, next }` o `null` si el agente no emitió handoff.
- `stripHandoff(response)` — elimina la línea `HANDOFF:` del texto almacenado para que la UI muestre respuestas limpias sin ruido de protocolo.

**Almacenamiento por paso:** `agentOutputs[i]` guarda `{ response: cleanResponse, handoff, filesModified }`. El `stepResult.output` incluye `{ response: cleanResponse, handoff: handoff || undefined }`.

### Construcción del prompt del paso (`_buildUserMessage`)

- **Paso 0**: incluye los **contextos temporales** definidos en el nodo de entrada (inputs del usuario al lanzar), el texto de la tarea fija si existe, o un mensaje por defecto describiendo el rol del agente.
- **Pasos i > 0**:
  1. **Handoff del agente anterior** — si el agente anterior emitió un `HANDOFF` válido, se formatea con `prompts.formatHandoffAsInput(handoff, fromAgent)`. Resultado: ~4 líneas, ~200 chars. Si no hay handoff (fallback), se pasan los primeros 400 chars del prose en lugar del handoff estructurado.
  2. **Archivos modificados** — si `dataFlow.filesModified === true`, lista de paths (el contenido se lee si el agente lo solicita vía herramientas).
  3. **Contextos temporales** — inputs específicos definidos para esa conexión en el editor.

### Integración con Navegador (CDP)

Si un agente tiene herramientas `browser_*`, el orquestador:
1. Comprueba si hay un navegador con CDP abierto. Si no, intenta lanzar el preferido.
2. **Pausa la ejecución**: emite un evento `browser-required` vía SSE y espera a que el usuario pulse "Continuar" (permitiendo login manual).
3. **Inyecta contexto**: extrae URL, título, cookies de sesión y contenido de la página para inyectarlo en el prompt del agente, permitiéndole usar esas cookies en herramientas como `WebFetch` o comandos `curl`.

El formato del handoff es ~7-10x más compacto que pasar el prose completo del paso anterior (200 chars vs. 1500 chars anteriores).

### Construcción del system prompt (`_buildSystemPrompt`)

Para agentes no-finales (`stepIndex < agents.length - 1`), se añade al final del system prompt el bloque devuelto por `prompts.agentHandoffInstruction()`. El último agente no recibe esta instrucción — su respuesta es la respuesta final de la orquestación.

**Inyección del archivo de contexto del proyecto:**

El contenido de `CLAUDE.md` o `copilot-instructions.md` se añade al system prompt del agente en estas condiciones:

- **Paso 0 (primer agente):** siempre, salvo que `inputNode.dataFlow.projectContext === false`.
- **Pasos 1+ (agentes siguientes):** solo si `dataFlow.projectContext === true` en el nodo que alimenta ese paso. Como el frontend no expone este campo en los nodos inter-agente, en la práctica nunca se inyecta para pasos 2 en adelante — el agente debe leerlo explícitamente desde su system prompt o configurar ficheros de contexto fijo en el nodo.

**Lógica de selección del archivo (`_getContextFile`):**

Usa `project.aiProvider` (formato de contexto del proyecto), no `cfg.aiProvider` (motor de IA de ejecución):

| `project.aiProvider` | Archivo leído |
|---|---|
| `claude` | `CLAUDE.md` / `.claude/CLAUDE.md` |
| `github` | `.github/copilot-instructions.md` |
| `both` | `CLAUDE.md` primero; si no existe, `copilot-instructions.md` |

Sin fallbacks cruzados: si el archivo del formato configurado no existe, devuelve cadena vacía.

### Snapshot y rollback

Antes de ejecutar se crea un snapshot JSON en:
```
{projectPath}/.agent-hub/executions/{timestamp}-{orchId}/snapshot.json
```

El snapshot contiene el contenido de todos los ficheros de texto del proyecto (hasta `MAX_SNAPSHOT_FILES = 500`, máximo `MAX_FILE_SIZE_BYTES = 256 KB` por fichero). Se usa para poder revertir si la ejecución falla.

### Validación previa (`validate`)

Comprueba:
- La orquestación tiene al menos 2 agentes.
- Todos los agentes existen en disco (`agents/global/`, `agents/section-*`, etc.).
- El número de nodos es correcto (`agents.length - 1`).
- Cada nodo tiene índices `from`/`to` consecutivos válidos.
- Cada nodo transmite al menos una información (`agentOutput || filesModified || claudeMd`).
- Los ficheros de contexto fijo existen en disco (rutas absolutas o relativas al proyecto).
- El directorio del proyecto existe.
- `executionConfig.timeout >= 5000`.

### Timeout global de la orquestación

El `timeout` de `executionConfig` se aplica a **toda la orquestación**, no por paso. Antes de cada agente el orquestador calcula `remaining = orchTimeout - elapsed` y lo pasa al paso. Si quedan menos de 5 s antes de empezar un paso, el bucle se corta sin marcar ese paso como error — el `status` final refleja los pasos completados.

Ese `remaining` llega también hasta `callAIRaw` (y por tanto a `callAIChatWithTokens`) para que cada llamada individual al modelo respete el tiempo disponible, en lugar del timeout fijo de 60 s.

### Ejecución con CLI vs. API/GitHub

- **CLI** (`aiProvider: 'cli'`): usa `callAIRich(prompt, { cwd, timeout: remaining, extraArgs })` — proceso nativo de Claude Code; el timeout mata el proceso si supera el tiempo restante.
- **API / GitHub**: usa `callAIWithSubsystemCLI(prompt, systemPrompt, { projectPath, projectContext, provider, maxTurns, timeout: remaining })` — loop multi-turno con el Subsistema CLI. Si el subsystem-cli agota sus turnos pero tiene respuesta parcial (`finalResponse` no vacío), el orquestador registra un warning y usa esa respuesta en vez de fallar el paso.

---

Icono en la bandeja de Windows. Click izquierdo muestra la ventana; click derecho abre menú con "Abrir", "Reiniciar" y "Salir". `destroyTray()` se llama desde `app.on('before-quit')`.

---

## 13b. Automatización de navegador vía CDP (`browser.js`)

Gestiona la conexión Playwright a un navegador con `--remote-debugging-port` activo. Proporciona las operaciones `browser_get`, `browser_action` y `browser_screenshot` que el Subsistema CLI traduce a acciones sobre el DOM.

### Navegadores soportados

| Clave | Nombre | Motor |
|---|---|---|
| `chrome` | Google Chrome | Chromium (CDP completo) |
| `edge` | Microsoft Edge | Chromium (CDP completo) |
| `brave` | Brave Browser | Chromium (CDP completo) |
| `firefox` | Mozilla Firefox | Protocolo propio (parcial) |

`findBrowserExecutable(key)` recorre las rutas estándar de cada navegador y devuelve el primer ejecutable encontrado.

### Estado en memoria

```js
let _browser      = null;   // instancia Playwright Browser
let _page         = null;   // Page activa
let _connected    = false;
let _launchedPid  = null;   // PID del proceso lanzado por launchBrowserWithCdp
```

### Conexión manual (`connectCdp`)

`connectCdp(port?, browserKey?)` usa `playwright.chromium.connectOverCDP('http://localhost:{port}')`. Si la conexión tiene éxito, guarda `_browser` y `_page` y marca `_connected = true`.

### Lanzamiento con perfil CDP dedicado (`launchBrowserWithCdp`)

Para garantizar que el navegador abre con `--remote-debugging-port` activo (Chrome/Edge usan modelo single-instance y ignorarían el flag si ya están corriendo), `launchBrowserWithCdp` usa un perfil de usuario independiente:

```
~/.agent-hub-cdp-profile/   ← perfil separado del navegador personal del usuario
```

Secuencia:

1. Cierra la conexión Playwright existente (`_browser.close()`).
2. Mata el PID anterior lanzado por la app (`_launchedPid`) y espera 800 ms.
3. Lanza el ejecutable con `--remote-debugging-port={port} --user-data-dir=~/.agent-hub-cdp-profile` (más flags para suprimir diálogos de primera vez en Chrome/Edge).
4. Sondea el puerto CDP hasta 10 veces (1 s entre intentos) hasta confirmar que responde.
5. Devuelve `{ launched, exe, pid, warning? }` — si tras 10 s el puerto aún no responde, incluye `warning` pero no lanza error.

Firefox usa `--no-remote --profile` en lugar de `--user-data-dir`.

### Funciones exportadas

| Función | Descripción |
|---|---|
| `getBrowserStatus()` | Snapshot del estado en memoria para `GET /api/browser/status` |
| `getInstalledBrowsers()` | Lista los navegadores encontrados en el sistema |
| `connectCdp(port?, browserKey?)` | Conecta Playwright al puerto CDP indicado |
| `disconnectCdp()` | Cierra la conexión (navegador permanece abierto) |
| `launchBrowserWithCdp(browserKey, port?)` | Lanza navegador con perfil dedicado y puerto CDP |
| `getBrowserTabs()` | Lista pestañas abiertas (título + URL) |
| `getActivePage()` | Devuelve `_page` o lanza error si no hay conexión |
| `browserGet(url, selector?, format?)` | Navega a URL y extrae texto/HTML |
| `browserAction(action, selector?, value?, script?)` | Interactúa con el DOM (click, fill, evaluate…) |
| `browserScreenshot(selector?)` | Captura de pantalla (base64 PNG) |

### Protocolo de herramientas (para `subsystem-cli.js`)

```
TOOL: browser_get
URL: https://example.com/page
[SELECTOR: #content]        ← opcional: esperar elemento
[FORMAT: text|html|both]    ← defecto: text

TOOL: browser_action
ACTION: click|fill|select|hover|screenshot|wait|evaluate
SELECTOR: #btn-submit
[VALUE: "texto"]
[SCRIPT: document.title]    ← solo para evaluate

TOOL: browser_screenshot
[SELECTOR: #panel]          ← opcional: recorte de elemento
```

---

## 14. Bridge IPC (`preload.js`)

`contextBridge.exposeInMainWorld('api', {...})` expone `window.api` al renderer. El renderer **nunca** usa `require` ni accede directamente a Node.

### API expuesta

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
  pickFile()               → Promise<string | null>   // selector de fichero individual
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

`DEFAULT_AGENTS` está vacío (`{}`). Los agentes ya no se seedean desde código: provienen del Directorio de Agentes externo descargado en el arranque. El fichero se conserva para no romper la importación en `agents.js`, pero no define ningún agente.

---

## 16. Plantillas de contexto (`templates.js`)

Genera el contenido inicial de `CLAUDE.md` y `.github/copilot-instructions.md` al crear un proyecto.

### `getTemplate(categoryId, techId, projectName)`

Plantillas específicas por combinación categoría-tecnología:

| Combinación | Stack documentado |
|---|---|
| `games-unity` | Unity 2023 LTS, URP, C# |
| `games-godot` | Godot 4, GDScript |
| `web-react` | React 18, Vite, TypeScript, TailwindCSS, Zustand |
| `web-fullstack` | React + Express + PostgreSQL + Prisma |
| `web-nextjs` | Next.js 14 App Router, Prisma, NextAuth |
| `mobile-react-native` | Expo + Expo Router, Reanimated 3 |
| `mobile-pwa` | Vite + Workbox, Lighthouse 90+ |
| `docs` | Docusaurus 3, MDX |

Si no hay plantilla específica, devuelve una plantilla genérica mínima.

### `getGitHubTemplate(categoryId, techId, projectName)`

Misma lógica adaptada para Copilot: sustituye "Rules" → "Coding standards" y elimina referencias a Claude Code.

---

## 17. Flujos clave end-to-end

### Primer arranque con Directorio de Agentes

```
main.js: app.whenReady()
  │
  ├── bootstrapDirectories()
  ├── migrateAgentFiles()
  ├── startServer()                      ← Express levantado
  ├── createWindow()                     ← ventana visible
  │
  └── agentsSync.triggerSync(url, isFirst=true)  ← async, no bloquea
        │
        ├── fetchHeadSHA()               ← 1 req a GitHub API
        ├── fetchTree()                  ← 1 req a GitHub API
        └── para cada .md:
            └── downloadRaw()            ← raw.githubusercontent.com
                writeFile()

  Renderer: GET /api/agents-directory/status → { firstSync: true, syncing: true }
    └── muestra overlay de progreso
    └── polling cada 600ms
    └── cuando syncing=false → recarga agentes, quita overlay
```

### Sync manual desde Settings

```
Usuario: botón "Sincronizar ahora"
Frontend: POST /api/agents-directory/sync
  │
  server.js → agentsSync.triggerSync(url, false)  ← fire and forget
  ← { ok: true }
  │
  Frontend: polling de GET /api/agents-directory/status cada 600ms
    └── cuando syncing=false → toast con resultado
```

### Resolución de conflictos

```
Sync detecta: remoteSHA cambió + diskSHA ≠ meta.localSHA
  └── conflict encola en syncState.pendingConflicts

Renderer: GET /api/agents-directory/status → pendingConflicts.length > 0
  └── muestra modal de conflicto

Usuario elige:
  ├── "Mantener mi versión"
  │   → POST /resolve-conflict { action: 'keep' }
  │   → meta.localSHA = diskSHA actual (no descarga nada)
  │
  └── "Actualizar desde directorio"
      → POST /resolve-conflict { action: 'update' }
      → downloadRaw() + writeFile() + actualizar meta
```

### Crear un proyecto nuevo

```
Frontend: POST /api/projects { name, categoryId, techId, path, aiProviders }
  │
  server.js → projects.createProject(data)
    ├── makeProjectId()
    ├── fs.mkdirSync(path, recursive)
    ├── escribe CONTEXTO.md y replica a CLAUDE.md, etc.
    ├── syncProject(id)
    │   └── getApplicableAgents(project)  → global + section + tech
    │       para cada agente → adapta para cada p en aiProviders → save
    └── writeConfig(cfg con nuevo proyecto)
  ← { project }
```

### Sync de un agente actualizado

```
Usuario edita agente global en la UI
Frontend: PUT /api/agents { level:'global', agent }
  │
  agents.updateAgent() → sobreescribe agents/global/nombre.md
  │
  Frontend: POST /api/projects/:id/sync
    │
    projects.syncProject(id)
      ├── hashAgent(agente modificado) ≠ project.agentHashes['nombre']
      └── para cada p en aiProviders:
          └── adapta y guarda en {project}/.{p}/agents/nombre.md
  ← { added: 0, updated: 1, skipped: N }
```

### Ejecución directa de un agente sobre un proyecto

```
Frontend: GET /api/projects/:id/context?type=auto
  │
  server.js → projects.getContextAuto(project, cfg.aiProvider)
    ├── detecta grupo del proyecto y del proveedor global
    ├── si grupos difieren → mismatch: true
    ├── lee CONTEXTO.md (o fallback a CLAUDE.md)
    └── devuelve ProjectContextInfo { content, type, label, mismatch, isEmpty, isDefault, sizeBytes }
  ← ProjectContextInfo

Frontend: POST /api/projects/:id/execute-task { agent }
  │
  server.js:
    ├── getContextAuto() → leer contexto
    ├── deriveAgentTask(agent) → inferir tarea predefinida
    ├── buildSystemPrompt = agent.system + '\n\nProyecto: ...\nRuta: ...\n\n' + contextContent
    └── callAIChat([{ role:'user', content: task }], systemPrompt, {
          extraArgs: ['--dangerously-skip-permissions', '--max-turns', '10'],
          cwd: project.path,
          timeout: 300_000
        })
  ← { result: string, task: string, durationMs: number }
```

### Chat con contexto de agentes

```
Frontend: POST /api/chat { messages, systemPrompt }
  │
  ai.callAIChat(messages, systemPrompt)
    ├── 'cli'    → texto aplanado → spawn claude --print
    ├── 'api'    → anthropic.messages.create({ system, messages })
    └── 'github' → fetch Azure inference endpoint
  ← { reply: string }
```

---

## 18. Dashboard y seguimiento de uso

### Dashboard (`GET /api/dashboard`)

`buildDashboardNotifications(cfg)` recorre todos los proyectos activos y todos los agentes para generar oportunidades de mejora:

**Para cada agente:**
- **Optimization**: si no tiene herramientas configuradas (`tools: []`).
- **Optimization**: si el prompt no ha sido optimizado con IA (`!agent.optimized` y `system.length > 30`).

**Para cada proyecto activo:**
- **Critical**: proyecto sin `CLAUDE.md` (si `needsClaude`) o sin `copilot-instructions.md` (si `needsGithub`).
- **Optimization**: fichero de contexto existe pero tiene menos de 80 caracteres.
- **Optimization**: agentes pendientes de sync (si `pendingUpdates > 0`).

### Notificaciones — dismiss vs. snooze

- `dismissedDashboardNotifications: string[]` en `config.json` — lista permanente de ids descartados.
- `snoozedDashboardNotifications: Record<string, string>` en `config.json` — mapa `{ id: isoDate }` con fecha de expiración. Se limpia automáticamente al expirar.
- El endpoint de dashboard filtra las notificaciones aplicando ambas listas. La respuesta incluye `hiddenDismissed` y `hiddenSnoozed` por separado.
- `POST /restore` borra ambos campos (dismissed + snoozed).

### Salud de proyectos (`buildProjectHealth`)

Analiza cada proyecto activo y devuelve un estado resumen:

| Estado | Condición |
|---|---|
| `healthy` | Sin incidencias detectadas |
| `warning` | Sync desactualizado, contexto delgado, o agentes sin herramientas |
| `critical` | Ruta no encontrada, contexto ausente, o agentes corruptos |

Detecta: ruta inexistente, agentes pendientes de sync, sync estancado (> 3 días), estado del fichero de contexto (`ok / thin / missing`), y problemas en los ficheros `.md` del proyecto (frontmatter inválido, herramientas vacías, prompt muy corto).

### Seguimiento de uso (`ai.js`)

Fichero de persistencia: `cache/ai-usage.json`

```json
{
  "inputTokens": 12345,
  "outputTokens": 6789,
  "estimatedCostUSD": 0.1234,
  "calls": 42,
  "since": "2026-05-01T00:00:00Z"
}
```

Solo `cumulative` se persiste; `session` vive en memoria y se pierde al cerrar la app.

**Cambio de proveedor** (`PUT /api/config` con nuevo `aiProvider`): llama `resetAllUsage()` para que los contadores reflejen únicamente el uso del proveedor activo.
