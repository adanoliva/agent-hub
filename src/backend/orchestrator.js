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
const { callAI, callAIWithSubsystemCLI, callAIRich, calcAnthropicCost, GITHUB_GROUP_PROVIDERS, CLI_PROVIDERS } = require('./ai');
const prompts           = require('./prompts');
const scriptsRegistry   = require('./scripts-registry');
const gitCheckpointer   = require('./git-checkpointer');
const opsLedger         = require('./ops-ledger');
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
    this.orchestration         = orchestration;
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

  _getContextFile() {
    // Use project.aiProvider to determine which context file format this project uses.
    // cfg.aiProvider is the execution engine and is irrelevant here.
    const projectProvider = this.project.aiProvider || 'claude';

    const candidates = projectProvider === 'github'
      ? [path.join(this.project.path, '.github', 'copilot-instructions.md')]
      : projectProvider === 'both'
        ? [
            path.join(this.project.path, 'CLAUDE.md'),
            path.join(this.project.path, '.claude', 'CLAUDE.md'),
            path.join(this.project.path, '.github', 'copilot-instructions.md'),
          ]
        : [
            path.join(this.project.path, 'CLAUDE.md'),
            path.join(this.project.path, '.claude', 'CLAUDE.md'),
          ];

    for (const fp of candidates) {
      if (fs.existsSync(fp)) {
        try { return fs.readFileSync(fp, 'utf8'); } catch {}
      }
    }
    return '';
  }

  // ── Prompt building ───────────────────────────────────────────────────────

  _buildSystemPrompt(node) {
    const { agentName } = node;
    const agent       = this._getAgent(agentName);
    // A node is "last" if no other node depends on it
    const isLastNode  = !this.orchestration.nodes.some(n => n.dependsOn.includes(node.id));
    const isRoot      = node.dependsOn.length === 0;

    let prompt = agent?.system ||
      `Eres el agente "${agentName}". Realiza las tareas relacionadas con tu especialidad.`;

    // Project context: root nodes include it by default; non-root only if explicitly requested
    const includeContext = isRoot
      ? (node.dataFlow?.projectContext !== false)
      : (node.dataFlow?.projectContext === true);

    if (includeContext) {
      const contextFile = this._getContextFile();
      if (contextFile) {
        const truncated = contextFile.length > MAX_CONTEXT_FILE_CHARS
          ? contextFile.slice(0, MAX_CONTEXT_FILE_CHARS) + '\n[CLAUDE.md truncado]'
          : contextFile;
        prompt += `\n\n# CONTEXTO DEL PROYECTO\n${truncated}`;
      }
    }

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

    // Skills injection
    if (agent?.skills?.length > 0) {
      try {
        const { listAllSkills } = require('./skills');
        const allSkills = listAllSkills();
        for (const skillName of agent.skills) {
          const skill = allSkills.find(s => s.name === skillName);
          if (skill?.content?.trim()) {
            prompt += `\n\n# SKILL: ${skill.name}\n${skill.content.trim()}`;
          }
        }
      } catch {}
    }

    if (!isLastNode) prompt += prompts.agentHandoffInstruction();
    return prompt;
  }

  _buildUserMessage(node, agentOutputs, stepIndex) {
    let message = '';
    const isRoot = node.dependsOn.length === 0;

    // Revision feedback (keyed by nodeId)
    const revisions = this._revisionFeedback?.[node.id];
    if (revisions?.length > 0) {
      const latest = revisions[revisions.length - 1];
      if (latest.feedback) {
        message += `## Feedback del operador (revisión ${revisions.length})\n\n${latest.feedback}\n\n`;
      }
    }

    if (isRoot) {
      // Root node: temporal inputs and optional task text from the node itself
      for (const temp of (node.contextExtra?.temporal || [])) {
        const val = this.temporalContextValues[`${node.id}-${temp.id}`];
        if (val) message += `## ${temp.label || 'Entrada'}\n\n${val}\n\n`;
      }
      const taskText = node.contextExtra?.fixed?.freeText?.trim();
      message += taskText
        ? `## Tarea\n\n${taskText}`
        : `## Tarea\n\nEjecuta las acciones correspondientes a tu rol de "${node.agentName}" en este proyecto.` +
          ` Revisa el código, analiza los archivos relevantes y aplica los cambios necesarios según tu especialidad.`;

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

    // Cycle detection via topological sort
    const levels = computeTopologicalLevels(nodes);
    if (levels.reduce((s, l) => s + l.length, 0) !== nodes.length) {
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
    }

    if (!fs.existsSync(this.project.path)) {
      errors.push(`La ruta del proyecto no existe: ${this.project.path}`);
    }

    const ec = orchestration.executionConfig || {};
    if (ec.timeout  && ec.timeout  < 5000)        errors.push('El timeout mínimo es 5 segundos');
    if (ec.maxTurns && (ec.maxTurns < 1 || ec.maxTurns > 100)) errors.push('maxTurns debe estar entre 1 y 100');

    const cfg      = readConfig();
    const provider = cfg.aiProvider || 'cli';
    if (!CLI_PROVIDERS.includes(provider)) {
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
    const { gitAvailable, startTime, orchTimeout, contextFile, orchestrationUsesBrowser } = opts;
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
      const CLI_NATIVE     = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 'aider-cli', 'cline-cli', 'goose-cli'];
      const isCustomCLI    = (cfg.customProviders || []).some(p => p.id === provider && p.type === 'cli');
      const useNativeCLI   = CLI_NATIVE.includes(provider) || isCustomCLI;
      const stepRemaining  = Math.max(10_000, orchTimeout - (Date.now() - startTime));

      let response = '', inputTokens = 0, outputTokens = 0, stepCostUSD = 0;

      // Resolve MCP servers for this agent
      const agentMcpServers = mcp.getServersForAgent(agent, this.project.id);
      const hasMcp = Object.keys(agentMcpServers).length > 0;
      if (hasMcp) {
        try { await mcp.spawnServers(Object.keys(agentMcpServers), this.project.id); }
        catch (e) { this._log('warn', `MCP spawn error: ${e.message}`); }
      }

      if (useNativeCLI) {
        let browserContext = '';
        if (agentUsesBrowser) {
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

        const fullPrompt = `${systemPrompt}${browserContext}\n\n---\n\n${userMessage}`;
        const extraArgs  = provider === 'cli'
          ? ['--dangerously-skip-permissions', '--max-turns', String(orchestration.executionConfig?.maxTurns || 10)]
          : [];
        const rich = await callAIRich(fullPrompt, { timeout: stepRemaining, extraArgs, cwd: this.project.path, mcpServers: agentMcpServers });
        response = rich.text; inputTokens = rich.inputTokens; outputTokens = rich.outputTokens; stepCostUSD = rich.costUSD;

      } else {
        const cliResult = await callAIWithSubsystemCLI(userMessage, agent?.system || '', {
          projectPath: this.project.path, projectContext: contextFile,
          provider, maxTurns: orchestration.executionConfig?.maxTurns || 10,
          timeout: stepRemaining, useBrowser: orchestrationUsesBrowser,
        });
        if (!cliResult.success && cliResult.error) {
          if (cliResult.finalResponse?.trim()) {
            this._log('warn', `${cliResult.error} — usando respuesta parcial`);
          } else throw new Error(cliResult.error);
        }
        response = cliResult.finalResponse || cliResult.result || '';
        inputTokens = cliResult.tokens?.input || 0; outputTokens = cliResult.tokens?.output || 0;
        stepCostUSD = calcAnthropicCost(agent?.model || 'claude-sonnet-4-20250514', inputTokens, outputTokens);
      }

      let costIsEstimated = false;
      if (stepCostUSD === 0 && response.trim().length > 0) {
        const outToks = Math.ceil(response.length / 4);
        stepCostUSD   = calcAnthropicCost(agent?.model || 'claude-sonnet-4-20250514', 0, outToks);
        costIsEstimated = true;
      }

      this._log('info', `Tokens entrada=${inputTokens} salida=${outputTokens}` +
        (stepCostUSD > 0 ? ` coste~$${stepCostUSD.toFixed(5)}${costIsEstimated ? ' (est.)' : ''}` : ''));

      const filesModified = snapshot ? await this._detectChanges(snapshot) : [];
      if (filesModified.length > 0) this._log('info', `${filesModified.length} archivo(s) modificado(s)`);

      const handoff      = extractHandoff(response);
      const cleanResponse = stripHandoff(response);
      if (handoff) this._log('info', `Handoff → ${handoff.done}`);

      const stepResult = {
        stepIndex, nodeId: node.id, agentName,
        input:         { systemPrompt: '', userMessage },
        output:        { response: cleanResponse, handoff: handoff || undefined },
        filesModified,
        tokensUsed:    { input: inputTokens, output: outputTokens },
        estimatedCost: stepCostUSD, costIsEstimated,
        duration:      Date.now() - stepStart,
        status:        'success',
        backupPath:    snapshot?.snapshotPath || null,
        revisions:     this._revisionFeedback?.[node.id] || [],
      };

      const agentOutput = {
        agentName, response: cleanResponse, handoff, filesModified,
        estimatedCost: stepCostUSD, costIsEstimated,
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
    const nodes      = orchestration.nodes || [];

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

    const contextFile = this._getContextFile();
    const orchestrationUsesBrowser = !CLI_PROVIDERS.includes(provider) && (() => {
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
          gitAvailable, startTime, orchTimeout, contextFile, orchestrationUsesBrowser,
        })),
      );

      for (const settled of levelSettled) {
        if (settled.status === 'rejected') {
          this._log('error', `Nodo rechazado inesperadamente: ${settled.reason?.message}`);
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

      if (
        this.results.some(r => r.status === 'error') &&
        orchestration.executionConfig?.stopOnError !== false
      ) {
        this._log('error', 'Deteniendo ejecución (stopOnError=true)');
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
            gitAvailable, startTime, orchTimeout, contextFile, orchestrationUsesBrowser,
          });
          if (reResult.stepResult) {
            this.results.push(reResult.stepResult);
            if (reResult.stepResult.status !== 'error') stepsCompleted++;
            if (reResult.agentOutput) agentOutputs[gatedNode.id] = reResult.agentOutput;
          }
        }
        // approve → continue
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
    const totalCostIsApprox = this.results.some(r => r.costIsEstimated);

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
