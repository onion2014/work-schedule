/**
 * SQLite storage for work-schedule using better-sqlite3 (native, fast, synchronous).
 * Database file is stored in the program runtime directory's data/ folder.
 *
 * NOTE: better-sqlite3 is a native C++ module (.node binary).  electron-vite
 * bundles all dependencies into the main-process output, which breaks the
 * dynamic require("…node") inside bindings.  We use eval('require') so that
 * Rollup cannot trace the import at build time; the real require() is
 * resolved at runtime from node_modules (dev) or app resources (prod).
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// Dynamic require — invisible to Rollup's static analysis
const Database: typeof import('better-sqlite3') = eval('require')('better-sqlite3')

// Database file lives next to the running program: in the .exe's directory
// when packaged, or in the project root during dev. (Same convention as
// backup.ts's PROGRAM_DIR.) The previous userData location is only used to
// migrate an existing DB here on first run.
const DATA_DIR = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(app.getAppPath(), 'data')
export const DB_PATH = path.join(DATA_DIR, 'timer.db')

// Previous location (Electron userData) — the prior build wrote the live DB
// here. Used only to migrate it to the program-adjacent directory one time.
const PREV_DATA_DIR = path.join(app.getPath('userData'), 'data')
const PREV_DB_PATH = path.join(PREV_DATA_DIR, 'timer.db')
const MIGRATED_MARKER = path.join(DATA_DIR, '.migrated-to-program-dir')

let db: Database.Database

/** Whether the database is currently being restored (blocks other operations) */
let isRestoring = false
export function getIsRestoring(): boolean { return isRestoring }
export function setIsRestoring(val: boolean): void { isRestoring = val }

/** Get the live database instance (for backup module access) */
export function getDatabase(): Database.Database {
  return db
}

/** Reopen the database after restore (updates module-scoped db variable) */
export function reopenDatabase(): void {
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  // Re-create tables (harmless on existing DB)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      receivedDate TEXT NOT NULL,
      receivedTime TEXT NOT NULL,
      taskStartDate TEXT NOT NULL,
      taskStartTime TEXT NOT NULL,
      taskEndDate TEXT,
      taskEndTime TEXT,
      recurrence TEXT,
      lunarAnchor TEXT,
      color TEXT NOT NULL DEFAULT '#4A90D9',
      category TEXT,
      completedDates TEXT DEFAULT '[]',
      progress INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      offsetMinutes INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggeredAt TEXT,
      snoozedUntil TEXT,
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE
    )
  `)
}

/** Initialize the database (create tables, migrate from old path, load from file) */
export async function initDatabase(): Promise<void> {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  // One-time migration: copy the DB from the previous userData location to
  // the program-adjacent directory. userData held the live DB under the prior
  // build, so it overwrites any stale copy left here from even-older versions.
  // The marker makes this a one-shot transition (won't repeat on later runs).
  if (fs.existsSync(PREV_DB_PATH) && !fs.existsSync(MIGRATED_MARKER)) {
    console.log('Migrating database from userData to program-adjacent directory...')
    const prevWalPath = PREV_DB_PATH + '-wal'
    const prevShmPath = PREV_DB_PATH + '-shm'
    fs.copyFileSync(PREV_DB_PATH, DB_PATH)
    if (fs.existsSync(prevWalPath)) fs.copyFileSync(prevWalPath, DB_PATH + '-wal')
    if (fs.existsSync(prevShmPath)) fs.copyFileSync(prevShmPath, DB_PATH + '-shm')
    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()) } catch {}
    console.log('Database migration complete.')
  }

  db = new Database(DB_PATH)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')

  // Check if old schema (startDate column) needs migration
  const columns = db.prepare("PRAGMA table_info(events)").all() as any[]
  const hasOldSchema = columns.some(c => c.name === 'startDate')

  if (hasOldSchema) {
    console.log('Migrating event schema: startDate/startTime → receivedDate/receivedTime + taskStartDate/taskStartTime + taskEndDate/taskEndTime + progress')
    db.exec(`
      CREATE TABLE events_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        receivedDate TEXT NOT NULL,
        receivedTime TEXT NOT NULL,
        taskStartDate TEXT NOT NULL,
        taskStartTime TEXT NOT NULL,
        taskEndDate TEXT,
        taskEndTime TEXT,
        recurrence TEXT,
        lunarAnchor TEXT,
        color TEXT NOT NULL DEFAULT '#4A90D9',
        category TEXT,
        completedDates TEXT DEFAULT '[]',
        progress INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `)
    // Copy+map data: startDate → receivedDate AND taskStartDate; startTime → receivedTime AND taskStartTime (NULL→'09:00')
    db.exec(`
      INSERT INTO events_new
        (id, title, description, receivedDate, receivedTime, taskStartDate, taskStartTime,
         taskEndDate, taskEndTime, recurrence, lunarAnchor, color, category, completedDates,
         progress, createdAt, updatedAt)
      SELECT
        id, title, description,
        startDate,
        COALESCE(startTime, '09:00'),
        startDate,
        COALESCE(startTime, '09:00'),
        endDate,
        endTime,
        recurrence, lunarAnchor, color, category, completedDates,
        0,
        createdAt, updatedAt
      FROM events
    `)
    db.exec('DROP TABLE events')
    db.exec('ALTER TABLE events_new RENAME TO events')
    console.log('Event schema migration complete.')
  }

  // Create tables if they don't exist (harmless after migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      receivedDate TEXT NOT NULL,
      receivedTime TEXT NOT NULL,
      taskStartDate TEXT NOT NULL,
      taskStartTime TEXT NOT NULL,
      taskEndDate TEXT,
      taskEndTime TEXT,
      recurrence TEXT,
      lunarAnchor TEXT,
      color TEXT NOT NULL DEFAULT '#4A90D9',
      category TEXT,
      completedDates TEXT DEFAULT '[]',
      progress INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      offsetMinutes INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggeredAt TEXT,
      snoozedUntil TEXT,
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE
    )
  `)
}

