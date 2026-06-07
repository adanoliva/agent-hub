/**
 * server.js — Express HTTP server (embedded in Electron main process)
 * Phase 2: full agent, project and sync routes added.
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { readConfig, writeConfig, bootstrapDirectories, APP_DIR, getAgentDir } = require('./config');
const prompts = require('./prompts');
const apiFs   = require('./api-fs');
const browser = require('./browser');
const {
  listAgentsByLevel,
  getApplicableAgents,
  getAgentsDirForProvider,
  parseAgentFile,
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
const agentsSync = require('./agents-sync');
const {
  createProject,
  importProject,
  updateProject,
  deleteProject,
  listProjectsWithStatus,
  getProjectSyncStatus,
  getProjectSyncPreview,
  syncProject,
  syncAllProjects,
  getContextFile,
  getContextFilePath,
  saveContextFile,
  getContextAuto,
} = require('./projects');
const { PROJECT_PROVIDERS } = require('./agent-adapters');

const app  = express();
const PORT = process.env.PORT || 3737;

app.use(cors());
app.use(express.json());
const RENDERER_DIR = path.join(__dirname, '..', '..', 'dist', 'renderer');
app.use(express.static(RENDERER_DIR));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', appDir: APP_DIR });
});

// ── Config ────────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

const CONFIG_ALLOWED_FIELDS = [
  'apiKey', 'apiModel',
  'openaiKey', 'openaiModel',
  'githubToken', 'githubModel',
  'geminiApiKey', 'geminiApiModel',
  'mistralKey', 'mistralModel',
  'grokKey', 'grokModel',
  'geminiCliModel', 'codexCliModel',
  'closeAction',
  'agentsDirectoryUrl', 'agentsDirectoryEnabled',
];

app.put('/api/config', (req, res) => {
  const cfg  = readConfig();
  const body = req.body;

  if (body.aiProvider !== undefined) {
    if (body.aiProvider !== cfg.aiProvider) resetAllUsage();
    cfg.aiProvider = body.aiProvider;
  }

  for (const field of CONFIG_ALLOWED_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === 'closeAction' && !['ask','tray','quit'].includes(body[field])) continue;
    if (field === 'agentsDirectoryEnabled') { cfg[field] = Boolean(body[field]); continue; }
    cfg[field] = body[field];
  }

  writeConfig(cfg);
  res.json({ ok: true });
});

// ── CLI detection ─────────────────────────────────────────────────────────────

function whichCLI(bin) {
  const { exec } = require('child_process');
  const isWin = process.platform === 'win32';
  const cmd = isWin ? `where ${bin}` : `which ${bin}`;
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      const found = !err && stdout.trim().length > 0;
      resolve({ found, path: found ? stdout.trim().split('\n')[0] : null });
    });
  });
}

app.get('/api/detect-cli', async (req, res) => {
  const [claude, gemini, codex, gh] = await Promise.all([
    whichCLI('claude'),
    whichCLI('gemini'),
    whichCLI('codex'),
    whichCLI('gh'),
  ]);
  const checks = {
    'cli':         claude,
    'gemini-cli':  gemini,
    'codex-cli':   codex,
    'copilot-cli': gh,
  };
  const provider = readConfig().aiProvider;
  res.json({ found: !!(checks[provider]?.found), checks });
});

// ── Wizard setup ──────────────────────────────────────────────────────────────

app.post('/api/setup', (req, res) => {
  const { apiKey, aiProvider } = req.body;
  const cfg = readConfig();
  if (apiKey)     cfg.apiKey     = apiKey;
  if (aiProvider) cfg.aiProvider = aiProvider;
  bootstrapDirectories(cfg);
  writeConfig(cfg);
  // Trigger directory sync after wizard completes (non-blocking)
  if (cfg.agentsDirectoryEnabled !== false) {
    const agentsSync = require('./agents-sync');
    const url = cfg.agentsDirectoryUrl || 'https://github.com/adanoliva/agents-directory';
    agentsSync.triggerSync(url, !agentsSync.metaExists()).catch(() => {});
  }
  res.json({ ok: true, appDir: APP_DIR, agentsCreated: 0 });
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

// ── Agents Directory ──────────────────────────────────────────────────────────

app.get('/api/agents-directory/status', (req, res) => {
  const cfg   = readConfig();
  const state = agentsSync.getSyncState();
  const meta  = agentsSync.readMeta();
  res.json({
    enabled:          cfg.agentsDirectoryEnabled !== false,
    url:              cfg.agentsDirectoryUrl || 'https://github.com/adanoliva/agents-directory',
    syncing:          state.syncing,
    firstSync:        state.firstSync,
    progress:         state.progress,
    lastSync:         meta?.lastSync || null,
    repoCommitSHA:    meta?.repoCommitSHA || null,
    agentCount:       Object.keys(meta?.files || {}).length,
    pendingConflicts: state.pendingConflicts,
    lastResult:       state.lastResult,
  });
});

app.post('/api/agents-directory/sync', (req, res) => {
  const cfg = readConfig();
  if (cfg.agentsDirectoryEnabled === false) {
    return res.status(400).json({ error: 'Directorio de agentes desactivado' });
  }
  const url = cfg.agentsDirectoryUrl || 'https://github.com/adanoliva/agents-directory';
  agentsSync.triggerSync(url, false).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/agents-directory/resolve-conflict', async (req, res) => {
  const { fileKey, action } = req.body;
  if (!fileKey || !['keep', 'update'].includes(action)) {
    return res.status(400).json({ error: 'fileKey y action (keep|update) son obligatorios' });
  }
  const cfg = readConfig();
  const url = cfg.agentsDirectoryUrl || 'https://github.com/adanoliva/agents-directory';
  try {
    await agentsSync.resolveConflict(fileKey, action, url);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// GET /api/agents/applicable?projectId= OR ?categoryId=
app.get('/api/agents/applicable', (req, res) => {
  let { categoryId, projectId } = req.query;
  if (projectId && !categoryId) {
    const project = readConfig().projects.find(p => p.id === projectId);
    if (project) categoryId = project.categoryId;
  }
  res.json(getApplicableAgents(categoryId));
});

app.post('/api/agents', (req, res) => {
  const { level, categoryId, agent } = req.body;
  if (!level || !agent) return res.status(400).json({ error: 'level and agent required' });
  try {
    const result = createAgent(level, categoryId, null, agent);
    if (level === 'global') syncGlobalAgentsToClaudeDir();
    res.json(result);
  } catch (e) {
    res.status(e.message.includes('already exists') ? 409 : 500).json({ error: e.message });
  }
});

app.put('/api/agents', (req, res) => {
  const { level, categoryId, oldName, agent } = req.body;
  if (!level || !oldName || !agent) return res.status(400).json({ error: 'level, oldName and agent required' });
  try {
    const result = updateAgent(level, categoryId, null, oldName, agent);
    if (level === 'global') syncGlobalAgentsToClaudeDir();
    res.json(result);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/agents', (req, res) => {
  const { level, categoryId, name } = req.body;
  if (!level || !name) return res.status(400).json({ error: 'level and name required' });
  deleteAgent(level, categoryId, null, name);
  if (level === 'global') syncGlobalAgentsToClaudeDir();
  res.json({ ok: true });
});

// ── Agents — project level (4) ────────────────────────────────────────────────

function projectProviders(project) {
  return project.aiProviders || ['claude'];
}

app.get('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(listProjectAgents(project.path, projectProviders(project)));
});

app.post('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(saveProjectAgent(project.path, req.body.agent.name, req.body.agent, projectProviders(project)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/agents', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(saveProjectAgent(project.path, req.body.oldName, req.body.agent, projectProviders(project)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/agents/:name', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  deleteProjectAgent(project.path, req.params.name, projectProviders(project));
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

app.post('/api/projects', async (req, res) => {
  const { name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(await createProject({ name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills }));
  } catch (e) {
    res.status(e.message.includes('already exists') ? 409 : 500).json({ error: e.message });
  }
});

app.post('/api/projects/import', async (req, res) => {
  const { name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(await importProject({ name, categoryId, projectPath, description, status, aiProviders, selectedAgents, skills }));
  } catch (e) {
    res.status(e.message.includes('not exist') ? 404 : 409).json({ error: e.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    res.json(await updateProject(req.params.id, req.body));
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

app.get('/api/projects/:id/sync-preview', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(getProjectSyncPreview(project));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/sync', async (req, res) => {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(await syncProject(project));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync-all', async (req, res) => {
  try {
    res.json(await syncAllProjects());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Context files ─────────────────────────────────────────────────────────────

app.get('/api/projects/:id/context', (req, res) => {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  if (req.query.type === 'auto') return res.json(getContextAuto(project, cfg.aiProvider));
  
  const type = req.query.type || (project.aiProviders?.includes('github') ? 'github' : 'claude');
  res.json(getContextFile(project, type));
});

app.put('/api/projects/:id/context', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  const type     = req.body.type || (project.aiProviders?.includes('github') ? 'github' : 'claude');
  const filePath = saveContextFile(project, type, req.body.content || '');
  res.json({ ok: true, filePath });
});

app.post('/api/projects/:id/generate-context', async (req, res) => {
  const cfg = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const ctxType = req.query.type || 'claude';
  const config  = PROJECT_PROVIDERS[ctxType] || PROJECT_PROVIDERS.claude;

  try {
    const safeRead = (filePath, maxLen = 3000) => {
      try {
        const c = fs.readFileSync(filePath, 'utf8');
        return c.length > maxLen ? c.slice(0, maxLen) + '\n...(truncado)' : c;
      } catch { return null; }
    };

    const langExtMap = {
      '.js':'JavaScript','.ts':'TypeScript','.jsx':'JavaScript/JSX','.tsx':'TypeScript/TSX',
      '.py':'Python','.rb':'Ruby','.php':'PHP','.java':'Java','.cs':'C#',
      '.go':'Go','.rs':'Rust','.cpp':'C++','.c':'C','.swift':'Swift','.kt':'Kotlin',
      '.vue':'Vue','.svelte':'Svelte','.dart':'Dart','.scala':'Scala',
    };

    const langCount = {};
    const skipDirs  = new Set(['node_modules','dist','build','.git','__pycache__','.next','out','coverage','.venv','venv']);
    const scanDir   = (dir, depth = 0) => {
      if (depth > 2) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || skipDirs.has(entry.name)) continue;
          if (entry.isDirectory()) scanDir(path.join(dir, entry.name), depth + 1);
          else {
            const ext = path.extname(entry.name).toLowerCase();
            if (langExtMap[ext]) langCount[langExtMap[ext]] = (langCount[langExtMap[ext]] || 0) + 1;
          }
        }
      } catch {}
    };
    scanDir(project.path);
    const detectedLanguages = Object.entries(langCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([l])=>l);
    if (!detectedLanguages.length) detectedLanguages.push('No detectado');

    const getStructure = (dir, depth = 0, prefix = '') => {
      const lines = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith('.') && !skipDirs.has(e.name))
          .slice(0, 25);
        for (const e of entries) {
          lines.push(`${prefix}${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
          if (e.isDirectory() && depth < 1)
            lines.push(...getStructure(path.join(dir, e.name), depth + 1, prefix + '  '));
        }
      } catch {}
      return lines;
    };
    const structure = getStructure(project.path).join('\n') || 'No disponible';

    let packageManager = 'No detectado', mainLibraries = [], dependencies = 'No detectado';
    let buildTool = 'No detectado', testingFramework = 'No detectado', lintingTool = 'No detectado';

    const pkgJson = safeRead(path.join(project.path, 'package.json'));
    if (pkgJson) {
      packageManager = fs.existsSync(path.join(project.path, 'pnpm-lock.yaml')) ? 'pnpm'
        : fs.existsSync(path.join(project.path, 'yarn.lock')) ? 'yarn' : 'npm';
      try {
        const pkg  = JSON.parse(pkgJson);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        mainLibraries = Object.keys(deps).slice(0, 15);
        dependencies  = Object.entries(deps).slice(0, 20).map(([k,v]) => `  ${k}: ${v}`).join('\n');
        if      (deps.vite || deps['@vitejs/plugin-react']) buildTool = 'Vite';
        else if (deps.webpack)  buildTool = 'Webpack';
        else if (deps.esbuild)  buildTool = 'esbuild';
        else if (pkg.scripts?.build) buildTool = 'npm scripts';
        if      (deps.jest || deps['@jest/core'])           testingFramework = 'Jest';
        else if (deps.vitest)   testingFramework = 'Vitest';
        else if (deps.mocha)    testingFramework = 'Mocha';
        else if (deps.cypress)  testingFramework = 'Cypress';
        else if (deps.playwright || deps['@playwright/test']) testingFramework = 'Playwright';
        const lint = [];
        if (deps.eslint)   lint.push('ESLint');
        if (deps.prettier) lint.push('Prettier');
        lintingTool = lint.join(' + ') || 'No detectado';
      } catch {}
    }

    const requirements = safeRead(path.join(project.path, 'requirements.txt'), 1000);
    if (requirements) {
      if (!mainLibraries.length)
        mainLibraries = requirements.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).slice(0,10).map(l=>l.split(/[=><!]/)[0].trim());
      if (packageManager === 'No detectado') packageManager = 'pip';
      if (testingFramework === 'No detectado' && requirements.includes('pytest')) testingFramework = 'pytest';
      dependencies = requirements;
    }
    const pyproject = safeRead(path.join(project.path, 'pyproject.toml'), 500);
    if (pyproject) packageManager = pyproject.includes('poetry') ? 'Poetry' : pyproject.includes('hatch') ? 'Hatch' : 'pip';

    let cicdPipeline = null;
    if (fs.existsSync(path.join(project.path, '.github', 'workflows')))  cicdPipeline = 'GitHub Actions';
    else if (fs.existsSync(path.join(project.path, 'Jenkinsfile')))       cicdPipeline = 'Jenkins';
    else if (fs.existsSync(path.join(project.path, '.gitlab-ci.yml')))    cicdPipeline = 'GitLab CI';
    else if (fs.existsSync(path.join(project.path, '.circleci')))         cicdPipeline = 'CircleCI';

    const hasDocker = fs.existsSync(path.join(project.path, 'Dockerfile')) || fs.existsSync(path.join(project.path, 'docker-compose.yml'));
    const existingReadme = safeRead(path.join(project.path, 'README.md'), 2000) || safeRead(path.join(project.path, 'readme.md'), 2000);

    const cat  = (cfg.categories || []).find(c => c.id === project.categoryId);
    const fileLabel = `${config.contextFile} (${config.label})`;

    const contextFilePath = getContextFilePath(project, ctxType);
    const existingContext = safeRead(contextFilePath, 8000);

    const projectInfo = `**Nombre:** ${project.name}
**Categoría:** ${cat?.name || project.categoryId || 'N/A'}
**Lenguajes:** ${detectedLanguages.join(', ')}
**Librerías:** ${mainLibraries.slice(0, 8).join(', ') || 'No detectadas'}
**Testing:** ${testingFramework} · **Build:** ${buildTool} · **Lint:** ${lintingTool}
**Package manager:** ${packageManager} · **CI/CD:** ${cicdPipeline || 'No'} · **Docker:** ${hasDocker ? 'Sí' : 'No'}`;

    const analysisPrompt = prompts.generateContext({
      fileLabel,
      projectInfo,
      existingContext,
      structure,
      dependencies,
      existingReadme,
    });

    const { callAI } = require('./ai');
    const content = await callAI(analysisPrompt, { cwd: project.path });
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

function buildOrchestrationStats(projects) {
  let total = 0, success = 0, failed = 0, partial = 0;
  let totalCost = 0, totalCostIsApprox = false;
  for (const project of projects) {
    if (!project.path || project.pathExists === false) continue;
    const orchDir = path.join(project.path, '.agent-hub', 'orchestrations');
    if (!fs.existsSync(orchDir)) continue;
    try {
      for (const file of fs.readdirSync(orchDir).filter(f => f.endsWith('.json'))) {
        try {
          const orch = JSON.parse(fs.readFileSync(path.join(orchDir, file), 'utf8'));
          total++;
          if      (orch.lastExecutionStatus === 'success') success++;
          else if (orch.lastExecutionStatus === 'failed')  failed++;
          else if (orch.lastExecutionStatus === 'partial') partial++;
          if (orch.lastExecutionCost) {
            totalCost += orch.lastExecutionCost;
            if (orch.lastExecutionCostIsApprox) totalCostIsApprox = true;
          }
        } catch { /* skip corrupt JSON */ }
      }
    } catch { /* skip unreadable dir */ }
  }
  return { total, success, failed, partial, neverRun: total - success - failed - partial, totalCost, totalCostIsApprox };
}

