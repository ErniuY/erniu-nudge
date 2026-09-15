/**
 * 本地时间工具。用 Intl 实现，不引入任何日期库。
 *
 * 为什么不用「毫秒数相加」来做每日/每周定时：夏令时切换当天只有 23 小时或 25 小时，
 * 固定毫秒步进会让「每天 09:00」漂移成 08:00 或 10:00。必须按本地墙上时间逐日推算。
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = 周日 */
  weekday: number;
  /** '2026-09-14'，用于跨天重置判断 */
  dayKey: string;
  /** 0–1439 */
  minuteOfDay: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const raw: Partial<Record<string, string>> = {};
  for (const part of dtf.formatToParts(epochMs)) {
    if (part.type !== 'literal') raw[part.type] = part.value;
  }

  // hour12:false 在部分 ICU 版本下午夜会返回 '24'
  const hour = Number(raw.hour ?? '0') % 24;
  const year = raw.year ?? '1970';
  const month = raw.month ?? '01';
  const day = raw.day ?? '01';

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour,
    minute: Number(raw.minute ?? '0'),
    second: Number(raw.second ?? '0'),
    weekday: Math.max(0, WEEKDAYS.indexOf((raw.weekday ?? 'Sun') as (typeof WEEKDAYS)[number])),
    dayKey: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + Number(raw.minute ?? '0'),
  };
}

/** 该时刻在目标时区相对 UTC 的偏移（毫秒） */
export function offsetMsAt(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** 把「本地墙上时间」转成 epoch；两次校正可跨越夏令时切换点 */
export function localWallToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const pass1 = guess - offsetMsAt(guess, timeZone);
  return guess - offsetMsAt(pass1, timeZone);
}

/** afterMs 之后最近一次 hh:mm（本地时间） */
export function nextDailyOccurrence(afterMs: number, hhmm: string, timeZone: string): number {
  const [hh = 0, mm = 0] = hhmm.split(':').map(Number);
  const p = zonedParts(afterMs, timeZone);
  for (let add = 0; add <= 3; add++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const t = localWallToEpoch(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      hh,
      mm,
      timeZone,
    );
    if (t > afterMs) return t;
  }
  throw new Error(`nextDailyOccurrence 找不到 ${hhmm} 的下一次出现`);
}

/** afterMs 之后最近一次「每周某天 hh:mm」 */
export function nextWeeklyOccurrence(
  afterMs: number,
  weekday: number,
  hhmm: string,
  timeZone: string,
): number {
  const [hh = 0, mm = 0] = hhmm.split(':').map(Number);
  const p = zonedParts(afterMs, timeZone);
  for (let add = 0; add <= 8; add++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const t = localWallToEpoch(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      hh,
      mm,
      timeZone,
    );
    if (zonedParts(t, timeZone).weekday !== weekday) continue;
    if (t > afterMs) return t;
  }
  throw new Error(`nextWeeklyOccurrence 找不到 星期${weekday} ${hhmm} 的下一次出现`);
}

/** 是否落在生效时间段内；支持跨午夜（from > to） */
export function withinActiveWindow(
  win: { days: number[]; from: string; to: string } | undefined,
  epochMs: number,
  timeZone: string,
): boolean {
  if (!win) return true;
  const p = zonedParts(epochMs, timeZone);
  const [fH = 0, fM = 0] = win.from.split(':').map(Number);
  const [tH = 0, tM = 0] = win.to.split(':').map(Number);
  const from = fH * 60 + fM;
  const to = tH * 60 + tM;

  if (from <= to) {
    return win.days.includes(p.weekday) && p.minuteOfDay >= from && p.minuteOfDay < to;
  }
  // 跨午夜：22:00–06:00 时，22:00 之后算起始日，06:00 之前归属前一天
  if (p.minuteOfDay >= from) return win.days.includes(p.weekday);
  if (p.minuteOfDay < to) return win.days.includes((p.weekday + 6) % 7);
  return false;
}

/** 格式化为 'HH:mm'（本地时间） */
export function formatClockTime(epochMs: number, timeZone: string): string {
  const p = zonedParts(epochMs, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
