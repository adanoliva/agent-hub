# Orquestador + Pantalla de Orquestaciones — Documento de Implementación

> **Agent Hub v1.8.2+**  
> Especificación técnica completa para el Orquestador de workflows multiagente y la pantalla visual de editor de orquestaciones.  
> Asume: Subsistema CLI implementado, Orquestador existente (expandido), API-FS funcional.

---

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Arquitectura del sistema](#2-arquitectura-del-sistema)
3. [Componentes backend](#3-componentes-backend)
4. [Componentes frontend](#4-componentes-frontend)
5. [Interfaces TypeScript](#5-interfaces-typescript)
6. [APIs REST](#6-apis-rest)
7. [Flujos end-to-end](#7-flujos-end-to-end)
8. [Almacenamiento y persistencia](#8-almacenamiento-y-persistencia)
9. [Seguridad y validaciones](#9-seguridad-y-validaciones)
10. [Integración con Subsistema CLI](#10-integración-con-subsistema-cli)
11. [Ejemplos de uso](#11-ejemplos-de-uso)
12. [Testing](#12-testing)
13. [Roadmap futuro](#13-roadmap-futuro)

---

## 1. Visión general

### Objetivo

Permitir a usuarios crear, editar y ejecutar **workflows de múltiples agentes** a nivel de proyecto. Cada workflow es una **secuencia configurable de agentes** donde:

- Cada agente ejecuta sobre el proyecto (con acceso a filesystem vía Subsistema CLI)
- El output de un agente se inyecta como contexto al siguiente
- Se pueden configurar **contextos extra** (fijo/temporal) por conexión
- Se valida contexto antes de ejecutar
- Se genera auditoría completa de ejecución
- Se permite rollback granular de cambios

### Casos de uso

```
Ejemplo 1: Code Review + Refactor + Testing
  [code-reviewer] → analiza código
       ↓ (output + archivos)
  [refactor-expert] → refactoriza basado en análisis
       ↓ (output + archivos modificados)
  [test-generator] → genera tests para cambios


Ejemplo 2: Documentation Auto-Generation
  [code-analyzer] → extrae signatures + comentarios
       ↓
  [doc-writer] → genera documentación
       ↓
  [doc-formatter] → formatea y estructura


Ejemplo 3: Security Audit + Fix
  [security-checker] → identifica vulnerabilidades
       ↓ (reporte + rutas vulnerables)
  [security-fixer] → aplica patches
       ↓ (cambios aplicados)
  [test-validator] → valida que tests pasen
```

### Componentes clave

```
Backend:
  ├── orchestrator.js          ← Máquina de estados, coordinación
  ├── workflows.js             ← CRUD de workflows/orquestaciones
  ├── execution-engine.js      ← Ejecución secuencial de pasos
  └── server.js (modificado)   ← Rutas REST nuevas

Frontend:
  ├── pages/Orchestrations.tsx        ← Página principal
  ├── components/orchestrations/
  │   ├── OrchestrationList.tsx       ← Listado
  │   ├── OrchestrationEditor.tsx     ← Editor visual
  │   ├── NodeCanvas.tsx              ← Canvas de agentes
  │   ├── ConnectionConfigurator.tsx  ← Configura conexiones
  │   └── ExecutionPanel.tsx          ← Ejecución en vivo
  └── store/orchestrations.ts         ← Estado global (zustand)

Storage:
  .agent-hub/
  ├── orchestrations/
  │   ├── orch-{id}.json              ← Definición de orquestación
  │   └── ...
  └── executions/
      ├── exec-{timestamp}/
      │   ├── metadata.json            ← Info de ejecución
      │   ├── logs.jsonl               ← Logs estructurados
      │   ├── changes.json             ← Cambios por paso
      │   ├── agent_outputs.json       ← Outputs por agente
      │   └── backups/                 ← Snapshots de archivos
      └── ...
```

---

## 2. Arquitectura del sistema

### Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React 19)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Orchestrations Page                                        │
│  ├─ List (CRUD basado en proyecto)                         │
│  ├─ Editor (Canvas visual)                                 │
│  │  ├─ AgentSequence (listado de agentes)                  │
│  │  ├─ NodeCanvas (visualización)                          │
│  │  └─ ConnectionConfigurator (configura nodos)            │
│  └─ ExecutionPanel (running + logs en vivo)               │
│                                                             │
│  State Management (Zustand)                                │
│  └─ orchestrations store                                   │
│                                                             │
└──────────────────────────────────────────────────────────────┘
                            ↕ (HTTP)
┌─────────────────────────────────────────────────────────────┐
│                  Backend (Electron + Express)              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  API REST (port 3737)                                       │
│  ├─ GET/POST/PUT/DELETE /api/orchestrations/:id            │
│  ├─ POST /api/orchestrations/:id/execute                   │
│  ├─ GET /api/orchestrations/:id/executions                 │
│  ├─ SSE /api/orchestrations/:id/execute/stream             │
│  └─ ... (ver sección APIs)                                 │
│                                                             │
│  Orquestador (Execution Engine)                             │
│  ├─ Máquina de estados                                      │
│  ├─ Coordinación de pasos                                   │
│  ├─ Inyección de contexto                                   │
│  ├─ Rollback granular                                       │
│  └─ Auditoría                                              │
│                                                             │
│  CRUD Workflows (workflows.js)                              │
│  ├─ create, read, update, delete                           │
│  ├─ list por proyecto                                       │
│  └─ validaciones                                            │
│                                                             │
│  Subsistema CLI (ya existente)                              │
│  ├─ CLI Virtual (API/GitHub)                                │
│  └─ Tool call execution                                     │
│                                                             │
│  API-FS (ya existente)                                      │
│  └─ Filesystem operations                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↕ (IPC)
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                   │
├─────────────────────────────────────────────────────────────┤
│  IPC handlers, auto-updater, tray, window management        │
└─────────────────────────────────────────────────────────────┘
                            ↕ (FS)
┌─────────────────────────────────────────────────────────────┐
│                    Filesystem (Local)                       │
├─────────────────────────────────────────────────────────────┤
│  .agent-hub/orchestrations/    (definiciones)              │
│  .agent-hub/executions/        (auditoría + backups)       │
│  CLAUDE.md / copilot-instructions.md                        │
│  src/ (proyecto)                                            │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de datos (ejecución)

```
1. Usuario inicia ejecución en UI
        ↓
2. Frontend: Recolecta contexto temporal (si aplica)
        ↓
3. POST /api/orchestrations/:id/execute
        ↓
4. Backend: OrchestrationExecutor.validate()
   - Verificar que todos los agentes existen
   - Verificar que CLAUDE.md existe (si es necesario)
   - Verificar contextos fijos
   - Validar dataFlow
        ↓
5. Backend: OrchestrationExecutor.run()
   - Crear execution metadata
   - Para cada paso (i):
     a) Inyectar contexto (paso anterior + contexto extra)
     b) Invocar agente vía AI
     c) Capturar output + cambios en FS
     d) Si error y stopOnError → rollback y abort
     e) Log paso completado
   - Generar reporte final
        ↓
6. SSE stream de progreso
        ↓
7. Frontend: Renderiza logs en vivo + resultado
```

---

## 3. Componentes backend

### 3.1 Orquestador (orchestrator.js)

Máquina de estados que coordina la ejecución de un workflow.

**Responsabilidades:**
- Validar precondiciones
- Coordinar ejecución secuencial de agentes
- Inyectar contexto entre pasos
- Capturar outputs y cambios en FS
- Gestionar rollback
- Generar auditoría

**Estados:**

```
idle ──validate──> validating ──ok──> ready
                       ↓              ↓
                     error ────────> failed

ready ──start──> running ──step──> step_running
                              ↓
                           step_done
                              ↓
                          running (loop) ──all_done──> completed
                              ↓
                            error ──→ rolling_back ──> failed


Legend:
  idle: estado inicial
  validating: verificando precondiciones
  ready: listo para ejecutar
  running: ejecutando pasos
  step_running: un paso en curso
  step_done: paso completado
  rolling_back: restaurando archivos
  completed: éxito
  failed: error terminal
```

**Interfaz (pseudocódigo TypeScript):**

```typescript
class OrchestrationExecutor {
  private orchestrationId: string;
  private projectId: string;
  private agentNames: string[];
  private nodes: OrchestrateNode[];
  private state: 'idle' | 'validating' | 'ready' | 'running' | 'completed' | 'failed';
  private currentStep: number;
  private results: Map<number, StepResult>;
  private backups: Map<number, BackupInfo[]>;
  private logs: ExecutionLog[];

  // Ciclo principal
  async validate(): Promise<ValidationResult>;
  async execute(): Promise<ExecutionResult>;
  private async executeStep(stepIndex: number): Promise<StepResult>;
  
  // Context injection
  private buildStepSystemPrompt(stepIndex: number): string;
  private buildStepUserMessage(stepIndex: number): string;
  
  // Filesystem
  private async backupStep(stepIndex: number): Promise<BackupInfo>;
  private async rollbackStep(stepIndex: number): Promise<void>;
  
  // Logging
  private logStep(level: 'info'|'warn'|'error', message: string): void;
  async getExecutionLogs(): Promise<ExecutionLog[]>;
  
  // Results
  async getExecutionResult(): Promise<ExecutionResult>;
}

interface OrchestrateNode {
  id: string;
  from: number;           // índice agente anterior
  to: number;             // índice agente siguiente
  dataFlow: DataFlow;
  contextExtra: ContextExtra;
}

interface StepResult {
  stepIndex: number;
  agentName: string;
  input: {
    systemPrompt: string;
    userMessage: string;
  };
  output: {
    response: string;
    toolCalls?: ToolCall[];
  };
  filesModified: string[];
  tokensUsed: {
    input: number;
    output: number;
  };
  duration: number;
  status: 'success' | 'error' | 'warning';
  error?: {
    message: string;
    category: string; // 'validation' | 'execution' | 'fs' | 'timeout'
    recoverable: boolean;
  };
  backupPath: string;
}

interface ExecutionResult {
  orchestrationId: string;
  projectId: string;
  executionId: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  status: 'success' | 'partial' | 'failed';
  stepsCompleted: number;
  totalSteps: number;
  totalTokensUsed: {
    input: number;
    output: number;
  };
  estimatedCost: number;
  results: StepResult[];
  errors: ErrorReport[];
  summary: {
    filesModified: number;
    filesCreated: number;
    filesDeleted: number;
    linesAdded: number;
    linesRemoved: number;
  };
  changes: FileChange[];
  backups: {
    [stepIndex: string]: string;  // path del backup
  };
}
```

**Algoritmo de ejecución (pseudocódigo):**

```typescript
async execute(): Promise<ExecutionResult> {
  // 1. Crear metadata
  const executionId = generateId();
  const execution = {
    orchestrationId: this.orchestrationId,
    projectId: this.projectId,
    executionId,
    startedAt: now(),
    steps: [],
    backups: {},
  };

  // 2. Para cada agente en la secuencia
  for (let i = 0; i < this.agentNames.length; i++) {
    const agentName = this.agentNames[i];
    const node = this.nodes[i - 1]; // Conexión anterior

    try {
      // 2a. Backup del estado actual
      const backup = await this.backupStep(i);
      execution.backups[i] = backup.path;

      // 2b. Construir prompt con contexto
      const systemPrompt = this.buildStepSystemPrompt(i);
      const userMessage = this.buildStepUserMessage(i);

      // 2c. Invocar agente
      const agentResponse = await this.callAgent({
        agentName,
        systemPrompt,
        userMessage,
      });

      // 2d. Si API/GitHub: ejecutar tool calls vía Subsistema CLI
      if (agentResponse.toolCalls && agentResponse.toolCalls.length > 0) {
        const toolResults = await this.executeToolCalls(
          agentResponse.toolCalls,
          this.projectPath
        );
        agentResponse.toolResults = toolResults;
      }

      // 2e. Capturar cambios en FS
      const filesModified = await this.detectChanges(backup);

      // 2f. Guardar resultado
      const stepResult: StepResult = {
        stepIndex: i,
        agentName,
        input: { systemPrompt, userMessage },
        output: agentResponse,
        filesModified,
        tokensUsed: agentResponse.usage,
        duration: agentResponse.duration,
        status: 'success',
        backupPath: backup.path,
      };

      execution.steps.push(stepResult);
      this.logStep('info', `Paso ${i + 1}: ${agentName} completado`);

    } catch (error) {
      // 2g. Manejo de errores
      const errorResult: StepResult = {
        stepIndex: i,
        agentName,
        status: 'error',
        error: {
          message: error.message,
          category: this.categorizeError(error),
          recoverable: !error.fatal,
        },
        backupPath: execution.backups[i],
      };

      execution.steps.push(errorResult);
      this.logStep('error', `Paso ${i + 1}: ${agentName} falló: ${error.message}`);

      if (this.orchestration.executionConfig.stopOnError) {
        // Rollback
        await this.rollbackStep(i);
        return {
          ...execution,
          completedAt: now(),
          status: 'failed',
          stepsCompleted: i,
          totalSteps: this.agentNames.length,
          errors: [errorResult.error],
        };
      }
    }
  }

  // 3. Generar reporte final
  return {
    ...execution,
    completedAt: now(),
    status: execution.steps.every(s => s.status === 'success') ? 'success' : 'partial',
    stepsCompleted: execution.steps.filter(s => s.status !== 'error').length,
    totalSteps: this.agentNames.length,
    totalTokensUsed: this.sumTokens(execution.steps),
    estimatedCost: this.calculateCost(execution.steps),
    summary: this.buildSummary(execution.steps),
    changes: await this.diffChanges(execution.backups),
  };
}

// Inyección de contexto
private buildStepSystemPrompt(stepIndex: number): string {
  const agent = await this.getAgent(this.agentNames[stepIndex]);
  let systemPrompt = agent.system;

  // Agregar contexto del proyecto
  systemPrompt += `\n\n# CONTEXTO DEL PROYECTO\n${this.claudeMd}`;

  // Agregar contexto fijo del nodo
  if (stepIndex > 0) {
    const prevNode = this.nodes[stepIndex - 1];
    if (prevNode.contextExtra.fixed) {
      const fixedContent = await this.getContextContent(prevNode.contextExtra.fixed);
      systemPrompt += `\n\n# CONTEXTO EXTRA (${prevNode.contextExtra.fixed.label})\n${fixedContent}`;
    }
  }

  return systemPrompt;
}

private buildStepUserMessage(stepIndex: number): string {
  let message = '';

  // Agregar output del paso anterior
  if (stepIndex > 0) {
    const prevResult = this.results.get(stepIndex - 1);
    const prevNode = this.nodes[stepIndex - 1];

    if (prevNode.dataFlow.agentOutput) {
      message += `## Análisis anterior\n${prevResult.output.response}\n\n`;
    }

    if (prevNode.dataFlow.filesModified && prevResult.filesModified.length > 0) {
      message += `## Archivos analizados\n${prevResult.filesModified.join(', ')}\n\n`;
    }

    if (prevNode.dataFlow.claudeMd) {
      // Ya está en systemPrompt, saltar
    }

    if (prevNode.contextExtra.temporal && prevNode.contextExtra.temporal.length > 0) {
      // Agregar contextos temporales recolectados en ejecución
      for (const temp of prevNode.contextExtra.temporal) {
        const tempContent = await this.getTemporalContext(temp, stepIndex);
        if (tempContent) {
          message += `## ${temp.label}\n${tempContent}\n\n`;
        }
      }
    }
  }

  // Tarea predefinida para este agente
  const task = this.deriveAgentTask(this.agentNames[stepIndex]);
  message += `## Tarea\n${task}`;

  return message;
}
```

### 3.2 CRUD de Workflows (workflows.js)

Gestiona la persistencia y validación de orquestaciones.

```typescript
class WorkflowManager {
  // CRUD
  async create(projectId: string, data: CreateWorkflowData): Promise<Orchestration>;
  async read(orchestrationId: string): Promise<Orchestration>;
  async update(orchestrationId: string, data: Partial<Orchestration>): Promise<Orchestration>;
  async delete(orchestrationId: string): Promise<void>;
  async list(projectId: string): Promise<Orchestration[]>;

  // Validaciones
  async validateOrchestration(orch: Orchestration): Promise<ValidationError[]>;
  private validateAgentSequence(agents: string[]): ValidationError[];
  private validateNodes(nodes: OrchestrateNode[]): ValidationError[];
  private validateDataFlow(node: OrchestrateNode): ValidationError[];
  private validateContextExtra(context: ContextExtra): ValidationError[];

  // Utilidades
  async getOrchestrationExecutions(orchestrationId: string): Promise<Execution[]>;
  async clearExecutionHistory(orchestrationId: string, olderThan?: Date): Promise<void>;
}

interface Orchestration {
  id: string;
  projectId: string;
  name: string;
  description: string;
  enabled: boolean;

  agents: string[];                  // Nombres de agentes en orden
  nodes: OrchestrateNode[];          // Conexiones configuradas

  executionConfig: {
    stopOnError: boolean;            // ¿Parar en primer error?
    validateAfterEachStep: boolean;  // Validar tests/lints después de cada paso
    maxTurns: number;                // Max turns por agente
    timeout: number;                 // Timeout en ms por paso
  };

  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  lastExecutionStatus?: 'success' | 'partial' | 'failed';
  executionCount: number;
}

interface CreateWorkflowData {
  name: string;
  description: string;
  agents: string[];
  nodes: CreateNodeData[];
  executionConfig?: Partial<ExecutionConfig>;
}

interface CreateNodeData {
  from: number;
  to: number;
  dataFlow: DataFlow;
  contextExtra: ContextExtra;
}
```

### 3.3 Cambios en server.js

Nuevas rutas REST para orquestaciones:

```typescript
// CRUD Orquestaciones
router.get('/api/orchestrations', async (req, res) => {
  const { projectId } = req.query;
  const orchs = await workflowManager.list(projectId);
  res.json(orchs);
});

router.post('/api/orchestrations', async (req, res) => {
  const { projectId, ...data } = req.body;
  const orch = await workflowManager.create(projectId, data);
  res.json(orch);
});

router.put('/api/orchestrations/:id', async (req, res) => {
  const orch = await workflowManager.update(req.params.id, req.body);
  res.json(orch);
});

router.delete('/api/orchestrations/:id', async (req, res) => {
  await workflowManager.delete(req.params.id);
  res.json({ ok: true });
});

// Validación
router.post('/api/orchestrations/:id/validate', async (req, res) => {
  const orch = await workflowManager.read(req.params.id);
  const errors = await workflowManager.validateOrchestration(orch);
  res.json({ valid: errors.length === 0, errors });
});

// Ejecución
router.post('/api/orchestrations/:id/execute', async (req, res) => {
  const orch = await workflowManager.read(req.params.id);
  const { temporalContexts } = req.body; // Contextos introducidos por usuario

  // Validar
  const validationErrors = await workflowManager.validateOrchestration(orch);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', errors: validationErrors });
  }

  // Crear ejecutor
  const executor = new OrchestrationExecutor(orch, req.body.projectId, temporalContexts);

  // Para evitar bloquear, respondemos inmediatamente
  res.json({ executionId: executor.executionId, status: 'started' });

  // Ejecutar en background (y emitir SSE si es necesario)
  executor.execute().then(result => {
    // Guardar resultado
    await saveExecution(orch.id, result);
  }).catch(err => {
    logger.error('Execution failed', err);
  });
});

// SSE para progreso en vivo
router.get('/api/orchestrations/:id/execute/stream', (req, res) => {
  const { executionId } = req.query;
  const executor = activeExecutors.get(executionId);

  if (!executor) {
    return res.status(404).json({ error: 'Execution not found' });
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const logListener = (log: ExecutionLog) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  executor.on('log', logListener);
  executor.on('step-done', (result: StepResult) => {
    res.write(`data: ${JSON.stringify({ type: 'step-done', data: result })}\n\n`);
  });
  executor.on('completed', (result: ExecutionResult) => {
    res.write(`data: ${JSON.stringify({ type: 'completed', data: result })}\n\n`);
    res.end();
  });
  executor.on('error', (err: Error) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    executor.off('log', logListener);
  });
});

// Historial de ejecuciones
router.get('/api/orchestrations/:id/executions', async (req, res) => {
  const executions = await workflowManager.getOrchestrationExecutions(req.params.id);
  res.json(executions);
});

router.get('/api/orchestrations/:id/executions/:executionId', async (req, res) => {
  const execution = await getExecution(req.params.executionId);
  res.json(execution);
});

// Rollback de ejecución
router.post('/api/orchestrations/:id/executions/:executionId/rollback', async (req, res) => {
  const { stepIndex } = req.body;
  // Restaurar archivos del backup del paso especificado
  const executor = new OrchestrationExecutor(...);
  await executor.rollbackStep(stepIndex);
  res.json({ ok: true });
});
```

---

## 4. Componentes frontend

### 4.1 Página principal (pages/Orchestrations.tsx)

```typescript
export function OrchestrationPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([]);
  const [view, setView] = useState<'list' | 'editor' | 'execution'>('list');
  const [selectedOrch, setSelectedOrch] = useState<Orchestration | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadOrchestrations();
  }, [project?.id]);

  const loadOrchestrations = async () => {
    const data = await req('GET', `/api/orchestrations?projectId=${project.id}`);
    setOrchestrations(data);
  };

  const handleCreate = async (data: CreateWorkflowData) => {
    const newOrch = await req('POST', '/api/orchestrations', {
      projectId: project.id,
      ...data,
    });
    setOrchestrations([...orchestrations, newOrch]);
    setSelectedOrch(newOrch);
    setView('editor');
  };

  const handleSave = async (data: Partial<Orchestration>) => {
    const updated = await req('PUT', `/api/orchestrations/${selectedOrch.id}`, data);
    setSelectedOrch(updated);
    setOrchestrations(orchestrations.map(o => o.id === updated.id ? updated : o));
  };

  const handleDelete = async (orchId: string) => {
    await req('DELETE', `/api/orchestrations/${orchId}`);
    setOrchestrations(orchestrations.filter(o => o.id !== orchId));
  };

  const handleExecute = async (temporalContexts: Record<string, unknown>) => {
    setView('execution');
    // Ver ExecutionPanel
  };

  return (
    <div className="orchestrations-page">
      <Topbar
        title="Orquestaciones"
        sub={project?.name}
        actions={
          view === 'list' && (
            <button className="btn primary" onClick={() => setIsCreating(true)}>
              + Nueva orquestación
            </button>
          )
        }
      />

      {view === 'list' && (
        <OrchestrationList
          orchestrations={orchestrations}
          onSelect={(orch) => {
            setSelectedOrch(orch);
            setView('editor');
          }}
          onDelete={handleDelete}
          onExecute={(orch) => {
            setSelectedOrch(orch);
            setView('execution');
          }}
        />
      )}

      {view === 'editor' && selectedOrch && (
        <OrchestrationEditor
          orchestration={selectedOrch}
          onSave={handleSave}
          onBack={() => setView('list')}
          onExecute={handleExecute}
        />
      )}

      {view === 'execution' && selectedOrch && (
        <ExecutionPanel
          orchestration={selectedOrch}
          onBack={() => setView('list')}
        />
      )}

      {isCreating && (
        <CreateOrchestrationModal
          projectId={project.id}
          onCreate={handleCreate}
          onCancel={() => setIsCreating(false)}
        />
      )}
    </div>
  );
}
```

### 4.2 Editor visual (components/orchestrations/OrchestrationEditor.tsx)

```typescript
export function OrchestrationEditor({
  orchestration,
  onSave,
  onExecute,
  onBack,
}: {
  orchestration: Orchestration;
  onSave: (data: Partial<Orchestration>) => Promise<void>;
  onExecute: (temporalContexts: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
}) {
  const [agents, setAgents] = useState<string[]>(orchestration.agents);
  const [nodes, setNodes] = useState<OrchestrateNode[]>(orchestration.nodes);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddAgent = async (agentName: string) => {
    setAgents([...agents, agentName]);
    // Crear nodos de conexión si hay más de 1 agente
    if (agents.length > 0) {
      const newNode: OrchestrateNode = {
        id: generateId(),
        from: agents.length - 1,
        to: agents.length,
        dataFlow: {
          agentOutput: true,
          filesModified: true,
          claudeMd: true,
          selectiveFiles: [],
        },
        contextExtra: {
          fixed: null,
          temporal: [],
        },
      };
      setNodes([...nodes, newNode]);
    }
  };

  const handleRemoveAgent = (index: number) => {
    const newAgents = agents.filter((_, i) => i !== index);
    // Remover nodos asociados
    const newNodes = nodes.filter(
      n => !(n.from === index || n.to === index)
    );
    setAgents(newAgents);
    setNodes(newNodes);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        agents,
        nodes,
      });
      addToast('Orquestación guardada', 'ok');
    } catch (err) {
      addToast(`Error al guardar: ${err.message}`, 'err');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="orch-editor">
      <div className="orch-editor-header">
        <h2>{orchestration.name}</h2>
        <div className="orch-editor-actions">
          <button onClick={() => handleValidate()} className="btn ghost">
            Validar
          </button>
          <button onClick={handleSave} disabled={isSaving} className="btn primary">
            Guardar
          </button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="error-banner">
          {validationErrors.map(err => (
            <div key={err}>{err}</div>
          ))}
        </div>
      )}

      <div className="orch-editor-content">
        {/* Lado izquierdo: Lista de agentes */}
        <div className="orch-agents-list">
          <h3>Secuencia de agentes</h3>
          {agents.map((agentName, i) => (
            <div key={i} className="orch-agent-row">
              <span className="orch-agent-index">{i + 1}</span>
              <span className="orch-agent-name">{agentName}</span>
              {i > 0 && (
                <button
                  className="btn ghost sm"
                  onClick={() => handleRemoveAgent(i)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="btn sm" onClick={() => showAgentSelector()}>
            + Agregar agente
          </button>
        </div>

        {/* Centro: Canvas visual */}
        <div className="orch-canvas">
          <NodeCanvas agents={agents} nodes={nodes} />
        </div>

        {/* Lado derecho: Configuración de nodos */}
        <div className="orch-config-panel">
          {selectedNodeIndex !== null && (
            <ConnectionConfigurator
              node={nodes[selectedNodeIndex]}
              fromAgent={agents[nodes[selectedNodeIndex].from]}
              toAgent={agents[nodes[selectedNodeIndex].to]}
              onUpdate={(updated) => {
                const newNodes = [...nodes];
                newNodes[selectedNodeIndex] = updated;
                setNodes(newNodes);
              }}
            />
          )}
        </div>
      </div>

      <div className="orch-editor-footer">
        <button className="btn ghost" onClick={onBack}>
          Atrás
        </button>
        <button
          className="btn primary"
          onClick={() => showExecutionModal()}
          disabled={validationErrors.length > 0}
        >
          Ejecutar
        </button>
      </div>
    </div>
  );
}
```

### 4.3 Canvas visual (NodeCanvas.tsx)

```typescript
export function NodeCanvas({
  agents,
  nodes,
  onSelectNode,
}: {
  agents: string[];
  nodes: OrchestrateNode[];
  onSelectNode?: (nodeIndex: number) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={canvasRef} className="orch-node-canvas">
      {/* Renderizar agentes verticalmente */}
      {agents.map((agentName, i) => (
        <div
          key={i}
          className="orch-node-agent"
          style={{
            top: `${i * 120}px`,
            left: '40px',
          }}
        >
          <div className="agent-box">
            <div className="agent-name">{agentName}</div>
            <div className="agent-icon">
              <i className={`ti ${getAgentIcon(agentName)}`} />
            </div>
          </div>
        </div>
      ))}

      {/* SVG para conexiones */}
      <svg className="orch-connections" width="100%" height="100%">
        {nodes.map((node, i) => {
          const y1 = node.from * 120 + 60;
          const y2 = node.to * 120 + 60;
          const x1 = 140;
          const x2 = 140;

          return (
            <g key={node.id}>
              <path
                d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2} ${x2} ${y2}`}
                className="connection-path"
                onClick={() => onSelectNode?.(i)}
                data-node-id={node.id}
              />
              {/* Indicador visual de configuración */}
              <circle
                cx={(x1 + x2) / 2}
                cy={(y1 + y2) / 2}
                r="8"
                className={`connection-indicator ${
                  node.dataFlow.agentOutput ? 'has-output' : ''
                } ${node.contextExtra.fixed || node.contextExtra.temporal.length > 0 ? 'has-context' : ''}`}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

### 4.4 Configurador de conexiones (ConnectionConfigurator.tsx)

```typescript
export function ConnectionConfigurator({
  node,
  fromAgent,
  toAgent,
  onUpdate,
}: {
  node: OrchestrateNode;
  fromAgent: string;
  toAgent: string;
  onUpdate: (node: OrchestrateNode) => void;
}) {
  const [dataFlow, setDataFlow] = useState(node.dataFlow);
  const [contextExtra, setContextExtra] = useState(node.contextExtra);

  return (
    <div className="orch-connection-config">
      <h3>
        Configurar conexión: {fromAgent} → {toAgent}
      </h3>

      {/* Data flow */}
      <section className="config-section">
        <h4>Información que pasa</h4>
        <label>
          <input
            type="checkbox"
            checked={dataFlow.agentOutput}
            onChange={(e) =>
              setDataFlow({ ...dataFlow, agentOutput: e.target.checked })
            }
          />
          Respuesta del agente anterior
        </label>
        <label>
          <input
            type="checkbox"
            checked={dataFlow.filesModified}
            onChange={(e) =>
              setDataFlow({ ...dataFlow, filesModified: e.target.checked })
            }
          />
          Archivos modificados
        </label>
        <label>
          <input
            type="checkbox"
            checked={dataFlow.claudeMd}
            onChange={(e) =>
              setDataFlow({ ...dataFlow, claudeMd: e.target.checked })
            }
          />
          CLAUDE.md (contexto del proyecto)
        </label>

        {dataFlow.filesModified && (
          <div className="subsection">
            <label>Archivos específicos (opcional, deja vacío para todos):</label>
            <textarea
              placeholder="src/main.ts&#10;src/utils.ts"
              value={dataFlow.selectiveFiles.join('\n')}
              onChange={(e) =>
                setDataFlow({
                  ...dataFlow,
                  selectiveFiles: e.target.value
                    .split('\n')
                    .filter(Boolean),
                })
              }
            />
          </div>
        )}
      </section>

      {/* Contexto extra */}
      <section className="config-section">
        <h4>Contexto extra</h4>

        {/* Contexto fijo */}
        <div className="context-type">
          <h5>Fijo</h5>
          {contextExtra.fixed ? (
            <div className="context-fixed-item">
              <div className="context-label">
                📄 {contextExtra.fixed.label || contextExtra.fixed.value}
              </div>
              <small>{contextExtra.fixed.value}</small>
              <button
                className="btn sm ghost"
                onClick={() =>
                  setContextExtra({ ...contextExtra, fixed: null })
                }
              >
                Cambiar
              </button>
            </div>
          ) : (
            <button
              className="btn sm"
              onClick={() => showFileSelector()}
            >
              + Seleccionar archivo
            </button>
          )}
        </div>

        {/* Contexto temporal */}
        <div className="context-type">
          <h5>Temporal (se pide al ejecutar)</h5>
          {contextExtra.temporal.map((temp) => (
            <div key={temp.id} className="context-temporal-item">
              <div>
                <div className="context-label">
                  {temp.type === 'file' ? '📎' : '📝'} {temp.label}
                </div>
                {temp.type === 'text' && temp.placeholder && (
                  <small>{temp.placeholder}</small>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={temp.required}
                    onChange={(e) => {
                      const updated = [...contextExtra.temporal];
                      updated.find(t => t.id === temp.id).required =
                        e.target.checked;
                      setContextExtra({
                        ...contextExtra,
                        temporal: updated,
                      });
                    }}
                  />
                  Requerido
                </label>
              </div>
              <button
                className="btn sm ghost"
                onClick={() => {
                  const updated = contextExtra.temporal.filter(
                    t => t.id !== temp.id
                  );
                  setContextExtra({ ...contextExtra, temporal: updated });
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn sm"
            onClick={() => showAddTemporalContext()}
          >
            + Agregar contexto temporal
          </button>
        </div>
      </section>

      <button
        className="btn primary"
        onClick={() => onUpdate({ ...node, dataFlow, contextExtra })}
      >
        Guardar configuración
      </button>
    </div>
  );
}
```

### 4.5 Panel de ejecución (ExecutionPanel.tsx)

```typescript
export function ExecutionPanel({
  orchestration,
  onBack,
}: {
  orchestration: Orchestration;
  onBack: () => void;
}) {
  const [temporalContexts, setTemporalContexts] = useState<
    Record<string, unknown>
  >({});
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);

  // 1. Recolectar contextos temporales requeridos
  const temporalContextsNeeded = orchestration.nodes
    .flatMap((node, i) =>
      node.contextExtra.temporal.map(temp => ({
        nodeIndex: i,
        tempId: temp.id,
        ...temp,
      }))
    );

  const handleStartExecution = async () => {
    // Validar contextos requeridos
    const missingRequired = temporalContextsNeeded.filter(
      t => t.required && !temporalContexts[`${t.nodeIndex}-${t.tempId}`]
    );

    if (missingRequired.length > 0) {
      addToast(
        `Faltan campos requeridos: ${missingRequired.map(m => m.label).join(', ')}`,
        'err'
      );
      return;
    }

    setIsRunning(true);

    try {
      // Iniciar ejecución
      const response = await req('POST', `/api/orchestrations/${orchestration.id}/execute`, {
        projectId: orchestration.projectId,
        temporalContexts,
      });

      setExecutionId(response.executionId);

      // Conectar a SSE
      const eventSource = new EventSource(
        `/api/orchestrations/${orchestration.id}/execute/stream?executionId=${response.executionId}`
      );

      eventSource.addEventListener('message', (event) => {
        const log = JSON.parse(event.data);
        setLogs(prev => [...prev, log]);
      });

      eventSource.addEventListener('step-done', (event) => {
        const stepResult = JSON.parse(event.data).data;
        // Actualizar UI con resultado del paso
      });

      eventSource.addEventListener('completed', (event) => {
        const execResult = JSON.parse(event.data).data;
        setResult(execResult);
        setIsRunning(false);
        eventSource.close();
      });

      eventSource.addEventListener('error', () => {
        addToast('Error durante la ejecución', 'err');
        setIsRunning(false);
        eventSource.close();
      });
    } catch (err) {
      addToast(`Error: ${err.message}`, 'err');
      setIsRunning(false);
    }
  };

  return (
    <div className="orch-execution-panel">
      {!isRunning && !result && (
        <div className="execution-form">
          <h3>Ejecutar: {orchestration.name}</h3>

          {temporalContextsNeeded.length > 0 && (
            <section className="temporal-contexts">
              <h4>Contexto adicional</h4>
              {temporalContextsNeeded.map((temp) => (
                <div key={`${temp.nodeIndex}-${temp.tempId}`} className="context-input">
                  <label>
                    {temp.label}
                    {temp.required && <span className="required">*</span>}
                  </label>
                  {temp.type === 'file' ? (
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setTemporalContexts(prev => ({
                          ...prev,
                          [`${temp.nodeIndex}-${temp.tempId}`]: file,
                        }));
                      }}
                    />
                  ) : (
                    <textarea
                      placeholder={temp.placeholder}
                      onChange={(e) => {
                        setTemporalContexts(prev => ({
                          ...prev,
                          [`${temp.nodeIndex}-${temp.tempId}`]: e.target.value,
                        }));
                      }}
                    />
                  )}
                </div>
              ))}
            </section>
          )}

          <button
            className="btn primary"
            onClick={handleStartExecution}
            disabled={isRunning}
          >
            Comenzar ejecución
          </button>
        </div>
      )}

      {isRunning && (
        <div className="execution-running">
          <div className="execution-spinner">
            <i className="ti ti-loader-2" />
          </div>
          <h3>Ejecutando orquestación...</h3>
          <div className="execution-logs">
            {logs.map((log, i) => (
              <div key={i} className={`log-line log-${log.level}`}>
                <span className="log-time">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="execution-result">
          <div
            className={`result-header result-${result.status}`}
          >
            <div className="result-status">
              {result.status === 'success' && <i className="ti ti-check" />}
              {result.status === 'partial' && <i className="ti ti-alert-triangle" />}
              {result.status === 'failed' && <i className="ti ti-x" />}
              <span>
                {result.status === 'success' && 'Ejecución completada'}
                {result.status === 'partial' && 'Ejecución parcial'}
                {result.status === 'failed' && 'Ejecución falló'}
              </span>
            </div>

            <div className="result-summary">
              <div className="stat">
                <span className="label">Pasos completados:</span>
                <span className="value">
                  {result.stepsCompleted} / {result.totalSteps}
                </span>
              </div>
              <div className="stat">
                <span className="label">Duración:</span>
                <span className="value">{(result.duration / 1000).toFixed(1)}s</span>
              </div>
              <div className="stat">
                <span className="label">Tokens:</span>
                <span className="value">
                  {result.totalTokensUsed.input} in / {result.totalTokensUsed.output} out
                </span>
              </div>
              <div className="stat">
                <span className="label">Coste estimado:</span>
                <span className="value">${result.estimatedCost.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Cambios realizados */}
          <section className="result-section">
            <h4>Cambios realizados</h4>
            <div className="changes-summary">
              <div className="change-item">
                <span>📝 Archivos creados: {result.summary.filesCreated}</span>
              </div>
              <div className="change-item">
                <span>✏️ Archivos modificados: {result.summary.filesModified}</span>
              </div>
              <div className="change-item">
                <span>🗑️ Archivos eliminados: {result.summary.filesDeleted}</span>
              </div>
              <div className="change-item">
                <span>➕ Líneas agregadas: {result.summary.linesAdded}</span>
              </div>
              <div className="change-item">
                <span>➖ Líneas eliminadas: {result.summary.linesRemoved}</span>
              </div>
            </div>
          </section>

          {/* Resultados por paso */}
          <section className="result-section">
            <h4>Resultados por paso</h4>
            {result.results.map((stepResult, i) => (
              <div
                key={i}
                className={`step-result step-${stepResult.status}`}
              >
                <div className="step-header">
                  <span className="step-number">{i + 1}</span>
                  <span className="step-agent">{stepResult.agentName}</span>
                  <span className="step-status">
                    {stepResult.status === 'success' && '✓'}
                    {stepResult.status === 'error' && '✗'}
                    {stepResult.status === 'warning' && '⚠'}
                  </span>
                </div>
                <div className="step-details">
                  <details>
                    <summary>
                      {stepResult.filesModified.length} archivos modificados
                    </summary>
                    {stepResult.filesModified.map(file => (
                      <div key={file} className="file-item">
                        📄 {file}
                      </div>
                    ))}
                  </details>
                  <details>
                    <summary>Respuesta ({stepResult.output.response.length} caracteres)</summary>
                    <div className="step-output">
                      {stepResult.output.response}
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </section>

          {/* Errores */}
          {result.errors && result.errors.length > 0 && (
            <section className="result-section result-errors">
              <h4>Errores</h4>
              {result.errors.map((err, i) => (
                <div key={i} className="error-item">
                  <div className="error-message">{err.message}</div>
                  <div className="error-category">{err.category}</div>
                  {err.recoverable && (
                    <button
                      className="btn sm"
                      onClick={() => handleRollback(i)}
                    >
                      Deshacer este paso
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Acciones finales */}
          <div className="execution-actions">
            <button className="btn ghost" onClick={onBack}>
              Volver
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setResult(null);
                setLogs([]);
              }}
            >
              Ejecutar nuevamente
            </button>
            {result.status !== 'failed' && (
              <button
                className="btn"
                onClick={() => {
                  // Discutir en chat
                  navigateTo('chat');
                }}
              >
                Discutir en chat
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function handleRollback(stepIndex: number) {
  // POST /api/orchestrations/:id/executions/:executionId/rollback
  const result = await req('POST', `.../rollback`, {
    stepIndex,
  });
  addToast('Paso deshecho', 'ok');
}
```

---

## 5. Interfaces TypeScript

```typescript
// Orquestación
interface Orchestration {
  id: string;
  projectId: string;
  name: string;
  description: string;
  enabled: boolean;
  agents: string[];                         // Nombres en orden
  nodes: OrchestrateNode[];                // Conexiones
  executionConfig: ExecutionConfig;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  lastExecutionStatus?: 'success' | 'partial' | 'failed';
  executionCount: number;
}

// Nodo (conexión entre agentes)
interface OrchestrateNode {
  id: string;
  from: number;                            // Índice agente anterior
  to: number;                              // Índice agente siguiente
  dataFlow: DataFlow;                      // Qué información pasa
  contextExtra: ContextExtra;              // Contexto adicional
}

// Flujo de datos
interface DataFlow {
  agentOutput: boolean;                    // Pasar respuesta anterior
  filesModified: boolean;                  // Pasar archivos modificados
  claudeMd: boolean;                       // Incluir CLAUDE.md
  selectiveFiles: string[];                // Archivos específicos (opcional)
}

// Contexto extra
interface ContextExtra {
  fixed: FixedContext | null;              // Contexto fijo
  temporal: TemporalContext[];             // Contextos que se piden al ejecutar
}

interface FixedContext {
  type: 'file';
  value: string;                           // Ruta relativa al proyecto
  label: string;                           // Etiqueta para UI
}

interface TemporalContext {
  id: string;
  type: 'file' | 'text';
  label: string;
  placeholder?: string;
  required: boolean;
}

// Configuración de ejecución
interface ExecutionConfig {
  stopOnError: boolean;
  validateAfterEachStep: boolean;
  maxTurns: number;
  timeout: number;
}

// Resultado de un paso
interface StepResult {
  stepIndex: number;
  agentName: string;
  input: {
    systemPrompt: string;
    userMessage: string;
  };
  output: {
    response: string;
    toolCalls?: ToolCall[];
    toolResults?: unknown[];
  };
  filesModified: string[];
  tokensUsed: { input: number; output: number };
  duration: number;
  status: 'success' | 'error' | 'warning';
  error?: {
    message: string;
    category: string;
    recoverable: boolean;
  };
  backupPath: string;
}

// Resultado de ejecución completa
interface ExecutionResult {
  orchestrationId: string;
  projectId: string;
  executionId: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  status: 'success' | 'partial' | 'failed';
  stepsCompleted: number;
  totalSteps: number;
  totalTokensUsed: { input: number; output: number };
  estimatedCost: number;
  results: StepResult[];
  errors: ErrorReport[];
  summary: {
    filesModified: number;
    filesCreated: number;
    filesDeleted: number;
    linesAdded: number;
    linesRemoved: number;
  };
  changes: FileChange[];
  backups: Record<string, string>;
}

// Log de ejecución
interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}

// Errores
interface ErrorReport {
  message: string;
  category: string;
  recoverable: boolean;
  stepIndex?: number;
}

// Cambios en archivos
interface FileChange {
  path: string;
  status: 'created' | 'modified' | 'deleted';
  linesBefore?: number;
  linesAfter?: number;
  linesAdded?: number;
  linesRemoved?: number;
  diff?: string;
}
```

---

## 6. APIs REST

**Nota importante:** Todas las APIs de orquestaciones trabajan **a nivel de proyecto**. Una orquestación siempre pertenece a un proyecto específico. Esto se refleja en los IDs: `orchestrationId` es único globalmente, pero siempre tiene un `projectId` asociado.

### 6.1 CRUD de Orquestaciones

```
GET /api/orchestrations?projectId=proj-001
  Response: Orchestration[]
  (Devuelve todas las orquestaciones de un proyecto)

POST /api/orchestrations
  Body: { projectId, name, description, agents, nodes, executionConfig }
  Response: Orchestration
  (Crea orquestación en {projectPath}/.agent-hub/orchestrations/)

GET /api/orchestrations/:id
  Response: Orchestration

PUT /api/orchestrations/:id
  Body: Partial<Orchestration>
  Response: Orchestration

DELETE /api/orchestrations/:id
  Response: { ok: boolean }
  (Elimina archivo JSON del proyecto)
```

### 6.2 Validación

```
POST /api/orchestrations/:id/validate
  Response: { valid: boolean; errors: ValidationError[] }
```

### 6.3 Ejecución

```
POST /api/orchestrations/:id/execute
  Body: {
    projectId: string;
    temporalContexts: Record<string, unknown>;
  }
  Response: { executionId: string; status: string }
  (Crea ejecución en {projectPath}/.agent-hub/executions/)

GET /api/orchestrations/:id/execute/stream?executionId=...
  (Server-Sent Events)
  Events:
    - data: ExecutionLog
    - step-done: StepResult
    - completed: ExecutionResult
    - error: { message: string }

GET /api/orchestrations/:id/executions?projectId=proj-001
  Response: Execution[]
  (Lee desde {projectPath}/.agent-hub/executions/)

GET /api/orchestrations/:id/executions/:executionId
  Response: ExecutionResult

POST /api/orchestrations/:id/executions/:executionId/rollback
  Body: { stepIndex: number }
  Response: { ok: boolean; message: string }
  (Restaura archivos del backup del proyecto)
```

---

## 7. Flujos end-to-end

### 7.1 Crear orquestación

```
Usuario en UI
  ↓
Hace clic en "+ Nueva orquestación"
  ↓
Modal de creación:
  - Nombre, descripción
  - Selecciona agentes secuencialmente
  - Sistema sugiere crear nodos de conexión automáticamente
  ↓
POST /api/orchestrations
  ├─ Validar agents existen
  ├─ Validar nodes bien formados
  └─ Guardar en .agent-hub/orchestrations/orch-{id}.json
  ↓
UI: Abre editor visual
```

### 7.2 Editar orquestación

```
Usuario selecciona orquestación
  ↓
Abre editor visual:
  - Canvas con agentes y conexiones
  - Click en conexión → panel de configuración (dataFlow + contextExtra)
  - Editar nodos
  ↓
Click "Guardar"
  ↓
PUT /api/orchestrations/:id
  ├─ Validar cambios
  ├─ Actualizar JSON
  └─ Responder con orquestación actualizada
  ↓
UI: Toast de éxito
```

### 7.3 Ejecutar orquestación

```
Usuario hace clic "Ejecutar"
  ↓
Sistema detecta contextos temporales requeridos
  ↓
Muestra formulario:
  - Campos para contextos temporales (file/text)
  - Validación de requeridos
  ↓
Usuario llena contextos y hace clic "Comenzar"
  ↓
POST /api/orchestrations/:id/execute
  ├─ Validar orquestación (precondiciones)
  ├─ Crear execution metadata
  ├─ Iniciar OrchestrationExecutor
  └─ Responder con executionId inmediatamente
  ↓
Backend (async):
  Para i = 0 hasta agents.length:
    1. Backup del estado
    2. Construir systemPrompt (agent.system + contexto fijo + CLAUDE.md)
    3. Construir userMessage (output anterior + contexto temporal + tarea)
    4. Invocar agent vía AI
    5. Ejecutar tool calls si existen (vía Subsistema CLI)
    6. Capturar cambios en FS
    7. Emit SSE: { type: 'log', ... }
    8. Si error:
       - Si stopOnError: rollback y abort
       - Sino: continuar
  ↓
  Generar ExecutionResult
  Emit SSE: { type: 'completed', data: result }
  ↓
Frontend (SSE):
  - Recibe logs en tiempo real
  - Muestra spinner + logs
  - Cuando completed:
    - Renderiza resultados
    - Muestra cambios por paso
    - Permite rollback granular
```

### 7.4 Rollback granular

```
Usuario ve paso que falló o quiere deshacer
  ↓
Hace clic "Deshacer este paso"
  ↓
POST /api/orchestrations/:id/executions/:executionId/rollback
  Body: { stepIndex: 2 }
  ↓
Backend:
  - Leer backup del paso 2 (.agent-hub/executions/.../backups/)
  - Restaurar archivos
  - Actualizar execution metadata (marcar paso como 'rolled back')
  ↓
Frontend:
  - Toast de éxito
  - Actualizar UI (paso ahora muestra "Desecho")
```

---

## 8. Almacenamiento y persistencia

### 8.1 Estructura de archivos (en cada proyecto)

**Importante:** Las orquestaciones se almacenan **en el proyecto**, no en la aplicación. Si necesitas la misma orquestación en múltiples proyectos, cópiala.

```
{projectPath}/.agent-hub/
│
├── agent-orchestrator.js              ← Ejecutor local (ya existe)
│
├── orchestrations/                    ← NUEVO: Orquestaciones de este proyecto
│   ├── orch-refactor-test.json
│   │   {
│   │     "id": "orch-refactor-test",
│   │     "projectId": "proj-abc",     ← Referencia al proyecto
│   │     "name": "Refactor & Test",
│   │     "agents": ["code-reviewer", "refactor-expert", "test-generator"],
│   │     "nodes": [...]
│   │   }
│   ├── orch-docs-auto.json
│   └── ...
│
├── executions/                        ← NUEVO: Historial de ejecuciones
│   ├── 2026-05-28T10-30-45-123-exec-001/
│   │   ├── metadata.json
│   │   │   {
│   │   │     "executionId": "exec-001",
│   │   │     "orchestrationId": "orch-refactor-test",
│   │   │     "projectId": "proj-abc",
│   │   │     "startedAt": "2026-05-28T10:30:45.123Z",
│   │   │     "completedAt": "2026-05-28T10:45:30.456Z",
│   │   │     "status": "success",
│   │   │     "stepsCompleted": 3,
│   │   │     "totalSteps": 3
│   │   │   }
│   │   ├── logs.jsonl
│   │   │   {"timestamp":"...","level":"info","message":"Paso 1: code-reviewer iniciado"}
│   │   │   {"timestamp":"...","level":"info","message":"Paso 1: code-reviewer completado"}
│   │   │   ...
│   │   ├── agent_outputs.json
│   │   │   {
│   │   │     "0": {
│   │   │       "response": "He encontrado los siguientes problemas...",
│   │   │       "toolCalls": [...]
│   │   │     },
│   │   │     "1": { ... },
│   │   │     "2": { ... }
│   │   │   }
│   │   ├── changes.json
│   │   │   {
│   │   │     "filesModified": 5,
│   │   │     "filesCreated": 2,
│   │   │     "changes": [
│   │   │       {
│   │   │         "path": "src/main.ts",
│   │   │         "status": "modified",
│   │   │         "linesAdded": 10,
│   │   │         "linesRemoved": 5
│   │   │       },
│   │   │       ...
│   │   │     ]
│   │   │   }
│   │   └── backups/
│   │       ├── step-0.tar.gz        (snapshot después del paso 0)
│   │       ├── step-1.tar.gz
│   │       └── step-2.tar.gz
│   │
│   ├── 2026-05-28T14-00-00-789-exec-002/
│   │   ├── metadata.json
│   │   ├── logs.jsonl
│   │   ├── agent_outputs.json
│   │   ├── changes.json
│   │   └── backups/
│   │
│   └── ...
│
├── workflows/                         ← Ya existe
└── skills/                            ← Ya existe
```

### Filosofía

- **Una orquestación = vive en su proyecto**
- **Portabilidad:** Mueves el proyecto → la orquestación se mueve contigo
- **Duplicación (no sincronización):** Si necesitas la misma en otro proyecto, cópiala
- **Versionable:** Puedes commitear orquestaciones con git si lo deseas
- **Escalable:** Ejecutable localmente vía `agent-orchestrator.js`

### 8.2 Limpieza de ejecuciones antiguas

```typescript
// Politica de retención
Mantener últimas 50 ejecuciones por orquestación
Borrar ejecuciones más antiguas de 30 días
Permitir al usuario limpiar manualmente
```

---

## 9. Seguridad y validaciones

### 9.1 Validaciones de entrada

```typescript
validateOrchestration(orch: Orchestration): ValidationError[] {
  const errors = [];

  // Validar agentes
  if (!orch.agents || orch.agents.length < 2) {
    errors.push("Una orquestación debe tener al menos 2 agentes");
  }

  for (const agentName of orch.agents) {
    const agent = this.getAgent(agentName);
    if (!agent) {
      errors.push(`Agente '${agentName}' no existe`);
    }
  }

  // Validar nodos
  if (orch.nodes.length !== orch.agents.length - 1) {
    errors.push(
      `Debe haber exactamente ${orch.agents.length - 1} nodos para ` +
      `${orch.agents.length} agentes`
    );
  }

  for (let i = 0; i < orch.nodes.length; i++) {
    const node = orch.nodes[i];
    if (node.from !== i || node.to !== i + 1) {
      errors.push(`Nodo ${i} tiene índices inválidos`);
    }

    // Validar dataFlow
    if (
      !node.dataFlow.agentOutput &&
      !node.dataFlow.filesModified &&
      !node.dataFlow.claudeMd
    ) {
      errors.push(
        `Nodo ${i} no transmite ninguna información ` +
        `(al menos uno de: agentOutput, filesModified, claudeMd debe ser true)`
      );
    }

    // Validar contextExtra
    if (node.contextExtra.fixed) {
      const { value } = node.contextExtra.fixed;
      // Verificar que el archivo existe (path relativo al proyecto)
      if (!fs.existsSync(path.join(this.projectPath, value))) {
        errors.push(
          `Archivo de contexto fijo '${value}' no existe en el proyecto`
        );
      }
    }

    for (const temp of node.contextExtra.temporal) {
      if (!temp.label || temp.label.length === 0) {
        errors.push(`Contexto temporal en nodo ${i} sin etiqueta`);
      }
      if (temp.type === 'text' && temp.placeholder && temp.placeholder.length > 500) {
        errors.push(`Placeholder demasiado largo en nodo ${i}`);
      }
    }
  }

  // Validar ejecutionConfig
  if (orch.executionConfig.timeout < 5000) {
    errors.push("Timeout mínimo es 5 segundos");
  }
  if (orch.executionConfig.maxTurns < 1 || orch.executionConfig.maxTurns > 100) {
    errors.push("maxTurns debe estar entre 1 y 100");
  }

  return errors;
}
```

### 9.2 Protecciones contra path traversal

```typescript
// Al recolectar archivos temporales
if (userUploadedPath.includes('..') || userUploadedPath.startsWith('/')) {
  throw new Error('Path inválido: no se permite path traversal');
}

// Asegurar que los archivos se guardan dentro de .agent-hub/
const safePath = path.join(projectPath, '.agent-hub', ...userPath);
if (!safePath.startsWith(projectPath)) {
  throw new Error('Path inválido');
}
```

### 9.3 Límites de recursos

```
Máximo 50 agentes por orquestación
Máximo 100 contextos temporales por orquestación
Máximo 10MB de contexto temporal por paso
Máximo 5 minutos de ejecución por paso
Máximo 1GB de backups por orquestación
```

---

---

## 10.1 Detalles técnicos de integración

### Tool Calls: Captura y ejecución

**Flujo exacto:**

```typescript
// 1. Agente (vía AI provider) devuelve respuesta con tool calls
const agentResponse = await callAgent({
  agentName: 'code-reviewer',
  systemPrompt: '...',
  userMessage: '...'
});

// agentResponse.toolCalls = [
//   { type: 'read', path: 'src/main.ts' },
//   { type: 'write', path: 'src/main.ts', content: '...' }
// ]

// 2. Subsistema CLI ejecuta tool calls
const toolResults = await subsystemCLI.executeOperations(
  agentResponse.toolCalls,
  projectPath  // ruta absoluta del proyecto
);

// toolResults = {
//   operations: [
//     {
//       operation: 'read',
//       path: 'src/main.ts',
//       status: 'success',
//       output: 'contenido del archivo',
//       duration: 45
//     },
//     {
//       operation: 'write',
//       path: 'src/main.ts',
//       status: 'success',
//       linesAdded: 10,
//       linesRemoved: 5,
//       duration: 32
//     }
//   ],
//   totalDuration: 77,
//   filesModified: ['src/main.ts']
// }

// 3. Guardar en resultado del paso
stepResult.output.toolCalls = agentResponse.toolCalls;
stepResult.output.toolResults = toolResults;
stepResult.filesModified = toolResults.filesModified;

// 4. Pasar filesModified al siguiente agente
const nextUserMessage = buildStepUserMessage(stepIndex + 1);
// → "Archivos modificados en paso anterior: src/main.ts"
```

**Validaciones en tool calls:**

```typescript
async validateToolCalls(toolCalls: ToolCall[], projectPath: string) {
  const errors = [];
  
  for (const tc of toolCalls) {
    // 1. Validar path (no path traversal)
    if (!isPathSafe(tc.path, projectPath)) {
      errors.push(`Path inválido: ${tc.path}`);
      continue;
    }

    // 2. Para write: validar que no es archivo system
    if (tc.type === 'write') {
      const forbiddenPaths = ['.git', '.env', 'node_modules', '.agent-hub'];
      if (forbiddenPaths.some(f => tc.path.startsWith(f))) {
        errors.push(`No se puede escribir en ${tc.path}`);
      }
    }

    // 3. Para read: validar que archivo existe o es valid path
    if (tc.type === 'read') {
      const fullPath = path.join(projectPath, tc.path);
      // No error si no existe (file puede no existir aún)
    }
  }

  return errors;
}

function isPathSafe(filePath: string, projectPath: string): boolean {
  // No permitir '../'
  if (filePath.includes('..')) return false;
  
  // No permitir paths absolutos
  if (path.isAbsolute(filePath)) return false;
  
  // Resolver path completo y verificar que está dentro del proyecto
  const fullPath = path.resolve(path.join(projectPath, filePath));
  const projectRoot = path.resolve(projectPath);
  
  return fullPath.startsWith(projectRoot);
}
```

### Inyección de contexto temporal

**Algoritmo exacto de construcción de userMessage con contextos temporales:**

```typescript
private buildStepUserMessage(stepIndex: number): string {
  let message = '';

  // 1. Si no es el primer paso, agregar contexto del anterior
  if (stepIndex > 0) {
    const prevResult = this.results.get(stepIndex - 1);
    const prevNode = this.nodes[stepIndex - 1];

    // 1a. Respuesta anterior
    if (prevNode.dataFlow.agentOutput && prevResult.output.response) {
      message += `## Análisis anterior\n\n${prevResult.output.response}\n\n`;
    }

    // 1b. Archivos modificados
    if (prevNode.dataFlow.filesModified && prevResult.filesModified.length > 0) {
      message += `## Archivos analizados/modificados en paso anterior\n`;
      message += prevResult.filesModified
        .map(f => `- ${f}`)
        .join('\n');
      message += '\n\n';
    }
  }

  // 2. Contextos temporales de ESTE paso (introducidos por usuario en ejecución)
  const currentNode = stepIndex > 0 ? this.nodes[stepIndex - 1] : null;
  
  if (currentNode && currentNode.contextExtra.temporal.length > 0) {
    for (const tempContext of currentNode.contextExtra.temporal) {
      const tempKey = `${stepIndex - 1}-${tempContext.id}`;
      const tempValue = this.temporalContextValues[tempKey];

      if (tempValue) {
        message += `## ${tempContext.label}\n\n`;
        if (tempContext.type === 'file') {
          // tempValue = contenido del archivo subido
          message += tempValue;
        } else {
          // tempValue = texto ingresado por usuario
          message += tempValue;
        }
        message += '\n\n';
      }
    }
  }

  // 3. Tarea predefinida para este agente
  const task = deriveAgentTask(this.agentNames[stepIndex]);
  message += `## Tarea\n\n${task}`;

  return message;
}

// Nota: maxLength de message debería ser ~4000 tokens (12k caracteres)
// Si se excede, truncar contexto anterior
private ensureMessageSize(message: string, maxChars: number = 12000): string {
  if (message.length <= maxChars) return message;
  
  // Truncar contexto de pasos anteriores, mantener contexto temporal
  const parts = message.split('\n## ');
  let result = parts[0]; // Mantener la primera parte
  
  for (let i = 1; i < parts.length; i++) {
    const part = `\n## ${parts[i]}`;
    if (result.length + part.length <= maxChars) {
      result += part;
    } else if (parts[i].includes('Tarea')) {
      // Siempre incluir la tarea, aunque exceda
      result += part;
      break;
    }
  }
  
  return result;
}
```

### Backups: Formato y tamaño

**Decisión de diseño: Directorio comprimido (tar.gz)**

```typescript
async backupStep(stepIndex: number): Promise<BackupInfo> {
  const backupName = `step-${stepIndex}.tar.gz`;
  const backupPath = path.join(
    this.projectPath,
    '.agent-hub/executions',
    this.executionId,
    'backups',
    backupName
  );

  // 1. Crear lista de archivos a respaldar
  // Excluir: .git, node_modules, .next, dist, build, .agent-hub
  const filesToBackup = await this.getFilesToBackup();

  // 2. Comprimir a tar.gz
  const tarCommand = `tar czf "${backupPath}" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='.agent-hub' \
    --exclude='.env' \
    ${filesToBackup.map(f => `"${f}"`).join(' ')}`;

  await exec(tarCommand);

  // 3. Obtener tamaño
  const stats = fs.statSync(backupPath);
  const sizeBytes = stats.size;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);

  // 4. Validar tamaño (máximo 500MB por backup)
  if (sizeBytes > 500 * 1024 * 1024) {
    fs.unlinkSync(backupPath);
    throw new Error(
      `Backup demasiado grande (${sizeMB}MB, máximo 500MB). ` +
      `Excluye node_modules o archivos grandes.`
    );
  }

  return {
    stepIndex,
    backupPath,
    sizeBytes,
    filesCount: filesToBackup.length,
    createdAt: new Date().toISOString(),
  };
}

async rollbackStep(stepIndex: number): Promise<void> {
  const backupPath = path.join(
    this.projectPath,
    '.agent-hub/executions',
    this.executionId,
    'backups',
    `step-${stepIndex}.tar.gz`
  );

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup no encontrado: ${backupPath}`);
  }

  // 1. Extraer tar.gz (sobrescribe archivos)
  const extractCommand = `tar xzf "${backupPath}" -C "${this.projectPath}"`;
  await exec(extractCommand);

  // 2. Marcar paso como rolled back
  const execution = await readExecution(this.executionId);
  execution.results[stepIndex].status = 'rolled_back';
  await saveExecution(execution);
}
```

### Detección de cambios

**Algoritmo: Comparar snapshot vs. estado actual**

```typescript
async detectChanges(backup: BackupInfo): Promise<string[]> {
  const filesModified = [];

  // 1. Crear lista de archivos en backup
  const backupFiles = await exec(
    `tar tzf "${backup.backupPath}" | grep -v '/$'`
  );
  const backupSet = new Set(
    backupFiles.split('\n').filter(Boolean)
  );

  // 2. Listar archivos actuales
  const currentFiles = await walkDir(this.projectPath, {
    exclude: ['.git', 'node_modules', '.next', 'dist', '.agent-hub']
  });

  // 3. Comparar
  for (const currentFile of currentFiles) {
    const relativePath = path.relative(this.projectPath, currentFile);
    
    if (!backupSet.has(relativePath)) {
      // Archivo nuevo
      filesModified.push(relativePath);
      continue;
    }

    // Archivo existe en ambos: comparar contenido
    const backupContent = await extractFileFromTar(
      backup.backupPath,
      relativePath
    );
    const currentContent = fs.readFileSync(currentFile, 'utf-8');

    if (backupContent !== currentContent) {
      filesModified.push(relativePath);
    }
  }

  // 4. Detectar archivos eliminados
  for (const backupFile of backupSet) {
    const fullPath = path.join(this.projectPath, backupFile);
    if (!fs.existsSync(fullPath)) {
      filesModified.push(backupFile); // Marcado como eliminado
    }
  }

  return filesModified;
}
```

### Error handling: Categorías y recuperabilidad

```typescript
interface ErrorCategory {
  name: string;
  recoverable: boolean;
  shouldRollback: boolean;
  userMessage: string;
}

const ERROR_CATEGORIES: Record<string, ErrorCategory> = {
  'timeout': {
    name: 'timeout',
    recoverable: false,        // No puedes reintentar automáticamente
    shouldRollback: true,      // Rollback sí
    userMessage: 'El agente tardó demasiado. Intenta de nuevo o aumenta el timeout.'
  },
  'invalid_path': {
    name: 'invalid_path',
    recoverable: true,        // Puedes arreglar el path
    shouldRollback: false,
    userMessage: 'El agente intentó acceder a un archivo inválido. Revisa los permisos.'
  },
  'filesystem': {
    name: 'filesystem',
    recoverable: false,        // Problema del disco
    shouldRollback: true,
    userMessage: 'Error al acceder al filesystem. Verifica espacio en disco.'
  },
  'validation': {
    name: 'validation',
    recoverable: true,        // Puedes revisar el prompt
    shouldRollback: false,
    userMessage: 'Validación fallida. Revisa que el contexto es válido.'
  },
  'ai_error': {
    name: 'ai_error',
    recoverable: true,        // Reintentar
    shouldRollback: false,
    userMessage: 'Error del proveedor de IA. Intenta de nuevo.'
  },
  'tool_execution': {
    name: 'tool_execution',
    recoverable: false,       // Un tool call falló
    shouldRollback: true,
    userMessage: 'Un comando falló. Revisa los logs para más detalles.'
  }
};

function categorizeError(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();

  if (message.includes('timeout') || message.includes('timed out')) {
    return ERROR_CATEGORIES.timeout;
  }
  if (message.includes('path') || message.includes('traversal')) {
    return ERROR_CATEGORIES.invalid_path;
  }
  if (message.includes('enoent') || message.includes('eacces')) {
    return ERROR_CATEGORIES.filesystem;
  }
  if (message.includes('validation') || message.includes('invalid')) {
    return ERROR_CATEGORIES.validation;
  }
  if (message.includes('ai') || message.includes('provider')) {
    return ERROR_CATEGORIES.ai_error;
  }
  if (message.includes('tool') || message.includes('command')) {
    return ERROR_CATEGORIES.tool_execution;
  }

  return ERROR_CATEGORIES.ai_error; // Default
}
```

### Limpieza de ejecuciones antiguas

```typescript
async cleanupExecutions(orchestrationId: string): Promise<CleanupResult> {
  const executionsDir = path.join(projectPath, '.agent-hub/executions');
  const execDirs = fs.readdirSync(executionsDir);

  const policies = {
    maxCount: 50,              // Máximo 50 ejecuciones
    maxAgeDays: 30,            // Eliminar más viejas de 30 días
    maxSizeGB: 5,              // Máximo 5GB en backups
  };

  let deletedCount = 0;
  let freedBytes = 0;

  // 1. Ordenar por fecha (más antiguas primero)
  const sorted = execDirs
    .map(dir => ({
      name: dir,
      path: path.join(executionsDir, dir),
      timestamp: parseInt(dir.split('T')[0]),
      createdAt: new Date(dir.split('-exec-')[0].replace(/T/g, ' ')),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // 2. Eliminar si excede maxCount
  if (sorted.length > policies.maxCount) {
    const toDelete = sorted.slice(0, sorted.length - policies.maxCount);
    for (const exec of toDelete) {
      const size = getDirSize(exec.path);
      fs.rmSync(exec.path, { recursive: true });
      deletedCount++;
      freedBytes += size;
    }
  }

  // 3. Eliminar si más antiguo que maxAgeDays
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - policies.maxAgeDays);

  for (const exec of sorted) {
    if (exec.createdAt < cutoffDate) {
      const size = getDirSize(exec.path);
      fs.rmSync(exec.path, { recursive: true });
      deletedCount++;
      freedBytes += size;
    }
  }

  // 4. Eliminar si total excede maxSizeGB
  let totalSize = 0;
  for (const dir of fs.readdirSync(executionsDir)) {
    totalSize += getDirSize(path.join(executionsDir, dir));
  }

  if (totalSize > policies.maxSizeGB * 1024 * 1024 * 1024) {
    // Eliminar más antiguas hasta estar bajo el límite
    for (const exec of sorted) {
      const size = getDirSize(exec.path);
      if (totalSize > policies.maxSizeGB * 1024 * 1024 * 1024) {
        fs.rmSync(exec.path, { recursive: true });
        totalSize -= size;
        deletedCount++;
        freedBytes += size;
      }
    }
  }

  return { deletedCount, freedBytes };
}
```

### Validaciones en UI

**Mensajes de error específicos según validación:**

```typescript
async validateOrchestrationBeforeExecute(orch: Orchestration, project: Project) {
  const errors: UIValidationError[] = [];

  // 1. Validar que CLAUDE.md existe si se necesita
  const needsClaude = project.aiProvider === 'claude' || project.aiProvider === 'both';
  const claudeMdPath = path.join(project.path, 'CLAUDE.md');
  
  if (needsClaude && !fs.existsSync(claudeMdPath)) {
    errors.push({
      severity: 'critical',
      code: 'no_claude_md',
      message: 'El proyecto no tiene CLAUDE.md configurado',
      action: 'Generar CLAUDE.md',
      actionUrl: `/projects/${project.id}?tab=context`
    });
  }

  // 2. Validar que agentes existen
  for (const agentName of orch.agents) {
    const agent = await getAgent(agentName);
    if (!agent) {
      errors.push({
        severity: 'critical',
        code: 'missing_agent',
        message: `Agente no encontrado: ${agentName}`,
        action: null
      });
    }
  }

  // 3. Validar contextos fijos
  for (const node of orch.nodes) {
    if (node.contextExtra.fixed) {
      const filePath = path.join(project.path, node.contextExtra.fixed.value);
      if (!fs.existsSync(filePath)) {
        errors.push({
          severity: 'critical',
          code: 'missing_context_file',
          message: `Archivo de contexto no existe: ${node.contextExtra.fixed.value}`,
          action: 'Actualizar ruta',
          actionUrl: `/orchestrations/${orch.id}?edit=node-${node.id}`
        });
      }
    }
  }

  // 4. Validar que hay espacio en disco (al menos 1GB)
  const diskSpace = getDiskSpace(project.path);
  if (diskSpace < 1024 * 1024 * 1024) {
    errors.push({
      severity: 'warning',
      code: 'low_disk_space',
      message: `Poco espacio en disco (${(diskSpace / (1024*1024)).toFixed(0)}MB). Puede que no haya suficiente para backups.`,
      action: null
    });
  }

  return {
    valid: errors.every(e => e.severity !== 'critical'),
    errors
  };
}

interface UIValidationError {
  severity: 'critical' | 'warning' | 'info';
  code: string;
  message: string;
  action?: string;
  actionUrl?: string;
}
```

### Integración con Chat

**Cómo pasar resultado de orquestación al chat:**

```typescript
// En ExecutionPanel, cuando ejecución termina:
const handleResultChat = () => {
  // 1. Preparar contexto del resultado
  const chatContext = `
## Resultado de orquestación: ${orchestration.name}

**Estado:** ${result.status}  
**Pasos completados:** ${result.stepsCompleted} / ${result.totalSteps}  
**Duración:** ${(result.duration / 1000).toFixed(1)}s  
**Tokens totales:** ${result.totalTokensUsed.input} entrada / ${result.totalTokensUsed.output} salida  

### Cambios realizados
- Archivos creados: ${result.summary.filesCreated}
- Archivos modificados: ${result.summary.filesModified}
- Archivos eliminados: ${result.summary.filesDeleted}

### Outputs por paso
${result.results
  .map((r, i) => `**Paso ${i + 1}: ${r.agentName}**\n${r.output.response}`)
  .join('\n\n')}
`;

  // 2. Pasar al chat vía store
  useStore.getState().setPendingChatContext({
    type: 'orchestration_result',
    content: chatContext,
    orchestrationId: orchestration.id,
    executionId: result.executionId,
  });

  // 3. Navegar a chat
  navigateTo('chat');
};

// En Chat.tsx, al montar:
useEffect(() => {
  const pendingContext = useStore(s => s.pendingChatContext);
  if (pendingContext) {
    setInput(
      `Discutamos el resultado de la orquestación:\n\n${pendingContext.content}`
    );
    useStore.getState().setPendingChatContext(null);
  }
}, []);
```

---

## 10.2 Roadmap de implementación

**Orden recomendado:**

### Fase 1: Backend (Semana 1-2)

1. ✅ Crear `src/backend/orchestrator.js` (máquina de estados)
   - Métodos: validate(), execute(), buildStepSystemPrompt(), buildStepUserMessage()
   - Manejo de errores y rollback

2. ✅ Crear `src/backend/workflows.js` (CRUD)
   - Métodos: create(), read(), update(), delete(), list()
   - Validaciones de orquestación

3. ✅ Modificar `src/backend/server.js`
   - Nuevas rutas REST (CRUD, ejecución, SSE)
   - Integración con OrchestrationExecutor

4. ✅ Modificar `src/backend/projects.js`
   - `bootstrapProjectDirectories()` (crear .agent-hub/ en proyecto)
   - Actualizar createProject() e importProject()

### Fase 2: Frontend UI (Semana 2-3)

1. ✅ Crear página `src/renderer/pages/Orchestrations.tsx`
   - Layout general, manejo de vistas (list/editor/execution)

2. ✅ Crear componentes:
   - `OrchestrationList.tsx` (tarjetas, CRUD)
   - `OrchestrationEditor.tsx` (flujo de edición)
   - `NodeCanvas.tsx` (visualización)
   - `ConnectionConfigurator.tsx` (configuración)

3. ✅ Crear `ExecutionPanel.tsx`
   - Recolección de contextos temporales
   - SSE streaming de logs
   - Renderización de resultados

4. ✅ Agregar navegación
   - Sidebar icon
   - Rutas en App.tsx

### Fase 3: Testing (Semana 3)

1. ✅ Unit tests del Orquestador
2. ✅ Integration tests (flujo completo)
3. ✅ E2E tests (UI)

### Fase 4: Polish (Semana 4)

1. ✅ Error handling y mensajes amigables
2. ✅ Validaciones exhaustivas
3. ✅ Performance (caching, limpieza)
4. ✅ Documentación

---

---

## 11. Ejemplos de uso

### Ejemplo 1: Crear orquestación "Code Review + Refactor"

```typescript
// API call
POST /api/orchestrations {
  projectId: "proj-001",
  name: "Code Review & Refactor",
  description: "Analiza código y refactoriza automáticamente",
  agents: ["code-reviewer", "refactor-expert"],
  nodes: [
    {
      id: "node-1",
      from: 0,
      to: 1,
      dataFlow: {
        agentOutput: true,
        filesModified: true,
        claudeMd: true,
        selectiveFiles: ["src/**/*.ts"]
      },
      contextExtra: {
        fixed: {
          type: "file",
          value: "docs/refactoring-guide.md",
          label: "Guía de refactoring"
        },
        temporal: []
      }
    }
  ],
  executionConfig: {
    stopOnError: true,
    validateAfterEachStep: false,
    maxTurns: 10,
    timeout: 300000
  }
}

// Response
{
  "id": "orch-abc123",
  "projectId": "proj-001",
  "name": "Code Review & Refactor",
  ...
}
```

### Ejemplo 2: Ejecutar orquestación

```typescript
// API call
POST /api/orchestrations/orch-abc123/execute {
  projectId: "proj-001",
  temporalContexts: {}  // Sin contextos temporales en este caso
}

// Response (inmediato)
{
  "executionId": "exec-20260528-001",
  "status": "started"
}

// SSE Stream
data: {"timestamp":"...","level":"info","message":"Validando precondiciones..."}
data: {"timestamp":"...","level":"info","message":"Paso 1: code-reviewer iniciado"}
data: {"timestamp":"...","level":"info","message":"Analizando código..."}
...
event: step-done
data: {"type":"step-done","data":{"stepIndex":0,"agentName":"code-reviewer",...}}
...
event: completed
data: {"type":"completed","data":{"orchestrationId":"orch-abc123",...,"status":"success",...}}
```

---

## 12. Testing

### 12.1 Unit Tests

```typescript
describe('OrchestrationExecutor', () => {
  it('should validate orchestration before executing', async () => {
    const executor = new OrchestrationExecutor(...);
    const result = await executor.validate();
    expect(result.valid).toBe(true);
  });

  it('should inject context correctly', () => {
    const executor = new OrchestrationExecutor(...);
    const prompt = executor.buildStepSystemPrompt(0);
    expect(prompt).toContain('CONTEXTO DEL PROYECTO');
    expect(prompt).toContain('code-reviewer');
  });

  it('should handle errors with stopOnError', async () => {
    // Simular error en paso 1
    // Verificar que rollback se ejecuta
    // Verificar que ejecución se detiene
  });

  it('should compute costs correctly', () => {
    // Verificar cálculo de coste por modelo
  });
});

describe('WorkflowManager', () => {
  it('should validate node connections', () => {
    const errors = validateOrchestration({
      agents: ['agent1', 'agent2'],
      nodes: [
        { from: 0, to: 2, ... }  // Inválido: to debería ser 1
      ]
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

### 12.2 Integration Tests

```typescript
describe('Orchestration Flow', () => {
  it('should execute full workflow end-to-end', async () => {
    // 1. Crear orquestación
    // 2. Guardar en FS
    // 3. Leer desde FS
    // 4. Ejecutar
    // 5. Verificar resultados
    // 6. Verificar backups
    // 7. Rollback
    // 8. Verificar archivos restaurados
  });

  it('should handle tool calls from Subsistema CLI', async () => {
    // Verificar que tool calls se ejecutan correctamente
    // Verificar que resultados se inyectan en siguiente paso
  });
});
```

### 12.3 E2E Tests

```typescript
describe('Orchestration UI', () => {
  it('should create orchestration from UI', async () => {
    // Simular clicks en UI
    // Verificar que orchestration se crea
    // Verificar que se guarda correctamente
  });

  it('should execute orchestration and show progress', async () => {
    // Ejecutar orquestación
    // Verificar que logs fluyen vía SSE
    // Verificar que resultado se muestra correctamente
  });
});
```

---

## 13. Roadmap futuro

### Fase 2: Paralelismo

```
Permitir múltiples agentes en paralelo:
  [agent1] \
             [merge] → [agent3]
  [agent2] /

Configurar:
  - Qué agentes ejecutan en paralelo
  - Cómo se mergean los outputs
  - Timeout de sincronización
```

### Fase 3: Bifurcaciones condicionales

```
Ejecutar diferentes ramas según condiciones:
  [agent1]
    ├─ Si éxito → [agent2]
    └─ Si error → [agent3] (recovery)

Configurar:
  - Condiciones (basadas en outputs previos)
  - Branches
```

### Fase 4: Loops e iteración

```
Ejecutar un agente múltiples veces:
  [analyzer] → 
    loop {
      [refactor] → [test]
    }
    until tests pass or max iterations

Configurar:
  - Condición de salida
  - Max iteraciones
```

### Fase 5: Orquestaciones compartidas

```
Publicar orquestaciones en repositorio externo
Sincronizar desde directorio (como agentes)
Usar orquestaciones de otros usuarios
Versionado de orquestaciones
```

### Fase 6: Integración con CI/CD

```
Ejecutar orquestaciones en pipeline:
  - GitHub Actions
  - GitLab CI
  - Jenkins
  
Triggers:
  - Push a rama
  - Pull request
  - Manual
```

---

## Apéndice: Cambios en archivos existentes

### Cambios en `src/backend/main.js`

```typescript
// Agregar inicialización de WorkflowManager
import { WorkflowManager } from './workflows.js';
import { OrchestrationExecutor } from './orchestrator.js';

const workflowManager = new WorkflowManager(CONFIG);

// En app.whenReady():
bootstrapDirectories(cfg);
// → Ahora también crea .agent-hub/orchestrations/
// → Ahora también crea .agent-hub/executions/
```

### Cambios en `src/backend/config.js`

Las orquestaciones se crean **en cada proyecto**, no en la app. Simplemente asegurar que el directorio `.agent-hub/` existe cuando se crea/importa un proyecto (esto ya debería estar implementado):

```typescript
export function bootstrapDirectories(cfg: Config) {
  // Estos directorios están en la app
  ensureDir(AGENTS_DIR);
  ensureDir(CACHE_DIR);
  
  // Los directorios de orquestaciones se crean en cada proyecto
  // (vía projects.createProject() o projects.importProject())
}

// En projects.js → createProject() / importProject()
function bootstrapProjectDirectories(projectPath: string) {
  ensureDir(path.join(projectPath, '.agent-hub'));
  ensureDir(path.join(projectPath, '.agent-hub', 'orchestrations'));
  ensureDir(path.join(projectPath, '.agent-hub', 'executions'));
  ensureDir(path.join(projectPath, '.agent-hub', 'backups'));
  // workflows/ y skills/ ya deben existir
}
```

### Cambios en `src/renderer/App.tsx`

```typescript
// Agregar ruta lazy para Orchestrations
const OrchestrationPage = React.lazy(() =>
  import('./pages/Orchestrations').then(m => ({
    default: m.OrchestrationPage,
  }))
);

// En rutas:
{view === 'orchestrations' && <OrchestrationPage />}
```

### Cambios en `src/renderer/components/layout/Sidebar.tsx`

```typescript
// Agregar icono para orquestaciones
{
  view: 'orchestrations',
  icon: 'ti-flow-split',
  label: 'Orquestaciones'
}
```

---

## Conclusión

Este documento define un sistema completo para orquestar múltiples agentes a nivel de proyecto, con:

- ✅ Editor visual intuitivo
- ✅ Configuración granular de flujos de datos
- ✅ Contextos fijos y temporales
- ✅ Ejecución secuencial robusta
- ✅ Auditoría completa y rollback granular
- ✅ Integración con Subsistema CLI
- ✅ Escalable a paralelismo y bifurcaciones en futuro

**Próximo paso:** Implementar siguiendo este documento. Empezar por backend (Orquestador + CRUD), luego frontend (Página + Editor).
