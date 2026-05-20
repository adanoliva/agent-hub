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
  parseAgentFile,
} = require('./agents');
const { getTemplate } = require('./templates');

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

// ── Agent copy ────────────────────────────────────────────────────────────────

/**
 * Copies all applicable agents (global + section + tech) to a project.
 * Returns a hash map: { agentName: { hash, copiedAt, level, categoryId, techId } }
 */
function copyAgentsToProject(projectPath, categoryId, techId) {
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  ensureDir(agentsDir);

  const applicable = getApplicableAgents(categoryId, techId);
  const hashes     = {};

  for (const agent of applicable) {
    const destPath = path.join(agentsDir, `${agent.name}.md`);
    const content  = serializeAgent(agent);

    fs.writeFileSync(destPath, content, 'utf8');
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
 *
 * Status values:
 *   'ok'       — project copy matches source
 *   'outdated' — source has changed since copy
 *   'new'      — source agent doesn't exist in project yet
 *   'removed'  — source agent was deleted but copy still exists
 *   'local'    — agent only in project (level 4), no source
 */
function getProjectSyncStatus(project) {
  const applicable   = getApplicableAgents(project.categoryId, project.techId);
  const projectAgents = listProjectAgents(project.path);
  const savedHashes  = project.agentHashes || {};

  const statusMap = {};

  // Check each applicable (source) agent
  for (const agent of applicable) {
    const sourceHash  = hashAgent(agent);
    const savedEntry  = savedHashes[agent.name];
    const projectFile = path.join(project.path, '.claude', 'agents', `${agent.name}.md`);

    if (!savedEntry || !fs.existsSync(projectFile)) {
      statusMap[agent.name] = {
        status:     'new',
        sourceHash,
        agent,
      };
    } else {
      const currentProjectHash = hashFile(projectFile);
      statusMap[agent.name] = {
        status:      sourceHash === savedEntry.hash ? 'ok' : 'outdated',
        sourceHash,
        savedHash:   savedEntry.hash,
        projectHash: currentProjectHash,
        copiedAt:    savedEntry.copiedAt,
        agent,
      };
    }
  }

  // Check project agents that don't have a source (level 4 / local)
  const applicableNames = new Set(applicable.map(a => a.name));
  for (const pa of projectAgents) {
    if (!applicableNames.has(pa.name)) {
      statusMap[pa.name] = {
        status: 'local',
        agent:  pa,
      };
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
 * Syncs a single project: copies updated and new agents from source.
 * Local (level-4) agents are never touched.
 * Returns { updated: number, added: number }
 */
function syncProject(project) {
  const status    = getProjectSyncStatus(project);
  const agentsDir = path.join(project.path, '.claude', 'agents');
  ensureDir(agentsDir);

  const cfg     = readConfig();
  const projIdx = cfg.projects.findIndex(p => p.id === project.id);
  if (projIdx === -1) throw new Error('Project not found in config');

  if (!cfg.projects[projIdx].agentHashes) {
    cfg.projects[projIdx].agentHashes = {};
  }

  let updated = 0;
  let added   = 0;

  for (const [name, entry] of Object.entries(status)) {
    if (entry.status === 'outdated') {
      const destPath = path.join(agentsDir, `${name}.md`);
      fs.writeFileSync(destPath, serializeAgent(entry.agent), 'utf8');
      cfg.projects[projIdx].agentHashes[name] = {
        hash:       entry.sourceHash,
        copiedAt:   new Date().toISOString(),
        level:      entry.agent.level,
        categoryId: entry.agent.categoryId || null,
        techId:     entry.agent.techId     || null,
      };
      updated++;
    }

    if (entry.status === 'new') {
      const destPath = path.join(agentsDir, `${name}.md`);
      fs.writeFileSync(destPath, serializeAgent(entry.agent), 'utf8');
      cfg.projects[projIdx].agentHashes[name] = {
        hash:       entry.sourceHash,
        copiedAt:   new Date().toISOString(),
        level:      entry.agent.level,
        categoryId: entry.agent.categoryId || null,
        techId:     entry.agent.techId     || null,
      };
      added++;
    }
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

// ── CLAUDE.md ─────────────────────────────────────────────────────────────────

function getClaudeMd(project) {
  const filePath = path.join(project.path, 'CLAUDE.md');
  return {
    content:  fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
    filePath,
  };
}

function saveClaudeMd(project, content) {
  const filePath = path.join(project.path, 'CLAUDE.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new project: folder structure + CLAUDE.md + copies agents.
 */
function createProject({ name, categoryId, techId, projectPath, description, status }) {
  const cleanPath = projectPath.replace(/^~/, require('os').homedir());

  if (fs.existsSync(cleanPath)) {
    throw new Error(`Path already exists: ${cleanPath}`);
  }

  // Create folder structure
  ensureDir(cleanPath);
  ensureDir(path.join(cleanPath, '.claude', 'agents'));

  // Write CLAUDE.md with template
  const claudeMd = getTemplate(categoryId, techId, name);
  fs.writeFileSync(path.join(cleanPath, 'CLAUDE.md'), claudeMd, 'utf8');

  // Copy applicable agents + get hashes
  const agentHashes = copyAgentsToProject(cleanPath, categoryId, techId || null);

  // Register in config
  const project = {
    id:          makeProjectId(),
    name,
    slug:        slugify(name),
    categoryId,
    techId:      techId  || null,
    description: description || '',
    status:      status  || 'active',
    path:        cleanPath,
    agentHashes,
    createdAt:   new Date().toISOString(),
    lastSyncAt:  new Date().toISOString(),
  };

  const cfg = readConfig();
  cfg.projects.push(project);
  writeConfig(cfg);

  return project;
}

/**
 * Imports an existing project folder.
 * Adds .claude/agents/ if missing, copies applicable agents.
 */
function importProject({ name, categoryId, techId, projectPath, description, status }) {
  const cleanPath = projectPath.replace(/^~/, require('os').homedir());

  if (!fs.existsSync(cleanPath)) {
    throw new Error(`Path does not exist: ${cleanPath}`);
  }

  // Check not already registered
  const cfg = readConfig();
  if (cfg.projects.find(p => p.path === cleanPath)) {
    throw new Error(`Project already registered: ${cleanPath}`);
  }

  // Ensure .claude/agents/ exists
  ensureDir(path.join(cleanPath, '.claude', 'agents'));

  // Write CLAUDE.md only if it doesn't exist
  const claudeMdPath = path.join(cleanPath, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, getTemplate(categoryId, techId, name), 'utf8');
  }

  // Copy applicable agents
  const agentHashes = copyAgentsToProject(cleanPath, categoryId, techId || null);

  const project = {
    id:          makeProjectId(),
    name,
    slug:        slugify(name),
    categoryId,
    techId:      techId  || null,
    description: description || '',
    status:      status  || 'active',
    path:        cleanPath,
    agentHashes,
    createdAt:   new Date().toISOString(),
    lastSyncAt:  new Date().toISOString(),
    imported:    true,
  };

  cfg.projects.push(project);
  writeConfig(cfg);

  return project;
}

/**
 * Updates project metadata (name, description, status, techId).
 * Does NOT change the path.
 */
function updateProject(id, updates) {
  const cfg     = readConfig();
  const idx     = cfg.projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Project not found');

  const allowed = ['name', 'description', 'status', 'techId', 'categoryId'];
  for (const key of allowed) {
    if (updates[key] !== undefined) cfg.projects[idx][key] = updates[key];
  }

  cfg.projects[idx].updatedAt = new Date().toISOString();
  writeConfig(cfg);
  return cfg.projects[idx];
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
  getClaudeMd,
  saveClaudeMd,
  copyAgentsToProject,
};
