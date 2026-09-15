import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { baseVariables, inCooldown, snoozeGate } from './strategy';

/** 单次提醒：到点触发一次后即消费，不再重复 */
export const onceStrategy: TriggerStrategy = {
  type: 'once',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'once') return { kind: 'none' };
    // 先处理「稍后提醒」：单次提醒触发后即被消费，用户点稍后仍应再响一次
    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (ctx.runtime.consumed) return { kind: 'none' };

    const at = Date.parse(trigger.at);
    return Number.isFinite(at) && ctx.now >= at ? { kind: 'fire' } : { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'once') return [];
    if (ctx.runtime.consumed) return [];
    const at = Date.parse(trigger.at);
    if (!Number.isFinite(at)) return [];
    return at > ctx.now && at <= ctx.now + horizonMs ? [at] : [];
  },

  onAcknowledge(runtime: ReminderRuntime, _trigger: Trigger, _ctx: TriggerContext): void {
    runtime.consumed = true;
    runtime.snoozeUntil = null;
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  },

  variables(_trigger: Trigger, ctx: TriggerContext): TemplateVariables {
    return baseVariables(ctx, 0);
  },
};
