/**
 * orchestrator.js — Orchestration execution engine
 *
 * Executes a sequence of agents for a given orchestration.
 * Supports SSE streaming of progress via EventEmitter.
 * Uses file-based backups (JSON snapshots) for rollback.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { readConfig, ensureDir } = require('./config');
const { listAgentsByLevel, parseAgentFile, getAgentsDirForProvider } = require('./agents');
const mcp = require('./mcp');
const { calcAnthropicCost, isNativeCLI } = require('./ai');
const prompts           = require('./prompts');
const scriptsRegistry   = require('./scripts-registry');
const gitCheckpointer   = require('./git-checkpointer');
const opsLedger         = require('./ops-ledger');
const { migrateOrchestration } = require('./workflows');
const { resolveSkills, skillsPromptBlock } = require('./skills');
const { runInProject } = require('./project-runner');
const crypto2           = crypto; // alias for ops id generation

// ── Constants ─────────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage',
  '.agent-hub', '__pycache__', '.venv', 'venv', '.turbo', 'out', '.cache',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.css', '.scss', '.less',
  '.html', '.htm', '.vue', '.svelte', '.yml', '.yaml',
  '.toml', '.sh', '.py', '.rb', '.php', '.java', '.cs',
  '.go', '.rs', '.cpp', '.c', '.h', '.swift', '.kt',
  '.dart', '.sql', '.graphql', '.xml', '.env', '.gitignore',
  '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc',
]);

const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256KB per file in snapshot
const MAX_SNAPSHOT_FILES  = 500;        // Limit snapshot size

// Token-efficiency limits (kept low for GitHub Copilot Free 8k-token window)
const MAX_CONTEXT_FILE_CHARS  = 2000;   // max chars per fixed-context file

// ── Filesystem helpers ────────────────────────────────────────────────────────

function isTextFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || (!ext && !relPath.includes('.'));
}

function walkDir(dir, base) {
  if (!base) base = dir;
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      // Skip hidden dirs except .env files
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath, base));
      } else if (entry.isFile()) {
        files.push(path.relative(base, fullPath).replace(/\\/g, '/'));
      }
    }
  } catch {}
  return files;
}

// ── Error categorization ──────────────────────────────────────────────────────

function categorizeError(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('traversal') || (msg.includes('path') && msg.includes('invalid'))) return 'invalid_path';
  if (msg.includes('enoent') || msg.includes('eacces') || msg.includes('eperm')) return 'filesystem';
  if (msg.includes('validation') || msg.includes('invalid')) return 'validation';
  if (msg.includes('cli') || msg.includes('claude cli')) return 'cli';
  return 'ai_error';
}

// ── Handoff parser ────────────────────────────────────────────────────────────
// Busca la línea "HANDOFF: {...}" al final de la respuesta del agente.
// Si el agente no la emite, devuelve null y el orquestador usa el fallback.

function extractHandoff(response) {
  const match = (response || '').match(/^HANDOFF:\s*(\{.+\})\s*$/m);
  if (!match) return null;
  try {
    const h = JSON.parse(match[1]);
    return {
      done:    typeof h.done    === 'string'  ? h.done    : '',
      changed: Array.isArray(h.changed)       ? h.changed : [],
      issues:  Array.isArray(h.issues)        ? h.issues  : [],
      next:    typeof h.next    === 'string'  ? h.next    : '',
    };
  } catch { return null; }
}

// Elimina la línea HANDOFF del texto que se guarda en el resultado
// para no contaminar el output visible con metadatos internos.
function stripHandoff(response) {
  return (response || '').replace(/^HANDOFF:\s*\{.+\}\s*$/m, '').trimEnd();
}

function hasExecutableTaskInMessage(message) {
  const text = String(message || '');
  const hasTaskSentence = /ejecuta ahora esta tarea concreta:\s*\S+/i.test(text)
    || /solicitud ejecutable\s*:\s*\S+/i.test(text);

  const kvLines = text.match(/^[ \t>*-]*[^:\n]{2,80}:\s*\S.+$/gim) || [];
  const nonMetaKvLines = kvLines.filter(line => {
    const trimmed = String(line).trim();
    return !/^(system|user|assistant|role)\s*:/i.test(trimmed);
  });

  return hasTaskSentence || nonMetaKvLines.length > 0;
}

function looksLikeTaskRefusal(response) {
  const text = String(response || '').toLowerCase();
  return /no se ha indicado ninguna tarea concreta|no se incluy[oó] ninguna tarea|no hay .*objetivo|no puedo proceder sin saber qu[eé] tarea|indica(r)? la tarea espec[ií]fica/.test(text);
}

// ── DAG scheduler ────────────────────────────────────────────────────────────

/**
 * Groups nodes into topological levels. Nodes in the same level
 * have no dependencies on each other and can run in parallel.
 * Returns [] if a cycle is detected.
 */
function computeTopologicalLevels(nodes) {
  const completed = new Set();
  const remaining = new Set(nodes.map(n => n.id));
  const levels    = [];

  while (remaining.size > 0) {
    const ready = nodes.filter(n =>
      remaining.has(n.id) && n.dependsOn.every(dep => completed.has(dep)),
    );
    if (ready.length === 0) return levels; // cycle — stop early
    levels.push(ready);
    ready.forEach(n => { completed.add(n.id); remaining.delete(n.id); });
  }
  return levels;
}

// ── OrchestrationExecutor ─────────────────────────────────────────────────────

class OrchestrationExecutor extends EventEmitter {
  constructor(orchestration, project, temporalContextValues = {}) {
    super();
    const migrated             = migrateOrchestration(orchestration);
    this.orchestration         = { ...migrated, nodes: (migrated.nodes || []).map(n => ({ ...n, dependsOn: n.dependsOn || [] })) };
    this.project               = project;
    this.temporalContextValues = temporalContextValues;
    this.executionId           = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.state                 = 'idle';
    this.currentStep           = -1;
    this.cancelled             = false;
    this._browserContinueFn    = null;
    this.results               = [];
    this.logs                  = [];
    this.execDir               = null;
  }

