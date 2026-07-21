/**
 * Lunar calendar bridge using tyme4ts (v1.5+).
 *
 * Verified API:
 *   SolarDay.fromYmd(y,m,d) → SolarDay
 *   SolarDay.getLunarDay()   → LunarDay
 *   LunarDay.fromYmd(y,month,d) → LunarDay  (negative month = leap, e.g. -6 = 闰六月)
 *   LunarDay.getSolarDay()  → SolarDay
 *   LunarDay.getName()      → "初一","十五" etc.
 *   LunarDay.getLunarMonth() → LunarMonth  (.isLeap(), .getName() → "六月"/"闰六月")
 *   LunarMonth.getMonthWithLeap() → 1..12 or -1..-12 for leap months
 *   节气: SolarTerm.fromIndex(year, i) for i=0..23 → SolarTerm.getSolarDay()
 *   干支: LunarDay.getYearSixtyCycle().getName() etc.
 *   生肖: (year-4)%12 → ZODIAC_NAMES[index]
 *   Festival: LunarDay.getFestival() → LunarFestival|null (singular)
 */
import { SolarDay, LunarDay, LunarMonth, LunarYear, SolarTerm } from 'tyme4ts'
import type { LunarDisplay, LunarAnchor } from './types'

const ZODIAC_NAMES = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪']

/** Cache of 节气 for each year (24 terms per year) */
const solarTermCache: Record<number, Record<string, string>> = {}

function buildSolarTermCache(year: number): Record<string, string> {
  if (solarTermCache[year]) return solarTermCache[year]
  const map: Record<string, string> = {}
  for (let i = 0; i < 24; i++) {
    try {
      const term = SolarTerm.fromIndex(year, i)
      const day = term.getSolarDay()
      const key = `${day.getYear()}-${String(day.getMonth()).padStart(2,'0')}-${String(day.getDay()).padStart(2,'0')}`
      map[key] = term.getName()
    } catch { /* skip invalid */ }
  }
  solarTermCache[year] = map
  return map
}

/** Convert a Gregorian date to rich Lunar display info */
export function solarToLunarDisplay(year: number, month: number, day: number): LunarDisplay {
  const solar = SolarDay.fromYmd(year, month, day)
  const lunar = solar.getLunarDay()
  const lunarMonth = lunar.getLunarMonth()

  // Pre-compute 节气 cache for this year
  const termMap = buildSolarTermCache(year)
  const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`

  return {
    year: lunar.getYear(),
    month: lunar.getMonth(),
    monthName: lunarMonth.getName(),         // "正月","六月","闰六月"
    day: lunar.getDay(),
    dayName: lunar.getName(),                 // "初一","十五","三十"
    isLeapMonth: lunarMonth.isLeap(),
    ganzhiYear: lunar.getYearSixtyCycle().getName(),   // "丙午"
    ganzhiMonth: lunar.getMonthSixtyCycle().getName(), // "乙未"
    ganzhiDay: lunar.getSixtyCycle().getName(),        // "乙未"
    zodiac: ZODIAC_NAMES[(lunar.getYear() - 4) % 12], // "马"
    solarTerm: termMap[dateKey] || undefined,           // "小暑" if this day is a 节气
    festival: extractFestivals(lunar, solar)
  }
}

/** Convert a Lunar date to Gregorian. Returns null if leap month doesn't exist that year. */
export function lunarToSolar(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number
): { year: number; month: number; day: number } | null {
  try {
    const lunar = LunarDay.fromYmd(lunarYear, lunarMonth, lunarDay)
    const solar = lunar.getSolarDay()
    return { year: solar.getYear(), month: solar.getMonth(), day: solar.getDay() }
  } catch {
    // Leap month doesn't exist in this year → return null
    return null
  }
}

/** Create a LunarAnchor from a Lunar date */
export function createLunarAnchor(lunarYear: number, lunarMonth: number, lunarDay: number): LunarAnchor {
  return {
    year: lunarYear,
    month: lunarMonth,   // negative for leap (e.g. -6 = 闰六月)
    day: lunarDay,
    isLeapMonth: lunarMonth < 0
  }
}

/** Format an ISO date string from numeric components */
export function formatISODate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ===== Private helpers =====

function extractFestivals(lunarDay: LunarDay, solarDay: SolarDay): string[] {
  const festivals: string[] = []

  // Lunar festivals (traditional Chinese festivals)
  const lunarFestival = lunarDay.getFestival()
  if (lunarFestival) {
    festivals.push(lunarFestival.getName())
  }

  // Solar festivals (modern/Western calendar festivals)
  const solarFestival = solarDay.getFestival()
  if (solarFestival) {
    festivals.push(solarFestival.getName())
  }

  return festivals
}
