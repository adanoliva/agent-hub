/**
 * scripts-registry.js — Deterministic Node.js scripts for orchestrations.
 * No AI calls. Each script receives an execution context and returns a ScriptResult.
 */

const fs    = require('fs');
const path  = require('path');
const vm    = require('vm');
const { ensureDir, SCRIPTS_DIR, readConfig } = require('./config');

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkProject(projectPath, maxDepth = 5, depth = 0) {
  const excluded = new Set([
    '.git', 'node_modules', '.next', 'dist', 'build', 'coverage',
    '.agent-hub', '__pycache__', '.venv', 'venv', '.turbo', 'out', '.cache',
  ]);
  const results = [];
  if (depth > maxDepth) return results;
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const e of entries) {
      if (excluded.has(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue;
      const full = path.join(projectPath, e.name);
      if (e.isDirectory()) {
        results.push(...walkProject(full, maxDepth, depth + 1).map(r => ({
          ...r,
          path: e.name + '/' + r.path,
        })));
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(full);
          results.push({
            path:     e.name,
            size:     stat.size,
            ext:      path.extname(e.name).toLowerCase(),
            modified: stat.mtime.toISOString(),
          });
        } catch {}
      }
    }
  } catch {}
  return results;
}

function detectConventions(files) {
  const exts = files.map(f => f.ext);
  const names = files.map(f => f.path);
  const hasExt = (e) => exts.includes(e);
  const hasName = (n) => names.some(p => p.includes(n));

  let primaryLanguage = 'unknown';
  if (hasExt('.ts') || hasExt('.tsx'))      primaryLanguage = 'typescript';
  else if (hasExt('.js') || hasExt('.jsx')) primaryLanguage = 'javascript';
  else if (hasExt('.py'))                   primaryLanguage = 'python';
  else if (hasExt('.rs'))                   primaryLanguage = 'rust';
  else if (hasExt('.go'))                   primaryLanguage = 'go';
  else if (hasExt('.java'))                 primaryLanguage = 'java';

  const hasTests = hasName('.test.') || hasName('.spec.') || hasName('__tests__');
  let testPattern = null;
  if (hasExt('.ts') || hasExt('.tsx')) testPattern = '**/*.test.ts';
  else if (hasExt('.js'))              testPattern = '**/*.test.js';
  else if (hasExt('.py'))              testPattern = 'test_*.py';

  let framework = null;
  if (hasName('next.config'))           framework = 'next';
  else if (hasName('vite.config'))      framework = 'vite';
  else if (hasName('angular.json'))     framework = 'angular';
  else if (hasName('vue.config'))       framework = 'vue';
  else if (hasName('package.json') && (hasExt('.tsx') || hasExt('.jsx'))) framework = 'react';

  return { primaryLanguage, hasTests, testPattern, framework };
}

// ── Script implementations ────────────────────────────────────────────────────

