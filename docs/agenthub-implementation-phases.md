# Documento de implementación — Fusión orquestador genoma → agenthub

> Versión agenthub de referencia: **1.9.3**
> Documento de diseño base: `docs/genoma-agenthub-fusion.md`
> Contexto técnico: `docs/backend.md` + `docs/frontend.md`

Este documento es el brief ejecutable para implementar las mejoras del orquestador fase a fase.
Cada fase es independiente y debe funcionar correctamente antes de pasar a la siguiente.

---

## Índice

1. [Prerequisitos y convenciones](#1-prerequisitos-y-convenciones)
2. [Compatibilidad con datos en disco](#2-compatibilidad-con-datos-en-disco)
3. [Fase 1 — Scripts determinísticos + Quality Score + Estado persistente](#3-fase-1--scripts-determinísticos--quality-score--estado-persistente)
4. [Fase 2 — HITL Gates](#4-fase-2--hitl-gates)
5. [Fase 3 — REVISE por paso + Validación post-escritura](#5-fase-3--revise-por-paso--validación-post-escritura)
6. [Fase 4 — Git checkpointing opcional](#6-fase-4--git-checkpointing-opcional)
7. [Fase 5 — Skills](#7-fase-5--skills)
8. [Fase 6 — Atomic Ops ledger](#8-fase-6--atomic-ops-ledger)

---

## 1. Prerequisitos y convenciones

### Ficheros de referencia que debes leer antes de empezar

```
src/backend/orchestrator.js   ← motor de ejecución actual
src/backend/workflows.js      ← CRUD de orquestaciones en disco
src/backend/server.js         ← endpoints existentes (líneas 1618–1792)
src/backend/agents-sync.js    ← sincronización con repositorio externo
src/renderer/types.ts         ← interfaces TypeScript (líneas 163–262)
src/renderer/components/orchestrations/ExecutionPanel.tsx
src/renderer/components/orchestrations/NodeCanvas.tsx
src/renderer/components/orchestrations/OrchestrationEditor.tsx
src/renderer/components/orchestrations/ConnectionConfigurator.tsx
```

### Convenciones del proyecto

- **Sin comentarios redundantes**: solo cuando el "por qué" no es obvio.
- **Sin actualización optimista**: esperar confirmación del servidor antes de actualizar el estado local.
- **`onConfirm` de Modal lanza `throw`**, no `return`, para mantener el modal abierto si falla validación.
- **Español en UI**, inglés en código y tipos.
- **Un solo `styles.css`**: las clases nuevas de UI se añaden ahí, sin CSS Modules.
- **Iconografía**: solo `<i className="ti ti-nombre" />` (Tabler Icons CDN). Sin SVGs inline.

### Estructura de directorios relevante

```
src/backend/
  orchestrator.js        ← modificar en todas las fases
  workflows.js           ← modificar en fases 1, 2, 6
  server.js              ← añadir endpoints en fases 1, 2, 5, 6
  scripts-registry.js    ← CREAR en fase 1
  git-checkpointer.js    ← CREAR en fase 4
  skills.js              ← CREAR en fase 5
  ops-ledger.js          ← CREAR en fase 6

src/renderer/
  types.ts               ← modificar en fases 1, 2, 3, 4, 5, 6
  components/orchestrations/
    ExecutionPanel.tsx   ← modificar en fases 1, 2, 3, 4, 6
    NodeCanvas.tsx       ← modificar en fase 1
    OrchestrationEditor.tsx ← modificar en fases 1, 2
    ConnectionConfigurator.tsx ← modificar en fase 2
  components/agents/
    AgentEditor.tsx      ← modificar en fase 5
```

---

## 2. Compatibilidad con datos en disco

Todas las fases añaden campos **opcionales** a los tipos existentes. Las orquestaciones ya guardadas en `.agent-hub/orchestrations/*.json` deben seguir cargando sin errores.

### Reglas de compatibilidad backwards

| Cambio | Garantía |
|---|---|
| Nuevos campos opcionales en `OrchestrateNode` | `workflows.js` ya hace `JSON.parse` sin validación estricta — los campos nuevos llegan como `undefined` |
| `Orchestration.agents[]` acepta `__script:*` | La validación en `validate()` debe añadir una rama para strings que empiecen por `__script:` antes de buscarlos como agentes en disco |
| Nuevos campos opcionales en `ExecutionConfig` | Se leen con `|| default` en `orchestrator.js` — no rompen configs antiguas |
| `StepResult` con campos nuevos | El `ExecutionPanel.tsx` renderiza los campos nuevos solo si existen |
| `execution-state.json` (nuevo) | Si no existe, el sistema funciona sin crash recovery (degradación graceful) |

### Migración de orquestaciones en disco

No se requiere migración activa. Los ficheros JSON existentes son válidos porque:
- Los campos nuevos (`gateAfter`, `gitEnabled`, etc.) son `?` opcionales.
- El motor de ejecución lee cada campo con fallback explícito.
- El historial de ejecuciones (`result.json`) antiguo no tiene `qualityScore` ni `revisions` — la UI los muestra solo si existen.

---

## 3. Fase 1 — Scripts determinísticos + Quality Score + Estado persistente

### 3.1 Cambios de modelo de datos (`types.ts`)

**Tipos nuevos a añadir:**

```typescript
// Quality score calculado sin LLM después de cada paso
export interface QualityScore {
  score:          number;           // 0-100
  grade:          'green' | 'amber' | 'red';
  filesProduced:  number;
  filesExpected:  number;
  jsonValid:      boolean | null;   // null si el output no es JSON
  coverageRatio:  number | null;    // null si no aplica
  checks:         Array<{ name: string; passed: boolean; detail?: string }>;
}

// Estado incremental de la ejecución (escrito en disco tras cada paso)
export interface ExecutionState {
  executionId:      string;
  orchestrationId:  string;
  projectId:        string;
  status:           'running' | 'completed' | 'failed' | 'paused_gate';
  lastCompletedStep: number;   // -1 = ninguno completado aún
  startedAt:        string;
  pauseStartedAt?:  string;    // ISO timestamp cuando se abrió el gate actual
  steps:            Record<string, { status: 'success' | 'error' | 'warning'; filesModified: string[] }>;
}
```

**Tipos modificados:**

```typescript
// StepResult: añadir qualityScore opcional
export interface StepResult {
  stepIndex:     number;
  agentName:     string;
  input:         { systemPrompt: string; userMessage: string };
  output:        { response: string; toolCalls?: unknown[]; toolResults?: unknown[] };
  filesModified: string[];
  tokensUsed:    { input: number; output: number };
  estimatedCost: number;
  duration:      number;
  status:        'success' | 'error' | 'warning';
  error?:        { message: string; category: string; recoverable: boolean };
  backupPath:    string | null;
  qualityScore?: QualityScore;    // ← NUEVO (opcional)
}
```

### 3.2 Nuevo fichero `src/backend/scripts-registry.js`

Módulo que exporta un registro de funciones determinísticas Node.js. Ninguna llama a la IA.

**Interfaz del módulo:**

```js
// scripts-registry.js
module.exports = {
  isScript(agentName),           // boolean — agentName.startsWith('__script:')
  getScriptName(agentName),      // 'prepare-context' de '__script:prepare-context__'
  async run(scriptName, context) // → ScriptResult
};
```

**`context` recibido en cada script:**

```js
{
  projectPath:    string,   // ruta absoluta al proyecto
  orchestration:  object,   // orquestación completa
  stepIndex:      number,
  prevResult:     object,   // StepResult del paso anterior (o null)
  agentOutputs:   object,   // mapa { stepIndex: { response, handoff, filesModified } }
}
```

**`ScriptResult` devuelto:**

```js
{
  output:        string,    // texto que se pasa como contexto al siguiente agente
  filesModified: string[],  // paths relativos modificados
  data:          object,    // datos estructurados adicionales (opcional)
}
```

**Scripts a implementar en esta fase:**

| Script | Qué hace |
|---|---|
| `prepare-context` | Genera `.agent-hub/context/canonical.json` con índice de ficheros, convenciones detectadas y scope de la orquestación. Todos los agentes posteriores lo reciben via `contextExtra.fixed.files`. |
| `generate-file-index` | Lista estructurada de todos los ficheros del proyecto con stats (ruta, tamaño, extensión, modificado). Devuelve como `output` JSON. |
| `diff-since-step` | Compara el estado actual del FS con el snapshot de un paso anterior. `context.data.sinceStep` indica el paso de referencia. |
| `validate-json` | Verifica que el output del paso anterior es JSON válido. Lee `context.prevResult.output.response`, intenta `JSON.parse`, devuelve `{ valid, error }`. |
| `quality-score` | Calcula el `QualityScore` del paso anterior: ficheros producidos vs. esperados, JSON válido, cobertura. |

**Estructura de `canonical.json`:**

```json
{
  "generatedAt": "2026-06-02T10:00:00Z",
  "projectFiles": [
    { "path": "src/main.ts", "size": 2048, "ext": ".ts", "modified": "..." }
  ],
  "detectedConventions": {
    "primaryLanguage": "typescript",
    "hasTests": true,
    "testPattern": "**/*.test.ts",
    "framework": "react"
  },
  "orchestrationScope": [],
  "previousOutputs": []
}
```

### 3.3 Cambios en `orchestrator.js`

**1. Importar scripts-registry:**

```js
const scriptsRegistry = require('./scripts-registry');
```

**2. En `validate()`: rama para pasos `__script:*`**

Actualmente `validate()` busca cada nombre en `this._getAllAgents()` y falla si no lo encuentra. Añadir **antes** de ese bucle:

```js
// Scripts determinísticos: validar que el nombre sea conocido, no que exista como fichero .md
for (const agentName of (orchestration.agents || [])) {
  if (scriptsRegistry.isScript(agentName)) {
    const scriptName = scriptsRegistry.getScriptName(agentName);
    if (!scriptsRegistry.hasScript(scriptName)) {
      errors.push(`Script no registrado: "${scriptName}" (en "${agentName}")`);
    }
  }
}
```

**3. En `execute()`: desvío a script si el paso es `__script:*`**

En el bucle principal, **antes** de construir `systemPrompt` y llamar a la IA:

```js
// ── Paso tipo script determinístico ───────────────────────────────────────
if (scriptsRegistry.isScript(agentName)) {
  const scriptName = scriptsRegistry.getScriptName(agentName);
  this._log('info', `Paso ${i + 1}: ejecutando script determinístico "${scriptName}"`);
  const scriptResult = await scriptsRegistry.run(scriptName, {
    projectPath:   this.project.path,
    orchestration: this.orchestration,
    stepIndex:     i,
    prevResult:    this.results[i - 1] || null,
    agentOutputs,
  });
  stepResult = {
    stepIndex:     i,
    agentName,
    input:         { systemPrompt: '', userMessage: '' },
    output:        { response: scriptResult.output },
    filesModified: scriptResult.filesModified || [],
    tokensUsed:    { input: 0, output: 0 },
    estimatedCost: 0,
    duration:      Date.now() - stepStart,
    status:        'success',
    backupPath:    snapshot?.snapshotPath || null,
  };
  agentOutputs[i] = { response: scriptResult.output, handoff: null, filesModified: scriptResult.filesModified || [] };
  this.results.push(stepResult);
  stepsCompleted++;
  this.emit('step-done', stepResult);
  this._writeExecutionState(stepsCompleted - 1, stepResult); // ← ver punto 4
  continue; // saltar la lógica de IA
}
// ── Paso tipo agente IA (código existente continúa aquí) ──────────────────
```

**4. Estado persistente incremental — nuevo método `_writeExecutionState(lastStep, stepResult)`**

Llamar después de cada paso completado (éxito o error):

```js
_writeExecutionState(lastCompletedStep, stepResult) {
  if (!this.execDir) return;
  const statePath = path.join(this.execDir, 'execution-state.json');
  const tmp       = statePath + '.tmp';
  const state = {
    executionId:       this.executionId,
    orchestrationId:   this.orchestration.id,
    projectId:         this.project.id,
    status:            'running',
    lastCompletedStep,
    startedAt:         this._startedAt,
    steps: {
      ...(this._executionState?.steps || {}),
      [lastCompletedStep]: {
        status:        stepResult.status,
        filesModified: stepResult.filesModified,
      },
    },
  };
  this._executionState = state;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch {}
}
```

Guardar también `this._startedAt = new Date().toISOString()` al inicio de `execute()`, antes del bucle.

**5. Quality Score — llamar al script `quality-score` tras cada paso de agente IA**

Después de `this.emit('step-done', stepResult)` (pero solo para pasos de agente IA, no scripts):

```js
// Quality score calculado sin LLM
try {
  const qsResult = await scriptsRegistry.run('quality-score', {
    projectPath:   this.project.path,
    orchestration: this.orchestration,
    stepIndex:     i,
    prevResult:    stepResult,
    agentOutputs,
  });
  stepResult.qualityScore = qsResult.data?.qualityScore || null;
} catch {}
```

### 3.4 Nuevo endpoint: `POST /orchestrations/:id/executions/:execId/resume`

Añadir en `server.js` después de `GET /orchestrations/:id/executions/:executionId`:

```
POST /api/orchestrations/:id/executions/:execId/resume
  Body: { projectId: string }
  → lee execution-state.json del execDir
  → crea nuevo OrchestrationExecutor con el estado anterior
  → salta los pasos con status 'success' en el estado
  → reanuda desde lastCompletedStep + 1
  Response: { executionId, status: 'resumed' }
  Error 404: si execution-state.json no existe
  Error 409: si la ejecución ya está completada
```

### 3.5 Cambios en `NodeCanvas.tsx`

Los nodos `__script:*` deben renderizarse visualmente diferente para distinguirlos de los agentes IA.

**En la función de renderizado de nodos** (donde se genera el HTML de cada `.orch-node-agent`):

```tsx
const isScript = agentName.startsWith('__script:');
const scriptLabel = isScript ? agentName.replace('__script:', '').replace('__', '') : null;
```

Añadir clase `.orch-node-script` cuando `isScript === true`. En `styles.css`:

```css
.orch-node-script {
  background: var(--bg3);
  border-left: 3px solid var(--text3);
}
.orch-node-script .orch-node-icon {
  color: var(--text3);
}
```

El icono de scripts usa `ti-terminal-2` en lugar del icono de agente.

**En `getAgentIcon` de `NodeCanvas.tsx`**: añadir al inicio:

```ts
if (name.startsWith('__script:')) return 'ti-terminal-2';
```

### 3.6 Cambios en `OrchestrationEditor.tsx`

**En la paleta de agentes**: añadir una sección "Scripts" separada de los agentes IA, con los scripts disponibles del registro. Los scripts del registro se obtienen del nuevo endpoint `GET /api/scripts`.

### 3.7 Nuevo endpoint: `GET /api/scripts`

```
GET /api/scripts
  Response: Array<{ name: string; label: string; description: string }>
  // devuelve la lista de scripts registrados en scripts-registry.js
```

### 3.8 Cambios en `ExecutionPanel.tsx`

**En el resultado por paso**: mostrar el `qualityScore` si existe como badge debajo del nombre del agente:

```
qualityScore.grade === 'green'  → badge verde   (ti-check)
qualityScore.grade === 'amber'  → badge ámbar   (ti-alert-triangle)
qualityScore.grade === 'red'    → badge coral   (ti-x)
```

Badge clickable que expande los `checks` individuales del quality score.

### 3.9 Criterios de "done" — Fase 1

- [ ] Una orquestación con `["__script:prepare-context__", "code-reviewer"]` valida y ejecuta sin errores.
- [ ] El `canonical.json` se escribe en `.agent-hub/context/` antes de que el segundo paso empiece.
- [ ] Tras cada paso de agente IA, el badge de quality score aparece en `ExecutionPanel.tsx`.
- [ ] Si Electron se cierra durante una ejecución y se relanza, el endpoint `/resume` reanuda desde el último paso completado.
- [ ] Las orquestaciones existentes en disco (sin scripts) siguen funcionando exactamente igual.
- [ ] `validate()` rechaza un `__script:nonexistent__` con mensaje claro.

---

## 4. Fase 2 — HITL Gates

### 4.1 Cambios de modelo de datos (`types.ts`)

**Tipos modificados:**

```typescript
// OrchestrateNode: añadir gateAfter opcional
export interface OrchestrateNode {
  id:           string;
  from:         number;
  to:           number;
  dataFlow:     DataFlow;
  contextExtra: ContextExtra;
  gateAfter?:   boolean;      // ← NUEVO: pausar y esperar decisión humana tras este paso
}

// ExecutionState: añadir campos de pausa
export interface ExecutionState {
  executionId:       string;
  orchestrationId:   string;
  projectId:         string;
  status:            'running' | 'completed' | 'failed' | 'paused_gate';
  lastCompletedStep: number;
  startedAt:         string;
  pauseStartedAt?:   string;   // ← NUEVO
  pausedAtStep?:     number;   // ← NUEVO: stepIndex donde está pausado
  steps:             Record<string, { status: 'success' | 'error' | 'warning'; filesModified: string[] }>;
}
```

### 4.2 Cambios en `orchestrator.js`

**1. Mapa de gates pendientes** (variable de módulo, no de clase):

```js
// Fuera de la clase, a nivel de módulo
const pendingGates = new Map(); // key: `${execId}-${stepIndex}` → { resolve, reject }

function waitForGate(executionId, stepIndex) {
  return new Promise((resolve, reject) => {
    pendingGates.set(`${executionId}-${stepIndex}`, { resolve, reject });
  });
}

function resolveGate(executionId, stepIndex, decision) {
  const key     = `${executionId}-${stepIndex}`;
  const pending = pendingGates.get(key);
  if (!pending) return false;
  pendingGates.delete(key);
  pending.resolve(decision);
  return true;
}

module.exports.resolveGate = resolveGate; // exportar para usarlo desde server.js
```

**2. En `execute()`: comprobación de gate tras cada paso completado con éxito**

Añadir después de `this._writeExecutionState(...)`, antes del `continue` o del fin de la iteración:

```js
// ── Gate HITL ──────────────────────────────────────────────────────────────
const nodeAfterStep = i < this.orchestration.nodes.length ? this.orchestration.nodes[i] : null;
if (nodeAfterStep?.gateAfter && i < orchestration.agents.length - 1) {
  this._log('info', `Paso ${i + 1}: gate HITL activo — esperando decisión del operador`);

  // Pausar timeout: guardamos cuándo empezamos a pausar
  const pauseStart = Date.now();
  this._writeExecutionStateGatePaused(i);
  this.emit('gate-open', { stepIndex: i, agentName, executionId: this.executionId });

  let decision;
  try {
    decision = await waitForGate(this.executionId, i);
  } catch {
    this._log('error', 'Gate cancelado');
    break;
  }

  // Descontar el tiempo de pausa del reloj de timeout
  startTime += (Date.now() - pauseStart);

  this._log('info', `Gate paso ${i + 1}: decisión = ${decision.action}`);

  if (decision.action === 'cancel') break;

  if (decision.action === 'revise') {
    // → Fase 3: lógica REVISE
    // Por ahora: re-ejecutar el paso con feedback inyectado (implementar en Fase 3)
    this._log('warn', 'REVISE: lógica completa implementada en Fase 3');
    // Rewind: quitar el resultado del paso de results[] y volver a ejecutarlo
    // (stub hasta Fase 3)
  }
  // action === 'approve': continuar normalmente al siguiente paso
}
```

**3. Nuevo método `_writeExecutionStateGatePaused(stepIndex)`**:

```js
_writeExecutionStateGatePaused(stepIndex) {
  if (!this.execDir) return;
  const statePath = path.join(this.execDir, 'execution-state.json');
  const tmp       = statePath + '.tmp';
  const state = {
    ...(this._executionState || {}),
    status:         'paused_gate',
    pausedAtStep:   stepIndex,
    pauseStartedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch {}
}
```

### 4.3 Nuevo endpoint: `POST /orchestrations/:id/executions/:execId/gate`

Añadir en `server.js` después del endpoint de resume:

```
POST /api/orchestrations/:id/executions/:execId/gate
  Body:
    { action: 'approve' | 'revise' | 'cancel', feedbackText?: string }
  Lógica:
    const { OrchestrationExecutor } = require('./orchestrator');
    const resolved = OrchestrationExecutor.resolveGate(execId, stepIndex, { action, feedbackText });
    if (!resolved) return res.status(404).json({ error: 'Gate no encontrado o ya resuelto' });
  Response: { ok: true }
```

**Nota**: `stepIndex` se obtiene del `execution-state.json` del `execDir`. El servidor debe localizar el `execDir` a partir de `execId` leyendo los subdirectorios de `.agent-hub/executions/`.

### 4.4 Cambios en `ConnectionConfigurator.tsx`

**Nueva sección "Gate de revisión humana"** al final del panel, después de la sección de contexto temporal:

```tsx
// Solo visible para conexiones inter-agente (no el inputNode)
<div className="orch-conn-section">
  <div className="orch-conn-section-title">
    <i className="ti ti-user-check" /> Gate HITL
  </div>
  <label className="orch-conn-row">
    <input
      type="checkbox"
      checked={gateAfter}
      onChange={e => { setGateAfter(e.target.checked); setDirty(true); }}
    />
    <span>Pausar y esperar aprobación tras este paso</span>
  </label>
  {gateAfter && (
    <p className="orch-conn-hint">
      La orquestación se pausará después de completar este paso.
      El operador podrá aprobar, revisar o cancelar antes de continuar.
    </p>
  )}
</div>
```

Incluir `gateAfter` en el objeto devuelto por `onUpdate` para que se persista en el JSON de la orquestación.

### 4.5 Cambios en `ExecutionPanel.tsx`

**Cuando el SSE recibe evento `gate-open`**: mostrar panel de decisión HITL en lugar de los logs normales.

```tsx
// Estado adicional
const [gateOpen, setGateOpen] = useState<{ stepIndex: number; agentName: string } | null>(null);
const [gateDecision, setGateDecision] = useState<'approve' | 'revise' | null>(null);
const [gateFeedback, setGateFeedback] = useState('');

// En el handler de eventos SSE:
case 'gate-open':
  setGateOpen({ stepIndex: data.stepIndex, agentName: data.agentName });
  break;

// UI del gate (reemplaza el área de logs cuando gateOpen !== null):
{gateOpen && (
  <div className="orch-gate-panel">
    <div className="orch-gate-header">
      <i className="ti ti-user-check" />
      <span>Revisión requerida — Paso {gateOpen.stepIndex + 1}: {gateOpen.agentName}</span>
    </div>
    <p>El paso anterior ha completado. Revisa el resultado antes de continuar.</p>
    {gateDecision === 'revise' && (
      <textarea
        className="orch-gate-feedback"
        placeholder="Feedback para el agente (opcional)..."
        value={gateFeedback}
        onChange={e => setGateFeedback(e.target.value)}
      />
    )}
    <div className="orch-gate-actions">
      <button className="btn primary" onClick={() => resolveGate('approve')}>
        <i className="ti ti-check" /> Aprobar
      </button>
      <button className="btn" onClick={() => setGateDecision('revise')}>
        <i className="ti ti-refresh" /> Revisar
      </button>
      {gateDecision === 'revise' && (
        <button className="btn" onClick={() => resolveGate('revise')}>
          <i className="ti ti-send" /> Enviar feedback
        </button>
      )}
      <button className="btn danger" onClick={() => resolveGate('cancel')}>
        <i className="ti ti-x" /> Cancelar
      </button>
    </div>
  </div>
)}
```

`resolveGate(action)` llama a `POST /orchestrations/:id/executions/:execId/gate`.

**Clases CSS nuevas en `styles.css`**:

```css
.orch-gate-panel {
  background: var(--bg2);
  border: 1px solid var(--amber);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.orch-gate-header { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--amber); }
.orch-gate-feedback { width: 100%; min-height: 80px; background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; color: var(--text0); resize: vertical; }
.orch-gate-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
```

### 4.6 Criterios de "done" — Fase 2

- [ ] Activar `gateAfter: true` en una conexión y ejecutar la orquestación: la ejecución se pausa con evento `gate-open` en el SSE.
- [ ] El panel HITL aparece en `ExecutionPanel.tsx` con los botones Aprobar / Revisar / Cancelar.
- [ ] Click en "Aprobar" reanuda la ejecución y el siguiente paso se ejecuta normalmente.
- [ ] Click en "Cancelar" detiene la ejecución con `status: 'failed'`.
- [ ] El `execution-state.json` refleja `status: 'paused_gate'` mientras el gate está abierto.
- [ ] Si Electron se cierra con un gate abierto, el estado en disco queda como `paused_gate` (no se pierde el progreso de los pasos anteriores).
- [ ] El timeout global no avanza mientras el gate está abierto (verificable comparando `duration` del ejecutor vs. tiempo real).
- [ ] Las orquestaciones sin `gateAfter` no ven ningún cambio de comportamiento.

---

## 5. Fase 3 — REVISE por paso + Validación post-escritura

### 5.1 Cambios de modelo de datos (`types.ts`)

```typescript
// Nueva interfaz para registrar revisiones por paso
export interface StepRevision {
  at:         string;   // ISO timestamp
  feedback:   string | null;
  previousFilesModified: string[];
}

// StepResult: añadir revisions opcional
export interface StepResult {
  // ... campos existentes ...
  qualityScore?:  QualityScore;    // de Fase 1
  revisions?:     StepRevision[];  // ← NUEVO
}
```

### 5.2 Cambios en `orchestrator.js`

**1. Lógica REVISE completa** — reemplazar el stub de Fase 2:

```js
if (decision.action === 'revise') {
  const feedback = decision.feedbackText || null;
  this._log('info', `Paso ${i + 1}: REVISE — backup + re-ejecución`);

  // Backup de los ficheros modificados en este paso
  const reviseBackupDir = path.join(
    this.project.path, '.agent-hub', 'backups',
    `step-${i}-revise-${Date.now()}`
  );
  ensureDir(reviseBackupDir);
  const modifiedByStep = stepResult.filesModified || [];
  for (const relPath of modifiedByStep) {
    try {
      const src = path.join(this.project.path, relPath);
      const dst = path.join(reviseBackupDir, relPath.replace(/\//g, '_'));
      fs.copyFileSync(src, dst);
    } catch {}
  }

  // Revertir al snapshot pre-paso
  try { await this.rollbackStep(i); } catch {}

  // Eliminar el resultado del paso de this.results[]
  this.results.pop();
  stepsCompleted--;

  // Inyectar feedback en el mensaje de usuario para la re-ejecución
  this._revisionFeedback = this._revisionFeedback || {};
  if (!this._revisionFeedback[i]) this._revisionFeedback[i] = [];
  this._revisionFeedback[i].push({ at: new Date().toISOString(), feedback });

  // Decrementar i para que el bucle re-ejecute este paso
  i--;
  continue;
}
```

**2. En `_buildUserMessage(stepIndex)`**: inyectar feedback de revisión si existe:

```js
// Al inicio de _buildUserMessage, antes de cualquier otra lógica:
const revisions = this._revisionFeedback?.[stepIndex];
if (revisions?.length > 0) {
  const latest = revisions[revisions.length - 1];
  if (latest.feedback) {
    message += `## Feedback del operador (revisión ${revisions.length})\n\n${latest.feedback}\n\n`;
  }
}
```

**3. Registrar revisiones en `StepResult`**: al finalizar un paso (éxito), añadir:

```js
stepResult.revisions = (this._revisionFeedback?.[i] || []);
```

**4. Validación post-escritura automática** — script `validate-output` en `scripts-registry.js`:

```js
'validate-output': async ({ projectPath, orchestration, stepIndex, prevResult }) => {
  const issues = [];
  const resp   = prevResult?.output?.response || '';

  // Verificar JSON si el output parece ser JSON
  if (resp.trim().startsWith('{') || resp.trim().startsWith('[')) {
    try { JSON.parse(resp); }
    catch (e) { issues.push({ rule: 'json-valid', message: `Output no parsea como JSON: ${e.message}` }); }
  }

  // Verificar que se produjeron ficheros si el paso debería haberlo hecho
  const filesProduced = prevResult?.filesModified?.length || 0;
  // (lógica extensible: el usuario puede configurar rules en contextExtra)

  return {
    output:  JSON.stringify({ passed: issues.length === 0, issues }),
    filesModified: [],
    data: { passed: issues.length === 0, issues },
  };
}
```

**5. En `execute()` — ejecutar validación automática si está configurada**:

Después del cálculo del quality score (Fase 1), si `orchestration.executionConfig.validateAfterEachStep` es `true`:

```js
if (orchestration.executionConfig?.validateAfterEachStep && !scriptsRegistry.isScript(agentName)) {
  const validation = await scriptsRegistry.run('validate-output', {
    projectPath:   this.project.path,
    orchestration: this.orchestration,
    stepIndex:     i,
    prevResult:    stepResult,
    agentOutputs,
  });
  if (validation.data && !validation.data.passed) {
    this._log('warn', `Paso ${i + 1}: validación post-escritura falló: ${JSON.stringify(validation.data.issues)}`);
    this.emit('step-warning', { stepIndex: i, issues: validation.data.issues });
    // stepResult.status ya es 'success'; actualizar a 'warning'
    stepResult.status = 'warning';
  }
}
```

### 5.3 Cambios en `ExecutionPanel.tsx`

**Botón REVISE en el resultado de cada paso** (visible en tarjeta de paso con status `success` o `warning` cuando hay gate activo):

```tsx
// Solo mostrar durante una gate HITL (gateOpen !== null):
{gateOpen?.stepIndex === stepResult.stepIndex && (
  <button className="btn sm" onClick={() => setGateDecision('revise')}>
    <i className="ti ti-refresh" /> Revisar este paso
  </button>
)}
```

**Mostrar revisiones históricas** en la tarjeta de cada paso si `stepResult.revisions?.length > 0`:

```tsx
{stepResult.revisions && stepResult.revisions.length > 0 && (
  <div className="orch-exec-revisions">
    <span><i className="ti ti-history" /> {stepResult.revisions.length} revisión(es)</span>
  </div>
)}
```

### 5.4 Criterios de "done" — Fase 3

- [ ] Con gate activo en una conexión: click en "Revisar" → textarea de feedback → "Enviar" → el paso se re-ejecuta con el feedback en el prompt.
- [ ] Los ficheros modificados por el paso original se restauran antes de la re-ejecución.
- [ ] El `StepResult` del paso revisado tiene `revisions` con la entrada de feedback.
- [ ] Con `validateAfterEachStep: true` en la config y un paso que produce JSON inválido: el badge del paso aparece en ámbar y el log muestra el error.
- [ ] Se puede revisar el mismo paso múltiples veces (segundo REVISE sobre un paso ya revisado una vez).

---

## 6. Fase 4 — Git checkpointing opcional

### 6.1 Cambios de modelo de datos (`types.ts`)

```typescript
// Project: añadir gitEnabled opcional
export interface Project {
  // ... campos existentes ...
  gitEnabled?: boolean;   // ← NUEVO: si true y el proyecto tiene git, hacer commit tras cada paso
}

// StepResult: añadir gitCommitSha opcional
export interface StepResult {
  // ... campos existentes ...
  qualityScore?:  QualityScore;
  revisions?:     StepRevision[];
  gitCommitSha?:  string;          // ← NUEVO: SHA del commit creado por este paso
}
```

### 6.2 Nuevo fichero `src/backend/git-checkpointer.js`

```js
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function isGitRepo(projectPath) {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: projectPath });
    return true;
  } catch { return false; }
}

async function checkpoint(projectPath, message) {
  await execAsync('git add -A', { cwd: projectPath });
  try {
    await execAsync(`git commit -m "${message.replace(/"/g, "'")}"`, { cwd: projectPath });
  } catch (e) {
    // Si no hay cambios que commitear, git devuelve exit 1 — ignorar
    if (!e.message.includes('nothing to commit')) throw e;
    return null;
  }
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: projectPath });
  return stdout.trim();
}

async function rollbackToSha(projectPath, sha) {
  await execAsync(`git reset --hard ${sha}`, { cwd: projectPath });
}

module.exports = { isGitRepo, checkpoint, rollbackToSha };
```

### 6.3 Cambios en `orchestrator.js`

**1. Importar git-checkpointer:**

```js
const gitCheckpointer = require('./git-checkpointer');
```

**2. En `execute()`: al inicio, determinar si git está disponible para este proyecto:**

```js
const gitAvailable = this.project.gitEnabled
  ? await gitCheckpointer.isGitRepo(this.project.path)
  : false;
```

**3. Tras cada paso completado con éxito**, después de `_writeExecutionState`:

```js
if (gitAvailable) {
  try {
    const sha = await gitCheckpointer.checkpoint(
      this.project.path,
      `agenthub: paso ${i + 1} (${agentName}) [exec:${this.executionId.slice(-6)}]`
    );
    if (sha) {
      stepResult.gitCommitSha = sha;
      this._log('info', `Paso ${i + 1}: git checkpoint → ${sha.slice(0, 7)}`);
    }
  } catch (gitErr) {
    this._log('warn', `Paso ${i + 1}: git checkpoint falló: ${gitErr.message}`);
  }
}
```

**4. En `rollbackStep(stepIndex)`**: usar `gitRollback` si hay SHA disponible, o el snapshot FS como fallback:

```js
async rollbackStep(stepIndex) {
  const stepResult = this.results.find(r => r.stepIndex === stepIndex);
  if (stepResult?.gitCommitSha && this.project.gitEnabled) {
    try {
      // Rollback al commit anterior a este paso
      // git reset --hard usa el commit del paso anterior, o HEAD^ si es el primero
      const prevSha = stepIndex > 0
        ? this.results.find(r => r.stepIndex === stepIndex - 1)?.gitCommitSha
        : null;
      if (prevSha) {
        await gitCheckpointer.rollbackToSha(this.project.path, prevSha);
        return;
      }
    } catch {}
  }
  // Fallback: snapshot FS (lógica existente)
  // ... código existente de rollbackStep ...
}
```

### 6.4 Cambios en `ExecutionPanel.tsx`

En la tarjeta de cada paso completado, mostrar el SHA git si existe:

```tsx
{stepResult.gitCommitSha && (
  <span className="orch-exec-git-sha">
    <i className="ti ti-git-commit" />
    {stepResult.gitCommitSha.slice(0, 7)}
  </span>
)}
```

### 6.5 Criterios de "done" — Fase 4

- [ ] Proyecto con `gitEnabled: true` y repositorio git inicializado: tras cada paso, aparece un commit con mensaje `agenthub: paso N (agentName)`.
- [ ] El SHA del commit aparece en la tarjeta del paso en `ExecutionPanel.tsx`.
- [ ] Rollback de un paso en un proyecto con git usa `git reset --hard` al SHA del paso anterior.
- [ ] Proyecto con `gitEnabled: false` (o campo ausente): ningún commit se crea, comportamiento idéntico al actual.
- [ ] Si `git commit` no tiene cambios que commitear (agente no modificó nada): no se crea commit vacío, el paso sigue como `success`.
- [ ] Si `git add -A && git commit` falla por cualquier razón (permisos, repo corrupto): el error se registra como `warn` en el log pero la ejecución NO se interrumpe.

---

## 7. Fase 5 — Skills

### 7.1 Cambios de modelo de datos (`types.ts`)

```typescript
// Nueva interfaz Skill
export interface Skill {
  name:        string;
  description: string;
  content:     string;   // markdown con el conocimiento tecnológico
  level?:      'global' | 'section' | 'tech' | 'project';
  categoryId?: string | null;
  techId?:     string | null;
}

// Agent: añadir skills opcional
export interface Agent {
  name:        string;
  description: string;
  model:       string;
  tools:       string[];
  system:      string;
  optimized?:  boolean;
  level?:      'global' | 'section' | 'tech' | 'project' | 'uncategorized';
  categoryId?: string | null;
  techId?:     string | null;
  projectId?:  string | null;
  suggested?:  boolean;
  skills?:     string[];   // ← NUEVO: nombres de skills asociadas al agente
}
```

### 7.2 Nuevo fichero `src/backend/skills.js`

Módulo paralelo a `agents.js` para CRUD de skills. Los skills tienen el mismo formato de fichero que los agentes (`.md` con frontmatter YAML) pero sin `tools`, `model` ni `system`. Solo `name`, `description` y el body es el contenido del skill.

**Estructura del fichero `.md` de un skill:**

```markdown
---
name: typescript-strict
description: Convenciones TypeScript strict mode con tipos explícitos
---

Usa siempre tipos explícitos. Evita `any`. Prefiere `unknown` sobre `any`.
Activa `strictNullChecks`. Los parámetros opcionales van con `?:` no `| undefined`.
```

**Funciones exportadas:**

```js
listSkillsByLevel(level, catId, techId)  // → Skill[]
createSkill(level, catId, techId, skill) // → void
updateSkill(level, catId, techId, skill) // → void
deleteSkill(level, catId, techId, name)  // → void
getSkillsDir(level, catId, techId)       // → string (ruta al directorio)
```

El directorio de skills sigue la misma convención que agentes, pero bajo `skills/` en vez de `agents/`:

```
APP_DIR/
  skills/
    global/
    section-{catId}/
    tech-{catId}-{techId}/
    uncategorized/
```

### 7.3 Cambios en `agents-sync.js`

**En el mapeo de rutas remotas → locales**, añadir soporte para la carpeta `skills/` del repositorio externo:

```js
// Función de mapeo remoto → local (ya existente en agents-sync.js)
function mapRemotePath(remotePath) {
  // SKILLS: nueva rama antes de la lógica de agentes
  if (remotePath.startsWith('skills/global/') || remotePath.startsWith('global-skills/')) {
    return { type: 'skill', local: `skills/global/${path.basename(remotePath)}` };
  }
  if (remotePath.match(/^skills\/section-(.+)\//)) {
    return { type: 'skill', local: remotePath };
  }
  if (remotePath.match(/^skills\/tech-(.+)-.+\//)) {
    return { type: 'skill', local: remotePath };
  }
  // ... lógica existente para agents ...
}
```

La escritura de skills descargados usa el mismo mecanismo que agentes: `writeFileSync` a la ruta local, actualización de `agents-meta.json`.

**En `syncGlobalAgentsToClaudeDir()`**: no copiar skills a `~/.claude/agents/` (Claude Code no tiene concepto de skills).

### 7.4 Nuevos endpoints en `server.js`

Añadir después de los endpoints de agentes (línea ~1617):

```
GET  /api/skills?level=&categoryId=&techId=  → Skill[]
POST /api/skills                             → crea skill
PUT  /api/skills                             → actualiza skill
DELETE /api/skills?level=&name=&categoryId=&techId= → elimina skill
GET  /api/skills/flat                        → todos los skills (para selector en AgentEditor)
```

Misma estructura de handler que los endpoints de agentes existentes.

### 7.5 Cambios en `AgentEditor.tsx`

**Nueva sección "Skills asociadas"** debajo del campo "Herramientas":

```tsx
// Cargar skills disponibles para el nivel del agente
const [allSkills, setAllSkills] = useState<Skill[]>([]);
useEffect(() => {
  req<Skill[]>('GET', '/api/skills/flat').then(setAllSkills).catch(() => {});
}, []);

// UI: selector multi con chips removibles
<div className="agent-editor-section">
  <label>Skills asociadas</label>
  <div className="agent-skills-selector">
    {agent.skills?.map(skillName => (
      <span key={skillName} className="tool-pill">
        {skillName}
        <button onClick={() => removeSkill(skillName)}>×</button>
      </span>
    ))}
    <select onChange={e => addSkill(e.target.value)} value="">
      <option value="">Añadir skill...</option>
      {allSkills.filter(s => !agent.skills?.includes(s.name)).map(s => (
        <option key={s.name} value={s.name}>{s.name} — {s.description}</option>
      ))}
    </select>
  </div>
  <p className="agent-hint">
    Las skills inyectan conocimiento tecnológico específico al system prompt en cada ejecución.
    Mantén el system prompt del agente enfocado en la tarea; el contexto tecnológico va en skills.
  </p>
</div>
```

### 7.6 Cambios en `orchestrator.js` — inyección de skills

**En `_buildSystemPrompt(stepIndex)`**: después de construir el `prompt` base del agente, inyectar las skills:

```js
// Inyectar skills del agente si tiene alguna asociada
const agent = this._getAgent(agentName);
if (agent?.skills?.length > 0) {
  const { listSkillsByLevel } = require('./skills');
  const cfg = readConfig();
  const allSkills = [];
  // Recopilar todos los skills de todos los niveles (misma lógica que _getAllAgents)
  try { allSkills.push(...listSkillsByLevel('global')); } catch {}
  // ... section/tech según proyecto ...

  for (const skillName of agent.skills) {
    const skill = allSkills.find(s => s.name === skillName);
    if (skill?.content?.trim()) {
      prompt += `\n\n# SKILL: ${skill.name}\n${skill.content.trim()}`;
    }
  }
}
```

### 7.7 Criterios de "done" — Fase 5

- [ ] Crear un skill global desde la UI → el fichero `.md` aparece en `skills/global/`.
- [ ] Asociar un skill a un agente en `AgentEditor.tsx` → el campo `skills` se persiste en el `.md` del agente.
- [ ] Ejecutar una orquestación con un agente que tiene skills: el system prompt enviado al modelo incluye el contenido del skill.
- [ ] `agents-sync.js` descarga skills del repositorio externo (carpeta `skills/`) en el mismo ciclo de sync que los agentes.
- [ ] Los agentes sin `skills` (campo ausente) funcionan exactamente igual que antes.

---

## 8. Fase 6 — Atomic Ops ledger

### 8.1 Cambios de modelo de datos (`types.ts`)

```typescript
// Operación atómica individual
export interface AtomicOp {
  id:               string;   // 'op-{uuid8}'
  executionId:      string;
  orchestrationId:  string;
  stepIndex:        number;
  agentName:        string;
  kind:             'add' | 'modify' | 'remove';
  filePath:         string;   // ruta relativa al proyecto
  status:           'applied' | 'reverted';
  createdAt:        string;
  appliedAt:        string;
  revertedAt?:      string;
}

// Ledger del proyecto (acumula todas las ejecuciones)
export interface OpsLedger {
  projectId:        string;
  orchestrationId:  string;
  ops:              AtomicOp[];
  lastUpdated:      string;
}
```

### 8.2 Nuevo fichero `src/backend/ops-ledger.js`

```js
// ops-ledger.js — ledger append-only de operaciones por orquestación

const fs   = require('fs');
const path = require('path');
const { ensureDir } = require('./config');

function getLedgerPath(projectPath, orchestrationId) {
  return path.join(projectPath, '.agent-hub', 'ops', `${orchestrationId}-ledger.json`);
}

function readLedger(projectPath, orchestrationId) {
  const p = getLedgerPath(projectPath, orchestrationId);
  if (!fs.existsSync(p)) return { ops: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { ops: [] }; }
}

function appendOps(projectPath, orchestrationId, newOps) {
  const ledgerPath = getLedgerPath(projectPath, orchestrationId);
  ensureDir(path.dirname(ledgerPath));
  const ledger = readLedger(projectPath, orchestrationId);
  ledger.ops.push(...newOps);
  ledger.lastUpdated = new Date().toISOString();
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);
}

function revertOp(projectPath, orchestrationId, opId) {
  const ledger = readLedger(projectPath, orchestrationId);
  const op = ledger.ops.find(o => o.id === opId);
  if (!op || op.status === 'reverted') return false;
  op.status     = 'reverted';
  op.revertedAt = new Date().toISOString();
  const ledgerPath = getLedgerPath(projectPath, orchestrationId);
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);
  return true;
}

module.exports = { readLedger, appendOps, revertOp };
```

### 8.3 Cambios en `orchestrator.js`

**1. Importar ops-ledger:**

```js
const opsLedger = require('./ops-ledger');
```

**2. Tras cada paso**: generar ops para cada fichero modificado y añadirlas al ledger:

```js
// Después de detectar filesModified y antes de this.emit('step-done', stepResult):
if (filesModified.length > 0) {
  const newOps = filesModified.map(filePath => ({
    id:              `op-${crypto.randomBytes(4).toString('hex')}`,
    executionId:     this.executionId,
    orchestrationId: this.orchestration.id,
    stepIndex:       i,
    agentName,
    kind:            'modify',   // TODO: detectar add/remove con snapshot comparison
    filePath,
    status:          'applied',
    createdAt:       new Date().toISOString(),
    appliedAt:       new Date().toISOString(),
  }));
  try {
    opsLedger.appendOps(this.project.path, this.orchestration.id, newOps);
  } catch {}
}
```

### 8.4 Nuevos endpoints en `server.js`

```
GET  /api/orchestrations/:id/ops?projectId=
  → lee ops-ledger.json y devuelve OpsLedger

POST /api/orchestrations/:id/ops/:opId/revert?projectId=
  → marca la op como 'reverted' en el ledger
  → NO restaura el fichero automáticamente (el rollback sigue siendo por paso completo)
  → Response: { ok: true, op: AtomicOp }
```

### 8.5 Cambios en `ExecutionPanel.tsx`

**Nueva tab "Operaciones"** en la vista de resultado, junto a los pasos:

```tsx
// Tabs: "Pasos" | "Operaciones"
{activeTab === 'ops' && (
  <div className="orch-exec-ops">
    {ops.map(op => (
      <div key={op.id} className={`orch-exec-op-row ${op.status === 'reverted' ? 'reverted' : ''}`}>
        <i className={`ti ${op.kind === 'add' ? 'ti-file-plus' : op.kind === 'remove' ? 'ti-file-minus' : 'ti-file-pencil'}`} />
        <span className="orch-exec-op-path">{op.filePath}</span>
        <span className="orch-exec-op-agent">{op.agentName}</span>
        <span className={`badge ${op.status === 'reverted' ? 'gray' : 'green'}`}>{op.status}</span>
      </div>
    ))}
  </div>
)}
```

**Clases CSS en `styles.css`**:

```css
.orch-exec-ops { display: flex; flex-direction: column; gap: 0.25rem; }
.orch-exec-op-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.5rem; border-radius: 5px; background: var(--bg2); font-size: 0.8rem; }
.orch-exec-op-row.reverted { opacity: 0.5; text-decoration: line-through; }
.orch-exec-op-path { flex: 1; font-family: 'JetBrains Mono', monospace; color: var(--text1); }
.orch-exec-op-agent { color: var(--text3); font-size: 0.75rem; }
```

### 8.6 Criterios de "done" — Fase 6

- [ ] Ejecutar una orquestación que modifica 3 ficheros: el ledger `ops-ledger.json` tiene 3 ops con `status: 'applied'`.
- [ ] La tab "Operaciones" en `ExecutionPanel.tsx` muestra las ops de la ejecución actual.
- [ ] `POST /ops/:opId/revert` marca la op como `reverted` en el ledger (no restaura el fichero, solo el estado de la op).
- [ ] Ejecutar la misma orquestación una segunda vez: el ledger acumula las nuevas ops sin borrar las anteriores.
- [ ] Una op de una ejecución anterior marcada como `reverted` sigue apareciendo con ese estado en la segunda ejecución.
- [ ] Si el proyecto no tiene ejecuciones, el ledger no existe y `GET /ops` devuelve `{ ops: [] }`.

---

## Apéndice A — Tabla de ficheros por fase

| Fichero | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 | Fase 6 |
|---|---|---|---|---|---|---|
| `orchestrator.js` | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ |
| `workflows.js` | ✏️ | — | — | — | — | — |
| `server.js` | ✏️ | ✏️ | — | — | ✏️ | ✏️ |
| `agents-sync.js` | — | — | — | — | ✏️ | — |
| `scripts-registry.js` | 🆕 | — | ✏️ | — | — | — |
| `git-checkpointer.js` | — | — | — | 🆕 | — | — |
| `skills.js` | — | — | — | — | 🆕 | — |
| `ops-ledger.js` | — | — | — | — | — | 🆕 |
| `types.ts` | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ | ✏️ |
| `ExecutionPanel.tsx` | ✏️ | ✏️ | ✏️ | ✏️ | — | ✏️ |
| `NodeCanvas.tsx` | ✏️ | — | — | — | — | — |
| `OrchestrationEditor.tsx` | ✏️ | — | — | — | — | — |
| `ConnectionConfigurator.tsx` | — | ✏️ | — | — | — | — |
| `AgentEditor.tsx` | — | — | — | — | ✏️ | — |
| `styles.css` | ✏️ | ✏️ | — | — | — | ✏️ |

---

## Apéndice B — Nuevos endpoints por fase

| Fase | Método | Ruta | Descripción |
|---|---|---|---|
| 1 | GET | `/api/scripts` | Lista scripts registrados |
| 1 | POST | `/api/orchestrations/:id/executions/:execId/resume` | Reanuda tras crash |
| 2 | POST | `/api/orchestrations/:id/executions/:execId/gate` | Resuelve gate HITL |
| 5 | GET | `/api/skills` | Lista skills por nivel |
| 5 | POST | `/api/skills` | Crea skill |
| 5 | PUT | `/api/skills` | Actualiza skill |
| 5 | DELETE | `/api/skills` | Elimina skill |
| 5 | GET | `/api/skills/flat` | Todos los skills (para selector) |
| 6 | GET | `/api/orchestrations/:id/ops` | Lee ops-ledger |
| 6 | POST | `/api/orchestrations/:id/ops/:opId/revert` | Marca op como revertida |

---

## Apéndice C — Estructura de directorios en `.agent-hub/` tras todas las fases

```
{projectPath}/
└── .agent-hub/
    ├── orchestrations/
    │   └── {orchId}.json
    ├── executions/
    │   └── {timestamp}-{execId8}/
    │       ├── metadata.json
    │       ├── execution-state.json   ← Fase 1 (incremental, escritura atómica)
    │       ├── result.json
    │       ├── agent_outputs.json
    │       ├── logs.jsonl
    │       └── backups/
    │           ├── pre-step-0.json    ← snapshot FS antes de cada paso
    │           ├── pre-step-1.json
    │           └── step-1-revise-{ts}/ ← Fase 3 (backup de revisión)
    ├── context/
    │   └── canonical.json             ← Fase 1 (script prepare-context)
    ├── ops/
    │   └── {orchId}-ledger.json       ← Fase 6 (append-only)
    └── published/
        └── {ts}-{fromOrchId}.json     ← Fase 2 doc 4.8 (publish-to)
```
