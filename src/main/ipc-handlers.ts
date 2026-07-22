import { ipcMain, dialog } from 'electron'
import { queryAllEvents, createEvent, updateEvent, deleteEvent, toggleCompletion, getIsRestoring } from './db'
import { expandOccurrences } from '../lib/recurrence'
import { solarToLunarDisplay } from '../lib/lunar'
import { performBackup, listBackups, getBackupStatus, exportToJson, importFromJson, restoreFromBackup } from './backup'
import type { CalendarEvent, Occurrence, DateRange, LunarDisplay } from '../lib/types'
import fs from 'fs'
import dayjs from 'dayjs'

/** Register all IPC handlers between renderer ↔ main process */
export function registerIpcHandlers(): void {
  // ===== Events =====

  ipcMain.handle('events:query', async (_e, rangeStart: string, rangeEnd: string) => {
    const rawEvents = queryAllEvents()
    const range: DateRange = { start: rangeStart, end: rangeEnd }
    const allOccurrences: Occurrence[] = []

    for (const raw of rawEvents) {
      const event: CalendarEvent = mapRawToEvent(raw)
      const occs = expandOccurrences(event, range)
      // Add lunar display info for each occurrence date
      for (const occ of occs) {
        const [y, m, d] = occ.date.split('-').map(Number)
        occ.lunarDate = solarToLunarDisplay(y, m, d)
      }
      allOccurrences.push(...occs)
    }

    return allOccurrences
  })

  ipcMain.handle('events:create', async (_e, eventData: any) => {
    return createEvent(eventData)
  })

  ipcMain.handle('events:update', async (_e, id: string, updates: any) => {
    updateEvent(id, updates)
  })

  ipcMain.handle('events:delete', async (_e, id: string) => {
    deleteEvent(id)
  })

  ipcMain.handle('events:toggleCompletion', async (_e, eventId: string, date: string) => {
    return toggleCompletion(eventId, date)
  })

  // ===== Lunar info =====

  ipcMain.handle('lunar:range', async (_e, rangeStart: string, rangeEnd: string) => {
    const result: Record<string, LunarDisplay> = {}
    const start = new Date(rangeStart)
    const end = new Date(rangeEnd)
    const cur = new Date(start)

    while (cur <= end) {
      const key = formatDateKey(cur)
      result[key] = solarToLunarDisplay(cur.getFullYear(), cur.getMonth() + 1, cur.getDate())
      cur.setDate(cur.getDate() + 1)
    }
    return result
  })

  ipcMain.handle('lunar:day', async (_e, year: number, month: number, day: number) => {
    return solarToLunarDisplay(year, month, day)
  })

  // ===== Backup =====

  ipcMain.handle('backup:status', async () => {
    return getBackupStatus()
  })

  ipcMain.handle('backup:list', async () => {
    return listBackups()
  })

  ipcMain.handle('backup:trigger', async () => {
    return performBackup()
  })

  ipcMain.handle('backup:export-json', async () => {
    const jsonData = exportToJson()
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: `timer-export-${dayjs().format('YYYY-MM-DD')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false, reason: 'canceled' }
    fs.writeFileSync(filePath, jsonData, 'utf-8')
    return { success: true, filePath }
  })

  ipcMain.handle('backup:pick-import-file', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: '选择导入文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, reason: 'canceled' }
    return { success: true, filePath: filePaths[0] }
  })

  ipcMain.handle('backup:import-json', async (_e, filePath: string, mode: string) => {
    if (getIsRestoring()) {
      return { success: false, importedCount: 0, skippedCount: 0, errors: ['Database is being restored, please wait'] }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return importFromJson(content, mode as any)
  })

  ipcMain.handle('backup:restore', async (_e, backupFilename: string) => {
    return restoreFromBackup(backupFilename)
  })
}

// ===== Helpers =====

function mapRawToEvent(raw: any): CalendarEvent {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    receivedDate: raw.receivedDate,
    receivedTime: raw.receivedTime,
    taskStartDate: raw.taskStartDate,
    taskStartTime: raw.taskStartTime,
    taskEndDate: raw.taskEndDate,
    taskEndTime: raw.taskEndTime,
    progress: raw.progress ?? 0,
    recurrence: raw.recurrence || null,
    lunarAnchor: raw.lunarAnchor || undefined,
    reminders: (raw.reminders || []).map((r: any) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      enabled: r.enabled,
      triggeredAt: r.triggeredAt,
      snoozedUntil: r.snoozedUntil
    })),
    color: raw.color || '#4A90D9',
    category: raw.category,
    completedDates: raw.completedDates || [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  }
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
