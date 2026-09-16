import type { GlobalSettings, Reminder } from '@app/schema';
import type { Clock } from './clock';
import type { WorkdayCalendar } from './calendar';

/**
 * 每条提醒的运行期状态。默认不落盘，进程重启后按当前时间重建；
 * 连续活跃秒数由引擎单独持久化（见 ReminderEngine.snapshot）。
 */
export interface ReminderRuntime {
  /** activeDuration 用：上次确认（起身）时的全局活跃秒数 */
  ackedActiveSeconds: number;
  /** interval / pomodoro / weekly 用：计时基准时刻 */
  anchorAt: number;
  lastFiredAt: number | null;
  /** 冷却期结束时刻，避免用户未响应时每个 tick 都弹 */
  nextEarliestAt: number;
  snoozeUntil: number | null;
  /**
   * 是否有一条已弹出、尚未被用户处理的提醒。
   * 置位后 activeDuration 不再重复产生「到点」事件，改由升级策略负责催促；
   * 用户完成 / 跳过 / 离开电脑导致会话重置时清除。
   */
  awaitingAck: boolean;
  /** 升级策略进行到第几步；null 表示当前没有进行中的升级 */
  escalationStep: number | null;
  escalationStepStartedAt: number | null;
  /** 每日上限统计 */
  fireCountDayKey: string;
  fireCountToday: number;
  /** once 触发器专用 */
  consumed: boolean;
}

export interface TemplateVariables {
  /** 已连续活跃分钟数 */
  elapsed: number;
  /** 今日已触发次数 */
  count: number;
  /** 'HH:mm' */
  time: string;
}

export interface TriggerEvent {
  reminderId: string;
  reminder: Reminder;
  firedAt: number;
  kind: 'due' | 'escalation';
  escalationStep: number;
  variables: TemplateVariables;
}

export interface PlannedTrigger {
  reminderId: string;
  fireAt: number;
  variables: TemplateVariables;
}

/** 引擎恢复用的持久化状态，避免应用重启后久坐计时归零 */
export interface EngineSnapshot {
  activeSeconds: number;
  lastTickAt: number | null;
}

export interface EngineConfig {
  global: GlobalSettings;
  reminders: Reminder[];
}

export interface EngineOptions {
  clock: Clock;
  /**
   * 用函数而非对象：界面改完配置后引擎立刻读到最新值，无需重建引擎。
   */
  getConfig: () => EngineConfig;
  /** 工作日日历；不传表示「不按工作日限制」 */
  calendar?: WorkdayCalendar | null;
}
