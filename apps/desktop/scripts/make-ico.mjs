/**
 * 把一张 PNG 转成真正的 ICO。
 *
 * 为什么需要这个脚本：ICO 是容器格式，把 icon.png 改名成 icon.ico 是不行的。
 * electron-builder 最后会给 exe 设置图标，这一步由 rcedit 完成，它读到假 ICO 会直接报
 * "Reserved header is not 0 or image type is not icon" 然后整个打包失败。
 *
 * 实现要点：
 * - 自己解 PNG（8 位 RGB/RGBA、非隔行），不引入任何图形库；
 * - 非正方形图片先补成正方形（居中、透明填充），否则缩放会变形；
 * - 输出 BMP(DIB) 格式的 ICO 条目，而不是 PNG 内嵌式——后者虽然合法，
 *   但旧版 rcedit 不一定支持，BMP 格式是所有 Windows 工具都认的保守选择；
 * - 生成 16/24/32/48/64/128/256 七个尺寸，任务栏、桌面、文件资源管理器各处都清晰。
 *
 * 用法：
 *   node scripts/make-ico.mjs
 *   node scripts/make-ico.mjs --source resources/icons/logo.png --out resources/icons/icon.ico
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const sourcePath = resolve(argOf('--source', 'resources/icons/icon.png'));
const outputPath = resolve(argOf('--out', 'resources/icons/icon.ico'));
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------- PNG 解码 */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(line, prev, filter, bpp) {
  const n = line.length;
  switch (filter) {
    case 0:
      break;
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
      break;
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 0xff;
      break;
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        line[i] = (line[i] + paeth(a, b, c)) & 0xff;
      }
      break;
    default:
      throw new Error(`未知的 PNG 行过滤器类型 ${filter}`);
  }
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('源文件不是 PNG。ICO 需要真正的图标文件，不能只改扩展名。');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (depth !== 8) throw new Error(`只支持 8 位色深的 PNG，当前是 ${depth} 位`);
  if (interlace !== 0) throw new Error('不支持隔行扫描（interlaced）的 PNG，请另存为普通 PNG');

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) {
    throw new Error(`只支持 RGB / RGBA 的 PNG，当前 colorType=${colorType}（可能是调色板或灰度图）`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let cursor = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    unfilter(line, previous, filter, channels);

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      rgba[d] = line[s];
      rgba[d + 1] = line[s + 1];
      rgba[d + 2] = line[s + 2];
      rgba[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    previous = line;
  }

  return { width, height, rgba };
}

/* ------------------------------------------------------- 补齐与缩放 */

function padToSquare(image) {
  if (image.width === image.height) return image;
  const size = Math.max(image.width, image.height);
  const rgba = Buffer.alloc(size * size * 4);
  const dx = Math.floor((size - image.width) / 2);
  const dy = Math.floor((size - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    image.rgba.copy(
      rgba,
      ((y + dy) * size + dx) * 4,
      y * image.width * 4,
      (y + 1) * image.width * 4,
    );
  }
  return { width: size, height: size, rgba };
}

// 盒式滤波 + 预乘 alpha：直接对非预乘的 RGB 取平均会让透明边缘发黑
function resize(image, target) {
  const out = Buffer.alloc(target * target * 4);
  const scale = image.width / target;

  for (let y = 0; y < target; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.ceil((y + 1) * scale)));

    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.ceil((x + 1) * scale)));

      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          const a = image.rgba[i + 3] / 255;
          r += image.rgba[i] * a;
          g += image.rgba[i + 1] * a;
          b += image.rgba[i + 2] * a;
          alphaSum += image.rgba[i + 3];
          count++;
        }
      }

      const weight = alphaSum / 255;
      const d = (y * target + x) * 4;
      if (weight > 0) {
        out[d] = Math.round(r / weight);
        out[d + 1] = Math.round(g / weight);
        out[d + 2] = Math.round(b / weight);
      }
      out[d + 3] = Math.round(alphaSum / count);
    }
  }
  return out;
}

/* --------------------------------------------------------- ICO 组装 */

// 单个尺寸编成 BMP(DIB) 条目：BITMAPINFOHEADER + 自下而上的 BGRA + AND 掩码
function toBmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // 高度是两倍：XOR 位图 + AND 掩码
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sourceY = size - 1 - y; // BMP 是自下而上
    for (let x = 0; x < size; x++) {
      const s = (sourceY * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2]; // B
      pixels[d + 1] = rgba[s + 1]; // G
      pixels[d + 2] = rgba[s]; // R
      pixels[d + 3] = rgba[s + 3]; // A
    }
  }

  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const sourceY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      if (rgba[(sourceY * size + x) * 4 + 3] < 128) {
        mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];

  for (const image of images) {
    const entry = Buffer.alloc(16);
    // 256 及以上在 ICO 里记为 0
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/** 写完再读回来校验一遍，避免又交付一个格式不对的文件 */
function verifyIco(buffer, expectedSizes) {
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  if (reserved !== 0 || type !== 1) throw new Error('ICO 头无效');
  if (count !== expectedSizes.length) throw new Error(`条目数应为 ${expectedSizes.length}，实际 ${count}`);

  const problems = [];
  let cursor = 6 + count * 16;

  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const size = buffer[base];
    const bytes = buffer.readUInt32LE(base + 8);
    const offset = buffer.readUInt32LE(base + 12);
    if (offset !== cursor) problems.push(`第 ${i} 条偏移应为 ${cursor}，实际 ${offset}`);
    if (offset + bytes > buffer.length) problems.push(`第 ${i} 条数据越界`);
    const biSize = buffer.readUInt32LE(offset);
    const biWidth = buffer.readInt32LE(offset + 4);
    const biHeight = buffer.readInt32LE(offset + 8);
    if (biSize !== 40) problems.push(`第 ${i} 条 BITMAPINFOHEADER 大小异常`);
    if (biWidth !== expectedSizes[i] || biHeight !== expectedSizes[i] * 2) {
      problems.push(`第 ${i} 条尺寸异常 ${biWidth}x${biHeight}`);
    }
    if (size !== 0 && size !== expectedSizes[i]) problems.push(`第 ${i} 条目录尺寸异常`);
    cursor += bytes;
  }
  if (cursor !== buffer.length) problems.push(`总长度对不上：${cursor} vs ${buffer.length}`);
  return problems;
}

/* --------------------------------------------------------------- 主流程 */

if (!existsSync(sourcePath)) {
  console.log(`源图不存在，跳过：${sourcePath}`);
  process.exit(0);
}

const source = decodePng(readFileSync(sourcePath));
console.log(`源图：${source.width}x${source.height}  ${sourcePath}`);

const square = padToSquare(source);
if (square.width !== source.width) {
  console.log(`非正方形，已居中补成 ${square.width}x${square.height}（透明填充）`);
}

const images = SIZES.map((size) => ({ size, data: toBmpEntry(resize(square, size), size) }));
const ico = encodeIco(images);
writeFileSync(outputPath, ico);

const problems = verifyIco(readFileSync(outputPath), SIZES);
if (problems.length > 0) {
  console.error('生成结果校验失败：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(`已生成 ${outputPath}`);
console.log(`  格式：BMP(DIB)，32 位带 Alpha，含 ${SIZES.join(' / ')} 共 ${SIZES.length} 个尺寸`);
console.log(`  大小：${Math.round(ico.length / 1024)} KB，结构校验通过`);
