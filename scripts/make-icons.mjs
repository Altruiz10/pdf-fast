// Rasterises the app icon (same shapes as public/icon.svg) to PNG without extra dependencies.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ORANGE = [194, 65, 12];
const PEACH = [254, 215, 170];
const WHITE = [255, 255, 255];

// Shapes in the 512×512 design space, painted in order.
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const doc = [[168, 104], [300, 104], [384, 188], [384, 392], [360, 416], [168, 416], [144, 392], [144, 128]];
const fold = [[300, 104], [300, 164], [324, 188], [384, 188]];
const bolt = [[276, 236], [212, 324], [264, 324], [244, 400], [328, 296], [272, 296], [296, 236]];

function color(x, y, maskable) {
  if (!maskable && !inRoundRect(x, y, 0, 0, 512, 512, 112)) return null;
  let c = ORANGE;
  if (inPoly(x, y, doc)) c = WHITE;
  if (inPoly(x, y, fold)) c = PEACH;
  if (inPoly(x, y, bolt)) c = ORANGE;
  return c;
}

function png(size, maskable) {
  const ss = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          // maskable icons keep the art inside the 80% safe zone
          const k = maskable ? 0.8 : 1;
          const off = maskable ? 0.1 * 512 : 0;
          const x = ((px + (sx + 0.5) / ss) / size) * 512;
          const y = ((py + (sy + 0.5) / ss) / size) * 512;
          const c = maskable ? (color((x - off) / k, (y - off) / k, true) ?? ORANGE) : color(x, y, false);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      const n = ss * ss;
      const i = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = a / n;
      raw[i] = alpha ? (r / n) * (255 / alpha) : 0;
      raw[i + 1] = alpha ? (g / n) * (255 / alpha) : 0;
      raw[i + 2] = alpha ? (b / n) * (255 / alpha) : 0;
      raw[i + 3] = alpha;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = resolve(import.meta.dirname, '../public');
writeFileSync(resolve(out, 'icon-192.png'), png(192, false));
writeFileSync(resolve(out, 'icon-512.png'), png(512, false));
writeFileSync(resolve(out, 'icon-maskable-512.png'), png(512, true));
console.log('icons written');
