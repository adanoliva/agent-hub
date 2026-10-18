# Agent Hub · v2.7.0

Aplicación de escritorio para gestionar agentes de IA y proyectos de desarrollo. Portable `.exe` para Windows x64.

## Qué hace

- **Agentes**: crea, edita y sincroniza agentes IA (archivos `.md` con frontmatter YAML) organizados en tres niveles: global → categoría → proyecto.
- **Skills**: bloques de contexto tecnológico (React, PostgreSQL, Unity…). Se **detectan solas** por el stack del proyecto (`package.json`, `pom.xml`, `go.mod`, `Dockerfile`…, también en monorepos) y se inyectan en cada ejecución; con Claude Code se instalan además como skills nativas en `.claude/skills/`. Generables con IA en ES/EN.
- **MCP**: integración nativa con servidores Model Context Protocol (stdio y HTTP/SSE). Pool de procesos con refcounting, catálogo de servidores predefinidos, variables `$env:VAR` resueltas en runtime, configuración global y por proyecto.
- **Proyectos**: gestiona proyectos de desarrollo con su contexto de IA (`AGENTS.md`, que leen todos los motores, más `CLAUDE.md` / `copilot-instructions.md` / `GEMINI.md`), sincronización de agentes y ejecución directa.
- **Agnóstico del proveedor**: agentes, skills, contexto y orquestaciones funcionan igual con un CLI nativo (se lanza dentro del proyecto) o con una API (Agent Hub le da herramientas de fichero y shell). *Prueba real* en Ajustes verifica de punta a punta que el proveedor lee un proyecto.
- **Chat**: conversación multi-turno con `@mention` de agentes e historial por proyecto. Con un proyecto seleccionado lee sus ficheros, contexto y skills en **solo lectura**, con cualquier proveedor.
- **CLI `agent-hub`**: ejecuta agentes sobre un proyecto desde cualquier terminal; se instala desde Ajustes.
- **Extensión de VS Code**: vista lateral del proyecto abierto, ejecutar agentes (también sobre el fichero o la selección), ejecutar y crear orquestaciones con logs en directo, estimación de coste y gates de revisión. Se instala desde Ajustes; requiere la app abierta ([detalles](extensions/vscode/README.md)).
- **Orquestaciones DAG**: flujos multiagente en grafo dirigido acíclico. Los nodos sin dependencias entre sí se ejecutan **en paralelo** por niveles topológicos. Incluye canvas 2D interactivo, **scripts determinísticos** (sin IA), **gates HITL**, **quality score** automático, **git checkpointing**, **ops ledger**, reanudación de ejecuciones interrumpidas, **timeout por paso**, reintentos ante errores transitorios, **cancelación inmediata** y **estimación de coste** antes de ejecutar.
- **Directorio de agentes**: sincronización automática (agentes + skills) desde un repositorio GitHub externo con resolución de conflictos.
- **Búsqueda**: búsqueda global de agentes y skills por nombre y descripción con debounce y badges de origen.

## Stack

| Capa | Tecnología |
|---|---|
| Shell | Electron |
| API | Express 4 en `localhost:3737` |
| Renderer | React 19 + Vite + TypeScript |
| Estado | Zustand 5 |
| IA | Claude Code CLI · Copilot CLI · Antigravity CLI · Anthropic SDK · GitHub Models · OpenAI · Gemini · Mistral · Grok · DeepSeek · Groq · OpenRouter · Perplexity |
| MCP | stdio · HTTP/SSE · pool con refcounting · catálogo de servidores |
| Build | electron-builder → portable `.exe` x64 |

## Requisitos

