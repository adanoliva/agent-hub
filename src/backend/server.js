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
  getContextAuto,
  deriveAgentTask,
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
  if (aiProvider            !== undefined) {
    if (aiProvider !== cfg.aiProvider) resetAllUsage();
    cfg.aiProvider = aiProvider;
  }
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
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (req.query.type === 'auto') return res.json(getContextAuto(project, cfg.aiProvider));
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

// ── Execute agent task ────────────────────────────────────────────────────────

app.post('/api/projects/:id/execute-task', async (req, res) => {
  const cfg     = readConfig();
  const project = cfg.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { agent } = req.body;
  if (!agent)       return res.status(400).json({ error: 'Agent required' });
  if (!agent.model) return res.status(400).json({ error: 'El agente no tiene modelo especificado' });

  const ctxInfo = getContextAuto(project, cfg.aiProvider);
  const task    = deriveAgentTask(agent);

  const projectMeta = `Proyecto: ${project.name}\nRuta: ${project.path}`;
  const systemPrompt = [
    agent.system || '',
    `\n\n---\n${projectMeta}`,
    ctxInfo.content
      ? `\n\n---\nContexto del proyecto (${ctxInfo.label}):\n\n${ctxInfo.content.slice(0, 8000)}`
      : '',
  ].join('').trim();

  const startTime = Date.now();
  try {
    const reply = await callAIChat(
      [{ role: 'user', content: task }],
      {
        systemPrompt,
        extraArgs: ['--dangerously-skip-permissions', '--max-turns', '5'],
        cwd: project.path,
        timeout: 900_000, // 15 min — el agente usa herramientas reales
      },
    );
    res.json({ result: reply, task, durationMs: Date.now() - startTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

function buildDashboardNotifications(allAgents, projects, categories = []) {
  const notifications = [];

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || id || 'N/A';
  const techName = (catId, techId) => {
    const cat = categories.find((c) => c.id === catId);
    return cat?.technologies?.find((t) => t.id === techId)?.name || techId || 'N/A';
  };
  const agentScopeLabel = (agent) => {
    if (agent.level === 'global') return 'Global';
    if (agent.level === 'section') return `Categoría: ${categoryName(agent.categoryId)}`;
    if (agent.level === 'tech') {
      return `Tecnología: ${categoryName(agent.categoryId)} / ${techName(agent.categoryId, agent.techId)}`;
    }
    if (agent.level === 'uncategorized') return 'Sin categoría';
    return agent.level || 'Desconocido';
  };
  const agentScopeKey = (agent) => [
    agent.level || 'unknown',
    agent.categoryId || 'none',
    agent.techId || 'none',
  ].join('-');

  for (const agent of allAgents) {
    if (!agent.tools || agent.tools.length === 0) {
      notifications.push({
        id:         `agent-no-tools-${agent.name}-${agentScopeKey(agent)}`,
        type:       'optimization',
        target:     'agent',
        targetName: agent.name,
        scopeLabel: agentScopeLabel(agent),
        message:    'Sin herramientas configuradas',
        action:     'open-agent',
        level:      agent.level,
        categoryId: agent.categoryId || null,
        techId:     agent.techId     || null,
      });
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
        techId:     agent.techId     || null,
      });
    }
  }

  const MIN_CONTEXT_LENGTH = 80;

  for (const project of projects) {
    if (!project.pathExists) continue;

    const needsClaude = project.aiProvider === 'claude' || project.aiProvider === 'both';
    const needsGithub = project.aiProvider === 'github' || project.aiProvider === 'both';

    if (needsClaude) {
      const claudeMdPath = path.join(project.path, 'CLAUDE.md');
      if (!fs.existsSync(claudeMdPath)) {
        notifications.push({
          id:         `project-no-claude-md-${project.id}`,
          type:       'critical',
          target:     'project',
          targetName: project.name,
          targetId:   project.id,
          message:    'Sin CLAUDE.md',
          action:     'generate-context',
        });
      } else {
        const content = fs.readFileSync(claudeMdPath, 'utf8').trim();
        if (content.length < MIN_CONTEXT_LENGTH) {
          notifications.push({
            id:         `project-empty-claude-md-${project.id}`,
            type:       'optimization',
            target:     'project',
            targetName: project.name,
            targetId:   project.id,
            message:    'CLAUDE.md sin contexto del proyecto',
            action:     'generate-context',
          });
        }
      }
    }

    if (needsGithub) {
      const githubInstrPath = path.join(project.path, '.github', 'copilot-instructions.md');
      if (!fs.existsSync(githubInstrPath)) {
        notifications.push({
          id:         `project-no-github-instr-${project.id}`,
          type:       'critical',
          target:     'project',
          targetName: project.name,
          targetId:   project.id,
          message:    'Sin copilot-instructions.md',
          action:     'generate-context',
        });
      } else {
        const content = fs.readFileSync(githubInstrPath, 'utf8').trim();
        if (content.length < MIN_CONTEXT_LENGTH) {
          notifications.push({
            id:         `project-empty-github-instr-${project.id}`,
            type:       'optimization',
            target:     'project',
            targetName: project.name,
            targetId:   project.id,
            message:    'copilot-instructions.md sin contexto del proyecto',
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

function normalizeDismissedDashboardIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()))];
}

app.get('/api/dashboard', (req, res) => {
  try {
    const cfg      = readConfig();
    const projects = listProjectsWithStatus();

    const globalAgents  = listAgentsByLevel('global');
    const uncatAgents   = listAgentsByLevel('uncategorized');
    const sectionAgents = cfg.categories.flatMap(cat => listAgentsByLevel('section', cat.id));
    const techAgents    = cfg.categories.flatMap(cat =>
      cat.technologies.flatMap(tech => listAgentsByLevel('tech', cat.id, tech.id)),
    );
    const allAgents = [...globalAgents, ...sectionAgents, ...techAgents, ...uncatAgents];

    const dirState = agentsSync.getSyncState();
    const dirMeta  = agentsSync.readMeta ? agentsSync.readMeta() : null;

    const lastSyncAt = projects
      .map(p => p.lastSyncAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

    const dismissedIds = new Set(normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications));
    const notifications = buildDashboardNotifications(allAgents, projects, cfg.categories || [])
      .filter((n) => !dismissedIds.has(n.id));

    res.json({
      agents: {
        total:         allAgents.length,
        global:        globalAgents.length,
        section:       sectionAgents.length,
        tech:          techAgents.length,
        uncategorized: uncatAgents.length,
      },
      projects: {
        total:       projects.length,
        active:      projects.filter(p => p.status === 'active').length,
        paused:      projects.filter(p => p.status === 'paused').length,
        archived:    projects.filter(p => p.status === 'archived').length,
        withPending: projects.filter(p => (p.pendingUpdates || 0) > 0).length,
        totalPending: projects.reduce((s, p) => s + (p.pendingUpdates || 0), 0),
      },
      lastSyncAt,
      dirStatus: {
        enabled:          cfg.agentsDirectoryEnabled !== false,
        syncing:          dirState.syncing,
        lastSync:         dirMeta?.lastSync || null,
        pendingConflicts: dirState.pendingConflicts || [],
        lastResult:       dirState.lastResult || null,
      },
      notifications,
      hiddenNotifications: dismissedIds.size,
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

  const cfg = readConfig();
  const current = normalizeDismissedDashboardIds(cfg.dismissedDashboardNotifications);
  cfg.dismissedDashboardNotifications = [...new Set([...current, id])];
  writeConfig(cfg);
  res.json({ ok: true, hiddenNotifications: cfg.dismissedDashboardNotifications.length });
});

app.post('/api/dashboard/notifications/restore', (req, res) => {
  const cfg = readConfig();
  cfg.dismissedDashboardNotifications = [];
  writeConfig(cfg);
  res.json({ ok: true, hiddenNotifications: 0 });
});

// ── AI ────────────────────────────────────────────────────────────────────────

const {
  getProviderStatus,
  generateAgentPrompt,
  getSuggestions,
  generateProjectSuggestions,
  clearSuggestionsCache,
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
  const { name, description, system, tools = [], model = 'sonnet', language = 'en' } = req.body;
  if (!system) return res.status(400).json({ error: 'system prompt required' });

  const toolList   = tools.join(', ') || 'ninguna';
  const langTarget = language === 'es' ? 'Spanish' : 'English';

  const prompt = `Rewrite this Claude Code agent's system prompt to be maximally token-efficient. Your goal is to cut tokens, not add them.

Agent: ${name || 'agent'} (model: ${model}, tools: ${toolList})
Current description: ${description || '(none)'}

Current system prompt:
---
${system}
---

Rules for the rewrite:
- Target: 50-100 words. Never exceed 120.
- Remove ALL filler: "You are an expert", "Your goal is", "Always remember", generic encouragement.
- Remove instructions the model already follows by default (be accurate, be helpful, etc.).
- Keep ONLY what is specific and differentiating for THIS agent's task.
- Use imperative verbs. No preamble.
- Write in ${langTarget}.
- If the current description is vague or generic, write a sharper one (one action sentence, max 80 chars, in ${langTarget}).

Respond ONLY with valid JSON, no markdown:
{"description":"<sharp one-sentence description>","system":"<rewritten prompt, 50-100 words>"}`;

  try {
    const { callAI } = require('./ai');
    const raw = await callAI(prompt, { maxTokens: 500 });
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

  const provider = project.aiProvider === 'github' ? 'github' : 'claude';
  const ctx      = getContextFile(project, provider);
  const cat      = (cfg.categories || []).find(c => c.id === project.categoryId);
  const tech     = (cat?.technologies || []).find(t => t.id === project.techId);
  const existing    = listProjectAgents(project.path, [provider]).map(a => a.name);
  const allExcluded = [...new Set([...existing, ...alreadySuggested])];

  const suggestions = await generateProjectSuggestions({
    project,
    contextContent: ctx.content || '',
    categoryName:   cat?.name || project.categoryId || '',
    techName:       tech?.name || project.techId || '',
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
