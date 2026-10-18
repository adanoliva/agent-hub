'use strict';

/**
 * project-runner.js — runs the configured AI inside a project, whatever the provider.
 *
 *   native CLI → spawned in the project folder, like a terminal; it loads AGENTS.md / CLAUDE.md… itself
 *   API        → Subsystem CLI (virtual tools on the project) with the project context in the prompt
 *
 * Used by orchestrations, POST /projects/:id/run (CLI `agent-hub`) and the project chat.
 */

const fs   = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const ai   = require('./ai');
const mcp  = require('./mcp');
const { readProjectContext } = require('./projects');

const MAX_CONTEXT_CHARS = 20_000;

// The project context only goes into the prompt when the engine won't load it by itself
function contextForPrompt(project, provider) {
  const own = ai.CLI_ADAPTERS[provider]?.contextFiles || [];
  if (own.some(f => fs.existsSync(path.join(project.path, f)))) return '';
  const { content } = readProjectContext(project.path);
  return content.length > MAX_CONTEXT_CHARS ? content.slice(0, MAX_CONTEXT_CHARS) + '\n[contexto truncado]' : content;
}

/**
 * @param {object} project
 * @param {object} p
 * @param {string}  p.userMessage
 * @param {string}  [p.systemPrompt]   — agent prompt + skills (+ handoff instructions)
 * @param {'agent'|'read'} [p.mode]     — 'read' never modifies the project (chat)
 * @param {boolean} [p.includeContext]
 * @param {number}  [p.maxTurns]
 * @param {number}  [p.timeout]
 * @param {string}  [p.model]          — agent model; only Claude CLI understands Claude aliases
 * @param {object}  [p.mcpServers]
 * @param {boolean} [p.useBrowser]
 * @param {Function} [p.log]           — (level, message)
 * @param {AbortSignal} [p.signal]     — aborting kills the running CLI / stops the API loop
 * @returns {Promise<{ text, inputTokens, outputTokens, costUSD, costUnavailable, mcpIgnored, filesModified }>}
 *          filesModified is null for native CLIs (callers diff the filesystem)
 */
async function runInProject(project, {
  userMessage, systemPrompt = '', mode = 'agent', includeContext = true,
  maxTurns = 10, timeout = 1_800_000, model, mcpServers = {}, useBrowser = false, log = () => {}, signal,
}) {
  const cfg      = readConfig();
  const provider = cfg.aiProvider || 'cli';
  // Read-only work with a CLI that can't be kept from writing goes through the Subsystem CLI: Agent Hub
  // runs the (read-only) tools and the CLI only answers, from a neutral folder
  const native   = ai.isNativeCLI(provider, cfg) && (mode === 'agent' || !!ai.CLI_ADAPTERS[provider]?.readOnly);
  const context  = includeContext ? contextForPrompt(project, native ? provider : null) : '';

  const mcpNames   = Object.keys(mcpServers);
  const mcpIgnored = native && !mcp.NATIVE_MCP_PROVIDERS.includes(provider) ? mcpNames : [];
  if (mcpIgnored.length) log('warn', `MCP (${mcpIgnored.join(', ')}) no se aplica con el proveedor "${provider}": se ejecuta sin esas herramientas`);
  const onRetry = (err, n, wait) => log('warn', `${err.message.slice(0, 200)} — reintento ${n} en ${wait / 1000}s`);

  if (native) {
    const prompt = [systemPrompt, context && `# CONTEXTO DEL PROYECTO\n${context}`, userMessage].filter(Boolean).join('\n\n---\n\n');
    // Retries spend from the same budget: each attempt only gets what is left
    const deadline = Date.now() + timeout;
    const r = await ai.withRetry(() => ai.callAIRich(prompt, {
      mode, cwd: project.path, timeout: Math.max(10_000, deadline - Date.now()), maxTurns,
      model: provider === 'cli' ? model : undefined,
      mcpServers: mcpIgnored.length ? {} : mcpServers, signal,
    }), { onRetry, signal });
    return { ...r, costUnavailable: provider !== 'cli', mcpIgnored, filesModified: null };
  }

  const r = await ai.callAIWithSubsystemCLI(userMessage, systemPrompt, {
    onRetry, signal,
    projectPath: project.path, projectContext: context, provider, maxTurns, timeout,
    useBrowser, mcpServers, projectId: project.id, readOnly: mode !== 'agent',
    // GitHub Models falls back to config.githubModel when the agent's model is unknown
    model: provider === 'github' ? model : undefined,
  });
  if (signal?.aborted) throw new Error('Ejecución cancelada');
  const text = r.finalResponse || r.result || '';
  if (!r.success && r.error) {
    if (!text.trim()) throw new Error(r.error);
    log('warn', `${r.error} — usando respuesta parcial`);
  }
  const inputTokens  = r.tokens?.input  || 0;
  const outputTokens = r.tokens?.output || 0;
  // Only the Anthropic API has a known price list here
  const costUSD = provider === 'api' ? ai.calcAnthropicCost(cfg.apiModel || ai.MODEL, inputTokens, outputTokens) : 0;
  return { text, inputTokens, outputTokens, costUSD, costUnavailable: provider !== 'api', mcpIgnored, filesModified: r.filesModified || [] };
}

module.exports = { runInProject, contextForPrompt };
