import { ConversationStore } from '../conversations/conversationStore'
import { EventStore } from '../events/eventStore'
import { AgentRunStore } from '../agent/agentRunStore'
import { RunCancellation } from '../agent/runCancellation'
import { createAgentRunTitle, createInitialAgentPlan, shouldCreateAgentRun, updatePlanForRunStatus } from '../agent/agentPlanner'
import { ProjectStore } from '../projects/projectStore'
import { classifyBasic } from '../routing/sceneRouter'
import { buildInitialContext } from '../routing/contextPacker'
import { ModelConfig } from '../models/config'
import { getModelCapabilities, streamChat } from '../models/chatModel'
import { buildToolRouterPrompt, decideToolRoute, getToolSet, type ToolCallEvent } from '../tools'
import { store } from '../../store'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { DEFAULT_CHAT_PERSONA } from '@shared/persona'
import { getToolManifest } from '@shared/tool-manifest'
import { isDeclinedToolOutput, isFailedToolOutput, readActionReceipt } from '@shared/tool-result'
import { imageMediaType } from '@shared/chat-attachments'
import { petStateForTool } from '@shared/widget-command'
import type { ChatTerminalStatus } from '@shared/agent-runtime'
import type { ConversationMode } from '../events/types'
import type { ConversationRecord } from '../conversations/conversationStore'
import type { AgentApproval, AgentRunEvent, AgentRunStatus } from '@shared/types'
import type { ModelMessage } from 'ai'
import { createManagedToolSet, shouldCacheToolCall, toolCacheKey, type ConfirmationRequester } from './toolExecution'
import { buildDesktopSnapshotText } from '../desktop/desktopState'
import { ActionJournal } from '../desktop/actionJournal'
import { AttachmentStore } from '../desktop/attachmentStore'
import { setPetAgentPhase } from '../desktop/petBridge'

export interface SendMessageParams {
  conversationId?: string
  projectId?: string | null
  mode?: ConversationMode
  text: string
  internal?: boolean
  forceAgentRun?: boolean
  /** Files the user attached to this message (ids from AttachmentStore.register). */
  attachmentIds?: string[]
  abortSignal?: AbortSignal
}

export interface ChatStreamCallbacks {
  onToken: (delta: string) => void
  onDone: (full: string, conversationId: string) => void
  onError: (error: string) => void
  onToolCall?: (event: ToolCallEvent) => void
  onRunEvent?: (event: AgentRunEvent) => void
  /** Interactive surfaces answer confirmation cards; background runs leave this out. */
  requestConfirmation?: ConfirmationRequester
}

function extractContextFiles(output: unknown): string[] {
  if (!output || typeof output !== 'object') return []
  const value = (output as { contextFiles?: unknown }).contextFiles
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function extractApproval(output: unknown): AgentApproval | null {
  if (!output || typeof output !== 'object') return null
  const value = (output as { approval?: unknown }).approval
  if (!value || typeof value !== 'object') return null
  return value as AgentApproval
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ((error as Error).name === 'AbortError' || (error as Error).message?.includes('abort')))
}

function createAbortError(): Error {
  const error = new Error('用户已停止任务。')
  error.name = 'AbortError'
  return error
}

function getSavedPersonaPrompt(): string | undefined {
  const persona = store.get('persona')
  const prompt = persona?.prompt?.trim()
  if (!prompt) return undefined

  const name = persona?.name?.trim()
  return name ? `${prompt}\n\n【当前人设名称】${name}` : prompt
}

export interface ChatSendResult {
  status: ChatTerminalStatus
  conversationId: string
  runId: string | null
  text: string
  error?: string
}

