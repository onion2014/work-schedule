import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase, queryAllEvents, seedSampleEvents } from './db'
import { registerIpcHandlers } from './ipc-handlers'
import { startReminderScheduler } from './scheduler'
import { startBackupScheduler, stopBackupScheduler } from './backup'
import { expandOccurrences } from '../lib/recurrence'
import type { CalendarEvent } from '../lib/types'
import dayjs from 'dayjs'

// Disable GPU acceleration to avoid crashes on some Windows configurations
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let scrollTimer: NodeJS.Timeout | null = null
let scrollIndex = 0

// Tray flashing state
let flashTimer: NodeJS.Timeout | null = null
let isFlashing = false
let flashPhase = false // false = show normal icon, true = show blank icon

// Tray hover popup state
let popupWindow: BrowserWindow | null = null
let hidePopupTimer: NodeJS.Timeout | null = null
let isPopupVisible = false
let popupContentLoaded = false

// Cached pending events (refreshed periodically and on window focus)
let cachedPending: { time: string; title: string; color: string }[] = []
let lastCacheDate = ''

// Normal tray icon (cached)
let normalTrayIcon: Electron.NativeImage
// Blank (transparent) tray icon for flashing
let blankTrayIcon: Electron.NativeImage

// Single-instance lock — only one calendar app at a time
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

function createMainWindow() {
  const appIcon = nativeImage.createFromPath(path.join(__dirname, '../../resources/icon.png'))

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 640,
    show: false,
    title: 'work-schedule',
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    // Start scrolling taskbar title immediately
    refreshPendingCache()
    startScroll()
  })

  // In dev: load from Vite dev server. In prod: load from built file.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}


function createTray() {
  try {
    const iconPath = path.join(__dirname, '../../resources/icon.png')
    if (fs.existsSync(iconPath)) {
      normalTrayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    } else {
      normalTrayIcon = createPlaceholderIcon()
    }
  } catch {
    return
  }

  blankTrayIcon = createBlankIcon()

  tray = new Tray(normalTrayIcon)

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开日历', click: () => { stopFlashing(); hidePopup(); if (!mainWindow) createMainWindow(); mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])

  tray.setToolTip('')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    stopFlashing()
    hidePopup()
    if (!mainWindow) createMainWindow()
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Hover popup: show on mouse-move over tray icon
  tray.on('mouse-move', () => {
    showPopupNearTray()
  })

  // Hide popup when mouse leaves tray (with debounce)
  tray.on('mouse-leave', () => {
    scheduleHidePopup()
  })
}

/** Generate a minimal 16×16 blue PNG for tray placeholder */
function createPlaceholderIcon(): Electron.NativeImage {
  const w = 16, h = 16
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = 0x5B
    buf[i * 4 + 1] = 0x7F
    buf[i * 4 + 2] = 0xFF
    buf[i * 4 + 3] = 0xFF
  }
  return nativeImage.createFromBuffer(buf, { width: w, height: h })
}

/** Generate a 16×16 fully transparent PNG for flash blank state */
function createBlankIcon(): Electron.NativeImage {
  const w = 16, h = 16
  // All RGBA = 0 (fully transparent)
  const buf = Buffer.alloc(w * h * 4)
  return nativeImage.createFromBuffer(buf, { width: w, height: h })
}

// ===== Tray Icon Flashing =====

/** Start flashing the tray icon (WeChat-style alternate between normal and blank) */
function startFlashing(): void {
  if (isFlashing) return
  isFlashing = true
  flashPhase = false
  flashTimer = setInterval(() => {
    flashPhase = !flashPhase
    tray?.setImage(flashPhase ? blankTrayIcon : normalTrayIcon)
  }, 500)
}

/** Stop flashing and restore normal tray icon */
function stopFlashing(): void {
  if (!isFlashing) return
  isFlashing = false
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  tray?.setImage(normalTrayIcon)
  flashPhase = false
}

// ===== Tray Hover Popup =====

/** Create the popup BrowserWindow (lazy — only created on first hover) */
function ensurePopupWindow(): BrowserWindow {
  if (popupWindow && !popupWindow.isDestroyed()) return popupWindow

  popupContentLoaded = false
  popupWindow = new BrowserWindow({
    width: 280,
    height: 200, // will be resized dynamically
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Cursor entered the popup — cancel any pending hide so the popup
  // stays open while the user reads it (prevents hide-flicker when the
  // cursor travels from tray onto the popup).
  popupWindow.on('mouse-enter', () => {
    if (hidePopupTimer) {
      clearTimeout(hidePopupTimer)
      hidePopupTimer = null
    }
  })

  // Hide popup when mouse leaves the popup window itself
  popupWindow.on('mouse-leave', () => {
    scheduleHidePopup()
  })

  // Track when the base template has finished loading so we can update
  // its content via executeJavaScript instead of reloading (avoids the
  // blank-white flash that loadURL causes on every show).
  popupWindow.webContents.on('did-finish-load', () => {
    popupContentLoaded = true
  })

  // Load the base HTML template once; content is injected later.
  popupWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPopupTemplate()))

  // Never let popup appear in taskbar or steal focus
  popupWindow.setVisibleOnAllWorkspaces(false)

  return popupWindow
}

