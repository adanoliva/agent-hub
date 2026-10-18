/**
 * tests/backend/subsystem-cli.test.js
 *
 * Unit tests for:
 *   - parseAgentResponse   (TOOL block parsing)
 *   - buildSubsystemSystemPrompt (system prompt construction)
 *   - execute              (multi-turn loop: normal exit, MAX_TURNS, TIMEOUT, callAIRaw error)
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// CDM_DATA_DIR must be set before importing any backend module
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-subcli-'));
process.env.CDM_DATA_DIR = tmpRoot;

const {
  parseAgentResponse,
  buildSubsystemSystemPrompt,
  buildToolResultsMessage,
  execute,
} = require('../../src/backend/subsystem-cli');

// ── parseAgentResponse ────────────────────────────────────────────────────────

test('parseAgentResponse: texto plano sin TOOL → hasClosed true, sin tool calls', () => {
  const result = parseAgentResponse('Esta es mi respuesta final.');
  assert.equal(result.hasClosed, true);
  assert.equal(result.toolCalls.length, 0);
});

test('parseAgentResponse: cadena vacía → hasClosed true', () => {
  const result = parseAgentResponse('');
  assert.equal(result.hasClosed, true);
  assert.equal(result.toolCalls.length, 0);
});

test('parseAgentResponse: bloque read válido', () => {
  const text = 'TOOL: read\nPATH: src/main.ts';
  const result = parseAgentResponse(text);
  assert.equal(result.hasClosed, false);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, 'read');
  assert.equal(result.toolCalls[0].args.path, 'src/main.ts');
});

test('parseAgentResponse: bloque write con contenido', () => {
  const text = 'TOOL: write\nPATH: src/utils.ts\nCONTENT:\nexport const x = 1;\n';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, 'write');
  assert.equal(result.toolCalls[0].args.path, 'src/utils.ts');
  assert.ok(result.toolCalls[0].args.content.includes('export const x = 1;'));
});

test('parseAgentResponse: bloque bash válido', () => {
  const text = 'TOOL: bash\nCOMMAND: find src -name "*.ts"';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, 'bash');
  assert.equal(result.toolCalls[0].args.command, 'find src -name "*.ts"');
});

test('parseAgentResponse: bloque grep válido', () => {
  const text = 'TOOL: grep\nPATTERN: export const\nFILE: src/**/*.ts';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, 'grep');
  assert.equal(result.toolCalls[0].args.pattern, 'export const');
  assert.equal(result.toolCalls[0].args.file, 'src/**/*.ts');
});

test('parseAgentResponse: grep sin FILE → ignorado', () => {
  const text = 'TOOL: grep\nPATTERN: export const';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.hasClosed, true);
});

test('parseAgentResponse: write sin PATH → ignorado', () => {
  const text = 'TOOL: write\nCONTENT:\nhola';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 0);
});

test('parseAgentResponse: herramienta desconocida → ignorada', () => {
  const text = 'TOOL: unknown\nPATH: x.ts';
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.hasClosed, true);
});

test('parseAgentResponse: múltiples bloques separados por ---', () => {
  const text = [
    'TOOL: read',
    'PATH: src/a.ts',
    '',
    '---',
    '',
    'TOOL: bash',
    'COMMAND: ls src',
  ].join('\n');
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[0].tool, 'read');
  assert.equal(result.toolCalls[1].tool, 'bash');
});

test('parseAgentResponse: cada tool call tiene id único', () => {
  const text = [
    'TOOL: read',
    'PATH: a.ts',
    '',
    '---',
    '',
    'TOOL: read',
    'PATH: b.ts',
  ].join('\n');
  const result = parseAgentResponse(text);
  assert.equal(result.toolCalls.length, 2);
  assert.notEqual(result.toolCalls[0].id, result.toolCalls[1].id);
});

// ── buildSubsystemSystemPrompt ────────────────────────────────────────────────

