# Orquestación de Agentes en genoma-solution

## Arquitectura General

El sistema implementa un **orquestador genérico agnóstico al workflow** (`PhaseEngine`) que da servicio a los 5 pipelines. El patrón central es:

```
Lead (API reasoning) → Prompt Generator (API) → Workers CLI (paralelo)
```

---

## 1. PhaseEngine — El Orquestador Central

**Fichero:** `engines/copilot/genoma/core/phase_engine.py`

Es la clase base que todos los pipelines heredan o instancian. Gestiona:

| Responsabilidad | Mecanismo |
|---|---|
| Ejecución secuencial de fases | `async run()` con dict de phase runners |
| Pausa humana | HITL gates → `wait_for_hitl()` |
| Iteración de calidad | REVISE loop (backup + re-run desde cero) |
| Comunicación real-time | `emit(category, type, data)` → WebSocket + JSONL |
| Snapshots | `checkpoint_agent()` / `checkpoint_phase()` |

Los agentes se ejecutan en dos modos vía backends pluggables:
- **`run_reasoning_agent()`** → llamada REST a Copilot/Azure OpenAI (leads, prompt generators, validators)
- **`run_cli_agent()`** → proceso Copilot CLI completo (workers de generación de código)

### Componentes internos del PhaseEngine

```
PhaseEngine
├── async run()
│   ├── HITL gates
│   ├── Event logging
│   ├── Phase runners dict
│   └── REVISE loops
│
├── EventLogger
│   ├── events.jsonl        (append-only audit trail)
│   ├── pipeline_state.json (crash recovery)
│   └── security_audit.jsonl
│
├── SkillLibrary
│   ├── load_skill()        (inyección de contexto al agente)
│   ├── build_catalog_for_lead()
│   └── inject_skills()
│
├── Agent backends
│   ├── run_reasoning_agent()
│   ├── run_cli_agent()
│   └── set_agent_backends()
│
└── Git integration
    ├── checkpoint_agent()
    ├── checkpoint_phase()
    └── GitCheckpointer (instancia anidada)
```

---

## 2. Patrón de Fases: Lead → PG → Workers

El patrón canónico que siguen los 5 pipelines:

```
1. LEAD (reasoning API, effort=high)
   └─ Input: inventory / plan / specs
   └─ Output: plan JSON con grupos de workers y sus instrucciones

2. PROMPT GENERATOR (reasoning API)
   └─ Por cada cluster/grupo del plan
   └─ Genera el prompt específico del worker

3. WORKERS CLI (Copilot CLI, en paralelo)
   └─ asyncio.gather() con max_concurrent configurable
   └─ Cada worker lee sus inputs y escribe su output
   └─ Sandbox paths: write/read roots aislados por worker
```

El paralelismo se controla mediante `asyncio.gather()` y el parámetro `max_concurrent` en cada `config.json`.

### Ejemplo canónico (Code2Specs, fase Analysis)

```python
async def run_analysis(engine) -> PhaseResult:
    result = PhaseResult(phase=PhaseId.ANALYSIS)

    await engine.emit("phase", "plan", {
        "phase": "analysis",
        "groups": [["spec_analyzer"]],
    })

    analysis_text = await engine.run_reasoning_agent(
        "spec_analyzer", SPEC_ANALYZER_PROMPT, user_prompt,
        output_file="analysis.json"
    )
    result.agents_run.append("spec_analyzer")
    return result
```

### Paralelismo de workers