// ===== Event CRUD =====

/** Query all events (for recurrence expansion) */
export function queryAllEvents(): any[] {
  const events = db.prepare('SELECT * FROM events').all() as any[]
  const reminders = db.prepare('SELECT * FROM reminders').all() as any[]

  const remindersByEvent: Record<string, any[]> = {}
  for (const r of reminders) {
    if (!remindersByEvent[r.eventId]) remindersByEvent[r.eventId] = []
    remindersByEvent[r.eventId].push({
      ...r,
      enabled: r.enabled === 1
    })
  }

  return events.map(ev => ({
    ...ev,
    recurrence: ev.recurrence ? JSON.parse(ev.recurrence) : null,
    lunarAnchor: ev.lunarAnchor ? JSON.parse(ev.lunarAnchor) : null,
    completedDates: ev.completedDates ? JSON.parse(ev.completedDates) : [],
    reminders: remindersByEvent[ev.id] || []
  }))
}

/** Query events whose received date falls in a range */
export function queryEventsByRange(rangeStart: string, rangeEnd: string): any[] {
  return queryAllEvents().filter(ev =>
    ev.receivedDate >= rangeStart && ev.receivedDate <= rangeEnd
  )
}

/** Create a new event */
export function createEvent(input: {
  title: string
  description?: string
  receivedDate: string
  receivedTime: string
  taskStartDate: string
  taskStartTime: string
  taskEndDate?: string
  taskEndTime?: string
  recurrence?: any
  lunarAnchor?: any
  color?: string
  category?: string
  progress?: number
  reminders?: Array<{ offsetMinutes: number; enabled: boolean }>
}): { id: string } {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO events (id, title, description, receivedDate, receivedTime,
      taskStartDate, taskStartTime, taskEndDate, taskEndTime,
      recurrence, lunarAnchor, color, category, completedDates, progress, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`
  ).run(
    id, input.title, input.description ?? null,
    input.receivedDate, input.receivedTime,
    input.taskStartDate, input.taskStartTime,
    input.taskEndDate ?? null, input.taskEndTime ?? null,
    input.recurrence ? JSON.stringify(input.recurrence) : null,
    input.lunarAnchor ? JSON.stringify(input.lunarAnchor) : null,
    input.color ?? '#4A90D9', input.category ?? null,
    input.progress ?? 0, now, now
  )

  if (input.reminders) {
    const insertReminder = db.prepare(
      `INSERT INTO reminders (id, eventId, offsetMinutes, enabled) VALUES (?, ?, ?, ?)`
    )
    for (const r of input.reminders) {
      insertReminder.run(crypto.randomUUID(), id, r.offsetMinutes, r.enabled ? 1 : 0)
    }
  }

  return { id }
}

/** Update an existing event */
export function updateEvent(id: string, updates: Record<string, any>): void {
  const now = new Date().toISOString()

  // Build dynamic UPDATE statement
  const fields: string[] = []
  const values: any[] = []

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
  if (updates.receivedDate !== undefined) { fields.push('receivedDate = ?'); values.push(updates.receivedDate) }
  if (updates.receivedTime !== undefined) { fields.push('receivedTime = ?'); values.push(updates.receivedTime) }
  if (updates.taskStartDate !== undefined) { fields.push('taskStartDate = ?'); values.push(updates.taskStartDate) }
  if (updates.taskStartTime !== undefined) { fields.push('taskStartTime = ?'); values.push(updates.taskStartTime) }
  if (updates.taskEndDate !== undefined) { fields.push('taskEndDate = ?'); values.push(updates.taskEndDate) }
  if (updates.taskEndTime !== undefined) { fields.push('taskEndTime = ?'); values.push(updates.taskEndTime) }
  if (updates.recurrence !== undefined) { fields.push('recurrence = ?'); values.push(updates.recurrence ? JSON.stringify(updates.recurrence) : null) }
  if (updates.lunarAnchor !== undefined) { fields.push('lunarAnchor = ?'); values.push(updates.lunarAnchor ? JSON.stringify(updates.lunarAnchor) : null) }
  if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color) }
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category) }
  if (updates.completedDates !== undefined) { fields.push('completedDates = ?'); values.push(JSON.stringify(updates.completedDates)) }
  if (updates.progress !== undefined) { fields.push('progress = ?'); values.push(updates.progress) }

  fields.push('updatedAt = ?')
  values.push(now)

  if (fields.length > 1) {
    db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  }

  // Replace reminders if provided
  if (updates.reminders) {
    db.prepare('DELETE FROM reminders WHERE eventId = ?').run(id)
    const insertReminder = db.prepare(
      `INSERT INTO reminders (id, eventId, offsetMinutes, enabled) VALUES (?, ?, ?, ?)`
    )
    for (const r of updates.reminders) {
      insertReminder.run(crypto.randomUUID(), id, r.offsetMinutes, r.enabled ? 1 : 0)
    }
  }
}

/** Delete an event and its reminders */
export function deleteEvent(id: string): void {
  db.prepare('DELETE FROM reminders WHERE eventId = ?').run(id)
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
}

/** Toggle completion status for an occurrence (eventId + specific date) */
export function toggleCompletion(eventId: string, date: string): boolean {
  const row = db.prepare('SELECT completedDates FROM events WHERE id = ?').get(eventId) as any
  if (!row) return false

  let completedDates: string[] = []
  if (row.completedDates) {
    try { completedDates = JSON.parse(row.completedDates) } catch { completedDates = [] }
  }

  const idx = completedDates.indexOf(date)
  if (idx >= 0) {
    completedDates.splice(idx, 1)
  } else {
    completedDates.push(date)
  }

  db.prepare(
    'UPDATE events SET completedDates = ?, updatedAt = ? WHERE id = ?'
  ).run(JSON.stringify(completedDates), new Date().toISOString(), eventId)

  return idx < 0 // true = just completed, false = just un-completed
}

/** Mark a reminder as triggered */
export function markReminderTriggered(reminderId: string): void {
  db.prepare(
    'UPDATE reminders SET triggeredAt = ? WHERE id = ?'
  ).run(new Date().toISOString(), reminderId)
}

/** Seed sample events on first run (when database is empty) */
export function seedSampleEvents(): void {
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM events').get() as any).cnt
  if (count > 0) return

  const today = new Date().toISOString().split('T')[0]

  createEvent({
    title: '周一团队例会',
    receivedDate: today, receivedTime: '14:00',
    taskStartDate: today, taskStartTime: '14:00',
    color: '#7B68EE',
    recurrence: { type: 'weekly', interval: 1, daysOfWeek: [1], endCondition: 'never' },
    reminders: [{ offsetMinutes: 30, enabled: true }, { offsetMinutes: 1440, enabled: true }]
  })

  createEvent({
    title: '春节',
    receivedDate: today, receivedTime: '09:00',
    taskStartDate: today, taskStartTime: '09:00',
    color: '#E74C3C',
    recurrence: { type: 'lunar-yearly', interval: 1, lunarMonth: 1, lunarDay: 1, endCondition: 'never' },
    lunarAnchor: { year: 2026, month: 1, day: 1, isLeapMonth: false },
    reminders: [{ offsetMinutes: 1440, enabled: true }, { offsetMinutes: 4320, enabled: true }]
  })

  createEvent({
    title: '端午节',
    receivedDate: today, receivedTime: '09:00',
    taskStartDate: today, taskStartTime: '09:00',
    color: '#27AE60',
    recurrence: { type: 'lunar-yearly', interval: 1, lunarMonth: 5, lunarDay: 5, endCondition: 'never' },
    lunarAnchor: { year: 2026, month: 5, day: 5, isLeapMonth: false },
    reminders: [{ offsetMinutes: 1440, enabled: true }]
  })

  createEvent({
    title: '中秋节',
    receivedDate: today, receivedTime: '09:00',
    taskStartDate: today, taskStartTime: '09:00',
    color: '#F39C12',
    recurrence: { type: 'lunar-yearly', interval: 1, lunarMonth: 8, lunarDay: 15, endCondition: 'never' },
    lunarAnchor: { year: 2026, month: 8, day: 15, isLeapMonth: false },
    reminders: [{ offsetMinutes: 2880, enabled: true }, { offsetMinutes: 1440, enabled: true }]
  })

  createEvent({
    title: '月度绩效回顾',
    receivedDate: today, receivedTime: '10:00',
    taskStartDate: today, taskStartTime: '10:00',
    color: '#1ABC9C',
    recurrence: { type: 'monthly', interval: 1, dayOfMonth: 15, endCondition: 'never' },
    reminders: [{ offsetMinutes: 60, enabled: true }]
  })

  createEvent({
    title: '交付项目报告',
    receivedDate: today, receivedTime: '09:00',
    taskStartDate: today, taskStartTime: '17:00',
    taskEndDate: today, taskEndTime: '18:00',
    color: '#8E44AD',
    progress: 30,
    reminders: [{ offsetMinutes: 120, enabled: true }, { offsetMinutes: 30, enabled: true }]
  })

  const birthdayMonth = String(new Date().getMonth() + 1).padStart(2, '0')
  const birthdayDay = String(new Date().getDate()).padStart(2, '0')
  createEvent({
    title: '生日',
    receivedDate: today, receivedTime: '09:00',
    taskStartDate: today, taskStartTime: '09:00',
    color: '#F39C12',
    recurrence: { type: 'yearly', interval: 1, monthOfYear: parseInt(birthdayMonth), dayOfMonth: parseInt(birthdayDay), endCondition: 'never' },
    reminders: [{ offsetMinutes: 0, enabled: true }]
  })
}