function buildDashboardNotifications(allAgents, projects, categories = []) {
    console.log(`🔨 buildDashboardNotifications called with ${allAgents.length} agents`);
    const readmeAgent = allAgents.find(a => a.name === 'readme');
    if (readmeAgent) console.log(`  readme agent:`, { level: readmeAgent.level, tools: readmeAgent.tools?.length || 0});
  const notifications = [];

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || id || 'N/A';
  const agentScopeLabel = (agent) => {
    if (agent.level === 'global') return 'Global';
    if (agent.level === 'section') return `Categoría: ${categoryName(agent.categoryId)}`;
    if (agent.level === 'uncategorized') return 'Sin categoría';
    return agent.level || 'Desconocido';
  };
  const agentScopeKey = (agent) => [
    agent.level || 'unknown',
    agent.categoryId || 'none',
  ].join('-');

  for (const agent of allAgents) {
    if (!agent.tools || agent.tools.length === 0) {
      const notif = {
        id:         `agent-no-tools-${agent.name}-${agentScopeKey(agent)}`,
        type:       'optimization',
        target:     'agent',
        targetName: agent.name,
        scopeLabel: agentScopeLabel(agent),
        message:    'Sin herramientas configuradas',
        action:     'open-agent',
        level:      agent.level,
        categoryId: agent.categoryId || null,
      };
      notifications.push(notif);
    }
    if (!agent.optimized && agent.system && agent.system.length > 30) {
      notifications.push({
        id:         `agent-not-optimized-${agent.name}-${agentScopeKey(agent)}`,
        type:       'optimization',
        target:     'agent',
        targetName: agent.name,
        scopeLabel: agentScopeLabel(agent),
        message:    'Prompt no optimizado con IA',
        action:     'optimize-agent',
        level:      agent.level,
        categoryId: agent.categoryId || null,
      });
    }
  }

  const MIN_CONTEXT_LENGTH = 80;

  for (const project of projects) {
    if (!project.pathExists) continue;

    const providers = project.aiProviders || ['claude'];

    for (const p of providers) {
      const config = PROJECT_PROVIDERS[p];
      if (!config) continue;
      const filePath = getContextFilePath(project, p);
      if (!fs.existsSync(filePath)) {
        notifications.push({
          id:         `project-no-ctx-${project.id}-${p}`,
          type:       'critical',
          target:     'project',
          targetName: project.name,
          targetId:   project.id,
          message:    `Sin ${config.contextFile}`,
          action:     'generate-context',
        });
      } else {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (content.length < MIN_CONTEXT_LENGTH) {
          notifications.push({
            id:         `project-empty-ctx-${project.id}-${p}`,
            type:       'optimization',
            target:     'project',
            targetName: project.name,
            targetId:   project.id,
            message:    `${config.contextFile} sin contexto`,
            action:     'generate-context',
          });
        }
      }
    }

    if ((project.pendingUpdates || 0) > 0) {
      notifications.push({
        id:         `project-pending-${project.id}`,
        type:       'optimization',
        target:     'project',
        targetName: project.name,
        targetId:   project.id,
        message:    `${project.pendingUpdates} agente${project.pendingUpdates === 1 ? '' : 's'} pendiente${project.pendingUpdates === 1 ? '' : 's'} de sync`,
        action:     'sync-project',
      });
    }
  }

  const priority = { critical: 0, optimization: 1, info: 2 };
  return notifications.sort((a, b) => priority[a.type] - priority[b.type]);
}

