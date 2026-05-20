# Claude Dev Manager

> Aplicación de escritorio para gestionar agentes de [Claude Code](https://claude.ai/code), organizar proyectos de desarrollo y mantener contexto `CLAUDE.md` por proyecto — con asistencia de IA integrada.

![Version](https://img.shields.io/badge/version-1.2.4-7c6af7)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Runtime](https://img.shields.io/badge/runtime-Electron-47848F)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ¿Qué es?

**Claude Dev Manager** es una aplicación Electron portable para Windows que actúa como panel de control de tus agentes de Claude Code. Organiza los agentes en una jerarquía de cuatro niveles (global → categoría → tecnología → proyecto), los sincroniza automáticamente con tus proyectos, y te ayuda a crearlos con IA integrada.

Todo en un único `.exe` portable — sin instaladores, sin Node.js requerido en el sistema.

---

## Características principales

- **Jerarquía de agentes en 4 niveles** — Global, Categoría, Tecnología y Proyecto
- **Copia física + sistema de hashes SHA-256** — cada proyecto es autónomo con sus agentes copiados
- **Sincronización global o por proyecto** — un botón para propagar cambios a todos, o solo a uno
- **Badges de actualización** — a golpe de vista qué proyectos tienen cambios pendientes
- **Tres proveedores de IA** — Claude CLI (suscripción claude.ai), API key de Anthropic, o GitHub Copilot Models API
- **Creación asistida por IA** — describe el agente en una frase, Claude genera el system prompt completo (ES/EN)
- **Sugerencias contextuales** — 2-4 agentes sugeridos por IA en cada nivel, cacheadas, no repetitivas
- **Importar agentes externos** — introduce una URL de un `.md` con frontmatter, revisa el preview y guárdalo como agente real
- **Gestión de proyectos** — crear nuevo (con estructura de carpetas) o importar existente
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

1. Descarga `claude-dev-manager.exe` desde la sección [Releases](../../releases) del repositorio
2. Colócalo en la carpeta donde quieras que viva la app (ej: `C:\Tools\ClaudeDevManager\`)
3. Ejecuta el `.exe`
4. Sigue el wizard de primer arranque (≈2 minutos)

Todo se genera en la misma carpeta donde está el `.exe`:

```
ClaudeDevManager/
  claude-dev-manager.exe
  config.json
  agents/
  cache/
```

---

## Primer arranque — Wizard

Al ejecutar por primera vez, el wizard te guía en tres pasos:

1. **Bienvenida** — explicación rápida de la app
2. **Conectar con Claude** — elige el proveedor de IA: Claude CLI, GitHub Copilot Models API o API key de Anthropic. Puedes saltarlo y configurarlo más tarde desde Ajustes. Sin él, el modo manual siempre está disponible.
3. **Generación de estructura base** — crea todas las carpetas y carga los agentes por defecto

---

## Estructura de la aplicación

```
claude-dev-manager/
├── claude-dev-manager.exe      ← ejecutable portable
├── config.json                 ← configuración, proyectos registrados, hashes de sync
├── agents/
│   ├── global/                 ← Nivel 1: agentes para todos los proyectos
│   │   ├── code-reviewer.md
│   │   ├── git-helper.md
│   │   ├── test-writer.md
│   │   ├── doc-writer.md
│   │   ├── refactor-agent.md
│   │   └── debugger.md
│   ├── section-games/          ← Nivel 2: categoría Juegos
│   ├── section-web/            ← Nivel 2: categoría Web
│   ├── section-mobile/         ← Nivel 2: categoría Móvil
│   ├── section-docs/           ← Nivel 2: categoría Docs
│   ├── tech-games-unity/       ← Nivel 3: tecnología Unity
│   ├── tech-games-godot/       ← Nivel 3: tecnología Godot
│   ├── tech-web-react/         ← Nivel 3: tecnología React
│   ├── tech-web-fullstack/     ← Nivel 3: tecnología Fullstack
│   ├── tech-web-nextjs/        ← Nivel 3: tecnología Next.js
│   ├── tech-mobile-react-native/
│   └── tech-mobile-pwa/
└── cache/
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

En disco los agentes se serializan siempre con el model ID completo. La UI muestra el alias corto.

---

## Sistema de sincronización

1. Al crear o importar un proyecto, todos los agentes de niveles 1-3 aplicables se **copian físicamente** a `.claude/agents/`
2. El manager guarda un **hash SHA-256** de cada copia en `config.json`
3. Cuando editas un agente o creas uno nuevo, el hash cambia → los proyectos afectados muestran el badge **↑ Actualización disponible**
4. Sincronizas cuando quieras: **global** (todos los proyectos) o **por proyecto** individualmente
5. Los agentes de **nivel 4** (propios del proyecto) nunca se modifican durante el sync

---

## Agentes incluidos por defecto

### Global
| Agente | Descripción | Modelo |
|---|---|---|
| `code-reviewer` | Revisa código: bugs, antipatrones y mejoras | sonnet |
| `git-helper` | Commits, ramas y resolución de conflictos | haiku |
| `test-writer` | Genera tests unitarios y de integración | sonnet |
| `doc-writer` | Documentación técnica en Markdown | sonnet |
| `refactor-agent` | Refactoriza código manteniendo funcionalidad | sonnet |
| `debugger` | Diagnóstico y corrección de errores | sonnet |

### Juegos (categoría)
| Agente | Descripción |
|---|---|
| `game-designer` | Mecánicas, balance y experiencia de juego |
| `performance-optimizer` | Optimiza framerate y rendimiento |

### Unity (tecnología)
| Agente | Descripción |
|---|---|
| `unity-dev` | Unity, C# y arquitectura de GameObjects |
| `unity-shader` | Shaders HLSL y Shader Graph para URP/HDRP |
| `unity-ui` | UI Toolkit, Canvas y sistemas de menú |

### Web (categoría)
| Agente | Descripción |
|---|---|
| `api-designer` | Diseño de APIs REST y GraphQL |
| `security-audit` | Seguridad web: OWASP, auth, inyecciones |
| `accessibility` | Accesibilidad WCAG AA |

### React / Fullstack / Next.js (tecnología)
`react-dev` · `css-designer` · `backend-dev` · `nextjs-dev`

### Móvil (categoría)
`mobile-ux`

### React Native / PWA (tecnología)
`rn-dev` · `pwa-dev`

### Docs (categoría)
`tech-writer` · `diagram-maker`

---

## Importar agentes externos

Desde **Ajustes → Agentes externos** puedes importar un agente publicado como `.md` con frontmatter en cualquier URL:

1. Introduce la URL del archivo `.md`
2. CDM lo descarga y muestra un preview editable con todos los campos (nombre, descripción, modelo, herramientas, system prompt)
3. Elige en qué nivel guardarlo (Global, Categoría o Tecnología)
4. Confirma — el agente queda guardado como un agente real en la jerarquía

---

## Auto-update

La app incluye auto-update via `electron-updater`:

- Al arrancar (con 8 segundos de retraso para no bloquear la carga), comprueba si hay una nueva versión publicada en GitHub Releases
- Si la hay, aparece un **banner flotante** en la esquina inferior derecha con el número de versión y el botón **Descargar**
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

Esto arranca Electron con las DevTools abiertas. El servidor Express corre en `localhost:3737`.

### Estructura del código fuente

```
src/
├── main/
│   ├── main.js             ← proceso principal Electron, auto-updater, IPC handlers
│   ├── tray.js             ← icono y menú de bandeja del sistema
│   ├── server.js           ← servidor Express embebido (puerto 3737)
│   ├── agents.js           ← lógica de agentes: parse, CRUD, hashes SHA-256, seed
│   ├── projects.js         ← lógica de proyectos: crear, importar, sync, CLAUDE.md
│   ├── ai.js               ← integración con proveedores de IA
│   ├── config.js           ← lectura/escritura de config.json, rutas de directorios
│   ├── defaults.js         ← definición de los agentes incluidos por defecto
│   └── preload.js          ← context bridge: expone window.api al renderer
└── renderer/
    ├── index.html          ← toda la UI (single-file, vanilla JS)
    ├── views/              ← vistas modulares (proyectos, agentes, ajustes, wizard)
    ├── app.js              ← lógica del renderer
    └── styles/
        └── main.css        ← estilos globales (tema oscuro VS Code)
```

### Scripts disponibles

```bash
npm run dev          # Desarrollo con DevTools abiertos
npm run build        # Compilar el .exe portable para Windows
npm run build:dir    # Compilar sin empaquetar (para debug del asar)
npm run release      # Build + publicar en GitHub Releases (requiere GH_TOKEN)
```

---

## Compilar el `.exe` portable

### Configuración de electron-builder

El fichero `electron-builder.yml` en la raíz del proyecto contiene:

```yaml
appId: com.adanoliva.claude-dev-manager
productName: Claude Dev Manager

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
  artifactName: claude-dev-manager.exe

asar: true
compression: maximum
```

### Build local

```bash
# 1. Asegúrate de estar en la rama correcta y con todo commiteado
git status

# 2. Actualiza la versión en package.json si corresponde
npm version patch   # 1.2.4 → 1.2.5
npm version minor   # 1.2.4 → 1.3.0
npm version major   # 1.2.4 → 2.0.0

# 3. Compila
npm run build

# El .exe generado estará en:
# dist/claude-dev-manager.exe
```

### Publicar nueva versión en GitHub Releases

El script `release` usa `electron-builder --publish always` para subir el `.exe` y el fichero `latest.yml` (necesario para el auto-update) directamente a GitHub Releases.

```bash
# 1. Necesitas un GitHub token con permisos de escritura en el repo
$env:GH_TOKEN = "ghp_..."   # PowerShell

# 2. Asegúrate de que package.json tiene la versión correcta
# 3. Publica
npm run release
```

Esto genera:
- `dist/claude-dev-manager.exe` — el instalable para los usuarios
- `dist/latest.yml` — el manifiesto de versión que `electron-updater` consulta para el auto-update

> Los usuarios con versiones anteriores verán el banner de actualización automáticamente en su próximo arranque.

### Icono de la aplicación

Coloca el icono en `assets/icon.ico` (formato ICO, 256×256px mínimo).  
Para generarlo desde un PNG usa ImageMagick:

```bash
magick convert icon.png -resize 256x256 assets/icon.ico
```

---

## Configuración (`config.json`)

El fichero `config.json` se genera automáticamente en la primera ejecución. Estructura:

```json
{
  "version": "1.2.4",
  "aiProvider": "cli",
  "apiKey": "",
  "githubToken": "",
  "githubModel": "gpt-4o-mini",
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
      "createdAt": "2025-05-01T10:00:00.000Z",
      "agentHashes": {
        "code-reviewer": "abc123...",
        "unity-dev": "def456..."
      }
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
Sí, Claude Dev Manager gestiona los agentes de Claude Code. Necesitas tener la CLI de Claude Code instalada.

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

## Documentación

| Documento | Descripción |
|---|---|
| `README.md` | Este fichero — guía completa para desarrolladores |
| `MANUAL.html` | Guía visual de uso para el usuario final |
| `SPEC.html` | Especificación técnica completa del proyecto |

---

## Tecnologías utilizadas

- [Electron](https://www.electronjs.org/) v29 — framework de escritorio
- [Express](https://expressjs.com/) — servidor HTTP embebido (puerto 3737)
- [electron-builder](https://www.electron.build/) v24 — compilación y empaquetado
- [electron-updater](https://www.electron.build/auto-update) v6 — auto-update
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node) — integración con Claude API
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — tipografía monoespaciada
- [Tabler Icons](https://tabler.io/icons) — iconografía

---

## Licencia

MIT © 2025
