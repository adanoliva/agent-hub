/**
 * mcp.js — Model Context Protocol client
 *
 * Manages MCP server configuration and lifecycle for all AI providers.
 * Implements the JSON-RPC 2.0 protocol directly (no SDK dependency).
 *
 * Supports:
 *   - stdio servers (local processes)
 *   - url servers (HTTP/SSE remotes)
 */

const { spawn }   = require('child_process');
const path        = require('path');
const fs          = require('fs');
const { readConfig, writeConfig, APP_DIR } = require('./config');

// ── Running process pool ──────────────────────────────────────────────────────
// key: serverName, value: { process, buffer, pending: Map<id, {resolve,reject}>, refCount, idleTimer }
// refCount: number of active consumers (orchestration steps) keeping the process alive.
// idleTimer: setTimeout handle to stop the process after IDLE_TTL_MS when refCount reaches 0.
const _pool     = new Map();
let   _rpcId    = 1;
const IDLE_TTL_MS = 30_000; // keep processes alive 30s after last consumer releases them

// ── Env var resolution ────────────────────────────────────────────────────────

function resolveEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] ?? '');
}

function resolveEnvMap(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, resolveEnv(v)])
  );
}

// ── Config helpers ────────────────────────────────────────────────────────────

/**
 * Returns merged global + project servers, project taking precedence.
 * @param {string|null} projectId
 * @returns {Record<string, object>}
 */
function getMergedServers(projectId) {
  const cfg     = readConfig();
  const global_ = cfg.globalMcpServers || {};
  if (!projectId) return global_;

  const project = (cfg.projects || []).find(p => p.id === projectId);
  const local   = (project && project.mcpServers) || {};
  return { ...global_, ...local };
}

/**
 * Returns only the servers declared in agent.mcp_servers[].
 */
function getServersForAgent(agent, projectId) {
  const names = agent?.mcp_servers;
  if (!Array.isArray(names) || names.length === 0) return {};
  const all = getMergedServers(projectId);
  return Object.fromEntries(names.filter(n => all[n]).map(n => [n, all[n]]));
}

// ── Process lifecycle ─────────────────────────────────────────────────────────

function _startProcess(name, cfg_) {
  const env = { ...process.env, ...resolveEnvMap(cfg_.env) };
  const args = (cfg_.args || []).map(resolveEnv);

  const child = spawn(resolveEnv(cfg_.command), args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const entry = { process: child, buffer: '', pending: new Map(), refCount: 0, idleTimer: null };
  _pool.set(name, entry);

  child.stdout.on('data', (data) => {
    entry.buffer += data.toString();
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id != null && entry.pending.has(msg.id)) {
          const { resolve, reject } = entry.pending.get(msg.id);
          entry.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch { /* ignore non-JSON lines */ }
    }
  });

  child.on('exit', () => {
    _pool.delete(name);
    // reject all pending calls
    for (const { reject } of entry.pending.values()) {
      reject(new Error(`MCP server "${name}" exited unexpectedly`));
    }
    entry.pending.clear();
  });

  child.stderr.on('data', (d) => {
    // swallow stderr; server logs go here legitimately during init
    if (process.env.MCP_DEBUG) console.error(`[mcp:${name}]`, d.toString().trimEnd());
  });

  return entry;
}

/**
 * Sends a JSON-RPC 2.0 request over stdio.
 */
function _rpcStdio(name, method, params) {
  return new Promise((resolve, reject) => {
    const entry = _pool.get(name);
    if (!entry) return reject(new Error(`MCP server "${name}" not running`));

    const id  = _rpcId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n';
    entry.pending.set(id, { resolve, reject });
    entry.process.stdin.write(msg, 'utf8');

    // Per-call timeout: 30s
    setTimeout(() => {
      if (entry.pending.has(id)) {
        entry.pending.delete(id);
        reject(new Error(`MCP call "${method}" on server "${name}" timed out`));
      }
    }, 30_000);
  });
}

/**
 * Sends a JSON-RPC 2.0 request over HTTP (url-type servers).
 */