function isDismissibleNotification(notification) {
  return notification?.type === 'optimization' || notification?.type === 'info';
}

function getDashboardNotificationsData() {
  const cfg      = readConfig();
  const projects = listProjectsWithStatus();

  const globalAgents  = listAgentsByLevel('global');
  const uncatAgents   = listAgentsByLevel('uncategorized');
  const sectionAgents = cfg.categories.flatMap(cat => listAgentsByLevel('section', cat.id));
  const techAgents    = cfg.categories.flatMap(cat =>
    cat.technologies.flatMap(tech => listAgentsByLevel('tech', cat.id, tech.id)),
  );
  const allAgents = [...globalAgents, ...sectionAgents, ...techAgents, ...uncatAgents];

  console.log(`🔍 [Dashboard] Loaded ${uncatAgents.length} uncategorized agents:`, uncatAgents.map(a => ({ name: a.name, level: a.level })));

  return {
    cfg,
    projects,
    allAgents,
    notifications: buildDashboardNotifications(allAgents, projects, cfg.categories || []),
  };
}

function normalizeDismissedDashboardIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()))];
}

function normalizeSnoozedDashboardMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [id, until] of Object.entries(raw)) {
    if (typeof id !== 'string' || typeof until !== 'string') continue;
    const ts = Date.parse(until);
    if (!Number.isFinite(ts)) continue;
    out[id.trim()] = new Date(ts).toISOString();
  }
  return out;
}

