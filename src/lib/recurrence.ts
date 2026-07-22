/**
 * Recurrence rule expansion engine.
 *
 * Generates concrete occurrence dates from a CalendarEvent + RecurrenceRule
 * within a given date range. Handles Gregorian rules (daily/weekly/monthly/yearly)
 * and Lunar rules (lunar-yearly with 闰月 support, lunar-monthly TBD).
 */
import dayjs from 'dayjs'
import { lunarToSolar, formatISODate } from './lunar'
import type {
  CalendarEvent,
  Occurrence,
  DateRange,
  RecurrenceRule
} from './types'

/** Expand all occurrences of an event within a date range */
export function expandOccurrences(event: CalendarEvent, range: DateRange): Occurrence[] {
  if (!event.recurrence) {
    // Single occurrence — include if receivedDate falls in range
    if (isInRange(event.receivedDate, range)) {
      return [makeOccurrence(event, event.receivedDate)]
    }
    return []
  }

  const rule = event.recurrence
  const anchor = dayjs(event.receivedDate)
  const out: Occurrence[] = []

  switch (rule.type) {
    case 'daily':      expandDaily(rule, anchor, range, event, out); break
    case 'weekly':     expandWeekly(rule, anchor, range, event, out); break
    case 'monthly':    expandMonthly(rule, anchor, range, event, out); break
    case 'yearly':     expandYearly(rule, anchor, range, event, out); break
    case 'lunar-yearly': expandLunarYearly(rule, event, range, out); break
    case 'lunar-monthly': // TODO for MVP — less commonly needed
      break
  }

  return out
}

// ===== Gregorian expansions =====

function expandDaily(
  rule: RecurrenceRule, anchor: dayjs.Dayjs,
  range: DateRange, event: CalendarEvent, out: Occurrence[]
) {
  const interval = rule.interval || 1
  const rangeStart = dayjs(range.start)
  const rangeEnd = dayjs(range.end)

  // Jump to first occurrence within range
  let diff = rangeStart.diff(anchor, 'day')
  let offset = diff > 0 ? Math.ceil(diff / interval) * interval : 0
  let cur = anchor.add(offset, 'day')

  while (cur.isBefore(rangeEnd) || cur.isSame(rangeEnd, 'day')) {
    if (shouldEnd(rule, anchor, cur, out.length)) break
    out.push(makeOccurrence(event, cur.format('YYYY-MM-DD')))
    cur = cur.add(interval, 'day')
  }
}

function expandWeekly(
  rule: RecurrenceRule, anchor: dayjs.Dayjs,
  range: DateRange, event: CalendarEvent, out: Occurrence[]
) {
  const interval = rule.interval || 1
  const daysOfWeek = rule.daysOfWeek ?? [anchor.day()]
  const rangeStart = dayjs(range.start)
  const rangeEnd = dayjs(range.end)

  let anchorWeekStart = anchor.startOf('week')
  let curWeekStart = rangeStart.startOf('week')

  // Align to interval
  let weekDiff = curWeekStart.diff(anchorWeekStart, 'week')
  if (weekDiff > 0) {
    let skip = Math.ceil(weekDiff / interval) * interval - weekDiff
    curWeekStart = curWeekStart.subtract(skip, 'week')
    if (curWeekStart.isBefore(anchorWeekStart)) {
      curWeekStart = anchorWeekStart
    }
  } else {
    curWeekStart = anchorWeekStart
  }

  while (curWeekStart.isBefore(rangeEnd.add(1, 'week'))) {
    if (out.length > 500) break // safety cap
    for (const dow of daysOfWeek) {
      const d = curWeekStart.day(dow)
      if (d.isBefore(anchor) && !d.isSame(anchor, 'day')) continue
      if (d.isBefore(rangeStart)) continue
      if (d.isAfter(rangeEnd)) continue
      if (shouldEnd(rule, anchor, d, out.length)) return
      out.push(makeOccurrence(event, d.format('YYYY-MM-DD')))
    }
    curWeekStart = curWeekStart.add(interval, 'week')
  }
}

function expandMonthly(
  rule: RecurrenceRule, anchor: dayjs.Dayjs,
  range: DateRange, event: CalendarEvent, out: Occurrence[]
) {
  const interval = rule.interval || 1
  const dayOfMonth = rule.dayOfMonth ?? anchor.date()
  const rangeStart = dayjs(range.start)
  const rangeEnd = dayjs(range.end)

  let anchorMonthStart = anchor.date(1)
  let monthDiff = rangeStart.diff(anchorMonthStart, 'month')
  let offset = monthDiff > 0 ? Math.ceil(monthDiff / interval) * interval : 0
  let curMonth = anchorMonthStart.add(offset, 'month')

  while (curMonth.isBefore(rangeEnd.add(1, 'month'))) {
    if (out.length > 500) break
    const targetDay = Math.min(dayOfMonth, curMonth.daysInMonth())
    const d = curMonth.date(targetDay)
    if (d.isBefore(rangeStart)) { curMonth = curMonth.add(interval, 'month'); continue }
    if (d.isAfter(rangeEnd)) break
    if (shouldEnd(rule, anchor, d, out.length)) break
    out.push(makeOccurrence(event, d.format('YYYY-MM-DD')))
    curMonth = curMonth.add(interval, 'month')
  }
}

