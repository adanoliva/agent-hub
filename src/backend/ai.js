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

const { spawn, exec } = require('child_process');
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

// Anthropic pricing per 1M tokens (claude-sonnet-4-20250514)
const ANTHROPIC_PRICING = {
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00  },
  'claude-haiku-4-5-20251001':   { input: 0.25,  output: 1.25   },
  'claude-opus-4-20250514':      { input: 15.00, output: 75.00  },
};

function calcAnthropicCost(model, inputTokens, outputTokens) {
  const pricing = ANTHROPIC_PRICING[model] || ANTHROPIC_PRICING[MODEL];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ── Provider detection ────────────────────────────────────────────────────────

const CLI_PROVIDERS          = ['cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 'aider-cli', 'cline-cli', 'goose-cli'];
const API_PROVIDERS          = ['api', 'openai', 'github', 'gemini-api', 'mistral', 'grok', 'deepseek', 'groq', 'openrouter', 'perplexity'];
const GITHUB_GROUP_PROVIDERS = new Set(['github', 'copilot-cli']);

function whichBin(bin) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
    exec(cmd, (err, stdout) => {
      const found = !err && stdout.trim().length > 0;
      resolve({ found, path: found ? stdout.trim().split('\n')[0] : null });
    });
  });
}

async function checkAllCLIs() {
  const [claude, gemini, codex, gh, aider, cline, goose] = await Promise.all([
    whichBin('claude'), whichBin('gemini'), whichBin('codex'), whichBin('gh'),
    whichBin('aider'), whichBin('cline'), whichBin('goose'),
  ]);
  return { 
    'cli': claude, 
    'gemini-cli': gemini, 
    'codex-cli': codex, 
    'copilot-cli': gh,
    'aider-cli': aider,
    'cline-cli': cline,
    'goose-cli': goose,
  };
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

function isCLIAvailable() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    exec(cmd, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
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

  // Check if it's a custom CLI provider
  const customCLI = (cfg.customProviders || []).find(p => p.id === provider && p.type === 'cli');
  if (customCLI) {
    const args = customCLI.cliArgs || [];
    return callGenericCLI(customCLI.cliBin, args, prompt, opts);
  }

  switch (provider) {
    case 'cli':         return callCLI(prompt, opts);
    case 'gemini-cli':  return callGeminiCLI(prompt, opts);
    case 'codex-cli':   return callCodexCLI(prompt, opts);
    case 'copilot-cli': return callCopilotCLI(prompt, opts);
    case 'api':         return callAPI(prompt, cfg.apiKey, opts);
    case 'openai':      return callOpenAICompat(prompt, null, {
                          baseUrl: 'https://api.openai.com/v1',
                          key:     cfg.openaiKey,
                          model:   cfg.openaiModel ?? 'gpt-4o-mini',
                        }, opts);
    case 'github':      return callOpenAICompat(prompt, null, {
                          baseUrl: GITHUB_MODELS_URL.replace('/chat/completions', ''),
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
    case 'aider-cli':   return callGenericCLI('aider', ['--message', prompt], prompt, opts);
    case 'cline-cli':   return callGenericCLI('cline', ['--prompt', prompt], prompt, opts);
    case 'goose-cli':   return callGenericCLI('goose', ['--prompt', prompt], prompt, opts);
    default: throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ── CLI backend ───────────────────────────────────────────────────────────────

function callCLI(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeout   = opts.timeout || CALL_TIMEOUT_MS;
    const args      = ['--print', '--output-format', 'json'];
    if (opts.extraArgs) args.push(...opts.extraArgs);
    const claudeExe = 'claude';

    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    };
    if (opts.cwd) spawnOpts.cwd = opts.cwd;

    const child = spawn(claudeExe, args, spawnOpts);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI call timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const errText = stderr.trim() || stdout.trim() || 'unknown error';
        if (/fichero por lotes|batch file|is not recognized|command not found/i.test(errText)) {
          reject(new Error('Claude CLI not found. Install from https://claude.ai/code'));
        } else if (/temp|AppData.*Local.*Temp|no such file|ENOENT|resource.*not.*found/i.test(errText)) {
          reject(new Error('El CLI de Claude no encontró un archivo de agente. Puede que hayas eliminado un agente desde VS Code o el directorio de Claude directamente. Reinicia la app para limpiar el estado.'));
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${errText}`));
        }
        return;
      }
      const raw = stdout.trim();

      // Try parsing the last JSON object — multi-turn mode emits one JSON per line
      function parseLastJson(text) {
        try { return JSON.parse(text); } catch {}
        const lines = text.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          try { return JSON.parse(lines[i].trim()); } catch {}
        }
        return null;
      }

      const parsed = parseLastJson(raw);
      if (parsed) {
        const text         = (parsed.result ?? raw).trim();
        const usage        = parsed.usage || {};
        const inputTokens  = usage.input_tokens  || 0;
        const outputTokens = usage.output_tokens || 0;
        const costUSD      = parsed.total_cost_usd || 0;
        trackUsage({ inputTokens, outputTokens, costUSD });
        if (opts.returnRich) {
          resolve({ text, inputTokens, outputTokens, costUSD });
        } else {
          resolve(text);
        }
      } else {
        // Old CLI version without JSON output — use raw text, no usage data
        if (opts.returnRich) {
          resolve({ text: raw, inputTokens: 0, outputTokens: 0, costUSD: 0 });
        } else {
          resolve(raw);
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('Claude CLI not found. Install from https://claude.ai/code'));
      } else {
        reject(err);
      }
    });
  });
}

// ── callAIRich — returns { text, inputTokens, outputTokens, costUSD } ────────

/**
 * Like callAI but returns { text, inputTokens, outputTokens, costUSD }.
 * For CLI: parses the JSON output from --output-format json.
 * For API/GitHub: the orchestrator uses callAIWithSubsystemCLI which already returns tokens;
 * those paths fall back to callAI (text only) when invoked from here.
 */
async function callAIRich(prompt, opts = {}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';
  if (provider === 'cli') return callCLI(prompt, { ...opts, returnRich: true });
  // For API/GitHub the orchestrator uses callAIWithSubsystemCLI which already returns tokens.
  // Provide a passthrough that returns text with zero token counts.
  const text = await callAI(prompt, opts);
  return { text, inputTokens: 0, outputTokens: 0, costUSD: 0 };
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

  const data  = await res.json();
  const text  = data.choices?.[0]?.message?.content || '';
  const { prompt_tokens: pt = 0, completion_tokens: ct = 0 } = data.usage ?? {};
  trackUsage({ inputTokens: pt, outputTokens: ct });
  return { text, inputTokens: pt, outputTokens: ct };
}

// ── New CLI backends ──────────────────────────────────────────────────────────

function callGenericCLI(bin, extraArgs, prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeout   = opts.timeout || CALL_TIMEOUT_MS;
    const args      = [...extraArgs];
    if (opts.extraArgs) args.push(...opts.extraArgs);

    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        CI: '1',          // tell CLIs they're running non-interactively
        NO_COLOR: '1',    // disable ANSI color codes that pollute output
        TERM: 'dumb',     // disable terminal features that require TTY
        ...(opts.extraEnv || {}),
      },
    };
    if (opts.cwd) spawnOpts.cwd = opts.cwd;

    const child = spawn(bin, args, spawnOpts);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${bin} timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
        reject(new Error(`${bin} exited with code ${code}${detail ? ': ' + detail : ''}`));
        return;
      }
      trackUsage({});
      resolve(stdout.trim());
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new Error(`${bin} not found in PATH`));
      else reject(err);
    });
  });
}

function callGeminiCLI(prompt, opts = {}) {
  const cfg   = readConfig();
  const model = cfg.geminiCliModel ?? 'gemini-2.5-pro';
  return callGenericCLI('gemini', ['--model', model, '--yolo'], prompt, {
    ...opts,
    extraEnv: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
  });
}

function callCodexCLI(prompt, opts = {}) {
  const cfg   = readConfig();
  const model = cfg.codexCliModel ?? 'o4-mini';
  return callGenericCLI('codex', ['--model', model, '--quiet'], prompt, opts);
}

function callCopilotCLI(prompt, opts = {}) {
  return callGenericCLI('gh', ['copilot', 'suggest', '-t', 'shell'], prompt, opts);
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
function _openAICompatConfigForProvider(cfg, provider) {
  switch (provider) {
    case 'openai':      return { baseUrl: 'https://api.openai.com/v1', key: cfg.openaiKey, model: cfg.openaiModel ?? 'gpt-4o-mini' };
    case 'github':      return { baseUrl: 'https://models.inference.ai.azure.com', key: cfg.githubToken, model: cfg.githubModel ?? GITHUB_MODELS_DEFAULT };
    case 'gemini-api':  return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', key: cfg.geminiApiKey, model: cfg.geminiApiModel ?? 'gemini-2.5-flash' };
    case 'mistral':     return { baseUrl: 'https://api.mistral.ai/v1', key: cfg.mistralKey, model: cfg.mistralModel ?? 'mistral-small-latest' };
    case 'grok':        return { baseUrl: 'https://api.x.ai/v1', key: cfg.grokKey, model: cfg.grokModel ?? 'grok-3-mini' };
    case 'deepseek':    return { baseUrl: 'https://api.deepseek.com', key: cfg.deepseekKey, model: cfg.deepseekModel ?? 'deepseek-chat' };
    case 'groq':        return { baseUrl: 'https://api.groq.com/openai/v1', key: cfg.groqKey, model: cfg.groqModel ?? 'llama-3.3-70b-versatile' };
    case 'openrouter':  return { baseUrl: 'https://openrouter.ai/api/v1', key: cfg.openrouterKey, model: cfg.openrouterModel ?? 'anthropic/claude-3.5-sonnet' };
    case 'perplexity':  return { baseUrl: 'https://api.perplexity.ai', key: cfg.perplexityKey, model: cfg.perplexityModel ?? 'sonar-reasoning-pro' };
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
  const oaConfig = _openAICompatConfigForProvider(cfg, provider);
  if (oaConfig) {
    const { text } = await callOpenAICompatChat(messages, opts.systemPrompt || null, oaConfig, opts);
    return text;
  }

  // CLI providers: flatten conversation into a single prompt
  const lines = [];
  if (opts.systemPrompt) lines.push(`[System]: ${opts.systemPrompt}\n`);
  for (const m of messages) {
    lines.push(`[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`);
  }
  const flatPrompt = lines.join('\n\n');
  switch (provider) {
    case 'gemini-cli':  return callGeminiCLI(flatPrompt, opts);
    case 'codex-cli':   return callCodexCLI(flatPrompt, opts);
    case 'copilot-cli': return callCopilotCLI(flatPrompt, opts);
    default:            return callCLI(flatPrompt, opts);
  }
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
      max_tokens: opts.maxTokens || 4096,
      messages,
    };
    if (systemPrompt) params.system = systemPrompt;

    // Apply timeout via AbortController (Anthropic SDK supports signal)
    const timeoutMs    = opts.timeout || CALL_TIMEOUT_MS;
    const controller   = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    let result;
    try {
      result = await client.messages.create(params, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutTimer);
    }

    const usage        = result.usage || {};
    const inputTokens  = usage.input_tokens  || 0;
    const outputTokens = usage.output_tokens || 0;
    trackUsage({
      inputTokens,
      outputTokens,
      costUSD: calcAnthropicCost(result.model || MODEL, inputTokens, outputTokens),
    });
    return {
      text: result.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      inputTokens,
      outputTokens,
    };
  }

  // OpenAI-compatible providers
  const oaConfig = _openAICompatConfigForProvider(cfg, provider);
  if (oaConfig) {
    return callOpenAICompatChat(messages, systemPrompt || null, oaConfig, opts);
  }

  // CLI providers: flatten conversation to a single prompt and call in text-only mode.
  // No agentic flags (--yolo, etc.) — SubsystemCLI handles tool execution via TOOL: blocks.
  if (CLI_PROVIDERS.includes(provider)) {
    const lines = [];
    if (systemPrompt) lines.push(`[System]: ${systemPrompt}\n`);
    for (const m of messages) {
      lines.push(`[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`);
    }
    const flatPrompt = lines.join('\n\n');
    const text = await _callCLITextOnly(provider, flatPrompt, cfg, opts);
    return { text, inputTokens: 0, outputTokens: 0 };
  }

  throw new Error(`Provider "${provider}" no soportado en modo multi-turno`);
}

function _callCLITextOnly(provider, prompt, cfg, opts = {}) {
  switch (provider) {
    case 'gemini-cli': {
      const model = cfg.geminiCliModel ?? 'gemini-2.5-flash';
      return callGenericCLI('gemini', ['--model', model], prompt, opts);
    }
    case 'codex-cli':   return callCodexCLI(prompt, opts);
    case 'copilot-cli': return callCopilotCLI(prompt, opts);
    case 'aider-cli':   return callGenericCLI('aider', [], prompt, opts);
    case 'cline-cli':   return callGenericCLI('cline', [], prompt, opts);
    case 'goose-cli':   return callGenericCLI('goose', [], prompt, opts);
    default:            return callCLI(prompt, opts);
  }
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
    callAIRaw: (messages, systemPrompt, callOpts = {}) =>
      callAIChatWithTokens(messages, systemPrompt, { 
        provider, 
        timeout: callOpts.timeout,
        cwd: opts.projectPath
      }),
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
    const binMap = { 
      'cli': 'claude', 
      'gemini-cli': 'gemini', 
      'codex-cli': 'codex', 
      'copilot-cli': 'gh',
      'aider-cli': 'aider',
      'cline-cli': 'cline',
      'goose-cli': 'goose',
    };
    const bin    = binMap[provider] || provider;
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
  CLI_PROVIDERS,
  API_PROVIDERS,
  GITHUB_GROUP_PROVIDERS,
  callAI,
  callAIRich,
  calcAnthropicCost,
  adaptSystemPromptForProvider,
  generateProjectSuggestions,
  callAIChat,
  callAIChatWithTokens,
  callAIWithSubsystemCLI,
  generateAgentPrompt,
  generateSuggestions,
  getSuggestions,
  getCachedSuggestions,
  clearSuggestionsCache,
  getProviderStatus,
  testConnection,
  isCLIAvailable,
  getSessionUsage,
  resetSessionUsage,
  resetAllUsage,
};
