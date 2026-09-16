import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { zGlobalSettings, zReminder } from '@app/schema';
import { IPC } from '../shared/ipc';
import type {
  AckPayload,
  ConfigPayload,
  ImportedIcon,
  SettingsPatch,
} from '../shared/types';
import type { ConfigStore } from './configStore';
import type { EngineHost } from './engineHost';
import type { Notifier } from './notify';
import { takeOverlayPayload } from './notify/overlay';

export interface IpcDeps {
  store: ConfigStore;
  host: EngineHost;
  notifier: Notifier;
  getMainWindow: () => BrowserWindow | null;
  applyLaunchAtLogin: (enabled: boolean) => void;
  /** 配置发生变化：刷新图标缓存 + 广播给所有窗口 */
  onConfigChanged: (payload: ConfigPayload) => void | Promise<void>;
}

const ICON_DIALOG: OpenDialogOptions = {
  title: '选择提醒图标',
  buttonLabel: '导入',
  properties: ['openFile'],
  filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
};

export function registerIpc(deps: IpcDeps): void {
  const buildPayload = async (): Promise<ConfigPayload> => ({
    config: deps.store.get(),
    assetUrls: await deps.store.resolveAssetUrls(),
  });

  const commit = async (): Promise<ConfigPayload> => {
    const payload = await buildPayload();
    await deps.onConfigChanged(payload);
    deps.host.refreshStatus();
    return payload;
  };

  ipcMain.handle(IPC.configGet, () => buildPayload());
  ipcMain.handle(IPC.statusGet, () => deps.host.status());
  ipcMain.handle(IPC.planPreview, (_event, horizonMs: number) => deps.host.plan(horizonMs));

  ipcMain.handle(IPC.reminderSave, async (_event, raw: unknown) => {
    // 渲染进程传来的东西一律先过一遍 schema，非法数据不进配置文件
    const reminder = zReminder.parse(raw);
    await deps.store.upsertReminder(reminder);
    return commit();
  });

  ipcMain.handle(IPC.reminderDelete, async (_event, id: string) => {
    await deps.store.removeReminder(id);
    deps.notifier.closeFor(id);
    return commit();
  });

  ipcMain.handle(IPC.reminderAck, async (_event, input: AckPayload) => {
    await deps.host.acknowledge(input.id, input.action, input.minutes);
    return commit();
  });

  ipcMain.handle(IPC.settingsPatch, async (_event, raw: unknown) => {
    const patch: SettingsPatch = zGlobalSettings.partial().parse(raw);
    const before = deps.store.get().global.tickSeconds;

    await deps.store.update((draft) => {
      Object.assign(draft.global, patch);
    });

    if (patch.tickSeconds !== undefined && patch.tickSeconds !== before) {
      deps.host.restartTimer();
    }
    if (patch.launchAtLogin !== undefined) {
      deps.applyLaunchAtLogin(patch.launchAtLogin);
    }
    return commit();
  });

  ipcMain.handle(IPC.pauseSet, (_event, paused: boolean) => {
    deps.host.setPaused(Boolean(paused));
    return deps.host.status();
  });

  ipcMain.handle(IPC.iconImport, async (): Promise<ImportedIcon | null> => {
    const parent = deps.getMainWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, ICON_DIALOG)
      : await dialog.showOpenDialog(ICON_DIALOG);

    const sourcePath = result.filePaths[0];
    if (result.canceled || !sourcePath) return null;

    const { ref, fileName } = await deps.store.importIcon(sourcePath);
    await commit();
    return { ref, kind: 'icon', fileName };
  });

  // 悬浮卡片挂载后主动来取自己的内容，避开「主进程推得太早」的竞态
  ipcMain.handle(IPC.overlayPayload, (event: IpcMainInvokeEvent) =>
    takeOverlayPayload(event.sender.id),
  );

  ipcMain.handle(IPC.overlayAction, async (event: IpcMainInvokeEvent, input: AckPayload) => {
    await deps.host.acknowledge(input.id, input.action, input.minutes);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
