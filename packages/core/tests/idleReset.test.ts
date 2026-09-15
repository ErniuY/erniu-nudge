import { describe, expect, it } from 'vitest';
import { FakeClock, T0 } from './fakeClock';
import { buildEngine, simulate, standUp } from './helpers';

describe('活跃时长计数的边界情况', () => {
  it('离开超过重置阈值后重新计时', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 40);
    simulate(engine, clock, 5, { userPresent: false }); // 离开 5 分钟 > 3 分钟阈值

    expect(simulate(engine, clock, 40)).toHaveLength(0);
    expect(simulate(engine, clock, 6)).toHaveLength(1);
  });

  it('短暂离开（未达重置阈值）不会清零', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 30);
    simulate(engine, clock, 2, { userPresent: false }); // 只离开 2 分钟

    // 累计活跃时长仍应在第 45 分钟触发
    expect(simulate(engine, clock, 16)).toHaveLength(1);
  });

  it('锁屏两小时后不会误报久坐', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 40);

    // 锁屏 / 休眠：时间大跨度跳跃
    clock.advanceSeconds(7200);
    engine.tick({ at: clock.now(), userPresent: false, suspended: true, fullscreen: false });

    clock.advanceSeconds(5);
    engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });

    expect(simulate(engine, clock, 30)).toHaveLength(0);
  });

  it('系统时间被向前调整不会灌入大量活跃时长', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 10);
    const before = engine.state().activeSeconds;

    clock.advanceSeconds(7200); // 手动把系统时间调快 2 小时
    engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });

    // 单次 tick 最多计入 tickSeconds * 4 秒
    expect(engine.state().activeSeconds - before).toBeLessThanOrEqual(20);
    expect(simulate(engine, clock, 20)).toHaveLength(0);
  });

  it('运行期快照可恢复，应用重启不会清空久坐计时', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);
    simulate(engine, clock, 30);

    const snapshot = engine.snapshot();
    expect(snapshot.activeSeconds).toBeGreaterThan(0);

    const restarted = buildEngine(clock, [standUp(45)]).engine;
    restarted.restore(snapshot);
    expect(restarted.state().activeSeconds).toBe(snapshot.activeSeconds);
  });
});
