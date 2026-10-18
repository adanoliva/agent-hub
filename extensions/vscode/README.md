# Agent Hub para VS Code

Trabaja con los agentes y las orquestaciones de [Agent Hub](https://github.com/adanoliva/agent-hub) sobre el proyecto que tienes abierto, sin salir del editor.

> **Requiere la app Agent Hub abierta.** La extensión usa su API local (`http://localhost:3737`): el proveedor de IA, las skills, el contexto del proyecto y los servidores MCP son los de la app. Si no está abierta, la vista lo indica.

## Qué puedes hacer

- **Vista lateral** (icono de Agent Hub en la barra de actividad): agentes del proyecto, orquestaciones y últimas ejecuciones, con aviso cuando hay agentes pendientes de sincronizar.
- **Ejecutar agente** (`▶` junto al agente o `Agent Hub: Ejecutar agente…`): escribe la tarea y sigue en directo lo que hace en el panel de salida *Agent Hub*. Se puede cancelar.
- **Ejecutar agente sobre este fichero**: clic derecho en el editor o en el explorador. Si hay texto seleccionado, el agente recibe el fragmento con sus líneas.
- **Orquestaciones con las pantallas de la app**: abrir una orquestación muestra su editor de canvas en una pestaña; ▶ abre el panel de ejecución (campos, estimación de coste, progreso, gates, resultado con diff); *Nueva orquestación* usa la creación de la app. Es la propia app incrustada, así que se ve y funciona igual.
- **Ejecuciones en marcha**: aparecen arriba en la vista, se lancen desde VS Code, la app o la API. ⏹ las detiene y un clic sigue su log en directo.
- **Resultados**: abre cualquier ejecución reciente como documento Markdown, con sus pasos, ficheros modificados, tokens, coste y, si el proyecto usa Git, el diff de cada paso.
- **`@agenthub` en el chat**: pregunta sobre el proyecto en la vista de chat de VS Code. Lee ficheros, contexto y skills, y nunca modifica nada. Con `/run <agente> <tarea>` ejecuta un agente (este sí puede modificar el proyecto) y `/agents` lista los disponibles.

## Instalación

Desde la app: **Ajustes → General → Extensión de VS Code → Instalar extensión**. Necesita el comando `code` en el PATH (en VS Code: `Ctrl+Shift+P` → *Shell Command: Install 'code' command in PATH*).

## Ajustes

| Ajuste | Defecto | Descripción |
|---|---|---|
| `agentHub.url` | `http://localhost:3737` | Dirección de la API local de Agent Hub |