const SCRIPTS = {

  'prepare-context': async ({ projectPath, orchestration }) => {
    const files = walkProject(projectPath);
    const conventions = detectConventions(files);
    const contextDir  = path.join(projectPath, '.agent-hub', 'context');
    ensureDir(contextDir);

    const canonical = {
      generatedAt:         new Date().toISOString(),
      projectFiles:        files.slice(0, 500),
      detectedConventions: conventions,
      orchestrationScope:  orchestration.agents || [],
      previousOutputs:     [],
    };

    const canonicalPath = path.join(contextDir, 'canonical.json');
    fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');

    const summary = [
      `Proyecto analizado: ${files.length} archivos detectados.`,
      `Lenguaje principal: ${conventions.primaryLanguage}`,
      conventions.framework ? `Framework: ${conventions.framework}` : '',
      conventions.hasTests   ? `Tests detectados (patrón: ${conventions.testPattern})` : 'Sin tests detectados',
      `Contexto canónico guardado en .agent-hub/context/canonical.json`,
    ].filter(Boolean).join('\n');

    return {
      output:        summary,
      filesModified: ['.agent-hub/context/canonical.json'],
      data:          canonical,
    };
  },

  'generate-file-index': async ({ projectPath }) => {
    const files = walkProject(projectPath);
    const index = {
      generatedAt: new Date().toISOString(),
      total:       files.length,
      files:       files.slice(0, 500),
      byExtension: files.reduce((acc, f) => {
        acc[f.ext || '(sin ext)'] = (acc[f.ext || '(sin ext)'] || 0) + 1;
        return acc;
      }, {}),
    };
    return {
      output:        JSON.stringify(index),
      filesModified: [],
      data:          index,
    };
  },

  'diff-since-step': async ({ projectPath, stepIndex, agentOutputs, context }) => {
    const sinceStep = context?.data?.sinceStep ?? stepIndex - 1;
    const prev      = agentOutputs[sinceStep];
    if (!prev) {
      return { output: 'No hay paso de referencia disponible.', filesModified: [], data: { changed: [] } };
    }
    const changed = prev.filesModified || [];
    return {
      output:        `Archivos modificados desde el paso ${sinceStep + 1}:\n${changed.map(f => `- ${f}`).join('\n') || '(ninguno)'}`,
      filesModified: [],
      data:          { changed },
    };
  },

  'validate-json': async ({ prevResult }) => {
    const resp = prevResult?.output?.response || '';
    const trimmed = resp.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return {
        output:        JSON.stringify({ valid: null, error: 'El output no parece ser JSON' }),
        filesModified: [],
        data:          { valid: null },
      };
    }
    try {
      JSON.parse(trimmed);
      return {
        output:        JSON.stringify({ valid: true }),
        filesModified: [],
        data:          { valid: true },
      };
    } catch (e) {
      return {
        output:        JSON.stringify({ valid: false, error: e.message }),
        filesModified: [],
        data:          { valid: false, error: e.message },
      };
    }
  },

  'quality-score': async ({ projectPath, prevResult, orchestration, stepIndex }) => {
    const resp          = prevResult?.output?.response || '';
    const filesModified = prevResult?.filesModified || [];
    const checks        = [];

    // Check 1: produced a response
    const hasResponse = resp.trim().length > 0;
    checks.push({ name: 'Agente produjo respuesta', passed: hasResponse });

    // Check 2: JSON valid if output looks like JSON
    let jsonValid = null;
    if (resp.trim().startsWith('{') || resp.trim().startsWith('[')) {
      try { JSON.parse(resp.trim()); jsonValid = true; }
      catch { jsonValid = false; }
      checks.push({ name: 'Output JSON válido', passed: jsonValid === true });
    }

    // Check 3: modified at least one file (only for non-script steps)
    const producedFiles = filesModified.length;
    const hadFileTask   = resp.toLowerCase().includes('creat') ||
                          resp.toLowerCase().includes('modif') ||
                          resp.toLowerCase().includes('escrib') ||
                          resp.toLowerCase().includes('write') ||
                          resp.toLowerCase().includes('updated');
    if (hadFileTask) {
      checks.push({ name: 'Modificó archivos', passed: producedFiles > 0, detail: `${producedFiles} archivo(s)` });
    }

    // Check 4: response is substantive (>100 chars)
    checks.push({ name: 'Respuesta sustancial', passed: resp.length > 100, detail: `${resp.length} caracteres` });

    const passed = checks.filter(c => c.passed).length;
    const total  = checks.length;
    const score  = Math.round((passed / total) * 100);
    const grade  = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';

    const qualityScore = {
      score,
      grade,
      filesProduced:  producedFiles,
      filesExpected:  hadFileTask ? 1 : 0,
      jsonValid,
      coverageRatio:  null,
      checks,
    };

    return {
      output:        JSON.stringify(qualityScore),
      filesModified: [],
      data:          { qualityScore },
    };
  },

  'budget-guard': async ({ agentOutputs, scriptParams }) => {
    const maxBudget = scriptParams?.maxBudgetUSD;
    if (maxBudget === undefined || maxBudget === null || maxBudget === '') {
      const err = new Error('budget-guard requiere el parámetro maxBudgetUSD');
      err.category = 'budget_config_error';
      throw err;
    }
    const limit = parseFloat(maxBudget);
    if (isNaN(limit) || limit <= 0) {
      const err = new Error(`budget-guard: maxBudgetUSD inválido (${maxBudget})`);
      err.category = 'budget_config_error';
      throw err;
    }
    const softLimit = !!scriptParams?.softLimit;

    const outputs = Object.values(agentOutputs);

    // Claude AI steps always carry estimatedCost > 0 (real or text-length fallback); costIsEstimated flags the fallback.
    // Non-Claude CLIs report costUnavailable with cost 0, so the guard undercounts them.
    let isEstimated = false;
    const spent = outputs.reduce((sum, r) => {
      if (r.costIsEstimated || r.costUnavailable) isEstimated = true;
      return sum + (r.estimatedCost ?? 0);
    }, 0);

    if (spent >= limit) {
      if (softLimit) {
        const approxNote = isEstimated ? ' (coste aproximado)' : '';
        return {
          output:        `⚠ budget-guard: $${spent.toFixed(4)} superan el límite de $${limit.toFixed(4)}${approxNote}. La orquestación continúa.`,
          filesModified: [],
          data:          { spent, limit, isEstimated, softLimit, limitExceeded: true },
        };
      }
      const approxNote = isEstimated ? ' (coste aproximado)' : '';
      const err = new Error(
        `Presupuesto agotado: $${spent.toFixed(4)} gastado de $${limit.toFixed(4)} permitidos${approxNote}`
      );
      err.category = 'budget_exceeded';
      err.data = { spent, limit, isEstimated };
      throw err;
    }

    const note = isEstimated ? ' (estimado)' : '';
    return {
      output:        `Presupuesto OK: $${spent.toFixed(4)}${note} de $${limit.toFixed(4)} (${((spent / limit) * 100).toFixed(1)}% usado)`,
      filesModified: [],
      data:          { spent, limit, remaining: limit - spent, isEstimated, softLimit },
    };
  },

  'validate-output': async ({ prevResult }) => {
    const issues = [];
    const resp   = prevResult?.output?.response || '';

    if (resp.trim().startsWith('{') || resp.trim().startsWith('[')) {
      try { JSON.parse(resp); }
      catch (e) { issues.push({ rule: 'json-valid', message: `Output no parsea como JSON: ${e.message}` }); }
    }

    return {
      output:        JSON.stringify({ passed: issues.length === 0, issues }),
      filesModified: [],
      data:          { passed: issues.length === 0, issues },
    };
  },
};

