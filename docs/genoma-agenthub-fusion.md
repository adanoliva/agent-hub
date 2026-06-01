# Análisis de fusión: Orquestación de genoma-solution → agenthub

> Documentación de referencia consultada:
> - `agenthub/backend.md` y `agenthub/frontend.md` (estado actual de agenthub v1.9.3)
> - `agenthub/genoma-orquestation.md` (arquitectura de orquestación de genoma-solution)
> - `docs/architecture/ARCHITECTURE.md` — arquitectura de alto nivel
> - `docs/architecture/DATA_FLOW.md` — flujos de datos entre componentes
> - `docs/architecture/DECISIONS.md` — ADR-001 a ADR-016 (decisiones arquitecturales)
> - `docs/GENOMA_ROADMAP_EVOLUCION.md` — roadmap funcional 2026

---

## 1. Estado actual de cada sistema

### agenthub — Orquestación actual

El motor de orquestación (`orchestrator.js`) implementa:

- **Ejecución lineal** de agentes: `agents[0] → agents[1] → ... → agents[n-1]`
- **Protocolo HANDOFF**: cada agente no-final termina con una línea JSON estructurada `HANDOFF:{done, changed, issues, next}`. El siguiente agente lo recibe compactado (~200 chars vs. ~1500 del prose completo)
- **SSE streaming** en tiempo real: eventos `step-start`, `step-progress`, `step-complete`, `step-error`, `complete`
- **Subsistema CLI** (`subsystem-cli.js`): loop multi-turno para providers API/GitHub que emula las herramientas del CLI (read/write/bash/grep/browser)
- **Snapshot de filesystem** antes de ejecutar (hasta 500 ficheros, 256 KB/fichero) para rollback
- **Timeout global** de la orquestación distribuido entre pasos (`remaining = total - elapsed`)
- **`stopOnError`**: rompe el bucle al primer paso fallido

Lo que **no tiene** actualmente:
- HITL gates (pausa para aprobación humana entre pasos)
- REVISE loops (reintentar un paso con feedback del operador)
- Estado persistente para recuperación tras crash
- Git checkpointing por agente/fase
- Ejecución paralela de agentes
- DAG de dependencias (solo lineal)
- Sistema de eventos con tags de workflow
- Scripts determinísticos (todo pasa por el LLM)
- Referencia canónica compartida entre agentes del mismo paso

### genoma-solution — Orquestación

Ver `agenthub/genoma-orquestation.md` para el detalle completo. Los patrones clave son:

- **PhaseEngine** como orquestador agnóstico al workflow con HITL gates y REVISE loops
- **Patrón Lead → Prompt Generator → Workers** con paralelismo `asyncio.gather`
- **Estado persistente** en `pipeline_state.json` con escrituras atómicas y recuperación ante crashes
- **Git checkpointing** granular por agente y por fase, con rollback reversible
- **DAG planner** para topología de fases con invariantes y ciclo de detección
- **Event system** workflow-tagged con persistencia JSONL y WebSocket broadcast
- **Operaciones atómicas** con ciclo de vida `PENDING → VERIFIED → APPLIED → RESOLVED`
- **Scripts Python determinísticos** en lugar de LLM para tareas mecánicas
- **Workspace isolation** por proyecto con manifest de 3 capas (PROJECT/PIPELINE/ANALYSIS)
- **Run tagging per workflow** para filtrar historial de ejecuciones por pipeline

---

## 2. Lecciones críticas de los ADRs (directamente aplicables)

Los ADRs de genoma son la parte más valiosa. No son solo decisiones técnicas: son **lecciones destiladas de fallos reales** en producción. Las más aplicables a agenthub:

### De ADR-016 (Spec Editor industrial — 16 defectos clasificados)

Estas lecciones son universales para cualquier sistema de orquestación de agentes:

| Lección | Problema real observado | Aplicación en agenthub |
|---|---|---|
| **Workers no comparten contexto sin mecanismo explícito** | 8 tablas con naming inconsistente porque workers eligieron names independientemente | Si dos pasos de una orquestación producen outputs que deben ser coherentes, necesitan una **referencia canónica compartida** antes de escribir |
| **Instrucciones advisory en prompts ≠ enforcement** | Workers ignoraron `\|` como delimitador obligatorio; eligieron el default del modelo | Las reglas de formato en system prompts no se cumplen sin validación determinista post-escritura |
| **HITL gates son features, no bugs** | Pipeline autónomo con calidad 70% es peor que HITL puntual + calidad 95% | Añadir gates de revisión entre pasos críticos mejora el resultado final más que eliminar fricción |
| **Surfacing > auto-resolving** | Workers resolvían silenciosamente contradicciones del input eligiendo arbitrariamente | Cuando hay conflicto, el agente debe **surfacear** el conflicto en el output, no escoger silenciosamente. El operador decide |
| **Síntesis large-output en un solo shot tiende a thinking-loop** | `chap_S2 BR-namespace lock` timeout en outputs >5KB | Partir outputs grandes en N agentes paralelos con outputs acotados es más robusto que un solo agente con output masivo |
| **Contaminación app-specific en prompts es cáncer** | Prompts con tokens como `BR-NNN`, `T_*`, `WDA` solo funcionan para ese cliente | Los system prompts de agentes deben ser genéricos; el contexto del proyecto va en el userMessage |

### De ADR-007 (Pipelines aislados con publish explícito)

El patrón de "publish explícito" entre pipelines resolvió un problema clásico: cuando dos flujos comparten carpetas implícitamente, una segunda ejecución del primero pisa silenciosamente el estado que el segundo estaba usando.

**Aplicación en agenthub**: una orquestación no debería leer directamente los outputs de otra. Si el usuario quiere encadenar dos orquestaciones, el handoff debería ser **explícito** (un botón, una acción documentada) con backup automático del destino. Los resultados de `ExecutionResult` ya se guardan en `.agent-hub/executions/`; ese contenido podría servir como input de la siguiente orquestación mediante un mecanismo de "publish to next".