function buildProjectHealth(projects) {
  const now = Date.now();
  const staleThresholdMs = 3 * 24 * 60 * 60 * 1000;

  function collectProjectAgentHealthIssues(project, providers) {
    const issues = [];
    const seen = new Set();

    const addIssue = (msg) => {
      if (seen.has(msg)) return;
      seen.add(msg);
      issues.push(msg);
    };

    for (const provider of providers) {
      const dir = getAgentsDirForProvider(project.path, provider);
      if (!fs.existsSync(dir)) {
        addIssue(`Directorio de agentes ${provider} ausente`);
        continue;
      }

      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      } catch {
        addIssue(`No se pudo leer agentes ${provider}`);
        continue;
      }

      for (const file of files) {
        const filePath = path.join(dir, file);
        let raw = '';
        try {
          raw = fs.readFileSync(filePath, 'utf8');
        } catch {
          addIssue(`No se pudo leer agente ${file}`);
          continue;
        }

        const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/m.test(raw);
        let agent;
        try {
          agent = parseAgentFile(filePath);
        } catch {
          addIssue(`Archivo de agente invalido: ${file}`);
          continue;
        }

        const label = agent?.name || path.basename(file, '.md');
        if (!hasFrontmatter) {
          addIssue(`Agente "${label}" sin frontmatter valido`);
        }
        if (!Array.isArray(agent.tools) || agent.tools.length === 0) {
          addIssue(`Agente "${label}" sin herramientas`);
        }
        if (!agent.system || agent.system.trim().length < 30) {
          addIssue(`Agente "${label}" con prompt vacio o muy corto`);
        }
      }
    }

    return issues;
  }

  const health = projects.map((project) => {
    const issues = [];
    const providers = project.aiProviders || ['claude'];

    if (!project.pathExists) {
      issues.push('Ruta del proyecto no encontrada');
    }

    if ((project.pendingUpdates || 0) > 0) {
      issues.push(`${project.pendingUpdates} agente${project.pendingUpdates === 1 ? '' : 's'} pendiente${project.pendingUpdates === 1 ? '' : 's'} de sync`);
    }

    let contextState = 'ok';
    if (project.pathExists) {
      for (const p of providers) {
        const config = PROJECT_PROVIDERS[p];
        if (!config) continue;
        const filePath = getContextFilePath(project, p);
        if (!fs.existsSync(filePath)) {
          contextState = 'missing';
          issues.push(`${config.contextFile} ausente`);
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (content.length < 80 && contextState !== 'missing') {
          contextState = 'thin';
          issues.push(`${config.contextFile} con poco contexto`);
        }
      }
    }

    const lastSyncMs = project.lastSyncAt ? Date.parse(project.lastSyncAt) : NaN;
    const staleSync = Number.isFinite(lastSyncMs) ? (now - lastSyncMs > staleThresholdMs) : true;
    if (staleSync) {
      issues.push(project.lastSyncAt ? 'Sync sin actualizar hace mas de 3 dias' : 'Sync nunca ejecutado');
    }

    if (project.pathExists) {
      const agentIssues = collectProjectAgentHealthIssues(project, providers);
      if (agentIssues.length > 0) {
        issues.push(...agentIssues.slice(0, 3));
        if (agentIssues.length > 3) {
          issues.push(`Y ${agentIssues.length - 3} incidencia${agentIssues.length - 3 === 1 ? '' : 's'} mas en agentes del proyecto`);
        }
      }
    }

    let status = 'healthy';
    if (!project.pathExists || contextState === 'missing') status = 'critical';
    else if ((project.pendingUpdates || 0) > 0 || staleSync || contextState === 'thin' || issues.length > 0) status = 'warning';

    return {
      projectId: project.id,
      name: project.name,
      status,
      pathExists: project.pathExists !== false,
      pendingUpdates: project.pendingUpdates || 0,
      staleSync,
      contextState,
      lastSyncAt: project.lastSyncAt || null,
      issues,
    };
  });

  const priority = { critical: 0, warning: 1, healthy: 2 };
  return health.sort((a, b) => priority[a.status] - priority[b.status] || a.name.localeCompare(b.name));
}

app.get('/api/dashboard', (req, res) => {
  try {
    const { cfg, projects, allAgents, notifications: allNotifications } = getDashboardNotificationsData();

    const dirState = agentsSync.getSyncState();
    const dirMeta  = agentsSync.readMeta ? agentsSync.readMeta() : null;

    const lastSyncAt = projects
      .map(p => p.lastSyncAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

    const validIds = new Set(allNotifications.map((n) => n.id));
    const rawDismissed = normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications);
    const normalizedDismissed = rawDismissed
      .filter((id) => validIds.has(id));
    const now = Date.now();
    const rawSnoozed = normalizeSnoozedDashboardMap(cfg.snoozedDashboardNotifications);
    const normalizedSnoozed = Object.fromEntries(
      Object.entries(rawSnoozed).filter(([id, until]) => validIds.has(id) && Date.parse(until) > now),
    );

    if (
      normalizedDismissed.length !== rawDismissed.length
      || Object.keys(normalizedSnoozed).length !== Object.keys(rawSnoozed).length
    ) {
      cfg.dismissedDashboardNotifications = normalizedDismissed;
      cfg.snoozedDashboardNotifications = normalizedSnoozed;
      writeConfig(cfg);
    }

    const dismissedIds = new Set(normalizedDismissed);
    const snoozedIds = new Set(Object.keys(normalizedSnoozed));
    const notifications = allNotifications
      .filter((n) => !dismissedIds.has(n.id) && !snoozedIds.has(n.id));

    const hiddenIds = new Set([...dismissedIds, ...snoozedIds]);

    const byLevel = allAgents.reduce((acc, a) => {
      const level = a.level || 'unknown';
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {});

    const projectHealth    = buildProjectHealth(projects);
    const orchestrationStats = buildOrchestrationStats(projects);

    res.json({
      agents: {
        total:         allAgents.length,
        global:        byLevel.global || 0,
        section:       byLevel.section || 0,
        tech:          byLevel.tech || 0,
        uncategorized: byLevel.uncategorized || 0,
      },
      projects: {
        total:       projects.length,
        active:      projects.filter(p => p.status === 'active').length,
        paused:      projects.filter(p => p.status === 'paused').length,
        archived:    projects.filter(p => p.status === 'archived').length,
        withPending: projects.filter(p => (p.pendingUpdates || 0) > 0).length,
        totalPending: projects.reduce((s, p) => s + (p.pendingUpdates || 0), 0),
      },
      orchestrations: orchestrationStats,
      lastSyncAt,
      dirStatus: {
        enabled:          cfg.agentsDirectoryEnabled !== false,
        syncing:          dirState.syncing,
        lastSync:         dirMeta?.lastSync || null,
        pendingConflicts: dirState.pendingConflicts || [],
        lastResult:       dirState.lastResult || null,
      },
      projectHealth,
      notifications,
      hiddenNotifications: hiddenIds.size,
      hiddenDismissed: dismissedIds.size,
      hiddenSnoozed: snoozedIds.size,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dashboard/notifications/dismiss', (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id required' });
  }

  const { cfg, notifications } = getDashboardNotificationsData();
  const notification = notifications.find((n) => n.id === id);
  if (!notification) return res.status(404).json({ error: 'notification not found' });
  if (!isDismissibleNotification(notification)) {
    return res.status(400).json({ error: 'notification type cannot be dismissed' });
  }

  const current = normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications);
  cfg.dismissedDashboardNotifications = [...new Set([...current, id])];
  const snoozed = normalizeSnoozedDashboardMap(cfg.snoozedDashboardNotifications);
  if (snoozed[id]) delete snoozed[id];
  cfg.snoozedDashboardNotifications = snoozed;
  writeConfig(cfg);
  res.json({ ok: true, hiddenNotifications: cfg.dismissedDashboardNotifications.length });
});

app.post('/api/dashboard/notifications/dismiss-group', (req, res) => {
  const { group, target } = req.body || {};
  if (!group || typeof group !== 'string') {
    return res.status(400).json({ error: 'group required' });
  }

  const { cfg, notifications } = getDashboardNotificationsData();
  const dismissible = notifications.filter(isDismissibleNotification);

  let idsToDismiss = [];
  if (group === 'agent') {
    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: 'target required for group=agent' });
    }
    idsToDismiss = dismissible
      .filter((n) => n.target === 'agent' && n.targetName === target)
      .map((n) => n.id);
  } else if (group === 'scope') {
    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: 'target required for group=scope' });
    }
    idsToDismiss = dismissible
      .filter((n) => n.scopeLabel === target)
      .map((n) => n.id);
  } else {
    return res.status(400).json({ error: 'unsupported group' });
  }

  const current = normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications);
  cfg.dismissedDashboardNotifications = [...new Set([...current, ...idsToDismiss])];
  const snoozed = normalizeSnoozedDashboardMap(cfg.snoozedDashboardNotifications);
  for (const id of idsToDismiss) delete snoozed[id];
  cfg.snoozedDashboardNotifications = snoozed;
  writeConfig(cfg);
  res.json({ ok: true, dismissed: idsToDismiss.length, hiddenNotifications: cfg.dismissedDashboardNotifications.length });
});

