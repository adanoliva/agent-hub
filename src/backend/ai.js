/**
 * ai.js — AI integration layer
 *
 * Supports two providers:
 *   'cli' — calls the Claude Code CLI (`claude --print`) via stdin pipe
 *   'api' — calls the Anthropic API via @anthropic-ai/sdk
 *
 * Features:
 *   - generateAgentPrompt(): full system prompt from a brief description
 *   - generateSuggestions(): 2-4 contextual agent suggestions for a level
 *   - Suggestion cache: one call per level, "Suggest more" replaces cache
 *   - Provider status check
 */

const { execFile } = require('child_process');
const spawn = require('cross-spawn');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { readConfig, CACHE_DIR, ensureDir } = require('./config');
const prompts = require('./prompts');

const CALL_TIMEOUT_MS = 60_000; // 60s max for AI calls
const MODEL           = 'claude-sonnet-4-20250514';

// ── Usage tracker ─────────────────────────────────────────────────────────────
// cumulative: persisted to disk, resets when AI provider changes
// session:    in-memory only, resets on app restart or manual reset

const USAGE_FILE = path.join(CACHE_DIR, 'ai-usage.json');

function _emptyEntry() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0, since: new Date().toISOString() };
}

function loadCumulative() {
  ensureDir(CACHE_DIR);
  if (!fs.existsSync(USAGE_FILE)) return _emptyEntry();
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); }
  catch { return _emptyEntry(); }
}

function saveCumulative(u) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2), 'utf8');
}

const cumulative = loadCumulative();
const session    = _emptyEntry();

function trackUsage({ inputTokens = 0, outputTokens = 0, costUSD = 0 } = {}) {
  for (const u of [cumulative, session]) {
    u.calls            += 1;
    u.inputTokens      += inputTokens;
    u.outputTokens     += outputTokens;
    u.estimatedCostUSD += costUSD;
  }

  saveCumulative(cumulative);
}

function getSessionUsage() {
  return { cumulative: { ...cumulative }, session: { ...session } };
}

function resetSessionUsage() {
  // Only resets the in-memory session; cumulative is untouched
  Object.assign(session, _emptyEntry());
}

function resetAllUsage() {
  // Resets both (called on provider change)
  Object.assign(cumulative, _emptyEntry());
  Object.assign(session,    _emptyEntry());
  saveCumulative(cumulative);
}

// Anthropic pricing per 1M tokens (first-party API, checked 2026-10)
const ANTHROPIC_PRICING = {
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00  },
  'claude-haiku-4-5-20251001':   { input: 1.00,  output: 5.00   },
  'claude-opus-4-20250514':      { input: 15.00, output: 75.00  },
  'claude-fable-5-1':            { input: 10.00, output: 50.00  },
  'claude-opus-5-5':             { input: 4.00,  output: 20.00  },
  'claude-opus-5':               { input: 5.00,  output: 25.00  },
  'claude-opus-4-8':             { input: 5.00,  output: 25.00  },
  'claude-sonnet-5-5':           { input: 2.00,  output: 10.00  },
  'claude-sonnet-5':             { input: 2.00,  output: 10.00  },
  'claude-sonnet-4-6':           { input: 3.00,  output: 15.00  },
  'claude-haiku-5-5':            { input: 0.10,  output: 0.50   },
  'claude-haiku-4-5':            { input: 1.00,  output: 5.00   },
};

// Prompt cache: writes cost 1.25× the input price, reads 0.1×
function calcAnthropicCost(model, inputTokens, outputTokens, cacheWriteTokens = 0, cacheReadTokens = 0) {
  const pricing = ANTHROPIC_PRICING[model] || ANTHROPIC_PRICING[MODEL];
  const input = inputTokens + cacheWriteTokens * 1.25 + cacheReadTokens * 0.1;
  return (input * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// The Subsystem CLI resends the system prompt and the whole conversation every turn. Two cache breakpoints
// (end of the system prompt, end of the latest message) let each turn read the previous turn's prefix from
// cache. Prefixes under the model's minimum (~1–4k tokens) just aren't cached.
function withPromptCache(params) {
  const cache = { type: 'ephemeral' };
  if (params.system) params.system = [{ type: 'text', text: params.system, cache_control: cache }];
  const last = params.messages[params.messages.length - 1];
  const blocks = !last ? [] : typeof last.content === 'string'
    ? (last.content ? [{ type: 'text', text: last.content }] : [])
    : [...last.content];
  if (blocks.length) {
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: cache };
    params.messages = [...params.messages.slice(0, -1), { ...last, content: blocks }];
  }
  return params;
}

// ── Provider detection ────────────────────────────────────────────────────────

// Native CLIs verified end to end. `contextFiles`: instruction files each one loads by itself from its cwd
// (checked with each CLI), so the project context is not pasted into the prompt again when one exists.
// `readOnly`: the CLI can be forbidden to write. agy can't (its plan mode still edits files), so read-only
// work never gives it the project folder.
const CLI_ADAPTERS = {
  'cli':             { bin: 'claude',  readOnly: true,  contextFiles: ['AGENTS.md', 'CLAUDE.md'] },
  'copilot-cli':     { bin: 'copilot', readOnly: true,  contextFiles: ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md', 'GEMINI.md'] },
  'antigravity-cli': { bin: 'agy',     readOnly: false, contextFiles: ['AGENTS.md', 'GEMINI.md'] },
};
const CLI_PROVIDERS = Object.keys(CLI_ADAPTERS);
const API_PROVIDERS          = ['api', 'openai', 'github', 'gemini-api', 'mistral', 'grok', 'deepseek', 'groq', 'openrouter', 'perplexity'];
const GITHUB_GROUP_PROVIDERS = new Set(['github', 'copilot-cli']);

function whichBin(bin) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [bin], (err, stdout) => {
      const lines = String(stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (err || !lines.length) return resolve({ found: false, path: null });
      if (process.platform !== 'win32') return resolve({ found: true, path: lines[0] });

      // `where` also lists the extensionless POSIX shim npm installs next to the .cmd
      const direct = lines.find(p => ['.exe', '.cmd', '.bat'].includes(path.extname(p).toLowerCase()));
      if (direct) return resolve({ found: true, path: direct });
      const cmdSibling = lines.find(p => !path.extname(p) && fs.existsSync(`${p}.cmd`));
      resolve({ found: true, path: cmdSibling ? `${cmdSibling}.cmd` : lines[0] });
    });
  });
}

async function checkAllCLIs() {
  const checks = await Promise.all(CLI_PROVIDERS.map(p => whichBin(CLI_ADAPTERS[p].bin)));
  return Object.fromEntries(CLI_PROVIDERS.map((p, i) => [p, checks[i]]));
}

