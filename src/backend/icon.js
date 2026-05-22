/**
 * icon.js — Programmatic PNG tray icon generator
 * Creates a 32x32 purple (#7c6af7) rounded square PNG using only Node.js builtins.
 * No external dependencies required.
 */

const zlib = require('zlib');

// ── CRC32 (required by PNG spec) ─────────────────────────────────────────────

let _crcTable = null;
function getCRCTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    _crcTable[n] = c;
  }
  return _crcTable;
}

function crc32(buf) {
  const table = getCRCTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk builder ─────────────────────────────────────────────────────────

function buildChunk(type, data) {
  const lenBuf   = Buffer.allocUnsafe(4);
  const typeBuf  = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf   = Buffer.allocUnsafe(4);

  lenBuf.writeUInt32BE(data.length, 0);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ── Icon pixel painter ────────────────────────────────────────────────────────

/**
 * Returns RGBA value for a pixel at (x, y) in a 32x32 icon.
 * Draws a rounded square in #7c6af7 (purple) on transparent background.
 */
function getPixel(x, y, size) {
  const radius  = 7;
  const padding = 2;
  const inner   = size - padding * 2;

  // Local coords inside padded area
  const lx = x - padding;
  const ly = y - padding;

  if (lx < 0 || ly < 0 || lx >= inner || ly >= inner) {
    return [0, 0, 0, 0]; // transparent
  }

  // Distance from nearest corner for rounded effect
  const cx = Math.max(radius - lx, 0, lx - (inner - 1 - radius));
  const cy = Math.max(radius - ly, 0, ly - (inner - 1 - radius));
  const dist = Math.sqrt(cx * cx + cy * cy);

  if (dist > radius) {
    return [0, 0, 0, 0]; // outside rounded corner
  }

  // Anti-aliasing at edge
  const alpha = dist > radius - 1 ? Math.round((radius - dist) * 255) : 255;

  // Draw a small "C" shape in the center for branding (simplified — just a solid fill)
  return [124, 106, 247, alpha]; // #7c6af7
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Creates a 32x32 RGBA PNG Buffer for use as Electron tray icon.
 */
function createTrayIconBuffer() {
  const size = 32;

  // Build raw scanlines: filter byte (0 = None) + RGBA per pixel
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 4);
    row[0] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPixel(x, y, size);
      const offset = 1 + x * 4;
      row[offset]     = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rows.push(row);
  }

  const rawData    = Buffer.concat(rows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width(4) height(4) bitDepth colorType compression filter interlace
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 6; // color type: RGBA
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter: adaptive
  ihdrData[12] = 0; // interlace: none

  const ihdr = buildChunk('IHDR', ihdrData);
  const idat = buildChunk('IDAT', compressed);
  const iend = buildChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

module.exports = { createTrayIconBuffer };
