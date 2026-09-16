import type { GlobalSettings, Reminder, ReminderAction } from '@app/schema';
import type { SystemSignals } from './activity';
import type {
  EngineOptions,
  EngineSnapshot,
  PlannedTrigger,
  ReminderRuntime,
  TriggerEvent,
} from './types';
import type { TriggerContext } from './triggers';
import { strategyFor } from './triggers';
import { zonedParts } from './localTime';
import { matchesCalendar, type WorkdayCalendar } from './calendar';

/**
 * 调度引擎。双模式：
 *
 * - tick()  实时模式：桌面端常驻进程每 tickSeconds 调用一次，实时判断是否触发。
 * - plan()  计划模式：给定未来时间窗，算出所有应当在何时触发。
 *           桌面端用于「今日待提醒预览」，iOS 端用于预排本地通知
 *           （iOS 不允许常驻后台定时，且单个 App 待处理通知上限 64 条）。
 *
 * 两者必须保持一致，`planMatchesTick.test.ts` 负责守住这条约束。
 */
export class ReminderEngine {
  private runtimes = new Map<string, ReminderRuntime>();
  /** 全局连续活跃秒数：所有 activeDuration 类提醒共用这一个时钟 */
  private activeSeconds = 0;
  private idleSeconds = 0;
  private lastTickAt: number | null = null;
  private readonly calendar: WorkdayCalendar | null;

  constructor(private readonly opts: EngineOptions) {
    this.calendar = opts.calendar ?? null;
  }

  // ---------------------------------------------------------------- 实时模式

  tick(signals: SystemSignals): TriggerEvent[] {
    const { global, reminders } = this.opts.getConfig();
    const now = signals.at;
    const prev = this.lastTickAt;
    this.lastTickAt = now;

    if (prev !== null) this.advanceActiveTime(prev, signals, global);

    const events: TriggerEvent[] = [];

    // 锁屏 / 休眠：只维护状态，不提醒（此时用户不在电脑前）
    if (signals.suspended) return events;

    for (const reminder of reminders) {
      if (!reminder.enabled || reminder.deletedAt !== null) continue;

      const runtime = this.runtimeFor(reminder, now);
      this.rollDayIfNeeded(runtime, now);

      // 生效日期（例如「中国工作日」）不满足就整条跳过。
      // 放在引擎层而不是触发器里，是为了让六种触发器共用同一套判断。
      if (!this.withinCalendar(reminder, now)) continue;

      const ctx = this.contextFor(now, runtime, global);
      const strategy = strategyFor(reminder.trigger.type);

      // ① 正常到点
      const decision = strategy.decide(reminder, reminder.trigger, ctx);
      if (decision.kind === 'fire') {
        events.push(this.fire(reminder, runtime, now, 'due', 0, ctx));
        continue;
      }

      // ② 用户没响应，按升级策略逐级加强
      const escalated = this.maybeEscalate(reminder, runtime, now, ctx);
      if (escalated) events.push(escalated);
    }

    return events;
  }

  // ---------------------------------------------------------------- 计划模式

  /**
   * 未来 horizonMs 内应当触发的时刻列表，按时间升序。
   *
   * 注意：对 activeDuration 这类基于「用户在场」的触发器，预测假设用户持续在使用电脑，
   * 属于可接受的近似；对 interval / dailyAt / weekly / pomodoro / once 是精确值。
   */
  plan(horizonMs: number): PlannedTrigger[] {
    const { global, reminders } = this.opts.getConfig();
    const now = this.opts.clock.now();
    const out: PlannedTrigger[] = [];

    for (const reminder of reminders) {
      if (!reminder.enabled || reminder.deletedAt !== null) continue;

      const runtime = this.runtimeFor(reminder, now);
      this.rollDayIfNeeded(runtime, now);
      const ctx = this.contextFor(now, runtime, global);
      const strategy = strategyFor(reminder.trigger.type);

      for (const fireAt of strategy.plan(reminder, reminder.trigger, ctx, horizonMs)) {
        if (!this.withinCalendar(reminder, fireAt)) continue;
        out.push({
          reminderId: reminder.id,
          fireAt,
          variables: strategy.variables(reminder.trigger, ctx),
        });
      }
    }

    return out.sort((a, b) => a.fireAt - b.fireAt);
  }

