import path from 'node:path';
import type { BrowserWindow } from 'electron';

/** electron-vite 在开发模式下注入的渲染进程地址 */
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

/**
 * 加载渲染进程页面。
 * 开发模式走 vite dev server，生产模式读打包产物 out/renderer/*.html。
 * 主窗口与悬浮卡片是两个入口，所以用 page 区分。
 */
export function loadRendererPage(win: BrowserWindow, page: 'index' | 'overlay'): void {
  if (DEV_SERVER_URL) {
    void win.loadURL(`${DEV_SERVER_URL}/${page}.html`);
    return;
  }
  void win.loadFile(path.join(__dirname, `../renderer/${page}.html`));
}
