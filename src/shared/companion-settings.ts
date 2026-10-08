import type { WidgetInstance } from './types'
import { DEFAULT_QUIET_HOURS, type QuietHours } from './reminders'

export interface CompanionSettings {
  /** Global shortcut that opens the desktop quick chat. Empty disables it. */
  quickChatShortcut: string
  quietHours: QuietHours
}

/** What the settings page reads: stored settings plus live state from the main process. */
export interface CompanionSettingsSnapshot extends CompanionSettings {
  /** False when another program already owns the shortcut. */
  shortcutActive: boolean
  /** Actions the user told the companion to stop asking about. */
  actionGrants: string[]
}

export const DEFAULT_QUICK_CHAT_SHORTCUT = 'CommandOrControl+Alt+Space'

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  quickChatShortcut: DEFAULT_QUICK_CHAT_SHORTCUT,
  quietHours: DEFAULT_QUIET_HOURS,
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'])
const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
}

/**
 * Turn a key press in the settings recorder into an Electron accelerator.
 * Uses the physical key (event.code) so Shift or an input method does not change it.
 * Returns null until the press is a usable global shortcut: at least Ctrl, Alt or Win plus one key.
 */
export function acceleratorFromKeyEvent(event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  let key: string | undefined
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5)
  else if (/^Numpad\d$/.test(event.code)) key = `num${event.code.slice(6)}`
  else if (/^F([1-9]|1\d|2[0-4])$/.test(event.code)) key = event.code
  else key = CODE_KEYS[event.code]
  if (!key) return null
  return [event.ctrlKey && 'CommandOrControl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key]
    .filter(Boolean)
    .join('+')
}

/** Show "CommandOrControl+Alt+Space" the way a Windows user reads it. */
export function shortcutKeyLabels(accelerator: string): string[] {
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((part) => (part === 'CommandOrControl' || part === 'CmdOrCtrl' ? 'Ctrl' : part === 'Super' ? 'Win' : part === 'Space' ? '空格' : part))
}

/** Human wording for an "以后都直接做" grant key. */
export function describeActionGrant(key: string): string {
  if (key === 'system:screenshot') return '截屏看屏幕'
  if (key.startsWith('app:')) return `打开「${key.slice(4)}」`
  return key
}

export function normalizeCompanionSettings(value: Partial<CompanionSettings> | undefined | null): CompanionSettings {
  const quiet = value?.quietHours
  return {
    quickChatShortcut: typeof value?.quickChatShortcut === 'string' ? value.quickChatShortcut.trim().slice(0, 64) : DEFAULT_QUICK_CHAT_SHORTCUT,
    quietHours: {
      enabled: quiet?.enabled === true,
      start: typeof quiet?.start === 'string' && /^\d{1,2}:\d{2}$/.test(quiet.start) ? quiet.start : DEFAULT_QUIET_HOURS.start,
      end: typeof quiet?.end === 'string' && /^\d{1,2}:\d{2}$/.test(quiet.end) ? quiet.end : DEFAULT_QUIET_HOURS.end,
    },
  }
}

/** A desktop the user asked the companion to remember ("保存成工作模式"). */
export interface DesktopMode {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  wallpaperId: string | null
  wallpaperName?: string
  /** Wallpaper-scoped widgets only; Dock and icon boxes stay global. */
  widgets: WidgetInstance[]
}