### De ADR-008/009/010 (Workspace isolation en 3 fases)

El workspace isolation de genoma resolvió que varios proyectos no podían ejecutarse en paralelo sin pisarse. El manifiesto de 3 capas (PROJECT/PIPELINE/ANALYSIS) da al operador control sobre qué persiste y qué es volátil:

| Capa | Qué es | Owner | Aplicación en agenthub |
|---|---|---|---|
| PROJECT | Contexto del proyecto (descripción, glosario, restricciones) | Operador, no se sobreescribe | `CLAUDE.md` / `copilot-instructions.md` (ya existe) |
| PIPELINE | Instrucciones específicas del workflow | Operador, no se sobreescribe | Podría ser el system prompt de la orquestación |
| ANALYSIS | Resumen auto-generado del último run | GENOMA auto-genera, volátil | El `result.json` de la última ejecución |

La distinción clave es que el operador sabe qué puede editar sin miedo a perderlo. Actualmente en agenthub no hay esta distinción: el `CLAUDE.md` del proyecto es todo o nada.

### De ADR-015 (Run tagging per workflow)

Los 5 pipelines de genoma compartían proceso y escribían eventos en el mismo directorio. La solución fue etiquetar cada run con su `workflow` y filtrar el historial por esa etiqueta.

**Aplicación en agenthub**: el historial de ejecuciones (`.agent-hub/executions/`) está ya organizado por `{timestamp}-{orchId}`. Si el proyecto tiene múltiples orquestaciones, la navegación del historial por orquestación ya está implícita. Pero podría añadirse un índice de ejecuciones cross-orquestación con filtros en el `ExecutionPanel`.

---

## 3. Análisis de brechas

| Capacidad | genoma-solution | agenthub actual | Brecha |
|---|---|---|---|
| Ejecución secuencial | Sí | Sí | — |
| Ejecución paralela | Sí (`asyncio.gather`) | No | Alta |
| HITL gates | Sí (APPROVE/REVISE/FEEDBACK) | No | Alta |
| REVISE loop | Sí (backup+clean+rerun) | No | Media |
| Estado persistente (crash recovery) | Sí (pipeline_state.json atómico) | No | Media |
| Git checkpointing por agente | Sí | No (solo snapshot FS completo) | Media |
| DAG de dependencias | Sí (pipeline_planner.py) | No (solo lineal) | Baja-Media |
| Eventos workflow-tagged | Sí (ContextVar + JSONL) | SSE sin tags de workflow | Baja |
| Scripts determinísticos (sin LLM) | Sí | No | Media |
| Referencia canónica compartida entre workers | Sí (canonical/ dir) | No | Alta |
| Validador post-escritura determinístico | Sí (_diff_validator.py) | No | Media |
| Workspace isolation por proyecto | Sí (workspace_provisioner) | `.agent-hub/` parcial | Media |
| Publish explícito entre pipelines | Sí (botón + backup + provenance) | No | Baja |
| Protocolo HANDOFF estructurado | No (usa output_file JSON) | Sí | — |
| Subsistema CLI multi-turno | No (usa proceso CLI nativo) | Sí | — |
| Snapshot/rollback de filesystem | No (solo git) | Sí | — |

---

## 4. Qué se puede fusionar — Análisis de viabilidad

### 4.1 HITL Gates — Viabilidad ALTA, impacto ALTO

**Qué hace genoma**: pausa la ejecución entre fases y espera una decisión del operador (APPROVE / REVISE / FEEDBACK) antes de continuar.

**Justificación directa desde ADR-016**: "industrial = autonomous + HITL puntual estratégico. Gates son features, no bugs." Un pipeline 100% autónomo con calidad 70% es peor que uno con HITL puntual y calidad 95%.

**Cómo aplicarlo en agenthub**: el sistema SSE ya emite eventos por paso. Añadir un estado de pausa es natural:

```
Arquitectura propuesta:
  orchestrator.js → antes de cada paso, comprueba si el nodo tiene gate=true
    └─ si gate activo:
         ├─ emite evento SSE: { type: 'gate-open', stepIndex, agentName }
         ├─ escribe { status: 'paused_gate', stepIndex } en execution-state.json
         └─ queda suspendido en Promise que resuelve cuando llega decisión

  Nuevo endpoint: POST /orchestrations/:id/executions/:execId/gate
    Body: { action: 'approve' | 'revise' | 'feedback', feedbackText? }
    → resuelve la Promise suspendida

  Frontend (ExecutionPanel.tsx):
    ├─ cuando recibe evento SSE 'gate-open' → muestra panel de decisión HITL
    └─ botones APPROVE / REVISE (con textarea de feedback) / CANCEL
```

**Configuración**: añadir campo `gateAfter: boolean` al `OrchestrateNode` del JSON de orquestación. El usuario lo activa por conexión en `ConnectionConfigurator.tsx`.

**Implementación en Node.js**: usar un `Map<executionId, { resolve, reject }>` en memoria para suspender el ejecutor. La pausa no bloquea el event loop de Node.js al ser async/await.

**Interacción con el timeout global**: el timeout de la orquestación debe pausarse mientras el gate está abierto. Como `elapsed = Date.now() - startedAt`, basta con avanzar `startedAt` al reanudar:

```js
const pauseStart = Date.now();
await waitForGate(executionId, stepIndex);
startedAt += (Date.now() - pauseStart); // descuenta el tiempo de espera humana
```

Sin este ajuste, las orquestaciones con gates siempre agotarían el timeout si el operador tarda más que el margen restante.

---

### 4.2 REVISE Loop — Viabilidad ALTA, impacto ALTO

**Qué hace genoma**: cuando el operador elige REVISE en un gate, el engine hace backup de los outputs del paso fallido, limpia el directorio de trabajo y re-ejecuta la fase desde cero, opcionalmente con feedback inyectado en el prompt.

