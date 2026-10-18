/**
 * git-checkpointer.js — Git checkpoint tras cada paso del orquestador.
 * Solo activo si el proyecto tiene gitEnabled: true y es un repo git.
 */

const { execFile }  = require('child_process');
const { promisify } = require('util');
// No shell: the commit message carries the orchestration and agent names
const git = (projectPath, args, opts = {}) => promisify(execFile)('git', args, { cwd: projectPath, windowsHide: true, ...opts });

const MAX_DIFF_CHARS = 200_000;
// Agent Hub's own files (execution logs, results, backups) are not the step's work: they stay out of the
// checkpoint commits, so a step's diff shows only what the agent changed and a rollback never touches them
const PROJECT_ONLY = ['--', '.', ':(exclude).agent-hub'];

async function isGitRepo(projectPath) {
  try {
    await git(projectPath, ['rev-parse', '--git-dir']);
    return true;
  } catch { return false; }
}

async function checkpoint(projectPath, message) {
  await git(projectPath, ['add', '-A', ...PROJECT_ONLY]);
  // Exit code, not git's (localized) "nothing to commit" message, tells whether the step changed anything
  try {
    await git(projectPath, ['diff', '--cached', '--quiet', ...PROJECT_ONLY]);
    return null;
  } catch (e) {
    if (e.code !== 1) throw e;
  }
  // Only those paths: files the user staged inside .agent-hub/ are left for them
  await git(projectPath, ['commit', '--author=AgentHub <agenthub@local>', '-m', message, ...PROJECT_ONLY]);
  const { stdout } = await git(projectPath, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

async function rollbackToSha(projectPath, sha) {
  await git(projectPath, ['reset', '--hard', sha]);
}

/** What a step's checkpoint commit changed: stat summary + patch, capped for the UI */
async function stepDiff(projectPath, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error('SHA no válido');
  // Checkpoints made before 2.7 may include .agent-hub/: filter it here too
  const { stdout } = await git(projectPath, ['show', '--stat', '--patch', '--no-color', '--format=%h %s', sha, ...PROJECT_ONLY], { maxBuffer: 20 * 1024 * 1024 });
  const truncated = stdout.length > MAX_DIFF_CHARS;
  return { sha, diff: truncated ? stdout.slice(0, MAX_DIFF_CHARS) : stdout, truncated };
}

module.exports = { isGitRepo, checkpoint, rollbackToSha, stepDiff };
