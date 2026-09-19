#!/usr/bin/env node
/**
 * Generates the PWA icon set (Part 9A §2.3) with zero image dependencies.
 *
 * Draws the HavenWorld leaf mark (a vesica/leaf shape in Haven teal on the deep
 * navy brand background) and writes real PNG files using Node's zlib for the
 * IDAT stream, so CI and contributors never need ImageMagick or sharp.
 *
 * Usage: node scripts/generate_icons.mjs   (also runs from the client prebuild step)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Renders the icon: rounded-square navy background with a two-tone teal leaf.
 * `padding` keeps the mark inside the safe zone for maskable icons.
 */
function drawIcon(size, { padding, rounded }) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  const background = { r: 0x0d, g: 0x1b, b: 0x2a };
  const leafLight = { r: 0x4e, g: 0xcd, b: 0xc4 };
  const leafDark = { r: 0x1f, g: 0x9e, b: 0x96 };

  // Leaf geometry: vesica (intersection of two circles) rotated -45°.
  const angle = -Math.PI / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radius = size * 0.34 * padding;
  const offset = size * 0.2 * padding;

  const cornerRadius = rounded ? size * 0.22 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Rounded-rectangle background mask (alpha 0 outside the corner radius).
      let insideBg = true;
      if (cornerRadius > 0) {
        const dx = Math.max(cornerRadius - x, 0, x - (size - cornerRadius));
        const dy = Math.max(cornerRadius - y, 0, y - (size - cornerRadius));
        if (dx > 0 && dy > 0) insideBg = Math.hypot(dx, dy) <= cornerRadius;
      }

      if (!insideBg) {
        rgba[i + 3] = 0;
        continue;
      }

      let colour = background;

      // Rotate the pixel into leaf space.
      const px = x - cx;
      const py = y - cy;
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      const leafY = ry + size * 0.05;

      const d1 = Math.hypot(rx - offset, leafY);
      const d2 = Math.hypot(rx + offset, leafY);
      const inLeaf = d1 <= radius && d2 <= radius;

      // Stem runs down from the leaf tip.
      const stemWidth = size * 0.022 * padding;
      const inStem =
        Math.abs(rx) <= stemWidth && leafY >= 0 && leafY <= size * 0.42 * padding;

      if (inLeaf) {
        colour = rx < 0 ? leafLight : leafDark;
      } else if (inStem) {
        colour = leafDark;
      }

      rgba[i] = colour.r;
      rgba[i + 1] = colour.g;
      rgba[i + 2] = colour.b;
      rgba[i + 3] = 255;
    }
  }

  return encodePng(size, rgba);
}

const icons = [
  { file: 'icon-192.png', size: 192, padding: 0.86, rounded: true },
  { file: 'icon-512.png', size: 512, padding: 0.86, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.62, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.86, rounded: false },
];

for (const icon of icons) {
  const png = drawIcon(icon.size, icon);
  writeFileSync(join(outDir, icon.file), png);
  console.log(`[icons] wrote public/icons/${icon.file} (${png.length} bytes)`);
}