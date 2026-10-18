/**
 * skills.js — CRUD de skills (conocimiento inyectable en agentes).
 * Estructura plana: todos los skills en agents/skills/*.md
 * Se referencian por nombre desde los agentes; la carpeta no afecta la resolución.
 */

const fs   = require('fs');
const path = require('path');
const { SKILLS_DIR, ensureDir } = require('./config');

// ── Parse / serialize ─────────────────────────────────────────────────────────

function parseSkillFile(filePath) {
  const raw   = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { name: path.basename(filePath, '.md'), description: '', content: raw.trim() };
  }
  const frontmatter = match[1];
  const body        = match[2].trim();
  const nameM = frontmatter.match(/^name:\s*(.+)$/m);
  const descM = frontmatter.match(/^description:\s*(.+)$/m);
  return {
    name:        nameM?.[1]?.trim() || path.basename(filePath, '.md'),
    description: descM?.[1]?.trim() || '',
    content:     body,
  };
}

function serializeSkill(skill) {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description || ''}`,
    '---',
    '',
    skill.content || '',
  ].join('\n');
}

// ── Migration: moves files from legacy subdirs to flat root ───────────────────

function migrateSkillsFromSubdirs() {
  if (!fs.existsSync(SKILLS_DIR)) return;
  let entries;
  try { entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(SKILLS_DIR, entry.name);
    let files;
    try { files = fs.readdirSync(subdir).filter(f => f.endsWith('.md')); }
    catch { continue; }

    for (const file of files) {
      const src = path.join(subdir, file);
      const dst = path.join(SKILLS_DIR, file);
      if (!fs.existsSync(dst)) {
        try { fs.renameSync(src, dst); } catch { /* dst already exists, skip */ }
      }
    }
    // Remove subdir if now empty
    try {
      const remaining = fs.readdirSync(subdir);
      if (remaining.length === 0) fs.rmdirSync(subdir);
    } catch {}
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function listSkills() {
  ensureDir(SKILLS_DIR);
  migrateSkillsFromSubdirs();
  return fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      try { return parseSkillFile(path.join(SKILLS_DIR, f)); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Alias for backward-compat (used by orchestrator and AgentEditor)
function listAllSkills() {
  return listSkills();
}

function createSkill(skill) {
  ensureDir(SKILLS_DIR);
  const file = path.join(SKILLS_DIR, `${skill.name}.md`);
  if (fs.existsSync(file)) throw new Error(`El skill "${skill.name}" ya existe`);
  fs.writeFileSync(file, serializeSkill(skill), 'utf8');
}

function updateSkill(skill) {
  ensureDir(SKILLS_DIR);
  const file = path.join(SKILLS_DIR, `${skill.name}.md`);
  if (!fs.existsSync(file)) throw new Error(`Skill "${skill.name}" no encontrado`);
  fs.writeFileSync(file, serializeSkill(skill), 'utf8');
}

function deleteSkill(name) {
  const file = path.join(SKILLS_DIR, `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`Skill "${name}" no encontrado`);
  fs.unlinkSync(file);
}

// ── Stack detection ───────────────────────────────────────────────────────────
// Skills are picked from the project's manifests, so agents stay tech-agnostic.
// Generic skills (owasp, clean-arch, api-rest…) can't be detected: add them via project.skills or agent.skills.

const NPM_SKILLS = {
  react: 'react', 'react-native': 'react-native', expo: 'react-native', next: 'nextjs', vue: 'vue', nuxt: 'nuxtjs',
  '@angular/core': 'angular', svelte: 'svelte', astro: 'astro', tailwindcss: 'tailwind', '@mui/material': 'mui',
  antd: 'ant-design', '@chakra-ui/react': 'chakra-ui', typescript: 'typescript',
  express: 'nodejs', koa: 'nodejs', hono: 'nodejs', fastify: 'fastify', '@nestjs/core': 'nestjs',
  prisma: 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle', mongoose: 'mongodb', mongodb: 'mongodb',
  pg: 'postgresql', postgres: 'postgresql', mysql: 'mysql', mysql2: 'mysql', redis: 'redis', ioredis: 'redis',
  'better-sqlite3': 'sqlite', sqlite3: 'sqlite', '@supabase/supabase-js': 'supabase', graphql: 'graphql',
  jest: 'testing-jest', vitest: 'testing-vitest', cypress: 'cypress', '@playwright/test': 'playwright',
  kafkajs: 'kafka', '@elastic/elasticsearch': 'elasticsearch', jsonwebtoken: 'auth-jwt', jose: 'auth-jwt', 'aws-sdk': 'aws',
};
const NPM_PREFIX_SKILLS = [['@aws-sdk/', 'aws'], ['@azure/', 'azure'], ['@google-cloud/', 'gcp'], ['@remix-run/', 'remix'], ['@sveltejs/', 'svelte']];

