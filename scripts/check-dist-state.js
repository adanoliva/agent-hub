const fs = require('fs');
const path = require('path');

const files = [
  'dist/agent-hub.exe',
  'dist/agent-hub-2.4.14-x64.nsis.7z',
  'dist/builder-effective-config.yaml',
];

const out = {
  now: new Date().toISOString(),
  files: {},
};

for (const rel of files) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) {
    out.files[rel] = { exists: false };
    continue;
  }
  const st = fs.statSync(full);
  out.files[rel] = {
    exists: true,
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

fs.writeFileSync(path.join(process.cwd(), 'dist-state.json'), JSON.stringify(out, null, 2));
