'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');
const git = require('../../src/backend/git-checkpointer');

test('checkpoint + stepDiff: commit sin shell y diff del paso', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-git-'));
  try {
    const run = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 'test@local');
    run('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
    run('add', '-A');
    run('commit', '-qm', 'init');
    assert.equal(await git.isGitRepo(dir), true);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\ndos\n');
    fs.mkdirSync(path.join(dir, '.agent-hub', 'executions'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent-hub', 'executions', 'logs.jsonl'), '{}\n');
    // Names with shell metacharacters used to go through cmd.exe
    const message = '[orq "x" & echo pwned | y] paso 1/2: refactor';
    const sha = await git.checkpoint(dir, message);
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(run('log', '-1', '--format=%s').trim(), message);
    // Agent Hub's own files never go into a checkpoint
    assert.deepEqual(run('show', '--name-only', '--format=', sha).trim().split('\n'), ['a.txt']);
    assert.match(run('status', '--porcelain'), /\.agent-hub/);

    const { diff, truncated } = await git.stepDiff(dir, sha);
    assert.equal(truncated, false);
    assert.match(diff, /a\.txt/);
    assert.match(diff, /^\+dos$/m);

    assert.equal(await git.checkpoint(dir, 'sin cambios'), null);
    await assert.rejects(git.stepDiff(dir, 'HEAD; rm -rf /'), /SHA no válido/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
