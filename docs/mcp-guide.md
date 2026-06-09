# Guía de configuración y uso de MCP

> Agent Hub — Model Context Protocol
> Versión del motor: **2.4.0** · Fecha: 2026-06-09

Esta guía cubre la configuración de servidores MCP en Agent Hub, su asociación con agentes y su comportamiento durante la ejecución. Se asume familiaridad con el concepto de agentes y proveedores de IA de la app.

---

## Índice

1. [Qué es MCP y para qué sirve](#1-qué-es-mcp-y-para-qué-sirve)
2. [Servidores disponibles sin credenciales](#2-servidores-disponibles-sin-credenciales)
3. [Añadir un servidor desde el catálogo](#3-añadir-un-servidor-desde-el-catálogo)
4. [Añadir un servidor manualmente](#4-añadir-un-servidor-manualmente)
5. [Variables de entorno y credenciales](#5-variables-de-entorno-y-credenciales)
6. [Servidores globales vs. de proyecto](#6-servidores-globales-vs-de-proyecto)
7. [Asociar servidores MCP a un agente](#7-asociar-servidores-mcp-a-un-agente)
8. [Cómo funciona MCP durante la ejecución](#8-cómo-funciona-mcp-durante-la-ejecución)
9. [Probar la conexión con un servidor](#9-probar-la-conexión-con-un-servidor)
10. [Tipos de transporte: stdio vs. url](#10-tipos-de-transporte-stdio-vs-url)
11. [Pool de procesos y rendimiento](#11-pool-de-procesos-y-rendimiento)
12. [Solución de problemas](#12-solución-de-problemas)

---

## 1. Qué es MCP y para qué sirve

**Model Context Protocol (MCP)** es un estándar abierto (Anthropic) para conectar agentes de IA con herramientas y fuentes de datos externas usando JSON-RPC 2.0. Define un protocolo cliente-servidor por el que el agente puede descubrir qué herramientas hay disponibles y llamarlas durante su ejecución.

Sin MCP, los agentes solo tienen acceso a las herramientas nativas de Agent Hub (`Read`, `Write`, `Bash`, `Grep`…). Con MCP, cualquier agente puede usar herramientas tipadas de servicios externos sin tocar el código de la app:

| Sin MCP | Con MCP |
|---|---|
| Para actuar en GitHub hay que darle al agente acceso bash a `gh` CLI y que improvise la sintaxis | Se declara `mcp_servers: github` y el agente tiene `create_issue`, `list_prs`, `merge_branch` con tipos y validación |
| Consultar una BD requiere que el agente genere y ejecute SQL en bash | `mcp_servers: postgres` → el agente llama a `query` y recibe resultados estructurados |
| Crear una página en Notion es imposible sin credenciales expuestas | `mcp_servers: notion` → `create_page` con los campos que el agente necesite |

---

## 2. Servidores disponibles sin credenciales

Agent Hub incluye un catálogo de servidores MCP preconfigurables desde **Ajustes → MCP → Catálogo**. Los servidores "sin credenciales" se auto-instalan al arrancar la app por primera vez y no requieren ninguna configuración adicional:

| Servidor | Qué hace |
|---|---|
| `fetch` | Descarga el contenido de una URL y lo devuelve al agente (HTML, JSON, texto) |
| `memory` | Almacenamiento clave-valor persistente entre ejecuciones distintas del mismo agente |
| `sequential-thinking` | Fuerza al modelo a razonar paso a paso antes de responder — útil para tareas analíticas complejas |

### Cuándo usar `fetch`

`fetch` es útil con proveedores que no tienen acceso nativo a la web (API de Anthropic, GitHub Models, proveedores custom). Si usas Claude Code CLI con la herramienta `WebFetch` activada en el agente, este servidor es redundante — el CLI ya tiene acceso web nativo.

### Cuándo usar `memory`

Útil cuando un agente necesita recordar información entre ejecuciones distintas: preferencias del usuario, estado de un proceso de varias etapas, listado de archivos ya procesados. La memoria se almacena localmente en un archivo gestionado por el servidor.

### Cuándo usar `sequential-thinking`

Este servidor no añade herramientas de acceso a datos — aporta estructura de razonamiento. Úsalo cuando el agente tiende a responder de forma apresurada o superficial en tareas que requieren análisis detenido.

---

## 3. Añadir un servidor desde el catálogo

1. Ve a **Ajustes → MCP**.
2. En la sección **Catálogo**, selecciona la tab "Con credenciales" para ver los servidores que requieren configuración (GitHub, Jira, PostgreSQL, Slack…).
3. Haz click en **Añadir** junto al servidor que quieras.
4. Se abre el modal pre-rellenado con el comando y los args del servidor. Solo tienes que rellenar las variables de entorno con tus credenciales.
5. Guarda — el servidor aparece en "Mis servidores" listo para asignarse a agentes.

Los servidores del catálogo con credenciales típicamente necesitan un token de API o una URL de conexión. Cada variable de entorno requerida se muestra en la card del catálogo antes de añadir el servidor.

---

## 4. Añadir un servidor manualmente

Para servidores MCP que no están en el catálogo:

1. Ve a **Ajustes → MCP → Mis servidores**.
2. Haz click en **Añadir manualmente**.
3. Rellena el formulario:

| Campo | Descripción |
|---|---|
| **Nombre** | Identificador único del servidor — el agente lo referenciará por este nombre (ej: `github`, `mi-bd`) |
| **Tipo** | `stdio` para servidores locales (proceso spawneado), `url` para servidores HTTP/SSE remotos |
| **Descripción** | Texto libre — aparece como tooltip en "Mis servidores" (opcional, pero recomendado) |
| **Comando** | *(stdio)* Ejecutable que arranca el servidor. Normalmente `npx` o la ruta a un binario |
| **Args** | *(stdio)* Argumentos del comando, uno por línea |
| **Variables de entorno** | Pares `CLAVE=$env:VARIABLE`, uno por línea. Ver §5 |
| **URL** | *(url)* Endpoint HTTP/SSE del servidor remoto |
| **Headers** | *(url)* Cabeceras HTTP, formato `Authorization=Bearer $env:TOKEN` |

### Ejemplo: servidor stdio con npx

```
Nombre:  github
Tipo:    stdio
Comando: npx
Args:
  -y
  @modelcontextprotocol/server-github
Variables de entorno:
  GITHUB_TOKEN=$env:GITHUB_TOKEN
```

### Ejemplo: servidor url remoto

```
Nombre:  linear
Tipo:    url
URL:     https://mcp.linear.app/sse
Headers:
  Authorization=Bearer $env:LINEAR_API_KEY
```

---

## 5. Variables de entorno y credenciales

Agent Hub usa el formato `$env:NOMBRE_VARIABLE` para referencias a variables de entorno. **Los valores reales nunca se almacenan en `config.json`** — solo la referencia. Se resuelven en tiempo de ejecución desde el entorno del proceso Electron.

```
GITHUB_TOKEN=$env:GITHUB_TOKEN
```

Esto significa: "en el momento de arrancar el servidor, toma el valor de la variable de entorno `GITHUB_TOKEN` del sistema operativo".

### Cómo definir las variables en Windows

```powershell
# Para la sesión actual
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxx"

# Para que persistan entre reinicios, añádelas en:
# Panel de control → Sistema → Variables de entorno del sistema
```

Si Electron ya está corriendo cuando defines la variable, debes reiniciar la app para que el proceso la detecte.

### Alternativa: valores literales

Aunque no es recomendable para credenciales, puedes poner el valor directamente:

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

Esto almacena el token en texto plano en `config.json`. Útil para valores que no son secretos (una URL base, un nombre de base de datos).

---

## 6. Servidores globales vs. de proyecto

Agent Hub gestiona dos ámbitos de configuración de servidores:

| Ámbito | Dónde se guarda | Alcance |
|---|---|---|
| **Global** | `config.json` → `globalMcpServers` | Disponible en todos los proyectos y agentes |
| **Proyecto** | `config.json` → `projects[i].mcpServers` | Solo para ese proyecto y sus agentes |

Cuando un agente declara `mcp_servers: [nombre]`, el motor busca el servidor primero en el proyecto y luego en los globales. Los servidores de proyecto sobreescriben los globales si tienen el mismo nombre.

### Cuándo usar globales

- Servidores que usas en múltiples proyectos: `fetch`, `memory`, `sequential-thinking`.
- Herramientas de productividad transversal: tu instancia de Linear, Jira, Slack corporativo.

### Cuándo usar de proyecto

- Servidores con credenciales específicas del proyecto: una BD PostgreSQL del proyecto, un repo de GitHub concreto.
- Cuando distintos proyectos necesitan el mismo tipo de servidor con configuración diferente (ej: dos instancias de `postgres` con conexiones a BDs distintas).

Para cambiar el ámbito en el que ves los servidores, usa el toggle **Global / Proyecto** en "Mis servidores".

---

## 7. Asociar servidores MCP a un agente

Una vez que el servidor está configurado (sección "Mis servidores"), hay que decirle a cada agente qué servidores puede usar.

### Desde el editor de agentes

1. Abre el agente (click en la card → editar).
2. En la sección **Servidores MCP**, usa el selector para añadir los servidores disponibles.
3. Los servidores añadidos aparecen como chips eliminables.
4. Guarda el agente.

Internamente, esto escribe el campo `mcp_servers` en el frontmatter del fichero `.md` del agente:

```markdown
---
name: release-assistant
description: Gestiona el proceso de release en GitHub
model: sonnet
tools:
  - Read
  - Write
mcp_servers: github, linear
---

Eres un asistente de releases...
```

El campo acepta nombres separados por comas. Los nombres deben coincidir exactamente con los nombres configurados en "Mis servidores".

### Indicador visual en la card

Los agentes que tienen servidores MCP asociados muestran un badge verde `⊞` con el número de servidores en su card. Al pasar el cursor sobre el badge se listan los nombres de los servidores.

---

## 8. Cómo funciona MCP durante la ejecución

El comportamiento varía según el proveedor de IA configurado en el proyecto:

### Proveedor CLI nativo (`claude`)

Es el camino más directo. Antes de cada ejecución, Agent Hub escribe (o actualiza) el fichero `{projectPath}/.claude/settings.json` con los servidores MCP del agente:

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

El CLI de Claude lee este fichero al arrancar y activa los servidores MCP automáticamente. No hay interacción adicional — el CLI gestiona el ciclo de vida de los procesos stdio.

### Proveedores CLI alternativos (`gemini-cli`)

Para `gemini-cli`, Agent Hub sincroniza la configuración en `~/.gemini/settings.json` con el mismo formato. Los CLIs que no tienen soporte nativo de MCP reciben las herramientas disponibles inyectadas en el system prompt (prompt injection), y un parser en el loop multi-turno intercepta las llamadas y las ejecuta.

### Proveedores API (`api`, `github`, custom)

Cuando el proveedor no tiene CLI (Anthropic SDK directo, Azure OpenAI, DeepSeek, Groq…), el agente usa el subsistema CLI. Las herramientas MCP se describen en el system prompt con el formato de invocación:

```
Para usar herramientas MCP, usa el siguiente formato:
TOOL: mcp
SERVER: github
FUNCTION: create_issue
INPUT:
{"title": "Bug en login", "body": "Descripción del bug", "labels": ["bug"]}
---
```

El subsistema CLI ejecuta la llamada y devuelve el resultado al agente en el turno siguiente. La calidad depende de que el modelo siga el formato — los modelos de alta capacidad (GPT-4o, DeepSeek-V3, Claude Sonnet) lo hacen de forma fiable.

### En orquestaciones

Cuando un nodo de una orquestación tiene un agente con `mcp_servers`, el orquestador:

1. Adquiere los procesos MCP necesarios antes de ejecutar el paso (`acquireServers`).
2. Ejecuta el paso (IA + tool calls).
3. Libera los procesos al terminar (`releaseServers`).

Los procesos no se paran inmediatamente al liberar — entran en un periodo de inactividad de 30 segundos antes de cerrarse. Si el siguiente paso usa los mismos servidores, los encuentra ya arrancados (sin cold start).

---

## 9. Probar la conexión con un servidor

Antes de asignar un servidor a un agente, conviene verificar que la conexión funciona:

1. Abre **Ajustes → MCP → Mis servidores**.
2. Haz click en el icono de edición del servidor.
3. En el modal, haz click en **Probar conexión**.
4. Si la conexión es correcta, se muestran las herramientas que el servidor expone.
5. Si hay un error, se muestra el mensaje de error para diagnóstico.

La prueba arranca el proceso stdio (o conecta al endpoint HTTP), ejecuta `tools/list` (protocolo MCP) y muestra el resultado. Es el mismo mecanismo que usará el agente durante la ejecución.

### Qué significan los resultados

- **Lista de herramientas**: el servidor está correctamente configurado y el agente podrá usarlas.
- **"Timeout"**: el comando no arrancó en tiempo. Verifica que `npx` o el ejecutable están en PATH.
- **"Connection refused"**: para servidores `url`, el endpoint no está accesible desde tu máquina.
- **"spawn error"**: el comando del servidor no existe. Comprueba el nombre del paquete y que tienes Node.js instalado.

---

## 10. Tipos de transporte: stdio vs. url

### stdio (recomendado para servidores locales)

El servidor MCP se ejecuta como un proceso hijo de Agent Hub. Comunica por stdin/stdout. La app gestiona el ciclo de vida del proceso.

```
Ventajas:
- No requiere infraestructura adicional — solo Node.js/Python instalado
- Más rápido: comunicación local sin overhead de red
- Las variables de entorno se inyectan directamente al proceso

Desventajas:
- Requiere que el paquete esté instalado o que npx pueda descargarlo
- El cold start (primera vez) puede tardar varios segundos si npx descarga el paquete
```

**Cold start de npx:** la primera vez que se arranca un servidor con `npx -y @paquete/servidor`, npx descarga el paquete. Las siguientes veces usa la caché local y arranca en milisegundos. Si tu orquestación es sensible a la latencia, ejecuta primero el servidor manualmente una vez para que npx lo cachée.

### url (para servidores remotos o ya corriendo)

El servidor MCP corre en otro proceso o máquina y expone un endpoint HTTP con Server-Sent Events (SSE).

```
Ventajas:
- Sin gestión de procesos locales — la app solo hace fetch
- Útil para servidores compartidos en equipo (un servidor MCP de empresa)
- Algunos servicios SaaS ya exponen endpoints MCP directamente (Linear, etc.)

Desventajas:
- Requiere que el servidor remoto esté disponible — si cae, el agente no puede llamar herramientas
- La latencia de red añade tiempo a cada tool call
```

---

## 11. Pool de procesos y rendimiento

Agent Hub mantiene un pool de procesos MCP activos para evitar el cold start en cada ejecución. El ciclo de vida de un proceso en el pool:

```
Primer uso del servidor en una ejecución
  → si no está en pool: arranca el proceso stdio
  → refCount++

Fin del paso de orquestación
  → refCount--
  → si refCount === 0: programa cierre en 30s

Segunda ejecución con el mismo servidor (dentro de 30s)
  → proceso ya está corriendo: refCount++
  → sin cold start
```

El tiempo de vida en inactividad (30 segundos) está diseñado para cubrir el tiempo entre pasos en una orquestación sin mantener procesos vivos indefinidamente cuando no se usan.

### Consultar el estado del pool

Desde la API: `GET /api/mcp/status` devuelve el estado de todos los procesos en el pool (activos, en idle, detenidos). Útil para diagnóstico si sospechas que un proceso se ha quedado colgado.

---

## 12. Solución de problemas

### El agente no usa las herramientas MCP aunque tiene el servidor configurado

**Proveedor CLI:** comprueba que el fichero `{projectPath}/.claude/settings.json` se ha generado correctamente antes de la ejecución. Su contenido debería incluir la sección `mcpServers` con los servidores del agente. Si el fichero no existe, verifica que el proyecto tiene el proveedor `claude` activo.

**Proveedor API/GitHub:** el agente recibe las instrucciones MCP en el system prompt. Si el modelo las ignora, considera cambiar al proveedor CLI o ajustar el system prompt del agente para que mencione explícitamente que debe usar las herramientas externas disponibles.

---

### El servidor arranca pero no aparecen herramientas al probar

Esto ocurre cuando el servidor MCP se inicializa pero no expone herramientas — puede indicar:
- Credenciales erróneas (el servidor arranca pero sin permisos para listar herramientas).
- Una versión del servidor que no implementa `tools/list` correctamente.

Comprueba los logs del servidor: para servidores stdio, los errores del proceso aparecen en el log de la orquestación (`logs.jsonl` en `.agent-hub/`).

---

### Variables de entorno no resueltas (`$env:VAR` queda literal)

Las variables se resuelven en el momento de arrancar el proceso. Si Electron arrancó antes de que definieras la variable en el sistema, no la verá aunque reabras la app sin reiniciar el proceso principal. Solución: reinicia Agent Hub completamente después de definir las variables de entorno.

---

### Servidor stdio lento en el primer arranque

Es el cold start de npx descargando el paquete. Solución: ejecuta el servidor manualmente una vez en PowerShell para que npx lo cachée:

```powershell
npx -y @modelcontextprotocol/server-github --help
```

Después, el servidor arrancará en milisegundos dentro de Agent Hub.

---

### Conflicto de nombre entre servidor global y de proyecto

Si defines un servidor con el mismo nombre a nivel global y a nivel de proyecto, el servidor de proyecto tiene prioridad y sobreescribe al global para ese proyecto. Si necesitas que un agente en ese proyecto use el servidor global, cambia el nombre del servidor de proyecto.

---

### Error `spawn error` al probar la conexión

El ejecutable del campo **Comando** no está en PATH. Causas habituales:

| Causa | Solución |
|---|---|
| `npx` no instalado | Instala Node.js desde nodejs.org |
| `uvx` (Python MCP) no instalado | Instala `uv` con `pip install uv` |
| Ruta al binario incorrecta | Usa la ruta absoluta en el campo Comando: `C:\Users\...\node_modules\.bin\mcp-server-github` |
| Node instalado fuera del PATH de Electron | Reinicia Agent Hub desde una terminal donde `node` sea visible |
