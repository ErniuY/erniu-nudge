import type { Reminder, Trigger } from '@app/schema';
import type { TriggerContext, TriggerDecision, TriggerStrategy } from './strategy';
import type { ReminderRuntime, TemplateVariables } from '../types';
import { withinActiveWindow } from '../localTime';
import { baseVariables, inCooldown, overDailyLimit, snoozeGate } from './strategy';

/**
 * 久坐提醒的核心：按「有效连续活跃时长」计时，而不是真实时间流逝。
 *
 * 判据是 activeSeconds - ackedActiveSeconds >= everyMinutes * 60，
 * 其中 activeSeconds 由引擎维护，用户离开、锁屏、休眠时会被清零。
 */
export const activeDurationStrategy: TriggerStrategy = {
  type: 'activeDuration',

  decide(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext): TriggerDecision {
    if (trigger.type !== 'activeDuration') return { kind: 'none' };

    const snooze = snoozeGate(ctx);
    if (snooze) return snooze;
    if (inCooldown(ctx)) return { kind: 'none' };
    if (!withinActiveWindow(trigger.activeWindow, ctx.now, ctx.timeZone)) return { kind: 'none' };
    if (overDailyLimit(trigger.maxPerDay, ctx)) return { kind: 'none' };

    // 已经提醒过一次、用户还没处理时不再重复「到点」，由升级策略负责催促
    if (ctx.runtime.awaitingAck) return { kind: 'none' };

    const elapsed = ctx.activeSeconds - ctx.runtime.ackedActiveSeconds;
    return elapsed >= trigger.everyMinutes * 60 ? { kind: 'fire' } : { kind: 'none' };
  },

  plan(_reminder: Reminder, trigger: Trigger, ctx: TriggerContext, horizonMs: number): number[] {
    if (trigger.type !== 'activeDuration') return [];

    // 预测假设：用户持续在场，且每次提醒后都会起身（基准归位）。
    // 因此这是一个「先等 remaining，再每 everyMinutes 一次」的序列，而不是单点。
    // 这条很关键：iOS 端只能靠预排本地通知，若只排一次，用户不打开 App 就再也收不到久坐提醒。
    const remainingSeconds = Math.max(
      0,
      trigger.everyMinutes * 60 - (ctx.activeSeconds - ctx.runtime.ackedActiveSeconds),
    );
    const periodMs = trigger.everyMinutes * 60_000;
    const end = ctx.now + horizonMs;
    const out: number[] = [];

    let t = ctx.now + remainingSeconds * 1000;
    while (t <= end) {
      if (withinActiveWindow(trigger.activeWindow, t, ctx.timeZone)) out.push(t);
      t += periodMs;
    }
    return out;
  },

  onAcknowledge(runtime: ReminderRuntime, _trigger: Trigger, ctx: TriggerContext): void {
    runtime.ackedActiveSeconds = ctx.activeSeconds; // 起身 → 基准归位
    runtime.awaitingAck = false;
    runtime.snoozeUntil = null;
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  },

  variables(trigger: Trigger, ctx: TriggerContext): TemplateVariables {
    if (trigger.type !== 'activeDuration') return baseVariables(ctx, 0);
    const elapsed = Math.floor((ctx.activeSeconds - ctx.runtime.ackedActiveSeconds) / 60);
    return baseVariables(ctx, elapsed);
  },
};