test('buildSubsystemSystemPrompt: incluye el system prompt del agente', () => {
  const prompt = buildSubsystemSystemPrompt('Eres un revisor de código.', '');
  assert.ok(prompt.includes('Eres un revisor de código.'));
  assert.ok(prompt.includes('TOOL: read'));
});

test('buildSubsystemSystemPrompt: incluye contexto del proyecto si se pasa', () => {
  const prompt = buildSubsystemSystemPrompt('', '# Mi Proyecto\nStack: React');
  assert.ok(prompt.includes('CONTEXTO DEL PROYECTO'));
  assert.ok(prompt.includes('Stack: React'));
});

test('buildSubsystemSystemPrompt: sin contexto no añade sección de contexto', () => {
  const prompt = buildSubsystemSystemPrompt('Agente.', '');
  assert.ok(!prompt.includes('CONTEXTO DEL PROYECTO'));
});

test('buildSubsystemSystemPrompt: useBrowser=true añade instrucciones de navegador', () => {
  const prompt = buildSubsystemSystemPrompt('', '', { useBrowser: true });
  assert.ok(prompt.includes('BROWSER_GET'));
  assert.ok(prompt.includes('browser_get'));
});

test('buildSubsystemSystemPrompt: useBrowser=false no incluye instrucciones de navegador', () => {
  const prompt = buildSubsystemSystemPrompt('', '', { useBrowser: false });
  assert.ok(!prompt.includes('BROWSER_GET'));
});

// ── buildToolResultsMessage ───────────────────────────────────────────────────

test('buildToolResultsMessage: incluye nombre de la herramienta y estado de éxito', () => {
  const results = [
    {
      toolCall: { tool: 'read', args: { path: 'src/main.ts' } },
      success: true,
      data: { content: 'const x = 1;', size: 12, language: 'typescript', hash: 'abc123' },
      executionTime: 5,
    },
  ];
  const msg = buildToolResultsMessage(results);
  assert.ok(msg.includes('READ'));
  assert.ok(msg.includes('✓ EXITOSO'));
  assert.ok(msg.includes('src/main.ts'));
});

test('buildToolResultsMessage: incluye código de error en caso de fallo', () => {
  const results = [
    {
      toolCall: { tool: 'bash', args: { command: 'rm -rf /' } },
      success: false,
      error: { code: 'COMMAND_NOT_ALLOWED', message: 'Comando no permitido' },
      executionTime: 1,
    },
  ];
  const msg = buildToolResultsMessage(results);
  assert.ok(msg.includes('✗ ERROR'));
  assert.ok(msg.includes('COMMAND_NOT_ALLOWED'));
});

// ── execute loop ──────────────────────────────────────────────────────────────

