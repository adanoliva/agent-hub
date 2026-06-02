/**
 * skills.js — CRUD de skills (conocimiento tecnológico inyectable en agentes).
 * Formato: .md con frontmatter YAML (name, description). Body = contenido del skill.
 */

const fs   = require('fs');
const path = require('path');
const { APP_DIR, ensureDir } = require('./config');

const SKILLS_DIR = path.join(APP_DIR, 'skills');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSkillsDir(level, catId, techId) {
  if (level === 'global')        return path.join(SKILLS_DIR, 'global');
  if (level === 'section')       return path.join(SKILLS_DIR, `section-${catId}`);
  if (level === 'tech')          return path.join(SKILLS_DIR, `tech-${catId}-${techId}`);
  if (level === 'uncategorized') return path.join(SKILLS_DIR, 'uncategorized');
  return path.join(SKILLS_DIR, 'global');
}

function parseSkillFile(filePath) {
  const raw  = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { name: path.basename(filePath, '.md'), description: '', content: raw.trim() };
  }
  const frontmatter = match[1];
  const body        = match[2].trim();
  const nameM       = frontmatter.match(/^name:\s*(.+)$/m);
  const descM       = frontmatter.match(/^description:\s*(.+)$/m);
  return {
    name:        nameM?.[1]?.trim() || path.basename(filePath, '.md'),
    description: descM?.[1]?.trim() || '',
    content:     body,
  };
}

function serializeSkill(skill) {
  const fm = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description || ''}`,
    '---',
    '',
  ].join('\n');
  return fm + (skill.content || '');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function listSkillsByLevel(level, catId, techId) {
  const dir = getSkillsDir(level, catId, techId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      try { return { ...parseSkillFile(path.join(dir, f)), level }; }
      catch { return null; }
    })
    .filter(Boolean);
}

function listAllSkills() {
  const { readConfig } = require('./config');
  const cfg  = readConfig();
  const all  = [];
  const seen = new Set();
  const add  = (skills) => {
    for (const s of skills) {
      if (!seen.has(s.name)) { seen.add(s.name); all.push(s); }
    }
  };
  add(listSkillsByLevel('global'));
  for (const cat of (cfg.categories || [])) {
    add(listSkillsByLevel('section', cat.id));
    for (const tech of (cat.technologies || [])) add(listSkillsByLevel('tech', cat.id, tech.id));
  }
  add(listSkillsByLevel('uncategorized'));
  return all;
}

function createSkill(level, catId, techId, skill) {
  const dir  = getSkillsDir(level, catId, techId);
  ensureDir(dir);
  const file = path.join(dir, `${skill.name}.md`);
  if (fs.existsSync(file)) throw new Error(`El skill "${skill.name}" ya existe`);
  fs.writeFileSync(file, serializeSkill(skill), 'utf8');
}

function updateSkill(level, catId, techId, skill) {
  const dir  = getSkillsDir(level, catId, techId);
  const file = path.join(dir, `${skill.name}.md`);
  if (!fs.existsSync(file)) throw new Error(`Skill "${skill.name}" no encontrado`);
  fs.writeFileSync(file, serializeSkill(skill), 'utf8');
}

function deleteSkill(level, catId, techId, name) {
  const dir  = getSkillsDir(level, catId, techId);
  const file = path.join(dir, `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`Skill "${name}" no encontrado`);
  fs.unlinkSync(file);
}

module.exports = { listSkillsByLevel, listAllSkills, createSkill, updateSkill, deleteSkill, getSkillsDir };
