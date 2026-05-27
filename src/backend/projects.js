/**
 * projects.js — Project management and agent synchronization
 *
 * Handles: create, import, update, delete projects.
 * Agent copy: copies applicable agents (levels 1-3) to project on create/import.
 * Sync: compares source hashes vs project copies, applies updates.
 */

const fs   = require('fs');
const path = require('path');
const { readConfig, writeConfig, ensureDir } = require('./config');
const {
  getApplicableAgents,
  listAgentsByLevel,
  listProjectAgents,
  hashAgent,
  hashFile,
  serializeAgent,
  serializeAgentForProvider,
  serializeAgentForProviderAsync,
  getAgentsDirForProvider,
  parseAgentFile,
} = require('./agents');
const { getTemplate, getGitHubTemplate } = require('./templates');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProjectId() {
  return 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Provider helpers ──────────────────────────────────────────────────────────

function getProviders(project) {
  const p = project.aiProvider || 'claude';
  if (p === 'both') return ['claude', 'github'];
  return [p];
}

function getAllCatalogAgents() {
  const cfg = readConfig();
  const all = [];

  const collect = (level, categoryId, techId) => {
    try { all.push(...listAgentsByLevel(level, categoryId, techId)); }
    catch { /* ignore broken folders */ }
  };

  collect('global');
  collect('uncategorized');

  for (const cat of (cfg.categories || [])) {
    collect('section', cat.id);
    for (const tech of (cat.technologies || [])) {
      collect('tech', cat.id, tech.id);
    }
  }

  return all;
}

function buildAgentIndex() {
  const index = new Map();
  for (const agent of getAllCatalogAgents()) {
    if (!index.has(agent.name)) index.set(agent.name, agent);
  }
  return index;
}

function resolveProjectSourceAgents(categoryId, techId, includedAgents = []) {
  const applicable = getApplicableAgents(categoryId, techId);
  const byName     = new Map(applicable.map(a => [a.name, a]));
  const index      = buildAgentIndex();

  for (const name of (includedAgents || [])) {
    const extra = index.get(name);
    if (extra) byName.set(name, extra);
  }

  return [...byName.values()];
}

function resolveInitialAgentSelection(categoryId, techId, selectedAgents) {
  const applicable = getApplicableAgents(categoryId, techId);

  if (!Array.isArray(selectedAgents) || selectedAgents.length === 0) {
    return {
      agentsToCopy:   applicable,
      excludedAgents: [],
      includedAgents: [],
    };
  }

  const selectedSet     = new Set(selectedAgents);
  const applicableNames = new Set(applicable.map(a => a.name));
  const index           = buildAgentIndex();

  const agentsToCopy = [];
  for (const name of selectedSet) {
    const agent = index.get(name);
    if (agent) agentsToCopy.push(agent);
  }

  const excludedAgents = applicable
    .filter(a => !selectedSet.has(a.name))
    .map(a => a.name);

  const includedAgents = [...selectedSet]
    .filter(name => !applicableNames.has(name) && index.has(name));

  return { agentsToCopy, excludedAgents, includedAgents };
}

// ── Agent copy ────────────────────────────────────────────────────────────────

/**
 * Copies applicable agents (global + section + tech) to a project.
 * If selectedAgents is provided (array of names), only those are copied.
 * Writes to every provider directory. Returns a hash map.
 */
async function copyAgentsToProject(projectPath, categoryId, techId, providers = ['claude'], selectedAgents = null) {
  const selection = resolveInitialAgentSelection(categoryId, techId, selectedAgents);
  const applicable = selection.agentsToCopy;
  const hashes        = {};

  for (const provider of providers) {
    const agentsDir = getAgentsDirForProvider(projectPath, provider);
    ensureDir(agentsDir);
    for (const agent of applicable) {
      const content = await serializeAgentForProviderAsync(agent, provider);
      fs.writeFileSync(path.join(agentsDir, `${agent.name}.md`), content, 'utf8');
    }
  }

  for (const agent of applicable) {
    hashes[agent.name] = {
      hash:       hashAgent(agent),
      copiedAt:   new Date().toISOString(),
      level:      agent.level,
      categoryId: agent.categoryId || null,
      techId:     agent.techId     || null,
    };
  }

  return hashes;
}

// ── Sync status ───────────────────────────────────────────────────────────────

/**
 * Computes the sync status for every agent in a project.
 * An agent is 'new'/'outdated' if any configured provider dir is missing or stale.
 *
 * Status values:
 *   'ok'       — all provider copies match source
 *   'outdated' — source has changed since last copy
 *   'new'      — missing in at least one provider dir
 *   'local'    — agent only in project (level 4), no source
 *   'excluded' — agent is in the applicable set but excluded by user choice
 */
function getProjectSyncStatus(project) {
  const providers    = getProviders(project);
  const applicable   = getApplicableAgents(project.categoryId, project.techId);
  const sourceAgents = resolveProjectSourceAgents(project.categoryId, project.techId, project.includedAgents || []);
  const savedHashes  = project.agentHashes || {};
  const excludedSet  = new Set(project.excludedAgents || []);
  const statusMap    = {};

  const applicableNames = new Set(applicable.map(a => a.name));
  const sourceNames     = new Set(sourceAgents.map(a => a.name));

  for (const agent of sourceAgents) {
    const isApplicable = applicableNames.has(agent.name);
    if (isApplicable && excludedSet.has(agent.name)) {
      statusMap[agent.name] = { status: 'excluded', agent };
      continue;
    }

    const sourceHash = hashAgent(agent);
    const savedEntry = savedHashes[agent.name];

    const allPresent = providers.every(provider =>
      fs.existsSync(path.join(getAgentsDirForProvider(project.path, provider), `${agent.name}.md`)),
    );

    if (!savedEntry || !allPresent) {
      statusMap[agent.name] = { status: 'new', sourceHash, agent };
    } else {
      const firstFile = path.join(getAgentsDirForProvider(project.path, providers[0]), `${agent.name}.md`);
      statusMap[agent.name] = {
        status:      sourceHash === savedEntry.hash ? 'ok' : 'outdated',
        sourceHash,
        savedHash:   savedEntry.hash,
        projectHash: hashFile(firstFile),
        copiedAt:    savedEntry.copiedAt,
        agent,
      };
    }
  }

  // Level-4 local agents: read from all provider dirs, de-duplicate
  const seenLocal       = new Set();
  for (const pa of listProjectAgents(project.path, providers)) {
    if (!sourceNames.has(pa.name) && !seenLocal.has(pa.name)) {
      seenLocal.add(pa.name);
      statusMap[pa.name] = { status: 'local', agent: pa };
    }
  }

  return statusMap;
}

/**
 * Returns the count of pending updates for a project.
 */
function countPendingUpdates(project) {
  const status = getProjectSyncStatus(project);
  return Object.values(status).filter(s => s.status === 'outdated' || s.status === 'new').length;
}

/**
 * Builds a dry-run sync preview for a project.
 * Does not write files.
 */
function getProjectSyncPreview(project) {
  const status = getProjectSyncStatus(project);

  const asAgentItem = ([name, entry]) => ({
    name,
    level: entry.agent?.level || 'unknown',
    categoryId: entry.agent?.categoryId || null,
    techId: entry.agent?.techId || null,
  });

  const entries = Object.entries(status);
  const added = entries.filter(([, e]) => e.status === 'new').map(asAgentItem).sort((a, b) => a.name.localeCompare(b.name));
  const updated = entries.filter(([, e]) => e.status === 'outdated').map(asAgentItem).sort((a, b) => a.name.localeCompare(b.name));
  const excluded = entries.filter(([, e]) => e.status === 'excluded').map(asAgentItem).sort((a, b) => a.name.localeCompare(b.name));
  const local = entries.filter(([, e]) => e.status === 'local').map(asAgentItem).sort((a, b) => a.name.localeCompare(b.name));
  const upToDate = entries.filter(([, e]) => e.status === 'ok').map(asAgentItem).sort((a, b) => a.name.localeCompare(b.name));

  return {
    summary: {
      toAdd: added.length,
      toUpdate: updated.length,
      excluded: excluded.length,
      local: local.length,
      upToDate: upToDate.length,
      total: entries.length,
    },
    toAdd: added,
    toUpdate: updated,
    excluded,
    local,
    upToDate,
  };
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Syncs a single project: copies updated and new agents to every provider dir.
 * Local (level-4) agents are never touched.
 * Returns { updated: number, added: number }
 */
async function syncProject(project) {
  const providers = getProviders(project);
  const status    = getProjectSyncStatus(project);

  const cfg     = readConfig();
  const projIdx = cfg.projects.findIndex(p => p.id === project.id);
  if (projIdx === -1) throw new Error('Project not found in config');

  if (!cfg.projects[projIdx].agentHashes) cfg.projects[projIdx].agentHashes = {};

  let updated = 0;
  let added   = 0;

  for (const [name, entry] of Object.entries(status)) {
    if (entry.status !== 'outdated' && entry.status !== 'new') continue;

    for (const provider of providers) {
      const agentsDir = getAgentsDirForProvider(project.path, provider);
      ensureDir(agentsDir);
      const content = await serializeAgentForProviderAsync(entry.agent, provider);
      fs.writeFileSync(path.join(agentsDir, `${name}.md`), content, 'utf8');
    }

    cfg.projects[projIdx].agentHashes[name] = {
      hash:       entry.sourceHash,
      copiedAt:   new Date().toISOString(),
      level:      entry.agent.level,
      categoryId: entry.agent.categoryId || null,
      techId:     entry.agent.techId     || null,
    };

    if (entry.status === 'outdated') updated++;
    else                             added++;
  }

  cfg.projects[projIdx].lastSyncAt = new Date().toISOString();
  writeConfig(cfg);

  return { updated, added };
}

/**
 * Syncs all registered projects.
 * Returns array of { projectId, projectName, updated, added, error }
 */
async function syncAllProjects() {
  const cfg     = readConfig();
  const results = [];

  for (const project of cfg.projects) {
    if (!fs.existsSync(project.path)) {
      results.push({ projectId: project.id, projectName: project.name, error: 'Project path not found' });
      continue;
    }
    try {
      const { updated, added } = await syncProject(project);
      results.push({ projectId: project.id, projectName: project.name, updated, added });
    } catch (err) {
      results.push({ projectId: project.id, projectName: project.name, error: err.message });
    }
  }

  return results;
}

// ── Context files (CLAUDE.md / copilot-instructions.md) ──────────────────────

function getContextFilePath(project, type) {
  if (type === 'github') return path.join(project.path, '.github', 'copilot-instructions.md');
  return path.join(project.path, 'CLAUDE.md');
}

function getContextFile(project, type) {
  const filePath = getContextFilePath(project, type);
  return {
    content:  fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    filePath,
    label:    type === 'github' ? 'copilot-instructions.md' : 'CLAUDE.md',
  };
}

function saveContextFile(project, type, content) {
  const filePath = getContextFilePath(project, type);
  if (type === 'github') ensureDir(path.join(project.path, '.github'));
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Backward-compat aliases
const getClaudeMd  = (project) => getContextFile(project, 'claude');
const saveClaudeMd = (project, content) => saveContextFile(project, 'claude', content);

// ── Project CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new project: folder structure + CLAUDE.md + copies agents.
 * selectedAgents: optional array of agent names to copy; omitted agents are stored in excludedAgents.
 */
async function createProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }) {
  const cleanPath = projectPath.replace(/^~/, require('os').homedir());

  if (fs.existsSync(cleanPath)) {
    throw new Error(`Path already exists: ${cleanPath}`);
  }

  const provider  = aiProvider || 'claude';
  const providers = provider === 'both' ? ['claude', 'github'] : [provider];

  ensureDir(cleanPath);
  for (const p of providers) {
    ensureDir(getAgentsDirForProvider(cleanPath, p));
  }

  if (providers.includes('claude')) {
    fs.writeFileSync(path.join(cleanPath, 'CLAUDE.md'), getTemplate(categoryId, techId, name), 'utf8');
  }
  if (providers.includes('github')) {
    ensureDir(path.join(cleanPath, '.github'));
    fs.writeFileSync(path.join(cleanPath, '.github', 'copilot-instructions.md'), getGitHubTemplate(categoryId, techId, name), 'utf8');
  }

  const initialSelection = resolveInitialAgentSelection(categoryId, techId || null, selectedAgents || null);
  const excludedAgents = initialSelection.excludedAgents;
  const includedAgents = initialSelection.includedAgents;
  const agentHashes    = await copyAgentsToProject(cleanPath, categoryId, techId || null, providers, selectedAgents || null);

  const project = {
    id:             makeProjectId(),
    name,
    slug:           slugify(name),
    categoryId,
    techId:         techId  || null,
    description:    description || '',
    status:         status  || 'active',
    aiProvider:     provider,
    path:           cleanPath,
    agentHashes,
    excludedAgents,
    includedAgents,
    createdAt:      new Date().toISOString(),
    lastSyncAt:     new Date().toISOString(),
  };

  const cfg = readConfig();
  cfg.projects.push(project);
  writeConfig(cfg);

  return project;
}

/**
 * Imports an existing project folder.
 * Creates provider agent dirs if missing, copies applicable agents.
 * selectedAgents: optional array of agent names to copy; omitted agents are stored in excludedAgents.
 */
async function importProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }) {
  const cleanPath = projectPath.replace(/^~/, require('os').homedir());

  if (!fs.existsSync(cleanPath)) {
    throw new Error(`Path does not exist: ${cleanPath}`);
  }

  const cfg = readConfig();
  if (cfg.projects.find(p => p.path === cleanPath)) {
    throw new Error(`Project already registered: ${cleanPath}`);
  }

  const provider  = aiProvider || 'claude';
  const providers = provider === 'both' ? ['claude', 'github'] : [provider];

  for (const p of providers) {
    ensureDir(getAgentsDirForProvider(cleanPath, p));
  }

  if (providers.includes('claude')) {
    const claudeMdPath = path.join(cleanPath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, getTemplate(categoryId, techId, name), 'utf8');
    }
  }
  if (providers.includes('github')) {
    ensureDir(path.join(cleanPath, '.github'));
    const copilotPath = path.join(cleanPath, '.github', 'copilot-instructions.md');
    if (!fs.existsSync(copilotPath)) {
      fs.writeFileSync(copilotPath, getGitHubTemplate(categoryId, techId, name), 'utf8');
    }
  }

  const initialSelection = resolveInitialAgentSelection(categoryId, techId || null, selectedAgents || null);
  const excludedAgents = initialSelection.excludedAgents;
  const includedAgents = initialSelection.includedAgents;
  const agentHashes    = await copyAgentsToProject(cleanPath, categoryId, techId || null, providers, selectedAgents || null);

  const project = {
    id:             makeProjectId(),
    name,
    slug:           slugify(name),
    categoryId,
    techId:         techId  || null,
    description:    description || '',
    status:         status  || 'active',
    aiProvider:     provider,
    path:           cleanPath,
    agentHashes,
    excludedAgents,
    includedAgents,
    createdAt:      new Date().toISOString(),
    lastSyncAt:     new Date().toISOString(),
    imported:       true,
  };

  cfg.projects.push(project);
  writeConfig(cfg);

  return project;
}