// [manifest files, regex on their content, skill]
const TEXT_SKILLS = [
  [['requirements.txt', 'pyproject.toml', 'Pipfile'], /\bdjango\b/i,                          'python-django'],
  [['requirements.txt', 'pyproject.toml', 'Pipfile'], /\bfastapi\b/i,                         'python-fastapi'],
  [['requirements.txt', 'pyproject.toml', 'Pipfile'], /\bpytest\b/i,                          'pytest'],
  [['pom.xml', 'build.gradle', 'build.gradle.kts'],   /spring-boot|org\.springframework/,     'java-spring'],
  [['build.gradle', 'build.gradle.kts', 'pom.xml'],   /kotlin/i,                              'kotlin'],
  [['composer.json'],                                 /laravel\/framework/,                   'php-laravel'],
];

// [file or dir name present, skill]
const FILE_SKILLS = [
  ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['pubspec.yaml', 'flutter'], ['Package.swift', 'swift'],
  ['project.godot', 'godot'], ['game.project', 'defold'], ['ProjectSettings', 'unity'],
  ['Dockerfile', 'docker'], ['docker-compose.yml', 'docker'], ['docker-compose.yaml', 'docker'], ['compose.yaml', 'docker'],
  ['Chart.yaml', 'helm'], ['ansible.cfg', 'ansible'], ['nginx.conf', 'nginx'], ['prometheus.yml', 'prometheus'],
  ['k8s', 'kubernetes'], ['kubernetes', 'kubernetes'], ['components.json', 'shadcn'], ['tsconfig.json', 'typescript'],
  ['turbo.json', 'monorepo'], ['nx.json', 'monorepo'], ['pnpm-workspace.yaml', 'monorepo'],
];
const EXT_SKILLS = [['.csproj', 'dotnet'], ['.sln', 'dotnet'], ['.tf', 'terraform'], ['.uproject', 'unreal'], ['.xcodeproj', 'swift']];

const SCAN_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.git', '.venv', 'venv', '__pycache__']);

function detectProjectSkills(projectPath) {
  const found = new Set();
  if (!projectPath || !fs.existsSync(projectPath)) return [];
  if (fs.existsSync(path.join(projectPath, '.github', 'workflows'))) found.add('github-actions');

  // Root plus first-level subfolders, so monorepos (frontend/, backend/, infra/…) are covered
  const dirs = [projectPath];
  try {
    for (const e of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP.has(e.name)) dirs.push(path.join(projectPath, e.name));
    }
  } catch {}

  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };

    if (entries.includes('package.json')) {
      try {
        const pkg  = JSON.parse(read('package.json'));
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
        for (const d of deps) {
          if (NPM_SKILLS[d]) found.add(NPM_SKILLS[d]);
          for (const [prefix, skill] of NPM_PREFIX_SKILLS) if (d.startsWith(prefix)) found.add(skill);
        }
        if (pkg.workspaces) found.add('monorepo');
      } catch {}
    }
    for (const [files, re, skill] of TEXT_SKILLS) {
      if (files.some(f => entries.includes(f) && re.test(read(f)))) found.add(skill);
    }
    for (const [name, skill] of FILE_SKILLS) if (entries.includes(name)) found.add(skill);
    for (const [ext, skill] of EXT_SKILLS) if (entries.some(e => e.endsWith(ext))) found.add(skill);
  }
  return [...found].sort();
}

/**
 * Skills for one execution: detected from the project + added by hand to the project + declared by the agent.
 * Only names that exist in the catalog are returned.
 */
// ponytail: every detected skill goes to every agent (a front-coder in a React+Spring repo also gets java-spring); filter by agent section if the token cost matters
function resolveSkills(project, agent) {
  const names = new Set([
    ...detectProjectSkills(project?.path),
    ...(project?.skills || []),
    ...(agent?.skills || []),
  ]);
  return listSkills().filter(s => names.has(s.name) && s.content?.trim());
}

function skillsPromptBlock(skillList) {
  return skillList.map(s => `\n\n# SKILL: ${s.name}\n${s.content.trim()}`).join('');
}

/**
 * Writes skills as native Claude Code skills (.claude/skills/<name>/SKILL.md), which Claude Code loads on demand.
 * `previous` = names written by the last sync; only those are removed, so skills the user created by hand are kept.
 * Returns the names written, to be stored as the next `previous`.
 */
function syncClaudeSkills(projectPath, skillList, previous = []) {
  const dir   = path.join(projectPath, '.claude', 'skills');
  const names = skillList.map(s => s.name);
  for (const name of previous) {
    if (!names.includes(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  for (const s of skillList) {
    ensureDir(path.join(dir, s.name));
    // JSON string = valid YAML double-quoted scalar, safe for descriptions with ':' or quotes
    const description = JSON.stringify(`${s.description || s.name}. Use when writing or reviewing ${s.name} code in this project.`);
    fs.writeFileSync(path.join(dir, s.name, 'SKILL.md'), `---\nname: ${s.name}\ndescription: ${description}\n---\n\n${s.content.trim()}\n`, 'utf8');
  }
  return names;
}

module.exports = {
  SKILLS_DIR,
  listSkills,
  listAllSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  migrateSkillsFromSubdirs,
  detectProjectSkills,
  resolveSkills,
  skillsPromptBlock,
  syncClaudeSkills,
};
