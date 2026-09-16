/** 主进程与渲染进程之间的通道名，两侧共用，避免字符串写错 */
export const IPC = {
  configGet: 'config:get',
  configChanged: 'config:changed',
  reminderSave: 'reminder:save',
  reminderDelete: 'reminder:delete',
  reminderAck: 'reminder:ack',
  settingsPatch: 'settings:patch',
  statusGet: 'engine:status',
  statusPush: 'engine:status:push',
  planPreview: 'engine:plan',
  pauseSet: 'engine:pause',
  iconImport: 'icon:import',
  overlayPayload: 'overlay:payload',
  overlayAction: 'overlay:action',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
