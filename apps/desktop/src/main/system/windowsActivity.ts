import { powerMonitor } from 'electron';
import type { ActivityProvider, SystemSignals } from '@app/core';

/**
 * ActivityProvider 的 Windows 实现。
 *
 * 判定「用户在场」的依据是系统键鼠空闲时长：空闲超过阈值即视为离开。
 * 锁屏与休眠单独标记，内核看到 suspended 会直接重置本次久坐会话——
 * 这一点很关键，否则睡眠两小时后唤醒会被误判成「刚离开 20 秒」。
 */
export class WindowsActivityProvider implements ActivityProvider {
  private locked = false;
  private suspended = false;
  private fullscreen = false;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly idleThresholdSeconds: () => number) {
    // Electron 的 powerMonitor 类型是「每个事件名一个重载」，用联合类型的事件名
    // 统一转发过不了编译，所以逐个显式注册。
    const handleLock = () => {
      this.locked = true;
    };
    const handleUnlock = () => {
      this.locked = false;
    };
    const handleSuspend = () => {
      this.suspended = true;
    };
    const handleResume = () => {
      this.suspended = false;
    };

    powerMonitor.on('lock-screen', handleLock);
    powerMonitor.on('unlock-screen', handleUnlock);
    powerMonitor.on('suspend', handleSuspend);
    powerMonitor.on('resume', handleResume);

    this.disposers.push(
      () => powerMonitor.off('lock-screen', handleLock),
      () => powerMonitor.off('unlock-screen', handleUnlock),
      () => powerMonitor.off('suspend', handleSuspend),
      () => powerMonitor.off('resume', handleResume),
    );
  }

  setFullscreen(value: boolean): void {
    this.fullscreen = value;
  }

  sample(now: number): SystemSignals {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const suspended = this.locked || this.suspended;
    return {
      at: now,
      suspended,
      userPresent: !suspended && idleSeconds < this.idleThresholdSeconds(),
      fullscreen: this.fullscreen,
    };
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }
}