**Cómo aplicarlo en agenthub**:

```
Cuando la decisión del gate es REVISE:
  1. mover los ficheros modificados en ese paso a:
     .agent-hub/backups/step-{i}-revise-{timestamp}/
  2. inyectar el feedbackText en el userMessage del paso como:
     "\n\n=== FEEDBACK DEL OPERADOR ===\n{feedbackText}\n"
  3. re-ejecutar el paso desde el principio (mismo agente, misma posición)
  4. si el resultado es satisfactorio → continuar con el siguiente paso
```

**Diferencia con genoma**: genoma hace REVISE a nivel de fase completa. En agenthub el REVISE se haría a nivel de paso individual (un agente), que es más granular y adecuado para la naturaleza lineal del orquestador.

El historial de revisiones por paso puede registrarse en `result.json`:

```json
{
  "stepIndex": 2,
  "revisions": [
    { "at": "...", "feedback": "Falta el test de edge case" },
    { "at": "...", "feedback": null }
  ]
}
```

---

### 4.3 Estado persistente para crash recovery — Viabilidad ALTA, impacto MEDIO

**Qué hace genoma**: `pipeline_state.json` con escrituras atómicas (write-to-temp + rename + lock) que permite reanudar tras un crash del servidor exactamente desde el último paso completado.

**Qué tiene agenthub**: `result.json` parcial solo al completar la ejecución. Si Electron se cierra a mitad, se pierde el estado.

**Propuesta**: escribir `execution-state.json` incremental en cada paso completado:

```json
{
  "executionId": "...",
  "orchestrationId": "...",
  "projectId": "...",
  "status": "running",
  "lastCompletedStep": 1,
  "startedAt": "...",
  "steps": {
    "0": { "status": "success", "filesModified": [...] },
    "1": { "status": "success", "filesModified": [...] }
  }
}
```

**Escritura atómica en Node.js**:
```js
const tmp = statePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
fs.renameSync(tmp, statePath);
```

**Reanudación**: añadir endpoint `POST /orchestrations/:id/executions/:execId/resume`. El orchestrator lee `execution-state.json`, salta los pasos ya completados (`lastCompletedStep`) y reanuda desde el siguiente.

---

### 4.4 Scripts determinísticos en lugar de LLM — Viabilidad ALTA, impacto ALTO

**Qué hace genoma**: usa scripts Python determinísticos para tareas mecánicas que no necesitan LLM:
- `gap_inventory_builder.py`: clasificación de gaps con regex (sin LLM)
- `_diff_validator.py`: auditoría del preservation contract (diff esperado vs. real)
- `consolidation_tool.py`: el LLM decide, el script aplica (LLM solo donde añade valor)

**Qué hace agenthub**: todo pasa por el CLI de IA o por la API. Si una tarea es mecánica (contar líneas, detectar ficheros cambiados, generar un índice), igualmente se le pasa a un agente.

**Justificación desde ADR-016 / ADR-010**: "No forzar IA donde la determinación alcanza. El 80% de los sub-agentes son perfectamente especificables sin LLM. Forzar a generar todo con IA multiplica latencia, coste y variabilidad."

**Propuesta — Tipo de paso "script"** en la orquestación:

Ampliar el modelo de orquestación para incluir pasos que no son agentes IA sino funciones Node.js integradas:

```json
{
  "agents": ["code-reviewer", "__script:generate-index__", "doc-writer"],
  "nodes": [...]
}
```

Un paso `__script:generate-index__` ejecutaría una función predefinida del backend en lugar de llamar a la IA. Ventajas:
- Velocidad (ms vs. segundos)
- Coste cero de tokens
- Determinismo y reproducibilidad
- Sin riesgo de alucinaciones en tareas estructurales

**Scripts candidatos para implementar** (aplicando la lección de genoma sobre "80% determinístico"):

| Script | Tarea mecánica | Equivalente en genoma |
|---|---|---|
| `generate-file-index` | Lista estructurada de ficheros del proyecto con stats | `spec_indexer.py` |
| `diff-since-step` | Comparativa de ficheros modificados entre dos pasos | `_diff_validator.py` |
| `validate-json` | Verifica que los outputs JSON de un paso son válidos | `_extract_fenced_json` |
| `count-coverage` | Cuenta qué porcentaje de ficheros fuente fueron tocados | `post_fix_revalidation.json` |
| `extract-frontmatter` | Extrae metadata YAML de ficheros .md sin LLM | `gap_inventory_builder.py` |
| `quality-score` | Métricas estructurales del output del paso (secciones vacías, gaps, etc.) | Quality Score del roadmap genoma |

**Implementación**: en `orchestrator.js`, detectar si `agentName.startsWith('__script:')` y desviar a un dispatcher de scripts en lugar de llamar a `callAI`.

**Impacto en validación y UI (no es un quick win puro)**:
- La validación previa de `orchestrator.js` comprueba que cada paso existe como fichero `.md` en disco. Los pasos `__script:*` no tienen fichero y requieren una rama de validación separada en el método `validate()`.
- `NodeCanvas.tsx` y la paleta de `OrchestrationEditor.tsx` asumen que todos los nodos son agentes IA. Los pasos script necesitan representación visual diferente (icono y color distintos). El cambio es menor pero existe y debe contemplarse en la Fase 1.

---

### 4.5 Referencia canónica compartida entre agentes — Viabilidad ALTA, impacto ALTO

**Qué hace genoma**: la canonization phase produce un directorio `canonical/` con `stack_profile.md` y `authority.md` antes de que ningún agente escriba deliverables. Todos los workers downstream leen esta referencia. Resolvió 7 de los 16 defectos de clase A (inconsistencias de naming entre workers que elegían independientemente sin referencia común).

