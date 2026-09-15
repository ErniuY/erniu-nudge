export { ReminderEngine } from './engine';
export { SystemClock } from './clock';
export { strategyFor } from './triggers';

export type { Clock } from './clock';
export type { ActivityProvider, SystemSignals } from './activity';
export type {
  EngineConfig,
  EngineOptions,
  EngineSnapshot,
  PlannedTrigger,
  ReminderRuntime,
  TemplateVariables,
  TriggerEvent,
} from './types';
export type { ReminderAction, Reminder, Trigger } from '@app/schema';

export {
  formatClockTime,
  localWallToEpoch,
  nextDailyOccurrence,
  nextWeeklyOccurrence,
  offsetMsAt,
  withinActiveWindow,
  zonedParts,
} from './localTime';
