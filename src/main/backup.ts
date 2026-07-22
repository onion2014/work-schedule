/**
 * Backup module for work-schedule.
 *
 * Provides:
 *  - Automatic scheduled SQLite file-copy backups with tiered rotation
 *  - Manual JSON export/import
 *  - Restoration from SQLite backups
 *  - Backup health/status reporting
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import dayjs from 'dayjs'
import { getDatabase, getIsRestoring, setIsRestoring, reopenDatabase, queryAllEvents, DB_PATH } from './db'
import { stopReminderScheduler, startReminderScheduler } from './scheduler'

// Dynamic require — invisible to Rollup's static analysis
const Database: typeof import('better-sqlite3') = eval('require')('better-sqlite3')

// ===== Paths =====
// Backup directory sits next to the running program: next to the .exe in
// packaged builds, or in the project root during dev. (Same convention as
// db.ts's DATA_DIR.) Old backups left in userData are migrated on startup.
// DB_PATH (the database file to back up / restore) is imported from db.ts so
// there is a single source of truth for the DB location.
const PROGRAM_DIR = app.isPackaged
  ? path.dirname(process.execPath)
  : app.getAppPath()
const BACKUP_DIR = path.join(PROGRAM_DIR, 'backups')
const OLD_BACKUP_DIR = path.join(app.getPath('userData'), 'backups')

// ===== Config =====
// Backup filename prefix. Old 'timer-' backups are still listed/restorable
// for backward compatibility, but new backups use 'work-schedule-'.
const BACKUP_PREFIX = 'work-schedule-'
const OLD_BACKUP_PREFIX = 'timer-'
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000   // 24 hours
const INITIAL_BACKUP_DELAY_MS = 30_000             // 30 seconds after startup
const RETRY_DELAY_MS = 3_600_000                   // 1 hour retry on failure
const MAX_IMPORT_EVENTS = 10_000
const JSON_EXPORT_VERSION = 2

// ===== Tiered rotation config =====
const DAILY_KEEP_DAYS = 7
const WEEKLY_KEEP_WEEKS = 4
const MONTHLY_KEEP_MONTHS = 3

// ===== Scheduler state =====
let backupTimer: NodeJS.Timeout | null = null
let lastBackupTime: string | null = null
let lastBackupError: string | null = null
let retryTimer: NodeJS.Timeout | null = null

// ===== Types =====

interface BackupFile {
  filename: string
  date: dayjs.Dayjs
  path: string
  size: number
}

type BackupTier = 'daily' | 'weekly' | 'monthly'

// ===== Backup scheduler =====

/**
 * One-time migration: copy existing backups from the old userData location
 * to the new program-adjacent BACKUP_DIR, so nothing is orphaned when the
 * directory changes. Safe to run repeatedly — existing files are skipped.
 */
function migrateBackupsFromOldLocation(): void {
  try {
    if (!fs.existsSync(OLD_BACKUP_DIR)) return
    const oldFiles = fs
      .readdirSync(OLD_BACKUP_DIR)
      .filter(f => (f.startsWith(BACKUP_PREFIX) || f.startsWith(OLD_BACKUP_PREFIX)) && f.endsWith('.db'))
    if (oldFiles.length === 0) return

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }
    for (const f of oldFiles) {
      const src = path.join(OLD_BACKUP_DIR, f)
      const dst = path.join(BACKUP_DIR, f)
      if (fs.existsSync(dst)) continue // don't overwrite
      try { fs.copyFileSync(src, dst) } catch {}
    }
  } catch {
    // Migration is best-effort; never block startup on it.
  }
}

export function startBackupScheduler(): void {
  migrateBackupsFromOldLocation()

  // Initial backup after startup stabilizes
  setTimeout(() => {
    try {
      performBackup()
      lastBackupTime = new Date().toISOString()
      lastBackupError = null
    } catch (e) {
      lastBackupError = (e as Error).message
      console.error('Initial backup failed:', lastBackupError)
    }
  }, INITIAL_BACKUP_DELAY_MS)

  // Schedule periodic backups
  backupTimer = setInterval(() => {
    try {
      performBackup()
      lastBackupTime = new Date().toISOString()
      lastBackupError = null
    } catch (e) {
      lastBackupError = (e as Error).message
      console.error('Scheduled backup failed:', lastBackupError)
      // Retry in 1 hour
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          try {
            performBackup()
            lastBackupTime = new Date().toISOString()
            lastBackupError = null
          } catch (e2) {
            lastBackupError = (e2 as Error).message
            console.error('Retry backup failed:', lastBackupError)
          }
          retryTimer = null
        }, RETRY_DELAY_MS)
      }
    }
  }, BACKUP_INTERVAL_MS)
}

