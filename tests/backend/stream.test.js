'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const { claudeStreamEvent } = require('../../src/backend/ai');

test('claudeStreamEvent: traduce los mensajes de stream-json a eventos de progreso', () => {
  const events = [];
  const push = (e) => events.push(e);
  claudeStreamEvent(JSON.stringify({ type: 'system', subtype: 'init' }), push);
  claudeStreamEvent(JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: '  Voy a leerlo  ' },
    { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
  ] } }), push);
  claudeStreamEvent(JSON.stringify({ type: 'result', result: 'hecho' }), push);
  claudeStreamEvent('no es json', push);
  assert.deepStrictEqual(events, [
    { type: 'text', text: 'Voy a leerlo' },
    { type: 'tool', name: 'Read', detail: 'src/a.ts' },
    { type: 'tool', name: 'Bash', detail: 'npm test' },
  ]);
});

test('withPromptCache: marca el final del system prompt y del último mensaje', () => {
  const { withPromptCache } = require('../../src/backend/ai');
  const p = withPromptCache({
    system: 'Eres un agente',
    messages: [
      { role: 'user', content: 'tarea' },
      { role: 'assistant', content: 'TOOL: read' },
      { role: 'user', content: 'resultado' },
    ],
  });
  assert.deepStrictEqual(p.system, [{ type: 'text', text: 'Eres un agente', cache_control: { type: 'ephemeral' } }]);
  assert.strictEqual(p.messages[0].content, 'tarea');   // earlier turns untouched
  assert.deepStrictEqual(p.messages[2].content, [{ type: 'text', text: 'resultado', cache_control: { type: 'ephemeral' } }]);

  const noSystem = withPromptCache({ messages: [{ role: 'user', content: '' }] });
  assert.strictEqual(noSystem.system, undefined);
  assert.strictEqual(noSystem.messages[0].content, '');  // an empty text block would be rejected by the API
});

test('calcAnthropicCost: la escritura en caché cuesta 1,25× y la lectura 0,1× el precio de entrada', () => {
  const { calcAnthropicCost } = require('../../src/backend/ai');
  const m = 'claude-sonnet-4-20250514';                    // $3 / $15 per 1M
  assert.strictEqual(calcAnthropicCost(m, 1_000_000, 0), 3);
  assert.strictEqual(calcAnthropicCost(m, 0, 0, 1_000_000, 0), 3.75);
  assert.ok(Math.abs(calcAnthropicCost(m, 0, 0, 0, 1_000_000) - 0.3) < 1e-9);
});
