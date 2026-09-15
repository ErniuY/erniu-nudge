import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { nextWeeklyOccurrence, withinActiveWindow } from '../localTime';
import { baseVariables, inCooldown, overDailyLimit, snoozeGate } from './strategy';

export const weeklyStrategy: TriggerStrategy = {
  type: 'weekly',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'weekly') return { kind: 'none' };

    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (!withinActiveWindow(trigger.activeWindow, ctx.now, ctx.timeZone)) return { kind: 'none' };
    if (overDailyLimit(trigger.maxPerDay, ctx)) return { kind: 'none' };

    const from = Math.max(ctx.runtime.anchorAt - 1, ctx.runtime.lastFiredAt ?? 0);
    const windowMs = trigger.catchUpMinutes * 60_000;
    for (const entry of trigger.entries) {
      const t = nextWeeklyOccurrence(from, entry.day, entry.at, ctx.timeZone);
      if (ctx.now >= t && ctx.now - t <= windowMs) return { kind: 'fire' };
    }
    return { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'weekly') return [];
    const end = ctx.now + horizonMs;
    const out: number[] = [];

    for (const entry of trigger.entries) {
      let cursor = ctx.now;
      for (;;) {
        const t = nextWeeklyOccurrence(cursor, entry.day, entry.at, ctx.timeZone);
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
