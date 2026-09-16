import path from 'node:path';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { OverlayPayload } from '../../shared/types';
import { loadRendererPage } from '../util/loadRenderer';

/** 记住每条提醒上次出现在哪块屏幕，多屏环境下卡片才不会乱跑 */
const lastDisplayByReminder = new Map<string, number>();
/** 悬浮窗口是新建的，内容通过 webContents.id 反查，避免「推得太早」的竞态 */
const payloadByWebContents = new Map<number, OverlayPayload>();

export function takeOverlayPayload(webContentsId: number): OverlayPayload | null {
  return payloadByWebContents.get(webContentsId) ?? null;
}

function chooseDisplay(reminderId: string) {
  const displays = screen.getAllDisplays();
  const remembered = lastDisplayByReminder.get(reminderId);
  if (remembered !== undefined) {
    const found = displays.find((display) => display.id === remembered);
    if (found) return found;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function cornerPosition(
  corner: OverlayPayload['corner'],
  area: Rectangle,
  width: number,
  height: number,
): { x: number; y: number } {
  const pad = 24;
  switch (corner) {
    case 'bottom-right':
      return { x: area.x + area.width - width - pad, y: area.y + area.height - height - pad };
    case 'bottom-left':
      return { x: area.x + pad, y: area.y + area.height - height - pad };
    case 'top-right':
      return { x: area.x + area.width - width - pad, y: area.y + pad };
    case 'top-left':
      return { x: area.x + pad, y: area.y + pad };
    case 'center':
      return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2 };
  }
}

function cardHeight(payload: OverlayPayload): number {
  return payload.actions.length > 0 ? 216 : 160;
}

/**
 * 创建一张悬浮提醒卡片。
 *
 * 三个关键点，缺一个体验就明显变差：
 * 1. 用 showInactive() 而不是 show()——你正在打字时弹提醒，焦点不能被抢走；
 * 2. setAlwaysOnTop(true, 'screen-saver') 才盖得住全屏视频；
 * 3. 记住每条提醒上次出现的显示器。
 */
export function createOverlayWindow(payload: OverlayPayload): BrowserWindow {
  const display = chooseDisplay(payload.reminderId);
  lastDisplayByReminder.set(payload.reminderId, display.id);

  const mask = payload.fullscreenMask;
  const width = mask ? display.bounds.width : payload.width;
  const height = mask ? display.bounds.height : cardHeight(payload);
  const position = mask
    ? { x: display.bounds.x, y: display.bounds.y }
    : cornerPosition(payload.corner, display.workArea, width, height);

  const win = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const webContentsId = win.webContents.id;
  payloadByWebContents.set(webContentsId, payload);
  win.on('closed', () => payloadByWebContents.delete(webContentsId));

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (!mask) win.setOpacity(payload.opacity);

  loadRendererPage(win, 'overlay');
  win.once('ready-to-show', () => win.showInactive());

  if (payload.autoCloseSeconds > 0) {
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, payload.autoCloseSeconds * 1000);
    win.on('closed', () => clearTimeout(timer));
  }

  return win;
}
