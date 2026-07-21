import { Notification } from 'electron'
import { queryAllEvents, markReminderTriggered } from './db'
import { expandOccurrences } from '../lib/recurrence'
import dayjs from 'dayjs'

/** Check for upcoming reminders every 60 seconds */
const CHECK_INTERVAL_MS = 60_000
let timer: NodeJS.Timeout | null = null

export function startReminderScheduler(): void {
  timer = setInterval(checkReminders, CHECK_INTERVAL_MS)
  checkReminders()
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function checkReminders(): void {
  const now = dayjs()
  const rangeStart = now.format('YYYY-MM-DD')
  const rangeEnd = now.add(2, 'day').format('YYYY-MM-DD')

  const rawEvents = queryAllEvents()

  for (const raw of rawEvents) {
    const reminders = (raw.reminders || []).filter((r: any) => r.enabled)

    if (reminders.length === 0) continue

    const event = {
      id: raw.id,
      title: raw.title,
      startDate: raw.startDate,
      startTime: raw.startTime,
      endDate: raw.endDate,
      endTime: raw.endTime,
      recurrence: raw.recurrence || null,
      lunarAnchor: raw.lunarAnchor || undefined,
      color: raw.color,
      reminders
    }

    const occurrences = expandOccurrences(event, { start: rangeStart, end: rangeEnd })

    for (const occ of occurrences) {
      const occTime = occ.time || '09:00'
      const occStart = dayjs(`${occ.date} ${occTime}`)

      for (const r of reminders) {
        const reminderTime = occStart.subtract(r.offsetMinutes, 'minute')

        // Fire if within last 2 minutes and not already triggered today
        if (reminderTime.isBefore(now) && reminderTime.isAfter(now.subtract(2, 'minute'))) {
          if (!r.triggeredAt || !dayjs(r.triggeredAt).isSame(now, 'day')) {
            fireReminder(raw.title, occ.date, occTime, r.offsetMinutes)
            markReminderTriggered(r.id)
          }
        }
      }
    }
  }
}

function fireReminder(title: string, date: string, time: string, offsetMin: number): void {
  const desc = describeOffset(offsetMin)
  new Notification({
    title: `日历提醒: ${title}`,
    body: `${date} ${time} · ${desc}`,
    silent: false
  }).show()
}

function describeOffset(min: number): string {
  if (min === 0) return '现在'
  if (min < 60) return `${min}分钟前`
  if (min < 1440) return `${Math.floor(min / 60)}小时前`
  const days = Math.floor(min / 1440)
  const hrs = Math.floor((min % 1440) / 60)
  return hrs ? `${days}天${hrs}小时前` : `${days}天前`
}
