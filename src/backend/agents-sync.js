/**
 * agents-sync.js — Agents Directory sync
 *
 * Downloads agent .md files from a GitHub repository.
 * Tracks per-file versions using git blob SHAs (same algorithm GitHub uses).
 * Detects conflicts when both local and remote changed since last sync.
 */

const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const crypto = require('crypto');

const { AGENTS_DIR, CACHE_DIR, APP_DIR, SKILLS_DIR, ensureDir } = require('./config');
const { syncGlobalAgentsToClaudeDir }                            = require('./agents');

const META_FILE = path.join(CACHE_DIR, 'agents-meta.json');

// ── Git blob SHA ──────────────────────────────────────────────────────────────
// Matches the SHA GitHub returns per file in its tree API.

function gitBlobSHA(content) {
  const buf    = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = `blob ${buf.length}\0`;
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}

// ── URL parsing ───────────────────────────────────────────────────────────────

function parseGitHubUrl(url) {
  const m = (url || '').trim().match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`URL de GitHub no válida: ${url}`);
  return { owner: m[1], repo: m[2] };
}

// ── Remote → local path mapping ───────────────────────────────────────────────
// Standard dirs: global, section-{x}, uncategorized
// Non-standard (including legacy tech-{x}-{y}) → uncategorized

function mapRemotePathToLocal(remotePath) {
  // Skills: rutas que empiezan por 'skills/' → estructura plana en agents/skills/
  if (remotePath.startsWith('skills/')) {
    return path.join(SKILLS_DIR, path.basename(remotePath));
  }

  // Strip leading 'agents/' prefix if present
  const normalized = remotePath.replace(/^agents\//, '');
  const isStandard = /^(global|section-[^/]+|uncategorized)\/[^/]+\.md$/.test(normalized);

  if (isStandard) {
    return path.join(AGENTS_DIR, ...normalized.split('/'));
  }

  // Non-standard path → uncategorized, using only the filename
  const name = path.basename(remotePath);
  return path.join(AGENTS_DIR, 'uncategorized', name);
}

// ── Meta file ─────────────────────────────────────────────────────────────────

function readMeta() {
  if (!fs.existsSync(META_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return null; }
}

function writeMeta(meta) {
  ensureDir(CACHE_DIR);
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

function metaExists() {
  return fs.existsSync(META_FILE);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'agent-hub/1.5', ...extraHeaders } };

    const follow = (u) => {
      https.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} al acceder a ${u}`));
        }
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };

    follow(url);
  });
}

// ── GitHub API calls ──────────────────────────────────────────────────────────

async function fetchHeadSHA(owner, repo) {
  const raw  = await httpsGet(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`);
  const data = JSON.parse(raw);
  if (!data.sha) throw new Error('No se pudo obtener el SHA del HEAD del repositorio');
  return data.sha;
}

async function fetchTree(owner, repo, commitSHA) {
  const raw  = await httpsGet(`https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSHA}?recursive=1`);
  const data = JSON.parse(raw);
  return (data.tree || []).filter((item) => item.type === 'blob' && item.path.endsWith('.md'));
}