async function getProviderStatus() {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';
  const cliChecks = await checkAllCLIs();

  if (CLI_PROVIDERS.includes(provider)) {
    const check = cliChecks[provider] || { found: false };
    return { provider, ready: check.found, cliChecks };
  }

  // Built-in API providers — check credential
  const credMap = {
    'api':        cfg.apiKey,
    'openai':     cfg.openaiKey,
    'github':     cfg.githubToken,
    'gemini-api': cfg.geminiApiKey,
    'mistral':    cfg.mistralKey,
    'grok':       cfg.grokKey,
    'deepseek':   cfg.deepseekKey,
    'groq':       cfg.groqKey,
    'openrouter': cfg.openrouterKey,
    'perplexity': cfg.perplexityKey,
  };

  if (credMap[provider] !== undefined) {
    const cred  = credMap[provider] ?? '';
    const ready = Boolean(cred && cred.trim());
    return { provider, ready, cliChecks };
  }

  // Custom providers
  const custom = (cfg.customProviders || []).find(p => p.id === provider);
  if (custom) {
    if (custom.type === 'api') {
      const ready = Boolean(custom.apiKey && custom.apiKey.trim());
      return { provider, ready, cliChecks };
    } else {
      const check = await whichBin(custom.cliBin);
      return { provider, ready: check.found, cliChecks };
    }
  }

  return { provider, ready: false, cliChecks };
}

// ── Core AI call ──────────────────────────────────────────────────────────────

/**
 * Sends a prompt to the configured AI provider and returns the text response.
 * Uses stdin piping for CLI (avoids shell escaping issues on Windows).
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string>}
 */
function _getCustomProviderConfig(cfg, provider) {
  const custom = (cfg.customProviders || []).find(p => p.id === provider);
  if (!custom || custom.type !== 'api') return null;
  return {
    baseUrl: custom.baseUrl,
    key:     custom.apiKey,
    model:   custom.model,
    headers: custom.headers || {},
  };
}

async function callAI(prompt, opts = {}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';

  // Check custom providers first
  const customCfg = _getCustomProviderConfig(cfg, provider);
  if (customCfg) {
    return callOpenAICompat(prompt, null, customCfg, opts);
  }

  if (isNativeCLI(provider, cfg)) return (await callNativeCLI(provider, prompt, opts)).text;

  switch (provider) {
    case 'api':         return callAPI(prompt, cfg.apiKey, opts);
    case 'openai':      return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.openai.com/v1',
                          key:     cfg.openaiKey,
                          model:   cfg.openaiModel ?? 'gpt-4o-mini',
                        }, opts);
    case 'github':      return callOpenAICompat(prompt, null, {
                          baseUrl: GITHUB_MODELS_BASE,
                          key:     cfg.githubToken,
                          model:   cfg.githubModel ?? GITHUB_MODELS_DEFAULT,
                        }, opts);
    case 'gemini-api':  return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                          key:     cfg.geminiApiKey,
                          model:   cfg.geminiApiModel ?? 'gemini-2.5-flash',
                        }, opts);
    case 'mistral':     return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.mistral.ai/v1',
                          key:     cfg.mistralKey,
                          model:   cfg.mistralModel ?? 'mistral-small-latest',
                        }, opts);
    case 'grok':        return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.x.ai/v1',
                          key:     cfg.grokKey,
                          model:   cfg.grokModel ?? 'grok-3-mini',
                        }, opts);
    case 'deepseek':    return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.deepseek.com',
                          key:     cfg.deepseekKey,
                          model:   cfg.deepseekModel ?? 'deepseek-chat',
                        }, opts);
    case 'groq':        return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.groq.com/openai/v1',
                          key:     cfg.groqKey,
                          model:   cfg.groqModel ?? 'llama-3.3-70b-versatile',
                        }, opts);
    case 'openrouter':  return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://openrouter.ai/api/v1',
                          key:     cfg.openrouterKey,
                          model:   cfg.openrouterModel ?? 'anthropic/claude-3.5-sonnet',
                        }, opts);
    case 'perplexity':  return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.perplexity.ai',
                          key:     cfg.perplexityKey,
                          model:   cfg.perplexityModel ?? 'sonar-reasoning-pro',
                        }, opts);
    default: throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ── Native CLI backends ───────────────────────────────────────────────────────
// mode 'agent': edits files and runs commands · 'read': reads the project, never writes · 'text': plain
// answer. Without cwd the CLI runs in a neutral folder, so it never loads or touches Agent Hub's own files.

const NEUTRAL_CWD = path.join(os.tmpdir(), 'agent-hub-ai');

function isNativeCLI(provider, cfg = readConfig()) {
  return !!CLI_ADAPTERS[provider] || (cfg.customProviders || []).some(p => p.id === provider && p.type === 'cli');
}

/** @returns {Promise<{ text, inputTokens, outputTokens, costUSD }>} */
async function callNativeCLI(provider, prompt, opts = {}) {
  const o = { ...opts, mode: opts.mode || (opts.cwd ? 'read' : 'text'), cwd: opts.cwd || NEUTRAL_CWD };
  // A CLI that can't be kept from writing never reads inside a project: it answers from the prompt
  if (o.mode === 'read' && !CLI_ADAPTERS[provider]?.readOnly) Object.assign(o, { mode: 'text', cwd: NEUTRAL_CWD });
  ensureDir(o.cwd);
  let r;
  switch (provider) {
    case 'cli':             r = await callClaudeCLI(prompt, o); break;
    case 'copilot-cli':     r = await callCopilotCLI(prompt, o); break;
    case 'antigravity-cli': r = await callAntigravityCLI(prompt, o); break;
    default: {
      // Custom CLI: the user defines the args, so there is no per-mode behaviour
      const custom = readConfig().customProviders.find(p => p.id === provider);
      r = estimatedUsage(await runCLI(custom.cliBin, custom.cliArgs || [], { ...o, stdin: prompt }));
    }
  }
  trackUsage(r);
  return r;
}

// CLIs that don't report usage: approximate tokens, never invent a cost
function estimatedUsage(text) {
  return { text: text.trim(), inputTokens: 0, outputTokens: Math.ceil(text.length / 4), costUSD: 0 };
}

// On Windows the npm .cmd shim is the child: kill() would leave the real CLI running and editing files
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    child.kill();
  }
}

const cancelledError = () => Object.assign(new Error('Ejecución cancelada'), { cancelled: true });

const TRANSIENT_RE = /\b(429|500|502|503|504|529)\b|rate.?limit|overloaded|econnreset|econnrefused|etimedout|socket hang up|fetch failed|limite de peticiones/i;
const isTransientError = (err) => TRANSIENT_RE.test(err?.message || '');

