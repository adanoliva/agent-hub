/**
 * generate-icon.js — Pre-build script
 * Generates assets/icon.ico from assets/source-icon.png (if present)
 * or falls back to a programmatic icon.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_PATH   = path.join(__dirname, '..', 'assets', 'icon.ico');
const SOURCE_PNG  = path.join(__dirname, '..', 'assets', 'source-icon.png');

fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });

function isUpToDate(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) return false;
  const src = fs.statSync(sourcePath);
  const dst = fs.statSync(targetPath);
  return dst.mtimeMs >= src.mtimeMs && dst.size > 0;
}

// ── ICO builder (accepts PNG buffers) ────────────────────────────────────────

function buildICO(pngs, sizes) {
  const header = Buffer.allocUnsafe(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const dirSize    = 6 + sizes.length * 16;
  const entries    = [];
  let   dataOffset = dirSize;

  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.allocUnsafe(16);
    const s = sizes[i];
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(dataOffset, 12);
    entries.push(e);
    dataOffset += pngs[i].length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

// ── Programmatic PNG fallback ─────────────────────────────────────────────────

function crc32(buf) {
  const t = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  })();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const lenBuf  = Buffer.allocUnsafe(4);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf  = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function pixel(x, y, size) {
  const r = Math.round(size * 0.22), pad = Math.round(size * 0.07);
  const lx = x - pad, ly = y - pad, inner = size - pad * 2;
  if (lx < 0 || ly < 0 || lx >= inner || ly >= inner) return [0,0,0,0];
  const cx = Math.max(r - lx, 0, lx - (inner-1-r));
  const cy = Math.max(r - ly, 0, ly - (inner-1-r));
  const dist = Math.sqrt(cx*cx + cy*cy);
  if (dist > r) return [0,0,0,0];
  const alpha = dist > r-1 ? Math.round((r-dist)*255) : 255;
  // Blue gradient bg like the uploaded icon
  const t = (lx+ly)/(inner*2);
  const R = Math.round(30 + t*40), G = Math.round(100 + t*60), B = Math.round(220 - t*40);
  return [R, G, B, alpha];
}

function makePNG(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size*4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const [r,g,b,a] = pixel(x,y,size);
      const o = 1+x*4;
      row[o]=r; row[o+1]=g; row[o+2]=b; row[o+3]=a;
    }
    rows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level:9 });
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))]);
}

function generateProgrammatic() {
  const ico = buildICO([16,32,48,256].map(makePNG), [16,32,48,256]);
  fs.writeFileSync(ICON_PATH, ico);
  console.log(`[generate-icon] Programmatic icon → assets/icon.ico (${ico.length} bytes)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(function main() {
// If source-icon.png exists, use sharp to convert it properly
if (fs.existsSync(SOURCE_PNG)) {
  if (isUpToDate(SOURCE_PNG, ICON_PATH)) {
    console.log('[generate-icon] source-icon.png unchanged, skipping icon rebuild.');
    process.exit(0);
  }
  try {
    const sharp = require('sharp');
    Promise.all([
      sharp(SOURCE_PNG).resize(16,16).png().toBuffer(),
      sharp(SOURCE_PNG).resize(32,32).png().toBuffer(),
      sharp(SOURCE_PNG).resize(48,48).png().toBuffer(),
      sharp(SOURCE_PNG).resize(256,256).png().toBuffer(),
    ]).then(([p16,p32,p48,p256]) => {
      const ico = buildICO([p16,p32,p48,p256], [16,32,48,256]);
      fs.writeFileSync(ICON_PATH, ico);
      console.log(`[generate-icon] Built from source-icon.png → ${ico.length} bytes ✓`);
    }).catch(e => {
      console.warn('[generate-icon] sharp failed:', e.message, '— using programmatic fallback');
      generateProgrammatic();
    });
    return; // early exit handled by promise chain
  } catch {
    console.warn('[generate-icon] sharp not available — using programmatic fallback');
  }
}

// Skip if a large icon already exists (user's custom icon)
if (fs.existsSync(ICON_PATH) && fs.statSync(ICON_PATH).size > 5000) {
  console.log('[generate-icon] Icon already exists, skipping.');
  process.exit(0);
}

generateProgrammatic();
})();
