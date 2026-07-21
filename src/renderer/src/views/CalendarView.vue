<template>
  <div class="calendar-view">
    <!-- Header: month navigation -->
    <header class="cal-header">
      <button class="nav-btn" @click="prevMonth">&lt;</button>
      <h2 class="month-title">{{ currentYear }}年{{ currentMonth }}月</h2>
      <button class="nav-btn" @click="nextMonth">&gt;</button>
      <button class="today-btn" @click="goToday">今天</button>
      <button class="export-btn" @click="openExport">导出</button>
      <button class="settings-btn" @click="backupOpen = true">⚙</button>
    </header>

    <div class="cal-body">
      <!-- Month grid -->
      <div class="month-grid">
        <div class="weekday-row">
          <div v-for="d in weekdays" :key="d" class="weekday-cell">{{ d }}</div>
        </div>
        <div class="days-grid">
          <DayCell
            v-for="day in calendarDays"
            :key="day.date"
            :day="day"
            :occurrences="getOccs(day.date)"
            :selected="day.date === selectedDate"
            @select="selectDate(day.date)"
            @add="openEditor(day.date)"
          />
        </div>
      </div>

      <!-- Sidebar: selected day details -->
      <aside class="day-sidebar">
        <div class="sidebar-header">
          <h3>{{ formatSelectedDate }}</h3>
          <div v-if="selectedLunar" class="lunar-info">
            {{ selectedLunar.monthName }} {{ selectedLunar.dayName }}
            <span v-if="selectedLunar.isLeapMonth" class="leap-tag">闰</span>
            <span v-if="selectedLunar.solarTerm" class="jieqi-tag">{{ selectedLunar.solarTerm }}</span>
          </div>
        </div>

        <div class="event-list">
          <div
            v-for="occ in selectedOccs"
            :key="occ.eventId + occ.date"
            class="event-item"
            :class="{ completed: occ.completed }"
            :style="{ borderLeftColor: occ.color }"
            @click="openEditorForOcc(occ)"
          >
            <button
              class="check-btn"
              :class="{ checked: occ.completed }"
              @click.stop="onToggleCompletion(occ)"
            >✓</button>
            <span class="ev-time">{{ occ.time || '全天' }}</span>
            <span class="ev-title">{{ occ.title }}</span>
            <span v-if="occ.completed" class="ev-badge done-badge">已办</span>
            <span v-else class="ev-badge todo-badge">待办</span>
          </div>
          <button class="add-btn" @click="openEditor(selectedDate)">+ 添加事件</button>
        </div>
      </aside>
    </div>

    <!-- Event editor dialog -->
    <EventEditor
      v-if="editorOpen"
      :initialDate="editorDate"
      :editOccurrence="editOcc"
      @close="editorOpen = false"
      @save="onSaveEvent"
      @update="onUpdateEvent"
      @delete="onDeleteEvent"
    />

    <!-- Export dialog -->
    <div v-if="exportOpen" class="export-overlay" @click.self="exportOpen = false">
      <div class="export-card">
        <h3>导出事件</h3>

        <div class="export-range-btns">
          <button class="range-btn" :class="{ active: exportMode === 'week' }" @click="exportMode = 'week'">按周导出</button>
          <button class="range-btn" :class="{ active: exportMode === 'month' }" @click="exportMode = 'month'">按月导出</button>
        </div>

        <div v-if="exportMode === 'week'" class="export-week-nav">
          <button @click="exportWeekOffset--">&lt;</button>
          <span>{{ exportWeekLabel }}</span>
          <button @click="exportWeekOffset++">&gt;</button>
        </div>

        <div v-if="exportMode === 'month'" class="export-month-label">
          {{ currentYear }}年{{ currentMonth }}月
        </div>

        <div class="export-content" v-html="exportHtml"></div>

        <div class="export-actions">
          <button class="copy-btn" @click="copyExport">{{ copySuccess ? '已复制 ✓' : '复制内容' }}</button>
          <button class="cancel-btn" @click="exportOpen = false">关闭</button>
        </div>
      </div>
    </div>
    <!-- Backup panel -->
    <BackupPanel
      :open="backupOpen"
      :toast="toastRef"
      @close="backupOpen = false"
      @restored="onBackupRestored"
      @imported="onBackupImported"
    />

    <!-- Toast notifications -->
    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import DayCell from '../components/DayCell.vue'
import EventEditor from '../components/EventEditor.vue'
import BackupPanel from '../components/BackupPanel.vue'
import Toast from '../components/Toast.vue'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

