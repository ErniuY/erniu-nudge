import { useEffect, useRef, useState } from 'react';
import type { ReminderAction } from '@app/schema';
import type { OverlayPayload, SoundLevel } from '../../shared/types';
import { BuiltinIcon } from './builtinIcons';

const ACTION_LABEL: Record<ReminderAction, string> = {
  done: '我已起身',
  snooze: '稍后提醒',
  skip: '跳过本次',
  muteToday: '今天不再提醒',
};

/**
 * 用 Web Audio 合成提示音，不需要打包任何音频文件。
 * 分三档：gentle 单声、normal 双声、strong 三声更响。
 */
function playTone(level: SoundLevel): void {
  if (level === 'none') return;
  const patterns: Record<Exclude<SoundLevel, 'none'>, number[]> = {
    gentle: [660],
    normal: [660, 880],
    strong: [880, 880, 990],
  };

  try {
    const ctx = new AudioContext();
    const start = ctx.currentTime;
    const freqs = patterns[level];
    const peak = level === 'strong' ? 0.3 : 0.16;

    freqs.forEach((freq, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;

      const at = start + index * 0.28;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.26);
    });

    setTimeout(() => void ctx.close(), (freqs.length * 0.3 + 0.6) * 1000);
  } catch {
    // 音频设备不可用（远程桌面等），静默降级即可
  }
}

export default function OverlayApp() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    void window.api.getOverlayPayload().then((data) => {
      setPayload(data);
      if (data) setRemaining(data.autoCloseSeconds > 0 ? data.autoCloseSeconds : null);
    });
  }, []);

  useEffect(() => {
    if (!payload || fired.current) return;
    fired.current = true;
    playTone(payload.sound);
  }, [payload]);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      void window.api.overlayAction(payload?.reminderId ?? '', 'skip');
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => (value === null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining, payload?.reminderId]);

  if (!payload) return null;

  const act = (action: ReminderAction, minutes?: number) => {
    void window.api.overlayAction(payload.reminderId, action, minutes);
  };

  const icon = payload.icon.startsWith('builtin:') ? (
    <BuiltinIcon name={payload.icon.slice('builtin:'.length)} size={26} color={payload.iconColor} />
  ) : payload.iconDataUrl ? (
    <img className="overlay-icon-img" src={payload.iconDataUrl} alt="" />
  ) : (
    <BuiltinIcon name="clock" size={26} color={payload.iconColor} />
  );

  const card = (
    <div className="overlay-card" style={{ borderColor: `${payload.iconColor}33` }}>
      <div className="overlay-head">
        <span className="overlay-icon" style={{ background: `${payload.iconColor}1a` }}>
          {icon}
        </span>
        <div className="overlay-text">
          <div className="overlay-title">{payload.title}</div>
          <div className="overlay-message">{payload.message}</div>
        </div>
        {payload.escalationStep > 0 && <span className="overlay-badge">第 {payload.escalationStep + 1} 次</span>}
      </div>

      <div className="overlay-actions">
        {payload.actions.includes('done') && (
          <button type="button" className="btn primary" onClick={() => act('done')}>
            {ACTION_LABEL.done}
          </button>
        )}
        {payload.actions.includes('snooze') &&
          payload.snoozeMinutes.slice(0, 3).map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="btn ghost"
              onClick={() => act('snooze', minutes)}
            >
              {minutes} 分钟后
            </button>
          ))}
        {payload.actions.includes('skip') && (
          <button type="button" className="btn link" onClick={() => act('skip')}>
            跳过本次
          </button>
        )}
      </div>

      {remaining !== null && <div className="overlay-timer">{remaining} 秒后自动关闭</div>}
    </div>
  );

  if (payload.fullscreenMask) {
    return <div className="overlay-mask">{card}</div>;
  }
  return <div className="overlay-root">{card}</div>;
}