/** Retries `fn` on rate limits, 5xx and network errors with exponential backoff. Anything else rethrows at once. */
async function withRetry(fn, { retries = 2, baseMs = 3000, onRetry, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt >= retries || signal?.aborted || !isTransientError(err)) throw err;
      const wait = baseMs * 2 ** attempt;
      onRetry?.(err, attempt + 1, wait);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/** Spawns a CLI and resolves its stdout. Rejects on non-zero exit, timeout or missing binary. */
function runCLI(bin, args, { stdin, cwd, timeout = CALL_TIMEOUT_MS, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const child = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CI: '1',          // tell CLIs they're running non-interactively
        NO_COLOR: '1',    // disable ANSI color codes that pollute output
        TERM: 'dumb',     // disable terminal features that require TTY
      },
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      if (!onLine) return;
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const l of lines) if (l.trim()) onLine(l);
    });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.stdin.end(stdin ?? '', 'utf8');

    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`${bin} timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);
    const onAbort = () => { clearTimeout(timer); killTree(child); reject(cancelledError()); };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) return resolve(stdout);
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
      if (/is not recognized|no se reconoce|command not found/i.test(detail)) reject(new Error(`${bin} no encontrado en PATH`));
      else reject(new Error(`${bin} exited with code ${code}${detail ? ': ' + detail : ''}`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(err.code === 'ENOENT' ? new Error(`${bin} no encontrado en PATH`) : err);
    });
  });
}

async function withMcpFile(provider, servers, fn) {
  const file = require('./mcp').writeMcpConfigFile(provider, servers);
  try { return await fn(file); } finally { if (file) fs.rmSync(file, { force: true }); }
}

// Prompt via stdin: through the npm .cmd shim, cmd.exe would cut an argument at the first newline
// stream-json events → { type: 'text' | 'tool', ... } for live progress
function claudeStreamEvent(line, onEvent) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (ev.type !== 'assistant') return;
  for (const b of ev.message?.content || []) {
    if (b.type === 'text' && b.text?.trim()) onEvent({ type: 'text', text: b.text.trim() });
    if (b.type === 'tool_use') {
      const i = b.input || {};
      onEvent({ type: 'tool', name: b.name, detail: i.file_path || i.path || i.command || i.pattern || i.url || '' });
    }
  }
}

function callClaudeCLI(prompt, o) {
  // Only stream when someone listens: stream-json needs --verbose and prints every turn
  const args = ['--print', ...(o.onEvent ? ['--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json'])];
  if (o.mode === 'agent') args.push('--dangerously-skip-permissions', '--max-turns', String(o.maxTurns || 10));
  else args.push('--tools', o.mode === 'read' ? 'Read,Grep,Glob' : '');
  if (o.model) args.push('--model', o.model);
  return withMcpFile('cli', o.mcpServers, async (mcpFile) => {
    if (mcpFile) args.push('--mcp-config', mcpFile);
    const onLine = o.onEvent && ((l) => claudeStreamEvent(l, o.onEvent));
    const raw = (await runCLI('claude', args, { ...o, stdin: prompt, onLine })).trim();
    // stream-json (and multi-turn runs) print several JSON lines: the result is the last 'result' one
    const lines  = raw.split('\n').reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const parsed = lines.find(l => l.type === 'result') || lines[0];
    if (!parsed) return { text: raw, inputTokens: 0, outputTokens: 0, costUSD: 0 };
    if (parsed.is_error) throw new Error(`Claude CLI: ${parsed.result || parsed.subtype || 'error'}`);
    return {
      text:         String(parsed.result ?? '').trim(),
      inputTokens:  parsed.usage?.input_tokens  || 0,
      outputTokens: parsed.usage?.output_tokens || 0,
      costUSD:      parsed.total_cost_usd || 0,
    };
  });
}

// Copilot CLI (`copilot`, not the retired `gh copilot` extension). Prompt via stdin.
function callCopilotCLI(prompt, o) {
  const args = ['-s', '--allow-all-tools'];
  // Deny rules win over --allow-all-tools: reads stay available, writes and shell don't
  if (o.mode !== 'agent') args.push('--deny-tool=write', '--deny-tool=shell');
  return withMcpFile('copilot-cli', o.mcpServers, async (mcpFile) => {
    if (mcpFile) args.push('--additional-mcp-config', `@${mcpFile}`);
    return estimatedUsage(await runCLI('copilot', args, { ...o, stdin: prompt }));
  });
}

// ponytail: agy takes the prompt only as an argument (no plain stdin input) and Windows caps a command
// line at ~32K chars. Switch to --input-format stream-json if prompts outgrow it.
const AGY_MAX_PROMPT = 30_000;

// Antigravity CLI (`agy`, successor of Gemini CLI). Only 'agent' and 'text' reach it (see callNativeCLI):
// plan mode keeps it from running commands, not from editing files.
async function callAntigravityCLI(prompt, o) {
  // Without this it reaches for its own tools, gets them denied and answers nothing
  const p = o.mode === 'agent' ? prompt : `Responde únicamente con texto, sin usar tus herramientas ni ejecutar comandos.\n\n${prompt}`;
  if (p.length > AGY_MAX_PROMPT) throw new Error(`Prompt demasiado largo para Antigravity CLI (${p.length} caracteres, máx. ${AGY_MAX_PROMPT})`);
  const args = ['--output-format', 'json', ...(o.mode === 'agent' ? ['--dangerously-skip-permissions'] : ['--mode', 'plan']), '--print', p];
  const raw = (await runCLI('agy', args, o)).trim();
  let r;
  try { r = JSON.parse(raw); } catch { throw new Error(`Antigravity CLI: ${raw.slice(0, 500) || 'sin respuesta'}`); }
  if (r.status !== 'SUCCESS') throw new Error(`Antigravity CLI: ${r.status} ${r.response || ''}`.trim());
  if (!r.response?.trim() && r.denied_actions?.length) {
    throw new Error(`Antigravity CLI no respondió: se denegó ${r.denied_actions.map(a => a.display_name || a.action).join(', ')}`);
  }
  return { text: String(r.response || '').trim(), inputTokens: r.usage?.input_tokens || 0, outputTokens: r.usage?.output_tokens || 0, costUSD: 0 };
}

// ── callAIRich — returns { text, inputTokens, outputTokens, costUSD } ────────

/**
 * Like callAI but returns usage too. Native CLIs report (or approximate) it; API providers inside a
 * project go through callAIWithSubsystemCLI, which returns its own tokens.
 */
async function callAIRich(prompt, opts = {}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';
  if (isNativeCLI(provider, cfg)) return callNativeCLI(provider, prompt, opts);
  return { text: await callAI(prompt, opts), inputTokens: 0, outputTokens: 0, costUSD: 0 };
}

// ── API backend ───────────────────────────────────────────────────────────────

async function callAPI(prompt, apiKey, opts = {}) {
  if (!apiKey) throw new Error('No API key configured');

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk');
  }

  const client   = new Anthropic.default({ apiKey });
  const message  = await client.messages.create({
    model:      MODEL,
    max_tokens: opts.maxTokens || 1500,
    messages:   [{ role: 'user', content: prompt }],
  });

  const usage = message.usage || {};
  trackUsage({
    inputTokens:  usage.input_tokens  || 0,
    outputTokens: usage.output_tokens || 0,
    costUSD:      calcAnthropicCost(message.model || MODEL, usage.input_tokens || 0, usage.output_tokens || 0),
  });

  return message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

// ── GitHub Models backend ─────────────────────────────────────────────────────

const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';
const GITHUB_MODELS_BASE = GITHUB_MODELS_URL.replace('/chat/completions', '');
const GITHUB_MODELS_DEFAULT = 'gpt-4o-mini';

function isGitHubContentFilterMessage(msg) {
  return /content management policy|content filter|response was filtered|prompt triggering azure openai|politica de contenido|bloqueo la solicitud/i.test(String(msg || ''));
}

function mapGitHubModelsError(status, msg) {
  if (status === 401) {
    return 'GitHub token invalido o sin permisos. Verifica el token en Ajustes.';
  }
  if (status === 429) {
    return 'Limite de peticiones de GitHub Models alcanzado. Intentalo en unos minutos.';
  }
  if (isGitHubContentFilterMessage(msg)) {
    return [
      'GitHub Models bloqueo la solicitud por su politica de contenido.',
      'Prueba reformular el prompt con enfoque defensivo y profesional.',
      'Evita pedir instrucciones ofensivas, dano, fraude o contenido sensible explicito.',
    ].join(' ');
  }
  return `GitHub Models API error: ${msg}`;
}

function isUnknownModelMessage(msg) {
  return /unknown model|model.*not found|invalid model|unsupported model|does not exist/i.test(String(msg || ''));
}

function buildGitHubModelFallbackWarning(invalidModel, fallbackModel, reason) {
  return {
    code: 'MODEL_FALLBACK_GITHUB',
    provider: 'github',
    invalidModel,
    fallbackModel,
    reason: String(reason || ''),
    message: `Modelo del agente no valido en GitHub Models (${invalidModel}). Se uso el modelo global (${fallbackModel}).`,
  };
}

function readGitHubTokenFromGhCLI() {
  return new Promise((resolve) => {
    exec('gh auth token', { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve('');
      const token = String(stdout || '').trim();
      resolve(token);
    });
  });
}

async function callGitHub(prompt, githubToken, model, opts = {}) {
  if (!githubToken) throw new Error('No GitHub token configured');

  const response = await fetch(GITHUB_MODELS_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:      model || GITHUB_MODELS_DEFAULT,
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: opts.maxTokens || 1500,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || err.message || response.statusText;
    throw new Error(mapGitHubModelsError(response.status, msg));
  }

  const data  = await response.json();
  const usage = data.usage || {};
  trackUsage({
    inputTokens:  usage.prompt_tokens     || 0,
    outputTokens: usage.completion_tokens || 0,
  });
  return data.choices?.[0]?.message?.content || '';
}

async function listGitHubModels({ token } = {}) {
  const cfg = readConfig();
  let githubToken = String(token ?? cfg.githubToken ?? '').trim();
  if (!githubToken) githubToken = String(await readGitHubTokenFromGhCLI()).trim();
  if (!githubToken) throw new Error('No GitHub token configured');

  const response = await fetch(`${GITHUB_MODELS_BASE}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || err.message || response.statusText;
    throw new Error(mapGitHubModelsError(response.status, msg));
  }

  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload) ? payload : []);

  const ids = rows
    .map((row) => (typeof row === 'string' ? row : row?.id))
    .filter((id) => Boolean(id && String(id).trim()))
    .map((id) => String(id).trim());

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// ── OpenAI-compatible backend (OpenAI, Gemini, Mistral, Grok, GitHub) ────────

