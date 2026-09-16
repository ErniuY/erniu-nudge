export {
  zHHmm,
  zActiveWindow,
  zCalendarKind,
  zTrigger,
  zAssetRef,
  zReminderAction,
  zEscalationStep,
  zReminder,
} from './reminder';

export type {
  Trigger,
  ActiveDurationTrigger,
  IntervalTrigger,
  DailyAtTrigger,
  WeeklyTrigger,
  PomodoroTrigger,
  OnceTrigger,
  Reminder,
  ReminderAction,
  EscalationStep,
  OverlayCorner,
  DndPolicy,
  CalendarKind,
} from './reminder';

export { zGlobalSettings, zAssetEntry, zAppConfig, parseConfig } from './config';
export type { GlobalSettings, AppConfig, AssetEntry, ParseResult } from './config';

export {
  newId,
  defaultGlobalSettings,
  defaultConfig,
  standUpTemplate,
  drinkWaterTemplate,
  medicationTemplate,
  TEMPLATES,
} from './defaults';
