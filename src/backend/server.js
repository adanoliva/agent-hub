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
const agentsSync = require('./agents-sync');
const {
  createProject,
  importProject,
  updateProject,
  deleteProject,
  listProjectsWithStatus,
  getProjectSyncStatus,
  syncProject,
  syncAllProjects,
  getContextFile,
  saveContextFile,
} = require('./projects');

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

app.put('/api/config', (req, res) => {
  const cfg = readConfig();
  const { apiKey, aiProvider, githubToken, githubModel, theme, closeAction,
          agentsDirectoryUrl, agentsDirectoryEnabled } = req.body;
  if (apiKey                !== undefined) cfg.apiKey                = apiKey;
  if (aiProvider            !== undefined) cfg.aiProvider            = aiProvider;
  if (githubToken           !== undefined) cfg.githubToken           = githubToken;
  if (githubModel           !== undefined) cfg.githubModel           = githubModel;
  if (theme                 !== undefined) cfg.theme                 = theme;
  if (closeAction           !== undefined && ['ask','tray','quit'].includes(closeAction)) cfg.closeAction = closeAction;
  if (agentsDirectoryUrl    !== undefined) cfg.agentsDirectoryUrl    = agentsDirectoryUrl;
  if (agentsDirectoryEnabled !== undefined) cfg.agentsDirectoryEnabled = Boolean(agentsDirectoryEnabled);
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

function projectProviders(project) {
  const p = project.aiProvider || 'claude';
  return p === 'both' ? ['claude', 'github'] : [p];
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
  const { name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(await createProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }));
  } catch (e) {
    res.status(e.message.includes('already exists') ? 409 : 500).json({ error: e.message });
  }
});

