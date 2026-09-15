import { z } from 'zod';
import { zReminder } from './reminder';

export const zGlobalSettings = z.object({
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  launchAtLogin: z.boolean().default(true),
  /** 引擎采样间隔 */
  tickSeconds: z.number().int().min(1).max(60).default(5),
  /** 键鼠空闲超过该秒数即视为「离开」 */
  idleThresholdSeconds: z.number().int().min(10).max(3600).default(120),
  /** 离开持续超过该秒数则清零重新计时 */
  resetAfterIdleSeconds: z.number().int().min(10).max(7200).default(180),
  minimizeToTray: z.boolean().default(true),
  /** 静音截止时刻（epoch 毫秒）；null 表示未静音 */
  muteUntil: z.number().nullable().default(null),
});

export const zAssetEntry = z.object({
  kind: z.enum(['icon', 'sound']),
  /** 平台标识 → 相对路径，例如 { win: 'assets/icons/8f3a2c.png' } */
  files: z.record(z.string(), z.string()),
});

export const zAppConfig = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  global: zGlobalSettings,
  reminders: z.array(zReminder),
  assets: z.record(z.string(), zAssetEntry).default({}),
});

export type GlobalSettings = z.infer<typeof zGlobalSettings>;
export type AppConfig = z.infer<typeof zAppConfig>;
export type AssetEntry = z.infer<typeof zAssetEntry>;

export type ParseResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: string[] };

/** 带字段路径的可读错误提示，用于导入配置时提示用户哪一条哪个字段不合法 */
export function parseConfig(raw: unknown): ParseResult {
  const result = zAppConfig.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`,
    ),
  };
}
