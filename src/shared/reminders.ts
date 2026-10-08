/** Companion reminders: pure scheduling rules shared by the main service and tests. */

export const REMINDER_REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'interval'] as const
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number]

export const REMINDER_KINDS = ['text', 'weather-brief', 'break'] as const
/** text: say the reminder; weather-brief: fetch weather first; break: a gentle rest nudge. */
export type ReminderKind = (typeof REMINDER_KINDS)[number]

export interface Reminder {
  id: string
  text: string
  kind: ReminderKind
  repeat: ReminderRepeat
  /** Next time the reminder fires (epoch ms). */
  nextAt: number
  intervalMinutes?: number
  /** HH:mm for daily / weekdays / weekly repeats. */
  timeOfDay?: string
  status: 'active' | 'done' | 'cancelled'
  createdAt: number
  lastFiredAt?: number
  conversationId?: string | null
}

export interface QuietHours {
  enabled: boolean
  start: string
  end: string
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: '23:00', end: '08:00' }

/** One-shot reminders older than this when the app starts are closed without firing. */
export const MISSED_REMINDER_GRACE_MS = 2 * 60 * 60 * 1000

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export function parseTimeOfDay(value: string | undefined | null): { hours: number; minutes: number } | null {
  const match = /^\s*(\d{1,2})[:：](\d{2})\s*$/.exec(value ?? '')
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

export function formatTimeOfDay(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function atTimeOfDay(base: number, time: { hours: number; minutes: number }): number {
  const date = new Date(base)
  date.setHours(time.hours, time.minutes, 0, 0)
  return date.getTime()
}

/**
 * Resolve when a new reminder should first fire. `at` accepts HH:mm (the next
 * such time), "YYYY-MM-DD HH:mm" or an ISO timestamp; `inMinutes` wins when given.
 */
export function resolveFirstReminderTime(params: { at?: string; inMinutes?: number; now: number }): number | null {
  const { at, inMinutes, now } = params
  if (typeof inMinutes === 'number' && Number.isFinite(inMinutes) && inMinutes > 0) {
    return now + Math.round(inMinutes * MINUTE)
  }
  if (!at?.trim()) return null
  const time = parseTimeOfDay(at)
  if (time) {
    const today = atTimeOfDay(now, time)
    return today > now ? today : atTimeOfDay(now + DAY, time)
  }
  const normalized = at.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/, '$1T$2')
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function isWeekday(at: number): boolean {
  const day = new Date(at).getDay()
  return day >= 1 && day <= 5
}

/** Next occurrence strictly after `after`, or null for one-shot reminders. */
export function computeNextOccurrence(reminder: Pick<Reminder, 'repeat' | 'intervalMinutes' | 'timeOfDay' | 'nextAt'>, after: number): number | null {
  if (reminder.repeat === 'none') return null
  if (reminder.repeat === 'interval') {
    const interval = Math.max(5, reminder.intervalMinutes ?? 60) * MINUTE
    let next = reminder.nextAt
    while (next <= after) next += interval
    return next
  }
  const time = parseTimeOfDay(reminder.timeOfDay) ?? parseTimeOfDay(formatTimeOfDay(reminder.nextAt))!
  let candidate = atTimeOfDay(after, time)
  if (candidate <= after) candidate = atTimeOfDay(after + DAY, time)
  if (reminder.repeat === 'daily') return candidate
  if (reminder.repeat === 'weekdays') {
    while (!isWeekday(candidate)) candidate = atTimeOfDay(candidate + DAY, time)
    return candidate
  }
  // weekly: same weekday as the reminder's anchor time
  const weekday = new Date(reminder.nextAt).getDay()
  while (new Date(candidate).getDay() !== weekday) candidate = atTimeOfDay(candidate + DAY, time)
  return candidate
}

export function isInQuietHours(quiet: QuietHours | null | undefined, at: number): boolean {
  if (!quiet?.enabled) return false
  const start = parseTimeOfDay(quiet.start)
  const end = parseTimeOfDay(quiet.end)
  if (!start || !end) return false
  const date = new Date(at)
  const minutes = date.getHours() * 60 + date.getMinutes()
  const startMinutes = start.hours * 60 + start.minutes
  const endMinutes = end.hours * 60 + end.minutes
  if (startMinutes === endMinutes) return false
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes
}

export type ReminderFireDecision =
  | { action: 'fire'; silent: boolean; missed: boolean }
  | { action: 'skip' }

/**
 * Decide what to do with a due reminder. Proactive nudges (break, weather)
 * stay quiet during quiet hours; explicit reminders always arrive, silently.
 */
export function decideReminderFire(reminder: Pick<Reminder, 'kind' | 'repeat' | 'nextAt'>, now: number, quiet: QuietHours | null | undefined): ReminderFireDecision {
  const late = now - reminder.nextAt
  const quietNow = isInQuietHours(quiet, now)
  if (reminder.kind !== 'text' && quietNow) return { action: 'skip' }
  if (late > MISSED_REMINDER_GRACE_MS) {
    // Repeating nudges just move on; an explicit one-shot the user asked for still surfaces once.
    if (reminder.repeat !== 'none' || reminder.kind !== 'text') return { action: 'skip' }
  }
  return { action: 'fire', silent: quietNow, missed: late > 5 * MINUTE }
}

export function describeReminderRepeat(reminder: Pick<Reminder, 'repeat' | 'intervalMinutes' | 'timeOfDay'>): string {
  switch (reminder.repeat) {
    case 'daily': return `每天 ${reminder.timeOfDay ?? ''}`.trim()
    case 'weekdays': return `工作日 ${reminder.timeOfDay ?? ''}`.trim()
    case 'weekly': return `每周 ${reminder.timeOfDay ?? ''}`.trim()
    case 'interval': return `每 ${reminder.intervalMinutes ?? 60} 分钟`
    default: return '一次'
  }
}
