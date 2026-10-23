import type {
  AppConfig,
  GlobalSettings,
  OverlayActionsDirection,
  OverlayBackgroundFit,
  OverlayImageMode,
  Reminder,
  ReminderAction,
  ThemeSettings,
} from '@app/schema';
import type { PlannedTrigger, TemplateVariables } from '@app/core';

/** 配置 + 图标资源解析结果，一次性发给渲染进程，避免来回查询 */
export interface ConfigPayload {
  config: AppConfig;
  /** asset:<id> → data URL，供 <img> 直接使用 */
  assetUrls: Record<string, string>;
}

export interface EngineStatus {
  /** 当前连续活跃秒数 */
  activeSeconds: number;
  /** 当前空闲秒数 */
  idleSeconds: number;
  paused: boolean;
  /** 静音截止时刻；null 表示未静音 */
  mutedUntil: number | null;
  /** 今日已确认起身次数 */
  todayAckCount: number;
  /** 今日已触发提醒次数 */
  todayFireCount: number;
  /** 节假日数据来源；null 表示未加载，中国工作日会按周一到周五处理 */
  calendarSource: string | null;
  /** 未来 24 小时的提醒预览（最多 8 条） */
  upcoming: PlannedTrigger[];
}

export interface AckPayload {
  id: string;
  action: ReminderAction;
  minutes?: number;
}

export type SoundLevel = 'none' | 'gentle' | 'normal' | 'strong';

/** 悬浮卡片渲染所需的一切 */
export interface OverlayPayload {
  reminderId: string;
  title: string;
  message: string;
  /** builtin:<name> 或 asset:<id> */
  icon: string;
  /** 用户导入图标的 data URL；内置图标为 null */
  iconDataUrl: string | null;
  iconColor: string;
  corner: Reminder['overlayStyle']['corner'];
  /** 卡片宽度（像素）；全屏遮罩模式下忽略 */
  width: number;
  opacity: number;
  autoCloseSeconds: number;
  /** true 时铺满整块屏幕，用半透明遮罩表达「最高级提醒」 */
  fullscreenMask: boolean;
  sound: SoundLevel;
  escalationStep: number;
  actions: ReminderAction[];
  snoozeMinutes: number[];
  variables: TemplateVariables;
  /** 主题背景图（data URL）；null 表示使用纯色卡片 */
  backgroundDataUrl: string | null;
  /** 图片作为整张背景，还是作为右侧人物/插画 */
  imageMode: OverlayImageMode;
  /** 背景图的适配方式 */
  backgroundFit: OverlayBackgroundFit;
  /** 背景图上的白色蒙版深度 */
  backgroundDim: number;
  /** 人物/插画中心位置和缩放 */
  imagePosition: { x: number; y: number };
  imageScale: number;
  /** 文字块位置（百分比） */
  textPosition: { x: number; y: number };
  textAlign: 'left' | 'center' | 'right';
  /** 操作按钮整组的位置与排列方向 */
  actionsPosition: { x: number; y: number };
  actionsDirection: OverlayActionsDirection;
  /** 去掉卡片白底、边框和阴影 */
  cardTransparent: boolean;
}

export interface ImportedIcon {
  ref: string;
  kind: 'icon';
  fileName: string;
}

export interface ImportedAsset {
  ref: string;
  kind: 'icon' | 'background';
  fileName: string;
}

export type SettingsPatch = Partial<GlobalSettings>;

export interface BootstrapPayload {
  config: AppConfig | null;
  assetUrls: Record<string, string>;
  snapshot: { activeSeconds: number; lastTickAt: number | null; idleSeconds?: number };
  idleThresholdSeconds: number;
}

/**
 * 渲染进程依赖的全部能力。
 * Electron 版本由 preload 实现，Tauri 版本由 tauri/api.ts 实现——
 * 界面组件只认这个接口，所以换外壳时 UI 一行都不用改。
 */
export interface DesktopApi {
  getConfig(): Promise<ConfigPayload>;
  saveReminder(reminder: Reminder): Promise<ConfigPayload>;
  deleteReminder(id: string): Promise<ConfigPayload>;
  acknowledge(payload: AckPayload): Promise<ConfigPayload>;
  patchSettings(patch: SettingsPatch): Promise<ConfigPayload>;
  setPaused(paused: boolean): Promise<EngineStatus>;
  getStatus(): Promise<EngineStatus>;
  planPreview(horizonMs: number): Promise<PlannedTrigger[]>;
  importIcon(): Promise<ImportedIcon | null>;
  importAsset(kind: 'icon' | 'background'): Promise<ImportedAsset | null>;
  patchTheme(patch: Partial<ThemeSettings>): Promise<ConfigPayload>;
  openDataDir(): Promise<void>;
  openProjectPage(): Promise<void>;
  onStatus(cb: (status: EngineStatus) => void): () => void;
  onConfig(cb: (payload: ConfigPayload) => void): () => void;
  getOverlayPayload(): Promise<OverlayPayload | null>;
  overlayAction(id: string, action: ReminderAction, minutes?: number): Promise<void>;
}
