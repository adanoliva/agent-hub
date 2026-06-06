# Agent Hub · v2.3.0

Aplicación de escritorio para gestionar agentes de IA y proyectos de desarrollo. Portable `.exe` para Windows x64.

## Qué hace

- **Agentes**: crea, edita y sincroniza agentes Claude Code (archivos `.md` con frontmatter YAML) organizados en tres niveles: global → categoría → proyecto.
- **Skills**: bloques de contexto tecnológico (React, PostgreSQL, Unity…) que se inyectan automáticamente en el system prompt del agente al ejecutar. Generables con IA en ES/EN.
- **Proyectos**: gestiona proyectos de desarrollo con su contexto de IA (`CLAUDE.md` / `copilot-instructions.md`), sincronización de agentes, skills asignadas y ejecución directa.
- **Chat**: conversación multi-turno con agentes activos, soporte `@mention`, historial por proyecto.
- **Orquestaciones DAG**: flujos multiagente en grafo dirigido acíclico. Los nodos sin dependencias entre sí se ejecutan **en paralelo** por niveles topológicos. Incluye canvas 2D interactivo, **scripts determinísticos** (sin IA), **gates HITL**, **quality score** automático, **git checkpointing**, **ops ledger** y reanudación de ejecuciones interrumpidas.
- **Directorio de agentes**: sincronización automática (agentes + skills) desde un repositorio GitHub externo con resolución de conflictos.
- **Búsqueda**: búsqueda global de agentes y skills por nombre y descripción con debounce y badges de origen.

## Stack

| Capa | Tecnología |
|---|---|
| Shell | Electron |
| API | Express 4 en `localhost:3737` |
| Renderer | React 19 + Vite + TypeScript |
| Estado | Zustand 5 |
| IA | Claude CLI · Anthropic SDK · GitHub Models · DeepSeek · Groq · OpenRouter · Perplexity |
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

## Novedades v2.3.0

- **Modelo DAG**: cada nodo declara sus dependencias con `dependsOn[]`. Nodos sin dependencias se ejecutan en paralelo con `Promise.allSettled` por niveles topológicos.
- **Canvas 2D interactivo**: lienzo HTML+SVG con aristas Bézier, port-in/out, auto-layout topológico, detección de ciclos y paleta colapsable con tabs Agentes/Scripts.
- **Scripts externos**: crea tus propios scripts `.js` en `user-scripts/`, se cargan en caliente y aparecen en la paleta. Sandbox Node.js con API `fs` segura.
- **Migración automática**: las orquestaciones lineales antiguas (`agents[]`) se convierten al modelo DAG de forma transparente al leerlas.

## Documentación técnica

- [Backend — API, módulos Node.js, orquestaciones](docs/backend.md)
- [Frontend — componentes React, store, estilos](docs/frontend.md)

## Proveedores de IA soportados

| Tipo | Provider | Requisito |
|---|---|---|
| **CLI (Nativo)** | `cli`, `gemini-cli`, `codex-cli`, `copilot-cli`, `aider-cli`, `cline-cli`, `goose-cli` | Binario instalado en PATH |
| **API (Cloud)** | `api`, `openai`, `github`, `gemini-api`, `mistral`, `grok`, `deepseek`, `groq`, `openrouter`, `perplexity` | API Key configurada en Ajustes |
| **Personalizado** | **Custom Providers** | Configuración manual o importación de JSON (soporta Azure/GAIA) |