function expandYearly(
  rule: RecurrenceRule, anchor: dayjs.Dayjs,
  range: DateRange, event: CalendarEvent, out: Occurrence[]
) {
  const interval = rule.interval || 1
  const month = rule.monthOfYear ?? anchor.month()
  const day = rule.dayOfMonth ?? anchor.date()
  const rangeEndYear = dayjs(range.end).year()

  let anchorYear = anchor.year()
  let rangeStartYear = dayjs(range.start).year()
  let yearDiff = rangeStartYear - anchorYear
  let offset = yearDiff > 0 ? Math.ceil(yearDiff / interval) * interval : 0
  let curYear = anchorYear + offset

  while (curYear <= rangeEndYear) {
    if (out.length > 500) break
    const d = dayjs(`${curYear}-${month}-${day}`)
    if (!d.isValid()) { curYear += interval; continue }
    if (d.isBefore(dayjs(range.start))) { curYear += interval; continue }
    if (d.isAfter(dayjs(range.end))) break
    if (shouldEnd(rule, anchor, d, out.length)) break
    out.push(makeOccurrence(event, d.format('YYYY-MM-DD')))
    curYear += interval
  }
}

// ===== Lunar expansions =====

function expandLunarYearly(
  rule: RecurrenceRule, event: CalendarEvent,
  range: DateRange, out: Occurrence[]
) {
  const interval = rule.interval || 1
  const lunarMonth = rule.lunarMonth ?? (event.lunarAnchor?.month ?? 1)
  const lunarDay = rule.lunarDay ?? (event.lunarAnchor?.day ?? 1)
  const anchorLunarYear = event.lunarAnchor?.year ?? parseInt(range.start.substring(0, 4))

  const rangeEndYear = parseInt(range.end.substring(0, 4))

  // Start from anchor, skip to near-range, then iterate
  let curLunarYear = anchorLunarYear
  const rangeStartYear = parseInt(range.start.substring(0, 4))
  if (curLunarYear < rangeStartYear) {
    const diff = rangeStartYear - curLunarYear
    curLunarYear = anchorLunarYear + Math.floor(diff / interval) * interval
  }

  // Iterate lunar years; Gregorian mapping may differ by ~1 month
  while (curLunarYear <= rangeEndYear + 2 && out.length < 500) {
    if (rule.endCondition === 'count' && out.length >= (rule.endCount ?? Infinity)) break

    const solarResult = lunarToSolar(curLunarYear, lunarMonth, lunarDay)
    if (solarResult) {
      const dateStr = formatISODate(solarResult.year, solarResult.month, solarResult.day)
      if (isInRange(dateStr, range)) {
        if (rule.endCondition === 'date' && dateStr > (rule.endDate ?? '')) break
        out.push(makeOccurrence(event, dateStr))
      }
    }
    // If lunarToSolar returned null (leap month missing this year), we simply skip
    // Future: add option to fall back to regular month

    curLunarYear += interval
  }
}

// ===== Helpers =====

function makeOccurrence(event: CalendarEvent, date: string): Occurrence {
  // Compute taskStartDate offset from receivedDate
  const receivedAnchor = dayjs(event.receivedDate)
  const taskStartAnchor = dayjs(event.taskStartDate)
  const taskStartOffset = taskStartAnchor.diff(receivedAnchor, 'day')
  const occTaskStartDate = dayjs(date).add(taskStartOffset, 'day').format('YYYY-MM-DD')

  // Compute taskEndDate offset from taskStartDate (if present)
  let occTaskEndDate: string | undefined
  if (event.taskEndDate) {
    const taskEndAnchor = dayjs(event.taskEndDate)
    const taskEndOffset = taskEndAnchor.diff(taskStartAnchor, 'day')
    occTaskEndDate = dayjs(occTaskStartDate).add(taskEndOffset, 'day').format('YYYY-MM-DD')
  }

  return {
    eventId: event.id,
    date,
    receivedTime: event.receivedTime,
    taskStartDate: occTaskStartDate,
    taskStartTime: event.taskStartTime,
    taskEndDate: occTaskEndDate,
    taskEndTime: event.taskEndTime ?? undefined,
    progress: event.progress ?? 0,
    title: event.title,
    color: event.color,
    completed: event.completedDates?.includes(date) ?? false,
    recurrence: event.recurrence,
    reminders: event.reminders
  }
}

function isInRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end
}

function shouldEnd(
  rule: RecurrenceRule, anchor: dayjs.Dayjs,
  current: dayjs.Dayjs, count: number
): boolean {
  if (rule.endCondition === 'date') return current.isAfter(dayjs(rule.endDate))
  if (rule.endCondition === 'count') return count >= (rule.endCount ?? Infinity)
  return false
}
