import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { withinActiveWindow } from '../localTime';
import { baseVariables, inCooldown, overDailyLimit, snoozeGate } from './strategy';

/**
 * 固定间隔触发（喝水、护眼）。
 * 用真实时间推进，与用户是否在场无关——喝水提醒不该因为你离开 10 分钟就推迟。
 */
export const intervalStrategy: TriggerStrategy = {
  type: 'interval',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'interval') return { kind: 'none' };

    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (!withinActiveWindow(trigger.activeWindow, ctx.now, ctx.timeZone)) return { kind: 'none' };
    if (overDailyLimit(trigger.maxPerDay, ctx)) return { kind: 'none' };

    const periodMs = trigger.everyMinutes * 60_000;
    return ctx.now - ctx.runtime.anchorAt >= periodMs ? { kind: 'fire' } : { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'interval') return [];
    const periodMs = trigger.everyMinutes * 60_000;
    const end = ctx.now + horizonMs;
    const out: number[] = [];

    let t = ctx.runtime.anchorAt + periodMs;
    while (t <= end) {
      if (t > ctx.now && withinActiveWindow(trigger.activeWindow, t, ctx.timeZone)) out.push(t);
      t += periodMs;
    }
    return out;
  },

  onAcknowledge(runtime: ReminderRuntime, _trigger: Trigger, ctx: TriggerContext): void {
    // 从「现在」重新起算，而不是沿用旧基准，避免一次补齐一串提醒
    runtime.anchorAt = ctx.now;
    runtime.snoozeUntil = null;
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  },

  variables(_trigger: Trigger, ctx: TriggerContext): TemplateVariables {
    return baseVariables(ctx, Math.floor((ctx.now - ctx.runtime.anchorAt) / 60_000));
  },
};
