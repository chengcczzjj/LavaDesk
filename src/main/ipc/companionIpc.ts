import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import { normalizeCompanionSettings, type CompanionSettingsSnapshot } from '@shared/companion-settings'
import { store } from '../store'
import { assertTrustedIpcSender } from './ipcSecurity'
import { showMainWindow } from './appIpc'
import { hideQuickChat, toggleQuickChat } from '../windows/quickChatWindow'
import { applyQuickChatShortcut, getRegisteredQuickChatShortcut } from '../services/quick-chat-shortcut'
import { listActionGrants, revokeActionGrant } from '../memory/desktop/actionPolicy'

const companionSettingsSchema = z.object({
  quickChatShortcut: z.string().trim().max(64).optional(),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  }).optional(),
}).strict()

function settingsSnapshot(): CompanionSettingsSnapshot {
  const settings = normalizeCompanionSettings(store.get('companionSettings'))
  return {
    ...settings,
    shortcutActive: !settings.quickChatShortcut || getRegisteredQuickChatShortcut() === settings.quickChatShortcut,
    actionGrants: listActionGrants(),
  }
}

export function registerCompanionIpc(): void {
  // Canvas: clicking the desktop pet; main UI / tray style entry points.
  ipcMain.on(IPC.QUICK_CHAT_TOGGLE, (event) => {
    assertTrustedIpcSender(event, ['canvas', 'main'])
    toggleQuickChat()
  })

  ipcMain.on(IPC.QUICK_CHAT_HIDE, (event) => {
    assertTrustedIpcSender(event, ['quick-chat'])
    hideQuickChat()
  })

  ipcMain.on(IPC.QUICK_CHAT_OPEN_MAIN, (event, conversationId?: unknown) => {
    assertTrustedIpcSender(event, ['quick-chat'])
    hideQuickChat()
    showMainWindow({
      activity: 'memory',
      ...(typeof conversationId === 'string' && conversationId.length <= 128 ? { conversationId } : {}),
    })
  })

  ipcMain.handle(IPC.COMPANION_GET_SETTINGS, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return settingsSnapshot()
  })

  ipcMain.handle(IPC.COMPANION_SET_SETTINGS, (event, patch: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    const parsed = companionSettingsSchema.parse(patch)
    const next = normalizeCompanionSettings({ ...normalizeCompanionSettings(store.get('companionSettings')), ...parsed })
    store.set('companionSettings', next)
    if (parsed.quickChatShortcut !== undefined) applyQuickChatShortcut(next.quickChatShortcut)
    return settingsSnapshot()
  })

  ipcMain.handle(IPC.COMPANION_REVOKE_ACTION_GRANT, (event, key: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    revokeActionGrant(z.string().min(1).max(200).parse(key))
    return settingsSnapshot()
  })
}