async function callOpenAICompat(prompt, systemPrompt, { baseUrl, key, model, headers = {} }, opts = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (!finalHeaders.Authorization && !finalHeaders['Ocp-Apim-Subscription-Key'] && key) {
    finalHeaders.Authorization = `Bearer ${key}`;
  }

  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: finalHeaders,
    body:    JSON.stringify({ model, messages, max_tokens: opts.maxTokens || 4096 }),
    signal:  AbortSignal.timeout(opts.timeout || CALL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || err.message || res.statusText;
    if (res.status === 401) throw new Error('API key invalida o sin permisos. Verifica el token en Ajustes.');
    if (res.status === 429) throw new Error('Limite de peticiones alcanzado. Intentalo en unos minutos.');
    if (isGitHubContentFilterMessage(msg)) throw new Error(mapGitHubModelsError(res.status, msg));
    throw new Error(`API error ${res.status}: ${msg}`);
  }

  const data             = await res.json();
  const text             = data.choices?.[0]?.message?.content || '';
  const { prompt_tokens: pt = 0, completion_tokens: ct = 0 } = data.usage ?? {};
  trackUsage({ inputTokens: pt, outputTokens: ct });
  return text;
}

async function callOpenAICompatChat(messages, systemPrompt, { baseUrl, key, model, headers = {} }, opts = {}) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (!finalHeaders.Authorization && !finalHeaders['Ocp-Apim-Subscription-Key'] && key) {
    finalHeaders.Authorization = `Bearer ${key}`;
  }

  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: finalHeaders,
    body:    JSON.stringify({ model, messages: allMessages, max_tokens: opts.maxTokens || 4096 }),
    signal:  AbortSignal.any([AbortSignal.timeout(opts.timeout || CALL_TIMEOUT_MS), opts.signal].filter(Boolean)),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || err.message || res.statusText;
    if (res.status === 401) throw new Error('API key invalida o sin permisos. Verifica el token en Ajustes.');
    if (res.status === 429) throw new Error('Limite de peticiones alcanzado. Intentalo en unos minutos.');
    if (isGitHubContentFilterMessage(msg)) throw new Error(mapGitHubModelsError(res.status, msg));
    throw new Error(`API error ${res.status}: ${msg}`);
  }

  const data  = await res.json();
  const text  = data.choices?.[0]?.message?.content || '';
  const { prompt_tokens: pt = 0, completion_tokens: ct = 0 } = data.usage ?? {};
  trackUsage({ inputTokens: pt, outputTokens: ct });
  return { text, inputTokens: pt, outputTokens: ct, truncated: data.choices?.[0]?.finish_reason === 'length' };
}

// ── Agent system prompt generation ───────────────────────────────────────────

/**
 * Generates a complete agent system prompt from a brief description.
 *
 * @param {object} params
 * @param {string} params.description     — user's brief description
 * @param {string} params.name            — agent name (e.g. "unity-audio")
 * @param {string} params.level           — 'global'|'section'|'tech'|'project'
 * @param {string} [params.categoryId]
 * @param {string} [params.techId]
 * @param {string[]} [params.tools]       — selected tools
 * @param {string} [params.language]      — 'es'|'en' (default: 'en')
 * @param {string[]} [params.existingAgents] — names of agents already at this level
 * @returns {Promise<string>} — complete system prompt text
 */
