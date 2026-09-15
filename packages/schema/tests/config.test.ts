import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, standUpTemplate } from '../src';

describe('配置解析与校验', () => {
  it('合法配置解析成功，并填充默认值', () => {
    const result = parseConfig({
      schemaVersion: 1,
      deviceId: 'dev-1',
      updatedAt: new Date().toISOString(),
      global: {},
      reminders: [standUpTemplate()],
      assets: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.global.tickSeconds).toBe(5);
    expect(result.config.global.resetAfterIdleSeconds).toBe(180);
    expect(result.config.reminders[0].actions).toEqual(['done', 'snooze', 'skip']);
  });

  it('图标必须是逻辑 ID，不能是文件路径', () => {
    const reminder = { ...standUpTemplate(), icon: 'C:\\pictures\\a.png' };
    const result = parseConfig({
      schemaVersion: 1,
      deviceId: 'dev-1',
      updatedAt: new Date().toISOString(),
      global: {},
      reminders: [reminder],
      assets: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('reminders.0.icon');
  });

  it('缺少触发器的错误信息带字段路径', () => {
    const { trigger, ...rest } = standUpTemplate();
    const result = parseConfig({
      schemaVersion: 1,
      deviceId: 'dev-1',
      updatedAt: new Date().toISOString(),
      global: {},
      reminders: [rest],
      assets: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.startsWith('reminders.0.trigger'))).toBe(true);
  });

  it('默认配置自带一条久坐提醒', () => {
    const config = defaultConfig('dev-1');
    expect(config.reminders).toHaveLength(1);
    expect(config.reminders[0].trigger.type).toBe('activeDuration');
  });
});