```python
tasks = [
    engine.run_cli_agent(f"extractor_{i}", instructions_i, output_file_i)
    for i in range(num_extractors)
]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

---

## 3. Estado Persistente y Recuperación ante Crashes

**Fichero:** `engines/copilot/genoma/core/pipeline_state.py`

Modelo jerárquico con escrituras atómicas (write-to-temp + rename + advisory lock):

```
PipelineState
├── workflow: str                     (build|reverse|edit|upgrade|docs2specs)
├── status: str                       (initialized|running|paused_hitl|completed|failed)
├── phases: dict[str, PhaseState]
│   ├── phase_id, status
│   ├── hitl_decision, hitl_feedback
│   ├── plan_file (path al lead JSON)
│   └── agents: dict[str, AgentState]
│       ├── agent_id, status
│       ├── output_file
│       └── started_at, completed_at, error
```

Al reiniciar, `get_resume_phase()` detecta la primera fase no completada y el dashboard ofrece resume. Los métodos clave son:

| Método | Descripción |
|---|---|
| `pipeline_started()` | Inicializa el estado del pipeline |
| `phase_started()` | Marca el inicio de una fase |
| `agent_started()` | Registra el inicio de un agente |
| `phase_hitl_paused()` | Pausa la fase en gate HITL |
| `get_resume_phase()` | Detecta fase de recuperación tras crash |
| `_persist()` | Escritura atómica bajo lock |

---

## 4. HITL Gates (Human-In-The-Loop)

Puntos de pausa configurables entre fases donde el operador puede:

| Decisión | Efecto |
|---|---|
| **APPROVE** | Continúa al siguiente estado |
| **REVISE** | Limpia outputs (`phase_cleanup.py`) y re-ejecuta la fase |
| **FEEDBACK** | Inyecta contexto adicional y re-ejecuta |

### Patrón REVISE

```
Operador hace clic en "REVISE" en HITL gate
  ↓
backup_and_clean_phase(output_dir, phase, workflow)
  ├─ Crea git tag "before-revise-{phase}"
  ├─ Identifica archivos según WORKFLOW_PATTERNS
  ├─ Mueve a .backup/{phase}_{timestamp}/
  └─ La fase re-ejecuta desde un estado limpio
```

Los gates activos por pipeline se declaran en el `PhaseEngine` de cada workflow. El fichero de referencia es `engines/copilot/genoma/core/phase_cleanup.py`.

---

## 5. DAG Planner — Topología de Deliverables

**Fichero:** `engines/copilot/genoma/core/pipeline_planner.py`

Usado exclusivamente en el Spec Editor (WF3) para los 6 deliverables TO-BE. Soporta 3 presets más DAG custom:

```
PRESET_PIPELINES = {
    "data-first": [
        {"phase": "data_model",         "depends_on": []},
        {"phase": "api_contracts",      "depends_on": ["data_model"]},
        {"phase": "functional_design",  "depends_on": ["data_model"]},
        {"phase": "look_and_feel",      "depends_on": ["functional_design"]},
        {"phase": "technical_design",   "depends_on": [TODOS LOS ANTERIORES]},
        {"phase": "test_plan",          "depends_on": ["functional_design", "technical_design"]},
    ],
    "api-first":  [...],
    "ui-first":   [...],
}
```

### Invariantes forzadas

1. `technical_design` es siempre el último emisor de lógica
2. `test_plan` corre siempre después de `functional_design` + `technical_design`
3. `look_and_feel` corre siempre después de `functional_design`
4. Nada depende de `technical_design` excepto `test_plan`

El output es un `PipelinePlan` con `stages: list[list[str]]` (grupos ejecutables en paralelo) y `order: list[str]` (orden flat).

---

## 6. Git Checkpointing

**Fichero:** `engines/copilot/genoma/core/git_checkpointer.py`

Snapshots reversibles por agente y por fase:

| Método | Operación |
|---|---|
| `checkpoint(message)` | `git add -A && git commit` — devuelve hash |
| `tag(name)` | `git tag {name}-{timestamp}` |
| `rollback(target)` | `git reset --hard + git clean -fd` |
| `detect_out_of_scope(allowed_prefixes)` | Detecta escrituras fuera del sandbox |

El Spec Editor usa **Dual GitCheckpointer**: uno para `edited_specs/` y otro para `deliverables_tobe/`, ambos en paralelo.

---

## 7. Spec Editor — Operaciones Atómicas (ADR-016)

**Fichero:** `engines/copilot/genoma/specs_editor/atomic_ops.py`

Cada cambio al spec es un `AtomicOp` con ciclo de vida estricto:

```
PENDING → VERIFIED → APPLIED → RESOLVED
```

Las ops nunca se eliminan, solo avanzan de estado. Se persisten en `ops.yaml` (atomic rename).

### Estructura de AtomicOp

```python
@dataclass
class AtomicOp:
    id: str              # aop_{uuid8}
    kind: OpKind         # add | modify | remove | rename | refactor | other
    target: OpTarget     # file, section, entity, line_hint
    before_snippet: str  # estado anterior
    after_intent: str    # intención del cambio
    rationale: str       # justificación
    evidence: list[OpEvidence]
    status: OpStatus
    source: dict         # {kind: upload|chat, file_path|turn_id}
    commit_sha: str | None
    confidence: str      # HIGH | MED | LOW
