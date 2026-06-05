# Plan de implementación — Orquestaciones paralelas (DAG)

> Rama: `feature/parallel-orchestration`
> Última actualización: 2026-06-05
> Estado general: **Fase 1 — no iniciada**

---

## Contexto

Las orquestaciones actuales son estrictamente lineales: `agents: string[]` recorre un `for` secuencial. El objetivo es pasar a un **grafo dirigido acíclico (DAG)** donde los agentes sin dependencias entre sí se ejecuten en paralelo.

---

## Fase 1 — Modelo de datos

**Estado:** ⬜ No iniciada

### Objetivo
Reemplazar el modelo lineal (`agents[]` + `nodes[]` de conexiones) por un modelo de nodos unificado donde cada nodo declara sus dependencias explícitamente.

### Nuevo tipo `OrchestrationNode` (`src/renderer/types.ts`)

```ts
interface OrchestrationNode {
  id:           string;           // UUID estable, e.g. "node-abc123"
  agentName:    string;           // nombre del agente o "__script:name__"
  dependsOn:    string[];         // ids de nodos predecesores (vacío = nodo raíz)
  x?:           number;           // posición en el canvas (px)
  y?:           number;
  dataFlow:     DataFlow;
  contextExtra: ContextExtra;
  gateAfter?:   boolean;
  scriptParams?: Record<string, unknown>;
}
```

### Cambios en `Orchestration` (`src/renderer/types.ts`)

- Eliminar `agents: string[]`
- Eliminar `nodes: OrchestrateNode[]` (el tipo antiguo)
- Eliminar `inputNode?: OrchestrateNode`
- Añadir `nodes: OrchestrationNode[]` (el nuevo tipo unificado)
- `ExecutionConfig` no cambia

### Cambios en `src/backend/workflows.js`

- `create(projectId, projectPath, data)`: si `data` tiene formato antiguo (`agents[]` + `nodes[]`), migrar en el momento de escritura
- Función `migrateOrchestration(raw)`: detecta formato antiguo y convierte:
  - Por cada `agents[i]`: crear `OrchestrationNode` con `id = "node-" + i`, `agentName = agents[i]`, `dependsOn = i === 0 ? [] : ["node-" + (i-1)]`
  - El `inputNode` antiguo (Orquestador → Agent[0]) se mapea a los campos `dataFlow`/`contextExtra` del nodo raíz
  - Las conexiones `nodes[i]` (de → de+1) pasan a ser los `dataFlow`/`contextExtra`/`gateAfter`/`scriptParams` del nodo destino (`node-{i+1}`)
- `read(orchId, projectPath)`: siempre llamar `migrateOrchestration` al leer — transparente para el motor
- `list(projectId, projectPath)`: igual, migrar al listar (solo cabecera, no resultados)

### Cambios en `src/renderer/types.ts`

- Mantener `OrchestrateNode` como `@deprecated` durante la transición (no eliminar hasta que el canvas esté listo)
- Añadir `OrchestrationNode` nuevo
- Actualizar `Orchestration` para tener ambos campos durante la transición, luego eliminar los viejos

### Checklist Fase 1

- [ ] Añadir `OrchestrationNode` a `types.ts`
- [ ] Actualizar interfaz `Orchestration` en `types.ts`
- [ ] Escribir `migrateOrchestration(raw)` en `workflows.js`
- [ ] Aplicar migración en `read()` y `list()`
- [ ] Aplicar migración en `create()` si viene formato antiguo
- [ ] Test manual: abrir orquestación existente → verificar que el JSON migrado es correcto
- [ ] Test manual: crear orquestación nueva → verificar que se guarda con el nuevo formato

---

## Fase 2 — Motor de ejecución (backend)

**Estado:** ⬜ No iniciada  
**Prerrequisito:** Fase 1 completada

### Objetivo
Sustituir el bucle `for` lineal de `orchestrator.js` por un scheduler DAG que ejecute en paralelo los nodos sin dependencias pendientes.

### Algoritmo del scheduler

```
1. Calcular orden topológico (Kahn's algorithm) al inicio de execute()
2. Mantener un Set<nodeId> de "completados"
3. En cada iteración:
   a. Buscar nodos cuyas dependencias están todas en "completados"
   b. Lanzar todos en Promise.all (nivel de ejecución paralela)
   c. Esperar a que terminen
   d. Añadir sus ids a "completados"
   e. Repetir hasta que no queden nodos
```

### Cambios en `src/backend/orchestrator.js`

**`execute(orchestration, config)`**
- Sustituir `for (let i = 0; i < orchestration.agents.length; i++)` por el scheduler
- `agentOutputs` pasa a ser `Map<nodeId, StepOutput>` en vez de `Record<stepIndex, StepOutput>`
- `this.results` pasa a ser `Map<nodeId, StepResult>` para acceso por id
- El timeout global sigue aplciándose al conjunto; los nodos paralelos comparten el mismo reloj