**Lección directa**: "Workers no comparten contexto sin mecanismo explícito. Si dos workers necesitan acordar algo, ese algo va a una referencia canónica leíble por ambos antes de que ninguno escriba."

**Aplicación en agenthub**: cuando una orquestación tiene múltiples pasos que deben producir outputs coherentes entre sí, se añade un paso `__script:prepare-context__` al inicio. Este paso corre de forma determinística (sin LLM) y produce un fichero de estado del proyecto:

```json
// .agent-hub/context/canonical.json
{
  "generatedAt": "...",
  "projectFiles": [...],           // índice de ficheros existentes
  "previousOutputs": [...],        // outputs de orquestaciones anteriores disponibles
  "detectedConventions": {...},    // naming, formato, estructura detectados automáticamente
  "orchestrationScope": [...]      // ficheros que esta orquestación puede tocar
}
```

Todos los agentes de la orquestación reciben este fichero via `contextExtra.fixed.files`. El agente no asume qué hay en el proyecto — lo lee. Esto previene que dos agentes del mismo run elijan convenciones distintas independientemente.

```
__script:prepare-context__ → canonical.json
           ↓
    agente A (recibe canonical.json en contextExtra.fixed.files)
    agente B (recibe canonical.json en contextExtra.fixed.files)
```

La infraestructura ya existe: `contextExtra.fixed.files` inyecta ficheros fijos en el userMessage de cada paso. La novedad es hacer explícito el patrón de primer paso canonizador: **un paso script produce la referencia, los siguientes agentes IA la consumen**. Esto es la implementación directa de `prepare-context` dentro del catálogo de scripts de la sección 4.4.

---

### 4.6 Validación post-escritura determinística — Viabilidad ALTA, impacto MEDIO

**Qué hace genoma**: `_diff_validator.py` audita que el worker solo haya modificado lo que debía (solo dentro de los `[GAP:]` markers existentes, con un appendix `## Consolidation Notes` al final). Cualquier otro cambio → falla y worker reruns con feedback.

**Lección directa**: "Instrucciones advisory en prompts NO son enforcement. Workers eligen el path de menor resistencia."

**Aplicación en agenthub**: añadir al step `__script:validate-output__` que puede ejecutarse automáticamente después de cada paso de agente. El script verifica condiciones estructurales del output (ficheros producidos, formato JSON válido, ausencia de rutas hardcodeadas, etc.) sin invocar al LLM. Si falla, emite un evento `step-warning` con el diagnóstico y, opcionalmente, activa el REVISE automático.

```js
// En orchestrator.js, después de cada _runAIStep:
if (step.validateOutput) {
  const validation = await runScriptStep('validate-output', {
    output: stepResult,
    rules: step.validateOutput.rules,
  });
  if (!validation.passed) {
    emit('step-warning', { stepIndex, issues: validation.issues });
    if (executionConfig.autoReviseOnFailedValidation) {
      return this._runAIStep(i, validation.feedbackForAgent);
    }
  }
}
```

---

### 4.7 Git Checkpointing — Viabilidad MEDIA, impacto MEDIO

**Qué hace genoma**: commits git por agente/fase con `git add -A && git commit`, tags nombrados, y rollback con `git reset --hard`.

**Qué tiene agenthub**: snapshot JSON del filesystem (hasta 500 ficheros). El rollback restaura el contenido desde el JSON guardado.

**Análisis de si sustituir o complementar**:

| Criterio | Snapshot FS (actual) | Git checkpoint (genoma) |
|---|---|---|
| Velocidad | Instantáneo (JSON read) | Depende del tamaño del repo |
| Requiere git en el proyecto | No | Sí |
| Historial navegable | No | Sí (`git log`) |
| Límite de tamaño | 500 ficheros / 256 KB | Ilimitado |
| Rollback parcial (por agente) | No (todo o nada) | Sí (por commit hash) |

**Propuesta híbrida** (sin romper lo existente):
- Mantener el snapshot FS para rollback rápido de toda la ejecución.
- Añadir git checkpointing **opcional** (activable por proyecto si tiene git inicializado):

```js
if (project.gitEnabled && isGitRepo(project.path)) {
  await exec('git add -A', { cwd: project.path });
  await exec(`git commit -m "agenthub: step ${i} (${agentName})"`, { cwd: project.path });
  stepResult.gitCommitSha = await getLastCommitSha(project.path);
}
```

El rollback por paso puede usar `git reset --hard {sha}` si hay sha disponible, o el snapshot FS como fallback.

---

### 4.8 Publish explícito entre orquestaciones — Viabilidad MEDIA, impacto MEDIO

**Qué hace genoma**: el boton "Publish → next pipeline" con backup automático timestamped, copia recursiva, y `.provenance.json`. El resultado de un pipeline solo llega al siguiente cuando el operador decide explícitamente que está listo.

**Problema que resuelve**: una segunda ejecución de la orquestación A no debería pisar silenciosamente el input de la orquestación B que ya estaba usando el output anterior.

**Aplicación en agenthub**: añadir la posibilidad de que el `ExecutionResult` de una orquestación sea el input de otra. El mecanismo:

```
POST /orchestrations/:fromId/executions/:execId/publish-to/:toOrchId
  ├─ guarda el output en .agent-hub/published/{timestamp}-{fromId}.json
  ├─ escribe .provenance.json en .agent-hub/ con trazabilidad del origen
  └─ retorna { published, publishedPath, provenance }
```

La orquestación destino recibe el output publicado como `temporalContextValues` al lanzar su siguiente ejecución (`POST /orchestrations/:toOrchId/execute`), no como modificación de su definición en disco. Esto preserva la definición de la orquestación B intacta entre ejecuciones: si el usuario lanza B manualmente sin publicar, parte de cero como siempre. El output publicado es solo input de esa ejecución concreta.

El `ExecutionPanel.tsx` puede añadir un botón "Publicar a siguiente orquestación" en la vista de resultado cuando el `ExecutionResult.status === 'success'`, con un selector de la orquestación destino dentro del mismo proyecto.