// ── External scripts ──────────────────────────────────────────────────────────

const MAX_TIMEOUT_MS = 300_000; // 5 minutes hard cap

/** In-memory registry for external scripts loaded from SCRIPTS_DIR */
let EXTERNAL_SCRIPTS = {};

/**
 * Builds the sandboxed context object exposed to external scripts.
 * fs operations are restricted to projectPath.
 */
function buildSandbox(context, consoleLogs) {
  const { projectPath } = context;

  function assertSafe(relPath) {
    const resolved = path.resolve(projectPath, relPath);
    if (!resolved.startsWith(path.resolve(projectPath))) {
      throw new Error('ruta fuera del proyecto');
    }
    return resolved;
  }

  const safeFsApi = {
    readFile:  async (relPath) => fs.promises.readFile(assertSafe(relPath), 'utf8'),
    writeFile: async (relPath, data) => {
      const abs = assertSafe(relPath);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      return fs.promises.writeFile(abs, data, 'utf8');
    },
    exists:    async (relPath) => { try { await fs.promises.access(assertSafe(relPath)); return true; } catch { return false; } },
    listDir:   async (relPath) => fs.promises.readdir(assertSafe(relPath)),
    readJSON:  async (relPath) => JSON.parse(await fs.promises.readFile(assertSafe(relPath), 'utf8')),
    writeJSON: async (relPath, data) => {
      const abs = assertSafe(relPath);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      return fs.promises.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
    },
  };

  const sandboxConsole = {
    log:   (...args) => consoleLogs.push({ level: 'log',   msg: args.join(' ') }),
    error: (...args) => consoleLogs.push({ level: 'error', msg: args.join(' ') }),
  };

  return {
    ...context,
    fs:      safeFsApi,
    path:    path,
    JSON,
    Math,
    Date,
    Array,
    Object,
    Promise,
    console: sandboxConsole,
    setTimeout,
    clearTimeout,
    // Ensure dangerous globals are absent
    require:       undefined,
    process:       undefined,
    global:        undefined,
    eval:          undefined,
    Function:      undefined,
  };
}

/**
 * Runs external script code inside a node:vm sandbox.
 * The script file must export `run` as an async function via module.exports.
 */
async function runInSandbox(scriptMeta, context, timeout) {
  const consoleLogs = [];
  const sandbox = buildSandbox({ ...context, scriptName: scriptMeta.name }, consoleLogs);
  vm.createContext(sandbox);

  // Wrap the CommonJS exports pattern: execute the file code, then call run
  const fileCode  = fs.readFileSync(scriptMeta.filePath, 'utf8');
  const wrapCode  = `
    const exports = {};
    (function(exports) { ${fileCode} })(exports);
    exports.run(__ctx__);
  `;

  // Inject context under a name that won't collide with script variables
  sandbox.__ctx__ = context;
  // Restore safe fs and path after __ctx__ assignment (sandbox already has them)
  sandbox.__ctx__.fs   = sandbox.fs;
  sandbox.__ctx__.path = sandbox.path;

  const script  = new vm.Script(wrapCode, { filename: scriptMeta.name + '.js' });
  const promise = script.runInContext(sandbox, { timeout });

  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
  ]).then(result => ({ result, consoleLogs }));
}

