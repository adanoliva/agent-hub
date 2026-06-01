/**
 * subsystem-cli.js — Virtual CLI subsystem for API / GitHub providers
 *
 * Emulates the Claude Code CLI tool-use interface for providers that don't
 * have native filesystem access (Anthropic API, GitHub Models).
 *
 * Components:
 *   parseAgentResponse()    — extracts TOOL: blocks from AI text
 *   executeToolCall()       — translates tool calls to api-fs operations
 *   buildToolResultsMessage() — formats operation results for the next turn
 *   buildSubsystemSystemPrompt() — wraps an agent prompt with tool instructions
 *   execute()               — multi-turn loop (user prompt → final answer)
 *
 * Tool call format in AI responses:
 *
 *   TOOL: read
 *   PATH: src/main.ts
 *
 *   ---
 *
 *   TOOL: write
 *   PATH: src/main.ts
 *   CONTENT:
 *   [full file content here]
 *
 *   ---
 *
 *   TOOL: bash
 *   COMMAND: find src -name "*.ts" -type f
 *
 *   ---
 *
 *   TOOL: grep
 *   PATTERN: export const
 *   FILE: src/**\/*.ts
 */

const crypto  = require('crypto');
const apiFs   = require('./api-fs');
const browser = require('./browser');

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parses tool call blocks from an AI response text.
 *
 * @param {string} text
 * @returns {{ text: string, toolCalls: ParsedToolCall[], hasClosed: boolean }}
 */
function parseAgentResponse(text) {
  const toolCalls = [];
  const rawText   = String(text || '');

  // Split by separator lines ("---" alone on a line)
  const blocks = rawText.split(/^---\s*$/m);

  for (const block of blocks) {
    const toolMatch = block.match(/^TOOL:\s*(\w+)\s*$/m);
    if (!toolMatch) continue;

    const tool = toolMatch[1].toLowerCase();
    if (!['read', 'write', 'bash', 'grep', 'browser_get', 'browser_action', 'browser_screenshot'].includes(tool)) continue;

    let toolCall = null;

    if (tool === 'read') {
      const pathMatch = block.match(/^PATH:\s*(.+)$/m);
      if (!pathMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'read',
        args: { path: pathMatch[1].trim() },
        raw:  block.trim(),
      };
    }

    if (tool === 'write') {
      const pathMatch    = block.match(/^PATH:\s*(.+)$/m);
      const contentMatch = block.match(/^CONTENT:\s*\n([\s\S]*)$/m);
      if (!pathMatch || !contentMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'write',
        args: { path: pathMatch[1].trim(), content: contentMatch[1] },
        raw:  block.trim(),
      };
    }

    if (tool === 'bash') {
      const commandMatch = block.match(/^COMMAND:\s*(.+)$/m);
      if (!commandMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'bash',
        args: { command: commandMatch[1].trim() },
        raw:  block.trim(),
      };
    }

    if (tool === 'grep') {
      const patternMatch = block.match(/^PATTERN:\s*(.+)$/m);
      const fileMatch    = block.match(/^FILE:\s*(.+)$/m);
      if (!patternMatch || !fileMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'grep',
        args: { pattern: patternMatch[1].trim(), file: fileMatch[1].trim() },
        raw:  block.trim(),
      };
    }

    if (tool === 'browser_get') {
      const urlMatch      = block.match(/^URL:\s*(.+)$/m);
      const selectorMatch = block.match(/^SELECTOR:\s*(.+)$/m);
      const formatMatch   = block.match(/^FORMAT:\s*(.+)$/m);
      if (!urlMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'browser_get',
        args: {
          url:      urlMatch[1].trim(),
          selector: selectorMatch ? selectorMatch[1].trim() : undefined,
          format:   formatMatch   ? formatMatch[1].trim()   : 'text',
        },
        raw: block.trim(),
      };
    }

    if (tool === 'browser_action') {
      const actionMatch   = block.match(/^ACTION:\s*(.+)$/m);
      const selectorMatch = block.match(/^SELECTOR:\s*(.+)$/m);
      const valueMatch    = block.match(/^VALUE:\s*(.+)$/m);
      const scriptMatch   = block.match(/^SCRIPT:\s*(.+)$/m);
      const tabMatch      = block.match(/^TAB:\s*(.+)$/m);
      if (!actionMatch) continue;
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'browser_action',
        args: {
          action:   actionMatch[1].trim(),
          selector: selectorMatch ? selectorMatch[1].trim() : undefined,
          value:    valueMatch    ? valueMatch[1].trim()    : undefined,
          script:   scriptMatch   ? scriptMatch[1].trim()   : undefined,
          tabIndex: tabMatch      ? Number(tabMatch[1].trim()) : undefined,
        },
        raw: block.trim(),
      };
    }

    if (tool === 'browser_screenshot') {
      const selectorMatch = block.match(/^SELECTOR:\s*(.+)$/m);
      toolCall = {
        id:   crypto.randomUUID(),
        tool: 'browser_screenshot',
        args: { selector: selectorMatch ? selectorMatch[1].trim() : undefined },
        raw:  block.trim(),
      };
    }

    if (toolCall) toolCalls.push(toolCall);
  }

  return { text: rawText, toolCalls, hasClosed: toolCalls.length === 0 };
}