function getActivePersonaSnapshot(): { name: string; prompt: string } {
  const persona = store.get('persona')
  return {
    name: persona?.name?.trim() || DEFAULT_CHAT_PERSONA.name,
    prompt: persona?.prompt?.trim() || DEFAULT_CHAT_PERSONA.prompt,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function booleanValue(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}


interface ToolFailureSummary {
  toolName: string
  message: string
  technical: string
}

function friendlyToolFailureMessage(toolName: string, message?: string | null): string {
  if (toolName === 'weather') return message || '天气服务暂时没有响应，实时天气没有拿到。'
  if (toolName === 'web_search' || toolName === 'news') return message || '联网信息暂时没有拿稳。'
  if (toolName === 'get_user_location') return message || '当前位置暂时没有确认到。'
  if (toolName.includes('widget')) return message || '这个桌面组件操作刚刚没有完成。'
  return message || '这一步工具没有顺利完成。'
}

function summarizeToolFailure(toolName: string, output: unknown, error?: unknown): ToolFailureSummary {
  const record = asRecord(output)
  const userMessage = stringValue(record, 'userMessage') ?? stringValue(record, 'message')
  const technical = error
    ? String(error)
    : stringValue(record, 'debugError') ?? stringValue(record, 'error') ?? stringValue(record, 'message') ?? 'tool returned ok=false'
  const path = stringValue(record, 'path')
  return {
    toolName,
    message: friendlyToolFailureMessage(toolName, userMessage),
    technical: path ? `${toolName}(${path}): ${technical}` : `${toolName}: ${technical}`,
  }
}

function personaFailureTone(): 'girl' | 'playful' | 'warm' {
  const persona = getActivePersonaSnapshot()
  const value = `${persona.name}\n${persona.prompt}`
  if (/女|少女|女孩|姐姐|妹妹|晴蓝|猫娘|温柔|可爱|撒娇/.test(value)) return 'girl'
  if (/阿鬣|坏笑|嘴很欠|毒舌|调侃|吐槽/.test(value)) return 'playful'
  return 'warm'
}

function buildToolFailureReply(failures: ToolFailureSummary[]): string {
  const first = failures[0]
  const tone = personaFailureTone()
  if (!first) {
    if (tone === 'girl') return '呜，这一下我没做成。你要我继续查原因的话，我可以接着看。'
    if (tone === 'playful') return '啧，这一下没跑通。你要我查原因的话，我继续追。'
    return '这一步没有做成。你要我继续查原因的话，我可以接着看。'
  }
  if (failures.every((failure) => failure.toolName === 'weather')) {
    if (tone === 'girl') return `呜，${first.message}这次没查到。你给我一个具体城市嘛，我再试一次。`
    if (tone === 'playful') return `啧，${first.message}这次没查到。给我个城市名，我再冲一次。`
    return `${first.message}这次没查到。你给我一个具体城市，我再试一次。`
  }
  if (tone === 'girl') return `呜，${first.message}我这一步没做成。你要我查查哪里卡住了，我就继续看。`
  if (tone === 'playful') return `啧，${first.message}这一步没成。你要我查原因的话，我继续追。`
  return `${first.message}这一步没有做成。你要我继续检查原因的话，我可以接着看。`
}

const DELIVERY_TOOL_NAMES = new Set([
  'create_file',
  'write_file',
  'patch_file',
  'create_directory',
  'copy_path',
  'move_path',
  'restore_from_trash',
  'generate_artifact',
  'write_docx',
  'write_xlsx',
  'verify_workspace_result',
])

function isSuccessfulDelivery(toolName: string, output: unknown): boolean {
  const record = asRecord(output)
  return DELIVERY_TOOL_NAMES.has(toolName) && booleanValue(record, 'ok') === true
}

function summarizeSuccessfulDelivery(toolName: string, output: unknown): string {
  const record = asRecord(output)
  const change = asRecord(record?.change)
  const artifact = asRecord(record?.artifact)
  const path = stringValue(record, 'path') ?? stringValue(change, 'path') ?? stringValue(artifact, 'path')
  if (path) return `${toolName}: ${path}`
  if (toolName === 'verify_workspace_result') return 'verify_workspace_result: 验证通过'
  return `${toolName}: 已完成`
}

const WRITE_TOOL_NAMES = new Set([
  'create_file',
  'patch_file',
  'write_file',
  'create_directory',
  'copy_path',
  'move_path',
  'delete_to_trash',
  'restore_from_trash',
  'generate_artifact',
  'write_docx',
  'write_xlsx',
])

const READ_TOOL_NAMES = new Set([
  'list_directory',
  'read_file',
  'search_text',
  'get_file_info',
  'get_user_location',
  'web_search',
  'weather',
  'news',
  'extract_pdf_text',
  'read_docx',
  'read_xlsx',
  'ocr_image',
])

function shouldAttachAgentRunForTool(toolName: string): boolean {
  return getToolManifest(toolName)?.tracksAgentRun === true
}

function getToolPlanHint(toolName: string): string {
  if (WRITE_TOOL_NAMES.has(toolName)) return '写入文件 生成产物 验证结果'
  if (toolName === 'run_command') return '运行命令 验证结果'
  if (toolName.includes('checkpoint')) return '创建快照 验证结果'
  if (READ_TOOL_NAMES.has(toolName)) return '读取文件 搜索信息 分析上下文'
  return '使用工具 获取信息 整理回复'
}

function summarizeCompletedTool(toolName: string, output: unknown): string {
  const record = asRecord(output)
  const receipt = readActionReceipt(output)
  if (receipt) return receipt.summary
  const path = stringValue(record, 'path')
  const formatted = stringValue(record, 'formatted')
  const abstract = stringValue(record, 'abstract')
  const location = stringValue(record, 'location')
  const result = record?.result

  if (formatted) return `${toolName}: ${formatted}`
  if (typeof result === 'number' || typeof result === 'string') return `${toolName}: ${result}`
  if (path) return `${toolName}: ${path}`
  if (abstract) return `${toolName}: ${abstract}`
  if (location) return `${toolName}: ${location}`
  return `${toolName}: 已完成`
}

const MAX_INLINE_IMAGES = 4

/**
 * Vision-capable models see the images the user attached to this message
 * directly; other attachments stay listed as text for read_attachment.
 */
async function attachImagesToLatestUserMessage(messages: ModelMessage[], attachments: ReturnType<typeof AttachmentStore.bind>): Promise<void> {
  const images = attachments.filter((item) => item.kind === 'image').slice(0, MAX_INLINE_IMAGES)
  if (images.length === 0) return
  const index = messages.map((message) => message.role).lastIndexOf('user')
  const message = messages[index]
  if (!message || typeof message.content !== 'string') return
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: string }> = [
    { type: 'text', text: message.content },
  ]
  for (const image of images) {
    const grant = AttachmentStore.get(image.id)
    if (!grant) continue
    try {
      parts.push({ type: 'image', image: await fs.readFile(grant.path), mediaType: imageMediaType(grant.name) })
    } catch {
      // Unreadable file: the text list still names it and read_attachment reports the error.
    }
  }
  if (parts.length > 1) messages[index] = { role: 'user', content: parts }
}

export const ChatService = {
  /** 发送消息并流式返回回复（支持 tool calling 多步推理） */
  async sendMessage(params: SendMessageParams, callbacks: ChatStreamCallbacks): Promise<ChatSendResult> {
    const { text, mode = 'daily' } = params

    // 1. 获取/创建会话
    const conv = ConversationStore.getOrCreate(params.conversationId, mode, params.projectId)
    const turnId = randomUUID()
    const attachments = params.attachmentIds?.length ? AttachmentStore.bind(params.attachmentIds, conv.id) : []
    const workspaceId = conv.projectId ?? params.projectId ?? null
    const workspace = workspaceId ? ProjectStore.get(workspaceId) : undefined
    const toolContext = { workspaceId, runId: undefined as string | undefined, threadId: conv.id }
    const shouldTrackRun = shouldCreateAgentRun({ intent: text, workspace, force: params.forceAgentRun })
    let currentPlan = [] as ReturnType<typeof createInitialAgentPlan>
    let run: ReturnType<typeof AgentRunStore.create> | null = null
    let registeredRunId: string | null = null
    const ensureAgentRun = (initialStatus: AgentRunStatus = 'scoping', planHint = '') => {
      if (run) return run
      const planIntent = planHint ? `${text}\n${planHint}` : text
      currentPlan = createInitialAgentPlan({ intent: planIntent, workspace })
      if (initialStatus !== 'scoping') currentPlan = updatePlanForRunStatus(currentPlan, initialStatus)
      run = AgentRunStore.create({
        threadId: conv.id,
        workspaceId,
        intent: createAgentRunTitle({ intent: planIntent, workspace }),
        status: initialStatus,
        plan: currentPlan,
      })
      toolContext.runId = run.id
      RunCancellation.register(run.id, params.abortSignal)
      registeredRunId = run.id
      callbacks.onRunEvent?.({
        type: 'run.started',
        runId: run.id,
        threadId: conv.id,
        workspaceId,
        status: run.status,
        run,
        createdAt: Date.now(),
      })
      return run
    }
    if (shouldTrackRun) ensureAgentRun()
    let hasPendingApproval = false
    const toolFailures: ToolFailureSummary[] = []
    const successfulDeliveries: string[] = []
    const completedToolSummaries: string[] = []
    let full = ''
    const emitRunStatus = (status: AgentRunStatus, summary?: string) => {
      if (!run) return
      currentPlan = updatePlanForRunStatus(currentPlan, status)
      AgentRunStore.updatePlan(run.id, currentPlan)
      AgentRunStore.updateStatus(run.id, status, summary)
      const latest = AgentRunStore.get(run.id)
      callbacks.onRunEvent?.({
        type: status === 'completed' ? 'run.completed' : status === 'failed' ? 'run.failed' : status === 'cancelled' ? 'run.cancelled' : 'run.status_changed',
        runId: run.id,
        threadId: conv.id,
        workspaceId,
        status,
        summary,
        run: latest,
        createdAt: Date.now(),
      })
    }
    // 2. 场景判断（规则版）
    const scene = classifyBasic({ mode: conv.mode as ConversationMode, text })
    emitRunStatus('loading-context')

    // 3. 写入用户消息
    EventStore.append({
      conversationId: conv.id,
      eventType: params.internal ? 'system_event' : 'user_message',
      mode: conv.mode as ConversationMode,
      content: params.internal
        ? { type: 'internal_instruction', text }
        : { text, ...(attachments.length > 0 ? { attachments } : {}) },
    })
    setPetAgentPhase('thinking')

    // 4. 获取最近消息构建上下文
    const recent = EventStore.listRecent(conv.id, 30)
    // Keep widget/scene tools available for short follow-ups ("再大一点", "撤回")
    // that only make sense after the previous turns' widget work.
    const recentToolNames = recent
      .slice(-12)
      .filter((event) => event.eventType === 'tool_call')
      .map((event) => (event.content as { toolName?: unknown } | undefined)?.toolName)
      .filter((name): name is string => typeof name === 'string')
    const toolRoute = decideToolRoute({
      text,
      workspace,
      recentToolNames,
      hasAttachments: AttachmentStore.listForConversation(conv.id).length > 0,
    })

    // 5. 获取 model profile
    const profile = ModelConfig.getActive()
    if (!profile) {
      const message = '我现在还没连上可用的模型配置。你先去设置里加一个模型，我就能继续陪你聊了。'
      EventStore.append({
        conversationId: conv.id,
        eventType: 'assistant_message',
        mode: conv.mode as ConversationMode,
        content: { text: message },
      })
      ConversationStore.touch(conv.id)
      setPetAgentPhase(null)
      emitRunStatus('failed', '未配置模型。请在设置中添加模型 Profile。')
      callbacks.onDone(message, conv.id)
      return {
        status: 'failed',
        conversationId: conv.id,
        runId: registeredRunId,
        text: message,
        error: 'model-profile-missing',
      }
    }

    const modelCapabilities = getModelCapabilities(profile)
    const { system, dynamicSystem, messages } = buildInitialContext({
      scene,
      recentEvents: recent,
      persona: getSavedPersonaPrompt(),
      projectId: workspaceId,
      maxContextTokens: Math.max(4096, modelCapabilities.maxContextTokens - modelCapabilities.maxOutputTokens),
    })
    if (params.internal) messages.push({ role: 'user', content: text })
    else if (modelCapabilities.vision) await attachImagesToLatestUserMessage(messages, attachments)
    const effectiveToolRoute = modelCapabilities.toolCalling
      ? toolRoute
      : {
          ...toolRoute,
          toolNames: [],
          usesWidgets: false,
          usesAttachments: false,
          usesDesktopScene: false,
          usesWorkspaceRead: false,
          usesWorkspaceWrite: false,
          usesDocuments: false,
          usesCommand: false,
        }
    const toolRouterSystem = buildToolRouterPrompt({ workspace, route: effectiveToolRoute })
    const capabilitySystem = modelCapabilities.toolCalling
      ? ''
      : '\n\n【当前模型能力限制】当前模型配置已禁用工具调用。不要声称读取了实时信息、修改了文件或操作了桌面；如任务依赖工具，请明确建议用户切换支持工具的模型。'
    // Stable prefix (persona, tool guidance) first; per-turn facts last so provider prompt caches keep hitting.
    const journalDigest = ActionJournal.digest(conv.id)
    const turnSystem = [
      dynamicSystem,
      modelCapabilities.toolCalling ? `【桌面现状】\n${buildDesktopSnapshotText()}` : '',
      journalDigest ? `【最近的桌面操作】\n${journalDigest}` : '',
    ].filter(Boolean).join('\n\n')
    const workspaceSystem = [system, `${toolRouterSystem}${capabilitySystem}`.trim(), turnSystem].filter(Boolean).join('\n\n')

    // 6. 获取工具集
    const rawTools = getToolSet(toolContext, effectiveToolRoute.toolNames)
    const tools = createManagedToolSet(rawTools, {
      conversationId: conv.id,
      turnId,
      requestConfirmation: callbacks.requestConfirmation,
    })
    const visibleToolOffsets = new Map<string, number>()
    const hiddenDuplicateToolCallIds = new Set<string>()

    // 7. 流式调用（带 tool calling 支持）
    try {
      if (params.abortSignal?.aborted) throw createAbortError()
      emitRunStatus('executing')
      const result = await streamChat(profile, messages, {
        system: workspaceSystem,
        tools,
        maxSteps: modelCapabilities.reasoning ? 12 : 8,
        abortSignal: params.abortSignal,
        toolCallbacks: {
          onTextDelta(delta) {
            full += delta
            callbacks.onToken(delta)
          },
          onToolCallStart({ toolName, toolCallId, input }) {
            if (shouldCacheToolCall(toolName)) {
              const key = toolCacheKey(toolName, input)
              const previousOffset = visibleToolOffsets.get(key)
              if (previousOffset === full.length) {
                hiddenDuplicateToolCallIds.add(toolCallId)
                return
              }
              visibleToolOffsets.set(key, full.length)
            }
            setPetAgentPhase(petStateForTool(toolName))
            if (!run && shouldAttachAgentRunForTool(toolName)) {
              ensureAgentRun('executing', getToolPlanHint(toolName))
            }
            if (run && toolName === 'create_checkpoint') {
              currentPlan = updatePlanForRunStatus(currentPlan, 'checkpointing')
              AgentRunStore.updatePlan(run.id, currentPlan)
              AgentRunStore.updateStatus(run.id, 'checkpointing', '正在创建文件快照')
            } else if (run && toolName === 'verify_workspace_result') {
              currentPlan = updatePlanForRunStatus(currentPlan, 'verifying')
              AgentRunStore.updatePlan(run.id, currentPlan)
              AgentRunStore.updateStatus(run.id, 'verifying', '正在验证任务结果')
            }
            const latest = run ? AgentRunStore.appendToolCall(run.id, toolName) : undefined
            if (run) {
              callbacks.onRunEvent?.({
                type: 'run.status_changed',
                runId: run.id,
                threadId: conv.id,
                workspaceId,
                status: toolName === 'create_checkpoint' ? 'checkpointing' : toolName === 'verify_workspace_result' ? 'verifying' : latest?.status ?? 'executing',
                run: latest,
                createdAt: Date.now(),
              })
            }
            // 记录 tool_call 事件
            EventStore.append({
              conversationId: conv.id,
              eventType: 'tool_call',
              mode: conv.mode as ConversationMode,
              content: { toolCallId, toolName, input, textOffset: full.length },
            })
            callbacks.onToolCall?.({
              toolCallId,
              toolName,
              input,
              status: 'start',
            })
          },
          onToolCallFinish({ toolName, toolCallId, output, error, durationMs }) {
            if (hiddenDuplicateToolCallIds.has(toolCallId)) {
              hiddenDuplicateToolCallIds.delete(toolCallId)
              return
            }
            const contextFiles = extractContextFiles(output)
            const approval = extractApproval(output)
            const failedTool = isFailedToolOutput(output, error)
            if (isSuccessfulDelivery(toolName, output)) {
              successfulDeliveries.push(summarizeSuccessfulDelivery(toolName, output))
            } else if (!failedTool && !approval && !isDeclinedToolOutput(output)) {
              completedToolSummaries.push(summarizeCompletedTool(toolName, output))
            }
            if (failedTool) {
              toolFailures.push(summarizeToolFailure(toolName, output, error))
            }
            if (approval && run) {
              hasPendingApproval = true
              currentPlan = updatePlanForRunStatus(currentPlan, 'waiting-approval')
              AgentRunStore.updatePlan(run.id, currentPlan)
              AgentRunStore.updateStatus(run.id, 'waiting-approval', approval.reason)
            }
            const latest = run && contextFiles.length > 0
              ? AgentRunStore.appendContextFiles(run.id, contextFiles)
              : run ? AgentRunStore.get(run.id) : undefined
            if (approval && run) {
              callbacks.onRunEvent?.({
                type: 'approval.requested',
                runId: run.id,
                threadId: conv.id,
                workspaceId,
                status: 'waiting-approval',
                summary: approval.reason,
                run: latest,
                createdAt: Date.now(),
              })
            }
            if (run && contextFiles.length > 0) {
              callbacks.onRunEvent?.({
                type: 'run.status_changed',
                runId: run.id,
                threadId: conv.id,
                workspaceId,
                status: latest?.status ?? 'executing',
                summary: `${toolName} 读取了 ${contextFiles.length} 个上下文路径`,
                run: latest,
                createdAt: Date.now(),
              })
            }
            // 记录 tool_result 事件
            EventStore.append({
              conversationId: conv.id,
              eventType: 'tool_result',
              mode: conv.mode as ConversationMode,
              content: {
                toolCallId,
                toolName,
                output: error ? undefined : output,
                error: error ? String(error) : undefined,
                durationMs,
              },
            })
            callbacks.onToolCall?.({
              toolCallId,
              toolName,
              input: undefined,
              status: failedTool ? 'error' : 'complete',
              output,
              error: error ? String(error) : undefined,
              durationMs,
            })
          },
          onStepFinish({ stepNumber, finishReason }) {
            // 当 Agent 循环达到 stop 条件时记录
            if (finishReason === 'stop' && stepNumber > 0) {
              EventStore.append({
                conversationId: conv.id,
                eventType: 'system_event',
                mode: conv.mode as ConversationMode,
                content: { type: 'agent_loop_complete', steps: stepNumber + 1 },
              })
            }
          },
        },
      })

      for await (const chunk of result.textStream) {
        if (params.abortSignal?.aborted) throw createAbortError()
        full += chunk
        callbacks.onToken(chunk)
      }

      const finalStreamText = (await result.text).trim()
      if (finalStreamText && finalStreamText !== full.trim()) {
        full = finalStreamText
      }

      // 8. 写入 AI 回复
      const failedSummary = toolFailures.slice(0, 3)
      const assistantText = hasPendingApproval
        ? [full.trim(), '需要授权后继续。'].filter(Boolean).join('\n\n')
        : full.trim() || (failedSummary.length > 0
          ? buildToolFailureReply(failedSummary)
          : successfulDeliveries.length > 0
              ? ['已完成本轮任务。', ...successfulDeliveries.slice(0, 3).map((item) => `- ${item}`)].join('\n')
              : completedToolSummaries.length > 0
                ? ['搞定了：', ...completedToolSummaries.slice(0, 4).map((item) => `- ${item}`)].join('\n')
                : full)

      if (!assistantText.trim()) {
        const finishReason = await Promise.resolve(result.finishReason).catch(() => undefined)
        const rawFinishReason = await Promise.resolve(result.rawFinishReason).catch(() => undefined)
        const reasonText = [finishReason, rawFinishReason].filter(Boolean).join(' / ')
        throw new Error(reasonText
          ? `模型没有返回可显示内容（${reasonText}）。请稍后重试或切换模型。`
          : '模型没有返回可显示内容。请稍后重试或切换模型。')
      }

      EventStore.append({
        conversationId: conv.id,
        eventType: 'assistant_message',
        mode: conv.mode as ConversationMode,
        content: { text: assistantText },
      })

      // 9. 更新会话活跃时间
      ConversationStore.touch(conv.id)

      // 10. 首条消息时自动生成标题
      if (!params.internal && !conv.title && assistantText) {
        const title = text.slice(0, 30) + (text.length > 30 ? '…' : '')
        ConversationStore.updateTitle(conv.id, title)
      }

      setPetAgentPhase(failedSummary.length > 0 ? 'confused' : null, 5000)
      emitRunStatus(
        hasPendingApproval ? 'waiting-approval' : failedSummary.length > 0 ? 'failed' : 'completed',
        hasPendingApproval ? '等待用户确认后继续' : assistantText.slice(0, 200),
      )
      callbacks.onDone(assistantText, conv.id)
      return {
        status: hasPendingApproval ? 'waiting-approval' : failedSummary.length > 0 ? 'failed' : 'completed',
        conversationId: conv.id,
        runId: registeredRunId,
        text: assistantText,
        ...(failedSummary.length > 0 ? { error: failedSummary.map((item) => item.technical).join('; ') } : {}),
      }
    } catch (e) {
      if (params.abortSignal?.aborted || isAbortError(e)) {
        setPetAgentPhase(null)
        const partial = full.trim()
        const message = partial || '已停止运行。已完成的步骤会保留在任务记录里。'
        EventStore.append({
          conversationId: conv.id,
          eventType: 'assistant_message',
          mode: conv.mode as ConversationMode,
          content: { text: message },
        })
        ConversationStore.touch(conv.id)
        emitRunStatus('cancelled', partial ? '用户已停止，已保留部分输出。' : '用户已停止任务。')
        callbacks.onDone(message, conv.id)
        return {
          status: 'cancelled',
          conversationId: conv.id,
          runId: registeredRunId,
          text: message,
        }
      }
      setPetAgentPhase('error', 5000)
      const fallback = full.trim() || buildToolFailureReply(toolFailures)
      EventStore.append({
        conversationId: conv.id,
        eventType: 'assistant_message',
        mode: conv.mode as ConversationMode,
        content: { text: fallback },
      })
      ConversationStore.touch(conv.id)
      emitRunStatus('failed', (e as Error).message)
      callbacks.onDone(fallback, conv.id)
      return {
        status: 'failed',
        conversationId: conv.id,
        runId: registeredRunId,
        text: fallback,
        error: (e as Error).message,
      }
    } finally {
      if (registeredRunId) RunCancellation.unregister(registeredRunId)
    }
  },

  /** 创建新会话 */
  createConversation(mode: ConversationMode = 'daily'): ConversationRecord {
    return ConversationStore.create(mode)
  },

  /** Reuse a conversation when it still exists (quick chat keeps one running thread). */
  getOrCreateConversation(id?: string): ConversationRecord {
    return ConversationStore.getOrCreate(id, 'daily')
  },

  /** 列出所有会话 */
  listConversations() {
    return ConversationStore.list()
  },

  /** 列出指定项目的会话 */
  listConversationsByProject(projectId: string) {
    return ConversationStore.listByProject(projectId)
  },

  /** 列出不属于项目的会话 */
  listConversationsWithoutProject() {
    return ConversationStore.listWithoutProject()
  },

  /** 获取会话历史消息 */
  getHistory(conversationId: string, limit = 100) {
    return EventStore.listRecent(conversationId, limit)
  },

  /** 删除会话 */
  deleteConversation(id: string) {
    ConversationStore.delete(id)
  },

  /** 重命名会话 */
  renameConversation(id: string, title: string) {
    ConversationStore.updateTitle(id, title)
  },

  /** 归档会话 */
  archiveConversation(id: string) {
    ConversationStore.archive(id)
  },

  /** 取消归档 */
  unarchiveConversation(id: string) {
    ConversationStore.unarchive(id)
  },

  /** 移动会话到项目 */
  moveConversationToProject(id: string, projectId: string | null) {
    ConversationStore.updateProject(id, projectId)
  },

  /** 导出会话为 Markdown */
  exportConversation(id: string): string {
    const conv = ConversationStore.list().find(c => c.id === id)
    const events = EventStore.listRecent(id, 500)
    const title = conv?.title || '新对话'
    const lines = [`# ${title}\n`]
    for (const e of events) {
      if (e.eventType === 'user_message') {
        lines.push(`## 👤 用户\n${e.content.text}\n`)
      } else if (e.eventType === 'assistant_message') {
        lines.push(`## 🤖 灵月\n${e.content.text}\n`)
      }
    }
    return lines.join('\n')
  },
}
