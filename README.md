# Claude Dev Manager

> Aplicación de escritorio para gestionar agentes de [Claude Code](https://claude.ai/code), organizar proyectos de desarrollo y mantener contexto `CLAUDE.md` por proyecto — con asistencia de IA integrada.

![Version](https://img.shields.io/badge/version-1.0.0-7c6af7)
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
- **Copia física + sistema de hashes** — cada proyecto es autónomo con sus agentes copiados
- **Sincronización global o por proyecto** — un botón para propagar cambios a todos, o solo a uno
- **Badges de actualización** — a golpe de vista qué proyectos tienen cambios pendientes
- **Creación asistida por IA** — describe el agente en una frase, Claude genera el system prompt completo (ES/EN)
- **Sugerencias contextuales** — 2-4 agentes sugeridos por IA en cada nivel, cacheados, no repetitivos
- **Gestión de proyectos** — crear nuevo (con estructura de carpetas) o importar existente
- **Abrir en VS Code** o en el Explorador de Windows con un botón
- **System tray** — vive en la bandeja del sistema, siempre disponible
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
| Anthropic API key | Opcional — para modo asistido por IA y sugerencias |

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
2. **API key de Anthropic** — necesaria para el modo asistido por IA. Puedes saltarla y configurarla más tarde desde Ajustes. Sin ella, el modo manual siempre está disponible.
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
│   │   └── refactor-agent.md
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
tools: Bash, Read, Write, Grep
model: sonnet
---
Eres un experto en Unity 2023 LTS. Dominas MonoBehaviour,
ScriptableObjects, prefabs y URP. Escribes C# limpio usando
[SerializeField] en lugar de campos public...
```

**Herramientas disponibles:** `Bash` `Read` `Write` `Grep` `Edit` `MultiEdit` `WebFetch` `WebSearch` `TodoRead` `TodoWrite`

**Modelos:** `haiku` (rápido) · `sonnet` (recomendado) · `opus` (máxima capacidad)

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
| `code-reviewer` | Revisa código: bugs, antipatrones y mejoras | haiku |
| `git-helper` | Commits, ramas y resolución de conflictos | haiku |
| `test-writer` | Genera tests unitarios y de integración | sonnet |
| `doc-writer` | Documentación técnica en Markdown | sonnet |
| `refactor-agent` | Refactoriza código manteniendo funcionalidad | sonnet |

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

## Para desarrolladores — Setup

### Requisitos de desarrollo

- [Node.js](https://nodejs.org/) v20 o superior
- [Git](https://git-scm.com/)
- npm v9+

### Clonar e instalar

```bash
git clone https://github.com/TU_USUARIO/claude-dev-manager.git
cd claude-dev-manager
npm install
```

### Ejecutar en modo desarrollo

```bash
npm run dev
```

Esto arranca Electron con recarga automática al modificar ficheros.

### Estructura del código fuente

```
src/
├── main/
│   ├── main.js             ← proceso principal Electron
│   ├── tray.js             ← icono y menú de bandeja del sistema
│   ├── server.js           ← servidor Express embebido
│   ├── agents.js           ← lógica de agentes: CRUD, hashes, sync
│   ├── projects.js         ← lógica de proyectos: crear, importar, metadatos
│   ├── ai.js               ← integración Claude API (generación y sugerencias)
│   └── config.js           ← lectura/escritura de config.json
└── renderer/
    ├── index.html          ← shell principal
    ├── views/
    │   ├── projects.js     ← Vista Proyectos
    │   ├── agents.js       ← Vista Agentes (árbol + cards + editor)
    │   ├── wizard.js       ← Wizard primer arranque
    │   └── settings.js     ← Pantalla de Ajustes
    └── styles/
        └── main.css        ← estilos globales (tema oscuro VS Code)
```

### Scripts disponibles

```bash
npm run dev          # Desarrollo con recarga automática
npm run build        # Compilar el .exe portable para Windows
npm run build:dir    # Compilar sin empaquetar (para debug)
npm run lint         # ESLint
```

---

## Compilar el `.exe` portable

### Configuración de electron-builder

El fichero `electron-builder.yml` en la raíz del proyecto contiene:

```yaml
appId: com.tuusuario.claude-dev-manager
productName: Claude Dev Manager
copyright: Copyright © 2025

win:
  target:
    - target: portable
      arch: [x64]
  icon: assets/icon.ico

portable:
  artifactName: claude-dev-manager.exe

files:
  - src/**/*
  - assets/**/*
  - package.json

extraResources:
  - from: assets/
    to: assets/

asar: true
compression: maximum
```

### Proceso de build

```bash
# 1. Asegúrate de estar en la rama correcta y con todo commiteado
git status

# 2. Actualiza la versión en package.json si corresponde
# (edita "version": "1.0.0" manualmente o usa npm version)
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# 3. Compila
npm run build

# El .exe generado estará en:
# dist/claude-dev-manager.exe
```

### Publicar nueva versión en GitHub

```bash
# 1. Crea un tag con la versión
git tag v1.0.0
git push origin v1.0.0

# 2. En GitHub → Releases → New release
# - Selecciona el tag v1.0.0
# - Sube el fichero dist/claude-dev-manager.exe
# - Describe los cambios
# - Publish release
```

Los usuarios descargan el nuevo `.exe` y reemplazan el anterior en su carpeta.

### Icono de la aplicación

Coloca el icono en `assets/icon.ico` (formato ICO, 256×256px mínimo).  
Para generarlo desde un PNG: usa [ConvertICO](https://convertico.com/) o ImageMagick:

```bash
magick convert icon.png -resize 256x256 assets/icon.ico
```

---

## Configuración (`config.json`)

El fichero `config.json` se genera automáticamente en la primera ejecución. Estructura:

```json
{
  "version": "1.0.0",
  "apiKey": "sk-ant-...",
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
        "code-reviewer": "sha256:abc123...",
        "unity-dev": "sha256:def456..."
      }
    }
  ]
}
```

> ⚠️ **No commitees `config.json`** — contiene tu API key. Ya está en `.gitignore`.

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
Sí, Claude Dev Manager gestiona los agentes de Claude Code. Necesitas tener la extensión de Claude Code instalada en VS Code o la CLI de Claude Code.

**¿Puedo usar la app sin API key?**  
Sí. El modo manual para crear agentes siempre está disponible. Solo el modo asistido por IA y las sugerencias requieren API key.

**¿Los agentes se sincronizan automáticamente al modificarlos?**  
No. Los cambios quedan pendientes y tú decides cuándo sincronizar — por proyecto o todos a la vez. Esto evita cambios inesperados mientras trabajas.

**¿Qué pasa si borro un agente del nivel global?**  
Aparece como "eliminado pendiente" en los proyectos que lo tienen. Al sincronizar, se elimina la copia del proyecto. Los agentes de nivel 4 (propios del proyecto) nunca se eliminan.

**¿Puedo mover la carpeta de la app a otro lugar?**  
Sí, es completamente portable. Solo recuerda que las rutas de los proyectos registrados son absolutas — si mueves los proyectos tendrás que actualizarlas desde la app.

**¿Funciona en macOS o Linux?**  
La app está desarrollada y probada en Windows. Electron es multiplataforma, pero el build actual solo genera `.exe`. Con ajustes menores en `electron-builder.yml` podría compilarse para macOS (`.dmg`) o Linux (`.AppImage`).

---

## Documentación

| Documento | Descripción |
|---|---|
| `README.md` | Este fichero — guía completa para desarrolladores |
| `docs/MANUAL.html` | Guía visual de uso para el usuario final |
| `docs/SPEC.html` | Especificación técnica completa del proyecto |

---

## Tecnologías utilizadas

- [Electron](https://www.electronjs.org/) — framework de escritorio
- [Express](https://expressjs.com/) — servidor HTTP embebido
- [electron-builder](https://www.electron.build/) — compilación y empaquetado
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node) — integración con Claude API
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — tipografía monoespaciada
- [Tabler Icons](https://tabler.io/icons) — iconografía

---

## Licencia

MIT © 2025
