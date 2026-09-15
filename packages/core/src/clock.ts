/**
 * 时间来源抽象。
 * 生产环境用 SystemClock，测试时注入 FakeClock 即可把 45 分钟压缩成毫秒级。
 */
export interface Clock {
  /** 当前时刻，epoch 毫秒 */
  now(): number;
  /** 当前时区，IANA 标识，例如 'Asia/Shanghai' */
  timeZone(): string;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
