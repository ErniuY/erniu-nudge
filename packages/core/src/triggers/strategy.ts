import type { GlobalSettings, Reminder, Trigger } from '@app/schema';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { formatClockTime } from '../localTime';

export interface TriggerContext {
  now: number;
  timeZone: string;
  /** 全局连续活跃秒数：所有 activeDuration 类提醒共用这一个时钟 */
  activeSeconds: number;
  runtime: ReminderRuntime;
  settings: GlobalSettings;
}

export type TriggerDecision = { kind: 'fire' } | { kind: 'none' };

/**
 * 触发器策略：内核的扩展点。
 * 新增一种提醒类型 = 新增一个文件 + 在 registry 注册，引擎代码不用改。
 *
 * trigger 参数统一收 Trigger 联合类型，由各实现内部用判别字段收窄，
 * 这样 registry 可以用 Record<Trigger['type'], TriggerStrategy> 保证「无遗漏注册」。
 */
export interface TriggerStrategy {
  readonly type: Trigger['type'];

  /** 实时模式：当前是否应当触发 */
  decide(reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision;

  /** 计划模式：未来 horizonMs 内的触发时刻列表（iOS 端排本地通知用） */
  plan(reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[];

  /** 用户点击「完成 / 稍后」后如何重置基准 */
  onAcknowledge(runtime: ReminderRuntime, trigger: Trigger, ctx: TriggerContext): void;

  /** 生成弹窗文案变量 */
  variables(trigger: Trigger, ctx: TriggerContext): TemplateVariables;
}

/**
 * 「稍后提醒」闸门，所有触发器共用。
 * - 尚未到点：什么都不做
 * - 已到点：触发一次（引擎随后会清掉 snoozeUntil，避免每个 tick 都响）
 * - 未设置：返回 null，交给各自的逻辑判断
 */
export function snoozeGate(ctx: TriggerContext): TriggerDecision | null {
  const until = ctx.runtime.snoozeUntil;
  if (until === null) return null;
  return ctx.now < until ? { kind: 'none' } : { kind: 'fire' };
}

/** 冷却期闸门：刚提醒过，短时间内不再打扰 */
export function inCooldown(ctx: TriggerContext): boolean {
  return ctx.now < ctx.runtime.nextEarliestAt;
}

export function overDailyLimit(max: number | undefined, ctx: TriggerContext): boolean {
  return max !== undefined && ctx.runtime.fireCountToday >= max;
}

export function baseVariables(ctx: TriggerContext, elapsed: number): TemplateVariables {
  return {
    elapsed,
    count: ctx.runtime.fireCountToday,
    time: formatClockTime(ctx.now, ctx.timeZone),
  };
}
