/**
 * 一次系统状态采样。
 * 桌面端的来源是键鼠空闲时长；iOS 端将来换成 CoreMotion / HealthKit，接口不变。
 */
export interface SystemSignals {
  /** 采样时刻，epoch 毫秒 */
  at: number;
  /** 未锁屏、未休眠，且最近有键鼠输入 */
  userPresent: boolean;
  /** 锁屏 / 休眠 / 用户切换 */
  suspended: boolean;
  /** 前台应用是否全屏 */
  fullscreen: boolean;
}

/**
 * 平台信号源。这是内核与操作系统之间的唯一接触面。
 * 实现：WindowsActivityProvider（Electron）、IOSMotionProvider（未来）。
 */
export interface ActivityProvider {
  sample(now: number): SystemSignals;
  dispose(): void;
}
