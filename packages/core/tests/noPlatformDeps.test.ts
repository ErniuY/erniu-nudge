import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));

/** core 与 schema 是将来要搬到 iOS 的代码，必须保持零平台依赖 */
const SCAN_ROOTS = [join(here, '../../schema/src'), join(here, '../src')];

const FORBIDDEN = [
  { re: /\bfrom\s+['"]electron['"]/, why: '禁止依赖 Electron' },
  { re: /\bfrom\s+['"]node:[^'"]+['"]/, why: '禁止使用 Node 内置模块' },
  { re: /\bfrom\s+['"](fs|path|os|child_process|worker_threads|net|http)['"]/, why: '禁止使用平台模块' },
  { re: /\brequire\s*\(\s*['"](electron|fs|path|os|child_process)['"]\s*\)/, why: '禁止使用 CommonJS require' },
];

function collectTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTypeScriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('跨平台约束', () => {
  it('core 与 schema 的源码不得引入任何平台 API', () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const file of collectTypeScriptFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const rule of FORBIDDEN) {
          if (rule.re.test(text)) offenders.push(`${file} → ${rule.why}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
