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
 *       tech-{catId}-{techId}/
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

const APP_DIR    = getAppDir();
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const AGENTS_DIR  = path.join(APP_DIR, 'agents');
const CACHE_DIR   = path.join(APP_DIR, 'cache');

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  version: '1.9.3',
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

  theme: 'dark',       // 'dark' | 'light'
  closeAction: 'ask',  // 'ask' | 'tray' | 'quit'
  agentsDirectoryUrl:     'https://github.com/adanoliva/agents-directory',
  agentsDirectoryEnabled: true,
  dismissedDashboardNotifications: [],
  snoozedDashboardNotifications: {},
  categories: [
    {
      id: 'games',
      name: 'Juegos',
      icon: 'ti-device-gamepad-2',
      color: '#3ecf8e',
      technologies: [
        { id: 'unity', name: 'Unity' },
        { id: 'godot', name: 'Godot' },
      ],
    },
    {
      id: 'web',
      name: 'Aplicaciones Web',
      icon: 'ti-world',
      color: '#60a5fa',
      technologies: [
        { id: 'react',     name: 'React'     },
        { id: 'fullstack', name: 'Fullstack' },
        { id: 'nextjs',    name: 'Next.js'   },
      ],
    },
    {
      id: 'mobile',
      name: 'Apps Móviles',
      icon: 'ti-device-mobile',
      color: '#fbbf24',
      technologies: [
        { id: 'react-native', name: 'React Native' },
        { id: 'pwa',          name: 'PWA'          },
      ],
    },
    {
      id: 'docs',
      name: 'Documentación',
      icon: 'ti-file-description',
      color: '#fb7185',
      technologies: [],
    },
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
    return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Agent dir resolver ────────────────────────────────────────────────────────

function getAgentDir(level, sectionId, techId) {
  switch (level) {
    case 'global':        return path.join(AGENTS_DIR, 'global');
    case 'section':       return path.join(AGENTS_DIR, `section-${sectionId}`);
    case 'tech':          return path.join(AGENTS_DIR, `tech-${sectionId}-${techId}`);
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
  ensureDir(path.join(AGENTS_DIR, 'global'));
  ensureDir(path.join(AGENTS_DIR, 'uncategorized'));

  for (const cat of (cfg.categories || [])) {
    ensureDir(path.join(AGENTS_DIR, `section-${cat.id}`));
    for (const tech of (cat.technologies || [])) {
      ensureDir(path.join(AGENTS_DIR, `tech-${cat.id}-${tech.id}`));
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  APP_DIR,
  CONFIG_FILE,
  AGENTS_DIR,
  CACHE_DIR,
  readConfig,
  writeConfig,
  bootstrapDirectories,
  getAgentDir,
  getAssetsDir,
  ensureDir,
};