test('execute: termina normalmente cuando callAIRaw no devuelve tool calls', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    const result = await execute('haz algo', 'Eres un agente.', {
      projectPath: tmpDir,
      callAIRaw: async () => ({
        text: 'Tarea completada correctamente.',
        inputTokens: 10,
        outputTokens: 20,
      }),
      maxTurns: 5,
      timeout: 30_000,
    });
    assert.equal(result.success, true);
    assert.equal(result.turns, 1);
    assert.equal(result.finalResponse, 'Tarea completada correctamente.');
    assert.equal(result.error, undefined);
    assert.equal(result.tokens.input, 10);
    assert.equal(result.tokens.output, 20);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: acumula tokens de múltiples turnos', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    // Crear un archivo para que el read tenga éxito
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world', 'utf8');

    let turn = 0;
    const result = await execute('haz algo', '', {
      projectPath: tmpDir,
      callAIRaw: async () => {
        turn++;
        if (turn === 1) {
          return { text: 'TOOL: read\nPATH: hello.txt', inputTokens: 5, outputTokens: 3 };
        }
        return { text: 'Terminado.', inputTokens: 8, outputTokens: 6 };
      },
      maxTurns: 5,
      timeout: 30_000,
    });
    assert.equal(result.success, true);
    assert.equal(result.turns, 2);
    assert.equal(result.tokens.input, 13);
    assert.equal(result.tokens.output, 9);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: MAX_TURNS_EXCEEDED cuando callAIRaw siempre devuelve tool calls', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    const result = await execute('haz algo', '', {
      projectPath: tmpDir,
      callAIRaw: async () => ({
        // read de un archivo que no existe → executeToolCall devuelve error, pero el loop continúa
        text: 'TOOL: read\nPATH: inexistente.ts',
        inputTokens: 1,
        outputTokens: 1,
      }),
      maxTurns: 3,
      timeout: 30_000,
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'MAX_TURNS_EXCEEDED');
    assert.equal(result.turns, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: TIMEOUT_EXCEEDED cuando el tiempo global se agota entre turnos', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    const result = await execute('haz algo', '', {
      projectPath: tmpDir,
      // callAIRaw introduce un retardo superior al timeout global
      callAIRaw: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { text: 'TOOL: read\nPATH: nada.ts', inputTokens: 1, outputTokens: 1 };
      },
      maxTurns: 20,
      timeout: 40, // 40ms — expira durante el primer turno
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'TIMEOUT_EXCEEDED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: error de callAIRaw propaga como failure con el mensaje de error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    const result = await execute('haz algo', '', {
      projectPath: tmpDir,
      callAIRaw: async () => { throw new Error('API no disponible'); },
      maxTurns: 5,
      timeout: 30_000,
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'API no disponible');
    assert.equal(result.turns, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: el agente que termina en el último turno no es TIMEOUT', async () => {
  // Si el agente termina normalmente en el turno exacto donde se agotaría el tiempo,
  // el resultado debe ser success:true (completedNormally gana sobre el timeout).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    let turn = 0;
    const result = await execute('haz algo', '', {
      projectPath: tmpDir,
      callAIRaw: async () => {
        turn++;
        // Tarda 20ms; con timeout=50ms el turno 1 tiene tiempo pero el turno 2 no
        await new Promise((r) => setTimeout(r, 20));
        if (turn === 1) {
          return { text: 'TOOL: read\nPATH: nada.ts', inputTokens: 1, outputTokens: 1 };
        }
        // Turno 2: responde sin tool calls → termina normalmente
        return { text: 'Completado.', inputTokens: 1, outputTokens: 1 };
      },
      maxTurns: 10,
      timeout: 50,
    });
    // El turno 2 llega antes de que expire el timeout (40ms < 50ms)
    // o expire durante él pero como completedNormally=true, success=true
    // Si el turno 2 tarda 20ms y el timeout es 50ms y después del turno 1 llevamos ~20ms:
    // Inicio turno 2: elapsed ~20ms < 50ms → entra. Responde sin tools → completedNormally=true
    assert.equal(result.success, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: une las continuaciones de una respuesta cortada y escribe el fichero completo', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    const replies = [
      { text: 'TOOL: write\nPATH: a.txt\nCONTENT:\nprimera ', truncated: true, inputTokens: 1, outputTokens: 1 },
      { text: 'mitad\n---\n', truncated: false, inputTokens: 1, outputTokens: 1 },
      { text: 'Hecho.', inputTokens: 1, outputTokens: 1 },
    ];
    const result = await execute('escribe a.txt', '', {
      projectPath: tmpDir, maxTurns: 5, timeout: 30_000,
      callAIRaw: async () => replies.shift(),
    });
    assert.equal(result.success, true);
    assert.match(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8'), /primera mitad/);
    assert.equal(result.tokens.output, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('execute: si sigue cortada tras las continuaciones, no escribe el fichero a medias', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subcli-exec-'));
  try {
    let calls = 0;
    const result = await execute('escribe a.txt', '', {
      projectPath: tmpDir, maxTurns: 2, timeout: 30_000,
      callAIRaw: async () => (++calls <= 4
        ? { text: calls === 1 ? 'TOOL: write\nPATH: a.txt\nCONTENT:\nmucho ' : 'más ', truncated: true }
        : { text: 'Lo dejo aquí.' }),
    });
    assert.equal(fs.existsSync(path.join(tmpDir, 'a.txt')), false);
    assert.ok(result.warnings.some(w => /cortada/.test(w.message)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
