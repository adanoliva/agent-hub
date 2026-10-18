const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-skills-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { SKILLS_DIR, readConfig, bootstrapDirectories } = require('../../src/backend/config');
const { detectProjectSkills, resolveSkills, syncClaudeSkills } = require('../../src/backend/skills');

function makeTree(name, files) {
  const dir = path.join(tmpRoot, name);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('detectProjectSkills: monorepo React + Spring + infraestructura', () => {
  const dir = makeTree('mono', {
    'frontend/package.json': JSON.stringify({ dependencies: { react: '18', '@aws-sdk/client-s3': '3' }, devDependencies: { vitest: '1', tailwindcss: '3' } }),
    'frontend/tsconfig.json': '{}',
    'backend/pom.xml': '<dependency><groupId>org.springframework.boot</groupId></dependency>',
    'backend/requirements.txt': 'Django==5.0\npytest',
    'infra/main.tf': '',
    'Dockerfile': '',
    '.github/workflows/ci.yml': '',
    'node_modules/vue/package.json': JSON.stringify({ dependencies: { vue: '3' } }),
  });
  assert.deepEqual(detectProjectSkills(dir), [
    'aws', 'docker', 'github-actions', 'java-spring', 'pytest', 'python-django',
    'react', 'tailwind', 'terraform', 'testing-vitest', 'typescript',
  ]);
});

test('detectProjectSkills: ruta inexistente o proyecto vacío', () => {
  assert.deepEqual(detectProjectSkills(path.join(tmpRoot, 'nope')), []);
  assert.deepEqual(detectProjectSkills(makeTree('empty', { 'README.md': '' })), []);
});

test('resolveSkills: detectadas + del proyecto + del agente, solo las del catálogo', () => {
  bootstrapDirectories(readConfig());
  for (const name of ['react', 'owasp', 'docker']) {
    fs.writeFileSync(path.join(SKILLS_DIR, `${name}.md`), `---\nname: ${name}\ndescription: ${name} rules\n---\n\n## ${name}\n`);
  }
  const dir = makeTree('resolve', { 'package.json': JSON.stringify({ dependencies: { react: '18', next: '14' } }) });
  const names = resolveSkills({ path: dir, skills: ['owasp'] }, { skills: ['docker', 'no-existe'] }).map(s => s.name);
  // nextjs se detecta pero no está en este catálogo → se omite
  assert.deepEqual(names.sort(), ['docker', 'owasp', 'react']);
});

test('syncClaudeSkills: escribe SKILL.md, borra solo las suyas que ya no aplican', () => {
  const dir  = makeTree('claude-skills', { '.claude/skills/mine/SKILL.md': 'creada por el usuario' });
  const list = (n) => n.map(name => ({ name, description: `${name}: rules`, content: `## ${name}` }));

  const first = syncClaudeSkills(dir, list(['react', 'docker']));
  assert.deepEqual(first, ['react', 'docker']);
  const md = fs.readFileSync(path.join(dir, '.claude/skills/react/SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: react\ndescription: "react: rules\. Use when/);

  syncClaudeSkills(dir, list(['react']), first);
  assert.ok(!fs.existsSync(path.join(dir, '.claude/skills/docker')));
  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/react/SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/mine/SKILL.md')));
});
