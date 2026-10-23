import { describe, expect, it } from 'vitest';
import { FakeClock, T0 } from './fakeClock';
import { buildEngine, simulate, standUp } from './helpers';

describe('活跃时长计数的边界情况', () => {
  it('离开满重置阈值（默认 10 分钟）后重新计时', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 40);
    simulate(engine, clock, 11, { userPresent: false }); // 离开 11 分钟 > 10 分钟阈值

    expect(simulate(engine, clock, 40)).toHaveLength(0);
    expect(simulate(engine, clock, 6)).toHaveLength(1);
  });

  it('离开 9 分钟不足 10 分钟：不清零，且离开时长被记录', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 30);
    simulate(engine, clock, 9, { userPresent: false });

    const state = engine.state();
    // 这 9 分钟没有被计入活跃时长（离开不该算「坐着用电脑」）
    expect(state.activeSeconds).toBeGreaterThanOrEqual(1790);
    // 但确实被记录下来，且没有触发清零
    expect(state.idleSeconds).toBeGreaterThanOrEqual(540);

    // 回来后继续累计，第 45 个活跃分钟触发
    expect(simulate(engine, clock, 15)).toHaveLength(1);
  });

  it('锁屏事件会直接清零', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 40);
    clock.advanceSeconds(5);
    engine.tick({ at: clock.now(), userPresent: false, suspended: true, fullscreen: false });

    expect(engine.state().activeSeconds).toBe(0);
  });

  it('休眠唤醒（tick 间隔异常）立即清零', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 40);

    // 机器睡眠 2 小时后唤醒，第一次 tick 的间隔会远超 tickSeconds × 4
    clock.advanceSeconds(7200);
    engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });

    expect(engine.state().activeSeconds).toBe(0);
    expect(simulate(engine, clock, 30)).toHaveLength(0);
  });

  it('系统时间被大幅调整也不会灌入活跃时长', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 10);
    clock.advanceSeconds(7200); // 手动把系统时间调快 2 小时
    engine.tick({ at: clock.now(), userPresent: true, suspended: false, fullscreen: false });

    expect(engine.state().activeSeconds).toBe(0);
    expect(simulate(engine, clock, 20)).toHaveLength(0);
  });

  it('快照同时保留活跃时长与离开时长', () => {
    const clock = new FakeClock(T0);
    const { engine } = buildEngine(clock, [standUp(45)]);

    simulate(engine, clock, 30);
    simulate(engine, clock, 5, { userPresent: false });

    const snapshot = engine.snapshot();
    expect(snapshot.activeSeconds).toBeGreaterThan(0);
    expect(snapshot.idleSeconds).toBeGreaterThan(0);

    const restarted = buildEngine(clock, [standUp(45)]).engine;
    restarted.restore(snapshot);
    expect(restarted.state().activeSeconds).toBe(snapshot.activeSeconds);
    expect(restarted.state().idleSeconds).toBe(snapshot.idleSeconds);
  });
});