  // ---------------------------------------------------------------- 用户动作

  /**
   * 用户对某条提醒做出响应。
   * done      —— 完成（起身），基准归位，重新计时
   * snooze    —— 稍后提醒（默认取 reminder.snoozeMinutes[0]）
   * skip      —— 跳过本次，基准归位，冷却期后重新开始计时
   * muteToday —— 今天不再提醒
   */
  acknowledge(reminderId: string, action: ReminderAction, snoozeMinutes?: number): void {
    const config = this.opts.getConfig();
    const reminder = config.reminders.find((r) => r.id === reminderId);
    const runtime = this.runtimes.get(reminderId);
    if (!reminder || !runtime) return;

    const now = this.opts.clock.now();
    const ctx = this.contextFor(now, runtime, config.global);

    switch (action) {
      case 'done':
        strategyFor(reminder.trigger.type).onAcknowledge(runtime, reminder.trigger, ctx);
        runtime.awaitingAck = false;
        break;
      case 'snooze': {
        const minutes = snoozeMinutes ?? reminder.snoozeMinutes[0] ?? 10;
        runtime.snoozeUntil = now + minutes * 60_000;
        runtime.nextEarliestAt = 0;
        this.clearEscalation(runtime);
        // 故意保留 awaitingAck = true：稍后提醒到期时由 snoozeGate 再触发一次
        break;
      }
      case 'skip':
        strategyFor(reminder.trigger.type).onAcknowledge(runtime, reminder.trigger, ctx);
        runtime.awaitingAck = false;
        runtime.nextEarliestAt = now + reminder.trigger.cooldownMinutes * 60_000;
        this.clearEscalation(runtime);
        break;
      case 'muteToday':
        strategyFor(reminder.trigger.type).onAcknowledge(runtime, reminder.trigger, ctx);
        runtime.awaitingAck = false;
        // 跨天后由 rollDayIfNeeded 复原
        runtime.nextEarliestAt = Number.POSITIVE_INFINITY;
        this.clearEscalation(runtime);
        break;
    }
  }

  /** 供托盘 tooltip 显示「已连续坐 32 分钟」 */
  state(): { activeSeconds: number; idleSeconds: number; started: boolean } {
    return {
      activeSeconds: this.activeSeconds,
      idleSeconds: this.idleSeconds,
      started: this.lastTickAt !== null,
    };
  }

  /** 应用启动时恢复，避免重启后久坐计时归零（配合定时 snapshot 落盘） */
  restore(snapshot: EngineSnapshot): void {
    this.activeSeconds = snapshot.activeSeconds;
    this.lastTickAt = snapshot.lastTickAt;
  }

  snapshot(): EngineSnapshot {
    return { activeSeconds: this.activeSeconds, lastTickAt: this.lastTickAt };
  }

  // ---------------------------------------------------------------- 内部实现

  private advanceActiveTime(prev: number, signals: SystemSignals, g: GlobalSettings): void {
    // 锁屏 / 休眠：直接判定为「离开足够久」。
    // 若不做这一步，睡眠两小时后唤醒会被当成只离开了 20 秒，从而导致误报久坐。
    if (signals.suspended) {
      this.resetSession();
      this.idleSeconds = g.resetAfterIdleSeconds;
      return;
    }

    // 防止系统时钟跳变、未被感知的休眠产生超大 delta，按 tick 周期的 4 倍截断
    const deltaSeconds = Math.min(
      Math.max((signals.at - prev) / 1000, 0),
      g.tickSeconds * 4,
    );

    if (!signals.userPresent) {
      this.idleSeconds += deltaSeconds;
      if (this.idleSeconds >= g.resetAfterIdleSeconds) this.resetSession();
      return;
    }

    this.idleSeconds = 0;
    this.activeSeconds += deltaSeconds;
  }