- Windows 10/11 x64
- Uno de: [Claude Code](https://claude.ai/download), Copilot CLI (`npm i -g @github/copilot`) o Antigravity CLI (`agy`) en el PATH, o una API key de un proveedor compatible

## Desarrollo

```bash
npm install
npm run dev        # Electron + Vite dev server
npm run build      # Portable .exe en dist/
npm run screenshots  # Capturas de docs y web con datos de demostración
```

Para usar un directorio de datos distinto al raíz en dev:

```powershell
$env:CDM_DATA_DIR = "C:\MiCarpetaDatos"
npm run dev
```

## Novedades v2.7.0

- **Extensión de VS Code** (`extensions/vscode/`): mini Agent Hub para el proyecto abierto. Vista lateral con agentes, orquestaciones y ejecuciones recientes; ejecutar agentes sobre una tarea o sobre el fichero/selección actual; ejecutar orquestaciones con estimación de coste, logs en directo y gates de revisión; crear orquestaciones lineales. Se instala y actualiza desde Ajustes → General; la extensión lleva la misma versión que la app.
- **`@agenthub` en el chat de VS Code**: el chat de proyecto (solo lectura) dentro de la vista de chat del editor, más `/run <agente> <tarea>` y `/agents`.
- **Progreso en directo en `/run`** (`?stream=1`, NDJSON): herramientas y texto del agente a medida que trabaja con Claude CLI y con las APIs.
- **Presupuesto máximo por orquestación** (botón *Ejecución* del editor): se detiene al superar el límite, sin añadir un nodo `budget-guard`.
- **Diff de cada paso**: con Git activado, la tarjeta de cada paso (y el informe de la extensión) muestra lo que cambió el agente. Los checkpoints ya no incluyen `.agent-hub/` y se hacen sin shell.
- **Caché de prompts con la API de Anthropic**: el system prompt y la conversación del subsistema se leen de caché en cada turno (lectura a 0,1× del precio de entrada), y el coste se calcula con esas tarifas.

## Novedades v2.6.0

- **Timeouts por paso** (10 min por defecto) además del global, editables desde el editor de orquestación (botón *Ejecución*) junto a turnos máximos y *detener ante el primer error*. Al vencer, se mata el árbol de procesos del CLI.
- **Reintentos automáticos** ante 429, 5xx y errores de red, sin repetir la conversación entera con las APIs.
- **Respuestas largas completas** con la API: 16k tokens de salida con Anthropic y continuación automática si se cortan; nunca se escribe un fichero a medias.
- **Estimación de coste** antes de ejecutar una orquestación: tokens mínimos por paso y media real de las ejecuciones anteriores. Precios de Anthropic actualizados.
- **Cancelación inmediata**: cancelar una orquestación, Ctrl+C en `agent-hub run` o cerrar el chat detienen el agente en el acto.
- **Prueba real del proveedor** en Ajustes: verificada con Claude Code, Copilot y Antigravity CLI.

## Novedades v2.5.0

- **Skills automáticas** por stack del proyecto, también como skills nativas de Claude Code.
- **Ejecución unificada** (`runInProject`): orquestador, `/run` y chat comparten el mismo camino con cualquier proveedor.
- **CLI `agent-hub`** instalable desde Ajustes.
- CLIs verificados: Claude Code, Copilot CLI y Antigravity CLI (Gemini CLI, Codex, Aider, Cline y Goose se retiran y se migran solos).

## Documentación técnica

- [Backend — API, módulos Node.js, orquestaciones](docs/backend.md)
- [Frontend — componentes React, store, estilos](docs/frontend.md)
- [Guía MCP — configuración y uso de servidores MCP](docs/mcp-guide.md)

## Proveedores de IA soportados

| Tipo | Provider | Requisito |
|---|---|---|
| **CLI (Nativo)** | `cli` (Claude Code), `copilot-cli`, `antigravity-cli` | Binario instalado en PATH |
| **API (Cloud)** | `api`, `openai`, `github`, `gemini-api`, `mistral`, `grok`, `deepseek`, `groq`, `openrouter`, `perplexity` | API Key configurada en Ajustes |
| **Personalizado** | **Custom Providers** | Configuración manual o importación de JSON (soporta Azure/GAIA) |
