"use strict";
const electron = require("electron");
const api = {
  // ===== Event CRUD =====
  queryEvents: (rangeStart, rangeEnd) => electron.ipcRenderer.invoke("events:query", rangeStart, rangeEnd),
  createEvent: (data) => electron.ipcRenderer.invoke("events:create", data),
  updateEvent: (id, data) => electron.ipcRenderer.invoke("events:update", id, data),
  deleteEvent: (id) => electron.ipcRenderer.invoke("events:delete", id),
  toggleCompletion: (eventId, date) => electron.ipcRenderer.invoke("events:toggleCompletion", eventId, date),
  // ===== Lunar info =====
  getLunarRange: (start, end) => electron.ipcRenderer.invoke("lunar:range", start, end),
  getLunarDay: (year, month, day) => electron.ipcRenderer.invoke("lunar:day", year, month, day),
  // ===== Backup =====
  getBackupStatus: () => electron.ipcRenderer.invoke("backup:status"),
  listBackups: () => electron.ipcRenderer.invoke("backup:list"),
  triggerBackup: () => electron.ipcRenderer.invoke("backup:trigger"),
  exportJson: () => electron.ipcRenderer.invoke("backup:export-json"),
  importJson: (filePath, mode) => electron.ipcRenderer.invoke("backup:import-json", filePath, mode),
  pickImportFile: () => electron.ipcRenderer.invoke("backup:pick-import-file"),
  restoreBackup: (backupFilename) => electron.ipcRenderer.invoke("backup:restore", backupFilename),
  // ===== Platform info =====
  platform: process.platform
};
electron.contextBridge.exposeInMainWorld("timerApi", api);
