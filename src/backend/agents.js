/**
 * agents.js — Agent file management
 *
 * Handles: parse, serialize, CRUD, SHA-256 hashing, seeding defaults.
 *
 * Claude Code agent format (required for VS Code recognition):
 *   ---
 *   name: agent-name
 *   description: Short description
 *   model: sonnet
 *   tools:
 *     - Bash
 *     - Read
 *     - Write
 *   ---
 *
 *   System prompt body here
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const { AGENTS_DIR, CACHE_DIR, getAgentDir, ensureDir } = require('./config');
const { DEFAULT_AGENTS } = require('./defaults');
const { adaptAgentForProvider, adaptFromGitHub, PROJECT_PROVIDERS } = require('./agent-adapters');
const { adaptSystemPromptForProvider } = require('./ai');

// Canonical tool names — lowercase key → canonical form
const TOOL_CANONICAL = {
  bash:              'Bash',
  read:              'Read',
  write:             'Write',
  edit:              'Edit',
  multiedit:         'MultiEdit',
  grep:              'Grep',
  webfetch:          'WebFetch',
  websearch:         'WebSearch',
  todoread:          'TodoRead',
  todowrite:         'TodoWrite',
  browser_open:      'browser_open',
  browser_navigate:  'browser_navigate',
  browser_extract:   'browser_extract',
  browser_close:     'browser_close',
  // GitHub Copilot names kept for round-trip compatibility
  codebase:              'codebase',
  terminallastcommand:   'terminalLastCommand',
  fetch:                 'fetch',
};

function sanitizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  const seen = new Set();
  const result = [];
  for (const t of tools) {
    if (typeof t !== 'string') continue;
    const clean    = t.replace(/[\[\]]/g, '').trim();
    if (!clean) continue;
    const canonical = TOOL_CANONICAL[clean.toLowerCase()] ?? clean;
    if (!seen.has(canonical)) { seen.add(canonical); result.push(canonical); }
  }
  return result;
}

// ── Model name map ────────────────────────────────────────────────────────────

const MODEL_IDS = {
  'haiku':  'claude-haiku-4-5-20251001',
  'sonnet': 'claude-sonnet-4-20250514',
  'opus':   'claude-opus-4-20250514',
};

function resolveModel(m) {
  return MODEL_IDS[m] || m || MODEL_IDS['sonnet'];
}

function shortModel(fullId) {
  for (const [short, full] of Object.entries(MODEL_IDS)) {
    if (full === fullId) return short;
  }
  return fullId;
}

// ── Parse & serialize ─────────────────────────────────────────────────────────

function parseAgentFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const m   = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!m) {
    return {
      name:        path.basename(filePath, '.md'),
      description: '',
      tools:       [],
      model:       'sonnet',
      system:      raw.trim(),
      filePath,
    };
  }

  const fm = m[1].replace(/\r/g, '');

  const get = (k) => {
    const r = fm.match(new RegExp(`^${k}:\\s*([^\\n]+)$`, 'm'));
    if (!r) return '';
    let val = r[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  };

  let rawTools = [];
  if (/^tools:\s*\n/m.test(fm)) {
    const listMatch = fm.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S+\n?)+)/m);
    if (listMatch) {
      rawTools = listMatch[1]
        .split('\n')
        .map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim())
        .filter(Boolean);
    }
  } else {
    const inlineMatch = fm.match(/^tools:\s*(.+)$/m);
    if (inlineMatch) {
      const val = inlineMatch[1].trim().replace(/^\[|\]$/g, '');
      if (val !== '') {
        rawTools = val.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  }
  const tools = sanitizeTools(rawTools);

  const rawModel = get('model');

  const skillsRaw = get('skills');
  const skillsParsed = skillsRaw
    ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const mcpRaw    = get('mcp_servers');
  const mcpParsed = mcpRaw ? mcpRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  return {
    name:        get('name') || path.basename(filePath, '.md').replace(/\.agent$/, ''),
    description: get('description'),
    tools,
    model:       shortModel(rawModel) || 'sonnet',
    optimized:   get('optimized') === 'true',
    skills:      skillsParsed.length > 0 ? skillsParsed : undefined,
    mcp_servers: mcpParsed.length > 0 ? mcpParsed : undefined,
    system:      m[2].trim(),
    filePath,
  };
}

function parseAgentFromString(content, fallbackName = 'imported-agent') {
  const raw = content.replace(/^﻿/, '');
  const m   = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!m) return { name: fallbackName, description: '', tools: [], model: 'sonnet', system: raw.trim() };

  const fm  = m[1].replace(/\r/g, '');
  const get = (k) => { const r = fm.match(new RegExp(`^${k}:\\s*([^\\n]+)$`, 'm')); return r ? r[1].trim() : ''; };

  let rawTools = [];
  if (/^tools:\s*\n/m.test(fm)) {
    const lm = fm.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S+\n?)+)/m);
    if (lm) rawTools = lm[1].split('\n').map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim()).filter(Boolean);
  } else {
    const im = fm.match(/^tools:\s*(.+)$/m);
    if (im) { const v = im[1].trim().replace(/^\[|\]$/g, ''); if (v !== '') rawTools = v.split(',').map(s => s.trim()).filter(Boolean); }
  }

  const rawModel   = get('model');
  const skillsRaw  = get('skills');
  const skillsParsed = skillsRaw ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const mcpRaw     = get('mcp_servers');
  const mcpParsed  = mcpRaw ? mcpRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  return {
    name:        get('name') || fallbackName,
    description: get('description'),
    tools:       sanitizeTools(rawTools),
    model:       shortModel(rawModel) || 'sonnet',
    optimized:   get('optimized') === 'true',
    skills:      skillsParsed.length > 0 ? skillsParsed : undefined,
    mcp_servers: mcpParsed.length > 0 ? mcpParsed : undefined,
    system:      m[2].trim(),
  };
}

function serializeAgent(agent) {
  const toolsList = sanitizeTools(agent.tools)
    .map(t => `  - ${t}`)
    .join('\n');

  const toolsBlock  = toolsList ? `tools:\n${toolsList}` : 'tools: []';
  const modelAlias  = shortModel(resolveModel(agent.model)) || 'sonnet';

  const lines = [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.description || ''}`,
    `model: ${modelAlias}`,
    toolsBlock,
  ];
  if (agent.optimized) lines.push('optimized: true');
  if (Array.isArray(agent.skills) && agent.skills.length > 0) {
    lines.push(`skills: ${agent.skills.join(', ')}`);
  }
  if (Array.isArray(agent.mcp_servers) && agent.mcp_servers.length > 0) {
    lines.push(`mcp_servers: ${agent.mcp_servers.join(', ')}`);
  }
  lines.push('---', '', agent.system || '', '');

  return lines.join('\n');
}

// ── Hash ──────────────────────────────────────────────────────────────────────

function hashAgent(agent) {
  return crypto
    .createHash('sha256')
    .update(serializeAgent(agent), 'utf8')
    .digest('hex');
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ── Directory listing ─────────────────────────────────────────────────────────

function listAgentsInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      // Plain .md files take precedence over .agent.md when names collide
      .sort((a, b) => {
        const aAgent = a.endsWith('.agent.md');
        const bAgent = b.endsWith('.agent.md');
        if (aAgent !== bAgent) return aAgent ? 1 : -1;
        return a.localeCompare(b);
      });
  } catch (err) {
    console.warn(`[agents] Could not list directory "${dir}": ${err.message}`);
    return [];
  }

  const seen  = new Set();
  const parsed = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const agent = parseAgentFile(filePath);
      if (!seen.has(agent.name)) {
        seen.add(agent.name);
        parsed.push(agent);
      }
    } catch (err) {
      console.warn(`[agents] Skipping invalid agent file "${filePath}": ${err.message}`);
    }
  }
  return parsed;
}

function listAgentsByLevel(level, categoryId) {
  const dir = getAgentDir(level, categoryId);
  if (!dir) return [];
  return listAgentsInDir(dir).map(a => ({ ...a, level, categoryId: categoryId || null }));
}

function getApplicableAgents(categoryId) {
  return [
    ...listAgentsByLevel('global'),
    ...listAgentsByLevel('section', categoryId),
  ];
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createAgent(level, categoryId, _techId, agentData) {
  const dir = getAgentDir(level, categoryId);
  if (!dir) throw new Error(`Invalid level: ${level}`);
  ensureDir(dir);

  const filePath = path.join(dir, `${agentData.name}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Agent "${agentData.name}" already exists at this level.`);
  }

  fs.writeFileSync(filePath, serializeAgent(agentData), 'utf8');
  return { ...parseAgentFile(filePath), level, categoryId };
}

function updateAgent(level, categoryId, _techId, oldName, agentData) {
  const dir = getAgentDir(level, categoryId);
  if (!dir) throw new Error(`Invalid level: ${level}`);

  const oldPath = path.join(dir, `${oldName}.md`);
  const newPath = path.join(dir, `${agentData.name}.md`);

  if (!fs.existsSync(oldPath)) throw new Error(`Agent "${oldName}" not found.`);

  if (oldName !== agentData.name && fs.existsSync(newPath)) {
    throw new Error(`Agent "${agentData.name}" already exists.`);
  }

  fs.writeFileSync(newPath, serializeAgent(agentData), 'utf8');
  if (oldName !== agentData.name) fs.unlinkSync(oldPath);

  return { ...parseAgentFile(newPath), level, categoryId };
}

function deleteAgent(level, categoryId, _techId, name) {
  const dir      = getAgentDir(level, categoryId);
  const filePath = path.join(dir, `${name}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Provider-aware helpers ────────────────────────────────────────────────────

function getAgentsDirForProvider(projectPath, provider) {
  const parts = PROJECT_PROVIDERS[provider]?.agentDir || PROJECT_PROVIDERS.claude.agentDir;
  return path.join(projectPath, ...parts);
}

function serializeAgentGitHub(agent) {
  const toolsList  = sanitizeTools(agent.tools).map(t => `  - ${t}`).join('\n');
  const toolsBlock = toolsList ? `tools:\n${toolsList}` : 'tools: []';

  const lines = [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.description || ''}`,
    `model: ${agent.model}`,
    toolsBlock,
  ];
  if (agent.optimized) lines.push('optimized: true');
  if (Array.isArray(agent.skills) && agent.skills.length > 0) {
    lines.push(`skills: ${agent.skills.join(', ')}`);
  }
  if (Array.isArray(agent.mcp_servers) && agent.mcp_servers.length > 0) {
    lines.push(`mcp_servers: ${agent.mcp_servers.join(', ')}`);
  }
  lines.push('---');

  return [
    ...lines,
    '',
    agent.system || '',
    '',
  ].join('\n');
}

function serializeAgentForProvider(agent, provider) {
  const adapted = adaptAgentForProvider(agent, provider);
  if (provider === 'github') return serializeAgentGitHub(adapted);
  return serializeAgent(adapted);
}

// ── Project-level agents ──────────────────────────────────────────────────────

function listProjectAgents(projectPath, providers = ['claude']) {
  const seen    = new Set();
  const results = [];
  for (const provider of providers) {
    const dir = getAgentsDirForProvider(projectPath, provider);
    for (const agent of listAgentsInDir(dir)) {
      if (!seen.has(agent.name)) {
        seen.add(agent.name);
        // Normalize GitHub-format tool names to Claude format so the editor
        // always works with a single canonical tool name set.
        const normalized = provider === 'github' ? adaptFromGitHub(agent) : agent;
        results.push({ ...normalized, level: 'project' });
      }
    }
  }
  return results;
}

function saveProjectAgent(projectPath, oldName, agentData, providers = ['claude']) {
  for (const provider of providers) {
    const dir = getAgentsDirForProvider(projectPath, provider);
    ensureDir(dir);
    const oldPath = path.join(dir, `${oldName}.md`);
    const newPath = path.join(dir, `${agentData.name}.md`);
    if (oldName !== agentData.name && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    fs.writeFileSync(newPath, serializeAgentForProvider(agentData, provider), 'utf8');
  }
  const firstDir   = getAgentsDirForProvider(projectPath, providers[0]);
  const newPath    = path.join(firstDir, `${agentData.name}.md`);
  const parsed     = parseAgentFile(newPath);
  const firstProv  = providers[0];
  const normalized = firstProv === 'github' ? adaptFromGitHub(parsed) : parsed;
  return { ...normalized, level: 'project' };
}

function deleteProjectAgent(projectPath, name, providers = ['claude']) {
  for (const provider of providers) {
    const filePath = path.join(getAgentsDirForProvider(projectPath, provider), `${name}.md`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// ── Migration ─────────────────────────────────────────────────────────────────

function migrateAgentFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return 0;
  let updated = 0;

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      console.warn(`[agents] Could not read directory "${dir}": ${err.message}`);
      return;
    }

    entries.forEach(f => {
      const p = path.join(dir, f);

      let stat;
      try {
        stat = fs.statSync(p);
      } catch {
        // File may have been moved/deleted while scanning.
        return;
      }

      if (stat.isDirectory()) { walk(p); return; }
      if (!f.endsWith('.md')) return;

      try {
        const agent      = parseAgentFile(p);
        const serialized = serializeAgent(agent);
        const current    = fs.readFileSync(p, 'utf8');
        if (current !== serialized) { fs.writeFileSync(p, serialized, 'utf8'); updated++; }
      } catch (err) {
        console.warn(`[agents] Skipping agent during migration "${p}": ${err.message}`);
      }
    });
  };

  walk(AGENTS_DIR);
  return updated;
}

function reseedDefaultAgents() {
  let updated = 0;

  for (const [dirKey, agents] of Object.entries(DEFAULT_AGENTS)) {
    const dir = path.join(AGENTS_DIR, dirKey);
    ensureDir(dir);

    for (const agent of agents) {
      const filePath   = path.join(dir, `${agent.name}.md`);
      const newContent = serializeAgent(agent);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        updated++;
      } else {
        const existing    = fs.readFileSync(filePath, 'utf8');
        const isOldFormat = /^tools: \w/m.test(existing) || /^model: (sonnet|haiku|opus)\b/m.test(existing);
        if (isOldFormat) { fs.writeFileSync(filePath, newContent, 'utf8'); updated++; }
      }
    }
  }

  return updated;
}

// ── Seeding ───────────────────────────────────────────────────────────────────

function seedDefaultAgents() {
  const updated = reseedDefaultAgents();
  syncGlobalAgentsToClaudeDir();
  return updated;
}

// ── Mirror globals to ~/.claude/agents/ ──────────────────────────────────────

function syncGlobalAgentsToClaudeDir() {
  const CLAUDE_AGENTS = path.join(os.homedir(), '.claude', 'agents');
  ensureDir(CLAUDE_AGENTS);

  const globalDir = path.join(AGENTS_DIR, 'global');
  if (!fs.existsSync(globalDir)) return 0;

  let sourceList = [];
  try {
    sourceList = fs.readdirSync(globalDir).filter(f => f.endsWith('.md'));
  } catch (err) {
    console.warn(`[agents] Could not read global agents directory "${globalDir}": ${err.message}`);
    return 0;
  }

  const sourceFiles = new Set(sourceList);
  let synced = 0;

  // Copy / update: source → destination
  for (const f of sourceFiles) {
    try {
      const src         = path.join(globalDir, f);
      const dest        = path.join(CLAUDE_AGENTS, f);
      const srcContent  = fs.readFileSync(src, 'utf8');
      const destContent = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
      if (srcContent !== destContent) { fs.writeFileSync(dest, srcContent, 'utf8'); synced++; }
    } catch (err) {
      console.warn(`[agents] Could not mirror global agent "${f}": ${err.message}`);
    }
  }

  // Remove orphans: files in ~/.claude/agents/ that no longer exist in agents/global/
  // Covers the case of agents deleted from the app UI or directly from VS Code
  let destFiles = [];
  try {
    destFiles = fs.readdirSync(CLAUDE_AGENTS).filter(f => f.endsWith('.md'));
  } catch (err) {
    console.warn(`[agents] Could not list Claude agents directory "${CLAUDE_AGENTS}": ${err.message}`);
    return synced;
  }

  for (const f of destFiles) {
    if (!sourceFiles.has(f)) {
      try { fs.unlinkSync(path.join(CLAUDE_AGENTS, f)); } catch { /* already gone */ }
    }
  }

  return synced;
}

