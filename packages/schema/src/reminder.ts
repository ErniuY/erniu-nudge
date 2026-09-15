import { z } from 'zod';

export const zHHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm');

/** 生效时间段；from > to 表示跨午夜，例如 22:00–06:00 */
export const zActiveWindow = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1), // 0 = 周日
  from: zHHmm,
  to: zHHmm,
});

const triggerBase = {
  activeWindow: zActiveWindow.optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).default(5),
  maxPerDay: z.number().int().min(1).max(200).optional(),
  /**
   * 错过时间点后的补发窗口（分钟）。
   * 应用到 dailyAt / weekly：0 表示过期不补；默认 5 分钟只吸收 tick 抖动，
   * 吃药这类提醒建议设成 120，否则电脑在 09:00 处于睡眠状态就会整天不提醒。
   */
  catchUpMinutes: z.number().int().min(0).max(1440).default(5),
};

export const zTrigger = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('activeDuration'),
    everyMinutes: z.number().int().min(1).max(600),
    ...triggerBase,
  }),
  z.object({
    type: z.literal('interval'),
    everyMinutes: z.number().int().min(1).max(1440),
    ...triggerBase,
  }),
  z.object({
    type: z.literal('dailyAt'),
    at: z.array(zHHmm).min(1),
    ...triggerBase,
  }),
  z.object({
    type: z.literal('weekly'),
    entries: z
      .array(z.object({ day: z.number().int().min(0).max(6), at: zHHmm }))
      .min(1),
    ...triggerBase,
  }),
  z.object({
    type: z.literal('pomodoro'),
    focusMinutes: z.number().int().min(1).max(180),
    breakMinutes: z.number().int().min(1).max(60),
    ...triggerBase,
  }),
  z.object({
    type: z.literal('once'),
    at: z.string().datetime({ offset: true }),
    ...triggerBase,
  }),
]);

export type Trigger = z.infer<typeof zTrigger>;
export type ActiveDurationTrigger = Extract<Trigger, { type: 'activeDuration' }>;
export type IntervalTrigger = Extract<Trigger, { type: 'interval' }>;
export type DailyAtTrigger = Extract<Trigger, { type: 'dailyAt' }>;
export type WeeklyTrigger = Extract<Trigger, { type: 'weekly' }>;
export type PomodoroTrigger = Extract<Trigger, { type: 'pomodoro' }>;
export type OnceTrigger = Extract<Trigger, { type: 'once' }>;

/** 图标必须是逻辑 ID：内置素材或用户导入的资源，禁止出现文件路径 */
export const zAssetRef = z
  .string()
  .regex(/^(builtin|asset):[A-Za-z0-9_-]+$/, '图标必须使用逻辑 ID，例如 builtin:stand-up 或 asset:abc123');

export const zReminderAction = z.enum(['done', 'snooze', 'skip', 'muteToday']);
export type ReminderAction = z.infer<typeof zReminderAction>;

export const zEscalationStep = z.object({
  afterMinutes: z.number().int().min(0).max(720),
  sound: z.enum(['none', 'gentle', 'normal', 'strong']).default('normal'),
  autoCloseSeconds: z.number().int().min(0).max(600).default(30),
  fullscreenMask: z.boolean().default(false),
});
export type EscalationStep = z.infer<typeof zEscalationStep>;

export const zReminder = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  enabled: z.boolean().default(true),

  // 同步预留字段：将来 Windows ↔ iOS 同步时用于冲突合并与软删除
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable().default(null),

  icon: zAssetRef,
  iconColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#2F80ED'),

  trigger: zTrigger,
  title: z.string().min(1).max(80),
  message: z.string().min(1).max(300),
  actions: z.array(zReminderAction).default(['done', 'snooze', 'skip']),
  snoozeMinutes: z.array(z.number().int().min(1).max(240)).default([5, 10, 15]),

  escalation: z.object({
    enabled: z.boolean().default(true),
    steps: z.array(zEscalationStep).min(1),
  }),

  sound: z.object({
    source: zAssetRef.default('builtin:chime'),
    volume: z.number().min(0).max(1).default(0.6),
  }),

  presentation: z.enum(['toast', 'overlay', 'both']).default('both'),
  overlayStyle: z.object({
    corner: z
      .enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'])
      .default('bottom-right'),
    width: z.number().int().min(240).max(720).default(360),
    opacity: z.number().min(0.3).max(1).default(0.96),
  }),
  dndPolicy: z
    .enum(['pauseWhenFullscreen', 'recordOnlyWhenFullscreen', 'always'])
    .default('pauseWhenFullscreen'),
  tags: z.array(z.string()).default([]),
});

export type Reminder = z.infer<typeof zReminder>;
export type OverlayCorner = Reminder['overlayStyle']['corner'];
export type DndPolicy = Reminder['dndPolicy'];