  private resetSession(): void {
    this.activeSeconds = 0;
    for (const runtime of this.runtimes.values()) {
      runtime.ackedActiveSeconds = 0;
      // 用户已经离开电脑，先前的提醒不再需要催促
      runtime.awaitingAck = false;
      runtime.snoozeUntil = null;
      this.clearEscalation(runtime);
    }
  }

  private runtimeFor(reminder: Reminder, now: number): ReminderRuntime {
    const existing = this.runtimes.get(reminder.id);
    if (existing) return existing;

    const fresh: ReminderRuntime = {
      // 新建的提醒从现在开始计数，不追认之前已经坐了多久
      ackedActiveSeconds: this.activeSeconds,
      anchorAt: now,
      lastFiredAt: null,
      nextEarliestAt: 0,
      snoozeUntil: null,
      awaitingAck: false,
      escalationStep: null,
      escalationStepStartedAt: null,
      fireCountDayKey: zonedParts(now, this.opts.clock.timeZone()).dayKey,
      fireCountToday: 0,
      consumed: false,
    };
    this.runtimes.set(reminder.id, fresh);
    return fresh;
  }

  private rollDayIfNeeded(runtime: ReminderRuntime, now: number): void {
    const dayKey = zonedParts(now, this.opts.clock.timeZone()).dayKey;
    if (runtime.fireCountDayKey === dayKey) return;

    runtime.fireCountDayKey = dayKey;
    runtime.fireCountToday = 0;
    runtime.consumed = false;
    if (runtime.nextEarliestAt === Number.POSITIVE_INFINITY) runtime.nextEarliestAt = 0; // 恢复 muteToday
  }

  private contextFor(
    now: number,
    runtime: ReminderRuntime,
    settings: GlobalSettings,
  ): TriggerContext {
    return {
      now,
      timeZone: this.opts.clock.timeZone(),
      activeSeconds: this.activeSeconds,
      runtime,
      settings,
      calendar: this.calendar,
    };
  }

  private withinCalendar(reminder: Reminder, epochMs: number): boolean {
    return matchesCalendar(
      this.calendar,
      reminder.trigger.calendar,
      epochMs,
      this.opts.clock.timeZone(),
    );
  }

  private fire(
    reminder: Reminder,
    runtime: ReminderRuntime,
    now: number,
    kind: 'due' | 'escalation',
    step: number,
    ctx: TriggerContext,
  ): TriggerEvent {
    if (kind === 'due') {
      runtime.fireCountToday += 1;
      runtime.lastFiredAt = now;
      runtime.nextEarliestAt = now + reminder.trigger.cooldownMinutes * 60_000;
      runtime.snoozeUntil = null; // 到点即清除，避免 snoozeGate 每个 tick 都触发
      runtime.awaitingAck = true;
      if (reminder.trigger.type === 'once') runtime.consumed = true;
      if (reminder.escalation.enabled && reminder.escalation.steps.length > 0) {
        runtime.escalationStep = 0;
        runtime.escalationStepStartedAt = now;
      }
    }

    return {
      reminderId: reminder.id,
      reminder,
      firedAt: now,
      kind,
      escalationStep: step,
      variables: strategyFor(reminder.trigger.type).variables(reminder.trigger, ctx),
    };
  }

  private maybeEscalate(
    reminder: Reminder,
    runtime: ReminderRuntime,
    now: number,
    ctx: TriggerContext,
  ): TriggerEvent | null {
    if (!reminder.escalation.enabled) return null;
    if (runtime.escalationStep === null || runtime.escalationStepStartedAt === null) return null;
    if (runtime.snoozeUntil !== null && now < runtime.snoozeUntil) return null;

    const next = runtime.escalationStep + 1;
    if (next >= reminder.escalation.steps.length) return null; // 已到最高级，等用户响应

    const step = reminder.escalation.steps[next];
    const elapsedMs = now - runtime.escalationStepStartedAt;
    if (step === undefined || elapsedMs < step.afterMinutes * 60_000) return null;

    runtime.escalationStep = next;
    return this.fire(reminder, runtime, now, 'escalation', next, ctx);
  }

  private clearEscalation(runtime: ReminderRuntime): void {
    runtime.escalationStep = null;
    runtime.escalationStepStartedAt = null;
  }
}