async function _rpcHttp(serverCfg, method, params) {
  const url     = resolveEnv(serverCfg.url);
  const headers = { 'Content-Type': 'application/json', ...resolveEnvMap(serverCfg.headers) };
  const body    = JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params: params || {} });

  const res  = await fetch(url, { method: 'POST', headers, body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

function _rpc(name, serverCfg, method, params) {
  if (serverCfg.type === 'url') return _rpcHttp(serverCfg, method, params);
  return _rpcStdio(name, method, params);
}

// ── MCP initialization handshake ──────────────────────────────────────────────

async function _initialize(name, serverCfg) {
  try {
    await _rpc(name, serverCfg, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-hub', version: '1.0' },
    });
    await _rpc(name, serverCfg, 'notifications/initialized', {});
  } catch {
    // Some servers don't require/respond to initialize — ignore errors here
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensures stdio servers are running. No-op for url servers.
 * Does NOT increment refCount — use acquireServers/releaseServers for
 * lifecycle management across multiple consumers (orchestration steps).
 * @param {string[]} names - server names
 * @param {string|null} projectId
 */
async function spawnServers(names, projectId) {
  const all = getMergedServers(projectId);
  for (const name of names) {
    const cfg_ = all[name];
    if (!cfg_ || cfg_.type === 'url') continue;
    if (_pool.has(name)) continue; // already running
    _startProcess(name, cfg_);
    await _initialize(name, cfg_);
  }
}

/**
 * Acquires servers for a consumer: starts them if needed and increments refCount.
 * Cancels any pending idle shutdown timer.
 * Returns the list of names that were actually started.
 */
async function acquireServers(names, projectId) {
  const all = getMergedServers(projectId);
  for (const name of names) {
    const cfg_ = all[name];
    if (!cfg_ || cfg_.type === 'url') continue;

    let entry = _pool.get(name);
    if (!entry) {
      _startProcess(name, cfg_);
      await _initialize(name, cfg_);
      entry = _pool.get(name);
    }

    if (entry) {
      // Cancel idle shutdown if it was pending
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      entry.refCount++;
    }
  }
}

/**
 * Releases servers for a consumer: decrements refCount and schedules idle
 * shutdown after IDLE_TTL_MS if no other consumers are left.
 */
function releaseServers(names) {
  for (const name of names) {
    const entry = _pool.get(name);
    if (!entry) continue;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0 && !entry.idleTimer) {
      entry.idleTimer = setTimeout(() => {
        const e = _pool.get(name);
        if (e && e.refCount === 0) {
          e.process.kill();
          _pool.delete(name);
        }
      }, IDLE_TTL_MS);
    }
  }
}

/**
 * Stops named stdio servers immediately, regardless of refCount.
 */
function stopServers(names) {
  for (const name of names) {
    const entry = _pool.get(name);
    if (entry) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.process.kill();
      _pool.delete(name);
    }
  }
}

/**
 * Lists all tools from the given servers.
 * Returns flat array: [{ serverName, name, description, inputSchema }]
 */
async function listTools(names, projectId) {
  const all   = getMergedServers(projectId);
  const tools = [];

  for (const name of names) {
    const cfg_ = all[name];
    if (!cfg_) continue;
    try {
      const result = await _rpc(name, cfg_, 'tools/list', {});
      for (const t of (result?.tools || [])) {
        tools.push({ serverName: name, name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    } catch (e) {
      console.warn(`[mcp] Could not list tools for "${name}": ${e.message}`);
    }
  }

  return tools;
}

/**
 * Calls a tool on a server.
 * @returns {string} text output of the tool call
 */
async function callTool(serverName, toolName, input, projectId) {
  const all  = getMergedServers(projectId);
  const cfg_ = all[serverName];
  if (!cfg_) throw new Error(`MCP server "${serverName}" not configured`);

  const result = await _rpc(serverName, cfg_, 'tools/call', { name: toolName, arguments: input || {} });
  const content = result?.content || [];

  return content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n') || JSON.stringify(result);
}

/**
 * Returns status snapshot of running processes.
 */
function getStatus() {
  const running = [];
  for (const [name, entry] of _pool.entries()) {
    running.push({ name, pid: entry.process.pid, pendingCalls: entry.pending.size });
  }
  return { running };
}

// ── CLI settings sync ─────────────────────────────────────────────────────────

/**
 * Returns extra CLI arguments to inject MCP servers for CLIs that support
 * per-invocation MCP flags (e.g. aider --mcp-server).
 * Returns an empty array for CLIs without this support.
 *
 * @param {string} provider - CLI provider id ('aider-cli', 'gemini-cli', etc.)
 * @param {Record<string, object>} servers
 * @returns {string[]} extra args to pass to the CLI spawn
 */
function getMcpExtraArgs(provider, servers) {
  const entries = Object.entries(servers);
  if (entries.length === 0) return [];

  switch (provider) {
    case 'aider-cli': {
      // aider supports: --mcp-server '{"name":"github","command":"npx",...}'
      return entries.flatMap(([name, cfg_]) => {
        if (cfg_.type === 'url') {
          return ['--mcp-server', JSON.stringify({ name, type: 'url', url: resolveEnv(cfg_.url) })];
        }
        return ['--mcp-server', JSON.stringify({
          name,
          command: resolveEnv(cfg_.command),
          args:    (cfg_.args || []).map(resolveEnv),
          env:     resolveEnvMap(cfg_.env),
        })];
      });
    }
    // cline-cli has its own MCP config at ~/.cline/config.json — managed separately
    // goose-cli, codex-cli, copilot-cli: no MCP flags; will use prompt injection via subsystem
    default:
      return [];
  }
}

/**
 * Syncs MCP servers for Gemini CLI by writing ~/.gemini/settings.json.
 * Gemini CLI reads mcpServers from its own settings file, same shape as Claude CLI.
 */
function syncGeminiCliSettings(servers) {
  const os = require('os');
  const geminiDir  = path.join(os.homedir(), '.gemini');
  const settingsPath = path.join(geminiDir, 'settings.json');

  let existing = {};
  try {
    if (fs.existsSync(settingsPath)) existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch { /* start fresh */ }

  const mcpServers = {};
  for (const [name, cfg_] of Object.entries(servers)) {
    if (cfg_.type === 'url') {
      mcpServers[name] = { type: 'url', url: resolveEnv(cfg_.url), headers: resolveEnvMap(cfg_.headers) };
    } else {
      mcpServers[name] = { command: resolveEnv(cfg_.command), args: (cfg_.args || []).map(resolveEnv), env: resolveEnvMap(cfg_.env) };
    }
  }

  try {
    if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ ...existing, mcpServers }, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[mcp] Could not write Gemini CLI settings: ${e.message}`);
  }
}

/**
 * Writes (or updates) the mcpServers section in {projectPath}/.claude/settings.json
 * so the Claude CLI picks up the configured servers automatically.
 *
 * @param {string} projectPath
 * @param {Record<string, object>} servers - merged servers for this execution
 */
function syncCliSettings(projectPath, servers) {
  if (!projectPath || typeof projectPath !== 'string') return;

  const claudeDir = path.join(projectPath, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  let existing = {};
  try {
    if (fs.existsSync(settingsPath)) {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch { /* start fresh if corrupt */ }

  // Build mcpServers block with env vars resolved inline for the CLI
  const mcpServers = {};
  for (const [name, cfg_] of Object.entries(servers)) {
    if (cfg_.type === 'url') {
      mcpServers[name] = {
        type:    'url',
        url:     resolveEnv(cfg_.url),
        headers: resolveEnvMap(cfg_.headers),
      };
    } else {
      mcpServers[name] = {
        command: resolveEnv(cfg_.command),
        args:    (cfg_.args || []).map(resolveEnv),
        env:     resolveEnvMap(cfg_.env),
      };
    }
  }

  const updated = { ...existing, mcpServers };

  try {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[mcp] Could not write ${settingsPath}: ${e.message}`);
  }
}

/**
 * Builds the MCP tools instruction block to inject into a system prompt
 * (used by the subsystem CLI loop for non-native providers).
 *
 * @param {Array} tools - output of listTools()
 * @returns {string}
 */
function buildMcpToolsBlock(tools) {
  if (!tools || tools.length === 0) return '';

  const descriptions = tools.map(t =>
    `  - ${t.serverName}__${t.name}: ${t.description || '(no description)'}`
  ).join('\n');

  return `
## MCP Tools available

You have access to the following MCP tools. To call one, use this exact format:

TOOL: mcp
SERVER: <serverName>
FUNCTION: <toolName>
INPUT:
<JSON object with the tool arguments>
---

Available tools:
${descriptions}

After receiving the tool result it will appear as a TOOL_RESULT block in the next message.
`;
}

// ── Config CRUD (used by API endpoints) ──────────────────────────────────────

function listServers(projectId) {
  const cfg    = readConfig();
  const global_ = Object.entries(cfg.globalMcpServers || {}).map(([name, config]) => ({
    name, scope: 'global', config,
  }));

  if (!projectId) return global_;

  const project = (cfg.projects || []).find(p => p.id === projectId);
  const local   = Object.entries((project?.mcpServers) || {}).map(([name, config]) => ({
    name, scope: 'project', projectId, config,
  }));

  return [...global_, ...local];
}

function addServer({ scope, projectId, name, config: serverConfig }) {
  const cfg = readConfig();

  if (scope === 'global') {
    cfg.globalMcpServers = cfg.globalMcpServers || {};
    cfg.globalMcpServers[name] = serverConfig;
  } else {
    const project = (cfg.projects || []).find(p => p.id === projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    project.mcpServers = project.mcpServers || {};
    project.mcpServers[name] = serverConfig;
  }

  writeConfig(cfg);
}

function updateServer({ scope, projectId, name, config: serverConfig }) {
  addServer({ scope, projectId, name, config: serverConfig }); // same logic
}

function removeServer({ scope, projectId, name }) {
  const cfg = readConfig();

  if (scope === 'global') {
    if (cfg.globalMcpServers) delete cfg.globalMcpServers[name];
  } else {
    const project = (cfg.projects || []).find(p => p.id === projectId);
    if (project?.mcpServers) delete project.mcpServers[name];
  }

  // Stop process if running
  stopServers([name]);
  writeConfig(cfg);
}

/**
 * Tests a server by starting it (if stdio), listing its tools, and stopping it.
 * For url servers, just fetches the tool list.
 * @returns {{ tools: Array }}
 */
async function testServer(name, serverConfig) {
  const tempName = `__test_${name}_${Date.now()}`;

  if (serverConfig.type !== 'url') {
    _startProcess(tempName, serverConfig);
    await _initialize(tempName, serverConfig);
  }

  let tools = [];
  try {
    const result = await _rpc(tempName, serverConfig, 'tools/list', {});
    tools = result?.tools || [];
  } finally {
    if (serverConfig.type !== 'url') stopServers([tempName]);
  }

  return { tools };
}

// ── Catalog of well-known MCP servers ────────────────────────────────────────

const MCP_CATALOG = [
  // ── Sin credenciales (activados por defecto) ──────────────────────────────
  {
    id:          'fetch',
    label:       'Fetch',
    description: 'Realiza peticiones HTTP GET/POST desde el agente',
    icon:        'ti-world',
    requiresCredentials: false,
    defaultConfig: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
  },
  {
    id:          'memory',
    label:       'Memory',
    description: 'Grafo de conocimiento persistente entre sesiones',
    icon:        'ti-brain',
    requiresCredentials: false,
    defaultConfig: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    id:          'sequential-thinking',
    label:       'Sequential Thinking',
    description: 'Razonamiento estructurado paso a paso',
    icon:        'ti-list-numbers',
    requiresCredentials: false,
    defaultConfig: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequentialthinking'] },
  },
  // ── Requieren credenciales ────────────────────────────────────────────────
  {
    id:          'github',
    label:       'GitHub',
    description: 'Lee y escribe issues, PRs, repos y code search',
    icon:        'ti-brand-github',
    requiresCredentials: true,
    envVars: [{ key: 'GITHUB_TOKEN', label: 'GitHub Token', placeholder: 'ghp_...' }],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-github'],
      env:       { GITHUB_TOKEN: '$env:GITHUB_TOKEN' },
    },
  },
  {
    id:          'jira',
    label:       'Jira + Confluence',
    description: 'Gestiona issues, sprints, boards y páginas de Confluence',
    icon:        'ti-brand-atlassian',
    requiresCredentials: true,
    envVars: [
      { key: 'ATLASSIAN_URL',           label: 'URL de tu instancia',   placeholder: 'https://tu-empresa.atlassian.net' },
      { key: 'ATLASSIAN_EMAIL',         label: 'Email de Atlassian',    placeholder: 'tu@empresa.com' },
      { key: 'ATLASSIAN_API_TOKEN',     label: 'API Token',             placeholder: 'Generado en id.atlassian.com' },
    ],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', 'atlassian-mcp'],
      env:       {
        ATLASSIAN_URL:       '$env:ATLASSIAN_URL',
        ATLASSIAN_EMAIL:     '$env:ATLASSIAN_EMAIL',
        ATLASSIAN_API_TOKEN: '$env:ATLASSIAN_API_TOKEN',
      },
    },
  },
  {
    id:          'postgres',
    label:       'PostgreSQL',
    description: 'Ejecuta queries y explora el esquema de una base de datos',
    icon:        'ti-database',
    requiresCredentials: true,
    envVars: [{ key: 'POSTGRES_URL', label: 'Connection string', placeholder: 'postgresql://user:pass@host/db' }],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-postgres', '$env:POSTGRES_URL'],
    },
  },
  {
    id:          'sqlite',
    label:       'SQLite',
    description: 'Consulta y modifica una base de datos SQLite local',
    icon:        'ti-database',
    requiresCredentials: true,
    envVars: [{ key: 'SQLITE_DB_PATH', label: 'Ruta al archivo .db', placeholder: 'C:/ruta/base.db' }],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-sqlite', '$env:SQLITE_DB_PATH'],
    },
  },
  {
    id:          'brave-search',
    label:       'Brave Search',
    description: 'Búsqueda web en tiempo real con privacidad',
    icon:        'ti-search',
    requiresCredentials: true,
    envVars: [{ key: 'BRAVE_API_KEY', label: 'Brave API Key', placeholder: 'BSA...' }],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-brave-search'],
      env:       { BRAVE_API_KEY: '$env:BRAVE_API_KEY' },
    },
  },
  {
    id:          'slack',
    label:       'Slack',
    description: 'Lee y envía mensajes en canales y DMs',
    icon:        'ti-brand-slack',
    requiresCredentials: true,
    envVars: [
      { key: 'SLACK_BOT_TOKEN',  label: 'Bot Token',  placeholder: 'xoxb-...' },
      { key: 'SLACK_TEAM_ID',    label: 'Team ID',    placeholder: 'T0...' },
    ],
    defaultConfig: {
      transport: 'stdio',
      command:   'npx',
      args:      ['-y', '@modelcontextprotocol/server-slack'],
      env:       { SLACK_BOT_TOKEN: '$env:SLACK_BOT_TOKEN', SLACK_TEAM_ID: '$env:SLACK_TEAM_ID' },
    },
  },
];

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getMergedServers,
  getServersForAgent,
  spawnServers,
  acquireServers,
  releaseServers,
  stopServers,
  listTools,
  callTool,
  getStatus,
  syncCliSettings,
  syncGeminiCliSettings,
  getMcpExtraArgs,
  buildMcpToolsBlock,
  listServers,
  addServer,
  updateServer,
  removeServer,
  testServer,
  MCP_CATALOG,
};
