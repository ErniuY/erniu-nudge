import type { Reminder } from '@app/schema';
import type { EngineStatus } from '../../../shared/types';
import { BuiltinIcon } from '../builtinIcons';
import { formatClock } from '../format';
import { summarizeTrigger } from '../triggerSummary';

function ReminderIcon({ reminder, assetUrls }: { reminder: Reminder; assetUrls: Record<string, string> }) {
  if (reminder.icon.startsWith('builtin:')) {
    return <BuiltinIcon name={reminder.icon.slice('builtin:'.length)} size={24} color={reminder.iconColor} />;
  }
  const url = assetUrls[reminder.icon];
  if (!url) return <BuiltinIcon name="clock" size={24} color={reminder.iconColor} />;
  return <img src={url} alt="" width={24} height={24} />;
}

export default function ReminderList({
  reminders,
  assetUrls,
  status,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}: {
  reminders: Reminder[];
  assetUrls: Record<string, string>;
  status: EngineStatus | null;
  onCreate: () => void;
  onEdit: (reminder: Reminder) => void;
  onToggle: (reminder: Reminder) => void;
  onDelete: (id: string) => void;
}) {
  const nameOf = (id: string) => reminders.find((item) => item.id === id)?.name ?? '已删除';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>提醒</h1>
          <p className="muted">久坐只是其中一条。任何提醒都可以自己配置触发器、图标和提醒方式。</p>
        </div>
        <button type="button" className="btn primary" onClick={onCreate}>
          ＋ 新建提醒
        </button>
      </header>

      {reminders.length === 0 ? (
        <div className="empty">还没有提醒，点右上角新建一条。</div>
      ) : (
        <ul className="reminder-list">
          {reminders.map((reminder) => (
            <li key={reminder.id} className={`reminder${reminder.enabled ? '' : ' off'}`}>
              <span className="reminder-icon" style={{ background: `${reminder.iconColor}1f` }}>
                <ReminderIcon reminder={reminder} assetUrls={assetUrls} />
              </span>

              <div className="reminder-main">
                <div className="reminder-name">{reminder.name}</div>
                <div className="reminder-meta">{summarizeTrigger(reminder.trigger)}</div>
              </div>

              <label className="switch" title="启用 / 停用">
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  onChange={() => onToggle(reminder)}
                />
                <span />
              </label>

              <button type="button" className="btn ghost" onClick={() => onEdit(reminder)}>
                编辑
              </button>
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => onDelete(reminder.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="panel">
        <h2>接下来 24 小时</h2>
        {status && status.upcoming.length > 0 ? (
          <ul className="upcoming">
            {status.upcoming.map((item, index) => (
              <li key={`${item.reminderId}-${item.fireAt}-${index}`}>
                <span className="upcoming-time">{formatClock(item.fireAt)}</span>
                <span className="upcoming-name">{nameOf(item.reminderId)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">未来 24 小时没有安排。</p>
        )}
        <p className="muted small">
          这份预览用的是内核的 plan()，与将来 iOS 端预排本地通知是同一套计算——桌面端看到几次，手机上就是几次。
        </p>
      </section>
    </div>
  );
}
