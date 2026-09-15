import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { nextDailyOccurrence, withinActiveWindow } from '../localTime';
import { baseVariables, inCooldown, overDailyLimit, snoozeGate } from './strategy';

/**
 * 每天固定时刻（吃药、站会）。
 *
 * 两个关键点：
 * 1. 必须按本地墙上时间逐日推算，不能用固定毫秒相加，否则夏令时当天会漂移一小时。
 * 2. 过期是否补发由 trigger.catchUpMinutes 决定：默认 5 分钟只吸收 tick 抖动，
 *    吃药类提醒可设为 120，避免电脑在时间点处于睡眠状态而整天不提醒。
 */

export const dailyAtStrategy: TriggerStrategy = {
  type: 'dailyAt',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'dailyAt') return { kind: 'none' };

    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (!withinActiveWindow(trigger.activeWindow, ctx.now, ctx.timeZone)) return { kind: 'none' };
    if (overDailyLimit(trigger.maxPerDay, ctx)) return { kind: 'none' };

    // 从「上次触发之后」继续找下一次，保证跨天后仍能触发
    const from = Math.max(ctx.runtime.anchorAt - 1, ctx.runtime.lastFiredAt ?? 0);
    const windowMs = trigger.catchUpMinutes * 60_000;
    for (const hhmm of trigger.at) {
      const t = nextDailyOccurrence(from, hhmm, ctx.timeZone);
      if (ctx.now >= t && ctx.now - t <= windowMs) return { kind: 'fire' };
    }
    return { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'dailyAt') return [];
    const end = ctx.now + horizonMs;
    const out: number[] = [];

    for (const hhmm of trigger.at) {
      let cursor = ctx.now;
      // 每天最多几次，循环次数天然有界
      for (;;) {
        const t = nextDailyOccurrence(cursor, hhmm, ctx.timeZone);
        if (t > end) break;
        if (withinActiveWindow(trigger.activeWindow, t, ctx.timeZone)) out.push(t);
        cursor = t;
      }
    }
    return out;
  },

  onAcknowledge(runtime: ReminderRuntime, _trigger: Trigger, _ctx: TriggerContext): void {
    runtime.snoozeUntil = null;
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  },

  variables(_trigger: Trigger, ctx: TriggerContext): TemplateVariables {
    return baseVariables(ctx, 0);
  },
};