app.post('/api/dashboard/notifications/snooze', (req, res) => {
  const { id, days } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id required' });
  }

  const nDays = Number.isFinite(Number(days)) ? Number(days) : 7;
  const clampedDays = Math.max(1, Math.min(30, nDays));

  const { cfg, notifications } = getDashboardNotificationsData();
  const notification = notifications.find((n) => n.id === id);
  if (!notification) return res.status(404).json({ error: 'notification not found' });
  if (!isDismissibleNotification(notification)) {
    return res.status(400).json({ error: 'notification type cannot be snoozed' });
  }

  const snoozed = normalizeSnoozedDashboardMap(cfg.snoozedDashboardNotifications);
  const untilDate = new Date(Date.now() + clampedDays * 24 * 60 * 60 * 1000);
  snoozed[id] = untilDate.toISOString();
  cfg.snoozedDashboardNotifications = snoozed;

  // If snoozed, keep it out of permanent-dismiss list to preserve semantics.
  cfg.dismissedDashboardNotifications = normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications)
    .filter((x) => x !== id);

  writeConfig(cfg);
  res.json({ ok: true, id, until: snoozed[id], days: clampedDays });
});

app.post('/api/dashboard/notifications/restore', (req, res) => {
  const cfg = readConfig();
  cfg.dismissedDashboardNotifications = [];
  cfg.snoozedDashboardNotifications = {};
  writeConfig(cfg);
  res.json({ ok: true, hiddenNotifications: 0 });
});

// ── AI ────────────────────────────────────────────────────────────────────────

const {
  getProviderStatus,
  testConnection,
  generateAgentPrompt,
  getSuggestions,
  generateProjectSuggestions,
  clearSuggestionsCache,
  callAI,
  callAIChat,
  getSessionUsage,
  resetSessionUsage,
  resetAllUsage,
} = require('./ai');

// GET /api/ai/usage — session token usage stats
app.get('/api/ai/usage', (req, res) => {
  res.json(getSessionUsage());
});

// POST /api/ai/usage/reset — reset session stats
app.post('/api/ai/usage/reset', (req, res) => {
  resetSessionUsage();
  res.json(getSessionUsage());
});

// POST /api/ai/usage/reset-all — reset session + cumulative
app.post('/api/ai/usage/reset-all', (req, res) => {
  resetAllUsage();
  res.json(getSessionUsage());
});

