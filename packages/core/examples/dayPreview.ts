/**
 * 一天的提醒预览。
 *
 * 这个脚本展示内核的「计划模式」plan()：提前算出未来 24 小时会提醒几次、分别在什么时候。
 * 桌面端用它做「今日待提醒预览」，将来 iOS 端用同一份输出排本地通知。
 *
 * 运行：pnpm --filter @app/core preview
 */
import {
  defaultGlobalSettings,
  drinkWaterTemplate,
  medicationTemplate,
  standUpTemplate,
} from '@app/schema';
import { ReminderEngine, SystemClock } from '../src';
import type { Reminder } from '@app/schema';

const clock = new SystemClock();
const reminders: Reminder[] = [standUpTemplate(), drinkWaterTemplate(), medicationTemplate()];

const engine = new ReminderEngine({
  clock,
  getConfig: () => ({ global: defaultGlobalSettings(), reminders }),
});

const HORIZON_MS = 24 * 3600_000;
const planned = engine.plan(HORIZON_MS);

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: clock.timeZone(),
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: clock.timeZone(),
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

const nameOf = new Map(reminders.map((r) => [r.id, r.name]));

console.log(`时区：${clock.timeZone()}   预览窗口：未来 24 小时\n`);

if (planned.length === 0) {
  console.log('未来 24 小时没有安排提醒。');
  console.log('（久坐与喝水模板只在工作日 09:00–18:00 生效，周末自然为空。）');
} else {
  for (const item of planned) {
    const name = nameOf.get(item.reminderId) ?? item.reminderId;
    console.log(
      `${dayFormatter.format(item.fireAt)}  ${timeFormatter.format(item.fireAt)}   ${name}`,
    );
  }
  console.log(`\n共 ${planned.length} 次提醒。`);
}

console.log('\n当前状态：', JSON.stringify(engine.state()));
