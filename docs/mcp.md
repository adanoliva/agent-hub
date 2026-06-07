# MCP en Agent Hub — Documento de evaluación e integración

> Estado: **Propuesta** · Fecha: 2026-06-07 · Versión objetivo: 2.4.0

---

## Índice

1. [Qué es MCP y por qué importa a Agent Hub](#1-qué-es-mcp-y-por-qué-importa-a-agent-hub)
2. [Estrategia: MCP como cliente universal](#2-estrategia-mcp-como-cliente-universal)
3. [Implementación por proveedor](#3-implementación-por-proveedor)
4. [Cambios en el formato de agente](#4-cambios-en-el-formato-de-agente)
5. [Arquitectura backend](#5-arquitectura-backend)
6. [Arquitectura frontend](#6-arquitectura-frontend)
7. [Roadmap de implementación por fases](#7-roadmap-de-implementación-por-fases)
8. [Riesgos y mitigaciones](#8-riesgos-y-mitigaciones)
9. [Decisiones pendientes](#9-decisiones-pendientes)

---

## 1. Qué es MCP y por qué importa a Agent Hub

**Model Context Protocol (MCP)** es el estándar abierto de Anthropic para conectar modelos de IA con herramientas y fuentes de datos externas. Define un protocolo cliente-servidor ligero (JSON-RPC 2.0 sobre stdio o HTTP/SSE) que permite a cualquier agente IA descubrir y ejecutar herramientas de terceros de forma uniforme.

Servidores MCP ya disponibles: **GitHub**, **Linear**, **Notion**, **Jira**, **Slack**, **PostgreSQL**, **Puppeteer**, **Filesystem**, entre docenas más.

### Por qué es valioso para Agent Hub

| Problema actual | Solución con MCP |
|---|---|
| Los agentes solo tienen acceso a herramientas nativas (`Read`, `Write`, `Bash`…) | Cualquier agente puede usar herramientas de GitHub MCP, Linear MCP, etc. sin cambiar código |
| Para que un agente actúe sobre GitHub hay que darle acceso bash a `gh` CLI | Se declara `mcp_server: github` y el agente tiene `create_issue`, `list_prs`, `merge_pr` tipadas |
| Integrar nuevas fuentes de contexto requiere modificar el backend de Agent Hub | El usuario conecta cualquier servidor MCP sin tocar el código de la app |

### Casos de uso de alto impacto

| Servidor MCP | Herramientas accesibles | Caso de uso en Agent Hub |
|---|---|---|
| `github` | `create_pr`, `list_issues`, `merge_branch`… | Agente que abre PRs, comenta issues, gestiona releases |
| `linear` | `create_issue`, `update_status`, `list_projects` | Agente que sincroniza tareas de desarrollo con Linear |
| `notion` | `create_page`, `query_database` | Agente que documenta features en Notion automáticamente |
| `postgres` | `query`, `list_tables` | Agente de análisis de datos sobre la BD del proyecto |
| `puppeteer` | `navigate`, `screenshot`, `click` | Agente QA que testea flujos de usuario en el navegador |

---

## 2. Estrategia: MCP como cliente universal

El objetivo es que **cualquier agente ejecutado por Agent Hub**, independientemente del proveedor de IA configurado, pueda consumir herramientas MCP. Los tres caminos de ejecución actuales son:

```
Proveedor CLI nativo
  claude --print / gemini-cli / aider…
  └── MCP nativo del CLI — configurado vía settings.json

Proveedor API (Anthropic SDK)
  @anthropic-ai/sdk → callAIRaw()
  └── MCP client del SDK — instanciado en tiempo de llamada

Subsistema CLI (GitHub Models / Custom API / providers sin acceso FS)
  subsystem-cli.js → loop multi-turno con TOOL calls
  └── MCP router en el loop — intercepta tool calls y los enruta al servidor MCP
```

Los tres caminos producen el mismo resultado desde el punto de vista del agente: sus herramientas MCP están disponibles.

---

## 3. Implementación por proveedor

### 3.1 CLI nativo (`cli`, `gemini-cli`, `aider-cli`, etc.)

**Mecanismo:** el Claude CLI ya soporta MCP de forma nativa. Lee la configuración desde `{projectPath}/.claude/settings.json`. Agent Hub solo necesita mantener sincronizado ese archivo.

**Flujo:**

```
callCLI(prompt, opts)
  │
  ├── mcp.syncCliSettings(opts.cwd, projectMcpServers)
  │     └── escribe/actualiza .claude/settings.json del proyecto
  │         con la sección mcpServers correspondiente
  └── spawn('claude', ['--print', ...], { cwd: opts.cwd })
        └── el CLI encuentra los servidores MCP y los inicia automáticamente
```

**Formato de `settings.json` gestionado por Agent Hub:**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

**Esfuerzo:** bajo. No se toca el loop de ejecución, solo se escribe un archivo JSON antes del spawn.

**Limitación:** solo funciona con CLIs que lean `settings.json` del CLI de Claude. Para `gemini-cli`, `aider`, etc. hay que mapear el equivalente de su sistema de configuración o inyectar las herramientas vía prompt (ver §3.3).

---

### 3.2 Proveedor API (Anthropic SDK)

**Mecanismo:** el SDK de TypeScript/Node.js incluye soporte MCP client. Se instancian los servidores MCP antes de la llamada y sus herramientas se pasan junto al request de mensajes.

**Flujo:**

```
callAIRaw(messages, systemPrompt, opts)
  │
  ├── si opts.mcpServers.length > 0:
  │   ├── mcp.spawnServers(opts.mcpServers)  ← inicia procesos stdio si no están ya corriendo
  │   ├── tools = await mcp.listTools(opts.mcpServers)  ← descubre herramientas
  │   └── loop:
  │       ├── client.messages.create({ tools: [...nativeTools, ...mcpTools], ... })
  │       ├── si stop_reason === 'tool_use':
  │       │   ├── para tool_use nativo → ejecutar localmente
  │       │   └── para tool_use MCP → mcp.callTool(serverName, toolName, input)
  │       └── añadir tool_result y continuar
  └── sin mcpServers → flujo actual sin cambios
```

**Esfuerzo:** medio. Requiere implementar el loop de tool use en `callAIRaw` (actualmente delega en el SDK sin loop explícito para tool calls), más la gestión del ciclo de vida de los procesos MCP.

**Dependencia:** verificar que `@anthropic-ai/sdk` tiene MCP client en la versión instalada. Si no, implementar el protocolo JSON-RPC directamente en `mcp.js` (ver §5.1).

---

### 3.3 Subsistema CLI (GitHub Models, Custom API, proveedores OpenAI-compatible)

El subsistema CLI implementa un loop multi-turno donde el modelo emite `TOOL: read / write / bash / grep` en texto plano y el subsistema los ejecuta. MCP se integra extendiendo este sistema de tool calls.

**Mecanismo:** inyectar las herramientas MCP disponibles en el system prompt del agente, y extender el parser de tool calls para reconocer llamadas MCP.

**Flujo:**

```
subsystem-cli.js execute(prompt, systemPrompt, config)
  │
  ├── si config.mcpServers.length > 0:
  │   ├── mcp.spawnServers(config.mcpServers)
  │   ├── mcpTools = await mcp.listTools(config.mcpServers)
  │   └── systemPrompt += buildMcpToolsBlock(mcpTools)
  │         ↳ añade al system prompt la descripción de cada herramienta MCP
  │           con su formato de invocación en texto plano
  │
  └── loop multi-turno:
      ├── callAIRaw(messages, systemPrompt, ...)
      ├── parseAgentResponse(response):
      │   ├── herramientas nativas: TOOL: read/write/bash/grep (sin cambios)
      │   └── herramientas MCP:    TOOL: mcp
      │                            SERVER: github
      │                            FUNCTION: create_issue
      │                            INPUT: {"title":"...","body":"..."}
      └── executeToolCall(toolCall):
          ├── tool nativo → comportamiento actual
          └── tool mcp → mcp.callTool(server, function, input) → devuelve resultado
```

**Formato de invocación MCP en el system prompt del agente:**

```
Para usar herramientas MCP, usa el siguiente formato:
TOOL: mcp
SERVER: github
FUNCTION: create_issue
INPUT:
{"title": "Bug en login", "body": "Descripción del bug", "labels": ["bug"]}
---
```

**Esfuerzo:** medio-alto. Requiere extender `parseAgentResponse` y `executeToolCall` en `subsystem-cli.js`, y diseñar el bloque de instrucciones MCP que el modelo entienda correctamente.

**Limitación clave:** la calidad del resultado depende de que el modelo siga el formato correctamente. Los modelos de alta calidad (GPT-4o, DeepSeek-V3) lo hacen bien; los modelos más pequeños pueden necesitar ajustar el prompt de instrucciones.

---

### 3.4 Resumen de cobertura

| Proveedor | Mecanismo | Esfuerzo | Disponible en Fase |
|---|---|---|---|
| `cli` (Claude CLI nativo) | `settings.json` nativo | Bajo | 1 |
| `api` (Anthropic SDK) | SDK MCP client + loop tool use | Medio | 2 |
| `github` (Azure OpenAI) | Subsistema CLI extendido | Medio-alto | 2 |
| Custom API (DeepSeek, Groq, etc.) | Subsistema CLI extendido | Medio-alto | 2 |
| Custom CLI (Aider, Goose) | `settings.json` si lo soportan; si no, prompt injection | Variable | 3 |
| `cline-cli` | MCP nativo de Cline | Bajo (ya lo tiene) | 1 |

---

## 4. Cambios en el formato de agente

### 4.1 Frontmatter extendido (opcional, backward-compatible)

```markdown
---
name: release-assistant
description: Gestiona el proceso de release en GitHub y Linear
model: claude-sonnet-4-6
tools:
  - Read
  - Write
mcp_servers:
  - github
  - linear
---

System prompt del agente aquí.
```

El campo `mcp_servers: string[]` es una lista de nombres de servidores MCP definidos a nivel de proyecto o global. Agentes sin el campo funcionan exactamente igual que ahora.

### 4.2 Configuración de servidores MCP

**A nivel de proyecto** (en `config.json`, dentro del objeto del proyecto):

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$env:GITHUB_TOKEN" }
    },
    "linear": {
      "type": "url",
      "url": "https://mcp.linear.app/sse",
      "headers": { "Authorization": "Bearer $env:LINEAR_API_KEY" }
    }
  }
}
```

**A nivel global** (en `config.json`, raíz):

```json
{
  "globalMcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  }
}
```

**Variables de entorno:** formato `$env:NOMBRE_VARIABLE` — se resuelven en tiempo de ejecución desde el entorno del proceso Electron. Los valores no se almacenan en `config.json`.

---

## 5. Arquitectura backend

### 5.1 Nuevo módulo `src/backend/mcp.js`

Responsabilidades centralizadas:

```
mcp.js
├── Gestión de configuración
│   ├── getMergedServers(projectId)     ← combina globales + proyecto
│   └── getServersForAgent(agent, projectId) ← filtra por agent.mcp_servers[]
│
├── Ciclo de vida de procesos stdio
│   ├── spawnServers(serverNames, projectId)   ← inicia procesos bajo demanda
│   ├── stopServers(serverNames)               ← para procesos al terminar
│   └── getServerStatus()                      ← estado de procesos en curso
│
├── Protocolo MCP (JSON-RPC 2.0)
│   ├── listTools(serverNames)                 ← descubre herramientas disponibles
│   └── callTool(serverName, toolName, input)  ← ejecuta una herramienta
│
├── Integración CLI
│   └── syncCliSettings(projectPath, servers)  ← escribe .claude/settings.json
│
└── Integración Subsistema CLI
    └── buildMcpToolsBlock(tools)  ← genera el bloque de instrucciones para el system prompt
```

Si el SDK de Anthropic no tiene cliente MCP disponible en la versión instalada, `mcp.js` implementa el protocolo JSON-RPC 2.0 directamente sobre stdio (`child_process.spawn`) o fetch (para servidores `url`). El protocolo es simple:

```
→ { jsonrpc: "2.0", id: 1, method: "tools/list" }
← { jsonrpc: "2.0", id: 1, result: { tools: [...] } }

→ { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_issue", arguments: {...} } }
← { jsonrpc: "2.0", id: 2, result: { content: [...] } }
```

### 5.2 Cambios en `ai.js`

- `callCLI`: llamar a `mcp.syncCliSettings(cwd, servers)` antes del spawn cuando el agente tiene `mcp_servers`.
- `callAIRaw` (rama `api`): instanciar loop de tool use si `opts.mcpServers.length > 0`.
- Nuevo helper `resolveAgentMcpServers(agent, projectId)` — devuelve la configuración completa de los servidores del agente.

### 5.3 Cambios en `subsystem-cli.js`

- `execute()`: detectar `config.mcpServers`, iniciar servidores, inyectar bloque MCP en system prompt.
- `parseAgentResponse()`: reconocer el formato `TOOL: mcp / SERVER: ... / FUNCTION: ... / INPUT: ...`.
- `executeToolCall()`: rama MCP que llama a `mcp.callTool(server, function, input)`.

### 5.4 Cambios en `orchestrator.js`

- Antes de ejecutar cada paso: `mcp.spawnServers(agent.mcp_servers, project.id)`.
- Después de cada paso (o al cancelar): `mcp.stopServers(...)` si los servidores son de uso exclusivo del paso.
- `stepResult` incluye `mcpToolsUsed: string[]` — lista de herramientas MCP invocadas.

### 5.5 Cambios en `agents.js`

- `parseAgentFile` y `serializeAgent` reconocen `mcp_servers: string[]`.

### 5.6 Nuevos endpoints en `server.js`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/mcp/servers` | Lista servidores (`?projectId=` para incluir los del proyecto) |
| POST | `/api/mcp/servers` | Crea servidor `{ scope: 'global'\|'project', projectId?, name, config }` |
| PUT | `/api/mcp/servers/:name` | Actualiza configuración |
| DELETE | `/api/mcp/servers/:name` | Elimina servidor |
| POST | `/api/mcp/servers/:name/test` | Testa la conexión y lista las herramientas descubiertas |
| GET | `/api/mcp/servers/:name/tools` | Lista herramientas del servidor |
| GET | `/api/mcp/status` | Estado de los procesos MCP en curso |

---

## 6. Arquitectura frontend

### 6.1 Nueva tab "MCP" en `Settings.tsx`

Dos secciones:

**Servidores globales**
- Lista de servidores MCP globales con estado (activo/inactivo/error).
- Botón "Añadir servidor" → modal: Nombre, Tipo (`stdio` | `url`), Comando/URL, Args, Variables de entorno (pares clave-valor).
- Botón "Probar conexión" → muestra las herramientas descubiertas en un popover.

**Servidores del proyecto** (visible cuando hay proyecto activo)
- Mismo CRUD. Indicador visual cuando un servidor del proyecto ya existe en globales (override).

### 6.2 Selector de servidores MCP en `AgentEditor.tsx`

Debajo del selector de skills (solo para agentes de nivel `project`):

```
Servidores MCP
[ github ] [ linear ] [ + Añadir ]
```

Multi-chip idéntico al selector de skills. Carga con `GET /api/mcp/servers?projectId=`. Se guarda en `agent.mcp_servers[]`.

### 6.3 Indicador en `AgentCard.tsx`

Si el agente tiene `mcp_servers.length > 0`: badge `ti-plug-connected` en verde junto a los tool pills.

### 6.4 Validación pre-ejecución en `AgentExecutePanel.tsx` y `ExecutionPanel.tsx`

Cuando el agente declara `mcp_servers`, mostrar antes del botón ejecutar:

```
Servidores MCP requeridos:
● github   ✓ configurado
● linear   ✗ no configurado   [Ir a Settings →]
```

El botón "Ejecutar" se deshabilita si hay servidores requeridos sin configurar.

---

## 7. Roadmap de implementación por fases

### Fase 1 — MCP para CLI nativo (3–5 días)

Objetivo: MCP funcional para el caso de uso más común sin cambiar el loop de ejecución.

- [ ] `src/backend/mcp.js`: CRUD de configuración, `syncCliSettings`, arranque/parada de procesos stdio, `listTools`, `callTool` vía JSON-RPC.
- [ ] `callCLI` en `ai.js`: llamar a `syncCliSettings` cuando el agente tiene `mcp_servers`.
- [ ] `parseAgentFile` / `serializeAgent` en `agents.js`: campo `mcp_servers`.
- [ ] API endpoints: `GET/POST/DELETE /api/mcp/servers`, `POST .../test`.
- [ ] Frontend: tab "MCP" en Settings — CRUD de servidores globales.

Resultado: el usuario configura un servidor MCP en Settings, un agente declara `mcp_servers: [github]`, y al ejecutar con proveedor CLI, el agente tiene acceso a las herramientas de GitHub.

---

### Fase 2 — MCP para API y Subsistema CLI (4–6 días)

Objetivo: cobertura completa de todos los proveedores.

- [ ] `callAIRaw` en `ai.js` (rama `api`): loop de tool use con herramientas MCP.
- [ ] `subsystem-cli.js`: inyección de bloque MCP en system prompt, parser de `TOOL: mcp`, `executeToolCall` para MCP.
- [ ] `orchestrator.js`: `spawnServers` antes del paso, `stopServers` al terminar, `mcpToolsUsed` en `stepResult`.
- [ ] Frontend: selector MCP en `AgentEditor`, badge en `AgentCard`, validación pre-ejecución en paneles.
- [ ] Frontend: servidores MCP por proyecto en Settings.

---

### Fase 3 — Ajustes y proveedores CLI alternativos (2–3 días)

Objetivo: afinar la integración para CLIs alternativos (Aider, Goose) y casos edge.

- [ ] Mapeo de la configuración MCP al formato propio de cada CLI alternativo, o fallback a prompt injection.
- [ ] Pool de procesos MCP reutilizables entre ejecuciones sucesivas (evitar cold start en orquestaciones).
- [ ] Tests de integración con servidores MCP reales (`@modelcontextprotocol/server-memory`, `@modelcontextprotocol/server-github`).
- [ ] Actualizar `docs/backend.md` y `docs/frontend.md`.

---

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Procesos MCP stdio lentos de arrancar (cold start) | Latencia en primera ejecución | Pool de procesos pre-iniciados; arranque al abrir el proyecto |
| Variables de entorno con credenciales en `config.json` | Seguridad | Solo almacenar `$env:VAR`; resolver en runtime; nunca loguear los valores reales |
| Servidores MCP de terceros inestables | Fallos en orquestaciones | Timeout por llamada (30s); el paso sigue con `status: 'warning'` si MCP falla |
| El SDK de Anthropic no tiene MCP client disponible | Bloquea rama api de Fase 2 | `mcp.js` implementa el protocolo directamente; no depender del SDK para esto |
| El modelo del subsistema CLI no sigue el formato `TOOL: mcp` | Tool calls MCP silenciosas fallando | Validar en el loop y añadir al handoff un aviso si se detectan intentos malformados |
| Conflicto de nombres entre herramientas nativas y MCP | Comportamiento impredecible | Namespace explícito: herramientas MCP siempre prefijadas con `{serverName}__` |

---

## 9. Decisiones pendientes

1. **¿Servidores MCP tipo `url` (HTTP/SSE remoto) desde Fase 1 o solo `stdio`?**
   Los servidores `url` son más simples de conectar (no spawnan proceso) pero requieren gestión de auth HTTP. Propuesta: soportar ambos desde Fase 1, ya que el protocolo JSON-RPC es el mismo; solo cambia el transporte.

2. **¿`mcpServers` del proyecto vive en `config.json` o en `{projectPath}/.agent-hub/mcp.json`?**
   En `config.json` para coherencia con el resto de configuración de proyecto. La sincronización a `settings.json` del CLI la hace `mcp.syncCliSettings` en cada ejecución.

3. **¿Pool de procesos MCP compartido entre proyectos o uno por proyecto?**
   Propuesta: uno por proyecto (aislamiento), pero con caché por nombre de servidor dentro del mismo proyecto para no reiniciar entre pasos de una orquestación.

4. **¿Mostrar en la UI las herramientas MCP disponibles para un agente antes de ejecutar?**
   Sería útil para depuración. Se puede añadir en Fase 2 como panel colapsable en `ExecutionPanel`.

---

*Documento creado: 2026-06-07. Actualizar secciones al avanzar en la implementación.*
