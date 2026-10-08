import { Notification } from 'electron'
import { randomUUID } from 'crypto'
import {
  computeNextOccurrence,
  decideReminderFire,
  describeReminderRepeat,
  type QuietHours,
  type Reminder,
  type ReminderKind,
  type ReminderRepeat,
} from '@shared/reminders'
import { normalizeCompanionSettings } from '@shared/companion-settings'
import { store } from '../../store'
import { EventStore } from '../events/eventStore'
import { ConversationStore } from '../conversations/conversationStore'
import { fetchWeatherSnapshot } from '../../services/weather-service'
import { expressPet } from './petBridge'

const TICK_MS = 15_000
const MAX_ACTIVE_REMINDERS = 50
const KEEP_FINISHED = 30

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

function readReminders(): Reminder[] {
  const value = store.get('reminders')
  return Array.isArray(value) ? value.filter((item): item is Reminder => Boolean(item && typeof item.id === 'string')) : []
}

function writeReminders(reminders: Reminder[]): void {
  const active = reminders.filter((item) => item.status === 'active')
  const finished = reminders
    .filter((item) => item.status !== 'active')
    .sort((left, right) => (right.lastFiredAt ?? right.createdAt) - (left.lastFiredAt ?? left.createdAt))
    .slice(0, KEEP_FINISHED)
  store.set('reminders', [...active, ...finished])
}

async function composeMessage(reminder: Reminder): Promise<string> {
  if (reminder.kind === 'weather-brief') {
    const weather = await fetchWeatherSnapshot({ days: 1 }).catch(() => null)
    const today = weather?.forecast[0]
    if (weather?.ok && weather.current) {
      const range = today ? `，今天 ${Math.round(today.tempMin)}~${Math.round(today.tempMax)}°C` : ''
      const rain = today && today.precipitation >= 1 ? '，记得带伞' : ''
      return `${reminder.text ? `${reminder.text}：` : ''}${weather.city ?? weather.location}现在${weather.current.weather} ${Math.round(weather.current.temperature)}°C${range}${rain}。`
    }
    return reminder.text || '早安～天气暂时没查到，出门前看一眼窗外吧。'
  }
  if (reminder.kind === 'break') return reminder.text || '坐很久啦，起来活动一下、喝口水吧。'
  return reminder.text
}

function deliver(reminder: Reminder, message: string, options: { silent: boolean; missed: boolean }): void {
  const body = options.missed ? `（刚才错过的提醒）${message}` : message
  try {
    if (Notification.isSupported()) {
      new Notification({ title: '灵月提醒', body, silent: options.silent }).show()
    }
  } catch (error) {
    console.warn('[reminder] notification failed:', error)
  }
  expressPet({ state: reminder.kind === 'break' ? 'charging' : 'speaking', message: body, durationMs: 12_000 })
  if (reminder.conversationId) {
    try {
      EventStore.append({
        conversationId: reminder.conversationId,
        eventType: 'assistant_message',
        mode: 'daily',
        content: { text: `⏰ ${body}`, reminderId: reminder.id },
      })
      ConversationStore.touch(reminder.conversationId)
    } catch {
      // The conversation may have been deleted; the notification already went out.
    }
  }
}

async function tick(now = Date.now()): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const reminders = readReminders()
    const quiet = ReminderService.getQuietHours()
    let changed = false
    for (const reminder of reminders) {
      if (reminder.status !== 'active' || reminder.nextAt > now) continue
      const decision = decideReminderFire(reminder, now, quiet)
      if (decision.action === 'fire') {
        deliver(reminder, await composeMessage(reminder), decision)
        reminder.lastFiredAt = now
      }
      const next = computeNextOccurrence(reminder, now)
      if (next == null) reminder.status = 'done'
      else reminder.nextAt = next
      changed = true
    }
    if (changed) writeReminders(reminders)
  } catch (error) {
    console.error('[reminder] tick failed:', error)
  } finally {
    ticking = false
  }
}

export interface CreateReminderInput {
  text: string
  kind: ReminderKind
  repeat: ReminderRepeat
  firstAt: number
  intervalMinutes?: number
  timeOfDay?: string
  conversationId?: string | null
}

export const ReminderService = {
  start(): void {
    if (timer) return
    timer = setInterval(() => void tick(), TICK_MS)
    void tick()
  },

  stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  },

  list(includeFinished = false): Reminder[] {
    const reminders = readReminders()
    return (includeFinished ? reminders : reminders.filter((item) => item.status === 'active'))
      .sort((left, right) => left.nextAt - right.nextAt)
  },

  create(input: CreateReminderInput): { ok: true; reminder: Reminder } | { ok: false; error: string } {
    const reminders = readReminders()
    if (reminders.filter((item) => item.status === 'active').length >= MAX_ACTIVE_REMINDERS) {
      return { ok: false, error: `提醒已经有 ${MAX_ACTIVE_REMINDERS} 条了，先清理一些再加。` }
    }
    const reminder: Reminder = {
      id: `rem-${randomUUID().slice(0, 8)}`,
      text: input.text.trim().slice(0, 200),
      kind: input.kind,
      repeat: input.repeat,
      nextAt: input.firstAt,
      intervalMinutes: input.repeat === 'interval' ? Math.max(5, Math.min(24 * 60, Math.round(input.intervalMinutes ?? 60))) : undefined,
      timeOfDay: input.timeOfDay,
      status: 'active',
      createdAt: Date.now(),
      conversationId: input.conversationId ?? null,
    }
    writeReminders([...reminders, reminder])
    return { ok: true, reminder }
  },

  cancel(id: string): boolean {
    const reminders = readReminders()
    const target = reminders.find((item) => item.id === id && item.status === 'active')
    if (!target) return false
    target.status = 'cancelled'
    writeReminders(reminders)
    return true
  },

  summary(): { pending: number; next?: { text: string; at: number } } {
    const active = this.list()
    const next = active[0]
    return { pending: active.length, ...(next ? { next: { text: next.text || describeReminderRepeat(next), at: next.nextAt } } : {}) }
  },

  getQuietHours(): QuietHours {
    return normalizeCompanionSettings(store.get('companionSettings')).quietHours
  },

  setQuietHours(quietHours: QuietHours): QuietHours {
    const settings = normalizeCompanionSettings({ ...store.get('companionSettings'), quietHours })
    store.set('companionSettings', settings)
    return settings.quietHours
  },

  /** Exposed for tests of the firing loop. */
  tick,
}
