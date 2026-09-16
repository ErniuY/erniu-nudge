import {
  standUpTemplate,
  zAppConfig,
  type ActiveDurationTrigger,
  type AppConfig,
  type GlobalSettings,
  type Reminder,
  type Trigger,
} from '@app/schema';
import { ReminderEngine } from '../src';
import type { TriggerEvent } from '../src';
import { FakeClock } from './fakeClock';

export function makeReminder(trigger: Trigger, overrides: Partial<Reminder> = {}): Reminder {
  const base = standUpTemplate();
  return { ...base, ...overrides, trigger };
}

/** 久坐类提醒的快捷构造：默认不受生效时间段限制，方便测试 */
export function standUp(
  everyMinutes: number,
  extras: Partial<ActiveDurationTrigger> = {},
): Reminder {
  return makeReminder({
    type: 'activeDuration',
    everyMinutes,
    cooldownMinutes: 10,
    maxPerDay: 10,
    activeWindow: undefined,
    catchUpMinutes: 5,
    calendar: 'all',
    ...extras,
  });
}

export function dailyAt(
  at: string[],
  extras: Partial<{
    catchUpMinutes: number;
    cooldownMinutes: number;
    maxPerDay: number;
    calendar: 'all' | 'china-workday';
  }> = {},
): Reminder {
  const reminder = makeReminder({
    type: 'dailyAt',
    at,
    cooldownMinutes: 0,
    activeWindow: undefined,
    catchUpMinutes: 5,
    calendar: 'all',
    ...extras,
  });
  return withoutEscalation(reminder);
}

export function interval(everyMinutes: number): Reminder {
  return withoutEscalation(makeReminder({
    type: 'interval',
    everyMinutes,
    cooldownMinutes: 5,
    activeWindow: undefined,
    catchUpMinutes: 5,
    calendar: 'all',
  }));
}

/** 关掉升级策略，便于测试「触发次数」本身 */
export function withoutEscalation(reminder: Reminder): Reminder {
  return {
    ...reminder,
    escalation: {
      enabled: false,
      steps: [{ afterMinutes: 0, sound: 'none', autoCloseSeconds: 0, fullscreenMask: false }],
    },
  };
}

export function buildConfig(
  reminders: Reminder[],
  globalOverrides: Record<string, unknown> = {},
): AppConfig {
  return zAppConfig.parse({
    schemaVersion: 1,
    deviceId: 'test-device',
    updatedAt: new Date().toISOString(),
    global: globalOverrides,
    reminders,
    assets: {},
  });
}

export interface BuildEngineResult {
  engine: ReminderEngine;
  config: AppConfig;
  global: GlobalSettings;
}

/** 建立引擎并完成一次「建立基准」的 tick */
export function buildEngine(
  clock: FakeClock,
  reminders: Reminder[],
  globalOverrides: Record<string, unknown> = {},
): BuildEngineResult {
  const config = buildConfig(reminders, globalOverrides);
  const engine = new ReminderEngine({ clock, getConfig: () => config });
  engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });
  return { engine, config, global: config.global };
}

export interface SimulateOptions {
  tickSec?: number;
  userPresent?: boolean;
  suspended?: boolean;
  fullscreen?: boolean;
}

/** 用假时钟把 minutes 压缩成秒级推进，返回期间所有触发事件 */
export function simulate(
  engine: ReminderEngine,
  clock: FakeClock,
  minutes: number,
  opts: SimulateOptions = {},
): TriggerEvent[] {
  const tickSec = opts.tickSec ?? 5;
  const steps = Math.round((minutes * 60) / tickSec);
  const events: TriggerEvent[] = [];

  for (let i = 0; i < steps; i++) {
    clock.advanceSeconds(tickSec);
    events.push(
      ...engine.tick({
        at: clock.now(),
        userPresent: opts.userPresent ?? true,
        suspended: opts.suspended ?? false,
        fullscreen: opts.fullscreen ?? false,
      }),
    );
  }
  return events;
}
