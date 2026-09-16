import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  AckPayload,
  ConfigPayload,
  EngineStatus,
  ImportedIcon,
  OverlayPayload,
  SettingsPatch,
} from '../shared/types';
import type { Reminder, ReminderAction } from '@app/schema';
import type { PlannedTrigger } from '@app/core';

/** 订阅主进程推送，返回取消订阅函数（React 的 useEffect 直接返回它即可） */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api = {
  getConfig: (): Promise<ConfigPayload> => ipcRenderer.invoke(IPC.configGet),

  saveReminder: (reminder: Reminder): Promise<ConfigPayload> =>
    ipcRenderer.invoke(IPC.reminderSave, reminder),

  deleteReminder: (id: string): Promise<ConfigPayload> =>
    ipcRenderer.invoke(IPC.reminderDelete, id),

  acknowledge: (payload: AckPayload): Promise<ConfigPayload> =>
    ipcRenderer.invoke(IPC.reminderAck, payload),

  patchSettings: (patch: SettingsPatch): Promise<ConfigPayload> =>
    ipcRenderer.invoke(IPC.settingsPatch, patch),

  setPaused: (paused: boolean): Promise<EngineStatus> =>
    ipcRenderer.invoke(IPC.pauseSet, paused),

  getStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.statusGet),

  planPreview: (horizonMs: number): Promise<PlannedTrigger[]> =>
    ipcRenderer.invoke(IPC.planPreview, horizonMs),

  importIcon: (): Promise<ImportedIcon | null> => ipcRenderer.invoke(IPC.iconImport),

  onStatus: (cb: (status: EngineStatus) => void) => subscribe<EngineStatus>(IPC.statusPush, cb),
  onConfig: (cb: (payload: ConfigPayload) => void) => subscribe<ConfigPayload>(IPC.configChanged, cb),

  /**
   * 悬浮卡片在挂载后主动拉取自己的内容。
   * 用「拉」而不是主进程「推」，可以彻底避开「主进程发得太早、React 还没挂载」的竞态。
   */
  getOverlayPayload: (): Promise<OverlayPayload | null> =>
    ipcRenderer.invoke(IPC.overlayPayload),

  overlayAction: (id: string, action: ReminderAction, minutes?: number): Promise<void> =>
    ipcRenderer.invoke(IPC.overlayAction, { id, action, minutes }),
};

contextBridge.exposeInMainWorld('api', api);

export type DesktopApi = typeof api;
