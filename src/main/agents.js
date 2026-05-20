/**
 * agents.js — Agent file management
 *
 * Handles: parse, serialize, CRUD, SHA-256 hashing, seeding defaults.
 *
 * Claude Code agent format (required for VS Code recognition):
 *   ---
 *   name: agent-name
 *   description: Short description
 *   model: claude-sonnet-4-20250514
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
const { AGENTS_DIR, getAgentDir, ensureDir } = require('./config');
const { DEFAULT_AGENTS } = require('./defaults');

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
  const raw = fs.readFileSync(filePath, 'utf8');
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

  const fm = m[1];

  const get = (k) => {
    const r = fm.match(new RegExp(`^${k}:\\s*([^\\n]+)$`, 'm'));
    return r ? r[1].trim() : '';
  };

  let tools = [];
  if (/^tools:\s*\n/m.test(fm)) {
    const listMatch = fm.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S+\n?)+)/m);
    if (listMatch) {
      tools = listMatch[1]
        .split('\n')
        .map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim())
        .filter(Boolean);
    }
  } else {
    const inlineMatch = fm.match(/^tools:\s*(.+)$/m);
    if (inlineMatch) {
      const val = inlineMatch[1].trim();
      if (val !== '[]' && val !== '') {
        tools = val.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  }

  const rawModel = get('model');

  return {
    name:        get('name') || path.basename(filePath, '.md'),
    description: get('description'),
    tools,
    model:       shortModel(rawModel) || 'sonnet',
    system:      m[2].trim(),
    filePath,
  };
}

function parseAgentFromString(content, fallbackName = 'imported-agent') {
  const raw = content;
  const m   = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!m) return { name: fallbackName, description: '', tools: [], model: 'sonnet', system: raw.trim() };

  const fm  = m[1];
  const get = (k) => { const r = fm.match(new RegExp(`^${k}:\\s*([^\\n]+)$`, 'm')); return r ? r[1].trim() : ''; };

  let tools = [];
  if (/^tools:\s*\n/m.test(fm)) {
    const lm = fm.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S+\n?)+)/m);
    if (lm) tools = lm[1].split('\n').map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim()).filter(Boolean);
  } else {
    const im = fm.match(/^tools:\s*(.+)$/m);
    if (im) { const v = im[1].trim(); if (v !== '[]' && v !== '') tools = v.split(',').map(s => s.trim()).filter(Boolean); }
  }

  const rawModel = get('model');
  return {
    name:        get('name') || fallbackName,
    description: get('description'),
    tools,
    model:       shortModel(rawModel) || 'sonnet',
    system:      m[2].trim(),
  };
}

function serializeAgent(agent) {
  const toolsList = (Array.isArray(agent.tools) ? agent.tools : [])
    .filter(Boolean)
    .map(t => `  - ${t}`)
    .join('\n');

  const toolsBlock = toolsList ? `tools:\n${toolsList}` : 'tools: []';
  const modelId    = resolveModel(agent.model);

  return [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.description || ''}`,
    `model: ${modelId}`,
    toolsBlock,
    '---',
    '',
    agent.system || '',
    '',
  ].join('\n');
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
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => parseAgentFile(path.join(dir, f)));
}

function listAgentsByLevel(level, categoryId, techId) {
  const dir = getAgentDir(level, categoryId, techId);
  if (!dir) return [];
  return listAgentsInDir(dir).map(a => ({ ...a, level, categoryId: categoryId || null, techId: techId || null }));
}

function getApplicableAgents(categoryId, techId) {
  return [
    ...listAgentsByLevel('global'),
    ...listAgentsByLevel('section', categoryId),
    ...(techId ? listAgentsByLevel('tech', categoryId, techId) : []),
  ];
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createAgent(level, categoryId, techId, agentData) {
  const dir = getAgentDir(level, categoryId, techId);
  if (!dir) throw new Error(`Invalid level: ${level}`);
  ensureDir(dir);

  const filePath = path.join(dir, `${agentData.name}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Agent "${agentData.name}" already exists at this level.`);
  }

  fs.writeFileSync(filePath, serializeAgent(agentData), 'utf8');
  return { ...parseAgentFile(filePath), level, categoryId, techId };
}

function updateAgent(level, categoryId, techId, oldName, agentData) {
  const dir = getAgentDir(level, categoryId, techId);
  if (!dir) throw new Error(`Invalid level: ${level}`);

  const oldPath = path.join(dir, `${oldName}.md`);
  const newPath = path.join(dir, `${agentData.name}.md`);

  if (!fs.existsSync(oldPath)) throw new Error(`Agent "${oldName}" not found.`);

  if (oldName !== agentData.name && fs.existsSync(newPath)) {
    throw new Error(`Agent "${agentData.name}" already exists.`);
  }

  fs.writeFileSync(newPath, serializeAgent(agentData), 'utf8');
  if (oldName !== agentData.name) fs.unlinkSync(oldPath);

  return { ...parseAgentFile(newPath), level, categoryId, techId };
}

function deleteAgent(level, categoryId, techId, name) {
  const dir      = getAgentDir(level, categoryId, techId);
  const filePath = path.join(dir, `${name}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Project-level agents ──────────────────────────────────────────────────────

function listProjectAgents(projectPath) {
  const dir = path.join(projectPath, '.claude', 'agents');
  return listAgentsInDir(dir).map(a => ({ ...a, level: 'project' }));
}

function saveProjectAgent(projectPath, oldName, agentData) {
  const dir = path.join(projectPath, '.claude', 'agents');
  ensureDir(dir);

  const oldPath = path.join(dir, `${oldName}.md`);
  const newPath = path.join(dir, `${agentData.name}.md`);

  if (oldName !== agentData.name && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

  fs.writeFileSync(newPath, serializeAgent(agentData), 'utf8');
  return { ...parseAgentFile(newPath), level: 'project' };
}

function deleteProjectAgent(projectPath, name) {
  const filePath = path.join(projectPath, '.claude', 'agents', `${name}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Migration ─────────────────────────────────────────────────────────────────

function migrateAgentFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return 0;
  let updated = 0;

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { walk(p); return; }
      if (!f.endsWith('.md')) return;
      try {
        const agent      = parseAgentFile(p);
        const serialized = serializeAgent(agent);
        const current    = fs.readFileSync(p, 'utf8');
        if (current !== serialized) { fs.writeFileSync(p, serialized, 'utf8'); updated++; }
      } catch { /* skip unparseable */ }
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

  const files = fs.readdirSync(globalDir).filter(f => f.endsWith('.md'));
  let synced  = 0;

  for (const f of files) {
    const src         = path.join(globalDir, f);
    const dest        = path.join(CLAUDE_AGENTS, f);
    const srcContent  = fs.readFileSync(src, 'utf8');
    const destContent = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (srcContent !== destContent) { fs.writeFileSync(dest, srcContent, 'utf8'); synced++; }
  }

  return synced;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  parseAgentFile,
  parseAgentFromString,
  serializeAgent,
  resolveModel,
  shortModel,
  hashAgent,
  hashFile,
  listAgentsInDir,
  listAgentsByLevel,
  getApplicableAgents,
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