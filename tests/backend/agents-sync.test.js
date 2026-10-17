const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const https  = require('node:https');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-sync-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { AGENTS_DIR, CACHE_DIR, readConfig, bootstrapDirectories } = require('../../src/backend/config');
const agentsSync = require('../../src/backend/agents-sync');

const sha = (s) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');

// GitHub API stub: HEAD commit + a tree that still contains only global/kept.md (and a README, which must be ignored)
https.get = (url, _opts, cb) => {
  const body = url.includes('/commits/HEAD')
    ? { sha: 'new-commit' }
    : { tree: [
        { type: 'blob', path: 'global/kept.md', sha: sha('kept') },
        { type: 'blob', path: 'README.md',      sha: 'readme-sha' },
      ] };
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, headers: {}, resume() {} });
  process.nextTick(() => { cb(res); res.emit('data', JSON.stringify(body)); res.emit('end'); });
  return new EventEmitter();
};

test('sync borra lo que ya no está en remoto (y el README siempre), conserva lo editado', async () => {
  bootstrapDirectories(readConfig());
  const write = (rel, content) => fs.writeFileSync(path.join(AGENTS_DIR, rel), content);
  write('global/kept.md',      'kept');
  write('global/old-agent.md', 'old');
  write('global/edited.md',    'edited by user');
  write('uncategorized/README.md', '---\nname: README\n---\n# rewritten by old migration');

  fs.writeFileSync(path.join(CACHE_DIR, 'agents-meta.json'), JSON.stringify({
    repoCommitSHA: 'old-commit',
    files: {
      'global/kept.md':      { remoteSHA: sha('kept'),     localSHA: sha('kept') },
      'global/old-agent.md': { remoteSHA: sha('old'),      localSHA: sha('old') },
      'global/edited.md':    { remoteSHA: sha('original'), localSHA: sha('original') },
      'README.md':           { remoteSHA: 'x',             localSHA: sha('# original readme') },
    },
  }));

  await agentsSync.triggerSync('https://github.com/owner/repo');
  const result = agentsSync.getSyncState().lastResult;

  assert.deepEqual(result.errors, []);
  assert.equal(result.removed, 2);
  assert.ok(fs.existsSync(path.join(AGENTS_DIR, 'global/kept.md')));
  assert.ok(fs.existsSync(path.join(AGENTS_DIR, 'global/edited.md')));
  assert.ok(!fs.existsSync(path.join(AGENTS_DIR, 'global/old-agent.md')));
  assert.ok(!fs.existsSync(path.join(AGENTS_DIR, 'uncategorized/README.md')));
});