---

### 4.9 Ejecución paralela — Viabilidad MEDIA, impacto MEDIO

**Qué hace genoma**: `asyncio.gather()` con `max_concurrent` configurable.

**Propuesta en agenthub**: añadir soporte de "grupos de pasos" en el modelo de orquestación:

```json
{
  "agents": [
    ["step-a"],
    ["step-b", "step-c"],
    ["step-d"]
  ]
}
```

Los pasos del mismo grupo se lanzan con `Promise.all()`. Los grupos siguientes esperan a que el grupo anterior complete.

**Precaución**: si dos agentes del mismo grupo modifican los mismos ficheros, hay conflicto. Requiere validación previa o restricción de que los agentes paralelos operen sobre conjuntos de ficheros disjuntos.

**Complejidad de UI**: el `NodeCanvas.tsx` actual es lineal. Para grupos paralelos necesitaría representar bifurcaciones. Este es un cambio visual significativo.

**Recomendación**: implementar como versión avanzada (v2 del orquestador), no en la primera iteración de fusión.

---

### 4.10 Atomic Ops adaptado — Viabilidad MEDIA, impacto MEDIO

**Qué hace genoma**: un ledger append-only (`ops.yaml`) donde cada `AtomicOp` tiene ciclo de vida estricto `PENDING → VERIFIED → APPLIED → RESOLVED`. Las ops nunca se eliminan, solo avanzan de estado. Esto permite trackear qué cambió, quién lo propuso y en qué ejecución, a lo largo de toda la vida del proyecto.

**Por qué fusionar**: genoma es ejecutable en cualquier proyecto durante todo su ciclo de vida. agenthub intenta replicar exactamente esto: orquestaciones genéricas aplicables a todos los proyectos en cualquier momento. El tracking actual de agenthub (`filesModified: string[]`) no tiene granularidad ni ciclo de vida — es una lista plana de rutas sin estado.

**Versión adaptada para agenthub** (más simple que la de genoma):

```js
// ops-ledger.json en .agent-hub/
{
  "ops": [
    {
      "id": "op-{uuid8}",
      "executionId": "...",
      "orchestrationId": "...",
      "stepIndex": 2,
      "agentName": "code-reviewer",
      "kind": "modify",           // add | modify | remove
      "filePath": "src/auth.ts",
      "status": "applied",        // proposed | approved | applied | reverted
      "createdAt": "...",
      "appliedAt": "..."
    }
  ]
}
```

**Beneficios concretos**:
- El operador puede aprobar/revertir cambios individuales en lugar de rollback total
- El historial de cambios sobrevive entre ejecuciones de la misma orquestación
- Los HITL gates (sección 4.1) pueden operar a nivel de op individual, no solo de paso completo
- Permite ver qué cambió en cada ejecución sin depender del snapshot completo del filesystem

---

### 4.11 Skills — Viabilidad ALTA, impacto ALTO

**Qué hace genoma**: la `SkillLibrary` carga fragmentos `.md` del catálogo `data/skills/` y los inyecta dinámicamente en el system prompt del agente según el contexto del pipeline.

**Por qué fusionar**: permite mantener los agentes de agenthub más limpios y reutilizables. Hoy un agente mezcla en su system prompt la **tarea** (lo que hace) con el **conocimiento tecnológico** (cómo lo hace). Con skills separados:

```
Antes:
  System prompt = "Eres experto en TypeScript strict mode, React 18,
  hooks avanzados, Zustand... [150 tokens de contexto tecnológico]
  Tu tarea es revisar el código... [50 tokens de tarea real]"

Después:
  System prompt = "Tu tarea es revisar el código y reportar problemas."
  Skills inyectados = typescript-strict.md + react-conventions.md
```

**Beneficios concretos**:
- El agente es reutilizable entre proyectos con diferentes stacks (solo cambian los skills)
- Actualizar una convención tecnológica se hace en un solo fichero `.md`
- Los system prompts generados por IA son más cortos y enfocados
- El botón "Optimizar con IA" tiene menos ruido que procesar

**Implementación propuesta**: los skills viven en un directorio `skills/` dentro del mismo repositorio externo de agentes (`agentsDirectoryUrl`), con la misma jerarquía de niveles que los agentes (global → section → tech → project). `agents-sync.js` los sincroniza junto con los agentes en el mismo ciclo de sync, descargando los ficheros de `skills/` al directorio local `skills/` de la app. No se necesita un mecanismo de sync separado.

```
Repositorio externo (agentsDirectoryUrl):
  agents/global/doc-writer.md
  agents/section-web/frontend-reviewer.md
  skills/global/typescript-strict.md
  skills/section-web/react-conventions.md
  skills/tech-web-react/zustand-patterns.md
```

El usuario selecciona las skills al editar un agente (asociación estática). La inyección dinámica automática por stack del proyecto es una evolución futura cuando el catálogo de skills tenga volumen suficiente.

---

### 4.12 Quality Score por paso — Viabilidad ALTA, impacto MEDIO

**Origen**: roadmap genoma Q2 2026, "Quality Score per Phase" (prioridad alta). Y ADR-016 introduce `post_fix_revalidation.json` con métricas RESOLVED/PARTIALLY_RESOLVED/UNRESOLVED/REGRESSION.

**Aplicación directa en agenthub**: después de cada paso de la orquestación, calcular métricas estructurales del output y mostrarlas en el `ExecutionPanel.tsx`:

| Métrica | Cómo calcularla | Sin LLM |
|---|---|---|
| Ficheros producidos vs. esperados | Comparar `filesModified` con el target del step | Sí |
| Formato válido | Parse JSON/YAML/MD según el tipo de output | Sí |
| Cobertura (% del input referenciado) | Grep de entidades del step anterior en el output actual | Sí |
| Tokens usados vs. estimados | `tokensUsed` ya está en `StepResult` | Sí |
| Tiempo de ejecución | `duration` ya está en `StepResult` | Sí |

