'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');

const { startServer } = require('../../src/backend/server');

const status = (port, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/api/health', headers }, (res) => { res.resume(); resolve(res.statusCode); })
    .on('error', reject);
});

test('server: rechaza orígenes y Host ajenos (CSRF / DNS rebinding)', async () => {
  const server = await startServer(0);
  const port   = server.address().port;
  try {
    assert.equal(await status(port, {}), 200);
    assert.equal(await status(port, { Origin: 'http://localhost:5173' }), 200);
    assert.equal(await status(port, { Origin: 'https://evil.example' }), 403);
    assert.equal(await status(port, { Host: 'evil.example:3737' }), 403);
  } finally {
    server.close();
  }
});
