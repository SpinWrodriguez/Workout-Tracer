/**
 * Generates the PWA icon set as raw PNGs. Hand-rolled rather than pulled from
 * an image library so the repo has no build-time binary dependency: the mark
 * is a barbell drawn from rectangles on the app's near-black background.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BG = [0x0a, 0x0a, 0x0a];
const FG = [0xff, 0xff, 0xff];
const ACCENT = [0xff, 0x8a, 0x5b]; // --volume

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = draw(x, y);
      const o = rowStart + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Barbell mark, laid out in fractions of the icon so it scales cleanly. */
function barbell(size, inset) {
  const box = (x0, y0, x1, y1) => ({ x0: x0 * size, y0: y0 * size, x1: x1 * size, y1: y1 * size });
  const s = 1 - inset * 2;
  const f = (v) => inset + v * s;

  const bar = box(f(0.1), f(0.46), f(0.9), f(0.54));
  const innerL = box(f(0.2), f(0.3), f(0.3), f(0.7));
  const innerR = box(f(0.7), f(0.3), f(0.8), f(0.7));
  const outerL = box(f(0.08), f(0.36), f(0.16), f(0.64));
  const outerR = box(f(0.84), f(0.36), f(0.92), f(0.64));

  const hit = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (hit(innerL, px, py) || hit(innerR, px, py)) return FG;
    if (hit(outerL, px, py) || hit(outerR, px, py)) return ACCENT;
    if (hit(bar, px, py)) return FG;
    return BG;
  };
}

const out = new URL('../public/', import.meta.url).pathname;
const targets = [
  ['pwa-192.png', 192, 0.14],
  ['pwa-512.png', 512, 0.14],
  // Maskable icons lose the outer ~10% to the platform mask, so inset more.
  ['pwa-maskable-512.png', 512, 0.26],
  ['apple-touch-icon.png', 180, 0.12],
];

for (const [name, size, inset] of targets) {
  writeFileSync(join(out, name), png(size, barbell(size, inset)));
  console.log(`wrote ${name} (${size}px)`);
}
