import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  APP_DEFAULTS,
  defaultConfig,
  newId,
  zAppConfig,
  type AppConfig,
  type Reminder,
  type ReminderAction,
  type ThemeSettings,
} from '@app/schema';
import {
  ReminderEngine,
  SystemClock,
  zonedParts,
  type PlannedTrigger,
  type SystemSignals,
  type WorkdayCalendar,
} from '@app/core';
import chineseDays from 'chinese-days';
import type {
  AckPayload,
  BootstrapPayload,
  ConfigPayload,
  DesktopApi,
  EngineStatus,
  ImportedAsset,
  ImportedIcon,
  OverlayPayload,
  SettingsPatch,
} from '../../../shared/types';

// ---------------------------------------------------------------- 工作日日历

class ChinaWorkdayCalendar implements WorkdayCalendar {
  private readonly cache = new Map<string, boolean>();
  private readonly probe: ((date: string) => boolean) | null;

  constructor() {
    const candidate = (chineseDays as { isWorkday?: unknown }).isWorkday;
    this.probe =
      typeof candidate === 'function'
        ? (candidate as (date: string) => boolean).bind(chineseDays)
        : null;
  }

  isWorkday(epochMs: number, timeZone: string): boolean | null {
    const parts = zonedParts(epochMs, timeZone);
    const cached = this.cache.get(parts.dayKey);
    if (cached !== undefined) return cached;

    if (this.probe) {
      try {
        const value = Boolean(this.probe(parts.dayKey));
        this.cache.set(parts.dayKey, value);
        return value;
      } catch {
        // 数据范围外等情况退回按星期判断
      }
    }
    return parts.weekday >= 1 && parts.weekday <= 5;
  }

  describe(): string | null {
    return this.probe ? 'chinese-days（含调休）' : null;
  }
}

const calendar = new ChinaWorkdayCalendar();

// ---------------------------------------------------------------- 运行时状态

let config: AppConfig | null = null;
let assetUrls: Record<string, string> = {};
let engine: ReminderEngine;
let paused = false;
let counts = { ack: 0, fire: 0 };
/** 当前 counts 对应的本地日期，用于跨天后自动重读 */
let countsDayKey = todayKey();
let tickTimer: number | undefined;
let snapshotTimer: number | undefined;

const statusListeners = new Set<(status: EngineStatus) => void>();
const configListeners = new Set<(payload: ConfigPayload) => void>();

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function todayKey(): string {
  return zonedParts(Date.now(), timeZone()).dayKey;
}

function payload(): ConfigPayload {
  if (!config) throw new Error('配置尚未初始化');
  return { config, assetUrls };
}

function emitConfig(): void {
  const next = payload();
  for (const listener of configListeners) listener(next);
}

function computeStatus(): EngineStatus {
  const state = engine.state();
  return {
    activeSeconds: state.activeSeconds,
    idleSeconds: state.idleSeconds,
    paused,
    mutedUntil: config?.global.muteUntil ?? null,
    todayAckCount: counts.ack,
    todayFireCount: counts.fire,
    calendarSource: calendar.describe(),
    upcoming: engine.plan(24 * 3600_000).slice(0, 8),
  };
}

async function pushStatus(): Promise<void> {
  // 跨过午夜后要重新读当天的统计，否则界面会一直显示昨天的数字
  const key = todayKey();
  if (key !== countsDayKey) {
    countsDayKey = key;
    try {
      counts = await invoke('read_history_counts', { dayKey: key });
    } catch (error) {
      console.warn('[status] 重新读取当日统计失败', error);
    }
  }

  const status = computeStatus();
  for (const listener of statusListeners) listener(status);
  try {
    // 托盘 tooltip 需要这份状态，失败不影响界面
    await invoke('publish_status', { status });
  } catch (error) {
    console.warn('[status] 推送失败', error);
  }
}

async function saveSnapshot(): Promise<void> {
  try {
    await invoke('save_snapshot', { snapshot: engine.snapshot() });
  } catch (error) {
    console.warn('[snapshot] 保存失败', error);
  }
}

// ------------------------------------------------------------------- 引擎循环

async function tick(): Promise<void> {
  if (paused || !config) return;
  try {
    const signals = await invoke<SystemSignals>('sample_signals');
    const events = engine.tick(signals);

    for (const event of events) {
      counts = await invoke('append_history', {
        entry: {
          at: event.firedAt,
          dayKey: todayKey(),
          reminderId: event.reminderId,
          name: event.reminder.name,
          kind: 'fire',
          action: null,
          step: event.escalationStep,
        },
      });
      try {
        await invoke('present_event', { event });
      } catch (error) {
        console.error('[event] 呈现失败', error);
      }
    }

    await pushStatus();
  } catch (error) {
    console.error('[tick] 失败', error);
  }
}

function restartTimer(): void {
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
  const seconds = Math.max(1, config?.global.tickSeconds ?? 5);
  tickTimer = window.setInterval(() => void tick(), seconds * 1000);

  if (snapshotTimer !== undefined) window.clearInterval(snapshotTimer);
  snapshotTimer = window.setInterval(() => void saveSnapshot(), 60_000);
}

// ------------------------------------------------------------------- 业务动作

async function persistConfig(next: AppConfig): Promise<ConfigPayload> {
  const saved = await invoke<ConfigPayload>('save_config', { config: next });
  config = saved.config;
  assetUrls = saved.assetUrls;
  emitConfig();
  return payload();
}

async function saveReminder(reminder: Reminder): Promise<ConfigPayload> {
  if (!config) throw new Error('配置尚未初始化');
  const stamped: Reminder = { ...reminder, updatedAt: new Date().toISOString() };
  const reminders = [...config.reminders];
  const index = reminders.findIndex((item) => item.id === stamped.id);
  if (index >= 0) reminders[index] = stamped;
  else reminders.push(stamped);
  return persistConfig({
    ...config,
    reminders,
    updatedAt: new Date().toISOString(),
  });
}

