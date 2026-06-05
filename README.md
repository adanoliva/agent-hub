# Agent Hub

Aplicación de escritorio para gestionar agentes de IA y proyectos de desarrollo. Portable `.exe` para Windows x64.

## Qué hace

- **Agentes**: crea, edita y sincroniza agentes Claude Code (archivos `.md` con frontmatter YAML) organizados en tres niveles: global → categoría → proyecto.
- **Skills**: bloques de contexto tecnológico (React, PostgreSQL, Unity…) que se inyectan automáticamente en el system prompt del agente al ejecutar. Generables con IA en ES/EN.
- **Proyectos**: gestiona proyectos de desarrollo con su contexto de IA (`CLAUDE.md` / `copilot-instructions.md`), sincronización de agentes, skills asignadas y ejecución directa.
- **Chat**: conversación multi-turno con agentes activos, soporte `@mention`, historial por proyecto.
- **Orquestaciones**: cadenas de agentes que se ejecutan en secuencia con protocolo HANDOFF, **scripts determinísticos** (sin IA), **gates HITL** para revisión humana entre pasos, **quality score** automático por paso, **git checkpointing**, **ops ledger** de operaciones y reanudación de ejecuciones interrumpidas.
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

## Documentación técnica

- [Backend — API, módulos Node.js, orquestaciones](docs/backend.md)
- [Frontend — componentes React, store, estilos](docs/frontend.md)

## Proveedores de IA soportados

| Tipo | Provider | Requisito |
|---|---|---|
| **CLI (Nativo)** | `cli`, `gemini-cli`, `codex-cli`, `copilot-cli`, `aider-cli`, `cline-cli`, `goose-cli` | Binario instalado en PATH |
| **API (Cloud)** | `api`, `openai`, `github`, `gemini-api`, `mistral`, `grok`, `deepseek`, `groq`, `openrouter`, `perplexity` | API Key configurada en Ajustes |
| **Personalizado** | **Custom Providers** | Configuración manual o importación de JSON (soporta Azure/GAIA) |
