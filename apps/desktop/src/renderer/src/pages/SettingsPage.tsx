import type { AppConfig } from '@app/schema';
import type { EngineStatus, SettingsPatch } from '../../../shared/types';
import DraftInput from '../components/DraftInput';
import { formatClock, formatDuration } from '../format';

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

export default function SettingsPage({
  config,
  status,
  onPatch,
}: {
  config: AppConfig;
  status: EngineStatus | null;
  onPatch: (patch: SettingsPatch) => void;
}) {
  const global = config.global;
  // 静音状态直接读配置：点完立刻回显。
  // 不要读 status.mutedUntil —— 那是引擎每 tick（默认 5 秒）推一次的快照，
  // 暂停状态下甚至根本不会更新，会让人以为按钮点了没反应。
  const mutedUntil = global.muteUntil;
  const muted = mutedUntil !== null && mutedUntil > Date.now();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p className="muted">这些参数决定了「什么算一次久坐」以及应用如何常驻。</p>
        </div>
      </header>

      <section className="panel">
        <h2>久坐判定</h2>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">多久没有键鼠输入算「离开」（秒）</span>
            <DraftInput
              type="number"
              committed={String(global.idleThresholdSeconds)}
              onCommit={(raw) =>
                commitNumber(raw, 10, 3600, (value) => onPatch({ idleThresholdSeconds: value }))
              }
            />
          </label>

          <label className="field">
            <span className="field-label">离开多久后清零重新计时（秒）</span>
            <DraftInput
              type="number"
              committed={String(global.resetAfterIdleSeconds)}
              onCommit={(raw) =>
                commitNumber(raw, 10, 7200, (value) => onPatch({ resetAfterIdleSeconds: value }))
              }
            />
          </label>

          <label className="field">
            <span className="field-label">采样间隔（秒）</span>
            <DraftInput
              type="number"
              committed={String(global.tickSeconds)}
              onCommit={(raw) =>
                commitNumber(raw, 1, 60, (value) => onPatch({ tickSeconds: value }))
              }
            />
            <span className="field-hint">越小越精确，CPU 占用略高。5 秒足够。</span>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>常驻与打扰</h2>
        <label className="field row">
          <input
            type="checkbox"
            checked={global.launchAtLogin}
            onChange={(event) => onPatch({ launchAtLogin: event.target.checked })}
          />
          <span>开机自动启动（静默启动，不弹主窗口）</span>
        </label>

        <div className="field">
          <span className="field-label">当前静音状态</span>
          <div className="inline-row">
            <span className={muted ? 'tag warn' : 'tag'}>
              {muted && mutedUntil ? `静音至 ${formatClock(mutedUntil)}` : '未静音'}
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onPatch({ muteUntil: Date.now() + 30 * 60_000 })}
            >
              静音 30 分钟
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onPatch({ muteUntil: Date.now() + 60 * 60_000 })}
            >
              静音 1 小时
            </button>
            <button type="button" className="btn ghost" onClick={() => onPatch({ muteUntil: null })}>
              取消静音
            </button>
          </div>
          <span className="field-hint">
            静音期间照常计时与记录，只是不弹窗、不出声。
          </span>
        </div>

        <div className="field">
          <span className="field-label">运行状态</span>
          <span className="field-hint">
            {status?.paused ? '已暂停提醒' : '提醒运行中'} · 当前连续使用{' '}
            {formatDuration(status?.activeSeconds ?? 0)}
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>数据</h2>
        <div className="field">
          <span className="field-label">节假日数据</span>
          <span className={status?.calendarSource ? 'field-hint' : 'field-hint warn'}>
            {status?.calendarSource ??
              '未加载 —— 选「中国工作日」的提醒暂按「周一到周五」处理。装上 chinese-days 后可识别法定假日与调休。'}
          </span>
        </div>
        <p className="muted small">
          配置保存在应用数据目录（%APPDATA%\erniu-nudge），包含 config.json、state.json 和历史记录。
          配置写入前会先校验、再原子替换，并保留一份 config.backup.json，损坏时自动回退。
        </p>
        
      </section>
    </div>
  );
}
{/* <p className="muted small">
          提醒项里已经预留了 deviceId / updatedAt / deletedAt 字段，将来接 iOS 端做同步不需要迁移数据。
      </p> */}