El quality score se muestra como un badge verde/ámbar/rojo en cada tarjeta de paso del resultado. No requiere LLM: es puro análisis estructural.

---

## 5. Lo que NO debe fusionarse

Tras el debate punto a punto, estos patrones de genoma-solution son específicos de su dominio y **no tienen equivalente aplicable** en agenthub:

| Patrón genoma | Por qué no aplica | Qué lo sustituye en agenthub |
|---|---|---|
| **Lead → PG → Workers** | El patrón de 3 capas existe porque los workers de genoma son procesos CLI que necesitan prompts generados al vuelo desde un plan dinámico. En agenthub los agentes tienen su system prompt definido por el usuario. | El Lead escribe outputs al filesystem; el siguiente agente los lee sin asumir cantidad fija. **El filesystem es el bus de comunicación.** |
| **DAG presets** (data-first, api-first, ui-first) | Son topologías fijas para deliverables de arquitectura de software con invariantes específicas del dominio (TD siempre último, TP tras FD+TD...). | El editor visual de agenthub: el usuario decide la topología por proyecto. |
| **Cross-workflow publish routes** (whitelist reverse→editor, docs2specs→editor, editor→specs2code) | Son rutas hardcodeadas del E2E de modernización entre pipelines con roles definidos por el producto. | El filesystem como handoff entre orquestaciones: la primera escribe en una carpeta conocida (`.agent-hub/analysis/`), la segunda sabe dónde leer porque su system prompt lo indica. |
| **Tech profiles** (java-spring-boot, angular, dotnet-core...) | Son configuraciones de scaffold, build commands y output dirs para generación de código desde specs. agenthub no genera código desde specs. | Las categorías y tecnologías existentes son suficientes. Cuando se implementen los skills (sección 4.11), el stack del proyecto determinará qué skills se inyectan automáticamente. |

### Principio resultante del debate

Los cuatro puntos comparten una misma razón de fondo: en genoma la infraestructura de orquestación gestiona la complejidad porque los pipelines son fijos y definidos por el producto. En agenthub **la complejidad la gestiona el usuario** mediante el editor visual y los system prompts de sus agentes. Lo que no debe fusionarse es exactamente aquello que agenthub delega conscientemente al usuario.

Los puntos que sí se fusionan (Atomic Ops, Skills, Canonization) son patrones de **calidad y supervisión** — independientes del dominio — que agenthub no tiene hoy y que mejorarían cualquier orquestación genérica.

---

## 6. Plan de implementación propuesto (priorizado)

### Fase 1 — Quick wins

| Mejora | Ficheros afectados | Esfuerzo estimado | Nota |
|---|---|---|---|
| **Scripts determinísticos** (`__script:*`) | `orchestrator.js` + nuevo `scripts-registry.js` | 2-3 días | Requiere rama adicional en `validate()` y representación visual en `NodeCanvas.tsx` |
| **Quality Score por paso** | `orchestrator.js`, `ExecutionPanel.tsx` | 1-2 días | Sin cambios de modelo de datos |
| **Estado incremental** (`execution-state.json`) | `orchestrator.js`, `workflows.js` | 1 día | Sin cambios de modelo de datos |

### Fase 2 — HITL Gates (cambio de modelo de datos)

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| Campo `gateAfter` en `OrchestrateNode` | `types.ts`, `workflows.js`, `orchestrator.js` | 1 día |
| Endpoint de resolución de gate | `server.js` | 0.5 días |
| UI del panel HITL | `ExecutionPanel.tsx`, `ConnectionConfigurator.tsx` | 1-2 días |
| Persistencia del estado de pausa | `orchestrator.js`, `execution-state.json` | 0.5 días |

### Fase 3 — REVISE + Validación post-escritura

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| Lógica REVISE por paso | `orchestrator.js` | 1 día |
| UI del botón REVISE con feedback | `ExecutionPanel.tsx` | 1 día |
| Script `validate-output` determinístico | `scripts-registry.js` | 1 día |

### Fase 4 — Git checkpointing (opcional por proyecto)

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| Campo `gitEnabled` en `Project` | `types.ts`, `config.js` | 0.5 días |
| Módulo `git-checkpointer.js` | nuevo fichero | 1-2 días |
| Integración en `orchestrator.js` | `orchestrator.js` | 0.5 días |
| Rollback por commit SHA en `ExecutionPanel.tsx` | `ExecutionPanel.tsx` | 0.5 días |

### Fase 5 — Skills (nuevo subsistema)

Los skills se sincronizan desde el mismo repositorio externo que los agentes (`agentsDirectoryUrl`), carpeta `skills/`. `agents-sync.js` descarga ambos en el mismo ciclo de sync.

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| Soporte de carpeta `skills/` en `agents-sync.js` | `agents-sync.js`, `config.js` | 0.5 días |
| Directorio local `skills/` con jerarquía global/section/tech/project | `config.js`, `server.js` | 1 día |
| CRUD de skills (paralelo al de agentes) | `agents.js` → nuevo `skills.js` | 1-2 días |
| Selector de skills en `AgentEditor.tsx` | `AgentEditor.tsx`, `types.ts` | 1 día |
| Inyección en ejecución (`orchestrator.js`) | `orchestrator.js` | 0.5 días |

### Fase 6 — Atomic Ops ledger

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| `ops-ledger.json` por orquestación | nuevo `ops-ledger.js` | 1 día |
| Registro de ops por fichero modificado en cada paso | `orchestrator.js` | 1 día |
| Vista de ops en `ExecutionPanel.tsx` con approve/revert individual | `ExecutionPanel.tsx` | 1-2 días |

### Fase 7 — Paralelismo (cambio de UI significativo)