async function downloadRaw(owner, repo, remotePath) {
  // raw.githubusercontent.com is NOT rate-limited like the API
  return httpsGet(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${remotePath}`);
}

// ── In-memory sync state (for polling from renderer) ─────────────────────────

const syncState = {
  syncing:          false,
  firstSync:        false,
  progress:         { done: 0, total: 0, current: '' },
  lastResult:       null,
  pendingConflicts: [],
};

function getSyncState() {
  return {
    syncing:          syncState.syncing,
    firstSync:        syncState.firstSync,
    progress:         { ...syncState.progress },
    lastResult:       syncState.lastResult,
    pendingConflicts: syncState.pendingConflicts,
  };
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function performSync(directoryUrl) {
  const { owner, repo } = parseGitHubUrl(directoryUrl);
  const meta            = readMeta() || { files: {} };

  ensureDir(path.join(AGENTS_DIR, 'uncategorized'));

  const remoteCommitSHA = await fetchHeadSHA(owner, repo);

  // Short-circuit: nothing changed upstream
  if (meta.repoCommitSHA === remoteCommitSHA) {
    return { updated: 0, skipped: 0, conflicts: [], errors: [], upToDate: true };
  }

  const tree = await fetchTree(owner, repo, remoteCommitSHA);

  syncState.progress = { done: 0, total: tree.length, current: '' };

  const updated   = [];
  const skipped   = [];
  const conflicts = [];
  const errors    = [];
  const newFiles  = {};

  for (const item of tree) {
    syncState.progress.current = item.path;

    const localPath    = mapRemotePathToLocal(item.path);
    const fileKey      = item.path;
    const existingMeta = meta.files?.[fileKey];
    const localExists  = fs.existsSync(localPath);

    if (localExists && existingMeta) {
      const diskContent   = fs.readFileSync(localPath, 'utf8');
      const diskSHA       = gitBlobSHA(diskContent);
      const userModified  = diskSHA !== existingMeta.localSHA;
      const remoteChanged = item.sha !== existingMeta.remoteSHA;

      if (!remoteChanged) {
        // No upstream change — nothing to do
        newFiles[fileKey] = existingMeta;
        skipped.push(fileKey);
        syncState.progress.done++;
        continue;
      }

      if (userModified) {
        // Both sides changed → conflict, let user decide
        conflicts.push({
          fileKey,
          localPath,
          remotePath: item.path,
          remoteSHA:  item.sha,
          localSHA:   diskSHA,
          name:       path.basename(item.path, '.md'),
        });
        newFiles[fileKey] = existingMeta;
        syncState.progress.done++;
        continue;
      }
    }

    // Download and write (new file or safe update)
    try {
      const content    = await downloadRaw(owner, repo, item.path);
      ensureDir(path.dirname(localPath));
      fs.writeFileSync(localPath, content, 'utf8');
      const writtenSHA = gitBlobSHA(content);
      newFiles[fileKey] = { remoteSHA: item.sha, localSHA: writtenSHA, remotePath: item.path };
      updated.push(fileKey);
    } catch (e) {
      errors.push({ path: fileKey, error: e.message });
    }

    syncState.progress.done++;
  }

  writeMeta({
    directoryUrl,
    lastSync:      new Date().toISOString(),
    repoCommitSHA: remoteCommitSHA,
    files:         newFiles,
  });

  // Mirror globals to ~/.claude/agents/ after any update
  if (updated.length > 0) {
    try { syncGlobalAgentsToClaudeDir(); } catch {}
  }

  return { updated: updated.length, skipped: skipped.length, conflicts, errors, upToDate: false };
}

// ── Public trigger (called from main.js and API) ──────────────────────────────

async function triggerSync(directoryUrl, isFirst = false) {
  if (syncState.syncing) return;

  syncState.syncing          = true;
  syncState.firstSync        = isFirst;
  syncState.pendingConflicts = [];
  syncState.lastResult       = null;

  try {
    const result = await performSync(directoryUrl);
    syncState.pendingConflicts = result.conflicts || [];
    syncState.lastResult       = result;
  } catch (e) {
    console.warn('[agents-sync] Sync failed:', e.message);
    syncState.lastResult = {
      error:     e.message,
      updated:   0,
      skipped:   0,
      conflicts: [],
      errors:    [{ path: '*', error: e.message }],
    };
  } finally {
    syncState.syncing   = false;
    syncState.firstSync = false;
  }
}

// ── Conflict resolution ───────────────────────────────────────────────────────

async function resolveConflict(fileKey, action, directoryUrl) {
  const conflict = syncState.pendingConflicts.find((c) => c.fileKey === fileKey);
  if (!conflict) throw new Error('Conflicto no encontrado');

  const meta = readMeta() || { files: {} };

  if (action === 'update') {
    const { owner, repo } = parseGitHubUrl(directoryUrl);
    const content         = await downloadRaw(owner, repo, conflict.remotePath);
    ensureDir(path.dirname(conflict.localPath));
    fs.writeFileSync(conflict.localPath, content, 'utf8');
    const writtenSHA       = gitBlobSHA(content);
    meta.files[fileKey]    = { remoteSHA: conflict.remoteSHA, localSHA: writtenSHA, remotePath: conflict.remotePath };
    try { syncGlobalAgentsToClaudeDir(); } catch {}
  } else {
    // 'keep': update stored localSHA to current disk SHA so future syncs don't re-flag it
    meta.files[fileKey] = { ...meta.files[fileKey], localSHA: conflict.localSHA, remoteSHA: conflict.remoteSHA };
  }

  writeMeta(meta);
  syncState.pendingConflicts = syncState.pendingConflicts.filter((c) => c.fileKey !== fileKey);
}

module.exports = {
  metaExists,
  readMeta,
  getSyncState,
  triggerSync,
  resolveConflict,
  parseGitHubUrl,
};
