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
  listProjectAgents,
  hashAgent,
  hashFile,
  serializeAgent,
  serializeAgentForProvider,
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

// ── Agent copy ────────────────────────────────────────────────────────────────

/**
 * Copies applicable agents (global + section + tech) to a project.
 * If selectedAgents is provided (array of names), only those are copied.
 * Writes to every provider directory. Returns a hash map.
 */
function copyAgentsToProject(projectPath, categoryId, techId, providers = ['claude'], selectedAgents = null) {
  const allApplicable = getApplicableAgents(categoryId, techId);
  const applicable    = selectedAgents
    ? allApplicable.filter(a => selectedAgents.includes(a.name))
    : allApplicable;
  const hashes        = {};

  for (const provider of providers) {
    const agentsDir = getAgentsDirForProvider(projectPath, provider);
    ensureDir(agentsDir);
    for (const agent of applicable) {
      fs.writeFileSync(
        path.join(agentsDir, `${agent.name}.md`),
        serializeAgentForProvider(agent, provider),
        'utf8',
      );
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
  const savedHashes  = project.agentHashes || {};
  const excludedSet  = new Set(project.excludedAgents || []);
  const statusMap    = {};

  for (const agent of applicable) {
    if (excludedSet.has(agent.name)) {
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
  const applicableNames = new Set(applicable.map(a => a.name));
  const seenLocal       = new Set();
  for (const pa of listProjectAgents(project.path, providers)) {
    if (!applicableNames.has(pa.name) && !seenLocal.has(pa.name)) {
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

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Syncs a single project: copies updated and new agents to every provider dir.
 * Local (level-4) agents are never touched.
 * Returns { updated: number, added: number }
 */
function syncProject(project) {
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
      fs.writeFileSync(
        path.join(agentsDir, `${name}.md`),
        serializeAgentForProvider(entry.agent, provider),
        'utf8',
      );
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
function syncAllProjects() {
  const cfg     = readConfig();
  const results = [];

  for (const project of cfg.projects) {
    if (!fs.existsSync(project.path)) {
      results.push({ projectId: project.id, projectName: project.name, error: 'Project path not found' });
      continue;
    }
    try {
      const { updated, added } = syncProject(project);
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
function createProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }) {
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

  const allApplicable  = getApplicableAgents(categoryId, techId || null);
  const excludedAgents = selectedAgents
    ? allApplicable.filter(a => !selectedAgents.includes(a.name)).map(a => a.name)
    : [];
  const agentHashes    = copyAgentsToProject(cleanPath, categoryId, techId || null, providers, selectedAgents || null);

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
function importProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }) {
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

  const allApplicable  = getApplicableAgents(categoryId, techId || null);
  const excludedAgents = selectedAgents
    ? allApplicable.filter(a => !selectedAgents.includes(a.name)).map(a => a.name)
    : [];
  const agentHashes    = copyAgentsToProject(cleanPath, categoryId, techId || null, providers, selectedAgents || null);

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

  const allowed = ['name', 'description', 'status', 'techId', 'categoryId', 'aiProvider', 'excludedAgents'];
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createProject,
  importProject,
  updateProject,
  deleteProject,
  listProjectsWithStatus,
  getProjectSyncStatus,
  countPendingUpdates,
  syncProject,
  syncAllProjects,
  getContextFile,
  saveContextFile,
  getClaudeMd,
  saveClaudeMd,
  copyAgentsToProject,
};
