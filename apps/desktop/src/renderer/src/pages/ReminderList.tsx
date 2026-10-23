import type { Reminder } from '@app/schema';
import type { EngineStatus } from '../../../shared/types';
import { BuiltinIcon } from '../builtinIcons';
import { formatClock } from '../format';
import { summarizeTrigger } from '../triggerSummary';

function ReminderIcon({
  reminder,
  assetUrls,
}: {
  reminder: Reminder;
  assetUrls: Record<string, string>;
}) {
  if (reminder.icon.startsWith('builtin:')) {
    return (
      <BuiltinIcon
        name={reminder.icon.slice('builtin:'.length)}
        size={18}
        color={reminder.iconColor}
      />
    );
  }
  const url = assetUrls[reminder.icon];
  if (!url) return <BuiltinIcon name="clock" size={18} color={reminder.iconColor} />;
  return <img src={url} alt="" width={18} height={18} />;
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
  const nameOf = (id: string) =>
    reminders.find((item) => item.id === id)?.name ?? '已删除';

  return (
    <section className="rem-block">
      <div className="section-head">
        <span className="kicker">提醒项 · {reminders.length}</span>
        <button type="button" className="text-btn" onClick={onCreate}>
          ＋ 新建提醒
        </button>
      </div>

      {reminders.length === 0 ? (
        <div className="empty">还没有提醒，先新建一条吧。</div>
      ) : (
        <div className="rem-list">
          {reminders.map((reminder, index) => (
            <div
              key={reminder.id}
              className={`rem-row${reminder.enabled ? '' : ' off'}`}
            >
              <span className="rem-idx">{String(index + 1).padStart(2, '0')}</span>
              <span className="rem-icon">
                <ReminderIcon reminder={reminder} assetUrls={assetUrls} />
              </span>
              <div className="rem-body">
                <div className="rem-name">{reminder.name}</div>
                <div className="rem-desc">{summarizeTrigger(reminder.trigger)}</div>
              </div>
              <div className="rem-controls">
                <button
                  type="button"
                  className={`rem-state${reminder.enabled ? ' on' : ''}`}
                  onClick={() => onToggle(reminder)}
                >
                  {reminder.enabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className="rem-action"
                  onClick={() => onEdit(reminder)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="rem-action danger"
                  onClick={() => onDelete(reminder.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head upcoming-head">
        <span className="kicker">接下来 24 小时</span>
      </div>
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
        <p className="muted small">未来 24 小时没有安排。</p>
      )}
    </section>
  );
}
