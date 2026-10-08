import path from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { ipcMain, dialog, clipboard, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES } from '@shared/chat-attachments'
import { IPC } from '@shared/ipc-channels'
import { DEFAULT_CHAT_PERSONA } from '@shared/persona'
import { ChatService } from '../memory/chat/chatService'
import { AgentRunStore } from '../memory/agent/agentRunStore'
import { ArtifactStore } from '../memory/agent/artifactStore'
import { AutomationStore, type CreateAutomationInput, type UpdateAutomationInput } from '../memory/agent/automationStore'
import { runAutomationNow } from '../memory/agent/automationScheduler'
import { ApprovalStore } from '../memory/agent/approvalStore'
import { CheckpointStore } from '../memory/agent/checkpointStore'
import { FileChangeStore } from '../memory/agent/fileChangeStore'
import { MemoryStore } from '../memory/memories/memoryStore'
import { ProjectStore } from '../memory/projects/projectStore'
import { ModelConfig } from '../memory/models/config'
import { testConnection, listModels } from '../memory/models/chatModel'
import { store } from '../store'
import type { ConversationMode } from '../memory/events/types'
import type { ModelProfile } from '../memory/models/config'
import type { AgentApprovalDecision, AgentFileChangeReviewState, ChatMemory, WorkspacePermissionProfile } from '@shared/types'
import type { ActionConfirmRequest } from '@shared/agent-actions'
import { assertTrustedIpcSender, isTrustedIpcSender } from './ipcSecurity'
import { cancelActionConfirmations, requestActionConfirmation, resolveActionConfirmation } from '../memory/desktop/confirmationBroker'
import { ActionJournal } from '../memory/desktop/actionJournal'
import { AttachmentStore } from '../memory/desktop/attachmentStore'
import { expressPet } from '../memory/desktop/petBridge'
import { clearDesktopScenePreviewForTool } from './widgetIpc'
import { getQuickChatWindow, isQuickChatVisible, showQuickChat } from '../windows/quickChatWindow'
import { getMainWindow } from '../windows/mainWindow'

/** 当前正在进行的流式任务，用于 stop */
const activeStreams = new Map<string, AbortController>()
const grantedProjectRoots = new Set<string>()

const idSchema = z.string().min(1).max(128)
const attachDataSchema = z.array(z.object({
  name: z.string().min(1).max(260),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= MAX_ATTACHMENT_BYTES, '文件太大'),
})).min(1).max(8)
const nullableIdSchema = idSchema.nullable()
const conversationModeSchema = z.enum(['daily', 'work', 'private', 'tool'])
const modelProfileSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  provider: z.enum(['openai-compatible', 'google', 'deepseek']),
  baseURL: z.string().trim().max(2048).refine((value) => !value || /^https?:\/\//i.test(value), 'Base URL 仅支持 HTTP/HTTPS。'),
  apiKey: z.string().max(8192),
  model: z.string().trim().min(1).max(240),
  availableModels: z.array(z.string().max(240)).max(500).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  headers: z.record(z.string().max(128), z.string().max(4096)).refine((value) => Object.keys(value).length <= 32).optional(),
  capabilities: z.object({
    toolCalling: z.enum(['auto', 'native', 'disabled']).optional(),
    reasoning: z.boolean().optional(),
    vision: z.boolean().optional(),
    maxContextTokens: z.number().int().min(4096).max(10_000_000).optional(),
    maxOutputTokens: z.number().int().min(256).max(1_000_000).optional(),
  }).optional(),
})
const chatSendRequestSchema = z.object({
  streamId: z.string().uuid(),
  payload: z.object({
    conversationId: idSchema.optional(),
    projectId: nullableIdSchema.optional(),
    mode: conversationModeSchema.optional(),
    text: z.string().trim().min(1).max(100_000),
    internal: z.boolean().optional(),
    forceAgentRun: z.boolean().optional(),
    attachmentIds: z.array(z.string().min(1).max(40)).max(8).optional(),
  }),
})
const automationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(20_000),
  workspaceId: nullableIdSchema.optional(),
  conversationId: nullableIdSchema.optional(),
  scheduleType: z.enum(['manual', 'interval', 'daily']).optional(),
  intervalMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
  timeOfDay: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).nullable().optional(),
})
const automationUpdateSchema = automationCreateSchema.partial().extend({
  status: z.enum(['active', 'paused', 'deleted']).optional(),
})
const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  path: z.string().max(32_768).optional(),
  icon: z.string().max(256).optional(),
  color: z.string().max(64).optional(),
})
const projectUpdateSchema = projectCreateSchema.partial().extend({
  permissionProfile: z.enum(['read-only', 'ask-before-editing', 'workspace-write', 'full-access']).optional(),
})

