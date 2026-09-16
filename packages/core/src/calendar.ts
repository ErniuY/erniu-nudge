import type { CalendarKind } from '@app/schema';

/**
 * 工作日日历。
 *
 * 内核不认识任何具体的节假日数据源——它只认这个接口，由各平台注入实现：
 * 桌面端接 chinese-days（含调休），将来 iOS 端可以接别的数据源。
 * 这样「中国工作日」这种强地域性的东西就不会污染调度逻辑。
 */
export interface WorkdayCalendar {
  /** true = 工作日，false = 休息日，null = 该日期不在数据范围内、无法判断 */
  isWorkday(epochMs: number, timeZone: string): boolean | null;
  /** 给界面看的来源描述；null 表示没有可用的节假日数据 */
  describe(): string | null;
}

/**
 * 判断某个时刻是否落在指定日历上。
 * 与 activeWindow 是「同时满足」的关系：两个条件都通过才提醒。
 */
export function matchesCalendar(
  calendar: WorkdayCalendar | null,
  kind: CalendarKind | undefined,
  epochMs: number,
  timeZone: string,
): boolean {
  if (!kind || kind === 'all') return true;

  // 没有日历实现时不额外限制：宁可多提醒一次，也不要因为依赖缺失导致整天不提醒
  if (!calendar) return true;

  return calendar.isWorkday(epochMs, timeZone) ?? true;
}
