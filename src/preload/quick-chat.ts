import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ChatMessage } from '@shared/types'
import { createChatStreamApi } from './chat-stream'

const api = {
  chat: {
    ...createChatStreamApi(),
    getQuickConversation: (options?: { reset?: boolean }): Promise<{ conversationId: string; history: ChatMessage[] }> =>
      ipcRenderer.invoke(IPC.CHAT_GET_QUICK_CONVERSATION, options),
  },
  window: {
    hide: (): void => ipcRenderer.send(IPC.QUICK_CHAT_HIDE),
    openMain: (conversationId?: string): void => ipcRenderer.send(IPC.QUICK_CHAT_OPEN_MAIN, conversationId),
    onShown: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.QUICK_CHAT_SHOWN, handler)
      return () => ipcRenderer.removeListener(IPC.QUICK_CHAT_SHOWN, handler)
    },
  },
}

export type QuickChatApi = typeof api

export function exposeQuickChatApi(): void {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('quickChat', api)
  } else {
    ;(window as unknown as { quickChat: typeof api }).quickChat = api
  }
}
