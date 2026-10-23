import { useEffect, useMemo, useState } from 'react';
import { APP_DEFAULTS, standUpTemplate, type Reminder } from '@app/schema';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ConfigPayload, EngineStatus, SettingsPatch } from '../../shared/types';
import AboutPage from './pages/AboutPage';
import ReminderEdit from './pages/ReminderEdit';
import ReminderList from './pages/ReminderList';
import SettingsPage from './pages/SettingsPage';
import ThemePage from './pages/ThemePage';
import { formatDuration } from './format';
import appIcon from './assets/app-icon.png';

type View = 'list' | 'settings' | 'theme' | 'edit' | 'about';

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const appWindow = getCurrentWindow();

const RESIZE_EDGES = [
  { dir: 'North', cls: 'n' },
  { dir: 'South', cls: 's' },
  { dir: 'East', cls: 'e' },
  { dir: 'West', cls: 'w' },
  { dir: 'NorthEast', cls: 'ne' },
  { dir: 'NorthWest', cls: 'nw' },
  { dir: 'SouthEast', cls: 'se' },
  { dir: 'SouthWest', cls: 'sw' },
] as const;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function todayLabel(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}.${month}.${day} · ${WEEKDAY[now.getDay()]}`;
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
  const paused = status?.paused ?? false;
  const activeMinutes = Math.floor((status?.activeSeconds ?? 0) / 60);
  const nextFireAt = status?.upcoming[0]?.fireAt;
  const remainingMinutes = nextFireAt
    ? Math.max(0, Math.round((nextFireAt - Date.now()) / 60_000))
    : null;
  const spanMinutes = activeMinutes + (remainingMinutes ?? 0);
  const progress = spanMinutes > 0 ? Math.min(100, (activeMinutes / spanMinutes) * 100) : 0;
  const idleSeconds = status?.idleSeconds ?? 0;
  const resetMinutes = Math.round(payload.config.global.resetAfterIdleSeconds / 60);
  const theme = payload.config.theme ?? APP_DEFAULTS.theme;
  const homeBackgroundUrl = theme.homeBackground ? assetUrls[theme.homeBackground] : null;
  const heroStyle = homeBackgroundUrl
    ? {
        backgroundImage: `url("${homeBackgroundUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  const backToList = () => {
    setDraft(null);
    setView('list');
  };

  /**
   * 统一兜住主进程抛回来的错误。
   * IPC 失败时 Promise 会静默 reject，界面看起来就是「点了没反应」。
   */
  const guard = async <T,>(task: Promise<T>, apply: (value: T) => void): Promise<void> => {
    try {
      setError(null);
      apply(await task);
    } catch (err) {
      setError(describe(err));
    }
  };

  const togglePause = () =>
    void guard(window.api.setPaused(!paused), setStatus);

  const save = (reminder: Reminder) =>
    guard(window.api.saveReminder(reminder), (next: ConfigPayload) => {
      setPayload(next);
      backToList();
    });

  return (
    <div className="app">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img className="brand-icon" src={appIcon} alt="" />
          <span className="brand-sub">NUDGE</span>
        </div>
        <nav className="topnav">
          <button
            type="button"
            className={view === 'settings' || view === 'theme' || view === 'about' ? '' : 'on'}
            onClick={backToList}
          >
            提醒
          </button>
          <button
            type="button"
            className={view === 'settings' ? 'on' : ''}
            onClick={() => setView('settings')}
          >
            设置
          </button>
          <button
            type="button"
            className={view === 'theme' ? 'on' : ''}
            onClick={() => setView('theme')}
          >
            主题
          </button>
          <button
            type="button"
            className={view === 'about' ? 'on' : ''}
            onClick={() => setView('about')}
          >
            关于
          </button>
        </nav>
        <div className="topmeta">
          <span className={`live${paused ? ' paused' : ''}`}>
            <i aria-hidden="true" />
            {paused ? '已暂停' : '运行中'}
          </span>
          <span className="date">{todayLabel()}</span>
          <button type="button" className="text-btn" onClick={togglePause}>
            {paused ? '恢复' : '暂停'}
          </button>
        </div>
        <div className="win-controls">
          <button
            type="button"
            className="win-btn"
            aria-label="最小化"
            onClick={() => void appWindow.minimize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn close"
            aria-label="关闭到托盘"
            onClick={() => void appWindow.close()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2 2l6 6M8 2l-6 6"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="resize-layer" aria-hidden="true">
        {RESIZE_EDGES.map((edge) => (
          <div
            key={edge.cls}
            className={`rz rz-${edge.cls}`}
            onMouseDown={(event) => {
              event.preventDefault();
              void appWindow.startResizeDragging(edge.dir);
            }}
          />
        ))}
      </div>

      <main className="stage">
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
        ) : view === 'about' ? (
          <AboutPage
            onOpenProject={() => void guard(window.api.openProjectPage(), () => undefined)}
            onOpenDataDir={() => void guard(window.api.openDataDir(), () => undefined)}
          />
        ) : view === 'theme' ? (
          <ThemePage
            config={payload.config}
            assetUrls={assetUrls}
            onPatchTheme={(patch) =>
              void guard(window.api.patchTheme(patch), setPayload)
            }
            onPickAsset={async (kind) => {
              try {
                setError(null);
                const imported = await window.api.importAsset(kind);
                if (!imported) return null;
                setPayload(await window.api.getConfig());
                return imported.ref;
              } catch (err) {
                setError(describe(err));
                return null;
              }
            }}
          />
        ) : view === 'settings' ? (
          <SettingsPage
            config={payload.config}
            status={status}
            onOpenDataDir={() =>
              void guard(window.api.openDataDir(), () => undefined)
            }
            onPatch={(patch: SettingsPatch) =>
              void guard(window.api.patchSettings(patch), setPayload)
            }
          />
        ) : (
          <>
            <section className="hero" style={heroStyle}>
              <span
                className="hero-dim"
                style={{ opacity: theme.homeDim }}
                aria-hidden="true"
              />
              <div className="hero-main">
                <div className="kicker">当前连续使用</div>
                <div className="hero-number">
                  {activeMinutes}
                  <span>分钟</span>
                </div>
                <div className="hero-rule">
                  <i style={{ width: `${progress}%` }} />
                </div>
                <div className="hero-sub">
                  {paused ? (
                    '提醒已暂停，计时仍在继续'
                  ) : remainingMinutes !== null ? (
                    <>
                      距离下一次提醒还有 <b>{remainingMinutes} 分钟</b>
                    </>
                  ) : (
                    '今天没有更多安排'
                  )}
                </div>
                {idleSeconds >= 30 && (
                  <div className="hero-note">
                    已离开 {formatDuration(idleSeconds)} · 满 {resetMinutes} 分钟清零
                  </div>
                )}
              </div>
              <div className="hero-side">
                <div className="stat">
                  <b>{status?.todayAckCount ?? 0}</b>
                  <span>今日起身</span>
                </div>
                <div className="stat">
                  <b>{status?.todayFireCount ?? 0}</b>
                  <span>今日触发</span>
                </div>
                <div className="stat">
                  <b>{remainingMinutes ?? '—'}</b>
                  <span>距下次 / 分钟</span>
                </div>
              </div>
            </section>

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
          </>
        )}
      </main>
    </div>
  );
}
