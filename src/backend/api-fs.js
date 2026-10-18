/**
 * api-fs.js — Filesystem operations service for the Subsystem CLI
 *
 * Provides safe read, write, list, bash, grep operations on project files.
 * All paths are validated to prevent traversal attacks.
 * Wraps operations with security checks, backups, and validation.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const MAX_FILE_SIZE    = 10 * 1024 * 1024; // 10 MB
const BACKUP_DIR_NAME  = path.join('.agent-hub', 'backups');

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '.git', '.next', 'build', '__pycache__',
  '.venv', 'venv', 'out', 'coverage', '.svelte-kit', 'target', '.nuxt',
]);

const BINARY_EXTENSIONS = new Set([
  '.exe', '.bin', '.o', '.so', '.dll', '.dylib', '.class', '.pyc',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.bmp',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.ogg', '.flac',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.bz2',
  '.woff', '.woff2', '.ttf', '.eot',
]);

// Commands allowed in bash tool (whitelist)
const ALLOWED_BASH_COMMANDS = new Set([
  'ls', 'dir', 'find', 'grep', 'cat', 'type', 'wc',
  'head', 'tail', 'file', 'echo', 'pwd',
]);

// Agent mode adds the toolchains an agent needs to build, test and lint, like a native CLI in a terminal.
// They run project scripts (that is the point): same trust level as `claude --dangerously-skip-permissions`.
const EXEC_BASH_COMMANDS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'tsc', 'deno', 'bun',
  'python', 'python3', 'py', 'pytest', 'go', 'cargo', 'rustc',
  'dotnet', 'mvn', 'mvnw', 'gradle', 'gradlew', 'java', 'javac',
  'make', 'cmake', 'git', 'php', 'composer', 'ruby', 'bundle', 'rake',
]);

// Patterns that are never allowed regardless of command
const FORBIDDEN_BASH_PATTERNS = [
  /\brm\b/i,
  /^\s*(del|format)\b/i, // only as the command itself: `npm run format` is fine

  /\bsudo\b/i,
  /\bpip\s+install\b/i,                            // installs into the global Python
  /\s(-g|--global)\b/i,                            // global package installs
  /\bgit\s+(push|clone|clean|reset\s+--hard)\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-expression\b/i,
  /\biex\s/i,
  /[;&|`<>^%\r\n]/, // chaining, redirection, cmd escapes/env expansion, multi-line
  /\$\(/,
  /-(exec|execdir|ok|okdir|delete|fprint\w*)\b/i, // find side effects
];

// Arguments that point outside the project: `..`, ~, drive letters, UNC/root-relative, /c/... style
const OUTSIDE_PATH_ARG = /\.\.|^~|^\\|[a-z]:|^\/\/|^\/[^/\s]*\//i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  const map = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.rb': 'ruby', '.php': 'php', '.java': 'java',
    '.cs': 'csharp', '.go': 'go', '.rs': 'rust', '.cpp': 'cpp',
    '.c': 'c', '.swift': 'swift', '.kt': 'kotlin',
    '.vue': 'vue', '.svelte': 'svelte', '.dart': 'dart',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell',
    '.toml': 'toml', '.xml': 'xml', '.sql': 'sql', '.graphql': 'graphql',
  };
  return map[ext] || 'text';
}

/**
 * Validates that filePath is safe to access within projectPath.
 * Returns the resolved absolute path.
 * Throws a typed error on violation.
 */
function validatePath(projectPath, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    const err = new Error('Path required');
    err.code = 'MISSING_PATH';
    throw err;
  }

  // Reject traversal sequences
  if (filePath.includes('..')) {
    const err = new Error('Path traversal not allowed');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }

  const resolvedProject = path.resolve(projectPath);
  const resolved        = path.resolve(projectPath, filePath);

  // Must stay inside project root
  if (!resolved.startsWith(resolvedProject + path.sep) && resolved !== resolvedProject) {
    const err = new Error('Path is outside project directory');
    err.code = 'PATH_OUT_OF_BOUNDS';
    throw err;
  }

  // Symlinks/junctions inside the project can point outside it
  let probe = resolved;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProject = fs.realpathSync.native(resolvedProject);
  const realProbe   = fs.realpathSync.native(probe);
  if (realProbe !== realProject && !realProbe.startsWith(realProject + path.sep)) {
    const err = new Error('Path is outside project directory');
    err.code = 'PATH_OUT_OF_BOUNDS';
    throw err;
  }

  // Reject access to excluded directories
  const relative = path.relative(resolvedProject, resolved);
  for (const part of relative.split(path.sep)) {
    if (EXCLUDED_DIRS.has(part)) {
      const err = new Error(`Cannot access files in excluded directory: ${part}`);
      err.code = 'EXCLUDED_DIRECTORY';
      throw err;
    }
  }

  return resolved;
}

