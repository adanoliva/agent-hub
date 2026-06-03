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
  const raw   = fs.readFileSync(filePath, 'utf8');
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

module.exports = {
  SKILLS_DIR,
  listSkills,
  listAllSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  migrateSkillsFromSubdirs,
};