/**
 * Validates a single external script file without executing run().
 * Returns { status: 'ok'|'warn'|'error', issues: [] }
 */
function validateScriptFile(filePath, name) {
  const issues = [];

  // Check for built-in name conflict
  if (Object.prototype.hasOwnProperty.call(SCRIPTS, name)) {
    issues.push({ severity: 'error', code: 'NAME_CONFLICT', message: `El nombre '${name}' está reservado por un script built-in.` });
    return { status: 'error', issues };
  }

  // Syntax check
  let exports_ = {};
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    // Use Function constructor just for syntax validation, not execution
    new vm.Script(code, { filename: name + '.js' });
    // Attempt a real require to get exports
    // We delete from require cache to ensure fresh load
    delete require.cache[require.resolve(filePath)];
    exports_ = require(filePath);
  } catch (e) {
    issues.push({ severity: 'error', code: 'SYNTAX_ERROR', message: e.message });
    return { status: 'error', issues };
  }

  if (!exports_.label) {
    issues.push({ severity: 'error', code: 'MISSING_LABEL', message: 'exports.label no existe o no es string.' });
  } else if (exports_.label === '') {
    issues.push({ severity: 'warn', code: 'LABEL_EMPTY', message: 'exports.label es un string vacío.' });
  }

  if (!exports_.description) {
    issues.push({ severity: 'error', code: 'MISSING_DESCRIPTION', message: 'exports.description no existe o no es string.' });
  } else if (exports_.description === '') {
    issues.push({ severity: 'warn', code: 'DESCRIPTION_EMPTY', message: 'exports.description es un string vacío.' });
  }

  if (!('run' in exports_)) {
    issues.push({ severity: 'error', code: 'MISSING_RUN', message: 'exports.run no existe.' });
  } else if (typeof exports_.run !== 'function') {
    issues.push({ severity: 'error', code: 'RUN_NOT_FUNCTION', message: 'exports.run existe pero no es una función.' });
  }

  if ('timeout' in exports_) {
    if (typeof exports_.timeout !== 'number') {
      issues.push({ severity: 'warn', code: 'TIMEOUT_NOT_NUMBER', message: 'exports.timeout existe pero no es un número.' });
    } else if (exports_.timeout > MAX_TIMEOUT_MS) {
      issues.push({ severity: 'warn', code: 'TIMEOUT_HIGH', message: `exports.timeout (${exports_.timeout}) supera el máximo permitido (${MAX_TIMEOUT_MS}). Se usará ${MAX_TIMEOUT_MS} ms.` });
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarns  = issues.some(i => i.severity === 'warn');
  return { status: hasErrors ? 'error' : hasWarns ? 'warn' : 'ok', issues };
}

/**
 * Scans SCRIPTS_DIR for .js files, validates and loads them.
 * Called at server start and on GET /scripts for hot-reload.
 * Returns { loaded, errors, warnings }
 */
function loadExternalScripts() {
  EXTERNAL_SCRIPTS = {};
  const warnings = [];
  const errors   = [];

  if (!fs.existsSync(SCRIPTS_DIR)) return { loaded: 0, errors, warnings };

  const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const name     = path.basename(file, '.js');
    const filePath = path.join(SCRIPTS_DIR, file);

    if (Object.prototype.hasOwnProperty.call(SCRIPTS, name)) {
      const msg = `Script externo '${name}' ignorado: colisiona con un built-in.`;
      warnings.push(msg);
      console.warn('[scripts-registry]', msg);
      continue;
    }

    try {
      delete require.cache[require.resolve(filePath)];
      const mod = require(filePath);

      if (!mod.label || typeof mod.label !== 'string') { errors.push(`${name}: MISSING_LABEL`); continue; }
      if (!mod.description || typeof mod.description !== 'string') { errors.push(`${name}: MISSING_DESCRIPTION`); continue; }
      if (typeof mod.run !== 'function') { errors.push(`${name}: MISSING_RUN`); continue; }

      const timeout = typeof mod.timeout === 'number'
        ? Math.min(mod.timeout, MAX_TIMEOUT_MS)
        : null; // null → use global config default

      EXTERNAL_SCRIPTS[name] = { name, label: mod.label, description: mod.description, run: mod.run, timeout, filePath };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.error('[scripts-registry] Error cargando script externo:', name, e.message);
    }
  }

  return { loaded: Object.keys(EXTERNAL_SCRIPTS).length, errors, warnings };
}

