import { describe, expect, it } from 'vitest';
import { FakeClock, T0 } from './fakeClock';
import { buildEngine, simulate, standUp, withoutEscalation } from './helpers';

describe('久坐提醒（activeDuration）', () => {
  it('连续活跃 44 分钟不触发，第 45 分钟后触发一次', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    expect(simulate(engine, clock, 44)).toHaveLength(0);

    const events = simulate(engine, clock, 2);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('due');
    expect(events[0].variables.elapsed).toBeGreaterThanOrEqual(45);
  });

  it('冷却期内不会重复产生「到点」提醒', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [withoutEscalation(standUp(45))]);

    const events = simulate(engine, clock, 60);
    expect(events.filter((e) => e.kind === 'due')).toHaveLength(1);
  });

  it('点击「完成」后重新计时', () => {
    const clock = new FakeClock(T0);
    const { engine, config } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 46);
    engine.acknowledge(config.reminders[0].id, 'done');

    expect(simulate(engine, clock, 30)).toHaveLength(0);
    expect(simulate(engine, clock, 16)).toHaveLength(1);
  });

  it('点击「稍后提醒」后按设定分钟数再响', () => {
    const clock = new FakeClock(T0);
    const { engine, config } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 46);
    engine.acknowledge(config.reminders[0].id, 'snooze', 5);

    expect(simulate(engine, clock, 4)).toHaveLength(0);
    expect(simulate(engine, clock, 2)).toHaveLength(1);
  });

  it('未响应时按模板设定的 3 / 8 分钟节奏逐级催促', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    const events = simulate(engine, clock, 60);

    expect(events.map((e) => e.kind)).toEqual(['due', 'escalation', 'escalation']);
    expect(events[1].escalationStep).toBe(1);
    expect(events[2].escalationStep).toBe(2);
    expect((events[1].firedAt - events[0].firedAt) / 60_000).toBe(3);
    expect((events[2].firedAt - events[0].firedAt) / 60_000).toBe(8);
  });

  it('达到每日上限后当天不再触发', () => {
    const clock = new FakeClock(T0);
    const reminder = standUp(1, { maxPerDay: 1, cooldownMinutes: 0 });
    reminder.escalation = {
      enabled: false,
      steps: [{ afterMinutes: 0, sound: 'none', autoCloseSeconds: 0, fullscreenMask: false }],
    };
    const { engine, config } = buildEngine(clock, [reminder]);

    const events = simulate(engine, clock, 5);
    expect(events.filter((e) => e.kind === 'due')).toHaveLength(1);

    // 用户起身后基准归位，但当天仍受每日上限约束
    engine.acknowledge(config.reminders[0].id, 'done');
    expect(simulate(engine, clock, 5).filter((e) => e.kind === 'due')).toHaveLength(0);
  });

  it('生效时间段之外不触发', () => {
    const clock = new FakeClock(Date.parse('2026-09-14T20:00:00+08:00'));
    const { engine } = buildEngine(clock, [
      standUp(45, {
        activeWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:00' },
      }),
    ]);

    expect(simulate(engine, clock, 60)).toHaveLength(0);
  });
});