| Mejora | Ficheros afectados | Esfuerzo estimado |
|---|---|---|
| Modelo de grupos en `Orchestration` | `types.ts`, `workflows.js`, `orchestrator.js` | 2 días |
| `NodeCanvas.tsx` con representación de grupos | `NodeCanvas.tsx`, `OrchestrationEditor.tsx` | 2-3 días |

---

## 7. Propuesta de arquitectura del orquestador mejorado

```
orchestrator.js (mejorado)
│
├── execute(orchestration, project, temporalValues)
│   │
│   ├── validate()
│   ├── writeExecutionState({ status: 'started', lastCompletedStep: -1 })
│   ├── takeSnapshot()
│   │
│   └── para cada grupo de pasos [paso1, paso2, ...]:
│       │
│       ├── [paso tipo script: agentName.startsWith('__script:')]
│       │   └── _runScript(scriptName, context) → resultado determinístico
│       │
│       ├── [paso tipo agente IA]
│       │   ├── _runAIStep(i)
│       │   │   ├── buildSystemPrompt(i)     ← añadir canónica si está configurada
│       │   │   ├── buildUserMessage(i)
│       │   │   └── callAI / callAIWithSubsystemCLI
│       │   │
│       │   └── [si validateOutput configurado]
│       │       └── runScriptStep('validate-output', rules) → quality score
│       │
│       ├── writeExecutionState({ lastCompletedStep: i, steps[i]: result })
│       │
│       └── [si el paso tiene gate activo]
│           ├── emit SSE: 'gate-open'
│           ├── writeExecutionState({ status: 'paused_gate', stepIndex: i })
│           └── await gateDecision()   ← suspende hasta POST /gate
│               ├── 'approve' → continuar
│               ├── 'revise'  → backup + inyectar feedback + _runAIStep(i) again
│               └── 'cancel'  → abort
│
├── resume(execId)   ← crash recovery
│   ├── leer execution-state.json
│   ├── saltar pasos con status: 'success'
│   └── continuar desde lastCompletedStep + 1
│
└── _runScript(scriptName, context)
    └── scripts-registry.js → función determinística Node.js
        ├── 'generate-file-index' → lista estructurada de ficheros
        ├── 'diff-since-step'     → comparativa de cambios
        ├── 'validate-json'       → verifica formato
        ├── 'quality-score'       → métricas estructurales
        └── 'extract-frontmatter' → extrae YAML sin LLM
```

---

## 8. Viabilidad técnica en Node.js

Una pregunta clave antes de implementar: ¿puede Node.js replicar la sofisticación del orquestador Python de genoma?

**Sí, completamente.** La sofisticación no está en el lenguaje — está en el diseño del orquestador. Node.js tiene equivalentes directos para cada patrón:

### HITL Gates — `Promise` suspendida

Python usa `asyncio.Event`. Node.js usa una `Promise` cuya resolución se almacena en un `Map`:

```js
const pendingGates = new Map(); // `${executionId}-${stepIndex}` → { resolve, reject }

async function waitForGate(executionId, stepIndex) {
  return new Promise((resolve, reject) => {
    pendingGates.set(`${executionId}-${stepIndex}`, { resolve, reject });
    emit('gate-open', { stepIndex }); // SSE al frontend
  });
}

// Endpoint POST /orchestrations/:id/executions/:execId/gate
// → pendingGates.get(key).resolve({ action, feedback })
```

El event loop de Node.js no se bloquea mientras espera. Otras orquestaciones siguen corriendo en paralelo.

### Estado persistente — escritura atómica

Python usa `write-to-temp + os.rename()`. Node.js es idéntico:

```js
const tmp = statePath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
fs.renameSync(tmp, statePath); // atómico en Linux/macOS y casi-atómico en Windows
```

### REVISE loop — backup + reinyección de feedback

```js
async function reviseStep(i, feedback) {
  const backupDir = `.agent-hub/backups/step-${i}-revise-${Date.now()}`;
  await backupModifiedFiles(stepResult.filesModified, backupDir);
  const revisedMessage = buildUserMessage(i, feedback); // inyecta feedback
  return await _runAIStep(i, revisedMessage);
}
```

### Git checkpointing — `child_process.exec`

```js
async function gitCheckpoint(projectPath, message) {
  await exec('git add -A', { cwd: projectPath });
  await exec(`git commit -m "agenthub: ${message}"`, { cwd: projectPath });
  const { stdout } = await exec('git rev-parse HEAD', { cwd: projectPath });
  return stdout.trim(); // SHA para rollback posterior
}

async function gitRollback(projectPath, sha) {
  await exec(`git reset --hard ${sha}`, { cwd: projectPath });
}
```

### Paralelismo — `Promise.all` con concurrencia máxima

Python usa `asyncio.gather`. Node.js tiene el equivalente exacto:

```js
// Equivalente a max_concurrent de genoma
async function runWithConcurrency(tasks, maxConcurrent) {
  const chunks = [];
  for (let i = 0; i < tasks.length; i += maxConcurrent)
    chunks.push(tasks.slice(i, i + maxConcurrent));
  const results = [];
  for (const chunk of chunks)
    results.push(...await Promise.all(chunk.map(t => t())));
  return results;
}
```

### Scripts determinísticos — funciones Node.js puras

```js
// scripts-registry.js — sin llamadas a IA
const scripts = {
  'generate-file-index': async ({ projectPath }) => {
    const files = await listFiles(projectPath);
    return { files, generatedAt: new Date().toISOString() };
  },
  'validate-json': async ({ outputFile }) => {
    try {
      JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  },
  'quality-score': async ({ stepResult }) => {
    // análisis estructural del output: secciones vacías, gaps, cobertura
    // sin invocar al LLM
  },
  'prepare-context': async ({ projectPath, orchestrationId }) => {
    // genera canonical.json como referencia compartida para todos los agentes
  }
};
```

### Tabla de equivalencias Python → Node.js

