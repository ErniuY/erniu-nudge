import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { BrowserWindow, app } from 'electron';
import { ConfigStore } from './configStore';
import { EngineHost } from './engineHost';
import { registerIpc } from './ipc';
import { createNotifier, type Notifier } from './notify';
import { FullscreenDetector } from './system/fullscreen';
import { ChinaWorkdayCalendar } from './system/chinaWorkday';
import { WindowsActivityProvider } from './system/windowsActivity';
import { createTray, type TrayController } from './tray';
import { loadRendererPage } from './util/loadRenderer';
import { formatDuration } from './util/render';
import { IPC } from '../shared/ipc';
import type { ConfigPayload, EngineStatus } from '../shared/types';

const RESOURCES = path.join(__dirname, '../../resources');

/**
 * 应用数据目录固定用 ASCII 名。
 *
 * 默认情况下 Electron 会拿 productName 当目录名，于是变成 %APPDATA%\久坐提醒。
 * 中文路径在备份脚本、日志排查、命令行工具、以及将来跨平台同步时都容易出问题，
 * 所以这里显式固定为 erniu-nudge。
 *
 * 必须在 app ready 之前设置——ConfigStore 之后才会按这个路径去找 config.json。
 */
const USER_DATA_DIR = path.join(app.getPath('appData'), 'erniu-nudge');
try {
  mkdirSync(USER_DATA_DIR, { recursive: true });
  app.setName('erniu-nudge');
  app.setPath('userData', USER_DATA_DIR);
} catch (err) {
  // 目录建不出来（权限受限、被安全软件拦下等）就退回 Electron 默认位置，
  // 绝不因为一个路径问题让整个应用起不来。
  console.warn('[app] 无法固定数据目录，改用 Electron 默认位置：', err);
}

let mainWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
let host: EngineHost | null = null;
let notifier: Notifier | null = null;
let activity: WindowsActivityProvider | null = null;
let fullscreenDetector: FullscreenDetector | null = null;
let assetUrls: Record<string, string> = {};
let quitting = false;

/** 开机静默启动：不弹主窗口 */
const startHidden = process.argv.includes('--hidden');

// 单实例：第二次启动时唤起已有窗口即可
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  void app.whenReady().then(bootstrap);
}

async function bootstrap(): Promise<void> {
  const store = await ConfigStore.load();
  assetUrls = await store.resolveAssetUrls();

  activity = new WindowsActivityProvider(() => store.get().global.idleThresholdSeconds);

  notifier = createNotifier({
    isMuted: () => {
      const until = store.get().global.muteUntil;
      return until !== null && Date.now() < until;
    },
    resolveAssetUrl: (ref) => assetUrls[ref] ?? null,
  });

  fullscreenDetector = new FullscreenDetector((value) => activity?.setFullscreen(value));
  fullscreenDetector.start();

  // 节假日数据是可选的：装了就识别调休，没装就退回周一到周五，不影响启动
  const calendar = new ChinaWorkdayCalendar();
  await calendar.load();

  host = new EngineHost(store, activity, notifier, calendar, (status) => {
    broadcast(IPC.statusPush, status);
    tray?.updateStatus(tooltipFor(status));
  });

  mainWindow = createMainWindow();

  registerIpc({
    store,
    host,
    notifier,
    getMainWindow: () => mainWindow,
    applyLaunchAtLogin,
    onConfigChanged: (payload) => {
      assetUrls = payload.assetUrls;
      broadcast(IPC.configChanged, payload);
    },
  });

  tray = createTray({
    iconPath: path.join(RESOURCES, 'icons', 'tray.png'),
    onOpen: showMainWindow,
    onTogglePause: (paused) => host?.setPaused(paused),
    onMute: (minutes) => void setMute(Date.now() + minutes * 60_000, store),
    onMuteUntilTomorrow: () => void setMute(startOfTomorrow(), store),
    onUnmute: () => void setMute(null, store),
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });

  applyLaunchAtLogin(store.get().global.launchAtLogin);
  await host.start();
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '久坐提醒',
    icon: path.join(RESOURCES, 'icons', 'icon.png'),
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // Windows 上关闭主窗口应当最小化到托盘，而不是退出应用
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  loadRendererPage(win, 'index');
  return win;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function setMute(until: number | null, store: ConfigStore): Promise<void> {
  await store.update((draft) => {
    draft.global.muteUntil = until;
  });
  const payload: ConfigPayload = {
    config: store.get(),
    assetUrls: await store.resolveAssetUrls(),
  };
  broadcast(IPC.configChanged, payload);
  if (host) broadcast(IPC.statusPush, host.status());
}

function startOfTomorrow(): number {
  const date = new Date();
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function applyLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--hidden'],
  });
}

function tooltipFor(status: EngineStatus): string {
  if (status.paused) return '久坐提醒：已暂停';
  if (status.mutedUntil !== null && Date.now() < status.mutedUntil) return '久坐提醒：已静音';
  if (status.activeSeconds < 60) return '久坐提醒：刚开始计时';
  return `久坐提醒：已连续坐 ${formatDuration(status.activeSeconds)}`;
}

// 注意：window-all-closed 的监听器不带参数（不像 before-quit 有 Event 参数）。
// 而且「注册了这个监听器」本身就足以取消 Electron 默认的「关完窗口就退出」。
// 主窗口的 close 处理里已经改成隐藏到托盘，所以这里什么都不用做。
app.on('window-all-closed', () => {
  // 常驻托盘：不退出
});

app.on('before-quit', () => {
  quitting = true;
  fullscreenDetector?.dispose();
  activity?.dispose();
  notifier?.closeAll();
  host?.stop();
  tray?.destroy();
});