/**
 * Build the static base HTML template for the hover popup.
 * Loaded ONCE into the popup BrowserWindow; the dynamic content (header +
 * items) is injected later via `window._setContent(html)` so we never reload
 * the page (which would cause a blank-white flash on every show).
 */
function buildPopupTemplate(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  body {
    width: 280px;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .popup {
    width: 280px;
    box-sizing: border-box;
    padding: 0;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.18), 0 0 1px rgba(0,0,0,0.1);
    background: #ffffff;
  }
  .header {
    padding: 10px 14px 8px;
    font-size: 13px;
    color: #555;
    border-bottom: 1px solid #eee;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .header .icon { font-size: 14px; }
  .items {
    padding: 6px 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .item {
    display: flex;
    align-items: center;
    padding: 6px 14px;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
  }
  .item.empty {
    color: #999;
    justify-content: center;
    padding: 16px 14px;
    font-size: 13px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .time {
    color: #888;
    font-size: 11px;
    min-width: 42px;
    flex-shrink: 0;
  }
  .title {
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
</style>
</head>
<body>
<div class="popup">
  <div class="header">
    <span class="icon">📋</span>
    <span id="header-text"></span>
  </div>
  <div class="items" id="items"></div>
</div>
<script>
  // Called from main process via executeJavaScript to inject fresh content
  // without reloading the page.
  window._setContent = function (headerHtml, itemsHtml) {
    document.getElementById('header-text').innerHTML = headerHtml;
    document.getElementById('items').innerHTML = itemsHtml;
  };
</script>
</body>
</html>`
}

/** Build the inner HTML (header + items) for the popup based on current pending items */
function buildPopupContent(): { headerHtml: string; itemsHtml: string } {
  const label = todayLabel()
  const total = cachedPending.length

  let itemsHtml = ''
  if (total === 0) {
    itemsHtml = '<div class="item empty">✅ 无待办</div>'
  } else {
    for (const item of cachedPending) {
      itemsHtml +=
        '<div class="item">' +
        `<span class="dot" style="background:${item.color}"></span>` +
        `<span class="time">${item.time}</span>` +
        `<span class="title">${item.title}</span>` +
        '</div>'
    }
  }

  const headerText = total === 0 ? `${label} · 无待办` : `${label} · 待办${total}项`
  return { headerHtml: headerText, itemsHtml }
}

/** Calculate popup height based on number of items */
function calculatePopupHeight(itemCount: number): number {
  // Header: ~38px, each item: ~30px, bottom padding: ~6px
  if (itemCount === 0) return 80
  const headerHeight = 38
  const itemHeight = 30
  const padding = 12
  const total = headerHeight + itemCount * itemHeight + padding
  return Math.min(total, 280) // cap at max height
}

/** Position and show the popup near the tray icon */
function showPopupNearTray(): void {
  if (!tray) return

  // Cancel any pending hide
  if (hidePopupTimer) {
    clearTimeout(hidePopupTimer)
    hidePopupTimer = null
  }

  // If popup is already visible, just keep it
  if (isPopupVisible) return

  const popup = ensurePopupWindow()
  const itemCount = cachedPending.length

  // Resize popup based on content
  const height = calculatePopupHeight(itemCount)
  popup.setSize(280, height)

  // Get tray position
  const trayBounds = tray.getBounds()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const workArea = display.workArea

  // Calculate popup position
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - 140) // center horizontally
  let y = Math.round(trayBounds.y - height - 4) // above the tray

  // If popup would go off the top of the screen, place it below the tray
  if (y < workArea.y) {
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  }

  // Clamp x to stay within work area
  x = Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - 280 - 4))
  y = Math.max(workArea.y + 4, y)

  popup.setPosition(x, y)

  // Inject fresh content (no page reload → no blank-white flash), then show.
  // Showing only after content is set prevents the flicker of an empty window.
  const { headerHtml, itemsHtml } = buildPopupContent()
  const injectAndShow = async () => {
    try {
      await popup.webContents.executeJavaScript(
        `window._setContent(${JSON.stringify(headerHtml)}, ${JSON.stringify(itemsHtml)})`
      )
    } catch {
      // content not ready yet — ignore; will retry on next hover
      return
    }
    if (isPopupVisible) return // already shown by a later call
    popup.showInactive() // show without stealing focus
    isPopupVisible = true
  }

  if (popupContentLoaded) {
    injectAndShow()
  } else {
    // First load — wait for the base template to finish, then inject + show.
    popup.webContents.once('did-finish-load', () => {
      popupContentLoaded = true
      injectAndShow()
    })
  }
}

/** Schedule popup hide with a short debounce (300ms) */
function scheduleHidePopup(): void {
  if (hidePopupTimer) {
    clearTimeout(hidePopupTimer)
  }
  hidePopupTimer = setTimeout(() => {
    hidePopup()
  }, 300)
}

/** Hide the popup window */
function hidePopup(): void {
  if (hidePopupTimer) {
    clearTimeout(hidePopupTimer)
    hidePopupTimer = null
  }
  if (popupWindow && !popupWindow.isDestroyed() && isPopupVisible) {
    popupWindow.hide()
    isPopupVisible = false
  }
}

// ===== Taskbar Title Scrolling =====

/** Get today's uncompleted (pending) events, sorted by time */
function getTodayPending(): { time: string; title: string; color: string }[] {
  const today = dayjs().format('YYYY-MM-DD')
  const range = { start: today, end: today }
  const rawEvents = queryAllEvents()

  const pending: { time: string; title: string; color: string }[] = []

  for (const raw of rawEvents) {
    const event: CalendarEvent = {
      id: raw.id,
      title: raw.title,
      startDate: raw.startDate,
      startTime: raw.startTime,
      endDate: raw.endDate,
      endTime: raw.endTime,
      recurrence: raw.recurrence || null,
      lunarAnchor: raw.lunarAnchor || undefined,
      color: raw.color,
      completedDates: raw.completedDates || [],
      reminders: raw.reminders || [],
      createdAt: raw.createdAt || '',
      updatedAt: raw.updatedAt || ''
    }

    const occs = expandOccurrences(event, range)
    for (const occ of occs) {
      if (!occ.completed && occ.date === today) {
        pending.push({
          time: occ.time || '全天',
          title: occ.title,
          color: occ.color || raw.color || '#4A90D9'
        })
      }
    }
  }

  // Sort: 全天 first, then chronological
  pending.sort((a, b) => {
    if (a.time === '全天' && b.time !== '全天') return -1
    if (a.time !== '全天' && b.time === '全天') return 1
    return a.time.localeCompare(b.time)
  })

  return pending
}

/** Refresh the cached pending events list */
function refreshPendingCache(): void {
  const today = dayjs().format('YYYY-MM-DD')
  // Only re-query if date changed or forced
  if (today !== lastCacheDate) {
    lastCacheDate = today
    cachedPending = getTodayPending()
    scrollIndex = 0
  }
}

/** Format today's date as short Chinese label */
function todayLabel(): string {
  const d = dayjs()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.month() + 1}/${d.date()}周${weekdays[d.day()]}`
}

/**
 * Update the taskbar title with scrolling pending events.
 *
 * Pattern: "7/21周一 · 14:00 周一团队例会"
 * - Date prefix always visible
 * - Rotates through each pending item every 5s
 * - Shows summary count when cycling back
 * - "无待办" when nothing pending
 */
function updateTaskbarTitle(): void {
  if (!mainWindow) return

  const label = todayLabel()

  // Update flashing state based on pending count
  if (cachedPending.length > 0) {
    startFlashing()
  } else {
    stopFlashing()
  }

  if (cachedPending.length === 0) {
    mainWindow.setTitle(`${label} · 无待办`)
    return
  }

  const total = cachedPending.length
  // Cycle: show summary once, then each item, repeat
  // 0 = summary, 1..N = each item
  const cycleLength = total + 1
  const phase = scrollIndex % cycleLength

  if (phase === 0) {
    // Summary: "7/21周一 · 待办3项"
    mainWindow.setTitle(`${label} · 待办${total}项`)
  } else {
    // Single item: "7/21周一 · 14:00 周一团队例会"
    const item = cachedPending[phase - 1]
    mainWindow.setTitle(`${label} · ${item.time} ${item.title}`)
  }

  scrollIndex++
}

/** Start the scroll timer — updates taskbar title every 5 seconds */
function startScroll(): void {
  updateTaskbarTitle()
  scrollTimer = setInterval(() => {
    refreshPendingCache()
    updateTaskbarTitle()
  }, 5000)
}

function stopScroll(): void {
  if (scrollTimer) {
    clearInterval(scrollTimer)
    scrollTimer = null
  }
}

app.whenReady().then(async () => {
  await initDatabase()
  seedSampleEvents()
  registerIpcHandlers()
  startReminderScheduler()
  startBackupScheduler()

  createMainWindow()
  createTray()
})

// Don't quit when all windows closed — keep running in tray
app.on('window-all-closed', () => {
  // Stay alive for tray + reminders
})

app.on('before-quit', () => {
  stopScroll()
  stopFlashing()
  stopBackupScheduler()
  // Destroy popup window
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy()
  }
})

// Refresh pending cache when window regains focus (user may have toggled completions)
// Also stop flashing since the user is now looking at the app
app.on('browser-window-focus', () => {
  stopFlashing()
  hidePopup()
  lastCacheDate = '' // Force re-query
  refreshPendingCache()
  scrollIndex = 0
  updateTaskbarTitle()
})
