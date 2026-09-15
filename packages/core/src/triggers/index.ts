import type { Trigger } from '@app/schema';
import type { TriggerStrategy } from './strategy';
import { activeDurationStrategy } from './activeDuration';
import { intervalStrategy } from './interval';
import { dailyAtStrategy } from './dailyAt';
import { weeklyStrategy } from './weekly';
import { pomodoroStrategy } from './pomodoro';
import { onceStrategy } from './once';

/**
 * Record<Trigger['type'], TriggerStrategy> 是刻意的：
 * 将来在 schema 里新增一种触发器类型，这里会因为缺少键而编译报错，不会静默漏注册。
 */
const REGISTRY: Record<Trigger['type'], TriggerStrategy> = {
  activeDuration: activeDurationStrategy,
  interval: intervalStrategy,
  dailyAt: dailyAtStrategy,
  weekly: weeklyStrategy,
  pomodoro: pomodoroStrategy,
  once: onceStrategy,
};

export function strategyFor(type: Trigger['type']): TriggerStrategy {
  return REGISTRY[type];
}

export { activeDurationStrategy, intervalStrategy, dailyAtStrategy, weeklyStrategy, pomodoroStrategy, onceStrategy };
export type { TriggerStrategy, TriggerContext, TriggerDecision } from './strategy';
export { baseVariables, inCooldown, overDailyLimit, snoozeGate } from './strategy';