export function stopBackupScheduler(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

// ===== Core backup =====

/** Perform a single backup: checkpoint WAL → copy DB → verify integrity → rotate */
export function performBackup(): { success: boolean; filename?: string; error?: string } {
  if (getIsRestoring()) {
    return { success: false, error: 'Database is being restored' }
  }

  const db = getDatabase()
  const today = dayjs().format('YYYY-MM-DD')
  const filename = `${BACKUP_PREFIX}${today}.db`
  const backupPath = path.join(BACKUP_DIR, filename)

  try {
    // 1. WAL checkpoint — flush all WAL content into main DB file
    db.pragma('wal_checkpoint(TRUNCATE)')

    // 2. Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }

    // 3. Copy the DB file (WAL has been truncated, .db file is complete)
    fs.copyFileSync(DB_PATH, backupPath)

    // 4. Verify backup integrity
    if (!verifyBackupIntegrity(backupPath)) {
      // Bad backup — delete it and report error
      try { fs.unlinkSync(backupPath) } catch {}
      return { success: false, error: 'Backup integrity check failed' }
    }

    // 5. Rotate old backups
    rotateBackups()

    lastBackupTime = new Date().toISOString()
    lastBackupError = null
    return { success: true, filename }
  } catch (e) {
    lastBackupError = (e as Error).message
    return { success: false, error: lastBackupError }
  }
}

// ===== Integrity check =====

function verifyBackupIntegrity(backupPath: string): boolean {
  try {
    const testDb = new Database(backupPath)
    const result = testDb.pragma('integrity_check') as any[]
    testDb.close()
    return result[0]?.integrity_check === 'ok'
  } catch {
    return false
  }
}

// ===== Tiered rotation =====

/** Rotate backups: keep last 7 daily + last 4 weekly + last 3 monthly */
function rotateBackups(): void {
  const files = listBackupFilesRaw()
  const today = dayjs()
  const keepSet = new Set<string>()

  // Keep all backups from last 7 days (daily tier)
  for (const f of files) {
    if (today.diff(f.date, 'day') < DAILY_KEEP_DAYS) {
      keepSet.add(f.filename)
    }
  }

  // Weekly: for each of the last 4 weeks, keep the most recent backup
  for (let w = 1; w <= WEEKLY_KEEP_WEEKS; w++) {
    const weekStart = today.subtract(w, 'week').startOf('week')
    const weekEnd = today.subtract(w, 'week').endOf('week')
    const weekBackups = files.filter(f =>
      f.date.isAfter(weekStart) || f.date.isSame(weekStart, 'day') &&
      (f.date.isBefore(weekEnd) || f.date.isSame(weekEnd, 'day'))
    )
    if (weekBackups.length > 0) {
      const mostRecent = weekBackups.sort((a, b) => b.date.unix() - a.date.unix())[0]
      keepSet.add(mostRecent.filename)
    }
  }

  // Monthly: for each of the last 3 months, keep the most recent backup
  for (let m = 1; m <= MONTHLY_KEEP_MONTHS; m++) {
    const monthStart = today.subtract(m, 'month').startOf('month')
    const monthEnd = today.subtract(m, 'month').endOf('month')
    const monthBackups = files.filter(f =>
      f.date.isAfter(monthStart) || f.date.isSame(monthStart, 'day') &&
      (f.date.isBefore(monthEnd) || f.date.isSame(monthEnd, 'day'))
    )
    if (monthBackups.length > 0) {
      const mostRecent = monthBackups.sort((a, b) => b.date.unix() - a.date.unix())[0]
      keepSet.add(mostRecent.filename)
    }
  }

  // Also keep pre-restore backups (they have special naming)
  for (const f of files) {
    if (f.filename.startsWith(BACKUP_PREFIX + 'pre-restore-') || f.filename.startsWith(OLD_BACKUP_PREFIX + 'pre-restore-')) {
      keepSet.add(f.filename)
    }
  }

  // Delete anything not in keepSet
  for (const f of files) {
    if (!keepSet.has(f.filename)) {
      try { fs.unlinkSync(f.path) } catch {}
    }
  }
}

// ===== List backups =====

function listBackupFilesRaw(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return []

  const entries = fs.readdirSync(BACKUP_DIR)
  const files: BackupFile[] = []

  for (const entry of entries) {
    if (!entry.startsWith(BACKUP_PREFIX) && !entry.startsWith(OLD_BACKUP_PREFIX) || !entry.endsWith('.db')) continue
    // Parse date from filename: work-schedule-YYYY-MM-DD.db or timer-YYYY-MM-DD.db
    const dateMatch = entry.match(/^(?:work-schedule-|timer-)(\d{4}-\d{2}-\d{2})\.db$/)
    if (!dateMatch) continue // Skip non-standard filenames (e.g. pre-restore)

    const filePath = path.join(BACKUP_DIR, entry)
    let stat: fs.Stats
    try { stat = fs.statSync(filePath) } catch { continue }

    files.push({
      filename: entry,
      date: dayjs(dateMatch[1]),
      path: filePath,
      size: stat.size
    })
  }

  return files.sort((a, b) => b.date.unix() - a.date.unix()) // Most recent first
}

/** Classify a backup's tier based on its age */
function classifyTier(backupDate: dayjs.Dayjs): BackupTier {
  const today = dayjs()
  const ageDays = today.diff(backupDate, 'day')

  if (ageDays < DAILY_KEEP_DAYS) return 'daily'
  if (ageDays < WEEKLY_KEEP_WEEKS * 7) return 'weekly'
  return 'monthly'
}

/** List backups with tier classification (for UI) */
export function listBackups(): Array<{ filename: string; date: string; size: number; tier: BackupTier }> {
  return listBackupFilesRaw().map(f => ({
    filename: f.filename,
    date: f.date.format('YYYY-MM-DD'),
    size: f.size,
    tier: classifyTier(f.date)
  }))
}

// ===== Backup status =====

export function getBackupStatus(): {
  lastBackupTime: string | null
  lastBackupError: string | null
  backupCount: number
  backupDirSize: number
  nextBackupTime: string | null
  dbFileSize: number
  dbPath: string
  backupDirPath: string
} {
  // Calculate backup directory size
  let backupDirSize = 0
  let backupCount = 0
  if (fs.existsSync(BACKUP_DIR)) {
    const entries = fs.readdirSync(BACKUP_DIR)
    for (const entry of entries) {
      try {
        const stat = fs.statSync(path.join(BACKUP_DIR, entry))
        backupDirSize += stat.size
        if (entry.startsWith(BACKUP_PREFIX) && entry.endsWith('.db')) backupCount++
      } catch {}
    }
  }

  // Current DB size
  let dbFileSize = 0
  try { dbFileSize = fs.statSync(DB_PATH).size } catch {}

  // Estimated next backup time
  let nextBackupTime: string | null = null
  if (lastBackupTime) {
    nextBackupTime = dayjs(lastBackupTime).add(BACKUP_INTERVAL_MS, 'ms').toISOString()
  }

  return {
    lastBackupTime,
    lastBackupError,
    backupCount,
    backupDirSize,
    nextBackupTime,
    dbFileSize,
    dbPath: DB_PATH,
    backupDirPath: BACKUP_DIR
  }
}

// ===== JSON export =====

export function exportToJson(): string {
  const rawEvents = queryAllEvents()
  const events = rawEvents.map(ev => ({
    id: ev.id,
    title: ev.title,
    description: ev.description ?? null,
    receivedDate: ev.receivedDate,
    receivedTime: ev.receivedTime,
    taskStartDate: ev.taskStartDate,
    taskStartTime: ev.taskStartTime,
    taskEndDate: ev.taskEndDate ?? null,
    taskEndTime: ev.taskEndTime ?? null,
    progress: ev.progress ?? 0,
    recurrence: ev.recurrence || null,
    lunarAnchor: ev.lunarAnchor || null,
    color: ev.color || '#4A90D9',
    category: ev.category ?? null,
    completedDates: ev.completedDates || [],
    createdAt: ev.createdAt,
    updatedAt: ev.updatedAt,
    reminders: (ev.reminders || []).map((r: any) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      enabled: r.enabled,
      triggeredAt: r.triggeredAt ?? null,
      snoozedUntil: r.snoozedUntil ?? null
    }))
  }))

  const envelope = {
    version: JSON_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: 'work-schedule',
    appVersion: app.getVersion() || '0.1.0',
    events
  }

  return JSON.stringify(envelope, null, 2)
}