// ── Async provider serialization (with AI system prompt adaptation) ───────────

const CONVERSIONS_FILE = path.join(CACHE_DIR, 'agent-conversions.json');

function readConversionsCache() {
  try { return JSON.parse(fs.readFileSync(CONVERSIONS_FILE, 'utf8')); }
  catch { return {}; }
}

function writeConversionsCache(cache) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(CONVERSIONS_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Serializes an agent for a target provider, adapting the system prompt with AI.
 * The adapted system prompt is cached by source hash — only re-generated when
 * the source agent changes.
 * Falls back to rule-based conversion if the AI call fails.
 *
 * @param {object} agent      — Claude-format agent from the source directory
 * @param {string} provider   — 'claude' | 'github'
 * @returns {Promise<string>} — file content ready to write to disk
 */
async function serializeAgentForProviderAsync(agent, provider) {
  const adapted = adaptAgentForProvider(agent, provider);

  if (provider === 'claude') return serializeAgent(adapted);

  const sourceHash = hashAgent(agent);
  const cacheKey   = `${agent.name}:${provider}:${sourceHash}`;
  const cache      = readConversionsCache();

  let system;
  if (cache[cacheKey]) {
    system = cache[cacheKey].system;
  } else {
    try {
      system = await adaptSystemPromptForProvider(agent, provider);
      cache[cacheKey] = { system, convertedAt: new Date().toISOString() };
      writeConversionsCache(cache);
    } catch {
      system = adapted.system; // rule-based fallback
    }
  }

  return provider === 'github'
    ? serializeAgentGitHub({ ...adapted, system })
    : serializeAgent({ ...adapted, system });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  parseAgentFile,
  parseAgentFromString,
  serializeAgent,
  serializeAgentForProvider,
  serializeAgentForProviderAsync,
  resolveModel,
  shortModel,
  hashAgent,
  hashFile,
  listAgentsInDir,
  listAgentsByLevel,
  getApplicableAgents,
  getAgentsDirForProvider,
  createAgent,
  updateAgent,
  deleteAgent,
  listProjectAgents,
  saveProjectAgent,
  deleteProjectAgent,
  seedDefaultAgents,
  reseedDefaultAgents,
  migrateAgentFiles,
  syncGlobalAgentsToClaudeDir,
};