  cancel() {
    if (this.state === 'running') {
      this.cancelled = true;
      if (this._browserContinueFn) { this._browserContinueFn(); this._browserContinueFn = null; }
      this._pendingGate = null;
      this._log('warn', 'Ejecución cancelada por el usuario');
      this.emit('cancelled', { executionId: this.executionId });
    }
  }

  // ── Browser CDP pause/resume ──────────────────────────────────────────────

  // Pause execution until the user confirms the browser is ready (authenticated, etc.)
  _pauseForBrowser(stepIndex, agentName) {
    return new Promise(resolve => {
      this._browserContinueFn = resolve;
      // Store so the SSE stream can replay it if the client connects after the event fires
      this._pendingBrowserRequired = { stepIndex, agentName, executionId: this.executionId };
      this.emit('browser-required', this._pendingBrowserRequired);
    });
  }

  browserContinue() {
    if (this._browserContinueFn) {
      this._pendingBrowserRequired = null;
      this._browserContinueFn();
      this._browserContinueFn = null;
      this.emit('browser-continued', { executionId: this.executionId });
    }
  }

  // Build a context block with cookies + page content from the authenticated CDP session.
  // Native CLIs cannot connect to our CDP browser directly, but they can use the session
  // cookies in HTTP requests and work with the page content already fetched.
  async _buildBrowserContext() {
    try {
      const browser = require('./browser');
      const status  = await browser.getStatus();
      if (!status.connected) return '';

      const page = await browser.getActivePage();
      const url   = page.url();
      const title = await page.title().catch(() => '');

      // Get all cookies for the current session
      let cookieHeader = '';
      try {
        const context = page.context();
        const cookies  = await context.cookies();
        if (cookies.length > 0) {
          cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
      } catch {}

      // Get visible text content of the current page (trimmed to avoid token bloat)
      let pageText = '';
      try {
        const raw = await page.evaluate(() => document.body?.innerText || '');
        pageText = raw.replace(/\s+/g, ' ').trim().slice(0, 3000);
      } catch {}

      const lines = [
        '',
        '# SESIÓN DE NAVEGADOR AUTENTICADA',
        `URL activa: ${url}`,
        title ? `Título: ${title}` : '',
        '',
        cookieHeader
          ? `## Cookies de sesión (úsalas en tus peticiones HTTP)\nCookie: ${cookieHeader}`
          : '(No se pudieron extraer cookies de sesión)',
        '',
        pageText
          ? `## Contenido actual de la página\n${pageText}`
          : '',
        '',
        'Usa estas cookies en las cabeceras HTTP de tus peticiones para mantener la sesión autenticada.',
        'Si necesitas navegar a otras URLs del mismo dominio, incluye siempre la cabecera Cookie.',
      ];
      return lines.filter(l => l !== undefined).join('\n');
    } catch (e) {
      this._log('warn', `No se pudo extraer contexto del navegador: ${e.message}`);
      return '';
    }
  }

  // ── Logging ──────────────────────────────────────────────────────────────

  _log(level, message, data) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...(data ? { data } : {}) };
    this.logs.push(entry);
    this.emit('log', entry);
    if (this.execDir) {
      try {
        fs.appendFileSync(
          path.join(this.execDir, 'logs.jsonl'),
          JSON.stringify(entry) + '\n',
          'utf8',
        );
      } catch {}
    }
  }

  // ── Agent resolution ──────────────────────────────────────────────────────

  _getAllAgents() {
    const cfg  = readConfig();
    const all  = [];
    const seen = new Set();

    const add = (agents) => {
      for (const a of agents) {
        if (!seen.has(a.name)) { seen.add(a.name); all.push(a); }
      }
    };

    const collect = (level, catId, techId) => {
      try { add(listAgentsByLevel(level, catId, techId)); } catch {}
    };

    collect('global');
    for (const cat of (cfg.categories || [])) {
      collect('section', cat.id);
      for (const tech of (cat.technologies || [])) collect('tech', cat.id, tech.id);
    }

    // Project-level agents
    try {
      const providers = this.project.aiProviders || ['claude'];
      for (const p of providers) {
        const dir = getAgentsDirForProvider(this.project.path, p);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
          try {
            const a = parseAgentFile(path.join(dir, f));
            if (!seen.has(a.name)) { seen.add(a.name); all.push({ ...a, level: 'project' }); }
          } catch {}
        }
      }
    } catch {}

    return all;
  }

  _getAgent(agentName) {
    return this._getAllAgents().find(a => a.name === agentName) || null;
  }

  // Root nodes get the project context by default; the rest only when the connection asks for it.
  // Where it comes from (the CLI's own AGENTS.md/CLAUDE.md… or pasted in the prompt) is project-runner's call.
  _includesProjectContext(node) {
    return node.dependsOn.length === 0
      ? node.dataFlow?.projectContext !== false
      : node.dataFlow?.projectContext === true;
  }

  // ── Prompt building ───────────────────────────────────────────────────────

  _buildSystemPrompt(node) {
    const { agentName } = node;
    const agent       = this._getAgent(agentName);
    // A node is "last" if no other node depends on it
    const isLastNode  = !this.orchestration.nodes.some(n => n.dependsOn.includes(node.id));

    let prompt = agent?.system ||
      `Eres el agente "${agentName}". Realiza las tareas relacionadas con tu especialidad.`;

    prompt += `\n\n# REGLA DE EJECUCIÓN\nSi el mensaje incluye un bloque "## Solicitud ejecutable", "## Solicitud activa", "## Parametros de ejecucion" o "## Solicitud concreta a ejecutar", trata ese contenido como la tarea activa. No respondas que falta una tarea concreta si esos bloques existen.`;
    // Fixed context lives on the node itself in the DAG model
    const fc = node.contextExtra?.fixed;
    if (fc) {
      if (fc.freeText?.trim()) {
        prompt += `\n\n# CONTEXTO ADICIONAL\n${fc.freeText.trim()}`;
      }
      for (const filePath of (fc.files || [])) {
        try {
          const resolved = path.isAbsolute(filePath) ? filePath : path.join(this.project.path, filePath);
          const content  = fs.readFileSync(resolved, 'utf8');
          const name     = path.basename(filePath);
          const truncated = content.length > MAX_CONTEXT_FILE_CHARS
            ? content.slice(0, MAX_CONTEXT_FILE_CHARS) + '\n[Archivo truncado]'
            : content;
          prompt += `\n\n# ARCHIVO DE CONTEXTO (${name})\n${truncated}`;
        } catch {}
      }
    }

    try {
      const nodeSkills = resolveSkills(this.project, agent);
      if (nodeSkills.length) this._log('info', `Skills para "${node.agentName}": ${nodeSkills.map(s => s.name).join(', ')}`);
      prompt += skillsPromptBlock(nodeSkills);
    } catch (e) {
      this._log('warn', `No se pudieron cargar las skills: ${e.message}`);
    }

    if (!isLastNode) prompt += prompts.agentHandoffInstruction();
    return prompt;
  }

  _buildUserMessage(node, agentOutputs, stepIndex) {
    let message = '';
    const isRoot = node.dependsOn.length === 0;

    const temporalItems = [];
    for (const n of this.orchestration.nodes || []) {
      for (const temp of (n.contextExtra?.temporal || [])) {
        const value = this.temporalContextValues[`${n.id}-${temp.id}`];
        if (!value) continue;
        temporalItems.push({
          label: String(temp.label || temp.id || 'INPUT').trim(),
          value: String(value).trim(),
        });
      }
    }

    const isIdentifierLabel = (label) => /(^|[^a-z])(id|ids|uuid|guid|key|clave|codigo|c[oó]digo|referencia|ref)([^a-z]|$)/i.test(String(label || '').toLowerCase());
    const actionableItems = temporalItems.filter(item => !isIdentifierLabel(item.label));

    // Build a global execution-params block (LABEL: value) using the exact
    // field names defined in the orchestration.
    const globalParams = temporalItems.map(item => ({ key: item.label, value: item.value }));
    const seenParams = new Set();
    const paramLines = [];
    for (const p of globalParams) {
      if (seenParams.has(p.key)) continue;
      seenParams.add(p.key);
      paramLines.push(`${p.key}: ${p.value}`);
    }
    const paramsList = paramLines.join('\n');

    if (!isRoot && paramsList) {
      message += `## Parametros de ejecucion\n\n${paramsList}\n\n`;
    }

    // Revision feedback (keyed by nodeId)
    const revisions = this._revisionFeedback?.[node.id];
    if (revisions?.length > 0) {
      const latest = revisions[revisions.length - 1];
      if (latest.feedback) {
        message += `## Feedback del operador (revisión ${revisions.length})\n\n${latest.feedback}\n\n`;
      }
    }

    if (isRoot) {
      // Root node: build one explicit active request from the orchestration inputs.
      const taskText = node.contextExtra?.fixed?.freeText?.trim();
      const nodeTemporalItems = [];
      for (const temp of (node.contextExtra?.temporal || [])) {
        const raw = this.temporalContextValues[`${node.id}-${temp.id}`];
        if (!raw) continue;
        nodeTemporalItems.push({
          label: String(temp.label || temp.id || 'INPUT').trim(),
          value: String(raw).trim(),
        });
      }

      const primaryAction = actionableItems.length > 0 ? actionableItems[0] : null;
      const actionableSummary = actionableItems.length > 0
        ? actionableItems.map(item => `${item.label}: ${item.value}`).join('\n')
        : '';
      const nodeInputsSummary = nodeTemporalItems.length > 0
        ? nodeTemporalItems.map(item => `${item.label}: ${item.value}`).join('\n')
        : '';
      const activeRequest = taskText || primaryAction?.value || nodeInputsSummary || actionableSummary;

      const executableInstruction = `Como ${node.agentName}, ejecuta ahora esta tarea concreta: ${activeRequest}`;
      const dynamicInputsBlock = nodeInputsSummary || paramsList || '(Sin parametros de entrada)';

      message += activeRequest
        ? `Solicitud ejecutable: ${executableInstruction}\n\nEntradas del orquestador (campos dinamicos):\n${dynamicInputsBlock}\n\nNo respondas pidiendo una tarea concreta: la tarea ya esta definida arriba y debes ejecutarla ahora.\n\n${taskText && taskText !== activeRequest ? `Instruccion de flujo:\n${taskText}\n\n` : ''}${paramsList ? `Parametros de ejecucion:\n${paramsList}\n\n` : ''}Ejecuta exactamente la solicitud ejecutable usando estos campos como fuente de verdad. Si falta contexto, inspecciona el repositorio y aplica el cambio mínimo necesario.`
        : `## Tarea\n\nEjecuta las acciones correspondientes a tu rol de "${node.agentName}" en este proyecto.` +
          ` Revisa el código, analiza los archivos relevantes y aplica los cambios necesarios según tu especialidad.` +
          (paramsList ? `\n\n## Parametros de ejecucion\n\n${paramsList}` : '');

    } else {
      // Non-root: merge outputs from all predecessor nodes
      const multiPred = node.dependsOn.length > 1;

      for (const depId of node.dependsOn) {
        const predOutput = agentOutputs[depId];
        if (!predOutput) continue;

        if (node.dataFlow?.agentOutput && predOutput.response) {
          const handoff = predOutput.handoff || extractHandoff(predOutput.response);
          if (handoff) {
            message += prompts.formatHandoffAsInput(handoff, predOutput.agentName || depId) + '\n\n';
          } else {
            const snippet = predOutput.response.length > 400
              ? predOutput.response.slice(0, 400) + '\n[...]'
              : predOutput.response;
            const header = multiPred
              ? `## Salida de ${predOutput.agentName || depId}\n\n`
              : `## Paso anterior\n\n`;
            message += header + snippet + '\n\n';
          }
        }

        if (node.dataFlow?.filesModified && predOutput.filesModified?.length > 0) {
          const header = multiPred
            ? `## Archivos modificados por ${predOutput.agentName || depId}\n\n`
            : `## Archivos modificados en el paso anterior\n\n`;
          message += header + predOutput.filesModified.map(f => `- ${f}`).join('\n') + '\n\n';
        }
      }

      // Temporal inputs on this node (for inter-node operator inputs)
      for (const temp of (node.contextExtra?.temporal || [])) {
        const val = this.temporalContextValues[`${node.id}-${temp.id}`];
        if (val) message += `## ${temp.label}\n\n${val}\n\n`;
      }

      message += `## Tarea\n\nEjecuta las acciones correspondientes a tu rol de "${node.agentName}" en este proyecto.` +
        ` Revisa el código, analiza los archivos relevantes y aplica los cambios necesarios según tu especialidad.`;
    }

    const maxChars = this.orchestration.executionConfig?.maxContextChars || 4000;
    if (message.length > maxChars) {
      message = message.slice(0, maxChars) + '\n\n[Contexto truncado por límite de tokens]';
    }
    return message;
  }

  // ── Backup & rollback ─────────────────────────────────────────────────────

  async _takeSnapshot(stepIndex) {
    const backupDir    = path.join(this.execDir, 'backups');
    ensureDir(backupDir);
    const snapshotPath = path.join(backupDir, `pre-step-${stepIndex}.json`);

    const snapshot = {};
    const files    = walkDir(this.project.path);
    let   count    = 0;

    for (const relPath of files) {
      if (count >= MAX_SNAPSHOT_FILES) break;
      if (!isTextFile(relPath)) continue;
      const fullPath = path.join(this.project.path, relPath);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;
        snapshot[relPath] = fs.readFileSync(fullPath, 'utf8');
        count++;
      } catch {}
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8');
    return { snapshotPath, fileCount: count };
  }

  async _detectChanges(snapshot) {
    if (!snapshot || !fs.existsSync(snapshot.snapshotPath)) return [];

    const before      = JSON.parse(fs.readFileSync(snapshot.snapshotPath, 'utf8'));
    const currentFiles = walkDir(this.project.path);
    const currentSet  = new Set(currentFiles);
    const modified    = [];

    // New or changed files
    for (const relPath of currentFiles) {
      if (!isTextFile(relPath)) continue;
      const fullPath = path.join(this.project.path, relPath);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        if (before[relPath] !== content) modified.push(relPath);
      } catch {}
    }

    // Deleted files
    for (const relPath of Object.keys(before)) {
      if (!currentSet.has(relPath)) modified.push(relPath);
    }

    return modified;
  }

  async rollbackStep(stepIndex) {
    // Intentar rollback git si hay SHA disponible para el paso anterior
    if (this.project.gitEnabled) {
      const stepRes = this.results.find(r => r.stepIndex === stepIndex);
      if (stepRes?.gitCommitSha) {
        const prevRes = this.results.find(r => r.stepIndex === stepIndex - 1);
        const targetSha = prevRes?.gitCommitSha;
        if (targetSha) {
          try {
            await gitCheckpointer.rollbackToSha(this.project.path, targetSha);
            return;
          } catch {}
        }
      }
    }

    const snapshotPath = path.join(this.execDir, 'backups', `pre-step-${stepIndex}.json`);
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Backup no encontrado para el paso ${stepIndex}`);
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

    // Restore all snapshotted files
    for (const [relPath, content] of Object.entries(snapshot)) {
      const fullPath = path.join(this.project.path, relPath);
      ensureDir(path.dirname(fullPath));
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    // Delete files created after this step
    const currentFiles = walkDir(this.project.path);
    for (const relPath of currentFiles) {
      if (!isTextFile(relPath)) continue;
      if (!(relPath in snapshot)) {
        try { fs.unlinkSync(path.join(this.project.path, relPath)); } catch {}
      }
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  async validate() {
    const errors = [];
    const { orchestration } = this;
    const nodes = orchestration.nodes || [];

    if (nodes.length < 1) {
      errors.push('La orquestación debe tener al menos 1 agente');
    }

    // Floating nodes (isRoot: false with no dependencies) are not connected to any flow
    const floatingNodes = nodes.filter(n => n.dependsOn.length === 0 && n.isRoot === false);
    for (const n of floatingNodes) {
      errors.push(`El nodo "${n.agentName}" está sin conectar — conéctalo al Orquestador o a otro nodo`);
    }

    // Only validate/execute connected nodes
    const connectedNodes = nodes.filter(n => !(n.dependsOn.length === 0 && n.isRoot === false));

    // Cycle detection via topological sort
    const levels = computeTopologicalLevels(connectedNodes);
    if (levels.reduce((s, l) => s + l.length, 0) !== connectedNodes.length) {
      errors.push('La orquestación contiene un ciclo — verifica las conexiones');
    }

    const nodeIds  = new Set(nodes.map(n => n.id));
    const allAgents = this._getAllAgents();

    for (const node of nodes) {
      if (scriptsRegistry.isScript(node.agentName)) {
        const scriptName = scriptsRegistry.getScriptName(node.agentName);
        if (!scriptsRegistry.hasScript(scriptName)) {
          errors.push(`Script no registrado: "${scriptName}"`);
        }
      } else if (!allAgents.find(a => a.name === node.agentName)) {
        errors.push(`Agente no encontrado: "${node.agentName}"`);
      }

      for (const depId of (node.dependsOn || [])) {
        if (!nodeIds.has(depId)) {
          errors.push(`Nodo "${node.agentName}": dependencia "${depId}" no existe`);
        }
      }

      for (const filePath of (node.contextExtra?.fixed?.files || [])) {
        const resolved = path.isAbsolute(filePath) ? filePath : path.join(this.project.path, filePath);
        if (!fs.existsSync(resolved)) {
          errors.push(`Nodo "${node.agentName}": archivo de contexto no existe: ${filePath}`);
        }
      }

      for (const temp of (node.contextExtra?.temporal || [])) {
        if (!temp.required) continue;
        const value = this.temporalContextValues[`${node.id}-${temp.id}`];
        const missing = value === undefined || value === null || String(value).trim() === '';
        if (missing) {
          const label = temp.label?.trim() || temp.id;
          errors.push(`Nodo "${node.agentName}": falta el campo requerido "${label}"`);
        }
      }
    }

    if (!fs.existsSync(this.project.path)) {
      errors.push(`La ruta del proyecto no existe: ${this.project.path}`);
    }

    const ec = orchestration.executionConfig || {};
    if (ec.timeout  && ec.timeout  < 5000)        errors.push('El timeout mínimo es 5 segundos');
    if (ec.maxTurns && (ec.maxTurns < 1 || ec.maxTurns > 100)) errors.push('maxTurns debe estar entre 1 y 100');

    const cfg      = readConfig();
    const provider = cfg.aiProvider || 'cli';
    if (!isNativeCLI(provider, cfg)) {
      const needsBrowser = nodes.some(node => {
        const a = allAgents.find(x => x.name === node.agentName);
        return Array.isArray(a?.tools) && a.tools.some(t => t.startsWith('browser_'));
      });
      if (needsBrowser) {
        const browserMod = require('./browser');
        if (!browserMod.isConnected()) {
          errors.push('El navegador CDP no está conectado. Conéctalo desde el panel de ejecución antes de validar.');
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Incremental execution state ──────────────────────────────────────────

  _writeExecutionState(nodeId, stepResult) {
    if (!this.execDir) return;
    const statePath = path.join(this.execDir, 'execution-state.json');
    const tmp       = statePath + '.tmp';
    const state = {
      executionId:       this.executionId,
      orchestrationId:   this.orchestration.id,
      projectId:         this.project.id,
      status:            'running',
      lastCompletedStep: stepResult.stepIndex,
      startedAt:         this._startedAt,
      steps: {
        ...(this._executionState?.steps || {}),
        [nodeId]: { status: stepResult.status, filesModified: stepResult.filesModified },
      },
    };
    this._executionState = state;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, statePath);
    } catch {}
  }

  _writeExecutionStateGatePaused(nodeId) {
    if (!this.execDir) return;
    const statePath = path.join(this.execDir, 'execution-state.json');
    const tmp       = statePath + '.tmp';
    const state = {
      ...(this._executionState || {}),
      status:         'paused_gate',
      pausedAtNodeId: nodeId,
      pauseStartedAt: new Date().toISOString(),
    };
    this._executionState = state;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, statePath);
    } catch {}
  }

  // ── Single-node execution ────────────────────────────────────────────────

  /**
   * Executes one DAG node (AI agent or deterministic script).
   * Returns { stepResult, agentOutput, budgetError? }.
   * Gates are NOT handled here — they are resolved at the level boundary in execute().
   */
  async _executeNode(node, agentOutputs, stepIndex, opts = {}) {
    const { gitAvailable, startTime, orchTimeout, orchestrationUsesBrowser } = opts;
    const { orchestration } = this;
    const { agentName }     = node;

    this.emit('step-start', { nodeId: node.id, stepIndex, agentName, totalSteps: orchestration.nodes.length });
    this._log('info', `━━ Nodo "${agentName}" [${node.id}] (paso ${stepIndex + 1}) ━━`);

    let snapshot;
    try {
      snapshot = await this._takeSnapshot(stepIndex);
    } catch (e) {
      this._log('warn', `Snapshot falló para "${agentName}": ${e.message}`);
    }

    const stepStart = Date.now();

    // ── Script determinístico ─────────────────────────────────────────────
    if (scriptsRegistry.isScript(agentName)) {
      const scriptName   = scriptsRegistry.getScriptName(agentName);
      const scriptParams = node.scriptParams ?? {};
      this._log('info', `Script determinístico "${scriptName}"`);
      this.emit('step-input', { nodeId: node.id, stepIndex, agentName, userMessage: '' });

      let stepResult;
      try {
        const scriptResult = await scriptsRegistry.run(scriptName, {
          projectPath:   this.project.path,
          orchestration: this.orchestration,
          stepIndex,
          prevResult:    agentOutputs[node.dependsOn[0]] ? { output: { response: agentOutputs[node.dependsOn[0]].response } } : null,
          agentOutputs,
          scriptParams,
        });
        stepResult = {
          stepIndex, nodeId: node.id, agentName,
          input:         { systemPrompt: '', userMessage: '' },
          output:        { response: scriptResult.output },
          filesModified: scriptResult.filesModified || [],
          tokensUsed:    { input: 0, output: 0 },
          estimatedCost: 0, costIsEstimated: false,
          duration:      Date.now() - stepStart,
          status:        'success',
          backupPath:    snapshot?.snapshotPath || null,
        };
        const agentOutput = { agentName, response: scriptResult.output, handoff: null, filesModified: stepResult.filesModified, estimatedCost: 0 };
        this.emit('step-done', stepResult);
        this._writeExecutionState(node.id, stepResult);
        return { stepResult, agentOutput };
      } catch (err) {
        this._log('error', `Script "${scriptName}" error: ${err.message}`);
        const isBudget = err.category === 'budget_exceeded';
        stepResult = {
          stepIndex, nodeId: node.id, agentName,
          input:  { systemPrompt: '', userMessage: '' },
          output: { response: '' },
          filesModified: [], tokensUsed: { input: 0, output: 0 },
          estimatedCost: 0, costIsEstimated: false,
          duration: Date.now() - stepStart, status: 'error',
          error: { message: err.message, category: err.category || 'script_error', recoverable: false, data: err.data },
          backupPath: snapshot?.snapshotPath || null,
        };
        this.emit('step-done', stepResult);
        this._writeExecutionState(node.id, stepResult);
        if (isBudget) {
          const cancelData = { executionId: this.executionId, reason: 'budget_exceeded', data: err.data };
          this._cancelledData = cancelData;
          this.emit('cancelled', cancelData);
          return { stepResult, agentOutput: null, budgetError: err };
        }
        return { stepResult, agentOutput: null };
      }
    }

    // ── Agente IA ─────────────────────────────────────────────────────────
    let userMessage = '';
    try {
      const systemPrompt = this._buildSystemPrompt(node);
      userMessage        = this._buildUserMessage(node, agentOutputs, stepIndex);
      this.emit('step-input', { nodeId: node.id, stepIndex, agentName, userMessage });
      this._log('info', `Invocando agente "${agentName}"…`);

      const cfg            = readConfig();
      const provider       = cfg.aiProvider || 'cli';
      const agent          = this._getAgent(agentName);
      const agentUsesBrowser = Array.isArray(agent?.tools) && agent.tools.some(t => t.startsWith('browser_'));
      const useNativeCLI   = isNativeCLI(provider, cfg);
      const hasConcreteTask = hasExecutableTaskInMessage(userMessage);

      // Native CLIs drive the browser themselves: launch it, let the user log in, pass the page state
      let browserContext = '';
      if (useNativeCLI && agentUsesBrowser) {
        try {
          const browser  = require('./browser');
          const status   = await browser.getStatus();
          if (!status.connected) {
            const installed = browser.listInstalledBrowsers();
            const preferred = installed.find(b => b.engine === 'chromium') || installed[0];
            if (preferred) await browser.launchBrowserWithCdp(preferred.key, status.cdpPort || 9222);
          }
        } catch (e) { this._log('warn', `No se pudo lanzar el navegador: ${e.message}`); }

        if (!this.cancelled) {
          this._log('info', `Esperando confirmación del usuario (autenticación en el navegador)…`);
          await this._pauseForBrowser(stepIndex, agentName);
        }
        if (this.cancelled) throw new Error('Ejecución cancelada');
        browserContext = await this._buildBrowserContext();
      }

      const runStep = (msg) => runInProject(this.project, {
        systemPrompt: systemPrompt + browserContext,
        userMessage: msg,
        includeContext: this._includesProjectContext(node),
        maxTurns:   orchestration.executionConfig?.maxTurns || 10,
        timeout:    Math.max(10_000, orchTimeout - (Date.now() - startTime)),
        model:      agent?.model,
        mcpServers: mcp.getServersForAgent(agent, this.project.id),
        useBrowser: orchestrationUsesBrowser,
        log:        (level, msg) => this._log(level, msg),
      });
      let run = await runStep(userMessage);
      let { inputTokens, outputTokens } = run;
      let stepCostUSD = run.costUSD;

      if (hasConcreteTask && looksLikeTaskRefusal(run.text)) {
        this._log('warn', `Rechazo de tarea detectado en "${agentName}"; reintentando con corrección obligatoria.`);
        run = await runStep(`${userMessage}\n\n## Correccion obligatoria del orquestador\nExiste una tarea concreta ya definida y debes ejecutarla ahora. No pidas aclaraciones ni repitas que falta tarea. Realiza la accion solicitada y entrega resultado util.`);
        inputTokens  += run.inputTokens;
        outputTokens += run.outputTokens;
        stepCostUSD  += run.costUSD;
      }
      const response = run.text;
      const { costUnavailable } = run;

      // Claude without reported usage: estimate from the response length at the agent model's price
      let costIsEstimated = false;
      if (!costUnavailable && stepCostUSD === 0 && response.trim().length > 0) {
        const outToks = Math.ceil(response.length / 4);
        stepCostUSD   = calcAnthropicCost(agent?.model || 'claude-sonnet-4-20250514', 0, outToks);
        costIsEstimated = true;
      }

      this._log('info', `Tokens entrada=${inputTokens} salida=${outputTokens}` +
        (costUnavailable ? ' coste no disponible'
          : stepCostUSD > 0 ? ` coste~$${stepCostUSD.toFixed(5)}${costIsEstimated ? ' (est.)' : ''}` : ''));

      const filesModified = snapshot ? await this._detectChanges(snapshot) : [];
      if (filesModified.length > 0) this._log('info', `${filesModified.length} archivo(s) modificado(s)`);
      else this._log('warn', `El paso no modifico archivos en disco`);

      const handoff      = extractHandoff(response);
      const cleanResponse = stripHandoff(response);
      if (handoff) this._log('info', `Handoff → ${handoff.done}`);

      const stepResult = {
        stepIndex, nodeId: node.id, agentName,
        input:         { systemPrompt: '', userMessage },
        output:        { response: cleanResponse, handoff: handoff || undefined },
        filesModified,
        tokensUsed:    { input: inputTokens, output: outputTokens },
        estimatedCost: stepCostUSD, costIsEstimated, costUnavailable,
        duration:      Date.now() - stepStart,
        status:        'success',
        backupPath:    snapshot?.snapshotPath || null,
        revisions:     this._revisionFeedback?.[node.id] || [],
      };

      const agentOutput = {
        agentName, response: cleanResponse, handoff, filesModified,
        estimatedCost: stepCostUSD, costIsEstimated, costUnavailable,
        tokensUsed: { input: inputTokens, output: outputTokens },
        model: agent?.model || null,
      };

      this.emit('step-done', stepResult);
      this._writeExecutionState(node.id, stepResult);

      // Quality score
      try {
        const qs = await scriptsRegistry.run('quality-score', {
          projectPath: this.project.path, orchestration: this.orchestration,
          stepIndex, prevResult: stepResult, agentOutputs,
        });
        stepResult.qualityScore = qs.data?.qualityScore || null;
        if (stepResult.qualityScore) this._log('info', `Quality score ${stepResult.qualityScore.score}/100`);
      } catch {}

      // validate-output
      if (orchestration.executionConfig?.validateAfterEachStep) {
        try {
          const validation = await scriptsRegistry.run('validate-output', {
            projectPath: this.project.path, orchestration: this.orchestration,
            stepIndex, prevResult: stepResult, agentOutputs,
          });
          if (validation.data && !validation.data.passed) {
            this._log('warn', `Validación post-escritura falló: ${JSON.stringify(validation.data.issues)}`);
            this.emit('step-warning', { nodeId: node.id, stepIndex, issues: validation.data.issues });
            stepResult.status = 'warning';
          }
        } catch {}
      }

      // Ops ledger
      if (filesModified.length > 0) {
        try {
          const now = new Date().toISOString();
          opsLedger.appendOps(this.project.path, this.orchestration.id, filesModified.map(filePath => ({
            id: `op-${crypto.randomBytes(4).toString('hex')}`,
            executionId: this.executionId, orchestrationId: this.orchestration.id,
            stepIndex, nodeId: node.id, agentName, kind: 'modify', filePath,
            status: 'applied', createdAt: now, appliedAt: now,
          })));
        } catch {}
      }

      // Git checkpoint
      if (gitAvailable) {
        try {
          const sha = await gitCheckpointer.checkpoint(
            this.project.path,
            `agenthub: ${agentName} [${node.id.slice(-6)}] [exec:${this.executionId.slice(-6)}]`,
          );
          if (sha) { stepResult.gitCommitSha = sha; this._log('info', `Git checkpoint → ${sha.slice(0, 7)}`); }
        } catch (e) { this._log('warn', `Git checkpoint falló: ${e.message}`); }
      }

      return { stepResult, agentOutput };

    } catch (err) {
      this._log('error', `Error en "${agentName}": ${err.message}`);
      const stepResult = {
        stepIndex, nodeId: node.id, agentName,
        input: { systemPrompt: '', userMessage },
        output: { response: '' },
        filesModified: [], tokensUsed: { input: 0, output: 0 },
        estimatedCost: 0, costIsEstimated: false,
        duration: Date.now() - stepStart, status: 'error',
        error: { message: err.message, category: categorizeError(err), recoverable: true },
        backupPath: snapshot?.snapshotPath || null,
      };
      this.emit('step-done', stepResult);
      this._writeExecutionState(node.id, stepResult);
      return { stepResult, agentOutput: null };
    }
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  async execute() {
    const cfg        = readConfig();
    const provider   = cfg.aiProvider || 'cli';
    const { orchestration } = this;
    // Filter out floating nodes (isRoot: false with no dependencies) — they are not part of any flow
    const nodes = (orchestration.nodes || []).filter(n => !(n.dependsOn.length === 0 && n.isRoot === false));

    // Create execution directory
    const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.execDir      = path.join(this.project.path, '.agent-hub', 'executions', `${timestamp}-${this.executionId.slice(-8)}`);
    ensureDir(this.execDir);

    const startedAt = new Date().toISOString();
    const metadata  = {
      executionId: this.executionId, orchestrationId: orchestration.id,
      projectId: this.project.id, startedAt, status: 'running',
      stepsCompleted: 0, totalSteps: nodes.length,
    };
    fs.writeFileSync(path.join(this.execDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    this._startedAt = startedAt;
    this._executionState = null;

    const gitAvailable = this.project.gitEnabled
      ? await gitCheckpointer.isGitRepo(this.project.path)
      : false;

    this.state = 'running';
    const levels = computeTopologicalLevels(nodes);
    this._log('info', `Orquestación iniciada: "${orchestration.name}"`);
    this._log('info', `Proveedor: ${provider} | Nodos: ${nodes.length} | Niveles: ${levels.length} | Max paralelo: ${Math.max(0, ...levels.map(l => l.length))}`);

    const orchTimeout  = orchestration.executionConfig?.timeout || 1_800_000;
    let   startTime    = Date.now();
    const agentOutputs = {};
    let   stepsCompleted = 0;

    const orchestrationUsesBrowser = !isNativeCLI(provider, cfg) && (() => {
      const all = this._getAllAgents();
      return nodes.some(n => {
        const a = all.find(x => x.name === n.agentName);
        return Array.isArray(a?.tools) && a.tools.some(t => t.startsWith('browser_'));
      });
    })();

    if (orchestrationUsesBrowser) {
      const browserMod = require('./browser');
      if (!browserMod.isConnected()) {
        const msg = 'El navegador CDP no está conectado. Conéctalo desde el panel de ejecución antes de iniciar.';
        this._log('error', msg);
        this.emit('error', { message: msg });
        return;
      }
      this._log('info', 'Navegador CDP conectado.');
    }

    let budgetExceededError = null;
    let stepCounter         = 0;

    for (const level of levels) {
      if (this.cancelled || budgetExceededError) break;

      const elapsed   = Date.now() - startTime;
      const remaining = orchTimeout - elapsed;
      if (remaining <= 5_000) {
        this._log('error', `Timeout global alcanzado (${Math.round(elapsed / 1000)}s)`);
        break;
      }

      const parallelLabel = level.length > 1 ? ` [${level.length} en paralelo]` : '';
      this._log('info', `▶ Nivel ${levels.indexOf(level) + 1}/${levels.length}${parallelLabel}: ${level.map(n => `"${n.agentName}"`).join(', ')}`);

      // Run all nodes in this level in parallel
      const levelSettled = await Promise.allSettled(
        level.map(node => this._executeNode(node, agentOutputs, stepCounter++, {
          gitAvailable, startTime, orchTimeout, orchestrationUsesBrowser,
        })),
      );

      for (const [idx, settled] of levelSettled.entries()) {
        if (settled.status === 'rejected') {
          const failedNode = level[idx];
          const message = settled.reason?.message || 'Error inesperado en nodo';
          this._log('error', `Nodo rechazado inesperadamente: ${message}`);

          const rejectedStep = {
            stepIndex:      Math.max(0, stepCounter - level.length + idx),
            nodeId:         failedNode?.id,
            agentName:      failedNode?.agentName || '(desconocido)',
            input:          { systemPrompt: '', userMessage: '' },
            output:         { response: '' },
            filesModified:  [],
            tokensUsed:     { input: 0, output: 0 },
            estimatedCost:  0,
            costIsEstimated:false,
            duration:       0,
            status:         'error',
            error:          { message, category: 'unexpected_rejection', recoverable: true },
            backupPath:     null,
          };

          this.results.push(rejectedStep);
          this.emit('step-done', rejectedStep);
          this._writeExecutionState(failedNode?.id || `rejected-${idx}`, rejectedStep);
          continue;
        }

        const { stepResult, agentOutput, budgetError } = settled.value;
        if (!stepResult) continue;

        this.results.push(stepResult);
        if (stepResult.status !== 'error') stepsCompleted++;
        if (agentOutput) agentOutputs[stepResult.nodeId] = agentOutput;
        if (budgetError) budgetExceededError = budgetError;
      }

      if (budgetExceededError) break;

      if (this.results.some(r => r.status === 'error')) {
        this._log('error', 'Deteniendo ejecución por error en un agente');
        break;
      }

      // ── Gates after this level ─────────────────────────────────────────────
      const hasSuccessors = (nodeId) => nodes.some(n => n.dependsOn.includes(nodeId));
      const gatedNodes    = level.filter(n => n.gateAfter && hasSuccessors(n.id));

      for (const gatedNode of gatedNodes) {
        if (this.cancelled) break;
        const nodeResult = this.results.find(r => r.nodeId === gatedNode.id);
        if (!nodeResult || nodeResult.status === 'error') continue;

        this._log('info', `Gate HITL: "${gatedNode.agentName}" — esperando decisión del operador`);
        const pauseStart = Date.now();
        this._writeExecutionStateGatePaused(gatedNode.id);
        this._pendingGate = { nodeId: gatedNode.id, agentName: gatedNode.agentName, executionId: this.executionId };
        this.emit('gate-open', this._pendingGate);

        let decision;
        try {
          decision = await _waitForGate(this.executionId, gatedNode.id);
        } catch {
          this._log('error', 'Gate cancelado');
          this._pendingGate = null;
          this.cancelled = true;
          break;
        }
        this._pendingGate = null;
        startTime += (Date.now() - pauseStart);
        this._log('info', `Gate "${gatedNode.agentName}": decisión = ${decision.action}`);

        if (decision.action === 'cancel') { this.cancelled = true; break; }

        if (decision.action === 'revise') {
          const feedback = decision.feedbackText || null;
          this._revisionFeedback = this._revisionFeedback || {};
          if (!this._revisionFeedback[gatedNode.id]) this._revisionFeedback[gatedNode.id] = [];
          this._revisionFeedback[gatedNode.id].push({
            at: new Date().toISOString(), feedback,
            previousFilesModified: nodeResult.filesModified || [],
          });

          try { await this.rollbackStep(nodeResult.stepIndex); } catch {}
          this.results.splice(this.results.indexOf(nodeResult), 1);
          stepsCompleted--;
          delete agentOutputs[gatedNode.id];

          const reResult = await this._executeNode(gatedNode, agentOutputs, nodeResult.stepIndex, {
            gitAvailable, startTime, orchTimeout, orchestrationUsesBrowser,
          });
          if (reResult.stepResult) {
            this.results.push(reResult.stepResult);
            if (reResult.stepResult.status !== 'error') stepsCompleted++;
            if (reResult.agentOutput) agentOutputs[gatedNode.id] = reResult.agentOutput;
            if (reResult.stepResult.status === 'error') {
              this._log('error', `Deteniendo ejecución por error al revisar "${gatedNode.agentName}"`);
              this.cancelled = true;
              break;
            }
          }
        }
        // approve → continue
      }

      if (this.results.some(r => r.status === 'error')) {
        this._log('error', 'Deteniendo ejecución por error en un agente');
        break;
      }
    }

    // Save agent outputs
    try {
      fs.writeFileSync(path.join(this.execDir, 'agent_outputs.json'), JSON.stringify(agentOutputs, null, 2), 'utf8');
    } catch {}

    const allFiles = new Set();
    for (const r of this.results) for (const f of (r.filesModified || [])) allFiles.add(f);

    const hasError = this.results.some(r => r.status === 'error');
    const status   = this.results.length === 0 ? 'failed'
      : hasError ? (stepsCompleted > 0 ? 'partial' : 'failed')
      : 'success';

    const completedAt      = new Date().toISOString();
    const totalIn          = this.results.reduce((s, r) => s + (r.tokensUsed?.input  || 0), 0);
    const totalOut         = this.results.reduce((s, r) => s + (r.tokensUsed?.output || 0), 0);
    const totalCost        = this.results.reduce((s, r) => s + (r.estimatedCost || 0), 0);
    const totalCostIsApprox = this.results.some(r => r.costIsEstimated || r.costUnavailable);

    const executionResult = {
      orchestrationId: orchestration.id, projectId: this.project.id,
      executionId: this.executionId, startedAt, completedAt,
      duration: Date.now() - startTime, status, stepsCompleted, totalSteps: nodes.length,
      totalTokensUsed: { input: totalIn, output: totalOut },
      estimatedCost: totalCost, estimatedCostIsApprox: totalCostIsApprox,
      results:  this.results,
      errors:   this.results.filter(r => r.status === 'error').map(r => r.error),
      summary:  { filesModified: allFiles.size, filesCreated: 0, filesDeleted: 0, linesAdded: 0, linesRemoved: 0 },
      changes:  [...allFiles].map(f => ({ path: f, status: 'modified' })),
      backups:  Object.fromEntries(this.results.map(r => [r.nodeId || r.stepIndex, r.backupPath])),
    };

    try {
      fs.writeFileSync(path.join(this.execDir, 'result.json'), JSON.stringify(executionResult, null, 2), 'utf8');
      metadata.status = status; metadata.stepsCompleted = stepsCompleted; metadata.completedAt = completedAt;
      fs.writeFileSync(path.join(this.execDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    } catch {}

    this.state = 'completed';
    this._completedResult = executionResult;
    this._log('info', `━━ Orquestación finalizada: ${status.toUpperCase()} ━━`);
    this.emit('completed', executionResult);
    return executionResult;
  }
}

// ── HITL Gate registry ────────────────────────────────────────────────────────

const _pendingGates = new Map(); // `${execId}-${nodeId}` → { resolve, reject }

function _waitForGate(executionId, nodeId) {
  return new Promise((resolve, reject) => {
    _pendingGates.set(`${executionId}-${nodeId}`, { resolve, reject });
  });
}

function resolveGate(executionId, nodeId, decision) {
  const key     = `${executionId}-${nodeId}`;
  const pending = _pendingGates.get(key);
  if (!pending) return false;
  _pendingGates.delete(key);
  pending.resolve(decision);
  return true;
}

// ── Active executor registry (for SSE) ───────────────────────────────────────

const _activeExecutors = new Map();

function registerExecutor(executor) {
  _activeExecutors.set(executor.executionId, executor);
  // Auto-cleanup after 2 hours
  setTimeout(() => _activeExecutors.delete(executor.executionId), 2 * 3600 * 1000);
}

function getExecutor(executionId) {
  return _activeExecutors.get(executionId) || null;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  OrchestrationExecutor,
  registerExecutor,
  getExecutor,
  resolveGate,
  extractHandoff,
  stripHandoff,
};
