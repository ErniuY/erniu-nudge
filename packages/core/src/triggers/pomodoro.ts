import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { withinActiveWindow } from '../localTime';
import { baseVariables, inCooldown, snoozeGate } from './strategy';

/**
 * 番茄钟：专注 focusMinutes 后提醒休息 breakMinutes。
 * 确认休息后基准前进一个完整周期（而不是从「现在」重算），保证节奏不漂移。
 */
export const pomodoroStrategy: TriggerStrategy = {
  type: 'pomodoro',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'pomodoro') return { kind: 'none' };

    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (!withinActiveWindow(trigger.activeWindow, ctx.now, ctx.timeZone)) return { kind: 'none' };

    const focusMs = trigger.focusMinutes * 60_000;
    return ctx.now - ctx.runtime.anchorAt >= focusMs ? { kind: 'fire' } : { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'pomodoro') return [];
    const focusMs = trigger.focusMinutes * 60_000;
    const cycleMs = (trigger.focusMinutes + trigger.breakMinutes) * 60_000;
    const end = ctx.now + horizonMs;
    const out: number[] = [];

    let t = ctx.runtime.anchorAt + focusMs;
    while (t <= end) {
      if (t > ctx.now && withinActiveWindow(trigger.activeWindow, t, ctx.timeZone)) out.push(t);
      t += cycleMs;
    }
    return out;
  },

  onAcknowledge(runtime: ReminderRuntime, trigger: Trigger, ctx: TriggerContext): void {
    if (trigger.type === 'pomodoro') {
      const cycleMs = (trigger.focusMinutes + trigger.breakMinutes) * 60_000;
      const nextCycle = runtime.anchorAt + cycleMs;
      runtime.anchorAt = nextCycle > ctx.now ? nextCycle : ctx.now;
    }
    runtime.snoozeUntil = null;
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  },

  variables(_trigger: Trigger, ctx: TriggerContext): TemplateVariables {
    return baseVariables(ctx, Math.floor((ctx.now - ctx.runtime.anchorAt) / 60_000));
  },
};
