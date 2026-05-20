/**
 * post-build.js — Post-build verification script
 *
 * Runs after `npm run build` to:
 *   1. Report the generated .exe size
 *   2. Verify the file exists
 *   3. Print next steps (publish to GitHub)
 */

const fs   = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const EXE  = path.join(DIST, 'claude-dev-manager.exe');

console.log('\n── Build report ──────────────────────────────');

if (!fs.existsSync(EXE)) {
  // Try to find any .exe in dist/
  if (fs.existsSync(DIST)) {
    const files = fs.readdirSync(DIST);
    const exe   = files.find(f => f.endsWith('.exe'));
    if (exe) {
      const size = (fs.statSync(path.join(DIST, exe)).size / 1024 / 1024).toFixed(1);
      console.log(`✓ Built: dist/${exe} (${size} MB)`);
    } else {
      console.log('⚠ No .exe found in dist/. Check electron-builder output above.');
    }
  } else {
    console.log('⚠ dist/ folder not found. Build may have failed.');
  }
} else {
  const size = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1);
  console.log(`✓ Built: dist/claude-dev-manager.exe (${size} MB)`);
}

console.log('\n── Next steps ────────────────────────────────');
console.log('1. Test the .exe locally:');
console.log('   cd dist && ./claude-dev-manager.exe');
console.log('');
console.log('2. Publish to GitHub Releases:');
console.log('   git tag v1.1.0');
console.log('   git push origin v1.1.0');
console.log('   → GitHub → Releases → New release → Upload dist/claude-dev-manager.exe');
console.log('');
console.log('3. To update version for next release:');
console.log('   npm version patch   # 1.0.0 → 1.0.1');
console.log('   npm version minor   # 1.0.0 → 1.1.0');
console.log('──────────────────────────────────────────────\n');