async function generateAgentPrompt(params) {
  const {
    description,
    name        = 'agent',
    level       = 'global',
    categoryId  = null,
    techId      = null,
    tools       = [],
    language    = 'en',
    existingAgents = [],
  } = params;

  const levelLabels = {
    global:  'global (applies to ALL projects)',
    section: `category-level (applies to all ${categoryId || ''} projects)`,
    tech:    `technology-level (applies to all ${techId || ''} projects within ${categoryId || ''})`,
    project: 'project-specific (exclusive to one project)',
  };

  const langInstr = language === 'es'
    ? 'Write the system prompt in Spanish.'
    : 'Write the system prompt in English.';

  const existingNote = existingAgents.length > 0
    ? `Agents that already exist at this level (do NOT duplicate their responsibilities): ${existingAgents.join(', ')}.`
    : '';

  const toolsNote = tools.length > 0
    ? `The agent will have access to these tools: ${tools.join(', ')}.`
    : '';

  const prompt = prompts.agentPrompt({
    name,
    description,
    level: levelLabels[level] || level,
    toolsNote,
    existingNote,
    langInstr,
  });

  try {
    const result = await callAI(prompt, { maxTokens: 400 });
    const parsed = parseJSONObjectSafely(result);
    return renderStandardAgentPrompt({
      description,
      level,
      categoryId,
      techId,
      tools,
      language,
      role: parsed.role,
      objective: parsed.objective,
      responsibilities: parsed.responsibilities,
      boundaries: parsed.boundaries,
      outputFormat: parsed.outputFormat,
    });
  } catch (err) {
    // Some GitHub Models requests get false-positive content filtering.
    // Return a deterministic prompt instead of failing the UX.
    if (isGitHubContentFilterMessage(err?.message || '')) {
      return renderStandardAgentPrompt({
        description,
        level,
        categoryId,
        techId,
        tools,
        language,
      });
    }
    // If AI output cannot be parsed, still return the deterministic base format.
    if (/could not parse ai response as json|expected json object/i.test(String(err?.message || ''))) {
      return renderStandardAgentPrompt({ description, level, categoryId, techId, tools, language });
    }
    throw err;
  }
}

function renderStandardAgentPrompt({
  description,
  level,
  categoryId,
  techId,
  tools = [],
  language = 'en',
  role,
  objective,
  responsibilities,
  boundaries,
  outputFormat,
}) {
  const isEs = language === 'es';
  const levelText = (() => {
    if (level === 'global') return isEs ? 'todos los proyectos' : 'all projects';
    if (level === 'section') return isEs ? `proyectos de la categoria ${categoryId || 'objetivo'}` : `${categoryId || 'target'} category projects`;
    if (level === 'tech') return isEs
      ? `proyectos ${techId || 'tecnologicos'} en ${categoryId || 'la categoria objetivo'}`
      : `${techId || 'technology'} projects in ${categoryId || 'the target category'}`;
    return isEs ? 'un proyecto especifico' : 'a specific project';
  })();

  const sanitizeList = (arr, fallback) => {
    if (!Array.isArray(arr) || !arr.length) return fallback;
    return arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5);
  };

  const sanitizeLine = (text, fallback) => {
    const v = String(text || '').trim();
    return v || fallback;
  };

  const defaultRole = isEs
    ? 'Actua como especialista tecnico con enfoque sistematico.'
    : 'Act as a technical specialist with a systematic approach.';

  const safeRole = sanitizeLine(role, defaultRole);

  const safeObjective = String(objective || (isEs
    ? 'Resolver la tarea asignada con pasos accionables y verificables.'
    : 'Solve the assigned task with actionable, verifiable steps.')).trim();

  const safeResponsibilities = sanitizeList(
    responsibilities,
    isEs
      ? [
        'Analizar el contexto disponible antes de proponer cambios.',
        'Proponer pasos concretos y ordenados para ejecutar la tarea.',
        'Priorizar soluciones simples, mantenibles y medibles.',
      ]
      : [
        'Analyze available context before proposing changes.',
        'Provide concrete, ordered steps to execute the task.',
        'Prioritize simple, maintainable, measurable solutions.',
      ],
  );

  const safeBoundaries = sanitizeList(
    boundaries,
    isEs
      ? [
        'No inventar archivos, comandos ni resultados.',
        'No cambiar APIs publicas sin justificar impacto.',
        'No omitir validaciones ni riesgos conocidos.',
      ]
      : [
        'Do not invent files, commands, or outcomes.',
        'Do not change public APIs without impact rationale.',
        'Do not skip validations or known risks.',
      ],
  );

  const safeOutput = sanitizeList(
    outputFormat,
    isEs
      ? [
        'Resumen breve del enfoque.',
        'Pasos recomendados y ordenados.',
        'Riesgos y comprobaciones finales.',
      ]
      : [
        'Short summary of the approach.',
        'Recommended ordered steps.',
        'Risks and final validation checks.',
      ],
  );

  const bullets = (items) => items.map((x) => `- ${x}`).join('\n');

  if (isEs) {
    return [
      safeRole,
      '',
      '**Objetivo**:',
      safeObjective,
      '',
      '**Alcance**:',
      `Aplica a: ${levelText}.`,
      '',
      '**Proceso**:',
      '1. Analiza el contexto y valida restricciones antes de actuar.',
      '2. Prioriza hipotesis/acciones por impacto y probabilidad.',
      '3. Ejecuta cambios minimos y verificables.',
      '4. Valida resultados y riesgos de regresion.',
      '',
      '**Responsabilidades**:',
      bullets(safeResponsibilities),
      '',
      '**Limites**:',
      bullets(safeBoundaries),
      '',
      '**Formato de salida**:',
      bullets(safeOutput),
    ].join('\n');
  }

  return [
    safeRole,
    '',
    '**Objective**:',
    safeObjective,
    '',
    '**Scope**:',
    `Applies to: ${levelText}.`,
    '',
    '**Process**:',
    '1. Analyze context and validate constraints before acting.',
    '2. Prioritize hypotheses/actions by impact and likelihood.',
    '3. Execute minimal, verifiable changes.',
    '4. Validate outcomes and regression risks.',
    '',
    '**Responsibilities**:',
    bullets(safeResponsibilities),
    '',
    '**Boundaries**:',
    bullets(safeBoundaries),
    '',
    '**Output format**:',
    bullets(safeOutput),
  ].join('\n');
}

// ── Suggestion generation ─────────────────────────────────────────────────────

