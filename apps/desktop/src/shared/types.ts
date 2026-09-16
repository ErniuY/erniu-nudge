import type { AppConfig, GlobalSettings, Reminder, ReminderAction } from '@app/schema';
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
}

export interface ImportedIcon {
  ref: string;
  kind: 'icon';
  fileName: string;
}

export type SettingsPatch = Partial<GlobalSettings>;