| Patrón genoma (Python) | Equivalente Node.js | Complejidad |
|---|---|---|
| `asyncio.gather` | `Promise.all` | Directa |
| `asyncio.Event` (gate) | `Promise` + `Map` de resolvers | Directa |
| `write-to-temp + os.rename` | `writeFileSync + renameSync` | Directa |
| `subprocess` (Copilot CLI) | `child_process.spawn` (ya existe en `ai.js`) | Ya implementado |
| `aiohttp` WebSocket broadcast | SSE (ya existe en `server.js`) | Ya implementado |
| `@contextvar` workflow tag | `AsyncLocalStorage` de Node.js | Directa |
| Scripts Python determinísticos | Funciones Node.js puras | Directa |

La ventaja de agenthub respecto a genoma en el punto de partida: **el CLI backend, el SSE streaming y el snapshot de filesystem ya están implementados**. El trabajo es añadir sofisticación al orquestador existente, no construir desde cero.

---

## 9. Conclusión

La fusión es viable tanto a nivel de diseño como a nivel técnico. Node.js replica todos los patrones de genoma sin fricción. La ventaja de agenthub es que puede implementar directamente los patrones que genoma validó en producción a lo largo de 16 ADRs, sin pasar por los mismos errores.

El orden de prioridad recomendado para la implementación:

1. **Scripts determinísticos** (§4.4) — impacto inmediato, menor coste de tokens, cero riesgo de alucinación en tareas estructurales. Incluye el paso de preparación canónica (`__script:prepare-context__`) como primer script del catálogo.
2. **Quality Score por paso** (§4.12) — mejora la visibilidad del resultado sin añadir complejidad al modelo de ejecución.
3. **Estado persistente incremental** (§4.3) — elimina la pérdida de trabajo ante cierres inesperados de Electron.
4. **HITL gates** (§4.1) — el patrón más valioso de genoma para agenthub. "Industrial = autonomous + HITL puntual estratégico." Incluye la pausa del timeout global durante la espera humana.
5. **REVISE por paso** (§4.2) — permite corregir un paso sin re-ejecutar toda la orquestación.
6. **Validación post-escritura determinística** (§4.6) — "instrucciones advisory en prompts ≠ enforcement."
7. **Skills** (§4.11) — agentes más limpios y reutilizables entre proyectos. Skills en el mismo repositorio externo, carpeta `skills/`, sincronizados junto con los agentes.
8. **Atomic Ops ledger** (§4.10) — tracking granular de cambios con ciclo de vida por ejecución.
9. **Publish explícito entre orquestaciones** (§4.8) — el output publicado llega como `temporalContextValues`, no modifica la definición de la orquestación destino.
10. **Git checkpointing** (§4.7) — snapshots reversibles por paso como complemento al snapshot FS actual.
11. **Paralelismo** (§4.9) — grupos de pasos en `Promise.all` con representación visual en el canvas.

**Las lecciones del ADR-016 son aplicables directamente** como principios de diseño para los system prompts de los agentes en agenthub:
- Instruir a los agentes a surfacear conflictos, no a resolverlos silenciosamente
- No poner conocimiento tecnológico en el system prompt del agente — usar skills
- Partir outputs grandes en múltiples pasos con output acotado por paso
- Añadir validación determinística (script) después de pasos críticos que producen JSON/YAML

---

## 10. Cómo usar este documento para la implementación

Este documento es un **documento de diseño**. Contiene el qué, el por qué y los snippets de referencia para cada mejora, pero no es suficiente por sí solo para que una IA lo implemente directamente.

### Flujo de proceso recomendado

```
PASO 1 — Contexto de agenthub (ya existe)
  agenthub/backend.md      ← arquitectura completa del backend Node.js
  agenthub/frontend.md     ← arquitectura completa del frontend React

PASO 2 — Diseño de la fusión (este documento)
  agenthub/genoma-agenthub-fusion.md  ← qué fusionar, por qué, y cómo en Node.js

PASO 3 — Documento operativo (pendiente, crear antes de implementar)
  agenthub/agenthub-implementation-phases.md  ← brief ejecutable para la IA implementadora
      ├── Cambios concretos al modelo de datos (interfaces TypeScript actuales → resultantes)
      ├── Nuevos endpoints (ruta, método, body, response)
      ├── Orden de implementación sin romper orquestaciones existentes en disco
      └── Criterios de "done" por fase (cómo verificar que cada mejora funciona)

PASO 4 — Implementación
  IA de agenthub recibe: backend.md + frontend.md + agenthub-implementation-phases.md
  Implementa fase a fase siguiendo el orden del documento operativo
```

### Qué le falta al documento actual para ser directamente implementable

| Gap | Descripción |
|---|---|
| **Modelo de datos** | Qué campos nuevos añadir a los `interface` de `types.ts`. La IA necesita ver el tipo actual y el tipo resultante. |
| **Endpoints nuevos** | Ruta exacta, método HTTP, body y response de cada endpoint nuevo. El `server.js` actual tiene 40+ endpoints; la IA necesita saber dónde encajan los nuevos. |
| **Compatibilidad con datos existentes** | Qué cambios son backwards-compatible y cuáles requieren migración de orquestaciones ya guardadas en `.agent-hub/orchestrations/`. |
| **Criterios de done** | Cómo verificar que cada mejora funciona correctamente antes de pasar a la siguiente fase. |

### Resumen de lo que este documento sí aporta a la IA implementadora

- El **contexto de por qué** se toma cada decisión (evita que la IA tome atajos que rompan el diseño)
- Los **snippets de Node.js** de referencia para cada patrón (HITL, REVISE, estado persistente, git, paralelismo, scripts)
- La **tabla de equivalencias Python → Node.js** para no reinventar lo que genoma ya validó
- El **orden de prioridad** de las 11 mejoras
- Las **lecciones del ADR-016** como principios de diseño que deben respetarse en cada prompt de agente
