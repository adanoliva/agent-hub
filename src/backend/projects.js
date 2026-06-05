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
const { getContextTemplate } = require('./templates');
const { PROJECT_PROVIDERS, adaptAgentForProvider, adaptFromGitHub } = require('./agent-adapters');

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
  return project.aiProviders || ['claude'];
}

function getAllCatalogAgents() {
  const cfg = readConfig();
  const all = [];

  const collect = (level, categoryId) => {
    try { all.push(...listAgentsByLevel(level, categoryId)); }
    catch { /* ignore broken folders */ }
  };

  collect('global');
  collect('uncategorized');

  for (const cat of (cfg.categories || [])) {
    collect('section', cat.id);
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

function resolveProjectSourceAgents(categoryId, includedAgents = []) {
  const applicable = getApplicableAgents(categoryId);
  const byName     = new Map(applicable.map(a => [a.name, a]));
  const index      = buildAgentIndex();

  for (const name of (includedAgents || [])) {
    const extra = index.get(name);
    if (extra) byName.set(name, extra);
  }

  return [...byName.values()];
}

function resolveInitialAgentSelection(categoryId, selectedAgents) {
  const applicable = getApplicableAgents(categoryId);

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
async function copyAgentsToProject(projectPath, categoryId, providers = ['claude'], selectedAgents = null) {
  const selection  = resolveInitialAgentSelection(categoryId, selectedAgents);
  const applicable = selection.agentsToCopy;

  for (const provider of providers) {
    ensureDir(getAgentsDirForProvider(projectPath, provider));
  }

  // Serialize all agents for all providers in parallel
  await Promise.all(
    applicable.flatMap(agent =>
      providers.map(async provider => {
        const content = await serializeAgentForProviderAsync(agent, provider);
        fs.writeFileSync(
          path.join(getAgentsDirForProvider(projectPath, provider), `${agent.name}.md`),
          content, 'utf8',
        );
      }),
    ),
  );

  const now = new Date().toISOString();
  const hashes = Object.fromEntries(
    applicable.map(agent => [agent.name, {
      hash:       hashAgent(agent),
      copiedAt:   now,
      level:      agent.level,
      categoryId: agent.categoryId || null,
    }]),
  );
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
  const applicable   = getApplicableAgents(project.categoryId);
  const sourceAgents = resolveProjectSourceAgents(project.categoryId, project.includedAgents || []);
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

// ── Context files ─────────────────────────────────────────────────────────────

function getContextFilePath(project, providerId) {
  const config = PROJECT_PROVIDERS[providerId] || PROJECT_PROVIDERS.central;
  return path.join(project.path, ...config.contextFile.split('/'));
}

function getContextFile(project, providerId) {
  // If we want a specific provider context but it doesn't exist, we fallback to central
  let filePath = getContextFilePath(project, providerId);
  if (providerId !== 'central' && !fs.existsSync(filePath)) {
    filePath = getContextFilePath(project, 'central');
  }

  const config = PROJECT_PROVIDERS[providerId] || PROJECT_PROVIDERS.central;
  return {
    content:  fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    filePath,
    label:    config.contextFile.split('/').pop(),
    providerId,
  };
}

function saveContextFile(project, providerId, content) {
  // 1. Always save to the central CONTEXTO.md
  const centralPath = getContextFilePath(project, 'central');
  ensureDir(path.dirname(centralPath));
  fs.writeFileSync(centralPath, content, 'utf8');

  // 2. Also save to all active providers in the project
  const providers = getProviders(project);
  for (const p of providers) {
    const filePath = getContextFilePath(project, p);
    const dir = path.dirname(filePath);
    ensureDir(dir);
    fs.writeFileSync(filePath, content, 'utf8');
  }
  
  return centralPath;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new project: folder structure + context files + copies agents.
 * selectedAgents: optional array of agent names to copy.
 */
async function createProject({ name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills }) {
  const expandedPath = projectPath.replace(/^~/, require('os').homedir());
  const cleanPath    = path.resolve(expandedPath);

  if (fs.existsSync(cleanPath)) {
    throw new Error(`Path already exists: ${cleanPath}`);
  }

  const providers = Array.isArray(aiProviders) && aiProviders.length > 0 ? aiProviders : ['claude'];

  ensureDir(cleanPath);

  // Initialize with central context
  const centralContent = getContextTemplate('claude', categoryId, null, name);
  saveContextFile({ path: cleanPath, aiProviders: providers }, 'central', centralContent);

  for (const p of providers) {
    ensureDir(getAgentsDirForProvider(cleanPath, p));
  }

  const initialSelection = resolveInitialAgentSelection(categoryId, selectedAgents || null);
  const excludedAgents = initialSelection.excludedAgents;
  const includedAgents = initialSelection.includedAgents;
  const agentHashes    = await copyAgentsToProject(cleanPath, categoryId, providers, selectedAgents || null);

  const project = {
    id:             makeProjectId(),
    name,
    slug:           slugify(name),
    categoryId,
    skills:         Array.isArray(skills) ? skills : [],
    description:    description || '',
    status:         status  || 'active',
    aiProviders:    providers,
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
 */
async function importProject({ name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills }) {
  const expandedPath = projectPath.replace(/^~/, require('os').homedir());
  const cleanPath    = path.resolve(expandedPath);

  if (!fs.existsSync(cleanPath)) {
    throw new Error(`Path does not exist: ${cleanPath}`);
  }

  const cfg = readConfig();
  if (cfg.projects.find(p => p.path === cleanPath)) {
    throw new Error(`Project already registered: ${cleanPath}`);
  }

  const providers = Array.isArray(aiProviders) && aiProviders.length > 0 ? aiProviders : ['claude'];

  // Ensure central context exists or try to adopt existing one
  const centralPath = getContextFilePath({ path: cleanPath }, 'central');
  if (!fs.existsSync(centralPath)) {
    // Try to adopt from an existing provider context
    let adopted = false;
    for (const p of ['claude', 'github', 'gemini', 'openai']) {
      const pPath = getContextFilePath({ path: cleanPath }, p);
      if (fs.existsSync(pPath)) {
        fs.copyFileSync(pPath, centralPath);
        adopted = true;
        break;
      }
    }
    if (!adopted) {
      const content = getContextTemplate('claude', categoryId, null, name);
      fs.writeFileSync(centralPath, content, 'utf8');
    }
  }

  // Now that central exists, sync it to all providers
  const centralContent = fs.readFileSync(centralPath, 'utf8');
  saveContextFile({ path: cleanPath, aiProviders: providers }, 'central', centralContent);

  for (const p of providers) {
    ensureDir(getAgentsDirForProvider(cleanPath, p));
  }

  const initialSelection = resolveInitialAgentSelection(categoryId, selectedAgents || null);
  const excludedAgents = initialSelection.excludedAgents;
  const includedAgents = initialSelection.includedAgents;
  const agentHashes    = await copyAgentsToProject(cleanPath, categoryId, providers, selectedAgents || null);

  const project = {
    id:             makeProjectId(),
    name,
    slug:           slugify(name),
    categoryId,
    skills:         Array.isArray(skills) ? skills : [],
    description:    description || '',
    status:         status  || 'active',
    aiProviders:    providers,
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
 * Migrates project-local agents and context files when aiProviders changes.
 */
function migrateProjectProviders(project, newProviders) {
  const oldProviders = getProviders(project);
  const added   = newProviders.filter(p => !oldProviders.includes(p));
  const removed = oldProviders.filter(p => !newProviders.includes(p));

  let agentsMigrated = 0;

  if (added.length > 0 && oldProviders.length > 0) {
    const sourceProvider = oldProviders[0];
    const sourceDir      = getAgentsDirForProvider(project.path, sourceProvider);
    const applicable     = getApplicableAgents(project.categoryId);
    const applicableNames = new Set(applicable.map(a => a.name));

    for (const targetProvider of added) {
      const targetDir = getAgentsDirForProvider(project.path, targetProvider);
      ensureDir(targetDir);

      if (fs.existsSync(sourceDir)) {
        for (const file of fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'))) {
          const agentName = path.basename(file, '.md');
          if (applicableNames.has(agentName)) continue;

          const agent    = parseAgentFile(path.join(sourceDir, file));
          const destPath = path.join(targetDir, file);
          fs.writeFileSync(destPath, serializeAgentForProvider(agent, targetProvider), 'utf8');
          agentsMigrated++;
        }
      }

      // Create context file for new provider
      const filePath = getContextFilePath(project, targetProvider);
      if (!fs.existsSync(filePath)) {
        const sourceProvider = oldProviders[0];
        const sourcePath = getContextFilePath(project, sourceProvider);
        const content = fs.existsSync(sourcePath)
          ? fs.readFileSync(sourcePath, 'utf8')
          : getContextTemplate(targetProvider, project.categoryId, project.techId, project.name);
        saveContextFile(project, targetProvider, content);
      }
    }
  }

  // Remove data for removed providers
  for (const p of removed) {
    const config = PROJECT_PROVIDERS[p];
    if (config) {
      // Remove agents dir
      const dir = getAgentsDirForProvider(project.path, p);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      // Remove context file
      const ctx = getContextFilePath(project, p);
      if (fs.existsSync(ctx)) fs.unlinkSync(ctx);
      
      // Cleanup parent .claude/.github/.gemini if empty?
      // For now we keep it simple.
    }
  }

  return { agentsMigrated, added, removed };
}

/**
 * Updates project metadata.
 */
async function updateProject(id, updates) {
  const cfg     = readConfig();
  const idx     = cfg.projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Project not found');

  const project = cfg.projects[idx];
  let migration = null;

  if (updates.aiProviders && JSON.stringify(updates.aiProviders) !== JSON.stringify(project.aiProviders)) {
    migration = migrateProjectProviders(project, updates.aiProviders);
  }

  const allowed = ['name', 'description', 'status', 'categoryId', 'skills', 'aiProviders', 'excludedAgents', 'includedAgents', 'gitEnabled'];
  for (const key of allowed) {
    if (updates[key] !== undefined) project[key] = updates[key];
  }

  project.updatedAt = new Date().toISOString();
  writeConfig(cfg);

  // If providers changed, trigger a sync to ensure all agents are in the new locations
  if (migration && (migration.added.length > 0)) {
    try { 
      await syncProject(project); 
      // Force context sync for all providers
      const mainProvider = project.aiProviders[0];
      const ctx = getContextFile(project, mainProvider);
      if (ctx.content) saveContextFile(project, mainProvider, ctx.content);
    } catch (e) { 
      console.error('Sync failed after provider update:', e.message); 
    }
  }

  return { ...project, migration };
}

/**
 * Removes a project from config.
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
  const providers = getProviders(project);
  
  // Map appAiProvider to project provider type
  let useType = 'claude'; // default
  if (appAiProvider === 'github' || appAiProvider === 'copilot-cli') useType = 'github';
  else if (appAiProvider === 'gemini-cli' || appAiProvider === 'gemini-api') useType = 'gemini';
  else if (appAiProvider === 'openai') useType = 'openai';

  // Check if project has this type
  const hasSelected = providers.includes(useType);
  if (!hasSelected) {
    // Fallback to first available in project
    useType = providers[0];
  }

  const mismatch = hasSelected ? false : true;
  const ctx      = getContextFile(project, useType);
  const content  = ctx.content || '';
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const isEmpty   = sizeBytes === 0;
  const isDefault = !isEmpty && sizeBytes < 300;

  let lastUpdated = null;
  try { lastUpdated = fs.statSync(ctx.filePath).mtime.toISOString(); } catch {}

  return {
    content,
    type:     useType,
    label:    ctx.label,
    filePath: ctx.filePath,
    mismatch,
    mismatchDetails: mismatch ? {
      appProvider:     appAiProvider,
      projectProvider: useType,
      message: `La app usa ${appAiProvider} pero el proyecto no tiene contexto para este proveedor. Usando ${useType} como alternativa.`,
    } : null,
    isEmpty,
    isDefault,
    sizeBytes,
    lastUpdated,
  };
}

// Backward-compat aliases
const getClaudeMd  = (project) => getContextFile(project, 'claude');
const saveClaudeMd = (project, content) => saveContextFile(project, 'claude', content);

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
  getContextFilePath,
  saveContextFile,
  getClaudeMd,
  saveClaudeMd,
  copyAgentsToProject,
  getContextAuto,
};
