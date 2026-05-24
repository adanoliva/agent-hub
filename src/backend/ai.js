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

/**
 * Returns the configured AI provider and validates it's usable.
 * @returns {{ provider: 'cli'|'api', ready: boolean, reason?: string }}
 */
async function getProviderStatus() {
  const cfg = readConfig();
  const provider = cfg.aiProvider || 'cli';

  if (provider === 'cli') {
    const available = await isCLIAvailable();
    return {
      provider: 'cli',
      ready: available,
      reason: available ? null : 'Claude CLI not found in PATH. Install from claude.ai/code',
    };
  }

  if (provider === 'api') {
    const hasKey = Boolean(cfg.apiKey && cfg.apiKey.trim());
    return {
      provider: 'api',
      ready: hasKey,
      reason: hasKey ? null : 'No API key configured. Add it in Settings.',
    };
  }

  if (provider === 'github') {
    const hasToken = Boolean(cfg.githubToken && cfg.githubToken.trim());
    return {
      provider: 'github',
      ready: hasToken,
      model: cfg.githubModel || GITHUB_MODELS_DEFAULT,
      reason: hasToken ? null : 'No GitHub token configured. Add it in Settings.',
    };
  }

  return { provider, ready: false, reason: 'Unknown provider' };
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
async function callAI(prompt, opts = {}) {
  const cfg = readConfig();
  const provider = cfg.aiProvider || 'cli';

  if (provider === 'cli')    return callCLI(prompt, opts);
  if (provider === 'api')    return callAPI(prompt, cfg.apiKey, opts);
  if (provider === 'github') return callGitHub(prompt, cfg.githubToken, cfg.githubModel, opts);
  throw new Error(`Unknown AI provider: ${provider}`);
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
        // Missing agent file in CLI temp cache → surface a clear message
        if (/temp|AppData.*Local.*Temp|no such file|ENOENT|resource.*not.*found/i.test(errText)) {
          reject(new Error('El CLI de Claude no encontró un archivo de agente. Puede que hayas eliminado un agente desde VS Code o el directorio de Claude directamente. Reinicia la app para limpiar el estado.'));
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${errText}`));
        }
        return;
      }
      const raw = stdout.trim();
      try {
        const parsed = JSON.parse(raw);
        const text   = parsed.result ?? raw;
        const usage  = parsed.usage || {};
        trackUsage({
          inputTokens:  usage.input_tokens  || 0,
          outputTokens: usage.output_tokens || 0,
          costUSD:      parsed.total_cost_usd || 0,
        });
        resolve(text.trim());
      } catch {
        // Old CLI version without JSON output — use raw text, no usage data
        resolve(raw);
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
    if (response.status === 401) throw new Error('GitHub token inválido o sin permisos. Verifica el token en Ajustes.');
    if (response.status === 429) throw new Error('Límite de peticiones de GitHub Models alcanzado. Inténtalo en unos minutos.');
    throw new Error(`GitHub Models API error: ${msg}`);
  }

  const data  = await response.json();
  const usage = data.usage || {};
  trackUsage({
    inputTokens:  usage.prompt_tokens     || 0,
    outputTokens: usage.completion_tokens || 0,
  });
  return data.choices?.[0]?.message?.content || '';
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

  const prompt = `You are an expert at writing system prompts for Claude Code sub-agents.

Create a complete, professional system prompt for a Claude Code agent with the following details:

Agent name: ${name}
Brief description: ${description}
Agent level: ${levelLabels[level] || level}
${toolsNote}
${existingNote}

Requirements for the system prompt:
1. Be specific and actionable — concrete instructions, not vague principles
2. Include the agent's primary responsibilities and approach
3. Define what the agent should and should NOT do
4. Include formatting or output requirements where relevant
5. Keep it focused — this agent does ONE thing well
6. Length: 80-150 words, no headers needed, just the prompt text
${langInstr}

Output ONLY the system prompt text. No preamble, no explanation, no markdown code blocks.`;

  const result = await callAI(prompt, { maxTokens: 400 });
  return result.trim();
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

  const prompt = `You are an expert at designing Claude Code sub-agents for software development workflows.

Context: I need agent suggestions for the following level:
${context}

${existing}

Generate exactly 3 agent suggestions that would be genuinely useful at this level.
Each suggestion must be distinct and non-redundant with the existing agents above.

Respond with ONLY a valid JSON array. No markdown, no explanation, no preamble.
Each item must have exactly these fields:
- name: string (kebab-case, e.g. "unity-audio-dev")
- description: string (one sentence, max 80 chars)
- tools: array of strings from: ["Bash", "Read", "Write", "Grep", "Edit", "WebFetch", "WebSearch", "TodoRead", "TodoWrite"]
- model: string, one of: "haiku", "sonnet", "opus"
- system: string (40-80 word system prompt, plain text, concise and actionable)

Example format:
[
  {
    "name": "example-agent",
    "description": "Does one specific thing well",
    "tools": ["Read", "Write"],
    "model": "sonnet",
    "system": "You are an expert in..."
  }
]`;

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

  const prompt = `You are an expert at designing Claude Code sub-agents for software development projects.

PROJECT:
- Name: ${project.name}
- Description: ${project.description || 'Not provided'}
- Category: ${categoryName || project.categoryId || 'Unknown'}
- Technology: ${techName || project.techId || 'Unknown'}
- AI Provider: ${project.aiProvider || 'claude'}

${contextSection}

${existing}

Based on the project documentation and characteristics above, suggest exactly 3 Claude Code agents that would be GENUINELY USEFUL for THIS SPECIFIC PROJECT.
Prioritize agents that address:
1. The actual tech stack and architecture described in the documentation
2. Recurring tasks or conventions mentioned in the docs
3. Gaps not covered by the existing agents

Respond with ONLY a valid JSON array. No markdown, no explanation.
Each item must have exactly these fields:
- name: string (kebab-case, specific to the project)
- description: string (one sentence, max 80 chars, in Spanish)
- tools: array of strings from: ["Bash", "Read", "Write", "Grep", "Edit", "WebFetch", "WebSearch", "TodoRead", "TodoWrite"]
- model: string, one of: "haiku", "sonnet", "opus"
- system: string (40-80 word system prompt, plain text, in Spanish, concise and actionable)`;

  const raw    = await callAI(prompt, { maxTokens: 900 });
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
async function callAIChat(messages, opts = {}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';

  if (provider === 'api') {
    if (!cfg.apiKey) throw new Error('No API key configured');
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch { throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk'); }

    const client  = new Anthropic.default({ apiKey: cfg.apiKey });
    const params  = {
      model:      MODEL,
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

  if (provider === 'github') {
    if (!cfg.githubToken) throw new Error('No GitHub token configured');
    const body = {
      model:      cfg.githubModel || GITHUB_MODELS_DEFAULT,
      messages:   opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }, ...messages] : messages,
      max_tokens: opts.maxTokens || 1024,
    };
    const response = await fetch(GITHUB_MODELS_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${cfg.githubToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`GitHub Models error: ${err.error?.message || response.statusText}`);
    }
    const data  = await response.json();
    const usage = data.usage || {};
    trackUsage({
      inputTokens:  usage.prompt_tokens     || 0,
      outputTokens: usage.completion_tokens || 0,
    });
    return data.choices?.[0]?.message?.content || '';
  }

  // CLI: flatten conversation into a single prompt
  const lines = [];
  if (opts.systemPrompt) lines.push(`[System]: ${opts.systemPrompt}\n`);
  for (const m of messages) {
    lines.push(`[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`);
  }
  return callCLI(lines.join('\n\n'), opts);
}

// ── Agent system prompt cross-provider adaptation ─────────────────────────────

const ADAPTATION_PROMPTS = {
  github: (agent) => `You are adapting a Claude Code sub-agent's system prompt so it works correctly with GitHub Copilot in VS Code.

Agent name: ${agent.name}
Agent purpose: ${agent.description}

Original system prompt (written for Claude):
---
${agent.system}
---

Rewrite this system prompt for GitHub Copilot following these rules:
- GitHub Copilot runs inside VS Code and has access to: codebase search, terminal, GitHub repositories, file editing, fetch
- Replace Claude tool names with their GitHub Copilot equivalents where needed (e.g. "Read files" → "search the codebase", "run Bash" → "use the terminal")
- Remove any references to Claude-specific capabilities (extended thinking, etc.)
- Keep the agent's core role, expertise, tone and approach exactly the same
- Use second person ("you") consistently
- Keep the same language as the original
- Length: similar to the original (do not expand significantly)

Output ONLY the rewritten system prompt. No preamble, no explanation, no code fences.`,
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  callAI,
  adaptSystemPromptForProvider,
  generateProjectSuggestions,
  callAIChat,
  generateAgentPrompt,
  generateSuggestions,
  getSuggestions,
  getCachedSuggestions,
  clearSuggestionsCache,
  getProviderStatus,
  isCLIAvailable,
  getSessionUsage,
  resetSessionUsage,
  resetAllUsage,
};
