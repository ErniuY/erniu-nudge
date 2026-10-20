/**
 * 启动 Tauri 相关脚本，并把 cargo 的 bin 目录补进 PATH。
 *
 * 为什么需要这个：rustup 安装后会把 %USERPROFILE%\.cargo\bin 写进用户 PATH，
 * 但已经开着的终端（尤其是 Windows Terminal / VS Code 里的新标签页）会继承旧环境，
 * 于是 tauri 报 "cargo ... program not found"。这里不依赖调用方的 PATH，自己补。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('用法：node scripts/run-tauri.mjs <dev|build:win>');
  process.exit(1);
}

const cargoBin = join(homedir(), '.cargo', 'bin');
const cargoExe = join(cargoBin, process.platform === 'win32' ? 'cargo.exe' : 'cargo');

if (!existsSync(cargoExe)) {
  console.error(`未找到 cargo：${cargoExe}`);
  console.error('请先安装 Rust（rustup），或把 cargo 所在目录加入 PATH。');
  process.exit(1);
}

const separator = process.platform === 'win32' ? ';' : ':';
const env = { ...process.env };
// Windows 的 PATH 大小写不固定，先清掉所有变体，再写一个确定的值
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'path') delete env[key];
}
env.PATH = `${cargoBin}${separator}${process.env.PATH ?? process.env.Path ?? ''}`;

const child = spawn('pnpm', ['--filter', '@app/desktop', target], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
