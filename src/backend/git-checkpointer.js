/**
 * git-checkpointer.js — Git checkpoint tras cada paso del orquestador.
 * Solo activo si el proyecto tiene gitEnabled: true y es un repo git.
 */

const { exec }    = require('child_process');
const { promisify } = require('util');
const execAsync   = promisify(exec);

async function isGitRepo(projectPath) {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: projectPath });
    return true;
  } catch { return false; }
}

async function checkpoint(projectPath, message) {
  await execAsync('git add -A', { cwd: projectPath });
  try {
    await execAsync(`git commit -m "${message.replace(/"/g, "'")}"`, { cwd: projectPath });
  } catch (e) {
    if (!e.message.includes('nothing to commit') && !e.stderr?.includes('nothing to commit')) throw e;
    return null;
  }
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: projectPath });
  return stdout.trim();
}

async function rollbackToSha(projectPath, sha) {
  await execAsync(`git reset --hard ${sha}`, { cwd: projectPath });
}

module.exports = { isGitRepo, checkpoint, rollbackToSha };
