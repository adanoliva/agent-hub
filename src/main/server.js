/**
 * server.js — Express HTTP server (embedded in Electron main process)
 * Phase 2: full agent, project and sync routes added.
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { readConfig, writeConfig, bootstrapDirectories, APP_DIR, getAgentDir } = require('./config');
const {
  listAgentsByLevel,
  getApplicableAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  listProjectAgents,
  saveProjectAgent,
  deleteProjectAgent,
  seedDefaultAgents,
  syncGlobalAgentsToClaudeDir,
  parseAgentFromString,
} = require('./agents');
const {
  createProject,
  importProject,
  updateProject,
  deleteProject,
  listProjectsWithStatus,
  getProjectSyncStatus,
  syncProject,
  syncAllProjects,
  getClaudeMd,
  saveClaudeMd,
} = require('./projects');

const app  = express();
const PORT = process.env.PORT || 3737;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'renderer')));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', appDir: APP_DIR });
});

// ── Config ────────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

app.put('/api/config', (req, res) => {
  const cfg = readConfig();
  const { apiKey, aiProvider, githubToken, githubModel } = req.body;
  if (apiKey       !== undefined) cfg.apiKey       = apiKey;
  if (aiProvider   !== undefined) cfg.aiProvider   = aiProvider;
  if (githubToken  !== undefined) cfg.githubToken  = githubToken;
  if (githubModel  !== undefined) cfg.githubModel  = githubModel;
  writeConfig(cfg);
  res.json({ ok: true });
});

// ── Claude CLI detection ──────────────────────────────────────────────────────

app.get('/api/detect-cli', (req, res) => {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
  exec(cmd, (err, stdout) => {
    const found = !err && stdout.trim().length > 0;
    res.json({ found, path: found ? stdout.trim().split('\n')[0] : null });
  });
});

// ── Wizard setup ──────────────────────────────────────────────────────────────

app.post('/api/setup', (req, res) => {
  const { apiKey, aiProvider } = req.body;
  const cfg = readConfig();
  if (apiKey)     cfg.apiKey     = apiKey;
  if (aiProvider) cfg.aiProvider = aiProvider;
  bootstrapDirectories(cfg);
  const created = seedDefaultAgents();
  writeConfig(cfg);
  res.json({ ok: true, appDir: APP_DIR, agentsCreated: created });
});

// ── Categories ────────────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  res.json(readConfig().categories || []);
});

app.post('/api/categories', (req, res) => {
  const { id, name, icon, color, technologies } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });

  const cfg = readConfig();
  if (cfg.categories.find(c => c.id === id)) {
    return res.status(409).json({ error: 'Category already exists' });
  }

  const category = { id, name, icon: icon || 'ti-folder', color: color || '#888', technologies: technologies || [] };
  cfg.categories.push(category);

  // Create agent directories
  bootstrapDirectories(cfg);
  writeConfig(cfg);
  res.json(category);
});

app.put('/api/categories/:id', (req, res) => {
  const cfg = readConfig();
  const idx = cfg.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Category not found' });
  cfg.categories[idx] = { ...cfg.categories[idx], ...req.body, id: req.params.id };
  writeConfig(cfg);
  res.json(cfg.categories[idx]);
});

app.delete('/api/categories/:id', (req, res) => {
  const cfg = readConfig();
  cfg.categories = cfg.categories.filter(c => c.id !== req.params.id);
  writeConfig(cfg);
  res.json({ ok: true });
});

app.post('/api/categories/:catId/technologies', (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });

  const cfg = readConfig();
  const cat = cfg.categories.find(c => c.id === req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (cat.technologies.find(t => t.id === id)) {
    return res.status(409).json({ error: 'Technology already exists' });
  }

  cat.technologies.push({ id, name });
  bootstrapDirectories(cfg);
  writeConfig(cfg);
  res.json({ id, name });
});

app.delete('/api/categories/:catId/technologies/:techId', (req, res) => {
  const cfg = readConfig();
  const cat = cfg.categories.find(c => c.id === req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  cat.technologies = cat.technologies.filter(t => t.id !== req.params.techId);
  writeConfig(cfg);
  res.json({ ok: true });
});

// ── Agent import from URL ─────────────────────────────────────────────────────

app.post('/api/agents/import-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const content = await new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? require('https') : require('http');
      lib.get(url, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          const lib2 = resp.headers.location.startsWith('https') ? require('https') : require('http');
          lib2.get(resp.headers.location, (r2) => {
            let d = '';
            r2.on('data', c => d += c);
            r2.on('end', () => resolve(d));
            r2.on('error', reject);
          }).on('error', reject);
          return;
        }
        if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
        resp.on('error', reject);
      }).on('error', reject);
    });

    const fallbackName = url.split('/').pop().replace(/\.md$/i, '') || 'imported-agent';
    const agent = parseAgentFromString(content, fallbackName);
    res.json({ ok: true, agent });
  } catch (e) {
    res.status(500).json({ error: `No se pudo obtener el agente: ${e.message}` });
  }
});

// ── Agents — levels 1-3 ───────────────────────────────────────────────────────

// GET /api/agents?level=global|section|tech&categoryId=&techId=
app.get('/api/agents', (req, res) => {
  const { level, categoryId, techId } = req.query;
  if (!level) return res.status(400).json({ error: 'level required' });
  try {
    res.json(listAgentsByLevel(level, categoryId, techId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/applicable?categoryId=&techId=
app.get('/api/agents/applicable', (req, res) => {
  const { categoryId, techId } = req.query;
  res.json(getApplicableAgents(categoryId, techId));
});

app.post('/api/agents', (req, res) => {
  const { level, categoryId, techId, agent } = req.body;
  if (!level || !agent) return res.status(400).json({ error: 'level and agent required' });
  try {
    const result = createAgent(level, categoryId, techId, agent);
    if (level === 'global') syncGlobalAgentsToClaudeDir();
    res.json(result);
  } catch (e) {
    res.status(e.message.includes('already exists') ? 409 : 500).json({ error: e.message });
  }
});

app.put('/api/agents', (req, res) => {
  const { level, categoryId, techId, oldName, agent } = req.body;
  if (!level || !oldName || !agent) return res.status(400).json({ error: 'level, oldName and agent required' });
  try {
    const result = updateAgent(level, categoryId, techId, oldName, agent);
    if (level === 'global') syncGlobalAgentsToClaudeDir();
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/agents', (req, res) => {
  const { level, categoryId, techId, name } = req.body;
  if (!level || !name) return res.status(400).json({ error: 'level and name required' });
  deleteAgent(level, categoryId, techId, name);
  if (level === 'global') syncGlobalAgentsToClaudeDir();
  res.json({ ok: true });
});

// ── Agents — project level (4) ────────────────────────────────────────────────

app.get('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(listProjectAgents(project.path));
});

app.post('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(saveProjectAgent(project.path, req.body.agent.name, req.body.agent));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(saveProjectAgent(project.path, req.body.oldName, req.body.agent));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/agents/:name', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  deleteProjectAgent(project.path, req.params.name);
  res.json({ ok: true });
});

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  try {
    res.json(listProjectsWithStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', (req, res) => {
  const { name, categoryId, techId, projectPath, description, status } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(createProject({ name, categoryId, techId, projectPath, description, status }));
  } catch (e) {
    res.status(e.message.includes('already exists') ? 409 : 500).json({ error: e.message });
  }
});

app.post('/api/projects/import', (req, res) => {
  const { name, categoryId, techId, projectPath, description, status } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(importProject({ name, categoryId, techId, projectPath, description, status }));
  } catch (e) {
    res.status(e.message.includes('not exist') ? 404 : 409).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    res.json(updateProject(req.params.id, req.body));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  const deleteFolder = req.query.deleteFolder === 'true';
  try {
    res.json(deleteProject(req.params.id, deleteFolder));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ── Sync ──────────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/sync-status', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(getProjectSyncStatus(project));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/sync', (req, res) => {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(syncProject(project));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync-all', (req, res) => {
  try {
    res.json(syncAllProjects());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CLAUDE.md ─────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/context', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(getClaudeMd(project));
});

app.put('/api/projects/:id/context', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const filePath = saveClaudeMd(project, req.body.content || '');
  res.json({ ok: true, filePath });
});

// ── AI ────────────────────────────────────────────────────────────────────────

const {
  getProviderStatus,
  generateAgentPrompt,
  getSuggestions,
  clearSuggestionsCache,
} = require('./ai');

// GET /api/ai/status — check which provider is configured and ready
app.get('/api/ai/status', async (req, res) => {
  try {
    res.json(await getProviderStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/generate-prompt — generate a full system prompt from a description
app.post('/api/ai/generate-prompt', async (req, res) => {
  const { description, name, level, categoryId, techId, tools, language, existingAgents } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });
  try {
    const system = await generateAgentPrompt({
      description, name, level, categoryId, techId, tools, language, existingAgents,
    });
    res.json({ system });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ai/suggestions?level=&categoryId=&techId= — get cached suggestions
app.get('/api/ai/suggestions', async (req, res) => {
  const { level, categoryId, techId } = req.query;
  if (!level) return res.status(400).json({ error: 'level required' });

  // Get existing agent names at this level to avoid duplicates
  const existing = (() => {
    try { return listAgentsByLevel(level, categoryId, techId).map(a => a.name); }
    catch { return []; }
  })();

  try {
    const suggestions = await getSuggestions(
      { level, categoryId, techId, existingAgents: existing },
      req.query.force === 'true',
    );
    res.json(suggestions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/suggestions/refresh — force regenerate suggestions for a level
app.post('/api/ai/suggestions/refresh', async (req, res) => {
  const { level, categoryId, techId } = req.body;
  if (!level) return res.status(400).json({ error: 'level required' });

  const existing = (() => {
    try { return listAgentsByLevel(level, categoryId, techId).map(a => a.name); }
    catch { return []; }
  })();

  try {
    const suggestions = await getSuggestions(
      { level, categoryId, techId, existingAgents: existing },
      true, // force regenerate
    );
    res.json(suggestions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ai/suggestions/cache — clear all cached suggestions
app.delete('/api/ai/suggestions/cache', (req, res) => {
  clearSuggestionsCache();
  res.json({ ok: true });
});

// ── Open in editor/explorer ───────────────────────────────────────────────────

app.post('/api/projects/:id/open-folder', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Actual shell.openPath handled via IPC in main.js
  // Return path for the renderer to call window.api.openPath()
  res.json({ path: project.path });
});

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'renderer', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[server] Running on http://localhost:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { startServer, PORT };
