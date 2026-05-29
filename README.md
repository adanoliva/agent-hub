# Agent Hub

Aplicación de escritorio para gestionar agentes de IA y proyectos de desarrollo. Portable `.exe` para Windows x64.

## Qué hace

- **Agentes**: crea, edita y sincroniza agentes Claude Code (archivos `.md` con frontmatter YAML) organizados en una jerarquía de 4 niveles: global → categoría → tecnología → proyecto.
- **Proyectos**: gestiona proyectos de desarrollo con su contexto de IA (`CLAUDE.md` / `copilot-instructions.md`), sincronización de agentes y ejecución directa.
- **Chat**: conversación multi-turno con agentes activos, soporte `@mention`, historial por proyecto.
- **Orquestaciones**: cadenas de agentes que se ejecutan en secuencia, con protocolo de handoff entre pasos para eficiencia de tokens.
- **Directorio de agentes**: sincronización automática desde un repositorio GitHub externo con resolución de conflictos.

## Stack

| Capa | Tecnología |
|---|---|
| Shell | Electron |
| API | Express 4 en `localhost:3737` |
| Renderer | React 19 + Vite + TypeScript |
| Estado | Zustand 5 |
| IA | Claude CLI · Anthropic SDK · GitHub Models |
| Build | electron-builder → portable `.exe` x64 |

## Requisitos

- Windows 10/11 x64
- [Claude Code CLI](https://claude.ai/download) instalado en PATH (si usas el provider `cli`)

## Desarrollo

```bash
npm install
npm run dev        # Electron + Vite dev server
npm run build      # Portable .exe en dist/
```

Para usar un directorio de datos distinto al raíz en dev:

```powershell
$env:CDM_DATA_DIR = "C:\MiCarpetaDatos"
npm run dev
```

## Documentación técnica

- [Backend — API, módulos Node.js, orquestaciones](docs/backend.md)
- [Frontend — componentes React, store, estilos](docs/frontend.md)

## Proveedores de IA soportados

| Provider | Requisito |
|---|---|
| `cli` | Claude Code instalado en PATH |
| `api` | API key de Anthropic |
| `github` | Token de GitHub con acceso a GitHub Models |
