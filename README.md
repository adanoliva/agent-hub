# Agent Hub

> Aplicación de escritorio para gestionar agentes de IA, organizar proyectos de desarrollo y mantener contexto por proyecto — con asistencia de IA integrada.

*Construida con IA. Para la IA. Con manos humanas al volante.*

![Version](https://img.shields.io/badge/version-1.7.0-7c6af7)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Runtime](https://img.shields.io/badge/runtime-Electron-47848F)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ¿Qué es?

**Agent Hub** es una aplicación Electron portable para Windows que actúa como panel de control de tus agentes de Claude Code. Organiza los agentes en una jerarquía de cuatro niveles (global → categoría → tecnología → proyecto), los sincroniza automáticamente con tus proyectos, y te ayuda a crearlos con IA integrada.

Todo en un único `.exe` portable — sin instaladores, sin Node.js requerido en el sistema.

---

## Características principales

- **Dashboard** — vista de inicio con estado general, oportunidades de mejora, acciones rápidas y seguimiento de uso de IA
- **Jerarquía de agentes en 4 niveles** — Global, Categoría, Tecnología y Proyecto
- **Copia física + sistema de hashes SHA-256** — cada proyecto es autónomo con sus agentes copiados
- **Conversión automática de agentes por proveedor** — al sincronizar, los agentes se adaptan al formato de Claude o GitHub Copilot (modelos, herramientas y system prompt) de forma transparente
- **Sincronización global o por proyecto** — un botón para propagar cambios a todos, o solo a uno
- **Badges de actualización** — a golpe de vista qué proyectos tienen cambios pendientes
- **Tres proveedores de IA** — Claude CLI (suscripción claude.ai), API key de Anthropic, o GitHub Copilot Models API
- **Seguimiento de uso de IA** — tokens de entrada/salida y coste estimado por sesión y acumulado, persistidos entre arranques
- **Creación asistida por IA** — describe el agente en una frase, Claude genera el system prompt completo (ES/EN)
- **Optimización de agentes con IA** — mejora system prompts y descripciones con un clic
- **Sugerencias contextuales** — 2-4 agentes sugeridos por IA en cada nivel y por proyecto, cacheadas, no repetitivas
- **Chat IA multi-turno** — con historial por proyecto, @mention de agentes como contexto y acciones sugeridas
- **Generación de contexto de proyecto** — genera `CLAUDE.md` o `copilot-instructions.md` analizando el repositorio
- **Importar agentes externos** — introduce una URL de un `.md` con frontmatter, revisa el preview y guárdalo como agente real
- **Gestión de proyectos** — crear nuevo (con estructura de carpetas) o importar existente
- **Guías por editor** — VS Code, IntelliJ y Eclipse, adaptadas al proveedor configurado
- **Abrir en VS Code** o en el Explorador de Windows con un botón
- **System tray** — vive en la bandeja del sistema, siempre disponible
- **Auto-update** — comprueba actualizaciones al arrancar y muestra un banner flotante cuando hay una nueva versión disponible
- **Portable** — mueve la carpeta y funciona desde cualquier ubicación

---

## Capturas de pantalla

> *Disponibles en `/docs/screenshots/` tras el primer build*

---

## Requisitos del sistema

| Componente | Requisito |
|---|---|
| Sistema operativo | Windows 10 / 11 (64-bit) |
| Claude Code | Instalado y configurado (`~/.claude/`) |
| VS Code | Opcional — para el botón "Abrir en VS Code" |
| Proveedor de IA | Opcional — Claude CLI, API key de Anthropic o GitHub Copilot para funciones asistidas |

> El `.exe` portable incluye Node.js y Chromium. No necesitas instalar nada más para ejecutarlo.

---

## Instalación (usuario final)

1. Descarga `agent-hub.exe` desde la sección [Releases](../../releases) del repositorio
2. Colócalo en la carpeta donde quieras que viva la app (ej: `C:\Tools\AgentHub\`)
3. Ejecuta el `.exe`
4. Sigue el wizard de primer arranque (≈2 minutos)

Todo se genera en la misma carpeta donde está el `.exe`:

```
AgentHub/
  agent-hub.exe
  config.json
  agents/
  cache/
```

---

## Primer arranque — Wizard

Al ejecutar por primera vez, el wizard te guía en tres pasos:

1. **Bienvenida** — explicación rápida de la app
2. **Conectar con Claude** — elige el proveedor de IA: Claude CLI, GitHub Copilot Models API o API key de Anthropic. Puedes saltarlo y configurarlo más tarde desde Ajustes. Sin él, el modo manual siempre está disponible.
3. **Generación de estructura base** — crea todas las carpetas e inicia la descarga de agentes desde el directorio externo

---

## Estructura de la aplicación

```
agent-hub/
├── agent-hub.exe               ← ejecutable portable
├── config.json                 ← configuración, proyectos registrados, hashes de sync
├── agents/
│   ├── global/                 ← Nivel 1: agentes para todos los proyectos
│   │   └── .sync-meta.json     ← estado del último sync con el repositorio externo
│   ├── section-{catId}/        ← Nivel 2: agentes por categoría (se crean al sincronizar)
│   ├── tech-{catId}-{techId}/  ← Nivel 3: agentes por tecnología (se crean al sincronizar)
│   └── uncategorized/          ← agentes del repo que no encajan en ninguna carpeta estándar
└── cache/
    ├── agents-meta.json        ← metadatos de versionado del repositorio externo
    └── suggestions.json        ← sugerencias de IA cacheadas por nivel
```

### Estructura de cada proyecto registrado

```
/cualquier-ruta/mi-proyecto/
├── CLAUDE.md                   ← contexto del proyecto para Claude Code
└── .claude/
    └── agents/                 ← Nivel 4: agentes copiados + propios del proyecto
        ├── code-reviewer.md    ← copia del global (con hash registrado)
        ├── unity-dev.md        ← copia del tech (con hash registrado)
        └── mi-agente.md        ← exclusivo del proyecto (nunca se toca en sync)
```

---

## Jerarquía de agentes

```
Nivel 1 — Global
  Aplica a TODOS los proyectos sin excepción
  Los agentes globales se sincronizan también en ~/.claude/agents/

Nivel 2 — Categoría
  Aplica a todos los proyectos de esa categoría
  (Juegos, Web, Móvil, Docs)

Nivel 3 — Tecnología
  Aplica a proyectos con esa tecnología concreta
  (Unity, React, React Native, etc.)

Nivel 4 — Proyecto
  Exclusivo del proyecto. No participa en sync.
```

### Formato de un agente `.md`

```markdown
---
name: unity-dev
description: Experto en Unity, C# y arquitectura de GameObjects
model: claude-sonnet-4-20250514
tools:
  - Bash
  - Read
  - Write
  - Grep
---
Eres un experto en Unity 2023 LTS. Dominas MonoBehaviour,
ScriptableObjects, prefabs y URP. Escribes C# limpio usando
[SerializeField] en lugar de campos public...
```

**Herramientas disponibles:** `Bash` `Read` `Write` `Grep` `Edit` `MultiEdit` `WebFetch` `WebSearch` `TodoRead` `TodoWrite`

**Modelos (alias cortos):**

| Alias | Model ID completo |
|---|---|
| `haiku` | `claude-haiku-4-5-20251001` |
| `sonnet` | `claude-sonnet-4-20250514` |
| `opus` | `claude-opus-4-20250514` |

En disco los agentes se serializan siempre con el **alias corto** (`sonnet`, `haiku`, `opus`). El Claude Code CLI solo acepta aliases cortos.

El campo `optimized: true` en el frontmatter indica que el agente ha pasado por el optimizador de IA. Si está presente, el editor no muestra el botón "Optimizar con IA".

---

## Sistema de sincronización

1. Al crear o importar un proyecto, todos los agentes de niveles 1-3 aplicables se **copian físicamente** a `.claude/agents/`
2. El manager guarda un **hash SHA-256** de cada copia en `config.json`
3. Cuando editas un agente o creas uno nuevo, el hash cambia → los proyectos afectados muestran el badge **↑ Actualización disponible**
4. Sincronizas cuando quieras: **global** (todos los proyectos) o **por proyecto** individualmente
5. Los agentes de **nivel 4** (propios del proyecto) nunca se modifican durante el sync

---

## Chat IA

El chat soporta conversación multi-turno con el proveedor configurado:

- **Historial por proyecto** — se guarda en `cache/chat-{projectId}.json`. Al cambiar de proyecto se guarda el actual y se carga el nuevo.
- **@mention de agentes** — escribe `@nombre` en el input para añadir un agente como contexto activo. Los agentes activos aparecen como chips y se incluyen en el system prompt de cada mensaje.
- **Acciones sugeridas** — la IA puede sugerir botones de acción al final de sus respuestas (`create-agent`, `open-agents`, `open-settings`).
- **Selector de proyecto** — en el topbar del chat, permite cambiar el proyecto activo sin salir de la vista.

---

## Generación de contexto del proyecto

Desde el drawer de cada proyecto puedes generar automáticamente el fichero de contexto:

- **CLAUDE.md** — para Claude Code
- **copilot-instructions.md** — para GitHub Copilot

La IA analiza el directorio: detecta lenguajes por extensión, lee `package.json` / `requirements.txt` / `pyproject.toml`, detecta framework de testing, linting, build tool, CI/CD y Docker. El contenido generado se muestra para revisión antes de guardar.

---

## Agentes externos

### Repositorio de agentes

Agent Hub se sincroniza con un repositorio GitHub que actúa como catálogo compartido. La URL por defecto es `https://github.com/adanoliva/agents-directory`, configurable en **Ajustes → Directorio de agentes**.

- **Primera sync** — ocurre al finalizar el wizard, descarga todos los agentes del repositorio
- **Syncs posteriores** — al arrancar comprueba si el commit remoto ha cambiado; solo descarga lo que es nuevo o distinto
- **Versionado por archivo** — usa git blob SHA para detectar cambios sin descargar el contenido completo
- **Conflictos** — si modificaste un agente localmente y el remoto también cambió, la app detecta el conflicto y te da a elegir entre conservar tu versión o actualizarla desde el repositorio
- **Sync manual** — botón "Sincronizar ahora" en **Ajustes → Directorio de agentes** para forzar una comprobación inmediata

### Importar agente por URL

Desde **Ajustes → Directorio de agentes** también puedes importar un agente individual publicado en cualquier URL pública:

1. Introduce la URL del archivo `.md` con frontmatter
2. Agent Hub lo descarga y muestra un preview editable con todos los campos
3. Elige en qué nivel guardarlo (Global, Categoría o Tecnología)
4. Confirma — el agente queda guardado como un agente real en la jerarquía

---

## Auto-update

La app incluye auto-update via `electron-updater`:

- Al arrancar (con 8 segundos de retraso), comprueba si hay una nueva versión publicada en GitHub Releases
- Si la hay, aparece un **banner flotante** en la esquina inferior derecha con el botón **Descargar**
- Una vez descargada, el botón cambia a **Reiniciar ahora** — la instalación se aplica al reiniciar
- También puedes buscar actualizaciones manualmente desde **Ajustes → General → Buscar actualizaciones**

> El auto-update solo está activo en la versión empaquetada (`.exe`). En modo `npm run dev` no se ejecuta.

---

## Proveedores de IA

| Proveedor | Cuándo usarlo |
|---|---|
| **Claude CLI** | Tienes suscripción a Claude.ai. Sin coste adicional. Requiere la CLI instalada en PATH. |
| **API key de Anthropic** | Acceso directo a la API. Requiere cuenta en console.anthropic.com. |
| **GitHub Copilot Models API** | Tienes cuenta de GitHub con capa gratuita de Models API. Requiere Personal Access Token con permiso `models:read`. |

Configura el proveedor en el **Wizard** (primer arranque) o en **Ajustes → General → Proveedor de IA**.

---

## Para desarrolladores — Setup

### Requisitos de desarrollo

- [Node.js](https://nodejs.org/) v20 o superior
- [Git](https://git-scm.com/)
- npm v9+

### Clonar e instalar

```bash
git clone https://github.com/adanoliva/cdm.git
cd cdm
npm install
```

### Ejecutar en modo desarrollo

```bash
npm run dev
```

Esto compila el renderer con Vite en modo watch y arranca Electron con las DevTools abiertas. El servidor Express corre en `localhost:3737`.

### Estructura del código fuente

```
src/
├── backend/
│   ├── main.js             ← proceso principal Electron, IPC handlers, auto-updater
│   ├── server.js           ← servidor Express embebido (puerto 3737)
│   ├── agents.js           ← lógica de agentes: parse, CRUD, hashes SHA-256
│   ├── agents-sync.js      ← lógica de sincronización de agentes a proyectos
│   ├── projects.js         ← lógica de proyectos: crear, importar, sync, contexto
│   ├── ai.js               ← integración con proveedores de IA
│   ├── config.js           ← lectura/escritura de config.json, rutas de directorios
│   ├── defaults.js         ← definición de los agentes incluidos por defecto
│   ├── templates.js        ← plantillas CLAUDE.md / copilot-instructions.md
│   ├── tray.js             ← icono y menú de bandeja del sistema
│   ├── icon.js             ← generación de icono en runtime
│   └── preload.js          ← context bridge: expone window.api al renderer
└── renderer/
    ├── index.html          ← shell HTML (punto de entrada Vite)
    ├── main.tsx            ← bootstrap React
    ├── App.tsx             ← router principal (React Router)
    ├── api.ts              ← helper req() para la API REST
    ├── types.ts            ← tipos TypeScript compartidos
    ├── styles.css          ← estilos globales y variables CSS de tema
    ├── store/
    │   └── index.ts        ← estado global (Zustand)
    ├── pages/
    │   ├── Dashboard.tsx   ← vista de inicio (dashboard)
    │   ├── Projects.tsx    ← vista de proyectos
    │   ├── Agents.tsx      ← vista de agentes
    │   ├── Chat.tsx        ← vista de chat IA
    │   └── Settings.tsx    ← vista de ajustes
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx
    │   │   ├── Topbar.tsx
    │   │   └── Statusbar.tsx
    │   ├── agents/
    │   │   ├── AgentsTree.tsx
    │   │   ├── AgentsCenter.tsx
    │   │   ├── AgentCard.tsx
    │   │   └── AgentEditor.tsx
    │   ├── projects/
    │   │   ├── ProjectCard.tsx
    │   │   ├── ProjectDrawer.tsx
    │   │   ├── CreateProjectModal.tsx
    │   │   ├── EditProjectModal.tsx
    │   │   ├── ImportProjectModal.tsx
    │   │   ├── ExcludeAgentModal.tsx
    │   │   └── StatusBadge.tsx
    │   └── ui/
    │       ├── Modal.tsx
    │       ├── Toast.tsx
    │       ├── Wizard.tsx
    │       └── CloseDialog.tsx
    ├── hooks/
    │   ├── useCategoryHelpers.ts
    │   ├── useElectron.ts
    │   └── useToast.ts
    └── constants/
        └── tools.ts
```

### Scripts disponibles

```bash
npm run dev              # Desarrollo: Vite watch + Electron con DevTools
npm run build:renderer   # Compilar solo el renderer con Vite
npm run build            # Compilar el .exe portable para Windows
npm run build:dir        # Compilar sin empaquetar (para debug del asar)
npm run release          # Build + publicar en GitHub Releases (requiere GH_TOKEN)
```

---

## API REST (Express en puerto 3737)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |
| GET / PUT | `/api/config` | Leer / actualizar config |
| GET | `/api/detect-cli` | Detectar Claude CLI en PATH |
| POST | `/api/setup` | Setup del wizard |
| GET / POST | `/api/categories` | Categorías |
| PUT / DELETE | `/api/categories/:id` | Editar / borrar categoría |
| POST / DELETE | `/api/categories/:catId/technologies` | Tecnologías |
| GET | `/api/agents` | Agentes por nivel (`?level=global\|section\|tech`) |
| GET | `/api/agents/flat` | Todos los agentes aplanados (para @mention) |
| GET | `/api/agents/applicable` | Agentes aplicables a un proyecto |
| POST / PUT / DELETE | `/api/agents` | CRUD de agentes |
| POST | `/api/agents/import-url` | Importar agente desde URL |
| GET / POST / PUT / DELETE | `/api/projects/:id/agents` | Agentes de proyecto |
| GET / POST | `/api/projects` | Proyectos |
| POST | `/api/projects/import` | Importar proyecto existente |
| PUT / DELETE | `/api/projects/:id` | Editar / borrar proyecto |
| GET / POST | `/api/projects/:id/sync-status` | Estado de sync |
| POST | `/api/projects/:id/sync` | Sincronizar agentes al proyecto |
| POST | `/api/sync-all` | Sync de todos los proyectos |
| GET / PUT | `/api/projects/:id/context` | CLAUDE.md / copilot-instructions.md |
| POST | `/api/projects/:id/generate-context` | Generar contexto con IA |
| GET | `/api/dashboard` | Datos del dashboard (stats, sync, notificaciones) |
| GET | `/api/ai/status` | Estado del proveedor de IA |
| GET | `/api/ai/usage` | Tokens y coste de sesión + acumulado |
| POST | `/api/ai/usage/reset` | Reiniciar contadores de sesión |
| POST | `/api/ai/usage/reset-all` | Reiniciar sesión y acumulado |
| POST | `/api/ai/generate-prompt` | Generar prompt desde descripción |
| POST | `/api/ai/optimize-agent` | Optimizar system prompt con IA |
| GET | `/api/ai/suggestions` | Sugerencias por nivel |
| POST | `/api/ai/suggestions/refresh` | Forzar regeneración de sugerencias |
| DELETE | `/api/ai/suggestions/cache` | Limpiar caché de sugerencias |
| GET | `/api/ai/project-suggestions` | Sugerencias específicas para un proyecto |
| POST | `/api/ai/project-suggestions/refresh` | Regenerar sugerencias de proyecto |
| POST | `/api/chat` | Chat multi-turno |
| GET / PUT / DELETE | `/api/chat/history` | Historial de chat por proyecto |

---

## Compilar el `.exe` portable

### Configuración de electron-builder

El fichero `electron-builder.yml` en la raíz del proyecto contiene:

```yaml
appId: com.adanoliva.agent-hub
productName: Agent Hub

publish:
  provider: github
  owner: adanoliva
  repo: cdm
  private: true

win:
  target:
    - target: portable
      arch: [x64]
  icon: assets/icon.ico

portable:
  artifactName: agent-hub.exe

asar: true
compression: maximum
```

### Build local

```bash
# 1. Asegúrate de estar en la rama correcta y con todo commiteado
git status

# 2. Actualiza la versión en package.json si corresponde
npm version patch   # 1.6.0 → 1.6.1
npm version minor   # 1.6.0 → 1.7.0
npm version major   # 1.6.0 → 2.0.0

# 3. Compila
npm run build

# El .exe generado estará en:
# dist/agent-hub.exe
```

### Publicar nueva versión en GitHub Releases

```bash
# 1. Necesitas un GitHub token con permisos de escritura en el repo
$env:GH_TOKEN = "ghp_..."   # PowerShell

# 2. Asegúrate de que package.json tiene la versión correcta
# 3. Publica
npm run release
```

Esto genera:
- `dist/agent-hub.exe` — el instalable para los usuarios
- `dist/latest.yml` — el manifiesto de versión que `electron-updater` consulta para el auto-update

> Los usuarios con versiones anteriores verán el banner de actualización automáticamente en su próximo arranque.

### Checklist al actualizar versión

1. Actualizar `version` en `package.json`
2. Actualizar el campo `version` en `DEFAULT_CONFIG` de `src/backend/config.js`
3. Actualizar la línea `> Versión actual:` en `CLAUDE.md`
4. Commit y tag git → `npm run release`

---

## Configuración (`config.json`)

El fichero `config.json` se genera automáticamente en la primera ejecución. Estructura:

```json
{
  "version": "1.7.0",
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
      "technologies": [
        { "id": "unity", "name": "Unity" },
        { "id": "godot", "name": "Godot" }
      ]
    }
  ],
  "projects": [
    {
      "id": "p1234567890",
      "name": "Mi RPG",
      "categoryId": "games",
      "techId": "unity",
      "status": "active",
      "path": "C:/Proyectos/mi-rpg",
      "description": "",
      "selectedAgents": [],
      "excludedAgents": [],
      "agentHashes": {
        "code-reviewer": "abc123...",
        "unity-dev": "def456..."
      },
      "createdAt": "2025-05-01T10:00:00.000Z"
    }
  ]
}
```

> **No commitees `config.json`** — puede contener tokens y API keys. Ya está en `.gitignore`.

---

## `.gitignore` recomendado

```gitignore
node_modules/
dist/
config.json
cache/
*.log
.DS_Store
Thumbs.db
```

---

## Preguntas frecuentes

**¿Necesito tener Claude Code instalado?**  
Sí, Agent Hub gestiona los agentes de Claude Code. Necesitas tener la CLI de Claude Code instalada.

**¿Puedo usar la app sin proveedor de IA?**  
Sí. El modo manual para crear agentes siempre está disponible. Solo el modo asistido por IA (generación de prompts y sugerencias) requiere un proveedor configurado.

**¿Los agentes se sincronizan automáticamente al modificarlos?**  
No. Los cambios quedan pendientes y tú decides cuándo sincronizar — por proyecto o todos a la vez. Esto evita cambios inesperados mientras trabajas.

**¿Qué pasa si borro un agente del nivel global?**  
El fichero se elimina del directorio del manager. En los proyectos que tenían ese agente, la copia existente queda intacta hasta la siguiente sincronización.

**¿Puedo mover la carpeta de la app a otro lugar?**  
Sí, es completamente portable. Solo recuerda que las rutas de los proyectos registrados son absolutas — si mueves los proyectos tendrás que actualizarlas desde la app.

**¿Funciona en macOS o Linux?**  
La app está desarrollada y probada en Windows. Con ajustes menores en `electron-builder.yml` podría compilarse para macOS (`.dmg`) o Linux (`.AppImage`).

**¿El auto-update funciona en el `.exe` portable?**  
Sí. `electron-updater` soporta portables. El fichero `latest.yml` publicado en GitHub Releases contiene el hash y la URL del nuevo `.exe`, y el updater lo descarga y reemplaza el ejecutable al reiniciar.

---

## Tecnologías utilizadas

- [Electron](https://www.electronjs.org/) v42 — framework de escritorio
- [React](https://react.dev/) v19 — UI del renderer
- [TypeScript](https://www.typescriptlang.org/) v6 — tipado estático en el renderer
- [Zustand](https://zustand-demo.pmnd.rs/) v5 — estado global del renderer
- [React Router](https://reactrouter.com/) v7 — navegación entre vistas
- [Vite](https://vitejs.dev/) v8 — bundler del renderer
- [Express](https://expressjs.com/) — servidor HTTP embebido (puerto 3737)
- [electron-builder](https://www.electron.build/) v26 — compilación y empaquetado
- [electron-updater](https://www.electron.build/auto-update) v6 — auto-update
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node) — integración con Claude API
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — tipografía monoespaciada
- [Tabler Icons](https://tabler.io/icons) — iconografía (CDN v3.6.0)

---

## Licencia

MIT © 2025
