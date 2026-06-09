/**
 * config.js — Configuration management
 *
 * In portable mode (production), all data lives next to the .exe.
 * In dev mode, data lives in the project root.
 *
 * Directory structure created on first run:
 *   APP_DIR/
 *     config.json
 *     agents/
 *       global/
 *       section-{id}/
 *     skills/
 *     cache/
 */

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

// ── App root path (portable-aware) ────────────────────────────────────────────

function getAppDir() {
  const isPackaged = Boolean(app && app.isPackaged);
  if (!isPackaged) {
    // Dev: CDM_DATA_DIR overrides the default location (project root)
    return process.env.CDM_DATA_DIR
      || path.join(__dirname, '..', '..');
  }
  // Portable: electron-builder sets PORTABLE_EXECUTABLE_DIR at runtime
  return process.env.PORTABLE_EXECUTABLE_DIR
    || path.dirname(process.execPath);
}

/**
 * Returns the path to the bundled assets directory.
 * In production this is inside the asar resources.
 * Only used for reading — never write here.
 */
function getAssetsDir() {
  const isPackaged = Boolean(app && app.isPackaged);
  if (!isPackaged) {
    return path.join(__dirname, '..', '..', 'assets');
  }
  return path.join(process.resourcesPath, 'assets');
}

const APP_DIR      = getAppDir();
const CONFIG_FILE  = path.join(APP_DIR, 'config.json');
const AGENTS_DIR   = path.join(APP_DIR, 'agents');
const CACHE_DIR    = path.join(APP_DIR, 'cache');
const SKILLS_DIR   = path.join(AGENTS_DIR, 'skills');
const SCRIPTS_DIR  = path.join(APP_DIR, 'user-scripts');

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  version: '2.4.0',
  aiProvider: 'cli',

  // Anthropic API
  apiKey: '',
  apiModel: 'claude-sonnet-4-20250514',

  // OpenAI API
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',

  // GitHub Models
  githubToken: '',
  githubModel: 'gpt-4o-mini',

  // Gemini API
  geminiApiKey: '',
  geminiApiModel: 'gemini-2.5-flash',

  // Mistral API
  mistralKey: '',
  mistralModel: 'mistral-small-latest',

  // Grok (xAI)
  grokKey: '',
  grokModel: 'grok-3-mini',

  // DeepSeek API
  deepseekKey: '',
  deepseekModel: 'deepseek-chat',

  // Groq API
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',

  // OpenRouter API
  openrouterKey: '',
  openrouterModel: 'anthropic/claude-3.5-sonnet',

  // Perplexity API
  perplexityKey: '',
  perplexityModel: 'sonar-reasoning-pro',

  // Custom Providers
  customProviders: [],

  // CLI models
  geminiCliModel: 'gemini-2.5-pro',
  codexCliModel: 'o4-mini',

  closeAction: 'ask',  // 'ask' | 'tray' | 'quit'
  externalScriptsTimeoutMs: 60000,
  agentsDirectoryUrl:     'https://github.com/adanoliva/agents-directory',
  agentsDirectoryEnabled: true,
  dismissedDashboardNotifications: [],
  snoozedDashboardNotifications: {},
  // MCP servers available globally (no credentials required — activate out of the box)
  globalMcpServers: {
    fetch: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-fetch'],
    },
    memory: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-memory'],
    },
    'sequential-thinking': {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    },
  },
  categories: [
    { id: 'frontend', name: 'Frontend',   icon: 'ti-layout',            color: '#60a5fa', technologies: [] },
    { id: 'backend',  name: 'Backend',    icon: 'ti-server',            color: '#34d399', technologies: [] },
    { id: 'mobile',   name: 'Mobile',     icon: 'ti-device-mobile',     color: '#a78bfa', technologies: [] },
    { id: 'devops',   name: 'DevOps',     icon: 'ti-settings-2',        color: '#fbbf24', technologies: [] },
    { id: 'data',     name: 'Data / IA',  icon: 'ti-chart-bar',         color: '#fb923c', technologies: [] },
    { id: 'games',    name: 'Games',      icon: 'ti-device-gamepad-2',  color: '#f472b6', technologies: [] },
  ],
  projects: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(raw) };

    // Migration: aiProvider (string) -> aiProviders (array)
    let migrated = false;
    for (const project of (cfg.projects || [])) {
      if (project.aiProvider && !project.aiProviders) {
        if (project.aiProvider === 'both') project.aiProviders = ['claude', 'github'];
        else project.aiProviders = [project.aiProvider];
        delete project.aiProvider;
        migrated = true;
      }
      if (!project.aiProviders) {
        project.aiProviders = ['claude'];
        migrated = true;
      }
    }
    if (migrated) writeConfig(cfg);

    return cfg;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Agent dir resolver ────────────────────────────────────────────────────────

function getAgentDir(level, sectionId) {
  switch (level) {
    case 'global':        return path.join(AGENTS_DIR, 'global');
    case 'section':       return path.join(AGENTS_DIR, `section-${sectionId}`);
    case 'uncategorized': return path.join(AGENTS_DIR, 'uncategorized');
    default:              return null;
  }
}

// ── First-run bootstrap ───────────────────────────────────────────────────────

/**
 * Creates all required directories based on current config.
 * Safe to call multiple times (idempotent).
 */
function bootstrapDirectories(cfg) {
  ensureDir(AGENTS_DIR);
  ensureDir(CACHE_DIR);
  ensureDir(SKILLS_DIR);
  try { ensureDir(SCRIPTS_DIR); } catch (e) { console.warn('[config] No se pudo crear scripts/:', e.message); }
  ensureDir(path.join(AGENTS_DIR, 'global'));
  ensureDir(path.join(AGENTS_DIR, 'uncategorized'));

  for (const cat of (cfg.categories || [])) {
    ensureDir(path.join(AGENTS_DIR, `section-${cat.id}`));
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  APP_DIR,
  CONFIG_FILE,
  AGENTS_DIR,
  CACHE_DIR,
  SKILLS_DIR,
  SCRIPTS_DIR,
  readConfig,
  writeConfig,
  bootstrapDirectories,
  getAgentDir,
  getAssetsDir,
  ensureDir,
};