function normalizeProjectRoot(value: string): string {
  if (!path.isAbsolute(value) || !existsSync(value) || !statSync(value).isDirectory()) {
    throw new Error('Workspace 必须是已选择的本地文件夹。')
  }
  return realpathSync(value)
}

function requireGrantedProjectRoot(value: string, currentRoot?: string | null): string {
  const normalized = normalizeProjectRoot(value)
  let current: string | null = null
  if (currentRoot) {
    try {
      current = normalizeProjectRoot(currentRoot)
    } catch {
      current = null
    }
  }
  if (normalized !== current && !grantedProjectRoots.has(normalized)) {
    throw new Error('请先通过文件夹选择器授权这个 Workspace。')
  }
  return normalized
}

function handleMain(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, ['main'])
    return listener(event, ...args)
  })
}

/** Channels both chat surfaces use: the main chat page and the desktop quick chat. */
function handleChatSurface(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, ['main', 'quick-chat'])
    return listener(event, ...args)
  })
}

function replyExcerpt(text: string): string {
  const plain = text.replace(/[#*`>|_~-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return plain.length > 60 ? `${plain.slice(0, 58)}…` : plain
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveArtifactPath(id: string): { absolutePath: string; relativePath: string } | { error: string } {
  const artifact = ArtifactStore.get(id)
  if (!artifact) return { error: 'Artifact 不存在。' }
  const run = AgentRunStore.get(artifact.runId)
  const workspace = run?.workspaceId ? ProjectStore.get(run.workspaceId) : null
  const rootPath = workspace?.rootPath ?? workspace?.path
  if (!rootPath) return { error: '找不到 Workspace 路径。' }
  const absolutePath = path.resolve(rootPath, artifact.path)
  if (!isInside(rootPath, absolutePath)) return { error: 'Artifact 路径位于 Workspace 外。' }
  return { absolutePath, relativePath: artifact.path }
}

function getProjectRoot(id: string): string | null {
  const project = ProjectStore.get(id)
  return project?.rootPath ?? project?.path ?? null
}

function resolveFileChangePath(id: string): { absolutePath: string; relativePath: string } | { error: string } {
  const change = FileChangeStore.get(id)
  if (!change) return { error: '文件变更不存在。' }
  const run = AgentRunStore.get(change.runId)
  const workspace = run?.workspaceId ? ProjectStore.get(run.workspaceId) : null
  const rootPath = workspace?.rootPath ?? workspace?.path
  if (!rootPath) return { error: '找不到 Workspace 路径。' }

  const targetPath = change.type === 'deleted-to-trash' && change.backupPath ? change.backupPath : change.path
  const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(rootPath, targetPath)
  if (!path.isAbsolute(targetPath) && !isInside(rootPath, absolutePath)) return { error: '文件路径位于 Workspace 外。' }
  return { absolutePath, relativePath: change.path }
}

async function openPathOrParent(absolutePath: string): Promise<{ ok: boolean; error?: string }> {
  const fs = await import('fs')
  const targetPath = fs.existsSync(absolutePath) ? absolutePath : path.dirname(absolutePath)
  const error = await shell.openPath(targetPath)
  return error ? { ok: false, error } : { ok: true }
}

async function showPathInFolder(absolutePath: string): Promise<{ ok: boolean; error?: string }> {
  const fs = await import('fs')
  if (!fs.existsSync(absolutePath)) return openPathOrParent(absolutePath)
  const stats = fs.statSync(absolutePath)
  if (stats.isDirectory()) return openPathOrParent(absolutePath)
  shell.showItemInFolder(absolutePath)
  return { ok: true }
}

function isMaskedApiKey(apiKey: string): boolean {
  return apiKey.includes('...')
}

function resolveProfileApiKey(profile: ModelProfile): ModelProfile {
  if (!isMaskedApiKey(profile.apiKey)) return profile
  const saved = ModelConfig.listProfiles().find((p) => p.id === profile.id)
  return saved?.apiKey ? { ...profile, apiKey: saved.apiKey } : profile
}

function prepareProfileForSave(profile: ModelProfile): ModelProfile {
  return resolveProfileApiKey(profile)
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return ''
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}...`
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

function profileForRenderer(profile: ModelProfile): ModelProfile {
  return { ...profile, apiKey: maskApiKey(profile.apiKey) }
}

export function registerChatIpc(): void {
  // ─── 聊天 ────────────────────────────────────────────────
  ipcMain.on(
    IPC.CHAT_SEND_MESSAGE,
    (event, request: unknown) => {
      if (!isTrustedIpcSender(event, ['main', 'quick-chat'])) return
      const parsed = chatSendRequestSchema.safeParse(request)
      if (!parsed.success) return
      const { streamId, payload } = parsed.data
      const sender = event.sender
      const controller = new AbortController()
      activeStreams.set(streamId, controller)

      setImmediate(() => {
        void ChatService.sendMessage(
          {
            conversationId: payload.conversationId,
            projectId: payload.projectId,
            mode: payload.mode,
            text: payload.text,
            internal: payload.internal,
            forceAgentRun: payload.forceAgentRun,
            attachmentIds: payload.attachmentIds,
            abortSignal: controller.signal,
          },
          {
            onToken(delta) {
              if (!sender.isDestroyed()) {
                sender.send(IPC.CHAT_STREAM_CHUNK, { streamId, delta })
              }
            },
            onDone(full, conversationId) {
              activeStreams.delete(streamId)
              if (!sender.isDestroyed()) {
                sender.send(IPC.CHAT_STREAM_END, { streamId, full, conversationId })
              }
              // A quick-chat reply that lands after the window was dismissed is said by the desktop pet.
              if (sender.id === getQuickChatWindow()?.webContents.id && !isQuickChatVisible() && full.trim()) {
                expressPet({ state: 'speaking', message: replyExcerpt(full), durationMs: 10_000 })
              }
            },
            onError(error) {
              activeStreams.delete(streamId)
              if (!sender.isDestroyed()) {
                sender.send(IPC.CHAT_STREAM_ERROR, { streamId, error })
              }
            },
            onToolCall(event) {
              if (!sender.isDestroyed()) {
                sender.send(IPC.CHAT_TOOL_CALL, { streamId, ...event })
              }
            },
            onRunEvent(runEvent) {
              if (!sender.isDestroyed()) {
                sender.send(IPC.AGENT_RUN_EVENT, { streamId, ...runEvent })
              }
            },
            requestConfirmation(request) {
              return requestActionConfirmation({
                request: { ...request, streamId },
                abortSignal: controller.signal,
                send: (payload: ActionConfirmRequest) => {
                  if (sender.isDestroyed()) return false
                  sender.send(IPC.CHAT_ACTION_CONFIRM_REQUEST, payload)
                  // The card must be seen to be answered: reopen the quick chat, or flash the main window.
                  if (sender.id === getQuickChatWindow()?.webContents.id) {
                    if (!isQuickChatVisible()) showQuickChat()
                  } else {
                    const main = getMainWindow()
                    if (main && main.webContents.id === sender.id && !main.isFocused()) main.flashFrame(true)
                  }
                  return true
                },
              })
            },
          }
        ).catch((error: unknown) => {
          activeStreams.delete(streamId)
          if (!sender.isDestroyed()) {
            sender.send(IPC.CHAT_STREAM_ERROR, { streamId, error: (error as Error).message ?? String(error) })
          }
        })
      })
    }
  )

  handleChatSurface(IPC.CHAT_STOP_STREAM, (_e, streamId: string) => {
    streamId = z.string().uuid().parse(streamId)
    cancelActionConfirmations(streamId)
    const controller = activeStreams.get(streamId)
    if (!controller) return { ok: false, error: '没有找到正在运行的任务。' }
    controller.abort()
    activeStreams.delete(streamId)
    return { ok: true }
  })

  handleChatSurface(IPC.CHAT_ACTION_CONFIRM_RESOLVE, (_e, confirmId: string, decision: string) => {
    const parsedDecision = z.enum(['allow', 'allow-always', 'deny']).parse(decision)
    return resolveActionConfirmation(z.string().uuid().parse(confirmId), parsedDecision)
  })

  handleChatSurface(IPC.CHAT_ACTION_UNDO, async (_e, journalId: string) => {
    const result = await ActionJournal.undo(z.string().min(1).max(20).parse(journalId))
    return { ok: result.ok, error: result.error, summary: result.entry?.summary }
  })

  handleChatSurface(IPC.CHAT_ACTION_STATUS, (_e, ids: unknown) => {
    return ActionJournal.status(z.array(z.string().min(1).max(20)).max(60).parse(ids))
  })

  // The user picks attachments in a native dialog, so every granted path is one they chose.
  handleChatSurface(IPC.CHAT_ATTACH_FILES, async (event, conversationId?: string | null) => {
    const owner = event.sender.id === getQuickChatWindow()?.webContents.id ? getQuickChatWindow() : null
    const options: Electron.OpenDialogOptions = {
      title: '添加照片和文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片和文档', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'docx', 'xlsx', 'txt', 'md', 'csv', 'json', 'log'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { attachments: [], rejected: [] }
    return AttachmentStore.register(result.filePaths, conversationId ? idSchema.parse(conversationId) : null)
  })

  // Paste / drag-and-drop: the renderer sends file contents it was handed, never a path.
  handleChatSurface(IPC.CHAT_ATTACH_DATA, async (_event, files: unknown, conversationId?: string | null) => {
    const parsed = attachDataSchema.parse(files)
    return AttachmentStore.registerData(
      parsed.map((file) => ({ name: file.name, bytes: file.bytes })),
      conversationId ? idSchema.parse(conversationId) : null,
    )
  })

  handleChatSurface(IPC.CHAT_DESKTOP_SCENE_CLEAR_PREVIEW, () => {
    clearDesktopScenePreviewForTool()
    return true
  })

  handleChatSurface(IPC.CHAT_GET_QUICK_CONVERSATION, (_e, options?: { reset?: boolean }) => {
    const savedId = options?.reset ? undefined : store.get('quickChatConversationId')
    const conversation = ChatService.getOrCreateConversation(savedId)
    if (conversation.id !== savedId) {
      store.set('quickChatConversationId', conversation.id)
      if (!conversation.title) ChatService.renameConversation(conversation.id, '桌面快聊')
    }
    return { conversationId: conversation.id, history: ChatService.getHistory(conversation.id, 40) }
  })

  handleMain(
    IPC.CHAT_NEW_CONVERSATION,
    (_e, mode?: ConversationMode) => ChatService.createConversation(mode)
  )

  handleMain(
    IPC.CHAT_LIST_CONVERSATIONS,
    () => ChatService.listConversations()
  )

  handleChatSurface(
    IPC.CHAT_GET_HISTORY,
    (_e, conversationId: string, limit?: number) => ChatService.getHistory(conversationId, limit)
  )

  handleMain(
    IPC.CHAT_DELETE_CONVERSATION,
    (_e, id: string) => { ChatService.deleteConversation(id); return true }
  )

  handleMain(
    IPC.CHAT_RENAME_CONVERSATION,
    (_e, id: string, title: string) => { ChatService.renameConversation(id, title); return true }
  )

  handleMain(
    IPC.CHAT_ARCHIVE_CONVERSATION,
    (_e, id: string) => { ChatService.archiveConversation(id); return true }
  )

  handleMain(
    IPC.CHAT_UNARCHIVE_CONVERSATION,
    (_e, id: string) => { ChatService.unarchiveConversation(id); return true }
  )

  handleMain(
    IPC.CHAT_MOVE_CONVERSATION,
    (_e, id: string, projectId: string | null) => { ChatService.moveConversationToProject(id, projectId); return true }
  )

  handleMain(
    IPC.CHAT_EXPORT_CONVERSATION,
    async (_e, id: string) => {
      const markdown = ChatService.exportConversation(id)
      const result = await dialog.showSaveDialog({
        defaultPath: `对话导出-${Date.now()}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (!result.canceled && result.filePath) {
        const fs = await import('fs/promises')
        await fs.writeFile(result.filePath, markdown, 'utf-8')
        return true
      }
      return false
    }
  )

  // ─── 模型 Profile 管理 ──────────────────────────────────
  handleMain(IPC.CHAT_LIST_PROFILES, () => {
    return ModelConfig.listProfiles().map(profileForRenderer)
  })

  handleMain(IPC.CHAT_GET_ACTIVE_PROFILE, () => {
    const profile = ModelConfig.getActive()
    return profile ? profileForRenderer(profile) : null
  })

  handleMain(IPC.CHAT_UPSERT_PROFILE, (_e, profile: ModelProfile) => {
    ModelConfig.upsertProfile(prepareProfileForSave(modelProfileSchema.parse(profile)))
    return true
  })

  handleMain(IPC.CHAT_DELETE_PROFILE, (_e, id: string) => {
    id = idSchema.parse(id)
    ModelConfig.deleteProfile(id)
    return true
  })

  handleMain(IPC.CHAT_SET_ACTIVE_PROFILE, (_e, id: string) => {
    id = idSchema.parse(id)
    ModelConfig.setActive(id)
    return true
  })

  handleMain(IPC.CHAT_TEST_PROFILE, async (_e, profile: ModelProfile) => {
    return testConnection(resolveProfileApiKey(modelProfileSchema.parse(profile)))
  })

  handleMain(IPC.CHAT_LIST_MODELS, async (_e, profile: ModelProfile) => {
    // Listing models is how users pick one, so a new profile may not have a
    // name or model yet.
    const listableProfile = modelProfileSchema.extend({
      name: z.string().trim().max(80),
      model: z.string().trim().max(240),
    }).parse(profile)
    return listModels(resolveProfileApiKey(listableProfile))
  })

  // ─── 人设 Persona ──────────────────────────────────────
  handleMain(IPC.CHAT_SAVE_PERSONA, (_e, persona: { name: string; prompt: string; avatar?: string }) => {
    store.set('persona', z.object({
      name: z.string().trim().min(1).max(80),
      prompt: z.string().max(20_000),
      avatar: z.string().max(1_000_000).optional(),
    }).parse(persona))
    return true
  })

  handleMain(IPC.CHAT_GET_PERSONA, () => {
    return store.get('persona') ?? { name: DEFAULT_CHAT_PERSONA.name, prompt: '', avatar: '' }
  })

  handleMain(IPC.CHAT_LIST_MEMORIES, (): ChatMemory[] => {
    try {
      return MemoryStore.query({ limit: 12 }).map((memory) => ({
        id: memory.id,
        key: memory.key,
        scope: memory.scope,
        memoryType: memory.memoryType,
        projectId: memory.projectId,
        content: memory.content,
        importance: memory.importance,
        confidence: memory.confidence,
        sensitivity: memory.sensitivity,
        updatedAt: memory.updatedAt,
      }))
    } catch (error) {
      console.warn('[chatIpc] list memories failed:', error)
      return []
    }
  })

  // ─── AgentRun ──────────────────────────────────────────
  handleMain(IPC.AGENT_RUN_LIST_BY_THREAD, (_e, threadId: string) => {
    return AgentRunStore.listByThread(threadId)
  })

  handleMain(IPC.AGENT_RUN_GET, (_e, id: string) => {
    return AgentRunStore.get(id) ?? null
  })

  handleMain(IPC.AGENT_APPROVAL_LIST_BY_RUN, (_e, runId: string) => {
    return ApprovalStore.listByRun(runId)
  })

  handleMain(IPC.AGENT_APPROVAL_RESOLVE, (_e, id: string, decision: AgentApprovalDecision) => {
    return ApprovalStore.resolve(idSchema.parse(id), z.enum(['allow-once', 'allow-workspace', 'deny']).parse(decision)) ?? null
  })

  handleMain(IPC.AGENT_FILE_CHANGE_LIST_BY_RUN, (_e, runId: string) => {
    return FileChangeStore.listByRun(runId)
  })

  handleMain(IPC.AGENT_FILE_CHANGE_SET_REVIEW_STATE, (_e, id: string, reviewState: AgentFileChangeReviewState) => {
    return FileChangeStore.updateReviewState(
      idSchema.parse(id),
      z.enum(['pending', 'accepted', 'rejected', 'restored']).parse(reviewState),
    ) ?? null
  })

  handleMain(IPC.AGENT_FILE_CHANGE_RESTORE, (_e, id: string) => {
    const change = FileChangeStore.get(id)
    if (!change?.checkpointId) return { ok: false, error: '该变更没有可恢复 checkpoint。' }
    const run = AgentRunStore.get(change.runId)
    const workspace = run?.workspaceId ? ProjectStore.get(run.workspaceId) : null
    const rootPath = workspace?.rootPath ?? workspace?.path
    if (!rootPath) return { ok: false, error: '找不到 Workspace 路径。' }
    const restorePath = change.oldPath ?? change.path
    const result = CheckpointStore.restore(change.checkpointId, rootPath, [restorePath])
    FileChangeStore.updateReviewState(id, 'restored')
    return { ok: true, ...result }
  })

  handleMain(IPC.AGENT_FILE_CHANGE_OPEN, async (_e, id: string) => {
    const resolved = resolveFileChangePath(id)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    return openPathOrParent(resolved.absolutePath)
  })

  handleMain(IPC.AGENT_FILE_CHANGE_SHOW_IN_FOLDER, async (_e, id: string) => {
    const resolved = resolveFileChangePath(id)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    return showPathInFolder(resolved.absolutePath)
  })

  handleMain(IPC.AGENT_ARTIFACT_LIST_BY_RUN, (_e, runId: string) => {
    return ArtifactStore.listByRun(runId)
  })

  handleMain(IPC.AGENT_ARTIFACT_OPEN, async (_e, id: string) => {
    const resolved = resolveArtifactPath(id)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    const error = await shell.openPath(resolved.absolutePath)
    return error ? { ok: false, error } : { ok: true }
  })

  handleMain(IPC.AGENT_ARTIFACT_SHOW_IN_FOLDER, async (_e, id: string) => {
    const resolved = resolveArtifactPath(id)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    return showPathInFolder(resolved.absolutePath)
  })

  handleMain(IPC.AGENT_ARTIFACT_COPY_PATH, (_e, id: string) => {
    const resolved = resolveArtifactPath(id)
    if ('error' in resolved) return { ok: false, error: resolved.error }
    clipboard.writeText(resolved.relativePath)
    return { ok: true, path: resolved.relativePath }
  })

  handleMain(IPC.AGENT_AUTOMATION_LIST, () => {
    return AutomationStore.list()
  })

  handleMain(IPC.AGENT_AUTOMATION_CREATE, (_e, data: CreateAutomationInput) => {
    return AutomationStore.create(automationCreateSchema.parse(data))
  })

  handleMain(IPC.AGENT_AUTOMATION_UPDATE, (_e, id: string, data: UpdateAutomationInput) => {
    return AutomationStore.update(idSchema.parse(id), automationUpdateSchema.parse(data))
  })

  handleMain(IPC.AGENT_AUTOMATION_DELETE, (_e, id: string) => {
    return AutomationStore.softDelete(idSchema.parse(id))
  })

  handleMain(IPC.AGENT_AUTOMATION_RUN_NOW, (_e, id: string) => {
    return runAutomationNow(idSchema.parse(id))
  })

  handleMain(IPC.AGENT_AUTOMATION_RESULT_LIST, (_e, automationId?: string) => {
    return AutomationStore.listResults(automationId == null ? undefined : idSchema.parse(automationId))
  })

  // ─── 项目管理 ──────────────────────────────────────────
  handleMain(IPC.PROJECT_CREATE, (_e, data: { name: string; path?: string; icon?: string; color?: string }) => {
    const parsed = projectCreateSchema.parse(data)
    const root = parsed.path ? requireGrantedProjectRoot(parsed.path) : undefined
    return ProjectStore.create(parsed.name, root, parsed.icon, parsed.color)
  })

  handleMain(IPC.PROJECT_LIST, () => {
    return ProjectStore.list()
  })

  handleMain(IPC.PROJECT_GET, (_e, id: string) => {
    return ProjectStore.get(id) ?? null
  })

  handleMain(IPC.PROJECT_UPDATE, (_e, id: string, data: { name?: string; path?: string; icon?: string; color?: string; permissionProfile?: WorkspacePermissionProfile }) => {
    const projectId = idSchema.parse(id)
    const parsed = projectUpdateSchema.parse(data)
    const current = ProjectStore.get(projectId)
    const next = parsed.path
      ? { ...parsed, path: requireGrantedProjectRoot(parsed.path, current?.rootPath ?? current?.path), rootPath: requireGrantedProjectRoot(parsed.path, current?.rootPath ?? current?.path) }
      : parsed
    ProjectStore.update(projectId, next)
    return true
  })

  handleMain(IPC.PROJECT_DELETE, (_e, id: string) => {
    ProjectStore.delete(idSchema.parse(id))
    return true
  })

  handleMain(IPC.PROJECT_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const root = normalizeProjectRoot(result.filePaths[0])
    grantedProjectRoots.add(root)
    return root
  })

  handleMain(IPC.PROJECT_OPEN_FOLDER, async (_e, id: string) => {
    const rootPath = getProjectRoot(idSchema.parse(id))
    if (!rootPath) return { ok: false, error: '找不到项目文件夹。' }
    const error = await shell.openPath(rootPath)
    return error ? { ok: false, error } : { ok: true }
  })
}
