import { ReminderEngine, SystemClock, type EngineSnapshot, type PlannedTrigger } from '@app/core';
import type { WorkdayCalendar } from '@app/core';
import type { ReminderAction } from '@app/schema';
import type { ConfigStore } from './configStore';
import type { WindowsActivityProvider } from './system/windowsActivity';
import type { Notifier } from './notify';
import type { EngineStatus } from '../shared/types';

/**
 * 把内核接到 Electron 外壳上：定时采样系统状态 → 喂给引擎 → 拿到事件 → 交给提醒器。
 * 这一层是唯一同时知道「内核」和「Electron」的地方。
 */
export class EngineHost {
  private readonly engine: ReminderEngine;
  private tickTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private paused = false;

  constructor(
    private readonly store: ConfigStore,
    private readonly activity: WindowsActivityProvider,
    private readonly notifier: Notifier,
    private readonly calendar: WorkdayCalendar | null,
    private readonly onStatusChange: (status: EngineStatus) => void,
  ) {
    this.engine = new ReminderEngine({
      clock: new SystemClock(),
      // 传函数而不是配置对象：界面改完配置后引擎立刻读到新值，无需重建引擎
      getConfig: () => this.store.get(),
      calendar: this.calendar,
    });
  }

  async start(): Promise<void> {
    // 恢复上次退出时的连续活跃时长，否则每次重启久坐计时都归零
    this.engine.restore(await this.store.loadSnapshot());
    this.restartTimer();
    this.snapshotTimer = setInterval(() => {
      void this.store.saveSnapshot(this.engine.snapshot());
    }, 60_000);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.tickTimer = null;
    this.snapshotTimer = null;
    void this.store.saveSnapshot(this.engine.snapshot());
  }

  /** 界面改了 tickSeconds 之后需要重建定时器 */
  restartTimer(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    const periodMs = Math.max(1, this.store.get().global.tickSeconds) * 1000;
    this.tickTimer = setInterval(() => void this.tick(), periodMs);
  }

  setPaused(value: boolean): void {
    if (this.paused === value) return;
    this.paused = value;
    if (!value) this.resumeFresh();
    this.pushStatus();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async acknowledge(id: string, action: ReminderAction, minutes?: number): Promise<void> {
    this.engine.acknowledge(id, action, minutes);
    const reminder = this.store.get().reminders.find((item) => item.id === id);
    await this.store.appendHistory(
      { at: Date.now(), reminderId: id, name: reminder?.name ?? id, kind: 'ack', action },
      this.timeZone,
    );
    this.notifier.closeFor(id);
    this.pushStatus();
  }

  plan(horizonMs: number): PlannedTrigger[] {
    return this.engine.plan(horizonMs);
  }

  /**
   * 配置变更后立刻推一次状态。
   * 不推的话界面要等下一个 tick（默认 5 秒）才刷新；如果此时处于暂停状态，
   * tick 直接返回，界面就永远不更新了——看起来就像按钮点了没反应。
   */
  refreshStatus(): void {
    this.pushStatus();
  }

  status(): EngineStatus {
    const state = this.engine.state();
    const config = this.store.get();
    const counts = this.store.historyCounts(Date.now(), this.timeZone);

    return {
      activeSeconds: state.activeSeconds,
      idleSeconds: state.idleSeconds,
      paused: this.paused,
      mutedUntil: config.global.muteUntil,
      todayAckCount: counts.ack,
      todayFireCount: counts.fire,
      calendarSource: this.calendar?.describe() ?? null,
      // 「接下来会提醒什么」直接复用内核的计划模式，与 iOS 端将来用的是同一份输出
      upcoming: this.engine.plan(24 * 3600_000).slice(0, 8),
    };
  }

  snapshot(): EngineSnapshot {
    return this.engine.snapshot();
  }

  private async tick(): Promise<void> {
    if (this.paused) return;

    const now = Date.now();
    const events = this.engine.tick(this.activity.sample(now));

    for (const event of events) {
      await this.store.appendHistory(
        {
          at: event.firedAt,
          reminderId: event.reminderId,
          name: event.reminder.name,
          kind: 'fire',
          step: event.escalationStep,
        },
        this.timeZone,
      );
      await this.notifier.present(event);
    }

    this.pushStatus();
  }

  /**
   * 从暂停恢复时把基准归零。
   * 否则暂停三小时后再打开，会立刻弹一句「你已经坐了 3 小时」——技术上没错，体验上很糟。
   */
  private resumeFresh(): void {
    const snapshot = this.engine.snapshot();
    this.engine.restore({ activeSeconds: snapshot.activeSeconds, lastTickAt: null });
    for (const reminder of this.store.get().reminders) {
      this.engine.acknowledge(reminder.id, 'done');
    }
  }

  private pushStatus(): void {
    this.onStatusChange(this.status());
  }

  private get timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
