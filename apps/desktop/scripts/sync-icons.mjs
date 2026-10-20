/**
 * 把 resources/icons 下的图标同步到 src-tauri/icons。
 * Tauri 打包只认 src-tauri/icons 里的文件。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const source = join(desktop, 'resources', 'icons');
const target = join(desktop, 'src-tauri', 'icons');

mkdirSync(target, { recursive: true });

const mapping = [
  ['icon.ico', 'icon.ico'],
  ['tray.png', '32x32.png'],
  ['icon.png', '128x128.png'],
];

for (const [from, to] of mapping) {
  const fromPath = join(source, from);
  if (!existsSync(fromPath)) {
    console.warn(`跳过（源文件不存在）：${from}`);
    continue;
  }
  copyFileSync(fromPath, join(target, to));
  console.log(`同步 ${from} → src-tauri/icons/${to}`);
}
