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
const { callAI, callAIWithSubsystemCLI, callAIRich, calcAnthropicCost, GITHUB_GROUP_PROVIDERS } = require('./ai');
const prompts = require('./prompts');

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
      // Also resolve any pending browser pause so the loop can exit cleanly
      if (this._browserContinueFn) { this._browserContinueFn(); this._browserContinueFn = null; }
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

  _buildSystemPrompt(stepIndex) {
    const agentName  = this.orchestration.agents[stepIndex];
    const agent      = this._getAgent(agentName);
    const isLastStep = stepIndex === this.orchestration.agents.length - 1;
    let prompt       = agent?.system || `Eres el agente "${agentName}". Realiza las tareas relacionadas con tu especialidad.`;

    // Determine which node provides context into this step:
    // step 0 uses inputNode (Orquestador → Agent[0]), others use the previous inter-agent node.
    const inputNode  = this.orchestration.inputNode;
    const prevNode   = stepIndex === 0 ? inputNode : this.orchestration.nodes[stepIndex - 1];
    const prevDF     = prevNode?.dataFlow;

    // Project context: always for step 0 (unless inputNode disables it), or per dataFlow
    const includeContext = stepIndex === 0
      ? (prevDF ? prevDF.projectContext !== false : true)
      : (prevDF?.projectContext === true);

    if (includeContext) {
      const contextFile = this._getContextFile();
      if (contextFile) {
        const truncated = contextFile.length > MAX_CONTEXT_FILE_CHARS
          ? contextFile.slice(0, MAX_CONTEXT_FILE_CHARS) + '\n[CLAUDE.md truncado]'
          : contextFile;
        prompt += `\n\n# CONTEXTO DEL PROYECTO\n${truncated}`;
      }
    }

    // Fixed context from the node that feeds into this step
    const fc = prevNode?.contextExtra?.fixed;
    if (fc) {
      if (fc.freeText?.trim()) {
        prompt += `\n\n# CONTEXTO ADICIONAL\n${fc.freeText.trim()}`;
      }
      if (fc.files?.length > 0) {
        for (const filePath of fc.files) {
          try {
            const resolvedPath = require('path').isAbsolute(filePath)
              ? filePath
              : path.join(this.project.path, filePath);
            const content = fs.readFileSync(resolvedPath, 'utf8');
            const name = require('path').basename(filePath);
            const truncated = content.length > MAX_CONTEXT_FILE_CHARS
              ? content.slice(0, MAX_CONTEXT_FILE_CHARS) + '\n[Archivo truncado]'
              : content;
            prompt += `\n\n# ARCHIVO DE CONTEXTO (${name})\n${truncated}`;
          } catch {}
        }
      }
    }

    if (!isLastStep) prompt += prompts.agentHandoffInstruction();

    return prompt;
  }

  _buildUserMessage(stepIndex) {
    let message = '';

    if (stepIndex === 0) {
      // Step 0: use inputNode temporal contexts (user inputs at execution time)
      const inputNode = this.orchestration.inputNode;
      if (inputNode?.contextExtra?.temporal?.length > 0) {
        for (const temp of inputNode.contextExtra.temporal) {
          const tempKey   = `input-${temp.id}`;
          const tempValue = this.temporalContextValues[tempKey];
          if (tempValue) {
            message += `## ${temp.label || 'Entrada'}\n\n${tempValue}\n\n`;
          }
        }
      }

      const taskText  = inputNode?.contextExtra?.fixed?.freeText?.trim();
      const agentName = this.orchestration.agents[0];

      if (taskText) {
        message += `## Tarea\n\n${taskText}`;
      } else {
        message += `## Tarea\n\nEjecuta las acciones correspondientes a tu rol de "${agentName}" en este proyecto.` +
          ` Revisa el código, analiza los archivos relevantes y aplica los cambios necesarios según tu especialidad.`;
      }

    } else {
      const prevResult = this.results[stepIndex - 1];
      const prevNode   = this.orchestration.nodes[stepIndex - 1];

      if (prevNode?.dataFlow?.agentOutput && prevResult?.output?.response) {
        const fromAgent = this.orchestration.agents[stepIndex - 1];
        const handoff   = extractHandoff(prevResult.output.response);
        if (handoff) {
          message += prompts.formatHandoffAsInput(handoff, fromAgent) + '\n\n';
        } else {
          // Fallback: prose truncado mucho más corto que el límite anterior
          const raw = prevResult.output.response;
          const snippet = raw.length > 400 ? raw.slice(0, 400) + '\n[...]' : raw;
          message += `## Paso anterior: ${fromAgent}\n\n${snippet}\n\n`;
        }
      }

      if (prevNode?.dataFlow?.filesModified && prevResult?.filesModified?.length > 0) {
        message += `## Archivos modificados en el paso anterior\n\n`;
        message += prevResult.filesModified.map(f => `- ${f}`).join('\n');
        message += '\n\n';
      }

      // Temporal contexts from inter-agent node
      if (prevNode?.contextExtra?.temporal?.length > 0) {
        for (const temp of prevNode.contextExtra.temporal) {
          const tempKey   = `${stepIndex - 1}-${temp.id}`;
          const tempValue = this.temporalContextValues[tempKey];
          if (tempValue) {
            message += `## ${temp.label}\n\n${tempValue}\n\n`;
          }
        }
      }

      const agentName = this.orchestration.agents[stepIndex];
      message += `## Tarea\n\nEjecuta las acciones correspondientes a tu rol de "${agentName}" en este proyecto.` +
        ` Revisa el código, analiza los archivos relevantes y aplica los cambios necesarios según tu especialidad.`;
    }

    // Hard limit: use executionConfig.maxContextChars or default
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

    if (!orchestration.agents || orchestration.agents.length < 2) {
      errors.push('La orquestación debe tener al menos 2 agentes');
    }

    if (orchestration.nodes.length !== Math.max(0, orchestration.agents.length - 1)) {
      errors.push(`Se requieren ${orchestration.agents.length - 1} conexiones para ${orchestration.agents.length} agentes`);
    }

    const allAgents = this._getAllAgents();
    for (const agentName of (orchestration.agents || [])) {
      if (!allAgents.find(a => a.name === agentName)) {
        errors.push(`Agente no encontrado: "${agentName}"`);
      }
    }

    for (let i = 0; i < (orchestration.nodes || []).length; i++) {
      const node = orchestration.nodes[i];
      if (node.from !== i || node.to !== i + 1) {
        errors.push(`Conexión ${i}: índices inválidos (esperado from=${i}, to=${i + 1})`);
      }
      const df = node.dataFlow || {};
      if (!df.agentOutput && !df.filesModified && !df.projectContext) {
        errors.push(`Conexión ${i + 1}: debe transmitir al menos una información`);
      }
      if (node.contextExtra?.fixed?.files?.length > 0) {
        for (const filePath of node.contextExtra.fixed.files) {
          const resolvedPath = require('path').isAbsolute(filePath)
            ? filePath
            : path.join(this.project.path, filePath);
          if (!fs.existsSync(resolvedPath)) {
            errors.push(`Conexión ${i + 1}: archivo de contexto no existe: ${filePath}`);
          }
        }
      }
    }

    if (!fs.existsSync(this.project.path)) {
      errors.push(`La ruta del proyecto no existe: ${this.project.path}`);
    }

    const ec = orchestration.executionConfig || {};
    if (ec.timeout  && ec.timeout  < 5000)        errors.push('El timeout mínimo es 5 segundos');
    if (ec.maxTurns && (ec.maxTurns < 1 || ec.maxTurns > 100)) errors.push('maxTurns debe estar entre 1 y 100');

    return { valid: errors.length === 0, errors };
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  async execute() {
    const cfg      = readConfig();
    // Use the global AI provider — project.aiProvider is only for agent sync destinations,
    // not for which engine runs the orchestration.
    const provider = cfg.aiProvider || 'cli';
    const { orchestration } = this;

    // Create execution directory
    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const execDirName = `${timestamp}-${this.executionId.slice(-8)}`;
    ensureDir(path.join(this.project.path, '.agent-hub', 'executions'));
    this.execDir = path.join(this.project.path, '.agent-hub', 'executions', execDirName);
    ensureDir(this.execDir);

    const startedAt = new Date().toISOString();
    const metadata  = {
      executionId:     this.executionId,
      orchestrationId: orchestration.id,
      projectId:       this.project.id,
      startedAt,
      status:          'running',
      stepsCompleted:  0,
      totalSteps:      orchestration.agents.length,
    };
    fs.writeFileSync(path.join(this.execDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    this.state = 'running';
    this._log('info', `Orquestación iniciada: "${orchestration.name}"`);
    this._log('info', `Proveedor: ${provider} | Pasos: ${orchestration.agents.length}`);

    const orchTimeout  = orchestration.executionConfig?.timeout || 300_000;
    const startTime    = Date.now();
    const agentOutputs = {};
    let   stepsCompleted = 0;

    for (let i = 0; i < orchestration.agents.length; i++) {
      const agentName = orchestration.agents[i];
      this.currentStep = i;

      if (this.cancelled) break;

      // Check global orchestration timeout before starting each step
      const elapsed   = Date.now() - startTime;
      const remaining = orchTimeout - elapsed;
      if (remaining <= 5_000) {
        this._log('error', `Orquestación: timeout global alcanzado (${Math.round(elapsed / 1000)}s) antes del paso ${i + 1}`);
        break;
      }

      this._log('info', `━━ Paso ${i + 1}/${orchestration.agents.length}: "${agentName}" (${Math.round(remaining / 1000)}s restantes) ━━`);
      this.emit('step-start', { stepIndex: i, agentName, totalSteps: orchestration.agents.length });

      let snapshot;
      try {
        this._log('info', `Paso ${i + 1}: Creando snapshot del proyecto...`);
        snapshot = await this._takeSnapshot(i);
        this._log('info', `Paso ${i + 1}: Snapshot de ${snapshot.fileCount} archivos`);
      } catch (snapshotErr) {
        this._log('warn', `Paso ${i + 1}: No se pudo crear snapshot: ${snapshotErr.message}`);
      }

      const stepStart = Date.now();
      let stepResult;

      try {
        const systemPrompt = this._buildSystemPrompt(i);
        const userMessage  = this._buildUserMessage(i);

        // Emit the input so the frontend can display what each agent receives
        this.emit('step-input', { stepIndex: i, agentName, userMessage });

        this._log('info', `Paso ${i + 1}: Invocando agente "${agentName}"...`);

        let response     = '';
        let inputTokens  = 0;
        let outputTokens = 0;
        let stepCostUSD  = 0;

        // Calculate step timeout as whatever time is left for the whole orchestration
        const stepRemaining = Math.max(10_000, orchTimeout - (Date.now() - startTime));

        const CLI_NATIVE = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 'aider-cli', 'cline-cli', 'goose-cli'];
        const customProviders = readConfig().customProviders || [];
        const isCustomCLI = customProviders.some(p => p.id === provider && p.type === 'cli');

        const agent = this._getAgent(agentName);
        const agentUsesBrowser = Array.isArray(agent?.tools) && agent.tools.some(t => t.startsWith('browser_'));

        // Native CLIs use their own tool engine — routing them through SubsystemCLI
        // produces empty tool execution. SubsystemCLI browser_ tools only work with API providers.
        const useNativeCLI = CLI_NATIVE.includes(provider) || isCustomCLI;

        if (useNativeCLI) {
          let browserContext = '';
          if (agentUsesBrowser) {
            try {
              const browser = require('./browser');
              const status  = await browser.getStatus();
              if (!status.connected) {
                this._log('info', `Paso ${i + 1}: lanzando navegador CDP para el agente "${agentName}"…`);
                const installed = browser.listInstalledBrowsers();
                const preferred = installed.find(b => b.engine === 'chromium') || installed[0];
                if (preferred) {
                  await browser.launchBrowserWithCdp(preferred.key, status.cdpPort || 9222);
                } else {
                  this._log('warn', `Paso ${i + 1}: no se encontró ningún navegador instalado`);
                }
              }
            } catch (e) {
              this._log('warn', `Paso ${i + 1}: no se pudo lanzar el navegador: ${e.message}`);
            }

            if (!this.cancelled) {
              this._log('info', `Paso ${i + 1}: esperando confirmación del usuario (autenticación en el navegador)…`);
              await this._pauseForBrowser(i, agentName);
            }
            if (this.cancelled) break;

            browserContext = await this._buildBrowserContext();
            if (browserContext) {
              this._log('info', `Paso ${i + 1}: contexto CDP inyectado en el prompt`);
            }
          }

          const fullPrompt = `${systemPrompt}${browserContext}\n\n---\n\n${userMessage}`;
          const extraArgs = provider === 'cli'
            ? ['--dangerously-skip-permissions', '--max-turns', maxTurns]
            : [];
          const rich = await callAIRich(fullPrompt, {
            timeout:   stepRemaining,
            extraArgs,
            cwd: this.project.path,
          });
          response     = rich.text;
          inputTokens  = rich.inputTokens;
          outputTokens = rich.outputTokens;
          stepCostUSD  = rich.costUSD;
        } else {
          const contextFile = this._getContextFile();
          const cliResult   = await callAIWithSubsystemCLI(userMessage, agent?.system || '', {
            projectPath:    this.project.path,
            projectContext: contextFile,
            provider,
            maxTurns:       orchestration.executionConfig?.maxTurns  || 10,
            timeout:        stepRemaining,
            useBrowser:     agentUsesBrowser,
          });

          // MAX_TURNS_EXCEEDED / TIMEOUT_EXCEEDED with a partial response → treat as warning, not hard failure
          if (!cliResult.success && cliResult.error) {
            if (cliResult.finalResponse?.trim()) {
              this._log('warn', `Paso ${i + 1}: ${cliResult.error} — usando respuesta parcial disponible`);
            } else {
              throw new Error(cliResult.error);
            }
          }

          response     = cliResult.finalResponse || cliResult.result || '';
          inputTokens  = cliResult.tokens?.input  || 0;
          outputTokens = cliResult.tokens?.output || 0;

          // If subsystem-cli ran but produced no output, warn
          if (!response.trim()) {
            this._log('warn', `Paso ${i + 1}: el agente no produjo respuesta`);
          }

          // Estimate cost from token counts (api/github)
          stepCostUSD  = calcAnthropicCost('claude-sonnet-4-20250514', inputTokens, outputTokens);
        }

        this._log('info', `Paso ${i + 1}: tokens entrada=${inputTokens} salida=${outputTokens}` +
          (stepCostUSD > 0 ? ` coste~$${stepCostUSD.toFixed(5)}` : ''));

        const filesModified = snapshot ? await this._detectChanges(snapshot) : [];
        if (filesModified.length > 0) {
          this._log('info', `Paso ${i + 1}: ${filesModified.length} archivo(s) modificado(s)`);
        }

        // Guardar el handoff extraído en agentOutputs para trazabilidad,
        // pero limpiar la línea del response visible.
        const handoff = extractHandoff(response);
        if (handoff) {
          this._log('info', `Paso ${i + 1}: handoff → ${handoff.done}`);
        }
        const cleanResponse = stripHandoff(response);

        stepResult = {
          stepIndex:    i,
          agentName,
          input:        { systemPrompt: '', userMessage },
          output:       { response: cleanResponse, handoff: handoff || undefined },
          filesModified,
          tokensUsed:   { input: inputTokens, output: outputTokens },
          estimatedCost: stepCostUSD,
          duration:     Date.now() - stepStart,
          status:       'success',
          backupPath:   snapshot?.snapshotPath || null,
        };

        agentOutputs[i] = { response: cleanResponse, handoff, filesModified };
        this.results.push(stepResult);
        stepsCompleted++;
        this._log('info', `Paso ${i + 1}: Completado en ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
        this.emit('step-done', stepResult);

      } catch (err) {
        this._log('error', `Paso ${i + 1}: Error: ${err.message}`);

        stepResult = {
          stepIndex:    i,
          agentName,
          input:        { systemPrompt: '', userMessage },
          output:       { response: '' },
          filesModified: [],
          tokensUsed:   { input: 0, output: 0 },
          estimatedCost: 0,
          duration:     Date.now() - stepStart,
          status:       'error',
          error: {
            message:     err.message,
            category:    categorizeError(err),
            recoverable: true,
          },
          backupPath: snapshot?.snapshotPath || null,
        };

        this.results.push(stepResult);
        this.emit('step-done', stepResult);

        if (orchestration.executionConfig?.stopOnError !== false) {
          this._log('error', `Deteniendo ejecución (stopOnError=true)`);
          break;
        }
      }
    }

    // Save agent outputs
    try {
      fs.writeFileSync(
        path.join(this.execDir, 'agent_outputs.json'),
        JSON.stringify(agentOutputs, null, 2),
        'utf8',
      );
    } catch {}

    // Build summary
    const allFiles = new Set();
    for (const r of this.results) {
      for (const f of (r.filesModified || [])) allFiles.add(f);
    }

    const hasError = this.results.some(r => r.status === 'error');
    const status   = this.results.length === 0 ? 'failed'
      : hasError ? (stepsCompleted > 0 ? 'partial' : 'failed')
      : 'success';

    const completedAt = new Date().toISOString();

    const totalIn   = this.results.reduce((s, r) => s + (r.tokensUsed?.input  || 0), 0);
    const totalOut  = this.results.reduce((s, r) => s + (r.tokensUsed?.output || 0), 0);
    const totalCost = this.results.reduce((s, r) => s + (r.estimatedCost || 0), 0);

    const executionResult = {
      orchestrationId: orchestration.id,
      projectId:       this.project.id,
      executionId:     this.executionId,
      startedAt,
      completedAt,
      duration:        Date.now() - startTime,
      status,
      stepsCompleted,
      totalSteps:      orchestration.agents.length,
      totalTokensUsed: { input: totalIn, output: totalOut },
      estimatedCost:   totalCost,
      results:         this.results,
      errors:          this.results.filter(r => r.status === 'error').map(r => r.error),
      summary:         { filesModified: allFiles.size, filesCreated: 0, filesDeleted: 0, linesAdded: 0, linesRemoved: 0 },
      changes:         [...allFiles].map(f => ({ path: f, status: 'modified' })),
      backups:         Object.fromEntries(this.results.map(r => [r.stepIndex, r.backupPath])),
    };

    // Save result and update metadata
    try {
      fs.writeFileSync(path.join(this.execDir, 'result.json'), JSON.stringify(executionResult, null, 2), 'utf8');
      metadata.status         = status;
      metadata.stepsCompleted = stepsCompleted;
      metadata.completedAt    = completedAt;
      fs.writeFileSync(path.join(this.execDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    } catch {}

    this.state = 'completed';
    this._log('info', `━━ Orquestación finalizada: ${status.toUpperCase()} ━━`);
    this.emit('completed', executionResult);
    return executionResult;
  }
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
  // Exported for testing
  extractHandoff,
  stripHandoff,
};
