# Agent Hub — Contexto del proyecto

> Versión actual: **1.9.4** · Actualizar este campo en cada release.

@docs/backend.md
@docs/frontend.md

## Qué es esto

**Agent Hub** es una aplicación de escritorio **Electron + Express + React 19 + TypeScript** para gestionar agentes de IA y proyectos de desarrollo. Portable `.exe` para Windows x64.

Permite organizar proyectos por categorías, crear y sincronizar agentes Claude Code (`.md` con frontmatter YAML), chatear con IA (CLI / Anthropic API / GitHub Copilot), generar contexto de proyecto y ejecutar agentes directamente sobre un proyecto.

La documentación técnica completa está en [`docs/backend.md`](docs/backend.md) y [`docs/frontend.md`](docs/frontend.md).

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Shell | Electron (main process + preload) |
| API | Express 4 en `localhost:3737` |
| Renderer | React 19 + Vite 8 + TypeScript |
| Estado | Zustand 5 |
| Estilos | CSS global (`styles.css`) + variables CSS, sin preprocesadores |
| Iconos | Tabler Icons CDN v3.6.0 (`ti ti-*`) |
| Fuentes | JetBrains Mono + Syne (Google Fonts) |
| IA | Claude CLI · Anthropic SDK · GitHub Models (Azure) |
| Build | electron-builder → portable `.exe` x64 |

---

## Comandos

```bash
npm run dev      # Electron + Vite dev server (DevTools abiertos)
npm run build    # Portable .exe en dist/
npm run release  # Build + publish a GitHub Releases
```

Para usar un directorio de datos distinto al raíz en dev:

```powershell
$env:CDM_DATA_DIR = "C:\MiCarpetaDatos"
npm run dev
```

Para publicar un release:

```powershell
$env:GH_TOKEN = (Get-Content .token)
npm run release
```

---

## Convenciones

- **Español en UI**, inglés en código y tipos.
- **Estado centralizado** en Zustand (`store/index.ts`). `useState` solo para estado genuinamente local.
- **Un solo `styles.css`**; sin CSS Modules ni preprocesadores.
- **Sin comentarios redundantes**: solo cuando el "por qué" no es obvio.
- **No actualización optimista**: esperar confirmación del servidor antes de actualizar el estado local.
- **`window.api` con optional chaining** (`api?.method?.()`) — el renderer puede correr fuera de Electron.
- **`onConfirm` de Modal lanza `throw`**, no `return`, para mantener el modal abierto si falla validación.

---

## Checklist al actualizar versión

1. `version` en `package.json`
2. `version` en `DEFAULT_CONFIG` de `src/backend/config.js`
3. La línea `> Versión actual:` de este archivo
4. Commit y tag → `npm run release`

---

## Reglas de oro

1. **No enseñar lo básico** — el código habla por sí mismo; los comentarios son para invariantes no obvias.
2. **Menos es más** — ninguna abstracción, flag ni parámetro que no exija el requisito actual.
3. **El prompt en tiempo real manda** — las instrucciones del usuario en la conversación activa tienen prioridad sobre cualquier convención de este archivo.
4. **Actualizar la documentación siempre** — cualquier funcionalidad nueva o modificación existente debe reflejarse en `docs/backend.md` o `docs/frontend.md` antes de cerrar la tarea.