**`_buildSystemPrompt(node: OrchestrationNode)`**
- Recibe el nodo completo en vez de `stepIndex`
- Contexto de proyecto: solo en nodos raíz (`dependsOn.length === 0`)
- Fixed context: viene del propio nodo (`node.contextExtra`)

**`_buildUserMessage(node: OrchestrationNode)`**
- Recoger outputs de `agentOutputs[depId]` para cada `dep in node.dependsOn`
- Si un solo predecesor: comportamiento actual
- Si múltiples predecesores: concatenar handoffs con cabecera `# Output de {agentName}`

**`_getAgent(agentName)`** — sin cambios

**Gates HITL**
- `gateAfter` sigue siendo por nodo (en el propio nodo, no en la arista)
- Un gate bloquea solo la rama del nodo que lo tiene activo
- Los nodos paralelos sin gate continúan; el gate afecta a los sucesores de ese nodo

**Git checkpoints**
- El SHA se guarda en `StepResult` por `nodeId`
- En paralelo: cada nodo hace su checkpoint al terminar (no hay orden garantizado)

**Quality score / budget-guard**
- `agentOutputs` ahora es `Map<nodeId, {...}>` — budget-guard recibe todos los outputs
- `prevResult` en scripts pasa a ser el output del primer predecesor (o `null` si raíz)

**Eventos SSE**
- `step-start`: `{ nodeId, agentName, parallelGroup }` (añadir `parallelGroup`)
- `step-done`: añadir `nodeId`
- `step-warning`, `gate-open`: añadir `nodeId`
- `complete`: sin cambios estructurales

**`StepResult` (`types.ts`)**
- Añadir `nodeId: string`
- Mantener `stepIndex` como posición en orden topológico (para compatibilidad con resultados guardados)

### Checklist Fase 2

- [ ] Implementar `computeTopologicalLevels(nodes)` — devuelve `OrchestrationNode[][]` (array de niveles)
- [ ] Reescribir el bucle principal de `execute()` con el scheduler
- [ ] Actualizar `_buildSystemPrompt` para recibir nodo en lugar de índice
- [ ] Actualizar `_buildUserMessage` para merge de múltiples predecesores
- [ ] Adaptar `agentOutputs` a clave `nodeId`
- [ ] Adaptar `this.results` a clave `nodeId`
- [ ] Actualizar eventos SSE para incluir `nodeId` y `parallelGroup`
- [ ] Adaptar gates HITL al nuevo modelo
- [ ] Adaptar checkpoints git
- [ ] Adaptar budget-guard y quality-score
- [ ] Test manual: orquestación lineal migrada → ejecuta igual que antes
- [ ] Test manual: orquestación con 2 ramas paralelas → ambas corren a la vez
- [ ] Test manual: merge de 2 ramas en un nodo final → recibe ambos outputs

---

## Fase 3 — Canvas UI

**Estado:** ⬜ No iniciada  
**Prerrequisito:** Fase 1 completada (Fase 2 recomendada pero no bloqueante)

### Objetivo
Reescribir `NodeCanvas.tsx` de una lista vertical implícita a un canvas 2D con nodos arrastrables y aristas SVG reales.

### Diseño del canvas

```
┌─────────────────────────────────────────────────┐
│  [Analizador]                                   │
│       │                                         │
│   ────┼────                                     │
│   │       │                                     │
│[Frontend] [Backend]    ← paralelo               │
│   │       │                                     │
│   └───┬───┘                                     │
│  [Integrador]                                   │
└─────────────────────────────────────────────────┘
```

### Componente `NodeCanvas.tsx` (reescritura)

**Estado interno:**
```ts
interface CanvasState {
  dragging: string | null;       // nodeId siendo arrastrado
  connecting: string | null;     // nodeId origen de conexión en curso
  offset: { x: number; y: number }; // offset del drag
}
```

**Renderizado:**
- Fondo: `<div>` con `position: relative` o `<svg>` superpuesto para las aristas
- Nodos: `<div style={{ position: 'absolute', left: node.x, top: node.y }}>`
- Aristas: `<svg>` absoluto sobre el fondo, `<path>` curva cúbica entre puertos de salida/entrada
- Puerto de salida: punto en el borde inferior del nodo
- Puerto de entrada: punto en el borde superior del nodo

**Interacción:**
- Drag de nodo: `onMouseDown` → `onMouseMove` → `onMouseUp` (actualiza `node.x`, `node.y`)
- Crear conexión: click en puerto de salida → modo "connecting" → click en nodo destino
- Eliminar conexión: click en arista → confirmación o tecla Delete
- Auto-layout: botón "Reordenar" que calcula posiciones topológicas automáticamente