```

El pipeline del Spec Editor tiene 4 fases atómicas: `EXTRACT → RESOLVE → PROPAGATE → REVIEW`.

---

## 8. Event System

**Fichero:** `engines/copilot/genoma/web/app.py`

```
emit(category, type, data)
  ├─ Auto-inyecta workflow tag (ContextVar _workflow_ctx)
  ├─ broadcast() → WebSocket multicast a todos los dashboards
  ├─ persist_event() → events.jsonl (append-only, por workflow)
  └─ agent_logs/{name}.log (por agente)
```

Cada dashboard filtra por `workflow` tag estricto. Al reiniciar el servidor, `load_last_run_events()` reconstruye el estado de todos los dashboards desde disco.

### Routing de eventos

```
[PhaseEngine.emit] → [web/app.emit] → broadcast() → {
    persist_event()       → events.jsonl
    WebSocket multicast   → dashboards en tiempo real
    agent_logs/{name}.log → auditoría por agente
}
```

---

## 9. Backends de Razonamiento

| Backend | Activación | Endpoint | Retry |
|---|---|---|---|
| **Copilot** (default) | `GENOMA_REASONING_BACKEND=copilot` | `api.githubcopilot.com` | Backoff exponencial 8s/16s en 422/429/5xx |
| **Azure OpenAI** | `GENOMA_REASONING_BACKEND=azure` | Azure deployment `gpt-5.2` | 1 retry si JSON parse falla |

Ambos backends aplican extracción robusta de JSON (`_extract_fenced_json`) con one-shot retry si el output no parsea. El hardening "NO TOOLS" se inyecta en el system prompt cuando el caller pasa `output_file` (contexto pipeline), preservando el protocolo de herramientas en los chats del Spec Editor (`output_file=None`).

### Estrategia de extracción JSON

```
_extract_fenced_json(text):
  1. Busca bloque ```json ... ```  (canónico)
  2. Busca bloque ``` ... ```  (si el body parsea como JSON)
  3. Primer {...} o [...] balanceado que parsee
  4. Raw text (el caller verá el parse error)