/**
 * Generates 2-4 contextual agent suggestions for a given level.
 * Returns structured data ready to pre-fill the agent creation form.
 *
 * @param {object} params
 * @param {string} params.level
 * @param {string} [params.categoryId]
 * @param {string} [params.techId]
 * @param {string[]} params.existingAgents — names to avoid duplicating
 * @returns {Promise<Array<{ name, description, tools, model, system }>>}
 */
async function generateSuggestions(params) {
  const {
    level,
    categoryId = null,
    techId     = null,
    existingAgents = [],
  } = params;

  const context = buildSuggestionContext(level, categoryId, techId);
  const existing = existingAgents.length > 0
    ? `Agents already at this level (do NOT suggest these): ${existingAgents.join(', ')}.`
    : '';

  const prompt = prompts.agentSuggestions({ context, existing });

  const raw    = await callAI(prompt, { maxTokens: 800 });
  const parsed = parseJSONSafely(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('AI returned invalid suggestions format');
  }

  // Validate and sanitize each suggestion
  return parsed.slice(0, 4).map(s => ({
    name:        String(s.name        || 'suggested-agent').toLowerCase().replace(/\s+/g, '-'),
    description: String(s.description || '').slice(0, 100),
    tools:       Array.isArray(s.tools) ? s.tools : ['Read'],
    model:       ['haiku','sonnet','opus'].includes(s.model) ? s.model : 'sonnet',
    system:      String(s.system      || ''),
  }));
}

function buildSuggestionContext(level, categoryId, techId) {
  if (level === 'global') {
    return 'GLOBAL level — these agents apply to ALL projects regardless of type. Focus on universal development tasks (code quality, git, documentation, testing, refactoring).';
  }
  if (level === 'section') {
    const labels = { games: 'Game Development', web: 'Web Applications', mobile: 'Mobile Apps', docs: 'Documentation' };
    return `CATEGORY level: ${labels[categoryId] || categoryId}. These agents apply to all projects in this category. Focus on tasks specific to this domain.`;
  }
  if (level === 'tech') {
    return `TECHNOLOGY level: ${techId || ''} (within ${categoryId || ''} category). These agents apply to all projects using this specific technology. Focus on technology-specific tasks, patterns and best practices.`;
  }
  if (level === 'project') {
    return `PROJECT level — these agents are exclusive to a specific project. Focus on project-specific tasks that don't fit into higher levels.`;
  }
  return `Level: ${level}`;
}

// ── Suggestion cache ──────────────────────────────────────────────────────────

const SUGGESTIONS_FILE = path.join(CACHE_DIR, 'suggestions.json');