// Helpers for Monday-first week layout
// dayjs day(): 0=Sun, 1=Mon, ..., 6=Sat
function mondayOfWeek(d: dayjs.Dayjs): dayjs.Dayjs {
  const day = d.day()
  return day === 0 ? d.subtract(6, 'day') : d.subtract(day - 1, 'day')
}

function sundayOfWeek(d: dayjs.Dayjs): dayjs.Dayjs {
  const day = d.day()
  return day === 0 ? d : d.add(7 - day, 'day')
}

// Weekday name for a dayjs date (Monday-first index)
function weekdayName(d: dayjs.Dayjs): string {
  // d.day(): 0=Sun→6, 1=Mon→0, ..., 6=Sat→5
  const idx = d.day() === 0 ? 6 : d.day() - 1
  return weekdays[idx]
}
const hasApi = !!((window as any).timerApi)
const api = (window as any).timerApi ?? {
  queryEvents: async () => [],
  createEvent: async () => ({ id: 'mock' }),
  updateEvent: async () => {},
  deleteEvent: async () => {},
  toggleCompletion: async () => false
}

// Local lunar computation fallback (works in browser without Electron IPC)
import { SolarDay as TymeSolarDay } from 'tyme4ts'

const ZODIAC = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪']

function computeLocalLunarRange(start: string, end: string): Record<string, any> {
  const result: Record<string, any> = {}
  let cur = dayjs(start)
  const endD = dayjs(end)
  while (cur.isBefore(endD) || cur.isSame(endD, 'day')) {
    const key = cur.format('YYYY-MM-DD')
    try {
      const sd = TymeSolarDay.fromYmd(cur.year(), cur.month() + 1, cur.date())
      const ld = sd.getLunarDay()
      const lm = ld.getLunarMonth()
      result[key] = {
        month: ld.getMonth(),
        monthName: lm.getName(),
        day: ld.getDay(),
        dayName: ld.getName(),
        isLeapMonth: lm.isLeap(),
        ganzhiYear: ld.getYearSixtyCycle().getName(),
        ganzhiDay: ld.getSixtyCycle().getName(),
        zodiac: ZODIAC[(ld.getYear() - 4) % 12]
      }
    } catch { /* skip invalid dates */ }
    cur = cur.add(1, 'day')
  }
  return result
}

async function getLunarRange(start: string, end: string): Record<string, any> {
  if (hasApi) {
    return await api.getLunarRange(start, end)
  }
  return computeLocalLunarRange(start, end)
}

const currentDate = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const occurrences = ref<any[]>([])
const lunarMap = ref<Record<string, any>>({})
const editorOpen = ref(false)
const editorDate = ref('')
const editOcc = ref<any>(null)

// Export state
const exportOpen = ref(false)
const exportMode = ref<'week' | 'month'>('week')
const exportWeekOffset = ref(0)
const exportOccs = ref<any[]>([])
const exportLunar = ref<Record<string, any>>({})
const copySuccess = ref(false)

// Backup state
const backupOpen = ref(false)

// Toast
const toastRef = ref<InstanceType<typeof Toast> | null>(null)

const currentYear = computed(() => currentDate.value.year())
const currentMonth = computed(() => currentDate.value.month() + 1)

// Calendar grid: starting from Monday of the week containing the 1st
const calendarDays = computed(() => {
  const start = mondayOfWeek(currentDate.value.startOf('month'))
  const end = sundayOfWeek(currentDate.value.endOf('month'))
  const today = dayjs().format('YYYY-MM-DD')
  const currentMonthNum = currentDate.value.month()

  const days: any[] = []
  let cur = start
  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    const dateStr = cur.format('YYYY-MM-DD')
    days.push({
      date: dateStr,
      day: cur.date(),
      isCurrentMonth: cur.month() === currentMonthNum,
      isToday: dateStr === today,
      lunar: lunarMap.value[dateStr]
    })
    cur = cur.add(1, 'day')
  }
  return days
})

const selectedOccs = computed(() =>
  occurrences.value.filter(o => o.date === selectedDate.value)
)

const selectedLunar = computed(() => lunarMap.value[selectedDate.value])

const formatSelectedDate = computed(() => {
  const d = dayjs(selectedDate.value)
  return `${d.month() + 1}月${d.date()}日`
})

// Export range calculations
const exportWeekStart = computed(() =>
  mondayOfWeek(dayjs().add(exportWeekOffset.value, 'week'))
)
const exportWeekEnd = computed(() =>
  sundayOfWeek(dayjs().add(exportWeekOffset.value, 'week'))
)
const exportWeekLabel = computed(() => {
  const s = exportWeekStart.value
  const e = exportWeekEnd.value
  return `${s.month() + 1}/${s.date()} ~ ${e.month() + 1}/${e.date()}`
})

