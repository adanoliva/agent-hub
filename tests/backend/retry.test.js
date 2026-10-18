'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const { withRetry, isTransientError } = require('../../src/backend/ai');

test('isTransientError: rate limits, 5xx and network errors only', () => {
  for (const m of ['API error 429: too many', 'Overloaded', 'API error 503: unavailable', 'fetch failed', 'read ECONNRESET']) {
    assert.ok(isTransientError(new Error(m)), m);
  }
  for (const m of ['claude timed out after 600s', 'API key invalida', 'API error 400: bad request', 'claude no encontrado en PATH']) {
    assert.ok(!isTransientError(new Error(m)), m);
  }
});

test('withRetry: retries transient errors, then succeeds', async () => {
  let calls = 0;
  const retries = [];
  const r = await withRetry(async () => {
    if (++calls < 3) throw new Error('API error 529: overloaded');
    return 'ok';
  }, { baseMs: 1, onRetry: (_e, n) => retries.push(n) });
  assert.strictEqual(r, 'ok');
  assert.deepStrictEqual(retries, [1, 2]);
});

test('withRetry: gives up after the retry limit and on permanent errors', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('429'); }, { baseMs: 1 }), /429/);
  assert.strictEqual(calls, 3);

  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('API error 401'); }, { baseMs: 1 }), /401/);
  assert.strictEqual(calls, 1);
});

test('runCLI: abortar la señal mata el proceso y rechaza como cancelado', async () => {
  const { runCLI } = require('../../src/backend/ai');
  const ac = new AbortController();
  const started = Date.now();
  const p = runCLI(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 60_000, signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(p, (e) => e.cancelled === true);
  assert.ok(Date.now() - started < 5000);
});

test('withRetry: no reintenta si la ejecución se canceló', async () => {
  const ac = new AbortController();
  ac.abort();
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('429'); }, { baseMs: 1, signal: ac.signal }));
  assert.strictEqual(calls, 1);
});
