# Documentación técnica — Backend (`src/backend/`)

> Stack: Electron main process + Express 4 en `localhost:3737`
> Última actualización: 2026-05-22

---

## Índice

1. [Visión general](#1-visión-general)
2. [Arranque y ciclo de vida (`main.js`)](#2-arranque-y-ciclo-de-vida-mainjs)
3. [Configuración (`config.js`)](#3-configuración-configjs)
4. [API REST (`server.js`)](#4-api-rest-serverjs)
5. [Gestión de agentes (`agents.js`)](#5-gestión-de-agentes-agentsjs)
6. [Gestión de proyectos (`projects.js`)](#6-gestión-de-proyectos-projectsjs)
7. [Integración IA (`ai.js`)](#7-integración-ia-aijs)
8. [Bandeja del sistema (`tray.js`)](#8-bandeja-del-sistema-trayjs)
9. [Bridge IPC (`preload.js`)](#9-bridge-ipc-preloadjs)
10. [Agentes por defecto (`defaults.js`)](#10-agentes-por-defecto-defaultsjs)
11. [Plantillas de contexto (`templates.js`)](#11-plantillas-de-contexto-templatesjs)
12. [Flujos clave end-to-end](#12-flujos-clave-end-to-end)

---

## 1. Visión general

El backend es el proceso principal de Electron (`main process`). Corre en Node.js y tiene acceso completo al sistema de archivos y a las APIs nativas. Expone dos interfaces hacia el renderer:

- **API REST HTTP** en `localhost:3737` (Express). El renderer hace `fetch('/api/...')` y Vite lo proxea en dev.
- **IPC bridge** (`preload.js`). Para operaciones nativas que no pasan por HTTP: abrir carpetas, dialogs de sistema, control de ventana, actualizaciones.

```
Electron main process (Node.js)
  │
  ├── main.js         ← punto de entrada, BrowserWindow, ciclo de vida
  ├── server.js       ← Express: todas las rutas /api/*
  ├── config.js       ← lectura/escritura de config.json
  ├── agents.js       ← CRUD de agentes (.md con frontmatter YAML)
  ├── projects.js     ← CRUD de proyectos, sync de agentes a proyectos
  ├── ai.js           ← llamadas a IA (CLI / Anthropic API / GitHub)
  ├── tray.js         ← icono en la bandeja del sistema
  ├── preload.js      ← contextBridge: window.api expuesto al renderer
  ├── defaults.js     ← definición de agentes iniciales por nivel
  └── templates.js    ← plantillas CLAUDE.md / copilot-instructions.md
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
  ├── seedDefaultAgents()                 ← reseed de agentes por defecto si han cambiado
  ├── syncGlobalAgentsToClaudeDir()       ← copia globales a ~/.claude/agents/
  ├── startServer()                       ← levanta Express en :3737
  ├── createWindow()                      ← BrowserWindow 1280×800
  ├── createTray(mainWindow)              ← icono en bandeja
  └── setupAutoUpdater()                  ← solo en producción
```

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

La URL cargada es `http://localhost:5173` en dev Vite o `http://localhost:${PORT}` en producción.

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

### Instancia única

`app.requestSingleInstanceLock()` garantiza que solo hay una instancia de la app. Si se intenta abrir una segunda, la primera se trae al frente.

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
  "version": "1.1.0",
  "aiProvider": "cli",
  "apiKey": "",
  "githubToken": "",
  "githubModel": "gpt-4o-mini",
  "theme": "dark",
  "closeAction": "ask",
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
  "projects": [
    {
      "id": "p1234567890abc",
      "name": "Mi Proyecto",
      "categoryId": "web",
      "techId": "react",
      "path": "C:/proyectos/mi-proyecto",
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

### Funciones exportadas

| Función | Descripción |
|---|---|
| `readConfig()` | Lee y parsea `config.json`; si no existe, devuelve `DEFAULT_CONFIG` |
| `writeConfig(cfg)` | Serializa y escribe `config.json` |
| `getAgentDir(level, catId, techId)` | Calcula la ruta de carpeta de agentes según nivel |
| `bootstrapDirectories(cfg)` | Crea `agents/global/`, `agents/section-*`, `agents/tech-*` si no existen |
| `ensureDir(p)` | `fs.mkdirSync(p, { recursive: true })` |

### `getAgentDir` — lógica de nivel

```js
level === 'global'   → agents/global/
level === 'section'  → agents/section-{catId}/
level === 'tech'     → agents/tech-{catId}-{techId}/
```

---

## 4. API REST (`server.js`)

Express corre en el puerto `3737` (constante `PORT`). Todos los endpoints tienen el prefijo `/api`.

### Tabla completa de endpoints

#### Health y configuración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | `{ status: 'ok', port }` |
| GET | `/api/config` | Config completa (sin `projects`) |
| PUT | `/api/config` | Actualiza campos: `aiProvider`, `apiKey`, `githubToken`, `githubModel`, `theme`, `closeAction` |
| GET | `/api/detect-cli` | `{ found: bool, path? }` — busca `claude` en PATH |
| POST | `/api/setup` | Wizard: guarda `aiProvider` + credenciales, detecta CLI |

#### Categorías

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/categories` | Array de categorías con technologies |
| POST | `/api/categories` | Crea categoría `{ id, name, icon, color, technologies: [] }` |
| PUT | `/api/categories/:id` | Actualiza nombre, icono, color |
| DELETE | `/api/categories/:id` | Elimina categoría |
| POST | `/api/categories/:catId/technologies` | Añade `{ id, name }` a una categoría |
| DELETE | `/api/categories/:catId/technologies/:techId` | Elimina tecnología |

#### Agentes (niveles 1–3)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/agents?level=&categoryId=&techId=` | Lista agentes de un nivel |
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
El resto del fichero es el body.
```

### Modelos disponibles (alias → ID completo)

| Alias | Model ID |
|---|---|
| `haiku` | `claude-haiku-4-5-20251001` |
| `sonnet` | `claude-sonnet-4-20250514` |
| `opus` | `claude-opus-4-20250514` |

`parseAgentFile` normaliza cualquiera de estos valores al ID completo al leer, y `serializeAgent` puede volver a escribir el alias o el ID completo según convenga.

### Jerarquía de niveles

| Nivel | Carpeta | Aplica a |
|---|---|---|
| `global` | `agents/global/` | Todos los proyectos |
| `section` | `agents/section-{catId}/` | Proyectos de esa categoría |
| `tech` | `agents/tech-{catId}-{techId}/` | Proyectos de esa tecnología |
| `project` | `{projectPath}/.claude/agents/` o `.github/agents/` | Un proyecto concreto |

### Funciones principales

**Parseo y serialización:**
- `parseAgentFile(filePath)` — lee un `.md`, extrae frontmatter YAML y body. Devuelve `{ name, description, model, tools, system, optimized? }`.
- `parseAgentFromString(content, fallbackName)` — misma lógica desde string (usado en import-url).
- `serializeAgent(agent)` — construye el string `.md` con frontmatter + body.
- `hashAgent(agent)` — SHA-256 del string serializado. Usado para detectar si un agente ha cambiado respecto a la copia en el proyecto.

**CRUD niveles 1–3:**
- `listAgentsByLevel(level, catId, techId)` — lista `.md` de la carpeta correspondiente.
- `getApplicableAgents(project)` — combina global + section + tech del proyecto.
- `createAgent(level, catId, techId, agent)` — valida unicidad de nombre y escribe el fichero.
- `updateAgent(level, catId, techId, agent)` — sobreescribe el fichero existente.
- `deleteAgent(level, catId, techId, name)` — elimina el fichero.

**Nivel de proyecto (nivel 4):**
- `listProjectAgents(project)` — lee `.claude/agents/` o `.github/agents/` según `aiProvider`.
- `saveProjectAgent(project, agent)` — escribe en la carpeta del proyecto (formato GitHub si es `github`).
- `deleteProjectAgent(project, name)` — elimina el fichero del proyecto.

**Migración y seeding:**
- `migrateAgentFiles()` — detecta agentes en formato antiguo (sin frontmatter) y los convierte. Devuelve el número migrado.
- `seedDefaultAgents()` — compara los agentes en `defaults.js` con los existentes en disco usando hashes; reescribe los que han cambiado. Nunca borra agentes personalizados.
- `syncGlobalAgentsToClaudeDir()` — copia todos los agentes globales a `~/.claude/agents/` para que Claude Code los cargue automáticamente.

### Formato GitHub vs. Claude

Los agentes para proyectos con `aiProvider: 'github'` se guardan en `.github/agents/` con un header diferente en el frontmatter (`# Agent: nombre`). `saveProjectAgent` detecta el provider del proyecto y adapta el formato automáticamente.

---

## 6. Gestión de proyectos (`projects.js`)

### Estructura de un proyecto en config.json

```js
{
  id: 'p1234567890abc',    // makeProjectId(): timestamp + random
  name: 'Mi Proyecto',
  categoryId: 'web',
  techId: 'react',
  path: 'C:/proyectos/mi-proyecto',   // absoluto
  description: '',
  status: 'active',                    // active | paused | archived
  aiProvider: 'claude',                // claude | github | both
  selectedAgents: [],                  // nombres de agentes explícitamente incluidos
  excludedAgents: [],                  // nombres de agentes excluidos del sync
  agentHashes: {},                     // { agentName: sha256 } — hashes en la copia del proyecto
  createdAt: '2025-01-01T00:00:00.000Z',
}
```

### Sync de agentes

El sync copia los agentes aplicables (global + section + tech) al directorio del proyecto, respetando las exclusiones.

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
| `local` | El agente existe en el proyecto pero no en los niveles 1–3 (agente local) |
| `excluded` | El agente está en `excludedAgents` |

### Ciclo de vida de un proyecto

**`createProject(data)`:**
1. Genera `id` con `makeProjectId()`.
2. Crea la carpeta si no existe.
3. Escribe `CLAUDE.md` o `copilot-instructions.md` desde `templates.js`.
4. Llama a `syncProject()` para copiar los agentes iniciales.
5. Añade el proyecto a `config.projects` y persiste.

**`importProject(data)`:**
Como `createProject` pero la carpeta ya existe. Solo sincroniza agentes y guarda en config.

**`updateProject(id, changes)`:**
- Si `aiProvider` cambia: llama a `migrateProjectProvider()` que copia los agentes de nivel 4 al nuevo directorio y crea el fichero de contexto para el nuevo provider.
- Persiste los cambios en config.

**`deleteProject(id, { deleteFolder })`:**
Elimina de `config.projects`. Si `deleteFolder: true`, borra el directorio del proyecto del disco.

### Ficheros de contexto

| Provider | Ruta | Plantilla |
|---|---|---|
| `claude` | `{path}/CLAUDE.md` | `getTemplate(catId, techId, name)` |
| `github` | `{path}/.github/copilot-instructions.md` | `getGitHubTemplate(catId, techId, name)` |
| `both` | Ambos | Ambas |

`getContextFile(project, type)` y `saveContextFile(project, type, content)` abstraen la ruta según provider.

---

## 7. Integración IA (`ai.js`)

### Proveedores soportados

| Provider | Config necesaria | Backend |
|---|---|---|
| `cli` | Claude Code instalado en PATH | Spawn de proceso `claude --print` |
| `api` | `config.apiKey` (Anthropic) | `@anthropic-ai/sdk` |
| `github` | `config.githubToken` | `fetch` a Azure inference endpoint |

### `callAI(prompt, systemPrompt?)`

Punto de entrada único. Lee `config.aiProvider` y delega:

```
callAI(prompt, system)
  ├── 'cli'    → callCLI(prompt, system)
  ├── 'api'    → callAPI(prompt, system)
  └── 'github' → callGitHub(prompt, system)
```

**`callCLI`:** Construye el prompt como `[SYSTEM]\n...\n[USER]\n...` y lo pasa por stdin a `claude --print`. En Windows usa `shell: true` para resolver PATH. Timeout de 60 s.

**`callAPI`:** Usa `anthropic.messages.create()` con modelo `claude-sonnet-4-20250514`, `max_tokens: 1500`.

**`callGitHub`:** POST a `https://models.inference.ai.azure.com/chat/completions` con el modelo configurado en `config.githubModel` (por defecto `gpt-4o-mini`), Authorization Bearer con `githubToken`.

### Chat multi-turno (`callAIChat`)

Para API y GitHub, convierte `messages[]` al formato nativo del proveedor y envía con `systemPrompt` separado. Para CLI, aplana la conversación en un único prompt de texto (el CLI no soporta mensajes estructurados):

```
[SYSTEM]
{systemPrompt}

[USER]
{messages[0].content}

[ASSISTANT]
{messages[1].content}

[USER]
{messages[2].content}
```

### Funciones de generación

**`generateAgentPrompt({ description, level, tools, lang })`**
Genera un system prompt completo para un nuevo agente a partir de una descripción informal. El prompt incluye el nivel (global/section/tech), las herramientas disponibles y el idioma de salida (`en`|`es`).

**`generateSuggestions({ level, categoryId, techId, existingNames })`**
Devuelve un array de 3 agentes en JSON: `[{ name, description, tools, model, system }]`. Usa `parseJSONSafely()` para extraer el JSON aunque la IA envuelva la respuesta en markdown fences.

**`generateProjectSuggestions({ project, contextContent, existingNames })`**
Similar a `generateSuggestions` pero el prompt incluye el contenido del CLAUDE.md del proyecto como contexto principal. Las sugerencias salen siempre en español.

**`optimizeAgent({ name, description, system, tools, model })`**
Pide a la IA que mejore el system prompt existente y la descripción manteniendo el foco del agente. Devuelve `{ description, system }`.

### Caché de sugerencias

Las sugerencias por nivel se cachean en `cache/suggestions.json` para evitar llamadas repetidas a la IA.

```js
// Clave de caché
key = `${level}::${categoryId ?? ''}::${techId ?? ''}`     // niveles 1-3
key = `project::${projectId}`                               // nivel proyecto
```

`getSuggestions()` devuelve el valor cacheado si existe; si no, llama a `generateSuggestions()` y almacena el resultado. `clearSuggestionsCache()` borra el fichero completo.

### `parseJSONSafely(text)`

Strips markdown fences (\`\`\`json...\`\`\`), encuentra el primer `[` y el `]` correspondiente, y parsea. Si falla, devuelve `[]`. Imprescindible porque los modelos de IA frecuentemente envuelven el JSON en markdown.

---

## 8. Bandeja del sistema (`tray.js`)

### Creación del icono

Intenta cargar `assets/icon.ico` o `assets/icon.png`. Si ninguno existe, genera un `NativeImage` programáticamente (cuadrado sólido 16×16). El icono se redimensiona a 16×16 para el tray de Windows.

### Comportamiento

- **Click izquierdo:** muestra y enfoca la ventana principal.
- **Click derecho:** menú contextual con tres opciones:
  - *Abrir Agent Hub* — `mainWindow.show()`
  - *Reiniciar* — `app.relaunch(); app.quit()`
  - *Salir* — `app.isQuiting = true; app.quit()`

`createTray(mainWindow)` registra el icono y los handlers. `destroyTray()` se llama desde `app.on('before-quit')` para limpieza.

---

## 9. Bridge IPC (`preload.js`)

`contextBridge.exposeInMainWorld('api', {...})` expone un objeto `window.api` al renderer con acceso seguro al main process. El renderer **nunca** usa `require` ni accede directamente a Node.

### API expuesta

```ts
window.api = {
  // App
  getVersion()         → Promise<string>
  getAppDir()          → Promise<string>
  isDev()              → Promise<boolean>

  // Ventana
  minimize()           → void
  hide()               → void

  // Shell
  openPath(p)          → void
  openExternal(url)    → void
  openVSCode(p)        → Promise<{ ok: boolean; error?: string }>

  // Diálogos
  pickFolder()         → Promise<string | null>

  // Diálogo de cierre
  onCloseRequested(cb) → void   // escucha 'app:close-requested'
  closeResponse(action, remember) → void  // envía 'app:close-response'

  // Actualizaciones
  checkForUpdate()     → Promise<any>
  downloadUpdate()     → Promise<any>
  installUpdate()      → void
  onUpdateAvailable(cb)  → void
  onUpdateProgress(cb)   → void
  onUpdateReady(cb)      → void
  onUpdateError(cb)      → void
}
```

### Seguridad

- `nodeIntegration: false` — el renderer no puede usar `require`.
- `contextIsolation: true` — el renderer y el preload tienen contextos JS separados.
- Solo se exponen las operaciones necesarias, nunca acceso genérico a IPC o al sistema de archivos.

---

## 10. Agentes por defecto (`defaults.js`)

Define `DEFAULT_AGENTS`, un objeto con agentes agrupados por nivel. Se usa en `seedDefaultAgents()` para escribir los `.md` iniciales al arrancar la app por primera vez, y para reseedear cuando un agente por defecto ha sido modificado en una versión nueva.

### Agentes globales (nivel 1)

| Nombre | Modelo | Herramientas | Propósito |
|---|---|---|---|
| `code-reviewer` | haiku | Read, Grep | Bugs, antipatrones, performance |
| `git-helper` | haiku | Bash, Read | Commits, ramas, resolución de conflictos |
| `test-writer` | sonnet | Read, Write, Grep | Tests unitarios e integración |
| `doc-writer` | sonnet | Read, Write, Grep | Documentación técnica |
| `refactor-agent` | sonnet | Read, Write, Grep | Refactorización manteniendo funcionalidad |

### Agentes de sección (nivel 2)

| Sección | Agente | Modelo |
|---|---|---|
| games | `game-designer` | sonnet |
| games | `performance-optimizer` | sonnet |
| web | `api-designer` | sonnet |
| web | `security-audit` | sonnet |
| web | `accessibility` | haiku |
| mobile | `mobile-ux` | sonnet |
| docs | `tech-writer` | sonnet |
| docs | `diagram-maker` | sonnet |

### Agentes de tecnología (nivel 3)

| Tech | Agentes |
|---|---|
| games-unity | `unity-dev`, `unity-shader`, `unity-ui` |
| games-godot | `godot-dev` |
| web-react | `react-dev`, `css-designer` |
| web-fullstack | `backend-dev` |
| web-nextjs | `nextjs-dev` |
| mobile-react-native | `rn-dev` |
| mobile-pwa | `pwa-dev` |

### Lógica de reseed

`seedDefaultAgents()` compara el hash del agente en `defaults.js` con el hash del fichero en disco. Si difieren (la definición por defecto cambió en una actualización), sobreescribe el fichero. Si el agente no existe en disco, lo crea. **Nunca borra agentes que existen en disco pero no en `defaults.js`** — esos son agentes personalizados del usuario.

---

## 11. Plantillas de contexto (`templates.js`)

Genera el contenido inicial de `CLAUDE.md` y `.github/copilot-instructions.md` al crear un proyecto.

### `getTemplate(categoryId, techId, projectName)`

Devuelve una plantilla específica por combinación categoría-tecnología:

| Combinación | Stack documentado |
|---|---|
| `games-unity` | Unity 2023 LTS, URP, C#, convenciones de carpetas |
| `games-godot` | Godot 4, GDScript, señales, type hints |
| `web-react` | React 18, Vite, TypeScript strict, TailwindCSS, Zustand |
| `web-fullstack` | React + Express + PostgreSQL + Prisma, monorepo |
| `web-nextjs` | Next.js 14 App Router, server components, Prisma, NextAuth |
| `mobile-react-native` | Expo + Expo Router, Reanimated 3, Platform.select |
| `mobile-pwa` | Vite + Workbox, Lighthouse 90+, 44px touch targets |
| `docs` | Docusaurus 3, MDX, estructura guides/api/tutorials |

Si no hay plantilla específica para la combinación, devuelve una plantilla genérica mínima con el nombre del proyecto.

### `getGitHubTemplate(categoryId, techId, projectName)`

Misma lógica que `getTemplate` pero adapta el contenido para Copilot:
- Sustituye "Rules" → "Coding standards".
- Elimina referencias a "Claude Code".
- Ajusta el tono para instrucciones de Copilot.

---

## 12. Flujos clave end-to-end

### Crear un proyecto nuevo

```
Frontend: POST /api/projects { name, categoryId, techId, path, aiProvider }
  │
  server.js → projects.createProject(data)
    ├── makeProjectId()                    → id = 'p' + Date.now() + random
    ├── fs.mkdirSync(path, recursive)
    ├── templates.getTemplate(catId, tech) → escribe CLAUDE.md
    ├── syncProject(id)
    │   └── getApplicableAgents(project)  → global + section + tech
    │       para cada agente → saveProjectAgent() + hash
    └── writeConfig(cfg con nuevo proyecto)
  │
  ← { project }
```

### Sync de un agente actualizado

```
Usuario edita un agente global en la UI
Frontend: PUT /api/agents { level:'global', agent }
  │
  server.js → agents.updateAgent() → sobreescribe agents/global/nombre.md
  │
  Frontend: POST /api/projects/:id/sync
    │
    server.js → projects.syncProject(id)
      ├── getApplicableAgents()        → lista agentes aplicables
      ├── hashAgent(agente modificado) ≠ project.agentHashes['nombre']
      └── saveProjectAgent()           → copia a .claude/agents/nombre.md
          + actualiza agentHashes['nombre'] en config
  │
  ← { added: 0, updated: 1, skipped: N }
```

### Chat con contexto de agentes

```
Frontend: POST /api/chat { messages, systemPrompt }
  │
  server.js → ai.callAIChat(messages, systemPrompt)
    │
    ├── provider 'cli'    → texto aplanado → spawn claude --print
    ├── provider 'api'    → anthropic.messages.create({ system, messages })
    └── provider 'github' → fetch Azure inference endpoint
  │
  ← { reply: string }
```

El `systemPrompt` lo construye el renderer concatenando los system prompts de todos los agentes activos (@mention) + la instrucción de sugerir acciones.

### Generación de sugerencias de agentes

```
Frontend: GET /api/ai/suggestions?level=section&categoryId=web
  │
  server.js → ai.getSuggestions({ level, categoryId })
    │
    ├── getCachedSuggestions('section::web::') → ¿existe en cache/suggestions.json?
    │   └── sí → devuelve array cacheado
    │   └── no →
    │       generateSuggestions({ level, categoryId })
    │         └── callAI(prompt) → parseJSONSafely(respuesta)
    │       writeSuggestionsCache('section::web::', result)
    └── ← [{ name, description, tools, model, system }, ...]
```

### Cierre de ventana con diálogo personalizado

```
Usuario pulsa X en la ventana
  │
  main.js: mainWindow.on('close') → handleClose()
    │
    ├── readConfig().closeAction === 'ask'
    │   │
    │   ├── mainWindow.webContents.send('app:close-requested')
    │   └── ipcMain.once('app:close-response', handler)
    │
  renderer: preload.onCloseRequested → setShowCloseDialog(true)
  renderer: <CloseDialog> → usuario elige tray/quit + remember
  renderer: preload.closeResponse(action, remember)
    │
  main.js: ipcMain.once handler recibe { action, remember }
    ├── remember === true → writeConfig({ closeAction: action })
    ├── action === 'tray' → mainWindow.hide()
    └── action === 'quit' → app.isQuiting = true; app.quit()
```
