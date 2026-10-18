/**
 * agent-adapters.js — Convert Claude-format agents for target AI providers.
 *
 * To add a new provider: add an entry to ADAPTERS with its conversion function.
 * Each adapter receives a Claude-format agent and returns a new agent object
 * ready to be serialized for that provider.
 *
 * Source agents always live in Claude format; conversion happens on write only.
 */

// ── Claude model IDs (kept here to avoid circular dependency with agents.js) ──

const CLAUDE_MODEL_IDS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
  opus:   'claude-opus-4-20250514',
};

function resolveClaudeModel(m) {
  return CLAUDE_MODEL_IDS[m] || m || CLAUDE_MODEL_IDS.sonnet;
}

// ── GitHub Copilot adapter ────────────────────────────────────────────────────

// Claude full model ID → GitHub Copilot model
const CLAUDE_TO_GITHUB_MODEL = {
  [CLAUDE_MODEL_IDS.haiku]:  'gpt-4o-mini',
  [CLAUDE_MODEL_IDS.sonnet]: 'gpt-4o',
  [CLAUDE_MODEL_IDS.opus]:   'o1',
};

// Claude tool → GitHub Copilot tool (null = no equivalent, dropped)
const CLAUDE_TO_GITHUB_TOOL = {
  Bash:             'terminalLastCommand',
  Read:             'codebase',
  Write:            null,
  Grep:             'codebase',
  Edit:             null,
  MultiEdit:        null,
  WebFetch:         'fetch',
  WebSearch:        'fetch',
  TodoRead:         null,
  TodoWrite:        null,
  // Browser tools have no GitHub Copilot equivalent — pass through as-is
  browser_open:     'browser_open',
  browser_navigate: 'browser_navigate',
  browser_extract:  'browser_extract',
  browser_close:    'browser_close',
};

// GitHub Copilot tool → Claude tool (for reading back GitHub-format agents)
const GITHUB_TO_CLAUDE_TOOL = {
  terminalLastCommand: 'Bash',
  codebase:            'Read',
  fetch:               'WebFetch',
  // browser tools are already in Claude format
};

// GitHub model → Claude alias (reverse of CLAUDE_TO_GITHUB_MODEL)
const GITHUB_TO_CLAUDE_MODEL = {
  'gpt-4o-mini': 'haiku',
  'gpt-4o':      'sonnet',
  'o1':          'opus',
};

// Friendly replacements used in system prompt text
const TOOL_TEXT_MAP = {
  Bash:       'the terminal',
  Read:       'the codebase tool',
  Write:      'the editor',
  Grep:       'the codebase tool',
  Edit:       'the editor',
  MultiEdit:  'the editor',
  WebFetch:   'fetch',
  WebSearch:  'fetch',
  TodoRead:   'your task list',
  TodoWrite:  'your task list',
};

const CLAUDE_TOOL_PATTERN = /\b(Bash|Read|Write|Grep|Edit|MultiEdit|WebFetch|WebSearch|TodoRead|TodoWrite)\b/g;

function adaptSystemForGitHub(system) {
  if (!system) return system;
  return system
    .replace(CLAUDE_TOOL_PATTERN, (match) => TOOL_TEXT_MAP[match] || match)
    .trim();
}

function adaptForGitHub(agent) {
  const fullModel = resolveClaudeModel(agent.model);
  const model     = CLAUDE_TO_GITHUB_MODEL[fullModel] || 'gpt-4o';
  // Tools are kept in Claude format on disk — no conversion at storage time.
  // CLAUDE_TO_GITHUB_TOOL is reserved for runtime API call adaptation.
  const tools  = agent.tools || [];
  const system = adaptSystemForGitHub(agent.system);
  return { ...agent, model, tools, system };
}

// Reverse adapter: converts a GitHub-format agent back to Claude format for editing
function adaptFromGitHub(agent) {
  const tools = [...new Set(
    (agent.tools || []).map(t => GITHUB_TO_CLAUDE_TOOL[t] || t),
  )];
  const model = GITHUB_TO_CLAUDE_MODEL[agent.model] || agent.model;
  return { ...agent, tools, model };
}

// ── Provider adapter registry ─────────────────────────────────────────────────

const ADAPTERS = {
  claude: (agent) => agent,   // identity — source format is already Claude
  github: adaptForGitHub,
  gemini: (agent) => agent,   // TODO: Specific Gemini adaptation if needed
  openai: (agent) => agent,   // TODO: Specific OpenAI adaptation if needed
};

/**
 * Registry of project-level AI providers and their conventions.
 */
const PROJECT_PROVIDERS = {
  central: {
    id: 'central',
    label: 'Central',
    icon: 'ti-file-description',
    agentDir: [],
    contextFile: 'CONTEXTO.md',
    templateType: 'claude'
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    icon: 'ti-robot',
    agentDir: ['.claude', 'agents'],
    contextFile: 'CLAUDE.md',
    templateType: 'claude'
  },
  github: {
    id: 'github',
    label: 'GitHub Copilot',
    icon: 'ti-brand-github',
    agentDir: ['.github', 'agents'],
    contextFile: '.github/copilot-instructions.md',
    templateType: 'github'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    icon: 'ti-sparkles',
    agentDir: ['.gemini', 'agents'],
    contextFile: 'GEMINI.md',
    templateType: 'gemini'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (Cursor)',
    icon: 'ti-brain',
    agentDir: ['.openai', 'agents'],
    contextFile: 'AGENTS.md',
    templateType: 'openai'
  }
};

/**
 * Returns a new agent object adapted for the target provider.
 * Unknown providers pass through unchanged.
 */
function adaptAgentForProvider(agent, targetProvider) {
  const adapter = ADAPTERS[targetProvider];
  return adapter ? adapter(agent) : agent;
}

module.exports = { adaptAgentForProvider, adaptFromGitHub, PROJECT_PROVIDERS };