app.post('/api/projects/import', async (req, res) => {
  const { name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents } = req.body;
  if (!name || !categoryId || !projectPath) {
    return res.status(400).json({ error: 'name, categoryId and projectPath required' });
  }
  try {
    res.json(await importProject({ name, categoryId, techId, projectPath, description, status, aiProvider, selectedAgents }));
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

// ── Context files (CLAUDE.md / copilot-instructions.md) ──────────────────────

app.get('/api/projects/:id/context', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const type = req.query.type || (project.aiProvider === 'github' ? 'github' : 'claude');
  res.json(getContextFile(project, type));
});

app.put('/api/projects/:id/context', (req, res) => {
  const project = readConfig().projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const type     = req.body.type || (project.aiProvider === 'github' ? 'github' : 'claude');
  const filePath = saveContextFile(project, type, req.body.content || '');
  res.json({ ok: true, filePath });
});

app.post('/api/projects/:id/generate-context', async (req, res) => {
  const cfg = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const ctxType = req.query.type || 'claude';

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
    const tech = (cat?.technologies || []).find(t => t.id === project.techId);
    const fileLabel = ctxType === 'github' ? 'copilot-instructions.md (GitHub Copilot)' : 'CLAUDE.md (Claude Code)';

    const analysisPrompt = `Analiza este proyecto de desarrollo y genera un ${fileLabel} optimizado para agentes de IA.

## Información del proyecto

**Nombre:** ${project.name}
**Descripción:** ${project.description || 'No especificada'}
**Categoría:** ${cat?.name || project.categoryId || 'No especificada'}
**Tecnología:** ${tech?.name || project.techId || 'No especificada'}
**Lenguajes:** ${detectedLanguages.join(', ')}
**Frameworks/Librerías principales:** ${mainLibraries.slice(0, 8).join(', ') || 'No detectados'}

## Estructura del proyecto

${structure}

## Dependencias principales

${dependencies}

## Configuración detectada

- Testing: ${testingFramework}
- Linting: ${lintingTool}
- Build tool: ${buildTool}
- Package manager: ${packageManager}
- CI/CD: ${cicdPipeline || 'No detectado'}
- Containerización: ${hasDocker ? 'Sí (Docker)' : 'No'}

${existingReadme ? '## README existente:\n' + existingReadme : ''}

---

Basándote en esto, genera un ${fileLabel} que incluya:

1. **Descripción del proyecto**: Resumen claro de qué es y qué hace
2. **Stack tecnológico**: Lista de tecnologías principales
3. **Estructura del código**: Explicación de carpetas clave
4. **Cómo ejecutar localmente**: Instrucciones básicas
5. **Instrucciones para agentes**: Reglas específicas (convenciones, patrones, qué evitar)
6. **Quick wins**: Tareas de mejora identificables rápidamente

Formato: Markdown limpio y profesional, máximo 1000 palabras. Solo devuelve el contenido del archivo, sin explicaciones adicionales.`;

    const { callAI } = require('./ai');
    const content = await callAI(analysisPrompt);
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI ────────────────────────────────────────────────────────────────────────

const {
  getProviderStatus,
  generateAgentPrompt,
  getSuggestions,
  generateProjectSuggestions,
  clearSuggestionsCache,
  callAIChat,
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

// POST /api/ai/optimize-agent — rewrite & improve an existing agent system prompt
app.post('/api/ai/optimize-agent', async (req, res) => {
  const { name, description, system, tools = [], model = 'sonnet' } = req.body;
  if (!system) return res.status(400).json({ error: 'system prompt required' });

  const toolList = tools.join(', ') || 'ninguna';
  const modelHint = model === 'haiku' ? 'conciso y directo (modelo ligero)'
    : model === 'opus' ? 'detallado y exhaustivo (modelo avanzado)'
    : 'equilibrado entre concisión y detalle';

  const prompt = `Eres un experto en diseño de system prompts para agentes Claude Code.

Tienes este agente:
- Nombre: ${name || 'agente'}
- Descripción actual: ${description || '(sin descripción)'}
- Herramientas disponibles: ${toolList}
- Modelo: ${model} — estilo ${modelHint}

System prompt actual:
---
${system}
---

Optimiza el system prompt para que sea:
1. Más claro y específico en el rol y objetivo del agente
2. Con instrucciones precisas sobre qué hacer Y qué NO hacer
3. Apropiado para el estilo del modelo (${model})
4. Sin redundancias ni relleno innecesario
5. Enfocado en un objetivo principal; usa pasos concretos solo si aportan claridad

Si la descripción actual es vaga, genérica o está vacía, propón una mejor.

Responde SOLO con JSON válido, sin explicaciones, sin bloques markdown:
{"description":"<descripción mejorada>","system":"<system prompt optimizado>"}`;

  try {
    const { callAI } = require('./ai');
    const raw = await callAI(prompt, { maxTokens: 800 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('La IA no devolvió JSON válido');
    const { description: newDesc, system: newSystem } = JSON.parse(jsonMatch[0]);
    res.json({ description: newDesc, system: newSystem });
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

// ── Project-specific suggestions ─────────────────────────────────────────────

function projectSuggestionsCacheKey(projectId) {
  return `project::${projectId}`;
}

async function getProjectSuggestionsImpl(projectId, force = false) {
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

  const provider = project.aiProvider === 'github' ? 'github' : 'claude';
  const ctx      = getContextFile(project, provider);
  const cat      = (cfg.categories || []).find(c => c.id === project.categoryId);
  const tech     = (cat?.technologies || []).find(t => t.id === project.techId);
  const existing = listProjectAgents(project.path, [provider]).map(a => a.name);

  const suggestions = await generateProjectSuggestions({
    project,
    contextContent: ctx.content || '',
    categoryName:   cat?.name || project.categoryId || '',
    techName:       tech?.name || project.techId || '',
    existingAgents: existing,
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
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    res.json(await getProjectSuggestionsImpl(projectId, true));
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
  const collect = (level, catId, techId) => {
    try { all.push(...listAgentsByLevel(level, catId, techId)); } catch {}
  };
  collect('global');
  for (const cat of (cfg.categories || [])) {
    collect('section', cat.id);
    for (const tech of (cat.technologies || [])) collect('tech', cat.id, tech.id);
  }
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

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(RENDERER_DIR, 'index.html'));
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