**Props:**
```ts
interface Props {
  nodes:          OrchestrationNode[];
  onNodesChange:  (nodes: OrchestrationNode[]) => void;
  selectedNodeId: string | null;
  onSelectNode:   (nodeId: string | null) => void;
  executionState?: Map<string, 'pending' | 'running' | 'done' | 'error'>;
  scripts:        ScriptMeta[];
  onDropAgent:    (agentName: string, x: number, y: number) => void;
}
```

**Renderizado de estado durante ejecución:**
- Nodo pendiente: borde `--border`
- Nodo corriendo: borde `--accent` + spinner
- Nodo completado OK: borde `--green`
- Nodo con error: borde `--coral`
- Nodos paralelos running simultáneamente: visible al mismo tiempo

### CSS nuevas clases

```css
.orch-canvas            /* contenedor relativo, overflow hidden */
.orch-canvas-svg        /* SVG absoluto para aristas */
.orch-node              /* nodo posicionado absolutamente */
.orch-node.selected     /* borde acento */
.orch-node.running      /* animación pulso */
.orch-node.done         /* verde */
.orch-node.error        /* coral */
.orch-node-port-out     /* punto de salida inferior */
.orch-node-port-in      /* punto de entrada superior */
.orch-edge              /* path SVG de arista */
.orch-edge.selected     /* arista seleccionada */
.orch-edge-delete       /* botón ✕ sobre la arista */
```

### Checklist Fase 3

- [ ] Reescribir `NodeCanvas.tsx` con posicionamiento libre x/y
- [ ] Implementar aristas SVG con curvas cúbicas
- [ ] Implementar drag de nodos
- [ ] Implementar creación de conexiones por click en puerto
- [ ] Implementar eliminación de conexiones
- [ ] Implementar auto-layout topológico (botón "Reordenar")
- [ ] Visualizar estado de ejecución por nodo (colores + spinner)
- [ ] Drop de agentes desde la paleta en posición x/y
- [ ] Añadir CSS para todas las clases nuevas en `styles.css`
- [ ] Validación visual: ciclos detectados y bloqueados

---

## Fase 4 — Panel de ejecución y configurador

**Estado:** ⬜ No iniciada  
**Prerrequisito:** Fases 1, 2 y 3 completadas

### Cambios en `OrchestrationEditor.tsx`

- Pasar `nodes: OrchestrationNode[]` al nuevo `NodeCanvas`
- Al seleccionar una arista (par origen→destino): abrir `ConnectionConfigurator` con el nodo destino
- Al seleccionar un nodo: mostrar panel de propiedades del nodo (nombre del agente, sin configuración de arista)
- Botón "Reordenar" → llamar auto-layout del canvas
- Validación: detectar ciclos → mostrar error, impedir guardar

### Cambios en `ConnectionConfigurator.tsx`

- Recibe `node: OrchestrationNode` (el nodo destino de la arista seleccionada)
- La arista seleccionada identifica qué `dataFlow`/`contextExtra` se está editando
- Con múltiples aristas entrantes: selector de qué arista configurar, o configuración global del nodo
- `isInputNode` → `node.dependsOn.length === 0`

### Cambios en `ExecutionPanel.tsx`

- Progreso: en vez de lista lineal de pasos, mostrar el grafo con estado por nodo
- Opción: reutilizar el canvas en modo lectura (solo visualización, sin interacción)
- Timeline de ejecución: mostrar qué nodos corrieron en paralelo y cuándo
- Resultado final: agrupar `results` por nivel topológico, no por índice

### Checklist Fase 4

- [ ] Actualizar `OrchestrationEditor` para el nuevo canvas
- [ ] Actualizar `ConnectionConfigurator` para aristas del DAG
- [ ] Reescribir progreso en `ExecutionPanel` (DAG visual o lista enriquecida)
- [ ] Timeline de ejecución paralela en el resultado
- [ ] Gestión de aristas con múltiples entradas en el configurador
- [ ] Test manual end-to-end completo

---

## Compatibilidad hacia atrás

Las orquestaciones existentes (formato lineal en disco) se migran automáticamente en `workflows.js` al leerlas. **No se escriben al disco en el nuevo formato hasta que el usuario las guarda desde el editor.** Esto protege contra regressions si se hace rollback de la rama.

El campo `stepIndex` en `StepResult` se mantiene para que los resultados históricos sigan siendo legibles.

---

## Decisiones pendientes

- [ ] ¿Los nodos paralelos comparten el mismo timeout global o tienen timeout individual?
- [ ] ¿Merge de múltiples handoffs: concatenar textos o estructurar como lista?
- [ ] ¿El gate de un nodo bloquea a todos sus sucesores o solo al sucesor directo?
- [ ] ¿Límite máximo de nodos en paralelo para no saturar el proveedor IA?
