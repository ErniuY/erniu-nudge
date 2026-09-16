import { Menu, Tray, nativeImage } from 'electron';

export interface TrayController {
  updateStatus(text: string): void;
  setPaused(value: boolean): void;
  destroy(): void;
}

export function createTray(deps: {
  iconPath: string;
  onOpen(): void;
  onTogglePause(paused: boolean): void;
  onMute(minutes: number): void;
  onMuteUntilTomorrow(): void;
  onUnmute(): void;
  onQuit(): void;
}): TrayController {
  const image = nativeImage.createFromPath(deps.iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(image);
  tray.setToolTip('久坐提醒');

  let paused = false;

  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开设置…', click: () => deps.onOpen() },
        { type: 'separator' },
        {
          label: '暂停提醒',
          type: 'checkbox',
          checked: paused,
          click: (item) => {
            paused = item.checked;
            deps.onTogglePause(paused);
            rebuild();
          },
        },
        { type: 'separator' },
        { label: '静音 30 分钟', click: () => deps.onMute(30) },
        { label: '静音 1 小时', click: () => deps.onMute(60) },
        { label: '静音到明天', click: () => deps.onMuteUntilTomorrow() },
        { label: '取消静音', click: () => deps.onUnmute() },
        { type: 'separator' },
        { label: '退出', click: () => deps.onQuit() },
      ]),
    );
  };

  rebuild();
  tray.on('click', () => deps.onOpen());

  return {
    updateStatus(text) {
      tray.setToolTip(text);
    },
    setPaused(value) {
      paused = value;
      rebuild();
    },
    destroy() {
      tray.destroy();
    },
  };
}