// ── Executor ──────────────────────────────────────────────────────────────────

/**
 * Executes a single parsed tool call via api-fs.
 *
 * @param {object} toolCall
 * @param {string} projectPath — absolute path to the project root
 * @returns {Promise<OperationResult>}
 */
async function executeToolCall(toolCall, projectPath) {
  const start = Date.now();

  try {
    if (toolCall.tool === 'read') {
      const data = apiFs.readFile(projectPath, toolCall.args.path);
      return {
        toolCall,
        success:      true,
        data,
        executionTime: Date.now() - start,
        filesAffected: [data.path],
      };
    }

    if (toolCall.tool === 'write') {
      const data = apiFs.writeFile(
        projectPath,
        toolCall.args.path,
        toolCall.args.content,
        { reason: `Subsystem CLI — tool call ${toolCall.id}`, toolCallId: toolCall.id },
      );

      if (!data.saved) {
        return {
          toolCall,
          success: false,
          error: {
            code:    'VALIDATION_FAILED',
            message: Array.isArray(data.validations) ? data.validations.join('; ') : 'Validation failed',
            details: data.details,
          },
          executionTime: Date.now() - start,
        };
      }

      return {
        toolCall,
        success:       true,
        data,
        executionTime: Date.now() - start,
        filesAffected: [data.path],
      };
    }

    if (toolCall.tool === 'bash') {
      const data = await apiFs.bashCommand(projectPath, toolCall.args.command);
      return {
        toolCall,
        success:       data.exitCode === 0,
        data,
        executionTime: Date.now() - start,
      };
    }

    if (toolCall.tool === 'grep') {
      const data = apiFs.grepFiles(projectPath, toolCall.args.pattern, toolCall.args.file);
      return {
        toolCall,
        success:       true,
        data,
        executionTime: Date.now() - start,
      };
    }

    if (toolCall.tool === 'browser_get') {
      if (!browser.isConnected()) {
        return {
          toolCall,
          success: false,
          error:   { code: 'BROWSER_NOT_CONNECTED', message: 'Sin conexión al navegador. Usa el botón "Reiniciar con CDP" en el panel de ejecución.' },
          executionTime: Date.now() - start,
        };
      }
      const data = await browser.browserGet(toolCall.args.url, {
        selector: toolCall.args.selector,
        format:   toolCall.args.format || 'text',
      });
      return {
        toolCall,
        success:       true,
        data,
        executionTime: Date.now() - start,
      };
    }

    if (toolCall.tool === 'browser_action' || toolCall.tool === 'browser_screenshot') {
      if (!browser.isConnected()) {
        return {
          toolCall,
          success: false,
          error:   { code: 'BROWSER_NOT_CONNECTED', message: 'Sin conexión al navegador. Usa el botón "Reiniciar con CDP" en el panel de ejecución.' },
          executionTime: Date.now() - start,
        };
      }
      const action = toolCall.tool === 'browser_screenshot' ? 'screenshot' : toolCall.args.action;
      const data   = await browser.browserAction(action, {
        selector: toolCall.args.selector,
        value:    toolCall.args.value,
        script:   toolCall.args.script,
        tabIndex: toolCall.args.tabIndex,
      });
      return {
        toolCall,
        success:       data.ok,
        data,
        executionTime: Date.now() - start,
      };
    }

    return {
      toolCall,
      success: false,
      error:   { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolCall.tool}` },
      executionTime: Date.now() - start,
    };

  } catch (err) {
    return {
      toolCall,
      success: false,
      error:   { code: err.code || 'EXECUTION_ERROR', message: err.message, details: err.stack },
      executionTime: Date.now() - start,
    };
  }
}

// ── Message builder ───────────────────────────────────────────────────────────

/**
 * Formats operation results into a message to send back to the AI.
 *
 * @param {OperationResult[]} results
 * @returns {string}
 */
function buildToolResultsMessage(results) {
  const lines = [
    'RESULTADOS DE OPERACIONES:',
    '═══════════════════════════',
    '',
  ];

  for (const result of results) {
    const tc = result.toolCall;
    lines.push(`▶ ${tc.tool.toUpperCase()}`);
    if (tc.args.path)    lines.push(`  Archivo: ${tc.args.path}`);
    if (tc.args.command) lines.push(`  Comando: ${tc.args.command}`);
    if (tc.args.pattern) lines.push(`  Patrón: ${tc.args.pattern} en ${tc.args.file}`);
    if (tc.args.url)     lines.push(`  URL: ${tc.args.url}`);
    if (tc.args.action)  lines.push(`  Acción: ${tc.args.action}`);
    if (tc.args.selector) lines.push(`  Selector: ${tc.args.selector}`);

    if (result.success) {
      lines.push('  ✓ EXITOSO');

      if (tc.tool === 'read' && result.data) {
        lines.push(`  Tamaño: ${result.data.size} bytes`);
        lines.push(`  Lenguaje: ${result.data.language}`);
        lines.push(`  Hash: ${result.data.hash}`);
        lines.push('  Contenido:');
        // Indent content for readability; cap at 8000 chars
        lines.push('  ' + result.data.content.slice(0, 8_000).split('\n').join('\n  '));
      }

      if (tc.tool === 'write' && result.data) {
        lines.push(`  ✓ Guardado en ${result.data.path}`);
        if (result.data.changes) {
          lines.push(`  Cambios: +${result.data.changes.linesAdded} -${result.data.changes.linesRemoved} líneas`);
        }
        if (result.data.backupPath) lines.push(`  Backup: ${result.data.backupPath}`);
      }

      if (tc.tool === 'bash' && result.data) {
        lines.push('  Salida:');
        lines.push('  ' + (result.data.stdout || '(sin salida)').split('\n').join('\n  '));
        if (result.data.stderr) lines.push('  Stderr: ' + result.data.stderr.split('\n').join('\n  '));
      }

      if (tc.tool === 'grep' && result.data) {
        lines.push(`  ${result.data.count} coincidencia(s) encontrada(s)`);
        for (const m of result.data.matches.slice(0, 20)) {
          lines.push(`  ${m.file}:${m.lineNumber}: ${m.line}`);
        }
        if (result.data.count > 20) lines.push(`  ... y ${result.data.count - 20} más`);
      }

      if (tc.tool === 'browser_get' && result.data) {
        lines.push(`  URL final: ${result.data.url}`);
        lines.push(`  Título: ${result.data.title}`);
        if (result.data.text) {
          lines.push('  Contenido (texto):');
          lines.push('  ' + result.data.text.split('\n').join('\n  '));
        }
        if (result.data.html) {
          lines.push('  HTML:');
          lines.push('  ' + result.data.html.split('\n').join('\n  '));
        }
      }

      if (tc.tool === 'browser_action' && result.data) {
        if (result.data.result) lines.push(`  Resultado: ${result.data.result}`);
      }

      if (tc.tool === 'browser_screenshot') {
        // Screenshots produce binary PNG — not transmittable as text to the model.
        lines.push('  Captura realizada (imagen binaria, no disponible como texto).');
      }
    } else {
      lines.push('  ✗ ERROR');
      lines.push(`  Código: ${result.error?.code || 'UNKNOWN'}`);
      lines.push(`  Mensaje: ${result.error?.message || 'Error desconocido'}`);
    }

    lines.push(`  Tiempo: ${result.executionTime}ms`);
    lines.push('');
  }

  lines.push(
    'PRÓXIMO PASO:',
    'Si necesitas más operaciones, usa las herramientas disponibles.',
    'Si has terminado, da tu respuesta final sin usar herramientas.',
  );

  return lines.join('\n');
}

// ── System prompt builder ─────────────────────────────────────────────────────

/**
 * Wraps the agent's system prompt with tool-use instructions.
 *
 * @param {string} agentSystemPrompt
 * @param {string} [projectContext]
 * @returns {string}
 */
function buildSubsystemSystemPrompt(agentSystemPrompt, projectContext, opts = {}) {
  const { useBrowser = false } = opts;

  const toolInstructions = `HERRAMIENTAS DISPONIBLES:
─────────────────────────
Para interactuar con los archivos del proyecto usa este formato exacto (cada bloque separado por ---):

1. READ — Leer archivo
TOOL: read
PATH: src/main.ts

---

2. WRITE — Escribir/modificar archivo (incluye el contenido COMPLETO)
TOOL: write
PATH: src/main.ts
CONTENT:
[contenido completo del archivo]

---

3. BASH — Ejecutar comando de solo lectura (ls, find, grep, cat, wc, head, tail)
TOOL: bash
COMMAND: find src -name "*.ts" -type f

---

4. GREP — Buscar patrón en archivos
TOOL: grep
PATTERN: export const
FILE: src/**/*.ts${useBrowser ? `

---

5. BROWSER_GET — Navegar a una URL y obtener su contenido
TOOL: browser_get
URL: https://jira.empresa.com/browse/PROJ-123
[SELECTOR: #main-content]   ← opcional: esperar a que este elemento aparezca
[FORMAT: text|html|both]    ← defecto: text

---

6. BROWSER_ACTION — Interactuar con la página actual del navegador
TOOL: browser_action
ACTION: click|fill|select|hover|screenshot|wait|evaluate|tab
SELECTOR: #summary-field     ← requerido para click/fill/select/hover/wait
[VALUE: "nuevo texto"]       ← requerido para fill/select; URL substring para tab
[SCRIPT: document.title]    ← requerido para evaluate

---

7. BROWSER_SCREENSHOT — Capturar pantalla (página completa o elemento)
TOOL: browser_screenshot
[SELECTOR: #main-content]   ← opcional: sólo ese elemento

NOTA NAVEGADOR: El navegador ya tiene sesiones activas (cookies, login). Úsalo
para acceder a páginas que requieren autenticación (Jira, GitHub, Confluence, etc.).
Siempre usa browser_get primero para ver el estado de la página antes de actuar.` : ''}

REGLAS:
- Cada herramienta va en su propia sección separada por ---
- Al usar WRITE incluye el contenido COMPLETO del archivo
- Los --- deben estar solos en su línea
- Puedes usar múltiples herramientas en un mismo turno
- Cuando no necesites más herramientas, da tu respuesta final directamente (sin bloques TOOL)`;

  const parts = [];
  if (agentSystemPrompt?.trim()) {
    parts.push(agentSystemPrompt.trim());
    parts.push('');
  }
  parts.push(toolInstructions);
  if (projectContext?.trim()) {
    parts.push('');
    parts.push('CONTEXTO DEL PROYECTO:');
    parts.push('──────────────────────');
    parts.push(projectContext.trim());
  }

  return parts.join('\n');
}

// ── Multi-turn execute loop ───────────────────────────────────────────────────

/**
 * Executes a prompt using the virtual CLI (multi-turn loop).
 *
 * @param {string} prompt                — user task / instruction
 * @param {string} agentSystemPrompt     — agent's original system prompt
 * @param {object} config
 * @param {string}   config.projectPath      — absolute path to project root
 * @param {Function} config.callAIRaw        — async fn(messages, systemPrompt) → { text, inputTokens, outputTokens }
 * @param {string}   [config.projectContext] — content of CLAUDE.md / instructions
 * @param {number}   [config.maxTurns=10]
 * @param {number}   [config.timeout=300000] — ms
 * @returns {Promise<SubsystemCLIResult>}
 */
async function execute(prompt, agentSystemPrompt, config) {
  const {
    projectPath,
    callAIRaw,
    projectContext = '',
    maxTurns       = 10,
    timeout        = 300_000,
    useBrowser     = false,
  } = config;

  if (!projectPath) throw new Error('projectPath is required for Subsystem CLI');
  if (typeof callAIRaw !== 'function') throw new Error('callAIRaw function is required');

  const systemPrompt  = buildSubsystemSystemPrompt(agentSystemPrompt, projectContext, { useBrowser });
  const messages      = [{ role: 'user', content: String(prompt) }];

  const allToolCalls     = [];
  const allResults       = [];
  const allErrors        = [];
  const allBackups       = [];
  const filesModified    = new Set();
  const startTime        = Date.now();
  let   totalInput       = 0;
  let   totalOutput      = 0;
  let   turn             = 0;
  let   finalResponse    = '';
  let   completedNormally = false;

  while (turn < maxTurns) {
    // Check remaining time before each turn
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) break;

    const turnTimeout = Math.max(5_000, timeout - elapsed);
    turn++;

    // 1. Call AI provider with the remaining budget
    let aiResult;
    try {
      aiResult = await callAIRaw(messages, systemPrompt, { timeout: turnTimeout });
    } catch (err) {
      return {
        success:       false,
        finalResponse,
        turns:         turn,
        toolCalls:     allToolCalls,
        results:       allResults,
        errors:        allErrors,
        tokens:        { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
        duration:      Date.now() - startTime,
        filesModified: [...filesModified],
        backups:       allBackups,
        error:         err.message,
      };
    }

    finalResponse  = aiResult.text;
    totalInput    += aiResult.inputTokens  || 0;
    totalOutput   += aiResult.outputTokens || 0;

    // 2. Parse tool calls from AI response
    const parsed = parseAgentResponse(finalResponse);

    // 3. No tool calls → AI finished its work
    if (parsed.hasClosed || parsed.toolCalls.length === 0) {
      completedNormally = true;
      break;
    }

    // 4. Execute each tool call
    const turnResults = [];
    for (const toolCall of parsed.toolCalls) {
      const result = await executeToolCall(toolCall, projectPath);
      turnResults.push(result);
      allToolCalls.push(toolCall);
      allResults.push(result);

      if (result.success && toolCall.tool === 'write') {
        filesModified.add(toolCall.args.path);
        if (result.data?.backupPath) allBackups.push(result.data.backupPath);
      }

      if (!result.success) {
        allErrors.push({
          toolCall,
          error:       result.error?.message || 'Unknown error',
          recoverable: !['PATH_TRAVERSAL', 'PATH_OUT_OF_BOUNDS'].includes(result.error?.code),
        });
      }
    }

    // 5. Build results message and continue conversation
    messages.push({ role: 'assistant', content: finalResponse });
    messages.push({ role: 'user',      content: buildToolResultsMessage(turnResults) });
  }

  // Only mark as exceeded-limit if the loop didn't finish normally
  const exceededTurns   = !completedNormally && turn >= maxTurns;
  const exceededTimeout = !completedNormally && (Date.now() - startTime) >= timeout;

  return {
    success:       completedNormally,
    finalResponse,
    turns:         turn,
    toolCalls:     allToolCalls,
    results:       allResults,
    errors:        allErrors,
    tokens:        { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
    duration:      Date.now() - startTime,
    filesModified: [...filesModified],
    backups:       allBackups,
    ...(exceededTurns                    && { error: 'MAX_TURNS_EXCEEDED' }),
    ...(exceededTimeout && !exceededTurns && { error: 'TIMEOUT_EXCEEDED' }),
  };
}

module.exports = {
  parseAgentResponse,
  executeToolCall,
  buildToolResultsMessage,
  buildSubsystemSystemPrompt,
  execute,
};