/**
 * Migrates level-4 (project-local) agents when the aiProvider changes.
 * Returns { agentsMigrated: number, added: string[], removed: string[] }
 *
 * Rules:
 *   Switch (A→B)    : copy level-4 agents from A dir to B dir (format-converted). Old dir untouched.
 *   Add    (A→both) : copy level-4 agents from A dir to new B dir.
 *   Remove (both→A) : no file ops — old dir stays, just stops being managed.
 * Context files are created for added providers if they don't exist yet.
 */
function migrateProjectProvider(project, newProvider) {
  const oldProviders = getProviders(project);
  const newProviders = newProvider === 'both' ? ['claude', 'github'] : [newProvider];

  const added   = newProviders.filter(p => !oldProviders.includes(p));
  const removed = oldProviders.filter(p => !newProviders.includes(p));

  let agentsMigrated = 0;

  if (added.length > 0) {
    const sourceProvider = oldProviders[0];
    const sourceDir      = getAgentsDirForProvider(project.path, sourceProvider);

    const applicable     = getApplicableAgents(project.categoryId, project.techId);
    const applicableNames = new Set(applicable.map(a => a.name));

    for (const targetProvider of added) {
      const targetDir = getAgentsDirForProvider(project.path, targetProvider);
      ensureDir(targetDir);

      if (fs.existsSync(sourceDir)) {
        for (const file of fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'))) {
          const agentName = path.basename(file, '.md');
          if (applicableNames.has(agentName)) continue; // level 1-3, handled by sync

          const agent    = parseAgentFile(path.join(sourceDir, file));
          const destPath = path.join(targetDir, file);
          fs.writeFileSync(destPath, serializeAgentForProvider(agent, targetProvider), 'utf8');
          agentsMigrated++;
        }
      }

      // Create context file for the new provider if missing
      if (targetProvider === 'github') {
        ensureDir(path.join(project.path, '.github'));
        const dest = path.join(project.path, '.github', 'copilot-instructions.md');
        if (!fs.existsSync(dest)) {
          const claude = path.join(project.path, 'CLAUDE.md');
          fs.writeFileSync(dest, fs.existsSync(claude)
            ? fs.readFileSync(claude, 'utf8')
            : getGitHubTemplate(project.categoryId, project.techId, project.name), 'utf8');
        }
      } else if (targetProvider === 'claude') {
        const dest = path.join(project.path, 'CLAUDE.md');
        if (!fs.existsSync(dest)) {
          const copilot = path.join(project.path, '.github', 'copilot-instructions.md');
          fs.writeFileSync(dest, fs.existsSync(copilot)
            ? fs.readFileSync(copilot, 'utf8')
            : getTemplate(project.categoryId, project.techId, project.name), 'utf8');
        }
      }
    }
  }

  // Delete everything belonging to removed providers
  for (const removedProvider of removed) {
    if (removedProvider === 'claude') {
      const claudeDir = path.join(project.path, '.claude');
      const claudeMd  = path.join(project.path, 'CLAUDE.md');
      if (fs.existsSync(claudeDir)) fs.rmSync(claudeDir, { recursive: true, force: true });
      if (fs.existsSync(claudeMd))  fs.unlinkSync(claudeMd);
    } else if (removedProvider === 'github') {
      const githubDir = path.join(project.path, '.github');
      if (fs.existsSync(githubDir)) fs.rmSync(githubDir, { recursive: true, force: true });
    }
  }

  return { agentsMigrated, added, removed };
}

