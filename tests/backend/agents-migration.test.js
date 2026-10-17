const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-migr-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { AGENTS_DIR, readConfig, bootstrapDirectories, getAgentDir } = require('../../src/backend/config');
const { migrateAgentFiles, listAgentsByLevel } = require('../../src/backend/agents');

test('migrateAgentFiles no reescribe skills ni README; listAgents ignora README', () => {
  bootstrapDirectories(readConfig());
  const skill  = '---\nname: react\ndescription: React\n---\n\n## React\n';
  const readme = '# agents-directory\n';
  fs.writeFileSync(path.join(AGENTS_DIR, 'skills', 'react.md'), skill);
  fs.writeFileSync(path.join(AGENTS_DIR, 'README.md'), readme);
  fs.writeFileSync(path.join(getAgentDir('uncategorized'), 'README.md'), readme);

  migrateAgentFiles();

  assert.equal(fs.readFileSync(path.join(AGENTS_DIR, 'skills', 'react.md'), 'utf8'), skill);
  assert.equal(fs.readFileSync(path.join(AGENTS_DIR, 'README.md'), 'utf8'), readme);
  assert.equal(fs.readFileSync(path.join(getAgentDir('uncategorized'), 'README.md'), 'utf8'), readme);
  assert.ok(!listAgentsByLevel('uncategorized').some(a => a.name.toLowerCase() === 'readme'));
});