// POST /api/ai/test-connection — probe current provider credentials
app.post('/api/ai/test-connection', async (req, res) => {
  try {
    res.json(await testConnection());
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

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

// POST /api/ai/generate-skill — generate skill content from name + description
app.post('/api/ai/generate-skill', async (req, res) => {
  const { name, description, language = 'en' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const prompt = prompts.skillContent({ name, description, language });
    const content = await callAI(prompt);
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/optimize-agent — rewrite & improve an existing agent system prompt
app.post('/api/ai/optimize-agent', async (req, res) => {
  const { name, description, system, tools = [], model = 'sonnet', language = 'en' } = req.body;
  if (!system) return res.status(400).json({ error: 'system prompt required' });

  const isContentFilterErr = (msg) => /content management policy|content filter|response was filtered|prompt triggering azure openai|politica de contenido|bloqueo la solicitud/i.test(String(msg || ''));
  const fallbackDescription = () => {
    const d = String(description || '').trim();
    if (d) return d.slice(0, 80);
    if (language === 'es') return `Optimiza prompts de ${name || 'agente'} con foco y claridad`.slice(0, 80);
    return `Optimize ${name || 'agent'} prompts with focused, clear instructions`.slice(0, 80);
  };
  const extractHeadings = (text) => String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l)
    .filter((l) => /^#{1,6}\s+/.test(l) || /^\[[^\]]+\]$/.test(l));

  const preservesFormat = (originalText, candidateText) => {
    const original = String(originalText || '');
    const candidate = String(candidateText || '');
    const originalHeadings = extractHeadings(original);
    if (!originalHeadings.length) return true;
    const candidateHeadings = extractHeadings(candidate);
    if (candidateHeadings.length < originalHeadings.length) return false;
    return originalHeadings.every((h, i) => candidateHeadings[i] === h);
  };
  const fallbackSystem = () => {
    const raw = String(system || '').trim();
    if (raw) return raw;
    return language === 'es'
      ? 'Analiza el contexto disponible, prioriza instrucciones concretas, entrega pasos accionables y valida riesgos antes de proponer cambios.'
      : 'Analyze available context, prioritize concrete instructions, provide actionable steps, and validate risks before proposing changes.';
  };

  const toolList   = tools.join(', ') || 'ninguna';
  const langTarget = language === 'es' ? 'Spanish' : 'English';

  const prompt = prompts.optimizeAgent({ name, model, toolList, description, system, langTarget });

  try {
    const { callAI } = require('./ai');
    const raw = await callAI(prompt, { maxTokens: 500 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ description: fallbackDescription(), system: fallbackSystem() });
    }
    const { description: newDesc, system: newSystem } = JSON.parse(jsonMatch[0]);
    const safeSystem = preservesFormat(system, newSystem) ? String(newSystem || fallbackSystem()) : fallbackSystem();
    res.json({
      description: String(newDesc || fallbackDescription()),
      system: safeSystem,
    });
  } catch (e) {
    if (isContentFilterErr(e?.message)) {
      return res.json({ description: fallbackDescription(), system: fallbackSystem() });
    }
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
  const { level, categoryId, techId, alreadySuggested = [] } = req.body;
  if (!level) return res.status(400).json({ error: 'level required' });

  const existing = (() => {
    try { return listAgentsByLevel(level, categoryId, techId).map(a => a.name); }
    catch { return []; }
  })();

  const allExcluded = [...new Set([...existing, ...alreadySuggested])];

  try {
    const suggestions = await getSuggestions(
      { level, categoryId, techId, existingAgents: allExcluded },
      true, // force regenerate
    );
    res.json(suggestions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Project-specific suggestions ─────────────────────────────────────────────

function projectSuggestionsCacheKey(projectId) {
  return `project::${projectId}`;
}

async function getProjectSuggestionsImpl(projectId, force = false, alreadySuggested = []) {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === projectId);
  if (!project) throw new Error('Project not found');

  const cKey           = projectSuggestionsCacheKey(projectId);
  const suggestionsPath = path.join(CHAT_CACHE_DIR, 'suggestions.json');
  const readCache      = () => { try { return JSON.parse(fs.readFileSync(suggestionsPath, 'utf8')); } catch { return {}; } };

  if (!force) {
    const cached = readCache()[cKey];
    if (cached) return cached.suggestions;
  }

  const providers = project.aiProviders || ['claude'];
  const provider  = providers.includes('github') ? 'github' : providers[0];
  const ctx       = getContextFile(project, provider);
  const cat         = (cfg.categories || []).find(c => c.id === project.categoryId);
  const existing    = listProjectAgents(project.path, providers).map(a => a.name);
  const allExcluded = [...new Set([...existing, ...alreadySuggested])];

  const suggestions = await generateProjectSuggestions({
    project,
    contextContent: ctx.content || '',
    categoryName:   cat?.name || project.categoryId || '',
    techName:       '',
    existingAgents: allExcluded,
  });

  const allCache      = readCache();
  allCache[cKey]      = { suggestions, generatedAt: new Date().toISOString() };
  fs.writeFileSync(suggestionsPath, JSON.stringify(allCache, null, 2), 'utf8');

  return suggestions;
}

// GET /api/ai/project-suggestions?projectId=
app.get('/api/ai/project-suggestions', async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    res.json(await getProjectSuggestionsImpl(projectId, false));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/project-suggestions/refresh
app.post('/api/ai/project-suggestions/refresh', async (req, res) => {
  const { projectId, alreadySuggested = [] } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    res.json(await getProjectSuggestionsImpl(projectId, true, alreadySuggested));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ai/suggestions/cache — clear all cached suggestions
app.delete('/api/ai/suggestions/cache', (req, res) => {
  clearSuggestionsCache();

  res.json({ ok: true });
});

// POST /api/chat — multi-turn chat with the configured AI provider
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  try {
    const reply = await callAIChat(messages, { systemPrompt });
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat history persistence (per-project) ────────────────────────────────────

const { CACHE_DIR: CHAT_CACHE_DIR, ensureDir: chatEnsureDir } = require('./config');

function chatHistoryFile(projectId) {
  const slug = projectId ? `chat-${projectId}` : 'chat-global';
  return require('path').join(CHAT_CACHE_DIR, `${slug}.json`);
}

app.get('/api/chat/history', (req, res) => {
  const file = chatHistoryFile(req.query.projectId || '');
  try {
    if (!fs.existsSync(file)) return res.json({ messages: [] });
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    res.json({ messages: [] });
  }
});

app.put('/api/chat/history', (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  const file = chatHistoryFile(req.query.projectId || '');
  try {
    chatEnsureDir(CHAT_CACHE_DIR);
    fs.writeFileSync(file, JSON.stringify({ messages }, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/chat/history', (req, res) => {
  const file = chatHistoryFile(req.query.projectId || '');
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Agents flat list (all levels, for @mention autocomplete) ──────────────────

app.get('/api/agents/flat', (req, res) => {
  const cfg = readConfig();
  const all = [];
  const collect = (level, catId) => {
    try { all.push(...listAgentsByLevel(level, catId)); } catch {}
  };
  collect('global');
  collect('uncategorized');
  for (const cat of (cfg.categories || [])) collect('section', cat.id);
  res.json(all);
});

// ── Open in editor/explorer ───────────────────────────────────────────────────

app.post('/api/projects/:id/open-folder', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Actual shell.openPath handled via IPC in main.js
  // Return path for the renderer to call window.api.openPath()
  res.json({ path: project.path });
});

// ── API-FS — Filesystem operations for Subsystem CLI ─────────────────────────

function resolveProjectPath(projectId) {
  const project = readConfig().projects.find(p => p.id === projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }
  return project.path;
}

// GET /api-fs/projects/:id/files/read?path=<relative-path>
app.get('/api-fs/projects/:id/files/read', (req, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.id);
    const filePath    = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    res.json(apiFs.readFile(projectPath, filePath));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// GET /api-fs/projects/:id/files/list?pattern=<glob>
app.get('/api-fs/projects/:id/files/list', (req, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.id);
    res.json(apiFs.listFiles(projectPath, req.query.pattern));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// POST /api-fs/projects/:id/files/write
// Body: { path, content, metadata? }
app.post('/api-fs/projects/:id/files/write', (req, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.id);
    const { path: filePath, content, metadata } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
    const result = apiFs.writeFile(projectPath, filePath, content, metadata);
    if (!result.saved) return res.status(422).json({ error: 'Validation failed', ...result });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// POST /api-fs/projects/:id/bash
// Body: { command }
app.post('/api-fs/projects/:id/bash', async (req, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.id);
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const result = await apiFs.bashCommand(projectPath, command);
    res.json(result);
  } catch (e) {
    res.status(e.status || (e.code === 'FORBIDDEN_COMMAND' ? 403 : 500)).json({ error: e.message, code: e.code });
  }
});

// POST /api-fs/projects/:id/grep
// Body: { pattern, file }
app.post('/api-fs/projects/:id/grep', (req, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.id);
    const { pattern, file } = req.body;
    if (!pattern) return res.status(400).json({ error: 'pattern required' });
    res.json(apiFs.grepFiles(projectPath, pattern, file));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// POST /api-fs/projects/:id/execute-agent
// Body: { prompt, agentSystemPrompt, projectContext?, maxTurns?, timeout? }
// Runs the full Subsystem CLI loop for a given prompt.
app.post('/api-fs/projects/:id/execute-agent', async (req, res) => {
  const { callAIWithSubsystemCLI } = require('./ai');
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Use the global execution provider, not project.aiProvider (which only controls file format).
  const provider = cfg.aiProvider || 'cli';
  if (provider === 'cli') {
    return res.status(400).json({ error: 'Subsystem CLI is only for api and github providers. Use the CLI provider natively.' });
  }

  const { prompt, agentSystemPrompt, projectContext, maxTurns, timeout, useBrowser } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const result = await callAIWithSubsystemCLI(prompt, agentSystemPrompt || '', {
      projectPath:    project.path,
      projectContext: projectContext || '',
      provider,
      maxTurns:       maxTurns  || 10,
      timeout:        timeout   || 1_800_000,
      useBrowser:     useBrowser || false,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Orchestrations ────────────────────────────────────────────────────────────

const workflows                         = require('./workflows');
const { OrchestrationExecutor, registerExecutor, getExecutor, resolveGate } = require('./orchestrator');
const scriptsRegistry                   = require('./scripts-registry');
const skills                            = require('./skills');
const opsLedger                         = require('./ops-ledger');

/**
 * Finds the project that owns a given orchestration id by scanning all projects.
 */
function resolveOrchProject(orchId) {
  const cfg = readConfig();
  for (const project of (cfg.projects || [])) {
    if (!project.path) continue;
    try {
      const orchFile = path.join(project.path, '.agent-hub', 'orchestrations', `${orchId}.json`);
      if (fs.existsSync(orchFile)) return project;
    } catch {}
  }
  return null;
}

// GET /api/orchestrations?projectId=
app.get('/api/orchestrations', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const project = readConfig().projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.path || !fs.existsSync(project.path)) return res.json([]);
  try {
    res.json(workflows.list(project.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orchestrations
app.post('/api/orchestrations', (req, res) => {
  const { projectId, ...data } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const project = readConfig().projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(workflows.create(projectId, project.path, data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orchestrations/:id
app.get('/api/orchestrations/:id', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  const orch = workflows.read(req.params.id, project.path);
  if (!orch) return res.status(404).json({ error: 'Orchestration not found' });
  res.json(orch);
});

// PUT /api/orchestrations/:id
app.put('/api/orchestrations/:id', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  try {
    res.json(workflows.update(req.params.id, project.path, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/orchestrations/:id
app.delete('/api/orchestrations/:id', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  workflows.delete(req.params.id, project.path);
  res.json({ ok: true });
});

// POST /api/orchestrations/:id/validate
app.post('/api/orchestrations/:id/validate', async (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  const orch = workflows.read(req.params.id, project.path);
  if (!orch) return res.status(404).json({ error: 'Orchestration not found' });
  try {
    const executor = new OrchestrationExecutor(orch, project, {});
    const result   = await executor.validate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orchestrations/:id/execute
app.post('/api/orchestrations/:id/execute', async (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  const orch = workflows.read(req.params.id, project.path);
  if (!orch) return res.status(404).json({ error: 'Orchestration not found' });

  const { temporalContexts = {} } = req.body;
  const executor = new OrchestrationExecutor(orch, project, temporalContexts);

  const validation = await executor.validate();
  if (!validation.valid) {
    return res.status(400).json({ error: 'Validation failed', errors: validation.errors });
  }

  registerExecutor(executor);
  res.json({ executionId: executor.executionId, status: 'started' });

  executor.execute()
    .then(result => {
      try {
        const current = workflows.read(orch.id, project.path);
        if (current) {
          workflows.update(orch.id, project.path, {
            ...current,
            lastExecutedAt:           result.completedAt,
            lastExecutionStatus:      result.status,
            executionCount:           (current.executionCount || 0) + 1,
            lastExecutionCost:        result.estimatedCost        || 0,
            lastExecutionCostIsApprox: result.estimatedCostIsApprox || false,
          });
        }
      } catch {}
    })
    .catch(err => {
      console.error('[orchestrator] Background execution error:', err.message);
    });
});

// GET /api/orchestrations/:id/execute/stream?executionId=...
app.get('/api/orchestrations/:id/execute/stream', (req, res) => {
  const { executionId } = req.query;
  if (!executionId) return res.status(400).json({ error: 'executionId required' });
  const executor = getExecutor(executionId);
  if (!executor) return res.status(404).json({ error: 'Execution not found or already completed' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Replay existing logs
  for (const log of executor.logs) send('message', log);

  // If execution already finished before this SSE client connected, replay terminal event immediately
  if (executor._completedResult) {
    send('completed', { type: 'completed', data: executor._completedResult });
    res.end();
    return;
  }
  if (executor._cancelledData) {
    send('cancelled', { type: 'cancelled', data: executor._cancelledData });
    res.end();
    return;
  }

  // Replay pending gate or browser-required pause if client connected after the event fired
  if (executor._pendingGate) {
    send('gate-open', { type: 'gate-open', data: executor._pendingGate });
  }
  if (executor._pendingBrowserRequired) {
    send('browser-required', { type: 'browser-required', data: executor._pendingBrowserRequired });
  }

  const onLog             = (log)    => send('message', log);
  const onStepStart       = (data)   => send('step-start',       { type: 'step-start',       data });
  const onStepInput       = (data)   => send('step-input',       { type: 'step-input',       data });
  const onStepDone        = (result) => send('step-done',        { type: 'step-done',        data: result });
  const onStepWarning     = (data)   => send('step-warning',     { type: 'step-warning',     data });
  const onGateOpen        = (data)   => send('gate-open',        { type: 'gate-open',        data });
  const onBrowserRequired = (data)   => send('browser-required', { type: 'browser-required', data });
  const onBrowserContinued= (data)   => send('browser-continued',{ type: 'browser-continued',data });
  const onCancelled       = (data)   => { send('cancelled', { type: 'cancelled', data }); cleanup(); res.end(); };
  const onCompleted  = (result) => {
    send('completed', { type: 'completed', data: result });
    cleanup();
    res.end();
  };
  const onError = (err) => {
    send('error', { type: 'error', message: err.message });
    cleanup();
    res.end();
  };

  const cleanup = () => {
    executor.off('log',              onLog);
    executor.off('step-start',       onStepStart);
    executor.off('step-input',       onStepInput);
    executor.off('step-done',        onStepDone);
    executor.off('step-warning',     onStepWarning);
    executor.off('gate-open',        onGateOpen);
    executor.off('browser-required', onBrowserRequired);
    executor.off('browser-continued',onBrowserContinued);
    executor.off('cancelled',        onCancelled);
    executor.off('completed',        onCompleted);
    executor.off('error',            onError);
  };

  executor.on('log',              onLog);
  executor.on('step-start',       onStepStart);
  executor.on('step-input',       onStepInput);
  executor.on('step-done',        onStepDone);
  executor.on('step-warning',     onStepWarning);
  executor.on('gate-open',        onGateOpen);
  executor.on('browser-required', onBrowserRequired);
  executor.on('browser-continued',onBrowserContinued);
  executor.on('cancelled',        onCancelled);
  executor.on('completed',        onCompleted);
  executor.on('error',            onError);
  req.on('close', cleanup);
});

// POST /api/orchestrations/:id/cancel?executionId=...
app.post('/api/orchestrations/:id/cancel', (req, res) => {
  const { executionId } = req.query;
  if (!executionId) return res.status(400).json({ error: 'executionId required' });
  const executor = getExecutor(executionId);
  if (!executor) return res.status(404).json({ error: 'Execution not found' });
  executor.cancel();
  res.json({ ok: true });
});

// POST /api/orchestrations/:id/browser-continue?executionId=...
app.post('/api/orchestrations/:id/browser-continue', (req, res) => {
  const { executionId } = req.query;
  if (!executionId) return res.status(400).json({ error: 'executionId required' });
  const executor = getExecutor(executionId);
  if (!executor) return res.status(404).json({ error: 'Execution not found' });
  executor.browserContinue();
  res.json({ ok: true });
});

// GET /api/orchestrations/:id/executions
app.get('/api/orchestrations/:id/executions', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  try {
    res.json(workflows.getExecutions(req.params.id, project.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orchestrations/:id/executions/:executionId
app.get('/api/orchestrations/:id/executions/:executionId', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  const execution = workflows.getExecution(req.params.executionId, project.path);
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json(execution);
});

// POST /api/orchestrations/:id/executions/:executionId/rollback
app.post('/api/orchestrations/:id/executions/:executionId/rollback', async (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orchestration not found' });
  const { stepIndex } = req.body;
  if (stepIndex === undefined || stepIndex === null) {
    return res.status(400).json({ error: 'stepIndex required' });
  }
  try {
    const orch    = workflows.read(req.params.id, project.path);
    const execDir = workflows.findExecutionDir(req.params.executionId, project.path);
    if (!execDir) return res.status(404).json({ error: 'Execution not found' });

    const executor  = new OrchestrationExecutor(orch, project, {});
    executor.execDir = execDir;
    await executor.rollbackStep(Number(stepIndex));
    res.json({ ok: true, message: `Paso ${Number(stepIndex) + 1} deshecho correctamente` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Skills endpoints ──────────────────────────────────────────────────────────
// Skills are flat (no level/category/tech) — referenced by name from agents.

// GET /api/skills  |  GET /api/skills/flat — lista todos los skills
app.get('/api/skills/flat', (req, res) => {
  try { res.json(skills.listSkills()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/skills', (req, res) => {
  try { res.json(skills.listSkills()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/skills — crea skill
app.post('/api/skills', (req, res) => {
  const { skill } = req.body;
  if (!skill?.name) return res.status(400).json({ error: 'name requerido' });
  try { skills.createSkill(skill); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/skills — actualiza skill
app.put('/api/skills', (req, res) => {
  const { skill } = req.body;
  if (!skill?.name) return res.status(400).json({ error: 'name requerido' });
  try { skills.updateSkill(skill); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/skills?name=
app.delete('/api/skills', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name requerido' });
  try { skills.deleteSkill(name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/scripts — lista los scripts determinísticos (built-in + externos)
app.get('/api/scripts', (req, res) => {
  try {
    res.json(scriptsRegistry.listScripts());
  } catch (e) {
    console.error('[scripts] listScripts error:', e);
    // Fallback: return only built-in scripts so the UI doesn't break
    const builtins = [
      { name: 'prepare-context',    label: 'Preparar contexto',        description: 'Analiza el proyecto y genera el índice canónico.', builtin: true },
      { name: 'generate-file-index', label: 'Índice de archivos',      description: 'Lista estructurada de todos los archivos.',        builtin: true },
      { name: 'diff-since-step',    label: 'Diff desde paso anterior', description: 'Compara el filesystem con un paso anterior.',       builtin: true },
      { name: 'validate-json',      label: 'Validar JSON',             description: 'Verifica que el output es JSON válido.',            builtin: true },
      { name: 'quality-score',      label: 'Quality Score',            description: 'Calcula puntuación de calidad del paso anterior.',  builtin: true },
      { name: 'validate-output',    label: 'Validar output',           description: 'Valida el output según reglas configurables.',      builtin: true },
    ];
    res.json({ scripts: builtins, warnings: [`Error cargando scripts externos: ${e.message}`] });
  }
});

// GET /api/scripts/validate — valida estáticamente todos los scripts externos
app.get('/api/scripts/validate', (req, res) => {
  try {
    res.json(scriptsRegistry.validateExternalScripts());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orchestrations/:id/executions/:execId/resume — reanuda ejecución tras crash
app.post('/api/orchestrations/:id/executions/:execId/resume', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orquestación no encontrada' });

  const execDir = workflows.findExecutionDir(req.params.execId, project.path);
  if (!execDir) return res.status(404).json({ error: 'Ejecución no encontrada' });

  const statePath = path.join(execDir, 'execution-state.json');
  if (!fs.existsSync(statePath)) {
    return res.status(404).json({ error: 'Estado de ejecución no encontrado (execution-state.json)' });
  }

  let savedState;
  try { savedState = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch { return res.status(500).json({ error: 'Error al leer el estado de ejecución' }); }

  if (savedState.status === 'completed') {
    return res.status(409).json({ error: 'La ejecución ya estaba completada' });
  }

  const orch = workflows.read(req.params.id, project.path);
  if (!orch) return res.status(404).json({ error: 'Orquestación no encontrada' });

  // Build temporal context values from saved state if needed
  const executor = new OrchestrationExecutor(orch, project, {});
  executor.execDir       = execDir;
  executor._resumeFromStep = savedState.lastCompletedStep + 1;
  executor._executionState = savedState;

  registerExecutor(executor);
  executor.execute().catch(e => console.error('Resume error:', e.message));

  res.json({ executionId: executor.executionId, status: 'resumed' });
});

// GET /api/orchestrations/:id/ops?projectId= — lee ops-ledger
app.get('/api/orchestrations/:id/ops', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orquestación no encontrada' });
  try {
    const ledger = opsLedger.readLedger(project.path, req.params.id);
    res.json(ledger);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orchestrations/:id/ops/:opId/revert?projectId= — marca op como revertida
app.post('/api/orchestrations/:id/ops/:opId/revert', (req, res) => {
  const project = resolveOrchProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Orquestación no encontrada' });
  try {
    const op = opsLedger.markOpReverted(project.path, req.params.id, req.params.opId);
    if (!op) return res.status(404).json({ error: 'Operación no encontrada o ya revertida' });
    res.json({ ok: true, op });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orchestrations/:id/executions/:execId/gate — resuelve gate HITL
app.post('/api/orchestrations/:id/executions/:execId/gate', (req, res) => {
  const { action, feedbackText, nodeId } = req.body;
  if (!action) return res.status(400).json({ error: 'action requerida' });
  if (!nodeId)  return res.status(400).json({ error: 'nodeId requerido' });

  const resolved = resolveGate(req.params.execId, nodeId, { action, feedbackText });
  if (!resolved) return res.status(404).json({ error: 'Gate no encontrado o ya resuelto' });
  res.json({ ok: true });
});

// ── Browser automation routes ──────────────────────────────────────────────────

/** GET /api/browser/status — Connection state, available browsers, open tabs */
app.get('/api/browser/status', async (req, res) => {
  try {
    const status = await browser.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/browser/connect — Connect to a running browser via CDP */
app.post('/api/browser/connect', async (req, res) => {
  try {
    const { port, browserKey } = req.body;
    const cdpPort = port || browser.DEFAULT_CDP_PORT;
    const probe   = await browser.probeCdpPort(cdpPort);
    if (!probe.active) {
      return res.status(400).json({ error: `No hay ningún navegador escuchando en el puerto ${cdpPort}. Reinicia el navegador con la opción CDP o usa /api/browser/launch.` });
    }

    // Detect engine from browserKey or default to chromium
    const installed = browser.listInstalledBrowsers();
    let engine = 'chromium';
    if (browserKey) {
      const def = browser.BROWSER_DEFINITIONS[browserKey];
      if (def) engine = def.engine;
    } else {
      // Auto-detect: try to guess from running browsers
      const pref = browser.getPreferredBrowser();
      if (pref) {
        const def = browser.BROWSER_DEFINITIONS[pref];
        if (def) engine = def.engine;
      }
    }

    await browser.connectBrowser(cdpPort, engine);
    if (browserKey) browser.setPreferredBrowser(browserKey);

    const status = await browser.getStatus();
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/browser/disconnect — Close CDP connection (browser stays open) */
app.post('/api/browser/disconnect', async (req, res) => {
  try {
    await browser.disconnectBrowser();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/browser/tabs — List open tabs from the CDP-enabled browser */
app.get('/api/browser/tabs', async (req, res) => {
  try {
    const port = req.query.port ? Number(req.query.port) : browser.getCdpPort();
    const tabs = await browser.listCdpTabs(port);
    res.json(tabs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/browser/launch — Relaunch a browser with the CDP flag */
app.post('/api/browser/launch', async (req, res) => {
  try {
    const { browserKey, port } = req.body;
    if (!browserKey) return res.status(400).json({ error: 'browserKey requerido' });

    const result = await browser.launchBrowserWithCdp(
      browserKey,
      port || browser.DEFAULT_CDP_PORT,
    );
    browser.setPreferredBrowser(browserKey);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/browser/installed — List installed browsers on this machine */
app.get('/api/browser/installed', (req, res) => {
  try {
    const installed = browser.listInstalledBrowsers();
    res.json(installed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(RENDERER_DIR, 'index.html'));
});

// ── MCP endpoints ─────────────────────────────────────────────────────────────

const mcp = require('./mcp');

// GET /api/mcp/servers?projectId=
app.get('/api/mcp/servers', (req, res) => {
  try { res.json(mcp.listServers(req.query.projectId || null)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/mcp/servers  { scope, projectId?, name, config }
app.post('/api/mcp/servers', (req, res) => {
  try {
    const { scope, projectId, name, config: serverConfig } = req.body;
    if (!scope || !name || !serverConfig) return res.status(400).json({ error: 'scope, name y config son requeridos' });
    mcp.addServer({ scope, projectId: projectId || null, name, config: serverConfig });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/mcp/servers/:name  { scope, projectId?, config }
app.put('/api/mcp/servers/:name', (req, res) => {
  try {
    const { scope, projectId, config: serverConfig } = req.body;
    if (!scope || !serverConfig) return res.status(400).json({ error: 'scope y config son requeridos' });
    mcp.updateServer({ scope, projectId: projectId || null, name: req.params.name, config: serverConfig });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/mcp/servers/:name?scope=&projectId=
app.delete('/api/mcp/servers/:name', (req, res) => {
  try {
    const { scope, projectId } = req.query;
    if (!scope) return res.status(400).json({ error: 'scope es requerido' });
    mcp.removeServer({ scope, projectId: projectId || null, name: req.params.name });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/mcp/servers/:name/test  { config }
app.post('/api/mcp/servers/:name/test', async (req, res) => {
  try {
    const { config: serverConfig } = req.body;
    if (!serverConfig) return res.status(400).json({ error: 'config es requerido' });
    const result = await mcp.testServer(req.params.name, serverConfig);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mcp/servers/:name/tools?projectId=
app.get('/api/mcp/servers/:name/tools', async (req, res) => {
  try {
    const tools = await mcp.listTools([req.params.name], req.query.projectId || null);
    res.json({ tools });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mcp/status
app.get('/api/mcp/status', (req, res) => {
  try { res.json(mcp.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────

function startServer(port = PORT, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const runningPort = server.address()?.port || port;
      console.log(`[server] Running on http://localhost:${runningPort}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { app, startServer, PORT };
