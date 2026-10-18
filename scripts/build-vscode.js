// Builds the VS Code extension (extensions/vscode) with the app's version and bundles the .vsix in the
// backend, where Settings → General installs it from (src/backend/vscode-install.js).
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root    = path.resolve(__dirname, '..');
const extDir  = path.join(root, 'extensions', 'vscode');
const version = require(path.join(root, 'package.json')).version;

const manifestPath = path.join(extDir, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

const run = (cmd) => execSync(cmd, { cwd: extDir, stdio: 'inherit' });
if (!fs.existsSync(path.join(extDir, 'node_modules'))) run('npm install --no-audit --no-fund');
run('npm run package');

const dest = path.join(root, 'src', 'backend', 'vscode');
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(extDir, 'agent-hub.vsix'), path.join(dest, 'agent-hub.vsix'));
console.log(`[build-vscode] agent-hub.vsix ${version} → src/backend/vscode/`);