/**
 * Updates project metadata. When aiProvider changes, migrates level-4 agents.
 */
function updateProject(id, updates) {
  const cfg     = readConfig();
  const idx     = cfg.projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Project not found');

  let migration = null;
  if (updates.aiProvider && updates.aiProvider !== cfg.projects[idx].aiProvider) {
    migration = migrateProjectProvider(cfg.projects[idx], updates.aiProvider);
  }

  const allowed = ['name', 'description', 'status', 'techId', 'categoryId', 'aiProvider', 'excludedAgents', 'includedAgents'];
  for (const key of allowed) {
    if (updates[key] !== undefined) cfg.projects[idx][key] = updates[key];
  }

  cfg.projects[idx].updatedAt = new Date().toISOString();
  writeConfig(cfg);
  return { ...cfg.projects[idx], migration };
}

/**
 * Removes a project from config.
 * Optionally deletes the folder from disk.
 */
function deleteProject(id, deleteFolder = false) {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === id);
  if (!project) throw new Error('Project not found');

  if (deleteFolder && fs.existsSync(project.path)) {
    fs.rmSync(project.path, { recursive: true, force: true });
  }

  cfg.projects = cfg.projects.filter(p => p.id !== id);
  writeConfig(cfg);
  return { ok: true, deleted: deleteFolder };
}

