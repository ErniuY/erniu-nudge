import { describe, expect, it } from 'vitest';
import { zonedParts } from '../src';
import { FakeClock } from './fakeClock';
import { buildEngine, dailyAt, simulate } from './helpers';

describe('每日定点提醒（dailyAt）', () => {
  it('按时触发，且第二天仍会触发', () => {
    const clock = new FakeClock(Date.parse('2026-09-14T08:00:00+08:00'));
    const { engine } = buildEngine(clock, [dailyAt(['09:00'])]);

    const events = simulate(engine, clock, 25 * 60); // 25 小时
    expect(events).toHaveLength(2);
    expect(events[0].firedAt).toBe(Date.parse('2026-09-14T09:00:00+08:00'));
    expect(events[1].firedAt).toBe(Date.parse('2026-09-15T09:00:00+08:00'));
  });

  it('补发窗口小：睡过时间点就整天不提醒', () => {
    const clock = new FakeClock(Date.parse('2026-09-14T08:00:00+08:00'));
    const { engine } = buildEngine(clock, [dailyAt(['09:00'], { catchUpMinutes: 5 })]);

    simulate(engine, clock, 55); // 08:55
    simulate(engine, clock, 20, { suspended: true }); // 锁屏到 09:15

    expect(simulate(engine, clock, 10)).toHaveLength(0);
  });

  it('补发窗口大：迟到也会提醒（吃药场景）', () => {
    const clock = new FakeClock(Date.parse('2026-09-14T08:00:00+08:00'));
    const { engine } = buildEngine(clock, [dailyAt(['09:00'], { catchUpMinutes: 120 })]);

    simulate(engine, clock, 55);
    simulate(engine, clock, 20, { suspended: true }); // 09:15 解锁

    const late = simulate(engine, clock, 1);
    expect(late).toHaveLength(1);
    expect(late[0].kind).toBe('due');
  });

  it('夏令时切换当天仍按本地 09:00 触发', () => {
    const tz = 'America/New_York';
    const clock = new FakeClock(Date.parse('2026-03-07T00:30:00-05:00'), tz);
    const { engine } = buildEngine(clock, [dailyAt(['09:00'], { catchUpMinutes: 180 })]);

    const planned = engine.plan(3 * 24 * 3600_000);
    expect(planned.length).toBeGreaterThanOrEqual(3);

    for (const item of planned) {
      const parts = zonedParts(item.fireAt, tz);
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(0);
    }

    const deltas = planned.slice(1).map((p, i) => p.fireAt - planned[i].fireAt);
    expect(deltas[0]).toBe(23 * 3600_000); // 3/7 09:00 EST → 3/8 09:00 EDT（少一小时）
    expect(deltas[1]).toBe(24 * 3600_000); // 3/8 → 3/9
  });
});
