import type { AppConfig, GlobalSettings } from './config';
import type { Reminder } from './reminder';
import { APP_DEFAULTS } from './appDefaults';

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
  const { global } = APP_DEFAULTS;
  return {
    language: global.language,
    launchAtLogin: global.launchAtLogin,
    tickSeconds: global.tickSeconds,
    idleThresholdSeconds: global.idleThresholdSeconds,
    resetAfterIdleSeconds: global.resetAfterIdleSeconds,
    minimizeToTray: global.minimizeToTray,
    muteUntil: null,
  };
}

type ReminderLook = Pick<
  Reminder,
  | 'enabled'
  | 'actions'
  | 'snoozeMinutes'
  | 'escalation'
  | 'sound'
  | 'presentation'
  | 'overlayStyle'
  | 'dndPolicy'
>;

/** 复制一份默认外观，避免多个模板共享同一个数组或对象 */
function reminderLook(): ReminderLook {
  const reminder = APP_DEFAULTS.reminder;
  return {
    enabled: reminder.enabled,
    actions: [...reminder.actions],
    snoozeMinutes: [...reminder.snoozeMinutes],
    escalation: {
      enabled: reminder.escalation.enabled,
      steps: reminder.escalation.steps.map((step) => ({ ...step })),
    },
    sound: { ...reminder.sound },
    presentation: reminder.presentation,
    overlayStyle: { ...reminder.overlay },
    dndPolicy: reminder.dndPolicy,
  };
}

/** 久坐提醒：连续活跃使用 45 分钟后提醒起身 */
export function standUpTemplate(): Reminder {
  const template = APP_DEFAULTS.templates.standUp;
  const trigger = APP_DEFAULTS.triggers.activeDuration;

  return {
    id: newId(),
    name: template.name,
    ...reminderLook(),
    updatedAt: nowIso(),
    deletedAt: null,
    icon: template.icon,
    iconColor: template.iconColor,
    trigger: {
      type: 'activeDuration',
      everyMinutes: trigger.everyMinutes,
      cooldownMinutes: trigger.cooldownMinutes,
      catchUpMinutes: trigger.catchUpMinutes,
      maxPerDay: template.maxPerDay,
      calendar: template.calendar,
      activeWindow: {
        ...template.activeWindow,
        days: [...template.activeWindow.days],
      },
    },
    title: template.title,
    message: template.message,
    tags: [...template.tags],
  };
}

/** 喝水提醒：固定间隔，仅工作时间，每日上限 8 次 */
export function drinkWaterTemplate(): Reminder {
  const template = APP_DEFAULTS.templates.drinkWater;
  const trigger = APP_DEFAULTS.triggers.interval;

  return {
    id: newId(),
    name: template.name,
    ...reminderLook(),
    updatedAt: nowIso(),
    deletedAt: null,
    icon: template.icon,
    iconColor: template.iconColor,
    trigger: {
      type: 'interval',
      everyMinutes: trigger.everyMinutes,
      cooldownMinutes: trigger.cooldownMinutes,
      catchUpMinutes: trigger.catchUpMinutes,
      maxPerDay: template.maxPerDay,
      calendar: template.calendar,
      activeWindow: {
        ...template.activeWindow,
        days: [...template.activeWindow.days],
      },
    },
    title: template.title,
    message: template.message,
    presentation: template.presentation,
    escalation: {
      enabled: template.escalation.enabled,
      steps: template.escalation.steps.map((step) => ({ ...step })),
    },
    tags: [...template.tags],
  };
}

/** 定时服药：每天固定时刻，未被确认就每 10 分钟加强一次 */
export function medicationTemplate(): Reminder {
  const template = APP_DEFAULTS.templates.medication;
  const trigger = APP_DEFAULTS.triggers.dailyAt;

  return {
    id: newId(),
    name: template.name,
    ...reminderLook(),
    updatedAt: nowIso(),
    deletedAt: null,
    icon: template.icon,
    iconColor: template.iconColor,
    trigger: {
      type: 'dailyAt',
      at: [...template.at],
      cooldownMinutes: trigger.cooldownMinutes,
      catchUpMinutes: template.catchUpMinutes,
      calendar: template.calendar,
    },
    title: template.title,
    message: template.message,
    dndPolicy: template.dndPolicy,
    escalation: {
      enabled: template.escalation.enabled,
      steps: template.escalation.steps.map((step) => ({ ...step })),
    },
    tags: [...template.tags],
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
    theme: {
      ...APP_DEFAULTS.theme,
      overlayImagePosition: { ...APP_DEFAULTS.theme.overlayImagePosition },
      overlayTextPosition: { ...APP_DEFAULTS.theme.overlayTextPosition },
      overlayActionsPosition: { ...APP_DEFAULTS.theme.overlayActionsPosition },
    },
    reminders: [standUpTemplate()],
    assets: {},
  };
}