function getOccs(date: string) {
  return occurrences.value.filter(o => o.date === date)
}

function prevMonth() { currentDate.value = currentDate.value.subtract(1, 'month') }
function nextMonth() { currentDate.value = currentDate.value.add(1, 'month') }
function goToday() {
  currentDate.value = dayjs()
  selectedDate.value = dayjs().format('YYYY-MM-DD')
}
function selectDate(date: string) { selectedDate.value = date }
function openEditor(date: string) { editorDate.value = date; editOcc.value = null; editorOpen.value = true }
function openEditorForOcc(occ: any) {
  editorDate.value = occ.date
  editOcc.value = occ
  editorOpen.value = true
}

async function loadData() {
  const start = mondayOfWeek(currentDate.value.startOf('month')).format('YYYY-MM-DD')
  const end = sundayOfWeek(currentDate.value.endOf('month')).format('YYYY-MM-DD')

  const [occResult, lunarResult] = await Promise.all([
    api.queryEvents(start, end),
    getLunarRange(start, end)
  ])

  occurrences.value = occResult || []
  lunarMap.value = lunarResult || {}
}

async function onSaveEvent(eventData: any) {
  try {
    await api.createEvent(eventData)
    editorOpen.value = false
    await loadData()
    toastRef.value?.show('事件已创建')
  } catch (e) {
    console.error('创建事件失败:', e)
    toastRef.value?.show('创建事件失败', 'error')
  }
}

async function onUpdateEvent(eventId: string, updates: any) {
  try {
    await api.updateEvent(eventId, updates)
    editorOpen.value = false
    await loadData()
    toastRef.value?.show('事件已更新')
  } catch (e) {
    console.error('更新事件失败:', e)
    toastRef.value?.show('更新事件失败', 'error')
  }
}

async function onDeleteEvent(eventId: string) {
  try {
    await api.deleteEvent(eventId)
    editorOpen.value = false
    await loadData()
    toastRef.value?.show('事件已删除')
  } catch (e) {
    console.error('删除事件失败:', e)
    toastRef.value?.show('删除事件失败', 'error')
  }
}

async function onToggleCompletion(occ: any) {
  try {
    await api.toggleCompletion(occ.eventId, occ.date)
    await loadData()
  } catch (e) {
    console.error('切换完成状态失败:', e)
  }
}

// ===== Export =====

async function openExport() {
  exportOpen.value = true
  exportWeekOffset.value = 0
  copySuccess.value = false
  await loadExportData()
}

async function loadExportData() {
  let start: string, end: string
  if (exportMode.value === 'week') {
    start = exportWeekStart.value.format('YYYY-MM-DD')
    end = exportWeekEnd.value.format('YYYY-MM-DD')
  } else {
    start = currentDate.value.startOf('month').format('YYYY-MM-DD')
    end = currentDate.value.endOf('month').format('YYYY-MM-DD')
  }
  const [occResult, lunarResult] = await Promise.all([
    api.queryEvents(start, end),
    getLunarRange(start, end)
  ])
  exportOccs.value = occResult || []
  exportLunar.value = lunarResult || {}
}

// Generate plain text export content
const exportText = computed(() => {
  let start: dayjs.Dayjs, end: dayjs.Dayjs, title: string
  if (exportMode.value === 'week') {
    start = exportWeekStart.value
    end = exportWeekEnd.value
    title = `周报 ${exportWeekLabel.value}`
  } else {
    start = currentDate.value.startOf('month')
    end = currentDate.value.endOf('month')
    title = `月报 ${currentYear.value}年${currentMonth.value}月`
  }

  const todoItems: string[] = []
  const doneItems: string[] = []

  let cur = start
  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    const dateStr = cur.format('YYYY-MM-DD')
    const lunar = exportLunar.value[dateStr]
    const lunarStr = lunar ? `${lunar.monthName}${lunar.dayName}` : ''
    const dayLabel = `${cur.month() + 1}/${cur.date()}周${weekdayName(cur)} ${lunarStr}`
    const occsForDay = exportOccs.value.filter(o => o.date === dateStr)

    for (const occ of occsForDay) {
      const timeStr = occ.time || '全天'
      const line = `${dayLabel}  ${timeStr}  ${occ.title}`
      if (occ.completed) {
        doneItems.push(line)
      } else {
        todoItems.push(line)
      }
    }

    cur = cur.add(1, 'day')
  }

  let text = `${title}\n\n`
  text += `━━ 待办 ━━\n`
  if (todoItems.length) {
    text += todoItems.map((item, i) => `${i + 1}. ${item}`).join('\n')
  } else {
    text += '无待办事项\n'
  }
  text += `\n\n━━ 已办 ━━\n`
  if (doneItems.length) {
    text += doneItems.map((item, i) => `${i + 1}. ${item}`).join('\n')
  } else {
    text += '无已办事项\n'
  }

  const total = todoItems.length + doneItems.length
  text += `\n\n总计 ${total} 项，待办 ${todoItems.length} 项，已办 ${doneItems.length} 项`
  return text
})

