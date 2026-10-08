import { ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ActionConfirmDecision, ActionConfirmRequest, ActionReceiptStatus } from '@shared/agent-actions'
import type { ChatAttachment } from '@shared/chat-attachments'
import type { AgentRunEvent, ChatMessage, ConversationMode } from '@shared/types'

export interface ChatToolCallPayload {
  streamId: string
  toolCallId: string
  toolName: string
  input: unknown
  status: 'start' | 'complete' | 'error'
  output?: unknown
  error?: string
  durationMs?: number
}

function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** Streaming chat API shared by the main chat page and the desktop quick chat. */
export function createChatStreamApi() {
  return {
    /** 本地生成 streamId，避免同步 IPC 阻塞渲染线程。 */
    sendMessage: (payload: { conversationId?: string; projectId?: string | null; mode?: ConversationMode; text: string; internal?: boolean; forceAgentRun?: boolean; attachmentIds?: string[] }): string => {
      const streamId = globalThis.crypto.randomUUID()
      ipcRenderer.send(IPC.CHAT_SEND_MESSAGE, { streamId, payload })
      return streamId
    },
    stopStream: (streamId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CHAT_STOP_STREAM, streamId),
    onStreamChunk: (cb: (data: { streamId: string; delta: string }) => void) => subscribe(IPC.CHAT_STREAM_CHUNK, cb),
    onStreamEnd: (cb: (data: { streamId: string; full: string; conversationId: string }) => void) => subscribe(IPC.CHAT_STREAM_END, cb),
    onStreamError: (cb: (data: { streamId: string; error: string }) => void) => subscribe(IPC.CHAT_STREAM_ERROR, cb),
    onToolCall: (cb: (data: ChatToolCallPayload) => void) => subscribe(IPC.CHAT_TOOL_CALL, cb),
    onAgentRunEvent: (cb: (data: { streamId: string } & AgentRunEvent) => void) => subscribe(IPC.AGENT_RUN_EVENT, cb),
    /** A desktop action waits for the user's yes in this window. */
    onActionConfirmRequest: (cb: (request: ActionConfirmRequest) => void) => subscribe(IPC.CHAT_ACTION_CONFIRM_REQUEST, cb),
    resolveActionConfirm: (confirmId: string, decision: ActionConfirmDecision): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_ACTION_CONFIRM_RESOLVE, confirmId, decision),
    undoAction: (journalId: string): Promise<{ ok: boolean; error?: string; summary?: string }> =>
      ipcRenderer.invoke(IPC.CHAT_ACTION_UNDO, journalId),
    /** Whether receipts shown in this window can still be undone. */
    getActionStatus: (journalIds: string[]): Promise<Record<string, ActionReceiptStatus>> =>
      ipcRenderer.invoke(IPC.CHAT_ACTION_STATUS, journalIds),
    /** Opens a native file picker; only files the user picks become readable. */
    attachFiles: (conversationId?: string | null): Promise<{ attachments: ChatAttachment[]; rejected: { name: string; reason: string }[] }> =>
      ipcRenderer.invoke(IPC.CHAT_ATTACH_FILES, conversationId ?? null),
    /** Pasted screenshots / dropped files: contents only, the path never leaves the renderer. */
    attachData: (files: { name: string; bytes: Uint8Array }[], conversationId?: string | null): Promise<{ attachments: ChatAttachment[]; rejected: { name: string; reason: string }[] }> =>
      ipcRenderer.invoke(IPC.CHAT_ATTACH_DATA, files, conversationId ?? null),
    getHistory: (conversationId: string, limit?: number): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC.CHAT_GET_HISTORY, conversationId, limit),
  }
}
