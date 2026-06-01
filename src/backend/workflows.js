/**
 * workflows.js — CRUD for orchestration definitions
 *
 * Each orchestration is stored as a JSON file in:
 *   {projectPath}/.agent-hub/orchestrations/{id}.json
 *
 * Execution history lives in:
 *   {projectPath}/.agent-hub/executions/{timestamp}-{id}/
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getOrchDir(projectPath) {
  return path.join(projectPath, '.agent-hub', 'orchestrations');
}

function getExecDir(projectPath) {
  return path.join(projectPath, '.agent-hub', 'executions');
}

function generateId() {
  return `orch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Create a new orchestration for a project.
 */
function create(projectId, projectPath, data) {
  const id = generateId();
  const now = new Date().toISOString();

  const defaultInputNode = data.inputNode || {
    id:           `input-node-${Date.now()}`,
    from:         -1,
    to:           0,
    dataFlow:     { agentOutput: false, filesModified: false, projectContext: true },
    contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
  };

  const orch = {
    id,
    projectId,
    name:        data.name        || 'Nueva orquestación',
    description: data.description || '',
    enabled:     true,
    agents:      Array.isArray(data.agents) ? data.agents : [],
    nodes:       Array.isArray(data.nodes)  ? data.nodes  : [],
    inputNode:   defaultInputNode,
    executionConfig: {
      stopOnError:           true,
      validateAfterEachStep: false,
      maxTurns:              10,
      timeout:               300000,
      ...(data.executionConfig || {}),
    },
    createdAt:      now,
    updatedAt:      now,
    executionCount: 0,
  };
  const dir = getOrchDir(projectPath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(orch, null, 2), 'utf8');
  return orch;
}

/**
 * Read an orchestration by id from a project path.
 */
function read(orchestrationId, projectPath) {
  const filePath = path.join(getOrchDir(projectPath), `${orchestrationId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Update an orchestration by id.
 */
function update(orchestrationId, projectPath, data) {
  const orch = read(orchestrationId, projectPath);
  if (!orch) throw new Error(`Orchestration "${orchestrationId}" not found`);
  const updated = {
    ...orch,
    ...data,
    id:        orchestrationId,
    projectId: orch.projectId,
    updatedAt: new Date().toISOString(),
  };
  const dir = getOrchDir(projectPath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${orchestrationId}.json`), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

/**
 * Delete an orchestration by id.
 */
function remove(orchestrationId, projectPath) {
  const filePath = path.join(getOrchDir(projectPath), `${orchestrationId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * List all orchestrations for a project, sorted newest-first.
 */
function list(projectPath) {
  const dir = getOrchDir(projectPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('.'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ── Execution history ─────────────────────────────────────────────────────────

/**
 * List execution metadata summaries for a given orchestration.
 */
function getExecutions(orchestrationId, projectPath) {
  const execDir = getExecDir(projectPath);
  if (!fs.existsSync(execDir)) return [];
  return fs.readdirSync(execDir)
    .filter(d => {
      try {
        return fs.statSync(path.join(execDir, d)).isDirectory();
      } catch { return false; }
    })
    .map(d => {
      const metaPath = path.join(execDir, d, 'metadata.json');
      if (!fs.existsSync(metaPath)) return null;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return meta.orchestrationId === orchestrationId ? meta : null;
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

/**
 * Get a full execution result by executionId.
 */
function getExecution(executionId, projectPath) {
  const execDir = getExecDir(projectPath);
  if (!fs.existsSync(execDir)) return null;
  for (const d of fs.readdirSync(execDir)) {
    const metaPath = path.join(execDir, d, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.executionId === executionId) {
        const resultPath = path.join(execDir, d, 'result.json');
        if (fs.existsSync(resultPath)) {
          return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        }
        return meta;
      }
    } catch {}
  }
  return null;
}

/**
 * Find the directory of a specific execution.
 */
function findExecutionDir(executionId, projectPath) {
  const execDir = getExecDir(projectPath);
  if (!fs.existsSync(execDir)) return null;
  for (const d of fs.readdirSync(execDir)) {
    const metaPath = path.join(execDir, d, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.executionId === executionId) return path.join(execDir, d);
    } catch {}
  }
  return null;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  create,
  read,
  update,
  delete: remove,
  list,
  getExecutions,
  getExecution,
  findExecutionDir,
  getExecDir,
};