// ===== JSON import =====

export type ImportMode = 'replace' | 'merge' | 'merge-overwrite'

export function importFromJson(
  jsonContent: string,
  mode: ImportMode = 'merge-overwrite'
): { success: boolean; importedCount: number; skippedCount: number; errors: string[] } {
  // 1. Parse JSON
  let data: any
  try {
    data = JSON.parse(jsonContent)
  } catch {
    return { success: false, importedCount: 0, skippedCount: 0, errors: ['Invalid JSON format'] }
  }

  // 2. Validate version
  if (!data.version || typeof data.version !== 'number') {
    return { success: false, importedCount: 0, skippedCount: 0, errors: ['Missing or invalid version field'] }
  }
  if (data.version > JSON_EXPORT_VERSION) {
    return { success: false, importedCount: 0, skippedCount: 0, errors: [`Unsupported version: ${data.version} (max supported: ${JSON_EXPORT_VERSION})`] }
  }

  // 3. Validate events array
  if (!Array.isArray(data.events)) {
    return { success: false, importedCount: 0, skippedCount: 0, errors: ['Missing events array'] }
  }
  if (data.events.length > MAX_IMPORT_EVENTS) {
    return { success: false, importedCount: 0, skippedCount: 0, errors: [`Too many events: ${data.events.length} (max: ${MAX_IMPORT_EVENTS})`] }
  }

  // Normalize v1 (old format with startDate/startTime) to v2 (new format)
  if (data.version === 1) {
    for (const ev of data.events) {
      if (ev.startDate && !ev.receivedDate) {
        ev.receivedDate = ev.startDate
        ev.receivedTime = ev.startTime || '09:00'
        ev.taskStartDate = ev.startDate
        ev.taskStartTime = ev.startTime || '09:00'
        ev.taskEndDate = ev.endDate
        ev.taskEndTime = ev.endTime
        ev.progress = 0
        delete ev.startDate
        delete ev.startTime
        delete ev.endDate
        delete ev.endTime
      }
    }
  }

  // 4. Validate each event
  const errors: string[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < data.events.length; i++) {
    const ev = data.events[i]
    if (!ev.id) { errors.push(`Event #${i + 1}: missing id`); continue }
    if (!ev.title) { errors.push(`Event #${i + 1}: missing title`); continue }
    if (!ev.receivedDate) { errors.push(`Event #${i + 1}: missing receivedDate`); continue }
    if (seenIds.has(ev.id)) { errors.push(`Event #${i + 1}: duplicate id "${ev.id}"`); continue }
    seenIds.add(ev.id)
  }
  if (errors.length > 0) {
    return { success: false, importedCount: 0, skippedCount: 0, errors }
  }

  // 5. Import with the specified mode
  const db = getDatabase()
  let importedCount = 0
  let skippedCount = 0

  if (mode === 'replace') {
    // Delete all existing events first
    db.prepare('DELETE FROM reminders').run()
    db.prepare('DELETE FROM events').run()
  }

  const insertEvent = db.prepare(
    `INSERT OR REPLACE INTO events (id, title, description, receivedDate, receivedTime,
      taskStartDate, taskStartTime, taskEndDate, taskEndTime,
      recurrence, lunarAnchor, color, category, completedDates, progress, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const deleteReminders = db.prepare('DELETE FROM reminders WHERE eventId = ?')
  const insertReminder = db.prepare(
    `INSERT INTO reminders (id, eventId, offsetMinutes, enabled) VALUES (?, ?, ?, ?)`
  )

  const importTransaction = db.transaction(() => {
    for (const ev of data.events) {
      if (mode === 'merge') {
        // Skip if event already exists
        const existing = db.prepare('SELECT id FROM events WHERE id = ?').get(ev.id)
        if (existing) {
          skippedCount++
          continue
        }
      }

      // Insert/replace event
      insertEvent.run(
        ev.id,
        ev.title,
        ev.description ?? null,
        ev.receivedDate,
        ev.receivedTime,
        ev.taskStartDate,
        ev.taskStartTime,
        ev.taskEndDate ?? null,
        ev.taskEndTime ?? null,
        ev.recurrence ? JSON.stringify(ev.recurrence) : null,
        ev.lunarAnchor ? JSON.stringify(ev.lunarAnchor) : null,
        ev.color ?? '#4A90D9',
        ev.category ?? null,
        ev.completedDates ? JSON.stringify(ev.completedDates) : '[]',
        ev.progress ?? 0,
        ev.createdAt ?? new Date().toISOString(),
        ev.updatedAt ?? new Date().toISOString()
      )

      // Insert reminders
      if (Array.isArray(ev.reminders)) {
        deleteReminders.run(ev.id)
        for (const r of ev.reminders) {
          insertReminder.run(
            r.id ?? crypto.randomUUID(),
            ev.id,
            r.offsetMinutes ?? 0,
            r.enabled ? 1 : 0
          )
        }
      }

      importedCount++
    }
  })

  try {
    importTransaction()
  } catch (e) {
    return { success: false, importedCount: 0, skippedCount: 0, errors: [`Import transaction failed: ${(e as Error).message}`] }
  }

  return { success: true, importedCount, skippedCount, errors: [] }
}

// ===== Restore from SQLite backup =====

export function restoreFromBackup(backupFilename: string): {
  success: boolean
  preRestoreBackup?: string
  error?: string
} {
  if (getIsRestoring()) {
    return { success: false, error: 'Already restoring' }
  }

  const backupPath = path.join(BACKUP_DIR, backupFilename)

  // 1. Validate backup file exists
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: `Backup file not found: ${backupFilename}` }
  }

  // 2. Validate backup is a valid SQLite file with expected tables
  try {
    const testDb = new Database(backupPath)
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]
    testDb.close()
    const tableNames = tables.map(t => t.name)
    if (!tableNames.includes('events') || !tableNames.includes('reminders')) {
      return { success: false, error: 'Backup file does not contain expected tables (events, reminders)' }
    }
  } catch (e) {
    return { success: false, error: `Backup file is not a valid SQLite database: ${(e as Error).message}` }
  }

  // 3. Verify backup integrity
  if (!verifyBackupIntegrity(backupPath)) {
    return { success: false, error: 'Backup integrity check failed' }
  }

  // 4. Create pre-restore safety backup
  const now = dayjs()
  const preRestoreFilename = `${BACKUP_PREFIX}pre-restore-${now.format('YYYY-MM-DD-HHmmss')}.db`
  const preRestorePath = path.join(BACKUP_DIR, preRestoreFilename)
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true })
    }
    // Checkpoint current DB first
    const db = getDatabase()
    db.pragma('wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(DB_PATH, preRestorePath)
  } catch (e) {
    return { success: false, error: `Failed to create pre-restore backup: ${(e as Error).message}` }
  }

  // 5. Set restoring flag
  setIsRestoring(true)

  try {
    // 6. Close current database
    const db = getDatabase()
    db.close()

    // 7. Replace current DB with backup
    fs.copyFileSync(backupPath, DB_PATH)

    // 8. Delete stale WAL and SHM files
    const walPath = DB_PATH + '-wal'
    const shmPath = DB_PATH + '-shm'
    try { if (fs.existsSync(walPath)) fs.unlinkSync(walPath) } catch {}
    try { if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath) } catch {}

    // 9. Re-open the database via db.ts (updates module-scoped variable)
    reopenDatabase()

    // 10. Restart reminder scheduler
    stopReminderScheduler()
    startReminderScheduler()

    setIsRestoring(false)
    return { success: true, preRestoreBackup: preRestoreFilename }
  } catch (e) {
    // Attempt to recover by reopening original DB from pre-restore
    try {
      fs.copyFileSync(preRestorePath, DB_PATH)
      const walPath = DB_PATH + '-wal'
      const shmPath = DB_PATH + '-shm'
      try { if (fs.existsSync(walPath)) fs.unlinkSync(walPath) } catch {}
      try { if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath) } catch {}
    } catch {}
    setIsRestoring(false)
    return { success: false, error: `Restore failed: ${(e as Error).message}` }
  }
}