async function deleteReminder(id: string): Promise<ConfigPayload> {
  if (!config) throw new Error('配置尚未初始化');
  return persistConfig({
    ...config,
    reminders: config.reminders.map((item) =>
      item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item,
    ),
    updatedAt: new Date().toISOString(),
  });
}

async function acknowledge(input: AckPayload): Promise<ConfigPayload> {
  engine.acknowledge(input.id, input.action, input.minutes);
  counts = await invoke('append_history', {
    entry: {
      at: Date.now(),
      dayKey: todayKey(),
      reminderId: input.id,
      name: config?.reminders.find((item) => item.id === input.id)?.name ?? input.id,
      kind: 'ack',
      action: input.action,
      step: null,
    },
  });
  countsDayKey = todayKey();
  await pushStatus();
  return payload();
}

async function patchSettings(patch: SettingsPatch): Promise<ConfigPayload> {
  if (!config) throw new Error('配置尚未初始化');
  const before = config.global;
  const next: AppConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
    global: { ...config.global, ...patch },
  };
  const result = await persistConfig(next);

  if (patch.launchAtLogin !== undefined) {
    try {
      await invoke('set_autostart', { enabled: patch.launchAtLogin });
    } catch (error) {
      console.warn('[autostart] 设置失败', error);
    }
  }
  if (patch.tickSeconds !== undefined && patch.tickSeconds !== before.tickSeconds) {
    restartTimer();
  }
  await pushStatus();
  return result;
}

async function setPaused(value: boolean): Promise<EngineStatus> {
  if (paused === value) return computeStatus();
  paused = value;

  if (!value) {
    // 从暂停恢复时把基准归零，避免「暂停三小时，一恢复就提示坐了 3 小时」
    const snapshot = engine.snapshot();
    engine.restore({ activeSeconds: snapshot.activeSeconds, lastTickAt: null });
    for (const reminder of config?.reminders ?? []) {
      engine.acknowledge(reminder.id, 'done');
    }
  }

  await pushStatus();
  return computeStatus();
}

async function importAsset(kind: 'icon' | 'background'): Promise<ImportedAsset | null> {
  const result = await invoke<ImportedAsset | null>('import_asset', { kind });
  if (result) {
    const fresh = await invoke<ConfigPayload>('get_config');
    config = fresh.config;
    assetUrls = fresh.assetUrls;
    emitConfig();
  }
  return result;
}

const importIcon = async (): Promise<ImportedIcon | null> =>
  (await importAsset('icon')) as ImportedIcon | null;

async function patchTheme(patch: Partial<ThemeSettings>): Promise<ConfigPayload> {
  if (!config) throw new Error('配置尚未初始化');
  return persistConfig({
    ...config,
    updatedAt: new Date().toISOString(),
    theme: { ...(config.theme ?? APP_DEFAULTS.theme), ...patch },
  });
}

// ---------------------------------------------------------------- 初始化与事件

async function initialize(): Promise<void> {
  const boot = await invoke<BootstrapPayload>('bootstrap');
  if (boot.config) {
    // 老配置文件可能没有新增字段（例如 theme），用 zod 补默认值
    const parsed = zAppConfig.safeParse(boot.config);
    config = parsed.success ? parsed.data : boot.config;
  } else {
    config = defaultConfig(newId());
  }
  if (!boot.config) {
    await invoke('save_config', { config });
  }
  assetUrls = boot.assetUrls;

  engine = new ReminderEngine({
    clock: new SystemClock(),
    getConfig: () => ({
      global: config!.global,
      reminders: config!.reminders,
    }),
    calendar,
  });
  engine.restore(boot.snapshot);
  counts = await invoke('read_history_counts', { dayKey: todayKey() });
  countsDayKey = todayKey();
}

function wireEvents(): void {
  void listen<ConfigPayload>('config-changed', (event) => {
    config = event.payload.config;
    assetUrls = event.payload.assetUrls;
    emitConfig();
    void pushStatus();
  });

  void listen<boolean>('toggle-pause', (event) => {
    void setPaused(Boolean(event.payload));
  });

  void listen<{ id: string; action: ReminderAction; minutes?: number | null }>(
    'overlay-action',
    (event) => {
      void acknowledge({
        id: event.payload.id,
        action: event.payload.action,
        minutes: event.payload.minutes ?? undefined,
      });
    },
  );
}

const api: DesktopApi = {
  getConfig: async () => payload(),
  saveReminder,
  deleteReminder,
  acknowledge,
  patchSettings,
  setPaused,
  getStatus: async () => computeStatus(),
  planPreview: async (horizonMs: number): Promise<PlannedTrigger[]> => engine.plan(horizonMs),
  importIcon,
  importAsset,
  patchTheme,
  openDataDir: async (): Promise<void> => {
    await invoke('open_data_dir');
  },
  openProjectPage: async (): Promise<void> => {
    await invoke('open_project_page');
  },
  onStatus: (cb) => {
    statusListeners.add(cb);
    return () => {
      statusListeners.delete(cb);
    };
  },
  onConfig: (cb) => {
    configListeners.add(cb);
    return () => {
      configListeners.delete(cb);
    };
  },
  getOverlayPayload: () => invoke<OverlayPayload | null>('get_overlay_payload'),
  overlayAction: async (id, action, minutes) => {
    await invoke('overlay_action', { id, action, minutes: minutes ?? null });
  },
};

export async function initDesktop(): Promise<void> {
  await initialize();
  window.api = api;
  wireEvents();
  restartTimer();
  void pushStatus();
  window.addEventListener('beforeunload', () => void saveSnapshot());
}