function readSuggestionsCache() {
  ensureDir(CACHE_DIR);
  if (!fs.existsSync(SUGGESTIONS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8')); }
  catch { return {}; }
}

function writeSuggestionsCache(cache) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function cacheKey(level, categoryId, techId) {
  return [level, categoryId || '', techId || ''].join('::');
}

/**
 * Gets cached suggestions for a level.
 * Returns null if no cache exists.
 */
function getCachedSuggestions(level, categoryId, techId) {
  const cache = readSuggestionsCache();
  const key   = cacheKey(level, categoryId, techId);
  const entry = cache[key];
  if (!entry) return null;
  return entry.suggestions;
}

/**
 * Gets suggestions: returns cache if available, otherwise generates new ones.
 * Pass force=true to bypass cache ("Suggest more" button).
 */
async function getSuggestions(params, force = false) {
  const { level, categoryId, techId, existingAgents } = params;
  const key = cacheKey(level, categoryId, techId);

  if (!force) {
    const cached = getCachedSuggestions(level, categoryId, techId);
    if (cached) return cached;
  }

  // Generate new suggestions
  const suggestions = await generateSuggestions({ level, categoryId, techId, existingAgents: existingAgents || [] });

  // Save to cache
  const cache = readSuggestionsCache();
  cache[key]  = { suggestions, generatedAt: new Date().toISOString() };
  writeSuggestionsCache(cache);

  return suggestions;
}

/**
 * Clears suggestions cache for a specific level (or all if no params).
 */
function clearSuggestionsCache(level, categoryId, techId) {
  const cache = readSuggestionsCache();
  if (level) {
    delete cache[cacheKey(level, categoryId, techId)];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
  }
  writeSuggestionsCache(cache);
}

/**
 * Generates agent suggestions for a specific project, using its context file
 * (CLAUDE.md or copilot-instructions.md) as rich input.
 *
 * @param {object} params
 * @param {object} params.project         — full project object from config
 * @param {string} params.contextContent  — content of CLAUDE.md or copilot-instructions
 * @param {string} params.categoryName
 * @param {string} params.techName
 * @param {string[]} params.existingAgents
 * @returns {Promise<Array>}
 */
async function generateProjectSuggestions({ project, contextContent, categoryName, techName, existingAgents = [] }) {
  const existing = existingAgents.length
    ? `Agents ALREADY in this project (do NOT suggest these): ${existingAgents.join(', ')}.`
    : '';

  const contextSection = contextContent?.trim()
    ? `PROJECT DOCUMENTATION (CLAUDE.md / instructions):\n---\n${contextContent.slice(0, 1500)}\n---`
    : 'PROJECT DOCUMENTATION: Not available — base suggestions on category and technology.';

  const prompt = prompts.projectSuggestions({ project, contextSection, existing, categoryName, techName });

  const raw    = await callAI(prompt, { maxTokens: 900, cwd: project.path });
  const parsed = parseJSONSafely(raw);
  if (!Array.isArray(parsed)) throw new Error('AI returned invalid suggestions format');

  return parsed.slice(0, 4).map(s => ({
    name:        String(s.name        || 'project-agent').toLowerCase().replace(/\s+/g, '-'),
    description: String(s.description || '').slice(0, 100),
    tools:       Array.isArray(s.tools) ? s.tools : ['Read'],
    model:       ['haiku','sonnet','opus'].includes(s.model) ? s.model : 'sonnet',
    system:      String(s.system      || ''),
  }));
}

// ── JSON parser (tolerant) ────────────────────────────────────────────────────

function parseJSONSafely(raw) {
  // Strip markdown code fences if present
  let clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/,      '')
    .replace(/\s*```$/,      '')
    .trim();

  // Find the first [ to handle any preamble the model might add
  const start = clean.indexOf('[');
  const end   = clean.lastIndexOf(']');
  if (start !== -1 && end !== -1) {
    clean = clean.slice(start, end + 1);
  }

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error('Could not parse AI response as JSON');
  }
}

function parseJSONObjectSafely(raw) {
  let clean = String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    clean = clean.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(clean);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('Expected JSON object');
    }
    return parsed;
  } catch {
    throw new Error('Could not parse AI response as JSON object');
  }
}

// ── Multi-turn chat ───────────────────────────────────────────────────────────

/**
 * Sends a multi-turn conversation to the configured AI provider.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {object} [opts]
 * @param {string} [opts.systemPrompt]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string>}
 */
function _openAICompatConfigForProvider(cfg, provider, modelOverride = null) {
  switch (provider) {
    case 'openai':      return { baseUrl: 'https://api.openai.com/v1', key: cfg.openaiKey, model: modelOverride || (cfg.openaiModel ?? 'gpt-4o-mini') };
    case 'github':      return { baseUrl: 'https://models.inference.ai.azure.com', key: cfg.githubToken, model: modelOverride || (cfg.githubModel ?? GITHUB_MODELS_DEFAULT) };
    case 'gemini-api':  return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', key: cfg.geminiApiKey, model: modelOverride || (cfg.geminiApiModel ?? 'gemini-2.5-flash') };
    case 'mistral':     return { baseUrl: 'https://api.mistral.ai/v1', key: cfg.mistralKey, model: modelOverride || (cfg.mistralModel ?? 'mistral-small-latest') };
    case 'grok':        return { baseUrl: 'https://api.x.ai/v1', key: cfg.grokKey, model: modelOverride || (cfg.grokModel ?? 'grok-3-mini') };
    case 'deepseek':    return { baseUrl: 'https://api.deepseek.com', key: cfg.deepseekKey, model: modelOverride || (cfg.deepseekModel ?? 'deepseek-chat') };
    case 'groq':        return { baseUrl: 'https://api.groq.com/openai/v1', key: cfg.groqKey, model: modelOverride || (cfg.groqModel ?? 'llama-3.3-70b-versatile') };
    case 'openrouter':  return { baseUrl: 'https://openrouter.ai/api/v1', key: cfg.openrouterKey, model: modelOverride || (cfg.openrouterModel ?? 'anthropic/claude-3.5-sonnet') };
    case 'perplexity':  return { baseUrl: 'https://api.perplexity.ai', key: cfg.perplexityKey, model: modelOverride || (cfg.perplexityModel ?? 'sonar-reasoning-pro') };
    default: return null;
  }
}

async function callAIChat(messages, opts = {}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';

  // Check custom providers first
  const customCfg = _getCustomProviderConfig(cfg, provider);
  if (customCfg) {
    const { text } = await callOpenAICompatChat(messages, opts.systemPrompt || null, customCfg, opts);
    return text;
  }

  if (provider === 'api') {
    if (!cfg.apiKey) throw new Error('No API key configured');
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch { throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk'); }

    const client  = new Anthropic.default({ apiKey: cfg.apiKey });
    const params  = {
      model:      cfg.apiModel || MODEL,
      max_tokens: opts.maxTokens || 1024,
      messages,
    };
    if (opts.systemPrompt) params.system = opts.systemPrompt;
    const result = await client.messages.create(params);
    const usage  = result.usage || {};
    trackUsage({
      inputTokens:  usage.input_tokens  || 0,
      outputTokens: usage.output_tokens || 0,
      costUSD:      calcAnthropicCost(result.model || MODEL, usage.input_tokens || 0, usage.output_tokens || 0),
    });
    return result.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }

  // OpenAI-compatible providers
  const oaConfig = _openAICompatConfigForProvider(cfg, provider, opts.model || null);
  if (oaConfig) {
    const { text } = await callOpenAICompatChat(messages, opts.systemPrompt || null, oaConfig, opts);
    return text;
  }

  if (isNativeCLI(provider, cfg)) {
    return (await callNativeCLI(provider, flattenChat(messages, opts.systemPrompt), { mode: 'text' })).text;
  }
  throw new Error(`Unknown AI provider: ${provider}`);
}

// CLIs take a single prompt: the conversation goes in as a transcript
function flattenChat(messages, systemPrompt) {
  const lines = systemPrompt ? [`[System]: ${systemPrompt}\n`] : [];
  for (const m of messages) lines.push(`[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`);
  return lines.join('\n\n');
}

// ── Low-level chat with token tracking (for Subsystem CLI) ───────────────────

/**
 * Sends a multi-turn conversation to the configured AI provider and returns
 * both the response text and token counts. Used internally by the Subsystem CLI.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {string} [systemPrompt]
 * @param {object} [opts]
 * @param {string} [opts.provider]    — override provider ('api'|'github')
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number }>}
 */
async function callAIChatWithTokens(messages, systemPrompt, opts = {}) {
  const cfg      = readConfig();
  const provider = opts.provider || cfg.aiProvider || 'cli';

  // Check custom providers
  const customCfg = _getCustomProviderConfig(cfg, provider);
  if (customCfg) {
    return callOpenAICompatChat(messages, systemPrompt || null, customCfg, opts);
  }

  if (provider === 'api') {
    if (!cfg.apiKey) throw new Error('No API key configured');
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch { throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk'); }

    const client = new Anthropic.default({ apiKey: cfg.apiKey });
    const params = {
      model:      cfg.apiModel || MODEL,
      // Room for a full-file TOOL: write; every current Claude model allows at least 32k
      max_tokens: opts.maxTokens || 16_384,
      messages,
    };
    if (systemPrompt) params.system = systemPrompt;
    withPromptCache(params);

    // Apply timeout via AbortController (Anthropic SDK supports signal)
    const timeoutMs    = opts.timeout || CALL_TIMEOUT_MS;
    const controller   = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let result;
    try {
      result = await client.messages.create(params, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutTimer);
    }

    const usage        = result.usage || {};
    const cacheWrite   = usage.cache_creation_input_tokens || 0;
    const cacheRead    = usage.cache_read_input_tokens     || 0;
    // Reported input counts every prompt token, cached or not, so totals stay comparable across runs
    const inputTokens  = (usage.input_tokens || 0) + cacheWrite + cacheRead;
    const outputTokens = usage.output_tokens || 0;
    const costUSD      = calcAnthropicCost(result.model || MODEL, usage.input_tokens || 0, outputTokens, cacheWrite, cacheRead);
    trackUsage({ inputTokens, outputTokens, costUSD });
    return {
      text: result.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      inputTokens,
      outputTokens,
      costUSD,
      cacheReadTokens: cacheRead,
      truncated: result.stop_reason === 'max_tokens',
    };
  }

  // OpenAI-compatible providers
  const oaConfig = _openAICompatConfigForProvider(cfg, provider, opts.model || null);
  if (oaConfig) {
    try {
      return await callOpenAICompatChat(messages, systemPrompt || null, oaConfig, opts);
    } catch (err) {
      // If an agent-level GitHub model override is invalid, retry once with global githubModel.
      if (provider === 'github' && opts.model && isUnknownModelMessage(err?.message || '')) {
        const fallbackConfig = _openAICompatConfigForProvider(cfg, provider, null);
        const retry = await callOpenAICompatChat(messages, systemPrompt || null, fallbackConfig, opts);
        return {
          ...retry,
          warnings: [
            buildGitHubModelFallbackWarning(opts.model, fallbackConfig?.model || cfg.githubModel || GITHUB_MODELS_DEFAULT, err?.message || ''),
          ],
        };
      }
      throw err;
    }
  }

  // Native CLI as a plain text model: the Subsystem CLI runs the TOOL: blocks itself
  if (isNativeCLI(provider, cfg)) {
    const r = await callNativeCLI(provider, flattenChat(messages, systemPrompt), { mode: 'text', timeout: opts.timeout });
    return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  }

  throw new Error(`Provider "${provider}" no soportado en modo multi-turno`);
}

// ── Subsystem CLI integration ─────────────────────────────────────────────────

/**
 * Executes a prompt using the Subsystem CLI (virtual tool-use loop).
 * Intended for API / GitHub providers that lack native filesystem access.
 *
 * @param {string} prompt              — user task / instruction
 * @param {string} agentSystemPrompt   — agent's original system prompt
 * @param {object} opts
 * @param {string}  opts.projectPath   — absolute path to project root
 * @param {string}  [opts.projectContext] — content of CLAUDE.md / instructions
 * @param {string}  [opts.provider]    — 'api' | 'github'
 * @param {string}  [opts.model]       — optional model override for the active provider
 * @param {number}  [opts.maxTurns=10]
 * @param {number}  [opts.timeout=300000]
 * @returns {Promise<SubsystemCLIResult>}
 */
async function callAIWithSubsystemCLI(prompt, agentSystemPrompt, opts = {}) {
  const provider = opts.provider || readConfig().aiProvider || 'cli';

  const { execute } = require('./subsystem-cli');

  const result = await execute(prompt, agentSystemPrompt || '', {
    projectPath:    opts.projectPath    || '',
    projectContext: opts.projectContext || '',
    maxTurns:       opts.maxTurns       || 10,
    timeout:        opts.timeout        || 300_000,
    useBrowser:     opts.useBrowser     || false,
    mcpServers:     opts.mcpServers     || {},
    projectId:      opts.projectId      || null,
    readOnly:       opts.readOnly       || false,
    signal:         opts.signal,
    onEvent:        opts.onEvent,
    callAIRaw: (messages, systemPrompt, callOpts = {}) => withRetry(
      () => callAIChatWithTokens(messages, systemPrompt, { provider, model: opts.model || null, timeout: callOpts.timeout, signal: opts.signal }),
      { onRetry: opts.onRetry, signal: opts.signal },
    ),
  });

  return result;
}

// ── Agent system prompt cross-provider adaptation ─────────────────────────────

const ADAPTATION_PROMPTS = {
  github: (agent) => prompts.adaptForProvider({ agent, targetProvider: 'github' }),
};

/**
 * Rewrites an agent's system prompt for a target AI provider using the
 * configured AI. Falls back to the original system if the provider has no
 * adaptation prompt defined.
 *
 * @param {{ name: string, description: string, system: string }} agent
 * @param {'github'} targetProvider
 * @returns {Promise<string>}
 */
async function adaptSystemPromptForProvider(agent, targetProvider) {
  const buildPrompt = ADAPTATION_PROMPTS[targetProvider];
  if (!buildPrompt || !agent.system) return agent.system;
  const result = await callAI(buildPrompt(agent), { maxTokens: 800 });
  return result.trim();
}

// ── Test connection ───────────────────────────────────────────────────────────

async function testConnection() {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';
  const start    = Date.now();

  // Check custom providers first
  const custom = (cfg.customProviders || []).find(p => p.id === provider);
  if (custom) {
    if (custom.type === 'cli') {
      const check = await whichBin(custom.cliBin);
      return {
        ok:        check.found,
        error:     check.found ? undefined : `${custom.cliBin} no encontrado en PATH`,
        latencyMs: Date.now() - start,
      };
    } else {
      const customCfg = _getCustomProviderConfig(cfg, provider);
      if (!customCfg.baseUrl) return { ok: false, error: 'Base URL no configurada', latencyMs: 0 };
      const url  = customCfg.baseUrl.endsWith('/chat/completions')
        ? customCfg.baseUrl
        : `${customCfg.baseUrl}/chat/completions`;

      const finalHeaders = { 'Content-Type': 'application/json', ...customCfg.headers };
      if (!finalHeaders.Authorization && !finalHeaders['Ocp-Apim-Subscription-Key'] && customCfg.key) {
        finalHeaders.Authorization = `Bearer ${customCfg.key}`;
      }

      const resp = await fetch(url, {
        method:  'POST',
        headers: finalHeaders,
        body:    JSON.stringify({ model: customCfg.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }),
        signal:  AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${resp.status}`);
      }
      return { ok: true, latencyMs: Date.now() - start };
    }
  }

  if (CLI_PROVIDERS.includes(provider)) {
    const bin    = CLI_ADAPTERS[provider].bin;
    const check  = await whichBin(bin);
    return {
      ok:        check.found,
      error:     check.found ? undefined : `${bin} no encontrado en PATH`,
      latencyMs: Date.now() - start,
    };
  }

  try {
    if (provider === 'api') {
      if (!cfg.apiKey) throw new Error('API key no configurada');
      let Anthropic;
      try { Anthropic = require('@anthropic-ai/sdk'); }
      catch { throw new Error('@anthropic-ai/sdk no instalado'); }
      const client = new Anthropic.default({ apiKey: cfg.apiKey });
      await client.messages.create({
        model: cfg.apiModel || 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } else {
      const oaConfig = _openAICompatConfigForProvider(cfg, provider);
      if (!oaConfig) throw new Error('Provider no reconocido');
      if (!oaConfig.key) throw new Error('API key no configurada');
      const url  = oaConfig.baseUrl.endsWith('/chat/completions')
        ? oaConfig.baseUrl
        : `${oaConfig.baseUrl}/chat/completions`;
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${oaConfig.key}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: oaConfig.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 }),
        signal:  AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${resp.status}`);
      }
    }
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - start };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  CLI_ADAPTERS,
  CLI_PROVIDERS,
  API_PROVIDERS,
  MODEL,
  isNativeCLI,
  isTransientError,
  runCLI,
  claudeStreamEvent,
  withPromptCache,
  withRetry,
  GITHUB_GROUP_PROVIDERS,
  callAI,
  callAIRich,
  calcAnthropicCost,
  adaptSystemPromptForProvider,
  generateProjectSuggestions,
  callAIChat,
  flattenChat,
  callAIChatWithTokens,
  callAIWithSubsystemCLI,
  generateAgentPrompt,
  generateSuggestions,
  getSuggestions,
  getCachedSuggestions,
  clearSuggestionsCache,
  getProviderStatus,
  listGitHubModels,
  testConnection,
  getSessionUsage,
  resetSessionUsage,
  resetAllUsage,
};