/**
 * Validates all external scripts without executing them.
 * Returns full report for GET /api/scripts/validate
 */
function validateExternalScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    return { validatedAt: new Date().toISOString(), summary: { ok: 0, warn: 0, error: 0 }, results: [] };
  }

  const files   = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'));
  const results = [];

  for (const file of files) {
    const name     = path.basename(file, '.js');
    const filePath = path.join(SCRIPTS_DIR, file);
    const { status, issues } = validateScriptFile(filePath, name);
    results.push({ file, name, status, issues });
  }

  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, { ok: 0, warn: 0, error: 0 });
  return { validatedAt: new Date().toISOString(), summary, results };
}

// ── Public API ────────────────────────────────────────────────────────────────

function isScript(agentName) {
  return typeof agentName === 'string' && agentName.startsWith('__script:');
}

function getScriptName(agentName) {
  return agentName.replace(/^__script:/, '').replace(/__$/, '');
}

function hasScript(scriptName) {
  return Object.prototype.hasOwnProperty.call(SCRIPTS, scriptName)
    || Object.prototype.hasOwnProperty.call(EXTERNAL_SCRIPTS, scriptName);
}

async function run(scriptName, context) {
  // Built-in scripts run directly
  const builtinFn = SCRIPTS[scriptName];
  if (builtinFn) return builtinFn(context);

  // External scripts run in sandbox
  const ext = EXTERNAL_SCRIPTS[scriptName];
  if (!ext) throw new Error(`Script desconocido: "${scriptName}"`);

  const cfg     = readConfig();
  const timeout = ext.timeout ?? Math.min(cfg.externalScriptsTimeoutMs ?? 60000, MAX_TIMEOUT_MS);

  const { result, consoleLogs } = await runInSandbox(ext, context, timeout);

  if (consoleLogs.length > 0) {
    consoleLogs.forEach(({ level, msg }) => console[level](`[script:${scriptName}]`, msg));
  }

  return result;
}

function listScripts() {
  const { warnings } = loadExternalScripts();

  const builtins = [
    { name: 'prepare-context',    label: 'Preparar contexto',        description: 'Analiza el proyecto y genera el índice canónico de archivos y convenciones.',   builtin: true },
    { name: 'generate-file-index', label: 'Índice de archivos',      description: 'Lista estructurada de todos los archivos del proyecto con estadísticas.',       builtin: true },
    { name: 'diff-since-step',    label: 'Diff desde paso anterior', description: 'Compara el estado del filesystem con el de un paso anterior.',                   builtin: true },
    { name: 'validate-json',      label: 'Validar JSON',             description: 'Verifica que el output del paso anterior es JSON válido.',                       builtin: true },
    { name: 'quality-score',      label: 'Quality Score',            description: 'Calcula una puntuación de calidad del paso anterior sin usar IA.',               builtin: true },
    { name: 'validate-output',    label: 'Validar output',           description: 'Valida el output del paso anterior según reglas configurables.',                 builtin: true },
    {
      name:        'budget-guard',
      label:       'Control de presupuesto',
      description: 'Detiene la orquestación si el coste acumulado supera el límite configurado.',
      builtin:     true,
      params: [
        { key: 'maxBudgetUSD', label: 'Presupuesto máximo ($)', type: 'number', required: true, placeholder: '0.05' },
        { key: 'softLimit', label: 'No parar si se supera el presupuesto (mostrar aviso)', type: 'boolean', required: false, hint: 'La orquestación continuará aunque se supere el límite.' },
      ],
    },
  ];

  const externals = Object.values(EXTERNAL_SCRIPTS).map(s => ({
    name:        s.name,
    label:       s.label,
    description: s.description,
    builtin:     false,
    hasWarnings: false, // resolved at load time; warn scripts are still loaded
  }));

  return { scripts: [...builtins, ...externals], warnings };
}

module.exports = { isScript, getScriptName, hasScript, run, listScripts, loadExternalScripts, validateExternalScripts };
