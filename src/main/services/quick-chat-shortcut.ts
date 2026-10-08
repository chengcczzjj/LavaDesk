import { app, globalShortcut } from 'electron'
import { normalizeCompanionSettings } from '@shared/companion-settings'
import { store } from '../store'
import { toggleQuickChat } from '../windows/quickChatWindow'

let registered: string | null = null

/**
 * (Re)bind the global shortcut that opens the desktop quick chat. Returns
 * false when another app already owns the accelerator.
 */
export function applyQuickChatShortcut(accelerator = normalizeCompanionSettings(store.get('companionSettings')).quickChatShortcut): boolean {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = null
  }
  if (!accelerator) return true
  try {
    const ok = globalShortcut.register(accelerator, () => toggleQuickChat())
    if (ok) registered = accelerator
    else console.warn(`[quick-chat] shortcut ${accelerator} is taken by another application`)
    return ok
  } catch (error) {
    console.warn('[quick-chat] invalid shortcut:', accelerator, error)
    return false
  }
}

export function getRegisteredQuickChatShortcut(): string | null {
  return registered
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