function isBashCommandForbidden(command, exec = false) {
  if (!command || typeof command !== 'string') return true;
  const trimmed = command.trim();
  if (FORBIDDEN_BASH_PATTERNS.some(p => p.test(trimmed))) return true;
  const [base, ...args] = trimmed.split(/\s+/).map(t => t.replace(/^["']|["']$/g, ''));
  const cmd = base.toLowerCase().replace(/^\.[\\/]/, '').replace(/\.(cmd|bat|exe)$/, ''); // ./gradlew, mvnw.cmd
  if (!ALLOWED_BASH_COMMANDS.has(cmd) && !(exec && EXEC_BASH_COMMANDS.has(cmd))) return true;
  return args.some(a => OUTSIDE_PATH_ARG.test(a));
}

function ensureBackupDir(projectPath) {
  const dir = path.join(projectPath, BACKUP_DIR_NAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createBackup(projectPath, filePath, resolved) {
  if (!fs.existsSync(resolved)) return null;
  try {
    const backupDir = ensureBackupDir(projectPath);
    const safeName  = filePath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const backupPath = path.join(backupDir, `${safeName}_${Date.now()}.bak`);
    fs.copyFileSync(resolved, backupPath);
    return path.relative(projectPath, backupPath).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function computeDiff(oldContent, newContent) {
  const oldLines = String(oldContent || '').split('\n');
  const newLines = String(newContent || '').split('\n');
  return {
    linesAdded:   Math.max(0, newLines.length - oldLines.length),
    linesRemoved: Math.max(0, oldLines.length - newLines.length),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Reads a text file from the project.
 *
 * @param {string} projectPath  — absolute path to the project root
 * @param {string} filePath     — relative path inside the project
 * @returns {{ path, content, size, hash, language, modified, encoding }}
 */
function readFile(projectPath, filePath) {
  const resolved = validatePath(projectPath, filePath);

  if (!fs.existsSync(resolved)) {
    const err = new Error(`File not found: ${filePath}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    const err = new Error('File too large (max 10MB)');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const language = detectLanguage(filePath);
  if (language === 'binary') {
    const err = new Error('Binary files not supported');
    err.code = 'BINARY_FILE';
    throw err;
  }

  const content = fs.readFileSync(resolved, 'utf8');
  return {
    path:     filePath,
    content,
    size:     stat.size,
    hash:     sha256(content),
    language,
    modified: stat.mtime.toISOString(),
    encoding: 'utf8',
  };
}

/**
 * Writes content to a file, creating parent directories as needed.
 * Backs up any existing file before overwriting.
 *
 * @param {string} projectPath
 * @param {string} filePath
 * @param {string} content
 * @param {object} [metadata]
 * @returns {{ saved, path?, hash?, changes?, backupPath?, validations?, status? }}
 */
function writeFile(projectPath, filePath, content, metadata = {}) {
  const resolved = validatePath(projectPath, filePath);

  if (typeof content !== 'string') {
    return { saved: false, status: 'validation_error', validations: ['Content must be a string'], details: {} };
  }

  if (content.length > MAX_FILE_SIZE) {
    return { saved: false, status: 'validation_error', validations: ['File too large (max 10MB)'], details: { fileSize: false } };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { saved: false, status: 'validation_error', validations: ['Binary files not supported'], details: { binaryFile: false } };
  }

  // JSON syntax validation
  if (ext === '.json') {
    try {
      JSON.parse(content);
    } catch (e) {
      return { saved: false, status: 'validation_error', validations: [`JSON syntax error: ${e.message}`], details: { syntaxValid: false } };
    }
  }

  const backupPath = createBackup(projectPath, filePath, resolved);

  let oldContent = '';
  if (fs.existsSync(resolved)) {
    try { oldContent = fs.readFileSync(resolved, 'utf8'); } catch {}
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(resolved);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  fs.writeFileSync(resolved, content, 'utf8');

  return {
    saved:       true,
    path:        filePath,
    hash:        sha256(content),
    changes:     computeDiff(oldContent, content),
    backupPath,
    validations: { pathTraversal: true, binaryFile: true, fileSize: true, syntaxValid: true, conflictDetected: false },
    metadata,
  };
}

/**
 * Creates a directory inside the project root.
 *
 * @param {string} projectPath
 * @param {string} dirPath
 * @returns {{ created: boolean, existed: boolean, path: string }}
 */
function createDirectory(projectPath, dirPath) {
  const resolved = validatePath(projectPath, dirPath);

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      const err = new Error(`Path exists and is not a directory: ${dirPath}`);
      err.code = 'PATH_NOT_DIRECTORY';
      throw err;
    }
    return { created: true, existed: true, path: dirPath };
  }

  fs.mkdirSync(resolved, { recursive: true });
  return { created: true, existed: false, path: dirPath };
}

/**
 * Lists files in the project, respecting exclusions.
 *
 * @param {string} projectPath
 * @param {string} [pattern]  — simple glob: *.ext, src/**, or a directory prefix
 * @returns {string[]}        — relative paths (forward slashes)
 */
function listFiles(projectPath, pattern) {
  const results = [];

  function walk(dir, depth = 0) {
    if (depth > 5) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name === '.agent-hub') continue;
        if (entry.name.startsWith('.env')) continue; // keep secrets away from the AI provider
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile()) results.push(path.relative(projectPath, full).replace(/\\/g, '/'));
      }
    } catch {}
  }

  walk(projectPath);

  if (!pattern) return results.slice(0, 500);

  // `*.ts` matches at any depth; `src/**/*.ts` is a full glob; `src` / `src/` is a directory prefix
  const p = String(pattern).replace(/\\/g, '/');
  const dirPrefix = p.replace(/\/?$/, '/');
  const matches = p.includes('/') || !/[*?[]/.test(p)
    ? f => path.matchesGlob(f, p) || f.startsWith(dirPrefix)
    : f => path.matchesGlob(path.posix.basename(f), p);
  return results.filter(matches).slice(0, 500);
}

/**
 * Executes a whitelisted shell command in the project directory.
 *
 * @param {string} projectPath
 * @param {string} command
 * @returns {Promise<{ stdout, stderr, exitCode }>}
 */
function bashCommand(projectPath, command, { exec: execMode = false } = {}) {
  if (isBashCommandForbidden(command, execMode)) {
    const err = new Error(`Command not allowed: ${command}`);
    err.code = 'FORBIDDEN_COMMAND';
    return Promise.reject(err);
  }

  return new Promise((resolve) => {
    exec(command, {
      cwd:         projectPath,
      timeout:     execMode ? 300_000 : 30_000,
      maxBuffer:   4 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      // Builds and test runs put the verdict at the end: keep the tail
      resolve({
        stdout:   String(stdout  || '').slice(-10_000),
        stderr:   String(stderr  || '').slice(-4_000),
        exitCode: error ? (error.code || 1) : 0,
      });
    });
  });
}

/**
 * Searches for a pattern across project files.
 *
 * @param {string} projectPath
 * @param {string} pattern     — regex or literal string
 * @param {string} [glob]      — glob to filter files
 * @returns {{ matches: Array<{ file, lineNumber, line }>, count: number }}
 */
function grepFiles(projectPath, pattern, glob) {
  const matches = [];
  const files   = listFiles(projectPath, glob);

  let regex;
  try {
    regex = new RegExp(pattern, 'gi');
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }

  for (const relPath of files.slice(0, 200)) {
    if (detectLanguage(relPath) === 'binary') continue;
    try {
      const lines = fs.readFileSync(path.join(projectPath, relPath), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matches.push({ file: relPath, lineNumber: i + 1, line: lines[i].trim().slice(0, 200) });
          if (matches.length >= 300) break;
        }
      }
    } catch {}
    if (matches.length >= 300) break;
  }

  return { matches, count: matches.length };
}

module.exports = { readFile, writeFile, createDirectory, listFiles, bashCommand, grepFiles };
