import type { Trigger } from '@app/schema';

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return '';
  if (sorted.length === 5 && sorted.every((day, index) => day === index + 1)) return '工作日';
  if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return '周末';
  return sorted.map((day) => WEEKDAY_LABEL[day]).join('/');
}

// 生效日期（calendar）和生效时间段（activeWindow）是两个独立维度，摘要里都要体现。
// 之前只看了 activeWindow，模板改成「七天全选 + 中国工作日门控」之后就错显示成「每天」。
function describeScope(trigger: Trigger): string {
  const calendar = trigger.calendar === 'china-workday' ? '中国工作日' : '';
  const window = trigger.activeWindow;
  if (!window) return calendar;

  return [calendar, describeDays(window.days), `${window.from}–${window.to}`]
    .filter((part) => part !== '')
    .join(' ');
}

/** 把触发器翻译成一句人话，列表里一眼能看懂 */
export function summarizeTrigger(trigger: Trigger): string {
  const main = (() => {
    switch (trigger.type) {
      case 'activeDuration':
        return `连续使用满 ${trigger.everyMinutes} 分钟`;
      case 'interval':
        return `每 ${trigger.everyMinutes} 分钟`;
      case 'dailyAt':
        return `每天 ${trigger.at.join('、')}`;
      case 'weekly':
        return `每周 ${trigger.entries
          .map((entry) => `${WEEKDAY_LABEL[entry.day]} ${entry.at}`)
          .join('、')}`;
      case 'pomodoro':
        return `专注 ${trigger.focusMinutes} 分钟 / 休息 ${trigger.breakMinutes} 分钟`;
      case 'once': {
        const date = new Date(trigger.at);
        const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        return `单次 · ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`;
      }
    }
  })();

  const scope = describeScope(trigger);
  return scope === '' ? main : `${main} · ${scope}`;
}
