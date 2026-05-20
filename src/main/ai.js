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
    const timeout = opts.timeout || CALL_TIMEOUT_MS;

    // Use spawn with stdin pipe to avoid shell injection
    const args    = ['--print'];
    const claudeExe = 'claude';

    const child = spawn(claudeExe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // needed on Windows for PATH resolution
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    // Write prompt to stdin and close it
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI call timed out after 60s'));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
        return;
      }
      resolve(stdout.trim());
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

  const data = await response.json();
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
6. Length: 150-300 words, no headers needed, just the prompt text
${langInstr}

Output ONLY the system prompt text. No preamble, no explanation, no markdown code blocks.`;

  const result = await callAI(prompt, { maxTokens: 600 });
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
- system: string (50-150 word system prompt, plain text)

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

  const raw    = await callAI(prompt, { maxTokens: 1200 });
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  callAI,
  generateAgentPrompt,
  generateSuggestions,
  getSuggestions,
  getCachedSuggestions,
  clearSuggestionsCache,
  getProviderStatus,
  isCLIAvailable,
};
