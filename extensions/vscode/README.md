# Agent Hub para VS Code

Trabaja con los agentes y las orquestaciones de [Agent Hub](https://github.com/adanoliva/agent-hub) sobre el proyecto que tienes abierto, sin salir del editor.

> **Requiere la app Agent Hub abierta.** La extensión usa su API local (`http://localhost:3737`): el proveedor de IA, las skills, el contexto del proyecto y los servidores MCP son los de la app. Si no está abierta, la vista lo indica.

## Qué puedes hacer

- **Vista lateral** (icono de Agent Hub en la barra de actividad): agentes del proyecto, orquestaciones y últimas ejecuciones, con aviso cuando hay agentes pendientes de sincronizar.
- **Ejecutar agente** (`▶` junto al agente o `Agent Hub: Ejecutar agente…`): escribe la tarea y sigue en directo lo que hace en el panel de salida *Agent Hub*. Se puede cancelar.
- **Ejecutar agente sobre este fichero**: clic derecho en el editor o en el explorador. Si hay texto seleccionado, el agente recibe el fragmento con sus líneas.
- **Ejecutar orquestación**: pide los campos de entrada, muestra la estimación de coste y los timeouts antes de lanzarla, emite los logs en directo y te deja aprobar o pedir cambios en los gates de revisión.
- **Nueva orquestación**: nombre, tarea y la cadena de agentes en orden. Para ramas paralelas, gates o scripts, edítala después en el canvas de la app.
- **Resultados**: abre cualquier ejecución reciente como documento Markdown, con sus pasos, ficheros modificados, tokens, coste y, si el proyecto usa Git, el diff de cada paso.
- **`@agenthub` en el chat**: pregunta sobre el proyecto en la vista de chat de VS Code. Lee ficheros, contexto y skills, y nunca modifica nada. Con `/run <agente> <tarea>` ejecuta un agente (este sí puede modificar el proyecto) y `/agents` lista los disponibles.

## Instalación

Desde la app: **Ajustes → General → Extensión de VS Code → Instalar extensión**. Necesita el comando `code` en el PATH (en VS Code: `Ctrl+Shift+P` → *Shell Command: Install 'code' command in PATH*).

## Ajustes

| Ajuste | Defecto | Descripción |
|---|---|---|
| `agentHub.url` | `http://localhost:3737` | Dirección de la API local de Agent Hub |
