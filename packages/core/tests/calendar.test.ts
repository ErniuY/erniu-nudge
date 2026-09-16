import { describe, expect, it } from 'vitest';
import { ReminderEngine, zonedParts, type WorkdayCalendar } from '../src';
import { FakeClock } from './fakeClock';
import { buildConfig, simulate, standUp } from './helpers';

const TZ = 'Asia/Shanghai';

/** 可控的假日历：只有列出来的日期算工作日，用来模拟调休与法定假日 */
function calendarFrom(workdays: string[]): WorkdayCalendar {
  const set = new Set(workdays);
  return {
    isWorkday: (epochMs, timeZone) => set.has(zonedParts(epochMs, timeZone).dayKey),
    describe: () => '测试日历',
  };
}

function build(clock: FakeClock, workdays: string[], calendar: 'all' | 'china-workday') {
  const reminder = standUp(45, { calendar });
  const config = buildConfig([reminder]);
  const engine = new ReminderEngine({
    clock,
    getConfig: () => config,
    calendar: calendarFrom(workdays),
  });
  engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });
  return { engine, config };
}

describe('生效日期（工作日日历）', () => {
  it('调休的周六照常提醒', () => {
    // 2026-09-19 是周六，但在日历里被标记为工作日
    const clock = new FakeClock(Date.parse('2026-09-19T09:00:00+08:00'), TZ);
    const { engine } = build(clock, ['2026-09-19'], 'china-workday');

    expect(simulate(engine, clock, 46)).toHaveLength(1);
  });

  it('放假的周一不提醒', () => {
    // 2026-09-14 是周一，但在日历里被标记为休息日
    const clock = new FakeClock(Date.parse('2026-09-14T09:00:00+08:00'), TZ);
    const { engine } = build(clock, [], 'china-workday');

    expect(simulate(engine, clock, 60)).toHaveLength(0);
  });

  it('生效日期设为「每天」时不受日历限制', () => {
    const clock = new FakeClock(Date.parse('2026-09-19T09:00:00+08:00'), TZ);
    const { engine } = build(clock, [], 'all');

    expect(simulate(engine, clock, 46)).toHaveLength(1);
  });

  it('plan() 也会跳过休息日', () => {
    const clock = new FakeClock(Date.parse('2026-09-19T09:00:00+08:00'), TZ);
    const { engine } = build(clock, [], 'china-workday');

    expect(engine.plan(24 * 3600_000)).toHaveLength(0);
  });
});
