import { describe, expect, it } from 'vitest';
import { FakeClock, T0 } from './fakeClock';
import { buildEngine, dailyAt, interval, simulate, standUp } from './helpers';

/**
 * 路线 A 的关键保险：桌面端 tick() 的触发时刻必须与 iOS 端 plan() 的预测一致。
 * 没有这组测试，iOS 端上线后通知时间会莫名其妙对不上，且极难定位。
 */
describe('plan() 与 tick() 的一致性', () => {
  it('activeDuration：预测的起身时刻 = 实际触发时刻', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    const planned = engine.plan(12 * 3600_000);
    expect(planned.length).toBeGreaterThan(1); // 假设每次都会起身，因此是一串而不是单点
    const predictedMin = (planned[0].fireAt - T0) / 60_000;

    const events = simulate(engine, clock, 46);
    expect(events).toHaveLength(1);
    const actualMin = (events[0].firedAt - T0) / 60_000;

    expect(predictedMin).toBeCloseTo(45, 5);
    expect(Math.abs(predictedMin - actualMin)).toBeLessThanOrEqual(0.5);
  });

  it('interval：预测序列与首次实际触发一致', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [interval(30)]);

    const planned = engine.plan(3600_000);
    expect(planned.length).toBeGreaterThanOrEqual(2);

    const events = simulate(engine, clock, 31);
    expect(events).toHaveLength(1);
    expect(Math.abs(planned[0].fireAt - events[0].firedAt)).toBeLessThanOrEqual(1000);
  });

  it('dailyAt：预测时刻与触发时刻完全一致', () => {
    const clock = new FakeClock(Date.parse('2026-09-14T08:00:00+08:00'));
    const { engine } = buildEngine(clock, [dailyAt(['09:00'])]);

    const expected = Date.parse('2026-09-14T09:00:00+08:00');
    const planned = engine.plan(12 * 3600_000);
    expect(planned).toHaveLength(1);
    expect(planned[0].fireAt).toBe(expected);

    const events = simulate(engine, clock, 61);
    expect(events).toHaveLength(1);
    expect(events[0].firedAt).toBe(expected);
  });

  it('plan() 结果按时间升序排列', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45), interval(30), dailyAt(['14:00'])]);

    const planned = engine.plan(24 * 3600_000);
    const times = planned.map((p) => p.fireAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
