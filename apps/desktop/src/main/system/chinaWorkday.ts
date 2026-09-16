import { zonedParts, type WorkdayCalendar } from '@app/core';

type Probe = (dateKey: string) => boolean | null;

// 不同版本的节假日库返回值形态不一样：有的是 boolean，有的是 { workday: boolean }
function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'workday' in value) {
    const inner = (value as { workday?: unknown }).workday;
    if (typeof inner === 'boolean') return inner;
  }
  return null;
}

function safeCall(fn: (input: never) => unknown, input: unknown): unknown {
  try {
    return fn(input as never);
  } catch {
    return undefined;
  }
}

// 各版本接受的入参也不同：有的要 'YYYY-MM-DD' 字符串，有的要 Date。
// 这里拿一个固定日期探一次，确认哪种能work，再固定下来。
function resolveProbe(module: unknown): Probe | null {
  const candidates: unknown[] = [module, (module as { default?: unknown } | null)?.default];

  for (const candidate of candidates) {
    if (!candidate) continue;

    let raw: ((input: never) => unknown) | null = null;
    if (typeof candidate === 'function') {
      raw = candidate as (input: never) => unknown;
    } else {
      const method = (candidate as { isWorkday?: unknown }).isWorkday;
      if (typeof method === 'function') {
        raw = (method as (input: never) => unknown).bind(candidate) as (input: never) => unknown;
      }
    }
    if (!raw) continue;

    if (toBoolean(safeCall(raw, '2024-01-01')) !== null) {
      return (dateKey) => toBoolean(safeCall(raw, dateKey));
    }
    if (toBoolean(safeCall(raw, new Date('2024-01-01T12:00:00+08:00'))) !== null) {
      return (dateKey) => toBoolean(safeCall(raw, new Date(`${dateKey}T12:00:00+08:00`)));
    }
  }
  return null;
}

function isMondayToFriday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * 中国工作日日历（含调休）。
 *
 * 节假日数据来自可选的 chinese-days 包，做成可选依赖的原因：
 * 1. 不装也不会让应用起不来，只是退回「周一到周五」；
 * 2. 这类库更新频繁（每年国务院公布次年安排），版本不匹配时不能拖着整个应用崩。
 *
 * 启用方式：pnpm --filter @app/desktop add chinese-days
 */
export class ChinaWorkdayCalendar implements WorkdayCalendar {
  private probe: Probe | null = null;
  private source: string | null = null;
  private readonly cache = new Map<string, boolean>();

  async load(): Promise<void> {
    try {
      // 用变量承载模块名，避免打包器在编译期解析这个可选依赖
      const moduleName = 'chinese-days';
      const module = await import(/* @vite-ignore */ moduleName);

      const probe = resolveProbe(module);
      if (!probe) {
        console.warn('[calendar] chinese-days 已安装但接口不匹配，退回「周一到周五」');
        return;
      }

      this.probe = probe;
      this.source = 'chinese-days（含调休）';
      console.info('[calendar] 已启用中国工作日日历：含法定假日与调休');
    } catch {
      console.info(
        '[calendar] 未安装 chinese-days，选「中国工作日」的提醒暂按「周一到周五」处理',
      );
    }
  }

  isWorkday(epochMs: number, timeZone: string): boolean | null {
    const parts = zonedParts(epochMs, timeZone);

    // 没有节假日数据：退回按星期判断，行为与改造前一致
    if (!this.probe) return isMondayToFriday(parts.weekday);

    const cached = this.cache.get(parts.dayKey);
    if (cached !== undefined) return cached;

    // 数据范围外的年份返回 null，这里同样退回按星期判断
    const value = this.probe(parts.dayKey) ?? isMondayToFriday(parts.weekday);
    this.cache.set(parts.dayKey, value);
    return value;
  }

  describe(): string | null {
    return this.source;
  }
}
