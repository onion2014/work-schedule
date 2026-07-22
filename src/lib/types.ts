// ===== Core Type Definitions =====

/** Supported recurrence pattern types */
export type RecurrenceType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'lunar-yearly'
  | 'lunar-monthly'

/** How a recurrence series ends */
export type EndCondition = 'never' | 'date' | 'count'

/** A recurrence rule attached to an event */
export interface RecurrenceRule {
  type: RecurrenceType
  interval: number // every N units (1 = every, 2 = every other)
  // Weekly: which days of week (0=Sun..6=Sat)
  daysOfWeek?: number[]
  // Monthly: day of month
  dayOfMonth?: number
  // Yearly: month + day
  monthOfYear?: number
  // Lunar yearly: lunar month (negative = leap, e.g. -4 = 闰四月)
  lunarMonth?: number
  lunarDay?: number
  // Lunar monthly: lunar day of month
  lunarDayOfMonth?: number
  // End condition
  endCondition: EndCondition
  endDate?: string // ISO date (for 'date' end)
  endCount?: number // max occurrences (for 'count' end)
}

/** Anchor lunar date for a lunar-recurring event */
export interface LunarAnchor {
  year: number
  month: number // positive = normal, negative = leap (e.g., -4 = 闰四月)
  day: number
  isLeapMonth: boolean
}

/** A reminder attached to an event */
export interface Reminder {
  id: string
  offsetMinutes: number // minutes before event start; for all-day: before 09:00 of that day
  enabled: boolean
  triggeredAt?: string
  snoozedUntil?: string
}

/** A calendar event (single or recurring) — task tracking model */
export interface CalendarEvent {
  id: string
  title: string
  description?: string
  // 需求接收时间 — determines which calendar day the event appears on
  receivedDate: string // YYYY-MM-DD
  receivedTime: string // HH:mm
  // 任务开始时间 — when the task begins (reminders fire relative to this)
  taskStartDate: string // YYYY-MM-DD
  taskStartTime: string // HH:mm
  // 任务结束时间 — when the task is due
  taskEndDate: string // YYYY-MM-DD
  taskEndTime: string // HH:mm
  // 进度 0-100%
  progress: number
  recurrence: RecurrenceRule | null
  lunarAnchor?: LunarAnchor
  reminders: Reminder[]
  color: string
  category?: string
  completedDates: string[] // dates where this event was marked as completed
  createdAt: string
  updatedAt: string
}

/** An expanded occurrence of an event on a specific date */
export interface Occurrence {
  eventId: string
  date: string // YYYY-MM-DD (receivedDate determines this)
  receivedTime: string // HH:mm
  taskStartDate: string // YYYY-MM-DD
  taskStartTime: string // HH:mm
  taskEndDate: string // YYYY-MM-DD
  taskEndTime: string // HH:mm
  progress: number // 0-100%
  title: string
  color: string
  completed: boolean // whether this occurrence is marked as completed (progress >= 100)
  recurrence?: RecurrenceRule | null
  reminders?: Reminder[]
  lunarDate?: LunarDisplay
}

/** Lunar date display info for a calendar cell */
export interface LunarDisplay {
  year: number
  month: number
  monthName: string // "正月", "二月", "闰四月"
  day: number
  dayName: string // "初一", "十五", "三十"
  isLeapMonth: boolean
  ganzhiYear?: string // "丙午"
  ganzhiMonth?: string
  ganzhiDay?: string
  zodiac?: string // "马"
  solarTerm?: string // "小暑" (if this day is a 节气)
  festival?: string[] // traditional festivals
}

/** Date range for querying/expanding */
export interface DateRange {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
}

/** A reminder notification that should be fired */
export interface ReminderNotification {
  eventId: string
  eventTitle: string
  occurrenceDate: string
  occurrenceTime?: string
  reminderOffsetMinutes: number
  triggerTime: string // ISO datetime
  fired: boolean
}

// ===== Backup Types =====

/** Backup tier classification */
export type BackupTier = 'daily' | 'weekly' | 'monthly'

/** Single backup file metadata */
export interface BackupInfo {
  filename: string
  date: string          // YYYY-MM-DD
  size: number          // bytes
  tier: BackupTier
}

/** Backup health/status report */
export interface BackupStatus {
  lastBackupTime: string | null
  lastBackupError: string | null
  backupCount: number
  backupDirSize: number
  nextBackupTime: string | null
  dbFileSize: number
  dbPath: string
  backupDirPath: string
}

/** JSON import conflict resolution mode */
export type ImportMode = 'replace' | 'merge' | 'merge-overwrite'

/** JSON export envelope format */
export interface JsonExportEnvelope {
  version: number
  exportedAt: string
  appName: string
  appVersion: string
  events: CalendarEvent[]
}

/** Preload API exposed to renderer */
export interface TimerApi {
  // Event CRUD
  queryEvents: (start: string, end: string) => Promise<Occurrence[]>
  createEvent: (data: Partial<CalendarEvent>) => Promise<{ id: string }>
  updateEvent: (id: string, data: Partial<CalendarEvent>) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
  toggleCompletion: (eventId: string, date: string) => Promise<boolean>
  // Lunar info
  getLunarRange: (start: string, end: string) => Promise<Record<string, LunarDisplay>>
  getLunarDay: (year: number, month: number, day: number) => Promise<LunarDisplay>
  // Backup
  getBackupStatus: () => Promise<BackupStatus>
  listBackups: () => Promise<BackupInfo[]>
  triggerBackup: () => Promise<{ success: boolean; filename?: string; error?: string }>
  exportJson: () => Promise<{ success: boolean; filePath?: string; reason?: string }>
  importJson: (filePath: string, mode: ImportMode) => Promise<{ success: boolean; importedCount: number; skippedCount: number; errors: string[] }>
  pickImportFile: () => Promise<{ success: boolean; filePath?: string; reason?: string }>
  restoreBackup: (backupFilename: string) => Promise<{ success: boolean; preRestoreBackup?: string; error?: string }>
  // Platform
  platform: string
}
