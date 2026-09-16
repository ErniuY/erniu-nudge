import { useEffect, useMemo, useState } from 'react';
import { standUpTemplate, type Reminder } from '@app/schema';
import type { ConfigPayload, EngineStatus, SettingsPatch } from '../../shared/types';
import ReminderEdit from './pages/ReminderEdit';
import ReminderList from './pages/ReminderList';
import SettingsPage from './pages/SettingsPage';
import { formatDuration } from './format';

type View = 'list' | 'settings' | 'edit';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [view, setView] = useState<View>('list');
  const [draft, setDraft] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.api
      .getConfig()
      .then(setPayload)
      .catch((err: unknown) => setError(describe(err)));
    void window.api
      .getStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(describe(err)));

    const offConfig = window.api.onConfig(setPayload);
    const offStatus = window.api.onStatus(setStatus);
    return () => {
      offConfig();
      offStatus();
    };
  }, []);

  const reminders = useMemo(
    () => (payload?.config.reminders ?? []).filter((item) => item.deletedAt === null),
    [payload],
  );

  if (!payload) return <div className="boot">正在加载配置…</div>;

  const assetUrls = payload.assetUrls;

  const backToList = () => {
    setDraft(null);
    setView('list');
  };

  /**
   * 统一兜住主进程抛回来的错误。
   * IPC 失败时 Promise 会静默 reject，界面看起来就是「点了没反应」——
   * 之前静音按钮难以排查就是因为这个，现在任何失败都会直接显示在页面上。
   */
  const guard = async <T,>(task: Promise<T>, apply: (value: T) => void): Promise<void> => {
    try {
      setError(null);
      apply(await task);
    } catch (err) {
      setError(describe(err));
    }
  };

  const save = (reminder: Reminder) =>
    guard(window.api.saveReminder(reminder), (next: ConfigPayload) => {
      setPayload(next);
      backToList();
    });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          久坐提醒
        </div>

        <nav className="nav-group">
          <button
            type="button"
            className={view === 'settings' ? 'nav' : 'nav active'}
            onClick={backToList}
          >
            提醒
          </button>
          <button
            type="button"
            className={view === 'settings' ? 'nav active' : 'nav'}
            onClick={() => setView('settings')}
          >
            设置
          </button>
        </nav>

        <div className="status-card">
          <div className="status-label">当前连续使用</div>
          <div className="status-value">{formatDuration(status?.activeSeconds ?? 0)}</div>
          <div className="status-sub">
            今日起身 {status?.todayAckCount ?? 0} 次 · 触发 {status?.todayFireCount ?? 0} 次
          </div>
          <button
            type="button"
            className="btn ghost full"
            onClick={() =>
              void guard(window.api.setPaused(!(status?.paused ?? false)), setStatus)
            }
          >
            {status?.paused ? '恢复提醒' : '暂停提醒'}
          </button>
        </div>
      </aside>

      <main className="content">
        {error && (
          <div className="alert">
            <strong>操作失败：</strong>
            {error}
          </div>
        )}

        {view === 'edit' && draft ? (
          <ReminderEdit
            draft={draft}
            assetUrls={assetUrls}
            onSave={save}
            onCancel={backToList}
            onImportIcon={(apply) => {
              void (async () => {
                try {
                  setError(null);
                  const imported = await window.api.importIcon();
                  if (!imported) return;
                  setPayload(await window.api.getConfig());
                  apply(imported.ref);
                } catch (err) {
                  setError(describe(err));
                }
              })();
            }}
          />
        ) : view === 'settings' ? (
          <SettingsPage
            config={payload.config}
            status={status}
            onPatch={(patch: SettingsPatch) =>
              void guard(window.api.patchSettings(patch), setPayload)
            }
          />
        ) : (
          <ReminderList
            reminders={reminders}
            assetUrls={assetUrls}
            status={status}
            onCreate={() => {
              setDraft(standUpTemplate());
              setView('edit');
            }}
            onEdit={(reminder) => {
              setDraft(reminder);
              setView('edit');
            }}
            onToggle={(reminder) =>
              void guard(
                window.api.saveReminder({ ...reminder, enabled: !reminder.enabled }),
                setPayload,
              )
            }
            onDelete={(id) => void guard(window.api.deleteReminder(id), setPayload)}
          />
        )}
      </main>
    </div>
  );
}
