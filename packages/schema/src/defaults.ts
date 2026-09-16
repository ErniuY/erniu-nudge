import type { AppConfig, GlobalSettings } from './config';
import type { Reminder } from './reminder';

/**
 * 生成 UUID。优先使用 Web Crypto（Node / 浏览器 / React Native 均可用），
 * 不可用时退化为本地实现，避免依赖 node:crypto 而破坏跨平台性。
 */
export function newId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultGlobalSettings(): GlobalSettings {
  return {
    language: 'zh-CN',
    launchAtLogin: true,
    tickSeconds: 5,
    idleThresholdSeconds: 120,
    resetAfterIdleSeconds: 180,
    minimizeToTray: true,
    muteUntil: null,
  };
}

/** 久坐提醒：连续活跃使用 45 分钟后提醒起身 */
export function standUpTemplate(): Reminder {
  return {
    id: newId(),
    name: '站起来活动',
    enabled: true,
    updatedAt: nowIso(),
    deletedAt: null,
    icon: 'builtin:stand-up',
    iconColor: '#2F80ED',
    trigger: {
      type: 'activeDuration',
      everyMinutes: 45,
      cooldownMinutes: 10,
      catchUpMinutes: 5,
      maxPerDay: 10,
      // 用「中国工作日」而不是「周一到周五」：调休的周六要提醒，放假的周一如要静默
      calendar: 'china-workday',
      activeWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:30' },
    },
    title: '该站起来了',
    message: '你已经连续坐了 {elapsed} 分钟，起来走两分钟吧。',
    actions: ['done', 'snooze', 'skip'],
    snoozeMinutes: [5, 10, 15],
    escalation: {
      enabled: true,
      steps: [
        { afterMinutes: 0, sound: 'gentle', autoCloseSeconds: 30, fullscreenMask: false },
        { afterMinutes: 3, sound: 'normal', autoCloseSeconds: 60, fullscreenMask: false },
        { afterMinutes: 8, sound: 'strong', autoCloseSeconds: 0, fullscreenMask: true },
      ],
    },
    sound: { source: 'builtin:chime', volume: 0.6 },
    presentation: 'both',
    overlayStyle: { corner: 'bottom-right', width: 360, opacity: 0.96 },
    dndPolicy: 'pauseWhenFullscreen',
    tags: ['健康'],
  };
}

/** 喝水提醒：固定间隔，仅工作时间，每日上限 8 次 */
export function drinkWaterTemplate(): Reminder {
  const base = standUpTemplate();
  return {
    ...base,
    id: newId(),
    name: '喝水',
    icon: 'builtin:water',
    iconColor: '#56CCF2',
    trigger: {
      type: 'interval',
      everyMinutes: 40,
      cooldownMinutes: 5,
      catchUpMinutes: 5,
      maxPerDay: 8,
      calendar: 'china-workday',
      activeWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:00' },
    },
    title: '该喝水了',
    message: '补充一杯水，顺便活动一下肩颈。',
    escalation: {
      enabled: false,
      steps: [{ afterMinutes: 0, sound: 'gentle', autoCloseSeconds: 20, fullscreenMask: false }],
    },
    presentation: 'toast',
    tags: ['健康'],
  };
}

/** 定时服药：每天固定时刻 */
export function medicationTemplate(): Reminder {
  const base = standUpTemplate();
  return {
    ...base,
    id: newId(),
    name: '服药',
    icon: 'builtin:pill',
    iconColor: '#EB5757',
    trigger: {
      type: 'dailyAt',
      at: ['08:00', '20:00'],
      cooldownMinutes: 0,
      catchUpMinutes: 120, // 错过了也要补提醒：电脑睡眠不该导致漏吃药
      calendar: 'all', // 吃药不分工作日
    },
    title: '该吃药了',
    message: '别忘了按时服药。',
    escalation: {
      enabled: true,
      steps: [
        { afterMinutes: 0, sound: 'normal', autoCloseSeconds: 0, fullscreenMask: false },
        { afterMinutes: 10, sound: 'strong', autoCloseSeconds: 0, fullscreenMask: false },
      ],
    },
    presentation: 'both',
    dndPolicy: 'always',
    tags: ['健康'],
  };
}

export const TEMPLATES = {
  standUp: standUpTemplate,
  drinkWater: drinkWaterTemplate,
  medication: medicationTemplate,
} as const;

/** 首次启动的默认配置：只带一条久坐提醒 */
export function defaultConfig(deviceId: string): AppConfig {
  return {
    schemaVersion: 1,
    deviceId,
    updatedAt: nowIso(),
    global: defaultGlobalSettings(),
    reminders: [standUpTemplate()],
    assets: {},
  };
}