// Generate HTML for display
const exportHtml = computed(() => {
  let start: dayjs.Dayjs, end: dayjs.Dayjs, title: string
  if (exportMode.value === 'week') {
    start = exportWeekStart.value
    end = exportWeekEnd.value
    title = `周报 ${exportWeekLabel.value}`
  } else {
    start = currentDate.value.startOf('month')
    end = currentDate.value.endOf('month')
    title = `月报 ${currentYear.value}年${currentMonth.value}月`
  }

  const todoItems: any[] = []
  const doneItems: any[] = []

  let cur = start
  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    const dateStr = cur.format('YYYY-MM-DD')
    const lunar = exportLunar.value[dateStr]
    const lunarStr = lunar ? `${lunar.monthName}${lunar.dayName}` : ''
    const dayLabel = `${cur.month() + 1}/${cur.date()}周${weekdayName(cur)} ${lunarStr}`
    const occsForDay = exportOccs.value.filter(o => o.date === dateStr)

    for (const occ of occsForDay) {
      const timeStr = occ.time || '全天'
      if (occ.completed) {
        doneItems.push({ dayLabel, timeStr, title: occ.title, color: occ.color })
      } else {
        todoItems.push({ dayLabel, timeStr, title: occ.title, color: occ.color })
      }
    }
    cur = cur.add(1, 'day')
  }

  const total = todoItems.length + doneItems.length
  let html = `<h4 style="margin-bottom:8px">${title}</h4>`

  html += `<div class="ex-section"><div class="ex-section-title todo">待办 ${todoItems.length} 项</div>`
  if (todoItems.length) {
    html += todoItems.map((item, i) =>
      `<div class="ex-row"><span class="ex-num">${i + 1}</span><span class="ex-dot" style="background:${item.color}"></span><span class="ex-day">${item.dayLabel}</span><span class="ex-time">${item.timeStr}</span><span class="ex-title">${item.title}</span></div>`
    ).join('')
  } else {
    html += `<div class="ex-empty">无待办事项</div>`
  }
  html += `</div>`

  html += `<div class="ex-section"><div class="ex-section-title done">已办 ${doneItems.length} 项</div>`
  if (doneItems.length) {
    html += doneItems.map((item, i) =>
      `<div class="ex-row done"><span class="ex-num">${i + 1}</span><span class="ex-dot" style="background:${item.color}"></span><span class="ex-day">${item.dayLabel}</span><span class="ex-time">${item.timeStr}</span><span class="ex-title">${item.title}</span></div>`
    ).join('')
  } else {
    html += `<div class="ex-empty">无已办事项</div>`
  }
  html += `</div>`

  html += `<div class="ex-summary">总计 ${total} 项，待办 ${todoItems.length} 项，已办 ${doneItems.length} 项</div>`
  return html
})

function copyExport() {
  navigator.clipboard.writeText(exportText.value).then(() => {
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = exportText.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  })
}

// Reload export data when mode/week changes
watch(exportMode, loadExportData)
watch(exportWeekOffset, loadExportData)

// After backup restore, reload calendar data
async function onBackupRestored() {
  backupOpen.value = false
  await loadData()
  toastRef.value?.show('数据已恢复')
}

// After backup import, reload calendar data
async function onBackupImported() {
  await loadData()
  toastRef.value?.show('数据已导入')
}

onMounted(loadData)
watch(currentDate, loadData)
</script>

<style scoped>
.calendar-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  font-family: -apple-system, "Microsoft YaHei", sans-serif;
}

.cal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid var(--color-border);
}

.month-title {
  font-size: 20px;
  font-weight: 500;
  min-width: 160px;
  text-align: center;
}

.nav-btn {
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--transition);
}

.nav-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.today-btn {
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius);
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background var(--transition);
}

