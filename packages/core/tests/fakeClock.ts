import type { Clock } from '../src/clock';

/** 2026-09-14 09:00 (+08:00) —— 一个普通工作日的上午 */
export const T0 = Date.parse('2026-09-14T09:00:00+08:00');

export class FakeClock implements Clock {
  constructor(
    public t: number = T0,
    private readonly tz: string = 'Asia/Shanghai',
  ) {}

  now(): number {
    return this.t;
  }

  timeZone(): string {
    return this.tz;
  }

  advanceSeconds(seconds: number): void {
    this.t += seconds * 1000;
  }

  advanceMinutes(minutes: number): void {
    this.advanceSeconds(minutes * 60);
  }
}
