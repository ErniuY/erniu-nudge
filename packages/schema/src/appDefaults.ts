// 这些字面量联合必须与 reminder.ts 里的 zod enum 保持一致。
type Language = 'zh-CN' | 'en-US';
type CalendarKind = 'all' | 'china-workday';
type ReminderAction = 'done' | 'snooze' | 'skip' | 'muteToday';
type Presentation = 'toast' | 'overlay' | 'both';
type EscalationSound = 'none' | 'gentle' | 'normal' | 'strong';
type OverlayCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
type DndPolicy = 'pauseWhenFullscreen' | 'recordOnlyWhenFullscreen' | 'always';

/**
 * 全应用的默认值，集中放这一处。
 *
 * 改这里会同时影响三处：
 * 1. zod schema 的 `.default()`（新建/导入配置时补齐缺省字段）
 * 2. 内置提醒模板（首次启动生成的那几条）
 * 3. 界面里「新建提醒」时表单的初始值
 *
 * 注意：Rust 侧有两个兜底值（空闲阈值 120 秒、静音 30/60 分钟）无法直接 import 这个文件，
 * 修改时请同步 apps/desktop/src-tauri/src/commands.rs 与 main.rs 里的注释位置。
 */
export const APP_DEFAULTS = {
  // ---------------------------------------------------------------- 全局设置
  global: {
    /** 界面语言 */
    language: 'zh-CN' as Language,
    /** 开机自动启动（静默启动，不弹主窗口） */
    launchAtLogin: true,
    /** 引擎采样间隔（秒）。越小越精确，CPU 占用略高 */
    tickSeconds: 5,
    /** 多久没有键鼠输入算「离开」（秒） */
    idleThresholdSeconds: 120,
    /**
     * 离开多久后清零重新计时（秒）。
     * 默认 600 秒 = 10 分钟：
     * - 离开 9 分钟 → 不清零，这 9 分钟仍作为「离开时长」被记录
     * - 离开满 10 分钟 → 当前会话清零，回来重新开始计时
     */
    resetAfterIdleSeconds: 600,
    /** 关闭主窗口时最小化到托盘而不是退出 */
    minimizeToTray: true,
  },

  // ------------------------------------------------------------ 触发器公共项
  trigger: {
    /** 默认生效日期：all = 每天；china-workday = 中国工作日（含调休） */
    calendar: 'china-workday' as CalendarKind,
    /** 触发后多久内不重复打扰（分钟）。防抖用的安全网 */
    cooldownMinutes: 5,
    /**
     * 允许错过多久后补发（分钟）。
     * 0 表示过期不补；只对「每天 / 每周 / 单次」这类定点提醒有意义。
     */
    catchUpMinutes: 5,
    /** 默认生效时间段；新提醒默认是全天不限 */
    activeWindow: {
      /** 0 = 周日 … 6 = 周六 */
      days: [1, 2, 3, 4, 5],
      from: '08:30',
      to: '17:30',
    },
  },

  // ------------------------------------------------------ 各触发方式的默认值
  triggers: {
    /** 连续使用时长（久坐）：连续活跃 45 分钟后提醒 */
    activeDuration: {
      everyMinutes: 45,
      cooldownMinutes: 10,
      catchUpMinutes: 5,
    },
    /** 固定间隔：每 40 分钟一次 */
    interval: {
      everyMinutes: 40,
      cooldownMinutes: 5,
      catchUpMinutes: 5,
    },
    /** 每天固定时刻：默认 09:00 */
    dailyAt: {
      at: ['09:00'],
      cooldownMinutes: 0,
      catchUpMinutes: 10,  //补发时间（分钟）
    },
    /** 每周固定时刻：默认周一 10:00 */
    weekly: {
      entries: [{ day: 1, at: '10:00' }],
      cooldownMinutes: 0,
      catchUpMinutes: 120,
    },
    /** 番茄钟：专注 30 分钟、休息 5 分钟 */
    pomodoro: {
      focusMinutes: 30,
      breakMinutes: 5,
      cooldownMinutes: 5,
      catchUpMinutes: 5,
    },
    /** 单次提醒：默认一小时后 */
    once: {
      offsetMinutes: 60,
      cooldownMinutes: 0,
      catchUpMinutes: 0,
    },
  },

  // ------------------------------------------------------------ 提醒项默认值
  reminder: {
    enabled: true,
    /** 图标主色 */
    iconColor: '#2F80ED',
    /** 默认显示哪些按钮 */
    actions: ['done', 'snooze', 'skip'] as ReminderAction[],
    /** 「稍后提醒」的可选分钟数 */
    snoozeMinutes: [5, 10, 15] as number[],
    /** 呈现方式：toast 系统通知 / overlay 悬浮卡片 / both 两者都要 */
    presentation: 'both' as Presentation,
    /** 悬浮卡片外观 */
    overlay: {
      corner: 'bottom-right' as OverlayCorner,
      width: 360,
      opacity: 0.96,
    },
    /** 全屏时怎么处理：暂停提醒 / 只记录不弹窗 / 照常提醒 */
    dndPolicy: 'pauseWhenFullscreen' as DndPolicy,
    /** 提示音 */
    sound: {
      source: 'builtin:chime',
      volume: 0.6,
    },
    /** 升级策略：到点后依次在 +0 / +3 / +8 分钟加强 */
    escalation: {
      enabled: true,
      steps: [
        {
          afterMinutes: 0,
          sound: 'gentle' as EscalationSound,
          autoCloseSeconds: 30,
          fullscreenMask: false,
        },
        {
          afterMinutes: 3,
          sound: 'normal' as EscalationSound,
          autoCloseSeconds: 60,
          fullscreenMask: false,
        },
        {
          afterMinutes: 8,
          sound: 'strong' as EscalationSound,
          autoCloseSeconds: 0,
          fullscreenMask: true,
        },
      ],
    },
    /** 单个升级步骤的 zod 缺省值（不是完整的三段策略） */
    escalationStep: {
      sound: 'normal' as EscalationSound,
      autoCloseSeconds: 30,
      fullscreenMask: false,
    },
    tags: [] as string[],
  },

  // ---------------------------------------------------------- 内置模板的文案
  templates: {
    standUp: {
      name: '站起来活动',
      icon: 'builtin:stand-up',
      iconColor: '#2F80ED',
      title: '该站起来了',
      message: '你已经连续坐了 {elapsed} 分钟，起来走两分钟吧。',
      /** 久坐模板用中国工作日 + 工作时间段 */
      calendar: 'china-workday' as CalendarKind,
      activeWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:30' },
      maxPerDay: 10,
      tags: ['健康'] as string[],
    },
    drinkWater: {
      name: '喝水',
      icon: 'builtin:water',
      iconColor: '#56CCF2',
      title: '该喝水了',
      message: '补充一杯水，顺便活动一下肩颈。',
      calendar: 'china-workday' as CalendarKind,
      activeWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '18:00' },
      maxPerDay: 8,
      /** 喝水只弹系统通知，不做升级催促 */
      presentation: 'toast' as Presentation,
      escalation: {
        enabled: false,
        steps: [
          {
            afterMinutes: 0,
            sound: 'gentle' as EscalationSound,
            autoCloseSeconds: 20,
            fullscreenMask: false,
          },
        ],
      },
      tags: ['健康'] as string[],
    },
    medication: {
      name: '服药',
      icon: 'builtin:pill',
      iconColor: '#EB5757',
      title: '该吃药了',
      message: '别忘了按时服药。',
      /** 吃药不分工作日 */
      calendar: 'all' as CalendarKind,
      at: ['08:00', '20:00'],
      catchUpMinutes: 120,
      /** 吃药是硬提醒：就算全屏也照常弹 */
      dndPolicy: 'always' as DndPolicy,
      escalation: {
        enabled: true,
        steps: [
          {
            afterMinutes: 0,
            sound: 'normal' as EscalationSound,
            autoCloseSeconds: 0,
            fullscreenMask: false,
          },
          {
            afterMinutes: 10,
            sound: 'strong' as EscalationSound,
            autoCloseSeconds: 0,
            fullscreenMask: false,
          },
        ],
      },
      tags: ['健康'] as string[],
    },
  },

  // ----------------------------------------------------------------- 静音时长
  mute: {
    /** 托盘与设置页的「静音 30 分钟」 */
    shortMinutes: 30,
    /** 托盘与设置页的「静音 1 小时」 */
    longMinutes: 60,
  },

  // ------------------------------------------------------------------ 主题
  theme: {
    /** 首页 hero 背景图（asset:<id>）；null 表示使用内置渐变 */
    homeBackground: null as string | null,
    /** 首页背景的白色蒙版深度，越大文字越清楚、图片越淡 */
    homeDim: 0.35,
    /** 悬浮提醒卡片图片；按 overlayImageMode 作为背景或右侧人物使用 */
    overlayBackground: null as string | null,
    /**
     * 弹窗图片用途：
     * - background：整张图片作为卡片背景
     * - character：作为右侧人物/插画，文字可拖到人物旁边
     */
    overlayImageMode: 'background' as 'background' | 'character',
    /**
     * 背景图适配方式：
     * - stretch：拉伸铺满
     * - center / left / right：保持比例完整显示，不裁切
     */
    overlayBackgroundFit: 'center' as 'stretch' | 'center' | 'left' | 'right',
    /** 悬浮卡片背景的白色蒙版深度 */
    overlayDim: 0.45,
    /** 人物/插画图片中心在卡片中的位置（百分比） */
    overlayImagePosition: { x: 76, y: 44 },
    /** 人物/插画缩放比例，1 = 100% */
    overlayImageScale: 1,
    /** 提示文字块在卡片中的位置（百分比，0–100） */
    overlayTextPosition: { x: 50, y: 50 },
    overlayTextAlign: 'left' as 'left' | 'center' | 'right',
    /** 操作按钮整组在卡片中的位置（百分比） */
    overlayActionsPosition: { x: 50, y: 76 },
    overlayActionsDirection: 'horizontal' as 'horizontal' | 'vertical',
    /** 上传弹窗图片后，可去掉卡片白底、边框和阴影 */
    overlayCardTransparent: false,
  },
};

export type AppDefaults = typeof APP_DEFAULTS;