/**
 * Returns all projects with their pending update counts.
 */
function listProjectsWithStatus() {
  const cfg = readConfig();
  return cfg.projects.map(project => {
    let pendingUpdates = 0;
    if (fs.existsSync(project.path)) {
      try { pendingUpdates = countPendingUpdates(project); } catch { /* ignore */ }
    }
    return { ...project, pendingUpdates, pathExists: fs.existsSync(project.path) };
  });
}

// ── Smart context detection ───────────────────────────────────────────────────

function getContextAuto(project, appAiProvider) {
  const projectProvider = project.aiProvider || appAiProvider || 'cli';
  const appGroup     = appAiProvider === 'github' ? 'github' : 'claude';
  const projectGroup = projectProvider === 'github' ? 'github' : 'claude';
  const mismatch     = appGroup !== projectGroup;
  const useType      = projectGroup;

  const ctx     = getContextFile(project, useType);
  const content = ctx.content || '';
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const isEmpty   = sizeBytes === 0;
  const isDefault = !isEmpty && sizeBytes < 300;

  let lastUpdated = null;
  try { lastUpdated = fs.statSync(ctx.filePath).mtime.toISOString(); } catch {}

  return {
    content,
    type:    useType,
    label:   ctx.label,
    filePath: ctx.filePath,
    mismatch,
    mismatchDetails: mismatch ? {
      appProvider:     appGroup,
      projectProvider: projectGroup,
      message: `La app usa ${appGroup === 'github' ? 'GitHub Copilot' : 'Claude'} pero el proyecto tiene contexto para ${projectGroup === 'github' ? 'GitHub Copilot' : 'Claude'}`,
    } : null,
    isEmpty,
    isDefault,
    sizeBytes,
    lastUpdated,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createProject,
  importProject,
  updateProject,
  deleteProject,
  listProjectsWithStatus,
  getProjectSyncStatus,
  getProjectSyncPreview,
  countPendingUpdates,
  syncProject,
  syncAllProjects,
  getContextFile,
  saveContextFile,
  getClaudeMd,
  saveClaudeMd,
  copyAgentsToProject,
  getContextAuto,
};
