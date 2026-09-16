import { useState } from 'react';
import { zReminder, type Reminder, type ReminderAction } from '@app/schema';
import DraftInput from '../components/DraftInput';
import IconPicker from '../components/IconPicker';
import TriggerFields from '../components/TriggerFields';

const ACTION_OPTIONS: { value: ReminderAction; label: string }[] = [
  { value: 'done', label: '完成' },
  { value: 'snooze', label: '稍后提醒' },
  { value: 'skip', label: '跳过本次' },
  { value: 'muteToday', label: '今天不再提醒' },
];

export default function ReminderEdit({
  draft,
  assetUrls,
  onSave,
  onCancel,
  onImportIcon,
}: {
  draft: Reminder;
  assetUrls: Record<string, string>;
  onSave: (reminder: Reminder) => void;
  onCancel: () => void;
  onImportIcon: (apply: (ref: string) => void) => void;
}) {
  const [form, setForm] = useState<Reminder>(draft);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<Reminder>) => setForm((prev) => ({ ...prev, ...partial }));

  const submit = () => {
    const parsed = zReminder.safeParse(form);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(`${first.path.join('.') || '配置'}：${first.message}`);
      return;
    }
    setError(null);
    onSave(parsed.data);
  };

  const preview = form.message.replace(/\{(\w+)\}/g, (match, key: string) =>
    key === 'elapsed' ? String(form.trigger.type === 'activeDuration' ? form.trigger.everyMinutes : 0) : match,
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{draft.name ? '编辑提醒' : '新建提醒'}</h1>
          <p className="muted">保存前会用同一份 schema 校验，非法配置不会写进文件。</p>
        </div>
        <div className="inline-row">
          <button type="button" className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            保存
          </button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="panel">
        <h2>基本信息</h2>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">主题色</span>
            <input
              type="color"
              value={form.iconColor}
              onChange={(event) => patch({ iconColor: event.target.value })}
            />
          </label>
        </div>

        <IconPicker
          value={form.icon}
          color={form.iconColor}
          assetUrls={assetUrls}
          onChange={(ref) => patch({ icon: ref })}
          onImport={() => onImportIcon((ref) => patch({ icon: ref }))}
        />
      </section>

      <section className="panel">
        <h2>触发条件</h2>
        <div className="field-grid">
          <TriggerFields trigger={form.trigger} onChange={(trigger) => patch({ trigger })} />
        </div>
      </section>

      <section className="panel">
        <h2>提醒内容</h2>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">标题</span>
            <input
              type="text"
              value={form.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">正文</span>
            <textarea
              rows={3}
              value={form.message}
              onChange={(event) => patch({ message: event.target.value })}
            />
            <span className="field-hint">
              可用变量：{'{elapsed}'} 已连续分钟数、{'{count}'} 今日触发次数、{'{time}'} 当前时刻。
              实际显示：{preview}
            </span>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>呈现方式</h2>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">弹出形式</span>
            <select
              value={form.presentation}
              onChange={(event) =>
                patch({ presentation: event.target.value as Reminder['presentation'] })
              }
            >
              <option value="overlay">桌面悬浮卡片</option>
              <option value="toast">系统通知</option>
              <option value="both">两者都要</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">卡片位置</span>
            <select
              value={form.overlayStyle.corner}
              onChange={(event) =>
                patch({
                  overlayStyle: {
                    ...form.overlayStyle,
                    corner: event.target.value as Reminder['overlayStyle']['corner'],
                  },
                })
              }
            >
              <option value="bottom-right">右下角</option>
              <option value="bottom-left">左下角</option>
              <option value="top-right">右上角</option>
              <option value="top-left">左上角</option>
              <option value="center">屏幕中央</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">音频强度</span>
            <select
              value={form.sound.source}
              onChange={(event) =>
                patch({ sound: { ...form.sound, source: event.target.value } })
              }
            >
              <option value="builtin:chime">默认提示音</option>
              <option value="builtin:soft">轻柔</option>
              <option value="builtin:alarm">急促</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">全屏时</span>
            <select
              value={form.dndPolicy}
              onChange={(event) =>
                patch({ dndPolicy: event.target.value as Reminder['dndPolicy'] })
              }
            >
              <option value="pauseWhenFullscreen">暂停提醒，退出全屏再补</option>
              <option value="recordOnlyWhenFullscreen">照常记录，但不弹窗</option>
              <option value="always">照常提醒</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>交互按钮</h2>
        <div className="inline-row wrap">
          {ACTION_OPTIONS.map((option) => (
            <label key={option.value} className="chip-check">
              <input
                type="checkbox"
                checked={form.actions.includes(option.value)}
                onChange={(event) =>
                  patch({
                    actions: event.target.checked
                      ? [...form.actions, option.value]
                      : form.actions.filter((item) => item !== option.value),
                  })
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>

        <label className="field">
          <span className="field-label">稍后提醒的选项（分钟，逗号分隔）</span>
          <DraftInput
            committed={form.snoozeMinutes.join(', ')}
            placeholder="5, 10, 15"
            onCommit={(raw) => {
              const parsed = raw
                .split(',')
                .map((item) => Number(item.trim()))
                .filter((value) => Number.isInteger(value) && value > 0 && value <= 240);
              if (parsed.length > 0) patch({ snoozeMinutes: parsed });
            }}
          />
        </label>

        <label className="field row">
          <input
            type="checkbox"
            checked={form.escalation.enabled}
            onChange={(event) =>
              patch({
                escalation: { ...form.escalation, enabled: event.target.checked },
              })
            }
          />
          <span>
            未响应时逐级加强（当前节奏：
            {form.escalation.steps.map((step) => `${step.afterMinutes} 分钟`).join(' → ')}
            ）
          </span>
        </label>
      </section>
    </div>
  );
}
