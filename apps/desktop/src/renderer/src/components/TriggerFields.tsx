import type { Trigger } from '@app/schema';
import DraftInput from './DraftInput';

const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// 空字符串直接忽略：否则用户想清空重填时，字段会被立刻填回一个默认值
function commitNumber(
  raw: string,
  min: number,
  max: number,
  apply: (value: number) => void,
): void {
  if (raw.trim() === '') return;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min && value <= max) apply(value);
}

function parseTimeList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => TIME_RE.test(item));
}

function unparsedTimeFragments(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '' && !TIME_RE.test(item));
}

type ActiveWindowValue = NonNullable<Trigger['activeWindow']>;

const DEFAULT_WINDOW: ActiveWindowValue = {
  days: [0, 1, 2, 3, 4, 5, 6],
  from: '09:00',
  to: '18:30',
};

// 一天都不选的话 schema 会校验失败，所以「取消最后一天」这个操作直接忽略
function toggleDay(days: number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day];
  if (next.length === 0) return days;
  return next.sort((a, b) => a - b);
}

// 生效时间段编辑器。
// 语义是「只在这个时间段内允许弹提醒」，不是「从这个时刻开始计时」——
// 活跃时长始终在累加，这里只决定允不允许打扰。
function ActiveWindowEditor({
  value,
  onChange,
}: {
  value: ActiveWindowValue | undefined;
  onChange: (value: ActiveWindowValue | undefined) => void;
}) {
  const enabled = value !== undefined;
  const current = value ?? DEFAULT_WINDOW;

  return (
    <div className="field">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? DEFAULT_WINDOW : undefined)}
        />
        <span>只在指定时间段内提醒</span>
      </label>

      {enabled && (
        <>
          <div className="inline-row">
            <input
              type="time"
              value={current.from}
              onChange={(event) => onChange({ ...current, from: event.target.value })}
            />
            <span className="field-hint">到</span>
            <input
              type="time"
              value={current.to}
              onChange={(event) => onChange({ ...current, to: event.target.value })}
            />
          </div>

          <div className="inline-row wrap day-row">
            {WEEKDAY_LABEL.map((label, day) => (
              <button
                key={day}
                type="button"
                className={`day-chip${current.days.includes(day) ? ' on' : ''}`}
                onClick={() => onChange({ ...current, days: toggleDay(current.days, day) })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="btn ghost"
              onClick={() => onChange({ ...current, days: [0, 1, 2, 3, 4, 5, 6] })}
            >
              全选
            </button>
          </div>

          <span className="field-hint">
            至少保留一个星期。结束时间早于开始时间表示跨午夜，例如 22:00 → 06:00。
            注意这是「允许打扰」的时间段，久坐时长本身全天都在累加。
          </span>
        </>
      )}
    </div>
  );
}

function defaultsFor(type: Trigger['type']): Trigger {
  switch (type) {
    case 'activeDuration':
      return { type, everyMinutes: 45, cooldownMinutes: 10, catchUpMinutes: 5, calendar: 'all' };
    case 'interval':
      return { type, everyMinutes: 40, cooldownMinutes: 5, catchUpMinutes: 5, calendar: 'all' };
    case 'dailyAt':
      return { type, at: ['09:00'], cooldownMinutes: 0, catchUpMinutes: 120, calendar: 'all' };
    case 'weekly':
      return {
        type,
        entries: [{ day: 1, at: '10:00' }],
        cooldownMinutes: 0,
        catchUpMinutes: 120,
        calendar: 'all',
      };
    case 'pomodoro':
      return {
        type,
        focusMinutes: 25,
        breakMinutes: 5,
        cooldownMinutes: 5,
        catchUpMinutes: 5,
        calendar: 'all',
      };
    case 'once':
      return {
        type,
        at: new Date(Date.now() + 3600_000).toISOString(),
        cooldownMinutes: 0,
        catchUpMinutes: 0,
        calendar: 'all',
      };
  }
}

export default function TriggerFields({
  trigger,
  onChange,
}: {
  trigger: Trigger;
  onChange: (trigger: Trigger) => void;
}) {
  const patch = (partial: Record<string, unknown>) =>
    onChange({ ...trigger, ...partial } as Trigger);

  return (
    <>
      <label className="field">
        <span className="field-label">触发方式</span>
        <select
          value={trigger.type}
          onChange={(event) => {
            // 换触发方式时保留用户已经选好的生效日期
            const next = defaultsFor(event.target.value as Trigger['type']);
            onChange({ ...next, calendar: trigger.calendar } as Trigger);
          }}
        >
          <option value="activeDuration">连续使用时长（久坐）</option>
          <option value="interval">固定间隔</option>
          <option value="dailyAt">每天固定时刻</option>
          <option value="weekly">每周固定时刻</option>
          <option value="pomodoro">番茄钟</option>
          <option value="once">单次提醒</option>
        </select>
      </label>

      <label className="field">
        <span className="field-label">生效日期</span>
        <select
          value={trigger.calendar}
          onChange={(event) => patch({ calendar: event.target.value as Trigger['calendar'] })}
        >
          <option value="all">每天（不限制）</option>
          <option value="china-workday">中国工作日（含调休）</option>
        </select>
      </label>

      {/* 单次提醒没有「重复生效」的概念，不显示时间段编辑器 */}
      {trigger.type !== 'once' && (
        <ActiveWindowEditor
          value={trigger.activeWindow}
          onChange={(activeWindow) => patch({ activeWindow })}
        />
      )}

      {trigger.type === 'activeDuration' && (
        <label className="field">
          <span className="field-label">连续使用满（分钟）</span>
          <DraftInput
            type="number"
            committed={String(trigger.everyMinutes)}
            onCommit={(raw) => commitNumber(raw, 1, 600, (value) => patch({ everyMinutes: value }))}
          />
        </label>
      )}

      {trigger.type === 'interval' && (
        <label className="field">
          <span className="field-label">每隔（分钟）</span>
          <DraftInput
            type="number"
            committed={String(trigger.everyMinutes)}
            onCommit={(raw) => commitNumber(raw, 1, 1440, (value) => patch({ everyMinutes: value }))}
          />
        </label>
      )}

      {trigger.type === 'dailyAt' && (
        <label className="field">
          <span className="field-label">每天时刻（逗号分隔）</span>
          <DraftInput
            committed={trigger.at.join(', ')}
            placeholder="08:00, 20:00"
            onCommit={(raw) => {
              const parsed = parseTimeList(raw);
              // 至少解析出一个合法时刻才回写；否则整条提醒会因为 at 为空而校验失败
              if (parsed.length > 0) patch({ at: parsed });
            }}
            hint={(raw) => {
              const bad = unparsedTimeFragments(raw);
              if (bad.length === 0) return null;
              return (
                <span className="field-hint warn">
                  暂未识别：{bad.join('、')}（格式应为 08:00）
                </span>
              );
            }}
          />
          <span className="field-hint">格式 08:00，可写多个：08:00, 20:00</span>
        </label>
      )}

      {trigger.type === 'weekly' && (
        <div className="field">
          <span className="field-label">每周时刻</span>
          {trigger.entries.map((entry, index) => (
            <div className="inline-row" key={`${entry.day}-${entry.at}-${index}`}>
              <select
                value={entry.day}
                onChange={(event) => {
                  const entries = trigger.entries.map((item, i) =>
                    i === index ? { ...item, day: Number(event.target.value) } : item,
                  );
                  patch({ entries });
                }}
              >
                {WEEKDAY_LABEL.map((label, day) => (
                  <option key={day} value={day}>
                    周{label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={entry.at}
                onChange={(event) => {
                  const entries = trigger.entries.map((item, i) =>
                    i === index ? { ...item, at: event.target.value } : item,
                  );
                  patch({ entries });
                }}
              />
              <button
                type="button"
                className="btn ghost"
                disabled={trigger.entries.length <= 1}
                onClick={() => patch({ entries: trigger.entries.filter((_, i) => i !== index) })}
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() => patch({ entries: [...trigger.entries, { day: 1, at: '10:00' }] })}
          >
            ＋ 添加一条
          </button>
        </div>
      )}

      {trigger.type === 'pomodoro' && (
        <div className="inline-row">
          <label className="field">
            <span className="field-label">专注（分钟）</span>
            <DraftInput
              type="number"
              committed={String(trigger.focusMinutes)}
              onCommit={(raw) =>
                commitNumber(raw, 1, 180, (value) => patch({ focusMinutes: value }))
              }
            />
          </label>
          <label className="field">
            <span className="field-label">休息（分钟）</span>
            <DraftInput
              type="number"
              committed={String(trigger.breakMinutes)}
              onCommit={(raw) =>
                commitNumber(raw, 1, 60, (value) => patch({ breakMinutes: value }))
              }
            />
          </label>
        </div>
      )}

      {trigger.type === 'once' && (
        <label className="field">
          <span className="field-label">提醒时间</span>
          <input
            type="datetime-local"
            value={toLocalInputValue(trigger.at)}
            onChange={(event) => patch({ at: new Date(event.target.value).toISOString() })}
          />
        </label>
      )}

      <label className="field">
        <span className="field-label">允许错过多久后补发（分钟）</span>
        <DraftInput
          type="number"
          committed={String(trigger.catchUpMinutes)}
          onCommit={(raw) => commitNumber(raw, 0, 1440, (value) => patch({ catchUpMinutes: value }))}
        />
        <span className="field-hint">
          只对「每天 / 每周 / 单次」生效。设 0 表示过期不补；吃药这类建议 120，否则电脑在时间点处于睡眠状态就会整天不提醒。
        </span>
      </label>
    </>
  );
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