```

---

## 10. Sub-agentes: 3 Fuentes

| Fuente | Fichero | Descripción |
|---|---|---|
| **Estáticos** (catálogo) | `data/agents/static/*.agent.md` | Declarativos en markdown, copiados al workspace en el provisioning |
| **Determinísticos** | `core/agent_builder.py` | Builders Python que leen estado del proyecto (DDL, specs, blueprint) y embeben en el prompt |
| **AI-generated** | `core/subagent_generator.py` | El reasoning model genera `CustomAgentConfig` desde una spec de propósito/inputs/outputs |

Los workspaces aislados se provisionan via `workspace_provisioner.py` con layout estándar:

```
workspace/
├── .genoma/
│   ├── project.md       (Layer 1: contexto compartido cross-pipeline)
│   ├── {workflow}.md    (Layer 2: contexto por pipeline)
│   └── {workflow}.analysis.md  (Layer 3: análisis auto-generado, volatile)
├── .github/
│   ├── copilot-instructions.md  (manifiesto compuesto)
│   └── agents/          (sub-agentes copiados del catálogo)
└── specs/
```

El mapping `project_id → workspace_path` persiste en `~/.genoma/projects.json`.

---

## 11. Workflows y sus Fases

### Code2Specs (WF1) — 7 fases

```
Indexing → Extraction → Review → Fix → Synthesis → Validation → Fixing
```

Con REVISE loop entre Validation y Fixing para iteración de calidad dirigida por operador.

### Specs2Code (WF2) — 5 fases

```
Analysis → Design → Implementation → Testing → Fixing
```

Los agentes CLI compilan (mvn/npm) dentro del workspace aislado.

### Spec Editor (WF3) — Canonization + 4 fases + 6 deliverables

```
Canonization (L1)
  └─ gap_inventory_builder.py (Step 0, sin LLM)
  └─ consolidation_tool.py    (Step 2, LLM decide, script aplica)
  └─ _diff_validator.py       (Step 4, audit preservation contract)

Extract → Resolve → Propagate → Review (Atomic Ops, L2)

Deliverables TO-BE (L3, cascade-aware):
  Data Model → API Contracts → Functional Design
  → Look & Feel → Technical Design → Test Plan
```

### Code2Code (WF4) — 5 fases

```
Scan → Plan → Upgrade → Validate → Fix
```

Pipeline independiente del E2E para upgrade de versión (Spring Boot 2→3, Angular 14→19).

### Docs2Specs (WF5) — 7 fases

```
Ingestion → Classification → Extraction → Review
         → Consolidation → Synthesis → Validation
```

Mismo formato de salida que Code2Specs. Compatible con el Spec Editor sin adaptadores.

---

## 12. Flujo de Ejecución Completo

```
Usuario → POST /api/{workflow}/start
            │
            ▼
        start_new_run(project_id, workflow)
        pipeline_task = asyncio.create_task(engine.run())
            │
            ▼
        PhaseEngine.run()
            │
            ├── Para cada fase en sequence:
            │     ├── phase_started()           → pipeline_state.json
            │     ├── emit("phase", "start")    → WebSocket + JSONL
            │     │
            │     ├── phase_runner(engine)       → Lead → PG → Workers
            │     │     └── asyncio.gather(workers)
            │     │
            │     ├── checkpoint_phase()         → git commit
            │     ├── emit("phase", "complete")
            │     │
            │     └── [Si HITL gate activo]
            │           ├── emit("gate", "open")
            │           ├── wait_for_hitl()      ← pausa aquí
            │           │
            │           ├── APPROVE → siguiente fase
            │           └── REVISE  → backup_and_clean + re-run
            │
            └── emit("pipeline", "complete")
```

---

## Resumen de Patrones de Orquestación

| Patrón | Fichero clave |
|---|---|
| Ejecución secuencial con HITL gates | `core/phase_engine.py` |
| Paralelismo `asyncio.gather` + `max_concurrent` | Phase runners de cada workflow |
| Estado persistente + resume tras crash | `core/pipeline_state.py` |
| Audit trail JSONL + WebSocket real-time | `web/app.py` |
| REVISE loop (backup-clean-rerun) | `core/phase_engine.py` + `core/phase_cleanup.py` |
| Snapshots git por agente/fase | `core/git_checkpointer.py` |
| Inyección de skills al contexto del agente | `SkillLibrary` en `core/phase_engine.py` |
| DAG topológico de deliverables | `core/pipeline_planner.py` |
| Operaciones atómicas con ciclo de vida | `specs_editor/atomic_ops.py` |
| Sandbox paths por worker | `cli_backend()` en `web/app.py` |
| Retry con backoff exponencial | `web/app.py` + `docs2specs/phases.py` |
| Extracción robusta de JSON con one-shot retry | `web/app.py` (`_extract_fenced_json`) |
| Workspaces aislados por proyecto | `core/workspace_provisioner.py` |
| Sub-agentes AI-generated | `core/subagent_generator.py` |