.today-btn:hover {
  background: var(--color-primary-hover);
}

.export-btn {
  margin-left: auto;
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--transition);
}

.export-btn:hover {
  background: rgba(91, 127, 255, 0.08);
}

.settings-btn {
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background var(--transition);
}

.settings-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.cal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.month-grid {
  flex: 1;
  padding: 8px 16px;
}

.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.weekday-cell {
  text-align: center;
  font-weight: 500;
  padding: 8px 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.day-sidebar {
  width: 260px;
  background: var(--color-bg);
  padding: 16px;
  overflow-y: auto;
}

.sidebar-header h3 {
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 4px;
}

.lunar-info {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.leap-tag {
  color: var(--color-danger);
  font-weight: 600;
}

.jieqi-tag {
  color: var(--color-success);
  font-weight: 600;
  margin-left: 4px;
}

.event-item {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-left: 2px solid;
  margin-bottom: 4px;
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  transition: background var(--transition);
  align-items: center;
}

.event-item:hover {
  background: rgba(0, 0, 0, 0.03);
}

.event-item.completed {
  opacity: 0.5;
}

.event-item.completed .ev-title {
  text-decoration: line-through;
  color: var(--color-text-secondary);
}

.check-btn {
  width: 20px;
  height: 20px;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  background: #fff;
  cursor: pointer;
  font-size: 11px;
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--transition);
}

.check-btn:hover {
  border-color: var(--color-primary);
}

.check-btn.checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.ev-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius);
  flex-shrink: 0;
  margin-left: auto;
}

.todo-badge {
  background: rgba(91, 127, 255, 0.1);
  color: var(--color-primary);
}

.done-badge {
  background: rgba(52, 199, 89, 0.1);
  color: var(--color-success);
}

.ev-time {
  color: var(--color-text-secondary);
  font-size: 12px;
  min-width: 48px;
}

.ev-title {
  font-size: 14px;
}

.add-btn {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  color: var(--color-primary);
  background: rgba(91, 127, 255, 0.06);
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.add-btn:hover {
  background: rgba(91, 127, 255, 0.12);
}

/* ===== Export Dialog ===== */

.export-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.export-card {
  background: #fff;
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 20px;
  width: 560px;
  max-height: 85vh;
  overflow-y: auto;
}

.export-card h3 { margin-bottom: 12px; font-weight: 500; }

.export-range-btns {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.range-btn {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary);
  transition: background var(--transition);
}

.range-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.range-btn.active {
  background: var(--color-primary);
  color: #fff;
}

.export-week-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
}

.export-week-nav button {
  padding: 4px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background var(--transition);
}

.export-week-nav button:hover {
  background: rgba(0, 0, 0, 0.04);
}

.export-week-nav span {
  min-width: 120px;
  text-align: center;
  font-weight: 500;
}

.export-month-label {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  text-align: center;
}

.export-content {
  background: var(--color-bg);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
}

/* Export HTML inner styles (rendered via v-html, need unscoped) */
.export-content :deep(.ex-section) {
  margin-bottom: 16px;
}

.export-content :deep(.ex-section-title) {
  font-weight: 500;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: var(--radius);
  margin-bottom: 6px;
}

.export-content :deep(.ex-section-title.todo) {
  background: rgba(91, 127, 255, 0.1);
  color: var(--color-primary);
}

.export-content :deep(.ex-section-title.done) {
  background: rgba(52, 199, 89, 0.1);
  color: var(--color-success);
}

.export-content :deep(.ex-row) {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  font-size: 13px;
}

.export-content :deep(.ex-row.done) {
  opacity: 0.5;
}

.export-content :deep(.ex-row.done .ex-title) {
  text-decoration: line-through;
}

.export-content :deep(.ex-num) {
  min-width: 24px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.export-content :deep(.ex-dot) {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.export-content :deep(.ex-day) {
  min-width: 110px;
  color: var(--color-text-secondary);
}

.export-content :deep(.ex-time) {
  min-width: 48px;
  color: var(--color-text-secondary);
}

.export-content :deep(.ex-title) {
  font-weight: 500;
}

.export-content :deep(.ex-empty) {
  color: var(--color-text-secondary);
  font-size: 13px;
  padding: 4px 8px;
}

.export-content :deep(.ex-summary) {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 8px;
  text-align: center;
}

.export-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.copy-btn {
  padding: 8px 16px;
  border: none;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.copy-btn:hover {
  background: var(--color-primary-hover);
}

.cancel-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition);
}

.cancel-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}
</style>
