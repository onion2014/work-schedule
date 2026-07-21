import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ===== Event CRUD =====
  queryEvents: (rangeStart: string, rangeEnd: string) =>
    ipcRenderer.invoke('events:query', rangeStart, rangeEnd),

  createEvent: (data: any) =>
    ipcRenderer.invoke('events:create', data),

  updateEvent: (id: string, data: any) =>
    ipcRenderer.invoke('events:update', id, data),

  deleteEvent: (id: string) =>
    ipcRenderer.invoke('events:delete', id),

  toggleCompletion: (eventId: string, date: string) =>
    ipcRenderer.invoke('events:toggleCompletion', eventId, date),

  // ===== Lunar info =====
  getLunarRange: (start: string, end: string) =>
    ipcRenderer.invoke('lunar:range', start, end),

  getLunarDay: (year: number, month: number, day: number) =>
    ipcRenderer.invoke('lunar:day', year, month, day),

  // ===== Backup =====
  getBackupStatus: () =>
    ipcRenderer.invoke('backup:status'),

  listBackups: () =>
    ipcRenderer.invoke('backup:list'),

  triggerBackup: () =>
    ipcRenderer.invoke('backup:trigger'),

  exportJson: () =>
    ipcRenderer.invoke('backup:export-json'),

  importJson: (filePath: string, mode: 'replace' | 'merge' | 'merge-overwrite') =>
    ipcRenderer.invoke('backup:import-json', filePath, mode),

  pickImportFile: () =>
    ipcRenderer.invoke('backup:pick-import-file'),

  restoreBackup: (backupFilename: string) =>
    ipcRenderer.invoke('backup:restore', backupFilename),

  // ===== Platform info =====
  platform: process.platform
}

contextBridge.exposeInMainWorld('timerApi', api)
