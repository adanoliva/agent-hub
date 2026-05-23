# Documentación técnica — Backend (`src/backend/`)

> Stack: Electron main process + Express 4 en `localhost:3737`
> Última actualización: 2026-05-23

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
9. [Bandeja del sistema (`tray.js`)](#9-bandeja-del-sistema-trayjs)
10. [Bridge IPC (`preload.js`)](#10-bridge-ipc-preloadjs)
11. [Agentes por defecto (`defaults.js`)](#11-agentes-por-defecto-defaultsjs)
12. [Plantillas de contexto (`templates.js`)](#12-plantillas-de-contexto-templatesjs)
13. [Flujos clave end-to-end](#13-flujos-clave-end-to-end)

---

## 1. Visión general

El backend es el proceso principal de Electron (`main process`). Corre en Node.js y tiene acceso completo al sistema de archivos y a las APIs nativas. Expone dos interfaces hacia el renderer:

- **API REST HTTP** en `localhost:3737` (Express). El renderer hace `fetch('/api/...')` y Vite lo proxea en dev.
- **IPC bridge** (`preload.js`). Para operaciones nativas que no pasan por HTTP: abrir carpetas, dialogs de sistema, control de ventana, actualizaciones.

```
Electron main process (Node.js)
  │
  ├── main.js          ← punto de entrada, BrowserWindow, ciclo de vida
  ├── server.js        ← Express: todas las rutas /api/*
  ├── config.js        ← lectura/escritura de config.json
  ├── agents.js        ← CRUD de agentes (.md con frontmatter YAML)
  ├── agents-sync.js   ← sincronización con el Directorio de Agentes (GitHub)
  ├── projects.js      ← CRUD de proyectos, sync de agentes a proyectos
  ├── ai.js            ← llamadas a IA (CLI / Anthropic API / GitHub)
  ├── tray.js          ← icono en la bandeja del sistema
  ├── preload.js       ← contextBridge: window.api expuesto al renderer
  ├── defaults.js      ← vacío (agentes ahora vienen del directorio externo)
  └── templates.js     ← plantillas CLAUDE.md / copilot-instructions.md
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
  "version": "1.5.0",
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
| PUT | `/api/config` | Actualiza campos: `aiProvider`, `apiKey`, `githubToken`, `githubModel`, `theme`, `closeAction`, `agentsDirectoryUrl`, `agentsDirectoryEnabled` |
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
| GET | `/api/agents/flat` | Todos los agentes de todos los niveles (para @mention) |
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
| POST | `/api/projects/:id/sync` | Copia agentes aplicables al proyecto; devuelve `{ added, updated, skipped }` |
| POST | `/api/sync-all` | Sync de todos los proyectos en batch |

#### Contexto del proyecto

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/projects/:id/context?type=claude\|github` | Contenido de CLAUDE.md o copilot-instructions.md |
| PUT | `/api/projects/:id/context` | Guarda el fichero de contexto |
| POST | `/api/projects/:id/generate-context?type=` | Genera con IA analizando el directorio del proyecto |

#### IA

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/ai/status` | `{ provider, ready: bool }` |
| POST | `/api/ai/generate-prompt` | Genera system prompt desde descripción `{ description, level, tools, lang }` |
| POST | `/api/ai/optimize-agent` | Mejora system prompt y description existentes |
| GET | `/api/ai/suggestions?level=&categoryId=&techId=` | 3 sugerencias de agentes (con caché) |
| POST | `/api/ai/suggestions/refresh` | Invalida caché y regenera |
| DELETE | `/api/ai/suggestions/cache` | Limpia toda la caché de sugerencias |
| GET | `/api/ai/project-suggestions?projectId=` | Sugerencias usando CLAUDE.md como contexto |
| POST | `/api/ai/project-suggestions/refresh` | Invalida caché de proyecto |

#### Chat

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/chat` | Conversación multi-turno `{ messages, systemPrompt }` → `{ reply }` |
| GET | `/api/chat/history?projectId=` | Carga historial (`cache/chat-{projectId}.json`) |
| PUT | `/api/chat/history` | Guarda historial `{ projectId, messages }` |
| DELETE | `/api/chat/history?projectId=` | Borra fichero de historial |

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
  aiProvider: 'claude',               // claude | github | both
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
  ├── para cada agente aplicable:
  │   ├── si excluido → saltar
  │   ├── hashAgent(agente) vs project.agentHashes[name]
  │   ├── si igual → 'ok' (sin cambios)
  │   └── si diferente → saveProjectAgent() + actualizar hash
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

| Provider | Ruta | Plantilla |
|---|---|---|
| `claude` | `{path}/CLAUDE.md` | `getTemplate(catId, techId, name)` |
| `github` | `{path}/.github/copilot-instructions.md` | `getGitHubTemplate(catId, techId, name)` |
| `both` | Ambos | Ambas |

---

## 8. Integración IA (`ai.js`)

### Proveedores soportados

| Provider | Config necesaria | Backend |
|---|---|---|
| `cli` | Claude Code instalado en PATH | Spawn de proceso `claude --print` |
| `api` | `config.apiKey` (Anthropic) | `@anthropic-ai/sdk` |
| `github` | `config.githubToken` | `fetch` a Azure inference endpoint |

### `callAI(prompt, systemPrompt?)`

Punto de entrada único. Lee `config.aiProvider` y delega a `callCLI`, `callAPI` o `callGitHub`.

### Chat multi-turno (`callAIChat`)

Para API y GitHub usa mensajes estructurados. Para CLI aplana la conversación en texto plano.

### Funciones de generación

- `generateAgentPrompt({ description, level, tools, lang })` — genera un system prompt desde descripción informal.
- `generateSuggestions({ level, categoryId, techId, existingNames })` — 3 agentes sugeridos en JSON.
- `generateProjectSuggestions({ project, contextContent, existingNames })` — sugerencias contextualizadas con el CLAUDE.md del proyecto.
- `optimizeAgent({ name, description, system, tools, model })` — mejora system prompt y descripción. Devuelve `{ description, system }`.

### Caché de sugerencias

Fichero `cache/suggestions.json`. Clave de caché:

```js
key = `${level}::${categoryId ?? ''}::${techId ?? ''}`  // niveles 1-3
key = `project::${projectId}`                            // nivel proyecto
```

---

## 9. Bandeja del sistema (`tray.js`)

Icono en la bandeja de Windows. Click izquierdo muestra la ventana; click derecho abre menú con "Abrir", "Reiniciar" y "Salir". `destroyTray()` se llama desde `app.on('before-quit')`.

---

## 10. Bridge IPC (`preload.js`)

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

## 11. Agentes por defecto (`defaults.js`)

`DEFAULT_AGENTS` está vacío (`{}`). Los agentes ya no se seedean desde código: provienen del Directorio de Agentes externo descargado en el arranque. El fichero se conserva para no romper la importación en `agents.js`, pero no define ningún agente.

---

## 12. Plantillas de contexto (`templates.js`)

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

## 13. Flujos clave end-to-end

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
Frontend: POST /api/projects { name, categoryId, techId, path, aiProvider }
  │
  server.js → projects.createProject(data)
    ├── makeProjectId()
    ├── fs.mkdirSync(path, recursive)
    ├── templates.getTemplate(catId, tech) → escribe CLAUDE.md
    ├── syncProject(id)
    │   └── getApplicableAgents(project)  → global + section + tech
    │       para cada agente → saveProjectAgent() + hash
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
      └── saveProjectAgent() → copia a .claude/agents/nombre.md
  ← { added: 0, updated: 1, skipped: N }
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
