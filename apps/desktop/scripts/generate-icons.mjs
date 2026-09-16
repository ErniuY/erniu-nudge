/**
 * 生成应用图标（托盘 / 窗口 / 打包用的 ico）。
 *
 * 为什么要自己生成：Electron 的托盘图标不支持 SVG，必须是 PNG 或 ICO。
 * 这里用一个极简光栅器直接画出「站立小人」，不引入任何图形库，
 * 想换配色或造型改下面的常量即可。
 *
 * 运行：pnpm --filter @app/desktop icons
 * 可选：node scripts/generate-icons.mjs --out <目录>
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFlag = process.argv.indexOf('--out');
const outDir =
  outFlag >= 0 ? resolve(process.argv[outFlag + 1]) : join(here, '..', 'resources', 'icons');

const BACKGROUND = [0x2f, 0x80, 0xed]; // #2F80ED
const FOREGROUND = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------------ 光栅器 */

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inRoundedRect(u, v, radius) {
  const cx = Math.min(Math.max(u, radius), 1 - radius);
  const cy = Math.min(Math.max(v, radius), 1 - radius);
  return Math.hypot(u - cx, v - cy) <= radius;
}

/** 归一化坐标 (u, v) → RGBA。先判断圆角背景，再叠加白色人形。 */
function shade(u, v) {
  if (!inRoundedRect(u, v, 0.22)) return [0, 0, 0, 0];

  if (Math.hypot(u - 0.5, v - 0.255) <= 0.086) return [...FOREGROUND, 255];

  const strokes = [
    [0.5, 0.36, 0.5, 0.6, 0.038], // 身体
    [0.5, 0.41, 0.31, 0.52, 0.032], // 左臂
    [0.5, 0.41, 0.69, 0.52, 0.032], // 右臂
    [0.5, 0.6, 0.39, 0.79, 0.036], // 左腿
    [0.5, 0.6, 0.61, 0.79, 0.036], // 右腿
  ];
  for (const [x1, y1, x2, y2, width] of strokes) {
    if (distanceToSegment(u, v, x1, y1, x2, y2) <= width) return [...FOREGROUND, 255];
  }
  return [...BACKGROUND, 255];
}

function renderRGBA(size, samples = 3) {
  const data = Buffer.alloc(size * size * 4);
  const total = samples * samples;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const [pr, pg, pb, pa] = shade(u, v);
          const alpha = pa / 255;
          r += pr * alpha;
          g += pg * alpha;
          b += pb * alpha;
          a += pa;
        }
      }

      const alphaSum = a / 255;
      const i = (y * size + x) * 4;
      if (alphaSum > 0) {
        data[i] = Math.round(r / alphaSum);
        data[i + 1] = Math.round(g / alphaSum);
        data[i + 2] = Math.round(b / alphaSum);
        data[i + 3] = Math.round(a / total);
      }
    }
  }
  return data;
}

/* ------------------------------------------------------------- PNG 与 ICO */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // 过滤器：None
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO 允许直接内嵌 PNG（Vista 以后），所以不用手写 BMP 位图数据 */
function encodeIco(pngBuffers, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = 图标
  header.writeUInt16LE(pngBuffers.length, 4);

  const entries = [];
  let offset = 6 + pngBuffers.length * 16;
  for (let i = 0; i < pngBuffers.length; i++) {
    const entry = Buffer.alloc(16);
    // 256 及以上在 ICO 里记为 0
    entry[0] = sizes[i] >= 256 ? 0 : sizes[i];
    entry[1] = sizes[i] >= 256 ? 0 : sizes[i];
    entry.writeUInt16LE(1, 4); // 色平面
    entry.writeUInt16LE(32, 6); // 位深
    entry.writeUInt32LE(pngBuffers[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += pngBuffers[i].length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

/* ------------------------------------------------------------------ 输出 */

mkdirSync(outDir, { recursive: true });

const tray = encodePng(32, renderRGBA(32, 4));
const icon256 = encodePng(256, renderRGBA(256, 3));
const icon512 = encodePng(512, renderRGBA(512, 2));

writeFileSync(join(outDir, 'tray.png'), tray);
writeFileSync(join(outDir, 'icon.png'), icon512);
writeFileSync(join(outDir, 'icon.ico'), encodeIco([icon256], [256]));

console.log(`图标已生成到 ${outDir}`);
console.log(`  tray.png  32x32   ${tray.length} 字节`);
console.log(`  icon.png  512x512 ${icon512.length} 字节`);
console.log('  icon.ico  256x256（内嵌 PNG）');
