import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, type ReactNode } from 'react'
import {
  Sparkles,
  ArrowUp,
  Loader2,
  AlertCircle,
  User,
  Bot,
  Paperclip,
  Plus,
  Coffee,
  Sun,
  Moon,
  Sunset,
  PenLine,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Archive,
  FolderInput,
  Download,
  SlidersHorizontal,
  Clock,
  CalendarDays,
  ArrowUpDown,
  Square,
  Play,
  Pause,
  Inbox,
  Brain,
  Heart,
  Target,
  Zap,
  X,
  Maximize2,
} from 'lucide-react'
import type { AgentApproval, AgentApprovalDecision, AgentArtifact, AgentAutomation, AgentAutomationResult, AgentFileChange, AgentRun, ChatConversation, ChatMemory, ChatProject, WorkspacePermissionProfile } from '@shared/types'
import { TOOL_MANIFEST, getToolManifest } from '@shared/tool-manifest'
import { PixelPetCanvas } from '@renderer/shared/PixelPetCanvas'
import {
  PIXEL_PET_CHANGE_EVENT,
  PIXEL_PET_SETTINGS_KEY,
  PIXEL_PET_STATES,
  PIXEL_PET_STORAGE_KEY,
  createDefaultPixelPets,
  getActivePixelPet,
  normalizePixelPet,
  normalizePixelPetSettings,
  type PixelPet,
  type PixelPetSettings,
  type PixelPetStateKey,
} from '@renderer/shared/pixel-pet'
import { PersonaPage } from './PersonaPage'
import './chat.css'

// ─── Types ────────────────────────────────────────────────
type ChatStatus = 'idle' | 'connecting' | 'thinking' | 'streaming' | 'error'
type SubView = 'chat' | 'persona'
type SortMode = 'by-project' | 'recent-project' | 'by-time' | 'pinned-first'
type SortOrder = 'created' | 'updated'
type DisplayFilter = 'all' | 'relevant'

const CHAT_SIDEBAR_STATE_KEY = 'lingyue-chat-sidebar-state'
const PET_IDLE_STATES: PixelPetStateKey[] = ['idle', 'sit', 'walk', 'reading', 'music', 'sleepy']
const PET_TRANSIENT_MS = 1800
const MEMORY_PLACEHOLDER_TYPES = [
  { type: 'preference', label: '偏好', line: '喜欢的语气、工具和工作节奏会沉淀在这里' },
  { type: 'relationship', label: '关系', line: '常提到的人、宠物和协作关系会归档在这里' },
  { type: 'goal', label: '目标', line: '长期项目、计划和承诺会被整理成目标记忆' },
  { type: 'episode', label: '片段', line: '一次对话里的关键事实会形成可回忆的碎片' },
]

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  status?: 'sending' | 'done' | 'error'
  timestamp?: number
  toolCalls?: ToolCallDisplay[]
  fileChanges?: AgentFileChange[]
  artifacts?: AgentArtifact[]
  processOpen?: boolean
}

interface ToolCallDisplay {
  toolCallId: string
  toolName: string
  input: unknown
  status: 'running' | 'done' | 'error'
  output?: unknown
  error?: string
  durationMs?: number
  textOffset?: number
}

interface ChatHistoryEvent {
  id: string
  eventType: string
  content: Record<string, unknown>
  createdAt: number
}

interface ChatPetSnapshot {
  pets: PixelPet[]
  settings: PixelPetSettings
  activePet: PixelPet
}

// ─── Helpers ──────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function loadChatPetSnapshot(): ChatPetSnapshot {
  const defaults = createDefaultPixelPets()
  let pets = defaults

  try {
    const savedPets = JSON.parse(localStorage.getItem(PIXEL_PET_STORAGE_KEY) || '[]')
    const defaultIds = new Set(defaults.map((pet) => pet.id))
    const generatedPets = Array.isArray(savedPets)
      ? savedPets
          .filter((pet) => !defaultIds.has(isRecord(pet) ? String(pet.id || '') : ''))
          .map(normalizePixelPet)
      : []
    pets = [...defaults, ...generatedPets]
  } catch {
    pets = defaults
  }

  let settings: PixelPetSettings
  try {
    settings = normalizePixelPetSettings(JSON.parse(localStorage.getItem(PIXEL_PET_SETTINGS_KEY) || '{}'), pets)
  } catch {
    settings = normalizePixelPetSettings({}, pets)
  }

  return {
    pets,
    settings,
    activePet: getActivePixelPet(pets, settings),
  }
}

function getDailyPetState(): PixelPetStateKey {
  return PET_IDLE_STATES[Math.floor(Date.now() / 45_000) % PET_IDLE_STATES.length]
}

function inferPetStateFromText(text: string): PixelPetStateKey {
  const value = text.toLowerCase()
  if (/bug|报错|错误|失败|崩|error|fail/.test(value)) return 'error'
  if (/新闻|搜索|网页|资料|查一下|search|web/.test(value)) return 'surfing'
  if (/代码|开发|构建|修复|文件|项目|code|build|fix/.test(value)) return 'coding'
  if (/记忆|整理|归档|总结|memory/.test(value)) return 'organizing'
  if (/为什么|怎么|如何|\?|？/.test(value)) return 'thinking'
  if (/难过|伤心|不开心|累|烦|焦虑|哭/.test(value)) return 'sorrow'
  if (/开心|喜欢|太好了|棒|快乐|哈哈/.test(value)) return 'joy'
  return 'speaking'
}

function getToolDrivenPetState(toolCalls: ToolCallDisplay[]): PixelPetStateKey | null {
  const toolNames = toolCalls.map((item) => item.toolName)
  if (toolNames.some((name) => name.includes('memory'))) return 'organizing'
  if (toolNames.some((name) => name.includes('search') || name.includes('web') || name.includes('news'))) return 'surfing'
  if (toolNames.some((name) => name.includes('file') || name.includes('workspace') || name.includes('command') || name.includes('code'))) return 'coding'
  if (toolNames.length > 0) return 'thinking'
  return null
}

function petStatusText(name: string, status: ChatStatus, state: PixelPetStateKey, toolCalls: ToolCallDisplay[], elapsedSeconds: number): string {
  if (status === 'error') return `${name}这一步卡住了，等你看一眼。`
  if (status === 'idle') return `${name}正在${PIXEL_PET_STATES[state].short}中...`
  if (elapsedSeconds >= 25) return `${name}还在等结果回来，这轮有点慢。`
  if (status === 'connecting') return `${name}正在接上思路...`
  if (status === 'thinking') return `${name}在认真琢磨你的问题...`

  const toolNames = toolCalls.map((item) => item.toolName)
  if (toolNames.some((toolName) => toolName.includes('memory'))) return `${name}在翻找记忆线索...`
  if (toolNames.some((toolName) => toolName.includes('search') || toolName.includes('web') || toolName.includes('news'))) return `${name}去看最新信息了...`
  if (toolNames.some((toolName) => toolName.includes('file') || toolName.includes('workspace') || toolName.includes('command'))) return `${name}在处理工作区...`
  return `${name}正在回应你...`
}


function memoryTypeLabel(type: string | null): string {
  if (!type) return '片段'
  if (type.includes('preference') || type.includes('偏好')) return '偏好'
  if (type.includes('relationship') || type.includes('关系')) return '关系'
  if (type.includes('goal') || type.includes('目标')) return '目标'
  if (type.includes('project') || type.includes('项目')) return '项目'
  return '片段'
}

function importanceLabel(importance: ChatMemory['importance']): string {
  if (importance === 'high') return '重要'
  if (importance === 'medium') return '常用'
  return '轻量'
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const VISIBLE_TASK_TOOL_PREFIXES = [
  'workspace_',
  'create_',
  'write_',
  'patch_',
  'copy_',
  'move_',
  'delete_',
  'restore_',
  'run_command',
  'verify_',
  'extract_',
  'read_docx',
  'read_xlsx',
  'ocr_',
  'generate_',
]

function shouldShowAgentRun(run: AgentRun): boolean {
  if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') return true
  const hasRecordedActivity = run.toolCalls.length > 0 || run.contextFiles.length > 0 || run.approvals.length > 0 || run.fileChanges.length > 0 || run.artifacts.length > 0 || run.checkpoints.length > 0 || Boolean(run.verification)
  if (!hasRecordedActivity) return false
  if (run.approvals.length || run.fileChanges.length || run.artifacts.length || run.checkpoints.length || run.verification) return true
  if (run.plan.some((step) => step.toolCategory !== 'reasoning' && step.toolCategory !== 'response')) return true
  return run.toolCalls.some((toolName) => VISIBLE_TASK_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix)))
}

function changeTypeLabel(type: AgentFileChange['type']): string {
  if (type === 'created') return '新建'
  if (type === 'modified') return '修改'
  if (type === 'deleted-to-trash') return '删除'
  if (type === 'moved') return '移动'
  if (type === 'copied') return '复制'
  if (type === 'restored') return '恢复'
  return type
}

function artifactTypeLabel(type: AgentArtifact['type']): string {
  if (type === 'markdown') return 'Markdown'
  if (type === 'text') return '文本'
  if (type === 'csv') return 'CSV'
  if (type === 'json') return 'JSON'
  if (type === 'html') return 'HTML'
  if (type === 'document') return '文档'
  if (type === 'spreadsheet') return '表格'
  if (type === 'image') return '图片'
  return '产物'
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function agentRunDisplayTitle(run: AgentRun): string {
  const title = run.intent.trim()
  if (title) return title
  if (run.fileChanges.length > 0) return '更新工作区文件'
  if (run.artifacts.length > 0) return '生成工作区产物'
  if (run.toolCalls.some((item) => item.includes('search'))) return '搜索并整理结果'
  if (run.toolCalls.some((item) => item.includes('read'))) return '读取项目上下文'
  return '执行复杂任务'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function booleanValue(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function numberValue(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArrayValue(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function truncateSingleLine(value: string, maxLength = 160): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine
}

function splitParagraphs(value?: string): string[] {
  if (!value?.trim()) return []
  const byBlankLines = value.trim().split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  if (byBlankLines.length > 1) return byBlankLines
  return value.trim().split(/\n/).map((item) => item.trim()).filter(Boolean)
}

function isOperationalAssistantText(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (value === '正在连接模型，准备开始处理。') return true
  if (value === '正在理解任务，并判断需要哪些工具。') return true
  if (value === '正在判断需要哪些工具，并开始执行合适的步骤。') return true
  if (value === '我先接上模型，马上开始处理。') return true
  if (value === '我先理一下你的需求，看看要查哪几处。') return true
  if (value === '我先把线索铺开，处理过程会放在这里。') return true
  if (value === '思考中') return true
  if (value === '仍在思考中') return true
  if (value === '需要授权后继续。') return true
  if (value === '已停止运行。已完成的步骤会保留在任务记录里。') return true
  if (value.startsWith('工具执行未完成，未生成最终交付结果。')) return true
  if (value.startsWith('已完成本轮任务。')) return true
  return false
}

function splitTrailingOperationalText(text: string): { text: string; statusText: string } {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) return { text: '', statusText: '' }
  if (isOperationalAssistantText(text)) return { text: '', statusText: text.trim() }

  const statusParts: string[] = []
  const contentParts = [...paragraphs]
  while (contentParts.length > 0) {
    const last = contentParts[contentParts.length - 1]
    if (!isOperationalAssistantText(last)) break
    statusParts.unshift(contentParts.pop()!)
  }

  return {
    text: contentParts.join('\n\n'),
    statusText: statusParts.join('\n\n'),
  }
}

type AssistantContentItem =
  | { type: 'bubble'; id: string; text: string }
  | { type: 'tools'; id: string; calls: ToolCallDisplay[] }
  | { type: 'status'; id: string; text: string }

function buildAssistantContentTimeline(params: {
  text: string
  toolCalls?: ToolCallDisplay[]
  live?: boolean
  status?: ChatStatus
  elapsedSeconds?: number
}): AssistantContentItem[] {
  const { text, toolCalls = [], live = false, status = 'idle', elapsedSeconds = 0 } = params
  const finalParts = splitTrailingOperationalText(text)
  const displayText = finalParts.text
  const items: AssistantContentItem[] = []
  const sortedCalls = toolCalls.map((call, index) => ({ call, index })).sort((a, b) => {
    const left = a.call.textOffset ?? Number.MAX_SAFE_INTEGER
    const right = b.call.textOffset ?? Number.MAX_SAFE_INTEGER
    return left === right ? a.index - b.index : left - right
  })

  const appendText = (value: string) => {
    for (const paragraph of splitParagraphs(value)) {
      items.push({ type: 'bubble', id: `bubble-${items.length}`, text: paragraph })
    }
  }

  let cursor = 0
  let toolBlock: ToolCallDisplay[] = []
  const flushToolBlock = () => {
    if (toolBlock.length === 0) return
    items.push({ type: 'tools', id: `tools-${items.length}`, calls: toolBlock })
    toolBlock = []
  }

  for (const { call } of sortedCalls) {
    const offset = typeof call.textOffset === 'number'
      ? Math.max(0, Math.min(call.textOffset, displayText.length))
      : cursor
    const segment = offset > cursor ? displayText.slice(cursor, offset) : ''
    if (segment.trim()) {
      flushToolBlock()
      appendText(segment)
    }
    cursor = Math.max(cursor, offset)
    toolBlock.push(call)
  }

  flushToolBlock()
  if (cursor < displayText.length) appendText(displayText.slice(cursor))
  if (finalParts.statusText.trim()) {
    items.push({ type: 'status', id: `status-${items.length}`, text: finalParts.statusText.trim() })
  }
  if (items.length === 0 && live) {
    items.push({ type: 'status', id: 'status-thinking', text: toolProgressSentence(toolCalls, status, elapsedSeconds) })
  }

  return items
}

function redactToolPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 220 ? `${value.slice(0, 220)}...` : value
  }
  if (Array.isArray(value)) return value.slice(0, 12).map(redactToolPayload)
  const record = asRecord(value)
  if (!record) return value
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'content') {
      next[key] = typeof item === 'string' ? `[已隐藏 ${item.length} 字内容]` : '[已隐藏内容]'
    } else if (key === 'stdout' || key === 'stderr' || key === 'text') {
      next[key] = typeof item === 'string' ? (item.length > 1200 ? `${item.slice(0, 1200)}\n...` : item) : item
    } else {
      next[key] = redactToolPayload(item)
    }
  }
  return next
}

function formatToolPayload(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(redactToolPayload(value), null, 2)
  } catch {
    return String(value)
  }
}

function toolOutputNeedsApproval(output: unknown): boolean {
  return booleanValue(asRecord(output), 'approvalRequired') === true
}

function isFailedToolResult(output: unknown, error?: string): boolean {
  if (error) return true
  const record = asRecord(output)
  return booleanValue(record, 'ok') === false && !toolOutputNeedsApproval(output)
}

function buildDisplayMessagesFromEvents(events: ChatHistoryEvent[]): DisplayMessage[] {
  const result: DisplayMessage[] = []
  let pendingTools: ToolCallDisplay[] = []

  for (const event of events) {
    if (event.eventType === 'user_message') {
      result.push({
        id: event.id,
        role: 'user',
        text: typeof event.content.text === 'string' ? event.content.text : '',
        status: 'done',
        timestamp: event.createdAt,
      })
      continue
    }

    if (event.eventType === 'tool_call') {
      const toolCallId = typeof event.content.toolCallId === 'string' ? event.content.toolCallId : event.id
      const toolName = typeof event.content.toolName === 'string' ? event.content.toolName : 'unknown_tool'
      pendingTools.push({
        toolCallId,
        toolName,
        input: event.content.input,
        status: 'running',
        textOffset: typeof event.content.textOffset === 'number' ? event.content.textOffset : undefined,
      })
      continue
    }

    if (event.eventType === 'tool_result') {
      const toolCallId = typeof event.content.toolCallId === 'string' ? event.content.toolCallId : event.id
      const toolName = typeof event.content.toolName === 'string' ? event.content.toolName : 'unknown_tool'
      const error = typeof event.content.error === 'string' ? event.content.error : undefined
      const durationMs = typeof event.content.durationMs === 'number' ? event.content.durationMs : undefined
      const index = pendingTools.findIndex((item) => item.toolCallId === toolCallId)
      const next: ToolCallDisplay = {
        toolCallId,
        toolName,
        input: index >= 0 ? pendingTools[index].input : undefined,
        status: isFailedToolResult(event.content.output, error) ? 'error' : 'done',
        output: event.content.output,
        error,
        durationMs,
      }
      if (index >= 0) pendingTools[index] = { ...pendingTools[index], ...next }
      else pendingTools.push(next)
      continue
    }

    if (event.eventType === 'assistant_message') {
      const assistantText = typeof event.content.text === 'string' ? event.content.text : ''
      if (!assistantText.trim() && pendingTools.length === 0) continue
      result.push({
        id: event.id,
        role: 'assistant',
        text: assistantText,
        status: 'done',
        timestamp: event.createdAt,
        toolCalls: pendingTools.length > 0 ? pendingTools.map((item) => ({ ...item })) : undefined,
      })
      pendingTools = []
    }
  }

  return result
}

function toolPathFromCall(tc: ToolCallDisplay): string | null {
  const input = asRecord(tc.input)
  const output = asRecord(tc.output)
  const change = asRecord(output?.change)
  const artifact = asRecord(output?.artifact)
  return stringValue(output, 'path')
    ?? stringValue(change, 'path')
    ?? stringValue(artifact, 'path')
    ?? stringValue(input, 'path')
    ?? stringValue(input, 'targetPath')
    ?? stringValue(input, 'sourcePath')
    ?? stringArrayValue(output, 'contextFiles')[0]
    ?? null
}

function toolErrorDetail(toolName: string, rawError?: string | null, message?: string | null): string {
  if (toolName === 'weather') return message || '天气服务暂时没响应'
  if (toolName === 'web_search' || toolName === 'news') return message || '联网信息暂时没拿到'
  if (toolName === 'get_user_location') return message || '位置暂时没确认'
  if (toolName.includes('widget') || toolName.includes('desktop_scene')) return message || '桌面编排没完成'
  return message || (rawError ? '这一步没顺利完成' : '工具调用')
}

function toolActivityInfo(tc: ToolCallDisplay): { title: string; detail: string; meta?: string; log?: string; path?: string; ok?: boolean | null } {
  const input = asRecord(tc.input)
  const output = asRecord(tc.output)
  const ok = booleanValue(output, 'ok')
  const pathValue = toolPathFromCall(tc)
  const rawError = tc.error ?? stringValue(output, 'debugError') ?? stringValue(output, 'error')
  const userMessage = stringValue(output, 'userMessage') ?? stringValue(output, 'message')
  const error = rawError ?? userMessage
  const label = TOOL_NAME_LABELS[tc.toolName] || tc.toolName
  const content = stringValue(input, 'content')
  const hiddenContentMeta = content ? `内容 ${content.length} 字，已隐藏` : undefined

  if (tc.toolName === 'get_user_location') {
    const displayName = stringValue(output, 'displayName')
    const source = stringValue(output, 'source')
    const precision = stringValue(output, 'precision')
    const approximate = booleanValue(output, 'approximate')
    const accuracyMeters = typeof output?.accuracyMeters === 'number' ? output.accuracyMeters : null
    const precisionText = precision === 'device'
      ? accuracyMeters ? `设备定位，精度约 ${Math.round(accuracyMeters)} 米` : '设备定位'
      : approximate ? '城市级近似位置' : null
    const meta = [precisionText, source ? `来源：${source}` : null].filter(Boolean).join(' · ')
    return {
      title: ok === false || tc.status === 'error' ? '定位没完成' : tc.status === 'running' ? '获取位置' : '已获取位置',
      detail: tc.status === 'running' ? '正在获取当前位置' : displayName ? `当前位置：${displayName}` : (error ?? '当前位置'),
      meta: error ?? (meta || undefined),
      ok,
    }
  }

  if (tc.toolName === 'weather') {
    const current = asRecord(output?.current)
    const location = stringValue(output, 'location')
    const temperature = stringValue(current, 'temperature')
    const weather = stringValue(current, 'weather')
    const failed = ok === false || tc.status === 'error'
    return {
      title: failed ? '天气没查到' : tc.status === 'running' ? '查询天气' : '天气已查到',
      detail: failed
        ? toolErrorDetail(tc.toolName, rawError, userMessage)
        : [location, weather, temperature].filter(Boolean).join(' · ') || '实时天气',
      meta: failed ? rawError ?? undefined : undefined,
      ok,
    }
  }

  if (tc.toolName === 'web_search') {
    const query = stringValue(input, 'query')
    const resultCount = typeof output?.resultCount === 'number'
      ? output.resultCount
      : Array.isArray(output?.results) ? output.results.length : null
    const provider = stringValue(output, 'providerLabel') ?? stringValue(output, 'provider')
    const action = tc.status === 'running'
      ? '正在搜索'
      : ok === false || tc.status === 'error'
        ? '搜索失败'
        : typeof resultCount === 'number'
          ? `找到 ${resultCount} 条`
          : '已搜索'
    return {
      title: ok === false || tc.status === 'error' ? '网页搜索没完成' : tc.status === 'running' ? '搜索网页' : '网页搜索完成',
      detail: query ? `${action}：${truncateSingleLine(query, 90)}` : '正在搜索网页',
      meta: error ?? (provider ? `来源：${provider}` : undefined),
      ok,
    }
  }

  if (tc.toolName === 'run_command') {
    const args = stringArrayValue(input, 'args')
    const command = [stringValue(input, 'command'), ...args].filter(Boolean).join(' ')
    const cwd = stringValue(input, 'cwd') ?? '.'
    const stdout = stringValue(output, 'stdout')
    const stderr = stringValue(output, 'stderr')
    const log = [stdout, stderr].filter(Boolean).join('\n')
    return {
      title: ok === false || tc.status === 'error' ? '命令没跑完' : tc.status === 'running' ? '运行命令' : '命令已跑完',
      detail: command ? truncateSingleLine(command, 180) : label,
      meta: `cwd: ${cwd}`,
      log: log ? (log.length > 4000 ? `${log.slice(0, 4000)}\n...` : log) : undefined,
      ok,
    }
  }

  if (tc.toolName === 'create_file' || tc.toolName === 'write_file' || tc.toolName === 'patch_file') {
    const verb = tc.toolName === 'patch_file' ? '修改文件' : tc.toolName === 'write_file' ? '写入文件' : '创建文件'
    return {
      title: ok === false || tc.status === 'error' ? `${verb}没完成` : tc.status === 'running' ? verb : `${verb}完成`,
      detail: pathValue ?? '等待文件路径',
      meta: error ?? hiddenContentMeta,
      path: pathValue ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'create_checkpoint') {
    const skippedPaths = stringArrayValue(output, 'skippedPaths')
    const protectedFiles = stringArrayValue(output, 'protectedFiles')
    return {
      title: skippedPaths.length > 0 && protectedFiles.length === 0 ? '无需快照' : ok === false || tc.status === 'error' ? '快照没建好' : tc.status === 'running' ? '保护现场' : '快照已创建',
      detail: skippedPaths.length > 0 && protectedFiles.length === 0 ? `新文件无需快照：${skippedPaths[0]}` : protectedFiles[0] ?? toolPathFromCall(tc) ?? '保护受影响文件',
      meta: error ?? (skippedPaths.length > 0 ? `跳过 ${skippedPaths.length} 个不存在的新路径` : undefined),
      path: protectedFiles[0] ?? skippedPaths[0],
      ok,
    }
  }

  if (tc.toolName === 'generate_artifact' || tc.toolName === 'write_docx' || tc.toolName === 'write_xlsx') {
    return {
      title: ok === false || tc.status === 'error' ? '产物没生成' : tc.status === 'running' ? '整理产物' : '产物已生成',
      detail: pathValue ?? stringValue(input, 'name') ?? label,
      meta: error ?? hiddenContentMeta,
      path: pathValue ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'search_text') {
    const query = stringValue(input, 'query')
    return { title: '搜索工作区', detail: query ? `关键词：${truncateSingleLine(query, 90)}` : label, path: pathValue ?? undefined, ok }
  }

  if (tc.toolName === 'read_file' || tc.toolName === 'list_directory' || tc.toolName === 'get_file_info') {
    return { title: label, detail: pathValue ?? '读取工作区上下文', path: pathValue ?? undefined, ok }
  }

  if (tc.toolName === 'widget_capability_list') {
    const count = numberValue(output, 'count')
    const detail = typeof count === 'number' ? `已读取 ${count} 类组件能力` : '读取组件能力和美学边界'
    return {
      title: ok === false || tc.status === 'error' ? '组件能力没读到' : tc.status === 'running' ? '读取组件能力' : '组件能力已读取',
      detail,
      meta: error ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'desktop_scene_get') {
    const summary = asRecord(output?.aestheticSummary)
    const visibleCount = numberValue(summary, 'visibleWidgetCount')
    return {
      title: ok === false || tc.status === 'error' ? '桌面上下文没读到' : tc.status === 'running' ? '读取桌面上下文' : '桌面上下文已读取',
      detail: typeof visibleCount === 'number' ? `当前可见组件 ${visibleCount} 个` : '读取壁纸、组件和场景模板',
      meta: error ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'desktop_scene_preview') {
    const plan = asRecord(output?.plan)
    const check = asRecord(plan?.aestheticCheck)
    const sceneName = stringValue(plan, 'sceneName') ?? stringValue(plan, 'sceneId') ?? '桌面草案'
    const score = numberValue(check, 'score')
    const hiddenCount = stringArrayValue(plan, 'hiddenWidgetIds').length
    const scoreText = typeof score === 'number' ? `美学评分 ${score}` : '美学检查'
    const hiddenText = hiddenCount > 0 ? `，弱化 ${hiddenCount} 个组件` : ''
    return {
      title: ok === false || tc.status === 'error' ? '桌面草案没生成' : tc.status === 'running' ? '生成桌面草案' : '桌面草案已生成',
      detail: `${sceneName} · ${scoreText}${hiddenText}`,
      meta: error ?? stringValue(output, 'guidance') ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'desktop_scene_apply') {
    const snapshot = asRecord(output?.snapshot)
    const sceneName = stringValue(output, 'sceneName') ?? stringValue(output, 'sceneId') ?? '桌面草案'
    const snapshotId = stringValue(snapshot, 'id')
    const skipped = Array.isArray(output?.skippedPatches) ? output.skippedPatches.length : 0
    return {
      title: ok === false || tc.status === 'error' ? '桌面草案没应用' : tc.status === 'running' ? '应用桌面草案' : '桌面草案已应用',
      detail: snapshotId ? `${sceneName} · 已创建回滚快照` : sceneName,
      meta: error ?? (skipped > 0 ? `跳过 ${skipped} 个受保护或不可用操作` : stringValue(output, 'guidance') ?? undefined),
      ok,
    }
  }

  if (tc.toolName === 'desktop_scene_rollback') {
    const snapshot = asRecord(output?.snapshot)
    const reason = stringValue(snapshot, 'reason')
    return {
      title: ok === false || tc.status === 'error' ? '桌面回滚没完成' : tc.status === 'running' ? '回滚桌面布局' : '桌面布局已回滚',
      detail: reason ? `恢复：${reason}` : '恢复到上一次桌面编排前',
      meta: error ?? stringValue(output, 'guidance') ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'open_lavanotes') {
    const action = stringValue(input, 'action') ?? 'new'
    const actionLabel = action === 'manager' ? '打开便签管理' : action === 'show' ? '显示便签' : '新建便签'
    const notInstalled = output?.installed === false
    return {
      title: notInstalled ? '还没有安装 LavaNotes' : ok === false || tc.status === 'error' ? `${actionLabel}没完成` : tc.status === 'running' ? actionLabel : `${actionLabel}完成`,
      detail: stringValue(input, 'text') ?? 'LavaNotes 便签',
      meta: error ?? (notInstalled ? stringValue(output, 'downloadUrl') : undefined) ?? undefined,
      ok: notInstalled ? false : ok,
    }
  }

  if (WIDGET_TOOL_TITLES[tc.toolName]) {
    const widget = asRecord(output?.widget)
    // Show the widget's display name, never internal ids like "clock-1726…".
    const detail = stringValue(widget, 'displayName')
      ?? (tc.toolName === 'list_widgets' && typeof output?.count === 'number' ? `${output.count} 个组件` : undefined)
      ?? stringValue(input, 'title')
      ?? '桌面组件'
    const runningTitle = WIDGET_TOOL_TITLES[tc.toolName]
    return {
      title: ok === false || tc.status === 'error' ? `${runningTitle}没完成` : tc.status === 'running' ? runningTitle : `${runningTitle}完成`,
      detail,
      meta: error ?? undefined,
      ok,
    }
  }

  if (tc.toolName === 'verify_workspace_result') {
    return { title: '验证结果', detail: ok === false ? (error ?? '验证未通过') : '检查文件和产物状态', ok }
  }

  return { title: label, detail: pathValue ?? toolErrorDetail(tc.toolName, rawError, userMessage), meta: rawError ?? undefined, path: pathValue ?? undefined, ok }
}

const WIDGET_TOOL_TITLES: Record<string, string> = {
  list_widgets: '查看桌面组件',
  add_widget: '添加桌面组件',
  create_generated_widget: '生成专属组件',
  update_widget_config: '调整桌面组件',
  arrange_widget: '摆放桌面组件',
  update_generated_widget: '修改专属组件',
  remove_widget: '移除桌面组件',
}

function toolProgressSentence(toolCalls: ToolCallDisplay[], _status: ChatStatus, elapsedSeconds = 0): string {
  const latest = toolCalls[toolCalls.length - 1]
  if (!latest) {
    if (elapsedSeconds >= 25) return '仍在思考中'
    return '思考中'
  }

  const info = toolActivityInfo(latest)
  const target = info.detail && info.detail !== '工具调用' ? `：${info.detail}` : ''
  if (latest.status === 'running') {
    if (elapsedSeconds >= 25) return `这一步慢了一点，我还在等结果回来${target}。`
    if (latest.toolName.includes('memory')) return `我回头找找之前留下的线索${target}。`
    if (latest.toolName === 'get_user_location') return `我先确认一下当前位置${target}。`
    if (latest.toolName === 'search_text') return `我在工作区里翻一下相关线索${target}。`
    if (latest.toolName === 'web_search') return `正在搜索网页${target}。`
    if (latest.toolName === 'news') return `我去看眼最新信息${target}。`
    if (latest.toolName === 'weather') return `我确认一下实时天气${target}。`
    if (latest.toolName === 'widget_capability_list') return `我先看一下哪些桌面组件适合参与编排${target}。`
    if (latest.toolName === 'desktop_scene_get') return `我先读一下当前桌面、壁纸和组件状态${target}。`
    if (latest.toolName === 'desktop_scene_preview') return `我在生成一个只读桌面草案，并投到桌面上预览${target}。`
    if (latest.toolName === 'desktop_scene_apply') return `我在应用这个桌面草案，先留好可回滚快照${target}。`
    if (latest.toolName === 'desktop_scene_rollback') return `我在把桌面恢复到刚才应用前的样子${target}。`
    if (latest.toolName === 'list_widgets') return `我看一下桌面上现在放了哪些组件${target}。`
    if (latest.toolName === 'add_widget') return `我把这个小组件放到桌面上${target}。`
    if (latest.toolName === 'create_generated_widget') return `我把这个专属小组件做好并放到桌面上${target}。`
    if (latest.toolName === 'open_lavanotes') return `我用 LavaNotes 帮你记下来${target}。`
    if (latest.toolName === 'update_widget_config') return `我调整一下这个小组件${target}。`
    if (latest.toolName === 'arrange_widget') return `我把这个小组件摆到合适的位置${target}。`
    if (latest.toolName === 'update_generated_widget') return `我改一下这个专属小组件的内容${target}。`
    if (latest.toolName === 'remove_widget') return `我把这个小组件从桌面上拿掉${target}。`
    if (latest.toolName === 'read_file' || latest.toolName === 'list_directory' || latest.toolName === 'get_file_info') return `我先翻一下相关文件${target}。`
    if (latest.toolName === 'create_checkpoint') return `我先留一个可恢复的保护点${target}。`
    if (latest.toolName === 'create_file' || latest.toolName === 'write_file' || latest.toolName === 'patch_file') return `我把改动落到文件里${target}。`
    if (latest.toolName === 'verify_workspace_result') return `我检查一下结果有没有对上${target}。`
    if (latest.toolName === 'run_command') return `我跑一下命令，等结果回来${target}。`
    return `我继续处理这一步${target}。`
  }
  if (latest.status === 'error' || info.ok === false) return `${info.title}${target}没有顺利完成，我整理一下问题。`
  return `${info.title}${target}处理好了，我继续看下一步。`
}

function taskStepStatusClass(status: string): string {
  if (status === 'completed') return 'completed'
  if (status === 'running') return 'running'
  if (status === 'failed' || status === 'blocked') return 'blocked'
  if (status === 'skipped') return 'skipped'
  return 'pending'
}

const PERMISSION_OPTIONS: { value: WorkspacePermissionProfile; label: string; description: string }[] = [
  { value: 'read-only', label: '只读', description: '只允许读取项目文件' },
  { value: 'ask-before-editing', label: '自动审查', description: '修改或高风险操作前询问' },
  { value: 'workspace-write', label: '工作区写入', description: '允许在当前文件夹内读写' },
  { value: 'full-access', label: '完整访问', description: '允许更宽的本地操作' },
]

function permissionLabel(profile?: WorkspacePermissionProfile): string {
  return PERMISSION_OPTIONS.find((item) => item.value === profile)?.label ?? '自动审查'
}

function approvalResumePrompt(approval: AgentApproval): string {
  const paths = approval.affectedPaths.length > 0 ? approval.affectedPaths.join('\n') : '无'
  return [
    `用户已批准刚才暂停的授权请求，approvalId: ${approval.id}`,
    '请继续执行原任务，并在被拦截的工具调用参数里传入这个 approvalId。',
    `工具: ${approval.toolName}`,
    `操作: ${approval.action}`,
    `路径:\n${paths}`,
    approval.command ? `命令: ${approval.command}` : '',
  ].filter(Boolean).join('\n')
}

// ─── Error Banner ─────────────────────────────────────────
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="chat-error-banner">
      <AlertCircle size={14} />
      <span>{message}</span>
      <button onClick={onDismiss} className="chat-error-banner__close">✕</button>
    </div>
  )
}

// ─── Connection Status Dot ────────────────────────────────
function ConnectionDot({ connected }: { connected: boolean | null }) {
  if (connected === null) return <span className="status-dot status-dot--yellow" title="未测试" />
  if (connected) return <span className="status-dot status-dot--green" title="已连接" />
  return <span className="status-dot status-dot--red" title="未连接" />
}

// ─── Thinking Dots Component ──────────────────────────────
function ThinkingDots() {
  return (
    <span className="thinking-dots">
      <span className="thinking-dots__dot" />
      <span className="thinking-dots__dot" />
      <span className="thinking-dots__dot" />
    </span>
  )
}

// ─── Greeting System ──────────────────────────────────────
function getTimeGreeting(): { text: string; icon: React.ReactNode; mood: string } {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 9) return { text: '早安', icon: <Coffee size={20} />, mood: '…居然起这么早，不赖嘛' }
  if (hour >= 9 && hour < 12) return { text: '上午好', icon: <Sun size={20} />, mood: '有什么事就说吧，本小姐心情不错' }
  if (hour >= 12 && hour < 14) return { text: '中午好~', icon: <Sun size={20} />, mood: '吃饭了吗？…才不是关心你呢' }
  if (hour >= 14 && hour < 18) return { text: '下午好', icon: <Sunset size={20} />, mood: '工作别太拼了…虽然说了你也不听' }
  if (hour >= 18 && hour < 22) return { text: '晚上好', icon: <Moon size={20} />, mood: '终于忙完了？…算你还记得我' }
  return { text: '夜深了', icon: <Moon size={20} />, mood: '这么晚还不睡？真是让人操心…' }
}

// ─── Topic Suggestions ────────────────────────────────────
const TOPIC_POOLS = [
  // 日常闲聊
  ['今天过得怎么样？', '最近有什么开心的事', '推荐一部好看的番', '帮我想个周末计划'],
  // 情感陪伴
  ['有点累了…', '心情不太好', '想找人聊聊天', '夸夸我嘛~'],
  // 实用
  ['帮我写一段文案', '解释一个技术概念', '帮我翻译一段话', '帮我做个决定'],
  // 创意 / 互动
  ['给我讲个故事', '来玩个文字游戏', '说点毒舌的话来听', '写一首小诗'],
]

function getRandomTopics(count = 4): string[] {
  const all = TOPIC_POOLS.flat()
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function loadExpandedProjectIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CHAT_SIDEBAR_STATE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as { expandedProjectIds?: unknown }
    if (!Array.isArray(parsed.expandedProjectIds)) return new Set()
    return new Set(parsed.expandedProjectIds.filter((item): item is string => typeof item === 'string' && item.length > 0))
  } catch {
    return new Set()
  }
}

function saveExpandedProjectIds(expandedProjectIds: Set<string>): void {
  try {
    localStorage.setItem(CHAT_SIDEBAR_STATE_KEY, JSON.stringify({ expandedProjectIds: [...expandedProjectIds] }))
  } catch {
    return
  }
}

// ─── Main Component ───────────────────────────────────────
export function ChatPage() {
  const [subView, setSubView] = useState<SubView>('chat')
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [projects, setProjects] = useState<ChatProject[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle')
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modelName, setModelName] = useState('gpt-5.4')
  const [connected, setConnected] = useState<boolean | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallDisplay[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => loadExpandedProjectIds())
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('by-project')
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated')
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter>('all')
  const [sortMenuPos, setSortMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [automations, setAutomations] = useState<AgentAutomation[]>([])
  const [automationResults, setAutomationResults] = useState<AgentAutomationResult[]>([])
  const [currentTaskRunId, setCurrentTaskRunId] = useState<string | null>(null)
  const [chatMemories, setChatMemories] = useState<ChatMemory[]>([])
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
  const [petPanelOpen, setPetPanelOpen] = useState(false)
  const [petSnapshot, setPetSnapshot] = useState<ChatPetSnapshot>(() => loadChatPetSnapshot())
  const [sustainedPetState, setSustainedPetState] = useState<PixelPetStateKey>(() => getDailyPetState())
  const [transientPetState, setTransientPetState] = useState<PixelPetStateKey | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamIdRef = useRef<string | null>(null)
  const selectedProjectIdRef = useRef<string | null>(null)
  const currentTaskRunIdRef = useRef<string | null>(null)
  const streamingTextRef = useRef('')
  const streamRenderFrameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const chatStatusRef = useRef<ChatStatus>('idle')
  const activeConvIdRef = useRef<string | null>(null)
  const activeToolCallsRef = useRef<ToolCallDisplay[]>([])
  const pendingPermissionUpdatesRef = useRef<Map<string, Promise<void>>>(new Map())
  const transientPetTimerRef = useRef<number | null>(null)

  const selectProjectId = useCallback((projectId: string | null) => {
    selectedProjectIdRef.current = projectId
    setSelectedProjectId(projectId)
  }, [])

  const updateActiveToolCalls = useCallback((updater: (prev: ToolCallDisplay[]) => ToolCallDisplay[]) => {
    const next = updater(activeToolCallsRef.current)
    activeToolCallsRef.current = next
    setActiveToolCalls(next)
  }, [])

  const showTransientPetState = useCallback((state: PixelPetStateKey, duration = PET_TRANSIENT_MS) => {
    if (transientPetTimerRef.current) window.clearTimeout(transientPetTimerRef.current)
    setTransientPetState(state)
    transientPetTimerRef.current = window.setTimeout(() => {
      setTransientPetState(null)
      transientPetTimerRef.current = null
    }, duration)
  }, [])

  // Keep refs in sync with state
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId }, [selectedProjectId])
  useEffect(() => { currentTaskRunIdRef.current = currentTaskRunId }, [currentTaskRunId])

  useEffect(() => {
    saveExpandedProjectIds(expandedProjects)
  }, [expandedProjects])

  useEffect(() => {
    const refreshPet = () => setPetSnapshot(loadChatPetSnapshot())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PIXEL_PET_SETTINGS_KEY || event.key === PIXEL_PET_STORAGE_KEY) refreshPet()
    }
    window.addEventListener(PIXEL_PET_CHANGE_EVENT, refreshPet)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(PIXEL_PET_CHANGE_EVENT, refreshPet)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setSustainedPetState(getDailyPetState()), 45_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    if (transientPetTimerRef.current) window.clearTimeout(transientPetTimerRef.current)
  }, [])

  useEffect(() => {
    const activeProjectIds = new Set(projects.filter((project) => project.status === 'active').map((project) => project.id))
    if (activeProjectIds.size === 0) return
    setExpandedProjects((prev) => {
      const next = new Set([...prev].filter((id) => activeProjectIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [projects])

  // ── Timer for elapsed time ──
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    setElapsedTime(0)
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // ── Load conversations & projects ──
  const loadConversations = useCallback(async () => {
    const list = await window.lingyue.chat.listConversations()
    setConversations(list)
  }, [])

  const loadProjects = useCallback(async () => {
    const list = await window.lingyue.project.list()
    setProjects(list)
  }, [])

  const loadAutomations = useCallback(async () => {
    const [items, results] = await Promise.all([
      window.lingyue.chat.listAutomations(),
      window.lingyue.chat.listAutomationResults(),
    ])
    setAutomations(items)
    setAutomationResults(results)
  }, [])

  const loadMemories = useCallback(async () => {
    const memories = await window.lingyue.chat.listMemories()
    setChatMemories(memories)
  }, [])

  useEffect(() => {
    loadConversations()
    loadProjects()
    loadAutomations()
    loadMemories()
    window.lingyue.chat.getActiveProfile().then((p) => {
      if (p?.model) setModelName(p.model)
      else setModelName('未配置模型')
      setConnected(p ? null : false)
    })
  }, [loadConversations, loadProjects, loadAutomations, loadMemories])

  useEffect(() => {
    const timer = setInterval(() => { void loadAutomations() }, 30_000)
    return () => clearInterval(timer)
  }, [loadAutomations])

  // ── Load history when switching conversation ──
  useEffect(() => {
    if (!activeConvId) {
      setMessages([])
      setAgentRuns([])
      setCurrentTaskRunId(null)
      return
    }
    setCurrentTaskRunId(null)
    // 如果当前正在流式中（刚创建的新对话），不需要重新加载历史
    if (chatStatusRef.current !== 'idle') return
    window.lingyue.chat.getHistory(activeConvId).then((events) => {
      setMessages(buildDisplayMessagesFromEvents(events as ChatHistoryEvent[]))
    })
    window.lingyue.chat.listAgentRuns(activeConvId).then(setAgentRuns)
  }, [activeConvId])

  // ── Keep refs in sync with state ──
  useEffect(() => { chatStatusRef.current = chatStatus }, [chatStatus])
  useEffect(() => { activeConvIdRef.current = activeConvId }, [activeConvId])
  useEffect(() => { activeToolCallsRef.current = activeToolCalls }, [activeToolCalls])

  // ── Stream listeners (stable — no state in deps to avoid re-registration) ──
  useEffect(() => {
    const focusComposer = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => textareaRef.current?.focus())
      })
    }
    const offChunk = window.lingyue.chat.onStreamChunk(({ streamId, delta }) => {
      if (streamId === streamIdRef.current) {
        if (chatStatusRef.current !== 'streaming') setChatStatus('streaming')
        streamingTextRef.current += delta
        if (streamRenderFrameRef.current == null) {
          streamRenderFrameRef.current = requestAnimationFrame(() => {
            streamRenderFrameRef.current = null
            setStreamingText(streamingTextRef.current)
          })
        }
      }
    })
    const offEnd = window.lingyue.chat.onStreamEnd(({ streamId, full, conversationId }) => {
      if (streamId === streamIdRef.current) {
        if (streamRenderFrameRef.current != null) cancelAnimationFrame(streamRenderFrameRef.current)
        streamRenderFrameRef.current = null
        setChatStatus('idle')
        stopTimer()
        setStreamingText('')
        streamingTextRef.current = ''
        streamIdRef.current = null
        setConnected(true)
        // 读取 ref 获取 tool calls（避免嵌套 setState）
        const toolCalls = activeToolCallsRef.current
        if (!full.trim() && toolCalls.length === 0) {
          setError('模型没有返回可显示内容。请稍后重试或切换模型。')
          updateActiveToolCalls(() => [])
          focusComposer()
          return
        }
        const messageId = `a-${Date.now()}`
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            text: full,
            status: 'done',
            timestamp: Date.now(),
            toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
            processOpen: toolCalls.length > 0,
          },
        ])
        updateActiveToolCalls(() => [])
        if (!activeConvIdRef.current) {
          setActiveConvId(conversationId)
          // Auto-associate new conversation with selected project
          const projId = selectedProjectIdRef.current
          if (projId) {
            window.lingyue.chat.moveConversation(conversationId, projId)
          }
        }
        loadConversations()
        loadMemories()
        const runId = currentTaskRunIdRef.current
        window.lingyue.chat.listAgentRuns(conversationId).then((runs) => {
          setAgentRuns(runs)
          const run = runId ? runs.find((item) => item.id === runId) : undefined
          if (!run || (run.fileChanges.length === 0 && run.artifacts.length === 0)) return
          setMessages((prev) => prev.map((message) => (
            message.id === messageId
              ? { ...message, fileChanges: run.fileChanges, artifacts: run.artifacts }
              : message
          )))
        })
        focusComposer()
      }
    })
    const offError = window.lingyue.chat.onStreamError(({ streamId, error: err }) => {
      if (streamId === streamIdRef.current) {
        if (streamRenderFrameRef.current != null) cancelAnimationFrame(streamRenderFrameRef.current)
        streamRenderFrameRef.current = null
        setChatStatus('idle')
        stopTimer()
        const partial = streamingTextRef.current.trim()
        const toolCalls = activeToolCallsRef.current
        setStreamingText('')
        streamingTextRef.current = ''
        updateActiveToolCalls(() => [])
        streamIdRef.current = null
        setConnected(false)
        setError(null)
        showTransientPetState('error', 2400)
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: partial || '我这边刚刚卡住了一下，但不是你的问题。你再叫我试一次，我换个方式来。',
            status: 'done',
            timestamp: Date.now(),
            toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
          },
        ])
        console.warn('[chat] stream failed:', err)
        focusComposer()
      }
    })
    const offToolCall = window.lingyue.chat.onToolCall(({ streamId, toolCallId, toolName, input: toolInput, status: toolStatus, output, error: toolError, durationMs }) => {
      if (streamId !== streamIdRef.current) return
      if (toolStatus === 'start') {
        updateActiveToolCalls((prev) => [...prev, { toolCallId, toolName, input: toolInput, status: 'running', textOffset: streamingTextRef.current.length }])
      } else {
        updateActiveToolCalls((prev) =>
          prev.map((tc) =>
            tc.toolCallId === toolCallId
              ? { ...tc, status: toolStatus === 'error' || isFailedToolResult(output, toolError) ? 'error' : 'done', output, error: toolError, durationMs }
              : tc
          )
        )
      }
    })
    const offRunEvent = window.lingyue.chat.onAgentRunEvent(({ streamId, run }) => {
      if (streamId !== streamIdRef.current || !run) return
      setAgentRuns((prev) => {
        const next = prev.filter((item) => item.id !== run.id)
        return [run, ...next]
      })
      currentTaskRunIdRef.current = run.id
      setCurrentTaskRunId(run.id)
    })
    return () => {
      if (streamRenderFrameRef.current != null) cancelAnimationFrame(streamRenderFrameRef.current)
      offChunk(); offEnd(); offError(); offToolCall(); offRunEvent()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateActiveToolCalls])

  // ── Auto-scroll ──
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, streamingText, activeToolCalls])

  // ── Send ──
  const startChatStream = useCallback((payload: { conversationId?: string; projectId?: string | null; text: string; internal?: boolean; forceAgentRun?: boolean }, options?: { visibleUserText?: string | false }) => {
    const text = payload.text.trim()
    if (!text || chatStatusRef.current !== 'idle') return false
    setError(null)
    setCurrentTaskRunId(null)
    currentTaskRunIdRef.current = null
    updateActiveToolCalls(() => [])

    if (options?.visibleUserText !== false) {
      const visibleText = options?.visibleUserText ?? text
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', text: visibleText, status: 'sending', timestamp: Date.now() },
      ])
    }

    setChatStatus('connecting')
    startTimer()
    setStreamingText('')
    streamingTextRef.current = ''

    setTimeout(() => {
      setChatStatus((s) => s === 'connecting' ? 'thinking' : s)
    }, 500)

    const streamId = window.lingyue.chat.sendMessage({ ...payload, text })
    streamIdRef.current = streamId
    showTransientPetState(inferPetStateFromText(text), 3200)
    return true
  }, [showTransientPetState, startTimer, updateActiveToolCalls])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    const projectId = selectedProjectIdRef.current
    const pendingPermissionUpdate = projectId ? pendingPermissionUpdatesRef.current.get(projectId) : undefined
    if (pendingPermissionUpdate) {
      try {
        await pendingPermissionUpdate
      } catch (err) {
        setError((err as Error).message || '权限更新失败，请稍后重试。')
        return
      }
    }
    const started = startChatStream({
      conversationId: activeConvId ?? undefined,
      projectId,
      text,
    })
    if (started) setInput('')
  }, [input, activeConvId, startChatStream])

  const handleStop = useCallback(async () => {
    const streamId = streamIdRef.current
    if (!streamId) return
    const result = await window.lingyue.chat.stopStream(streamId)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleCreateAutomation = useCallback(async (scheduleType: 'manual' | 'interval') => {
    const prompt = input.trim()
    if (!prompt) {
      setError('先在输入框写好自动化要执行的任务。')
      return
    }
    await window.lingyue.chat.createAutomation({
      name: prompt.slice(0, 28),
      prompt,
      workspaceId: selectedProjectId,
      conversationId: activeConvId,
      scheduleType,
      intervalMinutes: scheduleType === 'interval' ? 60 : null,
    })
    setInput('')
    await loadAutomations()
  }, [activeConvId, input, loadAutomations, selectedProjectId])

  const handleRunAutomation = useCallback(async (id: string) => {
    const result = await window.lingyue.chat.runAutomationNow(id)
    if (!result.ok && result.error) setError(result.error)
    await loadAutomations()
  }, [loadAutomations])

  const handleToggleAutomation = useCallback(async (item: AgentAutomation) => {
    await window.lingyue.chat.updateAutomation(item.id, { status: item.status === 'active' ? 'paused' : 'active' })
    await loadAutomations()
  }, [loadAutomations])

  const handleDeleteAutomation = useCallback(async (id: string) => {
    await window.lingyue.chat.deleteAutomation(id)
    await loadAutomations()
  }, [loadAutomations])

  // ── New conversation ──
  const handleNewConversation = useCallback((projectId?: string | null) => {
    if (chatStatusRef.current !== 'idle') return
    if (projectId !== undefined) selectProjectId(projectId)
    setSubView('chat')
    setActiveConvId(null)
    setMessages([])
    setAgentRuns([])
    setCurrentTaskRunId(null)
    setInput('')
    setError(null)
  }, [selectProjectId])

  // ── Switch conversation ──
  const handleSelectConversation = useCallback((id: string) => {
    if (chatStatus !== 'idle') return
    setSubView('chat')
    setActiveConvId(id)
    setError(null)
    // Sync project picker with conversation's project
    const conv = conversations.find(c => c.id === id)
    selectProjectId(conv?.projectId ?? null)
  }, [chatStatus, conversations, selectProjectId])

  // ── Textarea ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter that confirms an IME composition must not send the message.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const isWelcome = messages.length === 0 && chatStatus === 'idle'
  const greeting = useMemo(() => getTimeGreeting(), [])
  const topics = useMemo(() => getRandomTopics(4), [])

  const handleTopicClick = useCallback((topic: string) => {
    setInput(topic)
    textareaRef.current?.focus()
  }, [])

  const handleAttachFiles = useCallback(() => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.onchange = () => {
      const files = Array.from(fileInput.files ?? [])
      if (files.length === 0) return
      // Electron 32+ removed File.path; resolve the local path through webUtils.
      const names = files.map((file) => window.lingyue.utils.getFilePath(file) || file.name).join(', ')
      setInput((prev) => `${prev}${prev ? ' ' : ''}[附件: ${names}]`)
    }
    fileInput.click()
  }, [])

  // ── Project / Conversation management ──
  const toggleProjectExpand = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  const handleCreateProject = useCallback(async () => {
    const folderPath = await window.lingyue.project.pickFolder()
    if (!folderPath) return
    // Use the folder's basename as the project name
    const folderName = folderPath.replace(/\\/g, '/').split('/').pop() || 'Untitled'
    await window.lingyue.project.create({ name: folderName, path: folderPath })
    loadProjects()
  }, [loadProjects])

  const handleOpenProjectFolder = useCallback(async (projectId: string) => {
    const result = await window.lingyue.project.openFolder(projectId)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleOpenFileChange = useCallback(async (id: string) => {
    const result = await window.lingyue.chat.openFileChange(id)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleShowFileChange = useCallback(async (id: string) => {
    const result = await window.lingyue.chat.showFileChangeInFolder(id)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleOpenArtifact = useCallback(async (id: string) => {
    const result = await window.lingyue.chat.openArtifact(id)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleShowArtifact = useCallback(async (id: string) => {
    const result = await window.lingyue.chat.showArtifactInFolder(id)
    if (!result.ok && result.error) setError(result.error)
  }, [])

  const handleUpdateProjectPermission = useCallback(async (projectId: string, permissionProfile: WorkspacePermissionProfile) => {
    setProjects((prev) => prev.map((project) => project.id === projectId ? { ...project, permissionProfile } : project))
    const updatePromise = (async () => {
      try {
        await window.lingyue.project.update(projectId, { permissionProfile })
        const latest = await window.lingyue.project.get(projectId)
        if (latest) {
          setProjects((prev) => prev.map((project) => project.id === projectId ? latest : project))
        } else {
          await loadProjects()
        }
      } catch (err) {
        await loadProjects()
        throw err
      } finally {
        pendingPermissionUpdatesRef.current.delete(projectId)
      }
    })()
    pendingPermissionUpdatesRef.current.set(projectId, updatePromise)
    try {
      await updatePromise
    } catch (err) {
      setError((err as Error).message || '权限更新失败。')
    }
  }, [loadProjects])

  const handleResolveApproval = useCallback(async (approval: AgentApproval, decision: AgentApprovalDecision) => {
    const result = await window.lingyue.chat.resolveApproval(approval.id, decision)
    if (!result) {
      setError('授权记录不存在，无法继续任务。')
      return
    }
    if (activeConvIdRef.current) {
      window.lingyue.chat.listAgentRuns(activeConvIdRef.current).then(setAgentRuns)
    }
    if (decision === 'deny') return

    const started = startChatStream({
      conversationId: approval.threadId,
      projectId: approval.workspaceId,
      text: approvalResumePrompt(approval),
      internal: true,
      forceAgentRun: true,
    }, { visibleUserText: false })
    if (!started) setError('授权已记录。当前对话还在运行，结束后会保留授权状态。')
  }, [startChatStream])

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (!window.confirm('删除这段对话？删除后无法恢复。')) return
    await window.lingyue.chat.deleteConversation(id)
    if (activeConvId === id) {
      setActiveConvId(null)
      setMessages([])
    }
    loadConversations()
  }, [activeConvId, loadConversations])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setEditingConvId(id)
    setEditingTitle(currentTitle || '')
  }, [])

  const handleCancelRename = useCallback(() => {
    setEditingConvId(null)
    setEditingTitle('')
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (editingConvId && editingTitle.trim()) {
      await window.lingyue.chat.renameConversation(editingConvId, editingTitle.trim())
      loadConversations()
    }
    setEditingConvId(null)
    setEditingTitle('')
  }, [editingConvId, editingTitle, loadConversations])

  const handleArchiveConversation = useCallback(async (id: string) => {
    await window.lingyue.chat.archiveConversation(id)
    if (activeConvId === id) {
      setActiveConvId(null)
      setMessages([])
    }
    loadConversations()
  }, [activeConvId, loadConversations])

  const handleMoveConversation = useCallback(async (convId: string, projectId: string | null) => {
    await window.lingyue.chat.moveConversation(convId, projectId)
    loadConversations()
  }, [loadConversations])

  const handleContextMenu = useCallback((e: React.MouseEvent, convId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, convId })
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  // Derived data: conversations grouped by project
  const projectConversations = useMemo(() => {
    const map = new Map<string, ChatConversation[]>()
    const orphans: ChatConversation[] = []
    for (const c of conversations) {
      if (c.status === 'archived') continue
      if (c.projectId) {
        const list = map.get(c.projectId) ?? []
        list.push(c)
        map.set(c.projectId, list)
      } else {
        orphans.push(c)
      }
    }
    return { map, orphans }
  }, [conversations])

  // Sort orphan conversations
  const sortedOrphans = useMemo(() => {
    const list = [...projectConversations.orphans]
    if (sortOrder === 'created') {
      list.sort((a, b) => b.createdAt - a.createdAt)
    } else {
      list.sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return list
  }, [projectConversations.orphans, sortOrder])

  // Close sort menu on outside click
  useEffect(() => {
    if (!sortMenuPos) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.chat-sort-menu, .chat-sidebar__section-filter')) {
        setSortMenuPos(null)
      }
    }
    setTimeout(() => window.addEventListener('click', close), 0)
    return () => window.removeEventListener('click', close)
  }, [sortMenuPos])

  const handleToggleSortMenu = useCallback((e: React.MouseEvent) => {
    if (sortMenuPos) {
      setSortMenuPos(null)
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setSortMenuPos({ x: rect.left, y: rect.bottom + 4 })
    }
  }, [sortMenuPos])

  const visibleAgentRuns = useMemo(() => agentRuns.filter(shouldShowAgentRun), [agentRuns])
  const selectedProject = projects.find((project) => project.id === selectedProjectId && project.status === 'active')
  const hasAutomationInbox = automations.length > 0 || automationResults.length > 0
  const latestRun = currentTaskRunId ? visibleAgentRuns.find((run) => run.id === currentTaskRunId) : undefined
  const latestRunProject = latestRun ? projects.find(p => p.id === latestRun.workspaceId) : undefined
  const pendingApproval = useMemo(() => {
    for (const run of visibleAgentRuns) {
      const approval = run.approvals.find((item) => item.status === 'pending')
      if (approval) return { approval, run }
    }
    return null
  }, [visibleAgentRuns])
  const currentRoundRun = useMemo(() => {
    if (!currentTaskRunId) return undefined
    return visibleAgentRuns.find((run) => run.id === currentTaskRunId && run.workspaceId === selectedProjectId)
  }, [currentTaskRunId, selectedProjectId, visibleAgentRuns])
  const selectedProjectFileChanges = useMemo(() => (
    currentRoundRun?.fileChanges.slice(0, 8) ?? []
  ), [currentRoundRun])
  const selectedProjectArtifacts = useMemo(() => (
    currentRoundRun?.artifacts.slice(0, 6) ?? []
  ), [currentRoundRun])
  const chatPet = petSnapshot.activePet
  const chatPetSettings = petSnapshot.settings
  const toolDrivenPetState = getToolDrivenPetState(activeToolCalls)
  const displayPetState: PixelPetStateKey = chatStatus === 'error'
    ? 'error'
    : chatStatus === 'streaming'
      ? toolDrivenPetState ?? 'speaking'
      : chatStatus === 'connecting' || chatStatus === 'thinking'
        ? transientPetState ?? 'thinking'
        : transientPetState ?? sustainedPetState
  const petStateMeta = PIXEL_PET_STATES[displayPetState]
  const petStatusLine = petStatusText(chatPet.name, chatStatus, displayPetState, activeToolCalls, elapsedTime)
  const petStats = useMemo(() => {
    const busy = chatStatus !== 'idle' && chatStatus !== 'error'
    const focused = displayPetState === 'thinking' || displayPetState === 'coding' || displayPetState === 'searching'
    return {
      mood: displayPetState === 'sorrow' ? 58 : displayPetState === 'error' ? 44 : displayPetState === 'joy' || displayPetState === 'delight' ? 94 : 82,
      focus: focused ? 92 : busy ? 78 : 64,
      vitality: displayPetState === 'sleepy' ? 46 : displayPetState === 'charging' ? 70 : busy ? 74 : 86,
      bond: Math.min(1000, 680 + chatMemories.length * 18 + messages.length * 3),
    }
  }, [chatMemories.length, chatStatus, displayPetState, messages.length])
  const memoryTypeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const memory of chatMemories) {
      const label = memoryTypeLabel(memory.memoryType)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return counts
  }, [chatMemories])

  return (
    <div className="chat-layout">
      {/* ── Sidebar ── */}
      <aside className="chat-sidebar">
        {/* Top action buttons */}
        <div className="chat-sidebar__actions">
          <button
            className={`chat-sidebar__action-btn ${subView === 'chat' && activeConvId === null ? 'active' : ''}`}
            onClick={() => { setSubView('chat'); handleNewConversation() }}
            title="新对话"
          >
            <PenLine size={16} />
            <span>新对话</span>
          </button>
          <button
            className={`chat-sidebar__action-btn ${subView === 'persona' ? 'active' : ''}`}
            onClick={() => setSubView('persona')}
            title="人设"
          >
            <Sparkles size={16} />
            <span>人设</span>
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="chat-sidebar__content">
          {/* ── Projects Section ── */}
          {(sortMode === 'by-project' || sortMode === 'recent-project') && (
            <div className="chat-sidebar__section-group">
              <div className="chat-sidebar__section-header">
                <span className="chat-sidebar__section-title">项目</span>
                <button className="chat-sidebar__section-add" onClick={handleCreateProject} title="新建项目">
                  <FolderPlus size={14} />
                </button>
              </div>

              {projects.filter(p => p.status === 'active').length === 0 && (
                <button className="chat-sidebar__create-project-hint" onClick={handleCreateProject}>
                  <FolderPlus size={14} />
                  <span>创建第一个项目</span>
                </button>
              )}

              {projects.filter(p => p.status === 'active').map((project) => {
                const isExpanded = expandedProjects.has(project.id)
                const projConvs = projectConversations.map.get(project.id) ?? []
                return (
                  <div key={project.id} className="chat-sidebar__project">
                    <div
                      className="chat-sidebar__project-header"
                      onClick={() => toggleProjectExpand(project.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleProjectExpand(project.id)
                        }
                      }}
                    >
                      <span className="chat-sidebar__project-label">
                        <FolderOpen size={14} className="chat-sidebar__project-icon" />
                        <span className="chat-sidebar__project-name">{project.name}</span>
                        <span className="chat-sidebar__project-chevron">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                      </span>
                      <div className="chat-sidebar__project-actions">
                        <button
                          className="chat-sidebar__project-action"
                          onClick={(e) => { e.stopPropagation(); handleNewConversation(project.id) }}
                          title="在此项目新建对话"
                        >
                          <MessageSquarePlus size={12} />
                        </button>
                        <button
                          className="chat-sidebar__project-action"
                          onClick={(e) => { e.stopPropagation(); void handleOpenProjectFolder(project.id) }}
                          title="在资源管理器中打开"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="chat-sidebar__project-children">
                        {projConvs.map((c) => (
                          <ConversationItem
                            key={c.id}
                            conv={c}
                            isActive={c.id === activeConvId}
                            isEditing={editingConvId === c.id}
                            editingTitle={editingTitle}
                            onSelect={handleSelectConversation}
                            onContextMenu={handleContextMenu}
                            onStartRename={handleStartRename}
                            onEditTitleChange={setEditingTitle}
                            onFinishRename={handleFinishRename}
                            onCancelRename={handleCancelRename}
                            onDelete={handleDeleteConversation}
                            indent
                          />
                        ))}
                        {projConvs.length === 0 && (
                          <div className="chat-sidebar__empty-hint">暂无对话</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Conversations Section ── */}
          <div className="chat-sidebar__section-group">
            <div className="chat-sidebar__section-header">
              <span className="chat-sidebar__section-title">对话</span>
              <div className="chat-sidebar__section-tools">
                <button
                  className={`chat-sidebar__section-filter ${sortMenuPos ? 'active' : ''}`}
                  onClick={handleToggleSortMenu}
                  title="筛选、排序和整理对话"
                >
                  <SlidersHorizontal size={14} />
                </button>
                <button
                  className="chat-sidebar__section-add"
                  onClick={() => handleNewConversation()}
                  title="新建对话"
                >
                  <MessageSquarePlus size={14} />
                </button>
              </div>
            </div>

            {/* Sort/Filter Dropdown rendered outside sidebar below */}

            {sortedOrphans.map((c) => (
              <ConversationItem
                key={c.id}
                conv={c}
                isActive={c.id === activeConvId}
                isEditing={editingConvId === c.id}
                editingTitle={editingTitle}
                onSelect={handleSelectConversation}
                onContextMenu={handleContextMenu}
                onStartRename={handleStartRename}
                onEditTitleChange={setEditingTitle}
                onFinishRename={handleFinishRename}
                onCancelRename={handleCancelRename}
                onDelete={handleDeleteConversation}
              />
            ))}
          </div>
        </div>

        <section className="chat-memory-entry">
          <button
            type="button"
            className={`chat-memory-entry__trigger ${memoryPanelOpen ? 'active' : ''}`}
            onClick={() => setMemoryPanelOpen((open) => !open)}
          >
            <span className="chat-memory-entry__icon"><Brain size={16} /></span>
            <span className="chat-memory-entry__main">
              <span className="chat-memory-entry__title">记忆碎片</span>
              <span className="chat-memory-entry__subtitle">{chatMemories.length > 0 ? `${chatMemories.length} 条可回忆内容` : '等待沉淀新的线索'}</span>
            </span>
            <span className="chat-memory-entry__count">{chatMemories.length || MEMORY_PLACEHOLDER_TYPES.length}</span>
          </button>
          {memoryPanelOpen && (
            <div className="chat-memory-entry__panel">
              {chatMemories.length > 0 ? (
                chatMemories.slice(0, 4).map((memory) => (
                  <div key={memory.id} className="chat-memory-entry__item">
                    <span className="chat-memory-entry__type">{memoryTypeLabel(memory.memoryType)}</span>
                    <span className="chat-memory-entry__text">{memory.content}</span>
                    <span className="chat-memory-entry__meta">{importanceLabel(memory.importance)} · {relativeTime(memory.updatedAt)}</span>
                  </div>
                ))
              ) : (
                MEMORY_PLACEHOLDER_TYPES.map((item) => {
                  const count = memoryTypeCounts.get(item.label) ?? 0
                  return (
                    <div key={item.type} className="chat-memory-entry__item chat-memory-entry__item--placeholder">
                      <span className="chat-memory-entry__type">{item.label}</span>
                      <span className="chat-memory-entry__text">{item.line}</span>
                      <span className="chat-memory-entry__meta">{count > 0 ? `${count} 条` : '暂无内容'}</span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </section>

        {/* Connection status at bottom */}
        <div className="chat-sidebar__footer">
          <ConnectionDot connected={connected} />
          <span className="chat-sidebar__footer-text">{modelName}</span>
        </div>
      </aside>

      {/* Context Menu — rendered outside sidebar to avoid backdrop-filter breaking fixed positioning */}
      {contextMenu && (
        <div
          className="chat-ctx-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="chat-ctx-menu__item" onClick={() => {
            const c = conversations.find(x => x.id === contextMenu.convId)
            if (c) handleStartRename(c.id, c.title || '')
            setContextMenu(null)
          }}>
            <Pencil size={13} /> 重命名
          </button>
          <button className="chat-ctx-menu__item" onClick={() => {
            handleArchiveConversation(contextMenu.convId)
            setContextMenu(null)
          }}>
            <Archive size={13} /> 归档
          </button>
          <button className="chat-ctx-menu__item" onClick={() => {
            window.lingyue.chat.exportConversation(contextMenu.convId)
            setContextMenu(null)
          }}>
            <Download size={13} /> 导出
          </button>
          {projects.length > 0 && (
            <>
              <div className="chat-ctx-menu__divider" />
              {projects.filter(p => p.status === 'active').map(p => (
                <button
                  key={p.id}
                  className="chat-ctx-menu__item"
                  onClick={() => {
                    handleMoveConversation(contextMenu.convId, p.id)
                    setContextMenu(null)
                  }}
                >
                  <FolderInput size={13} /> 移动到 {p.name}
                </button>
              ))}
              <button className="chat-ctx-menu__item" onClick={() => {
                handleMoveConversation(contextMenu.convId, null)
                setContextMenu(null)
              }}>
                <FolderInput size={13} /> 移出项目
              </button>
            </>
          )}
          <div className="chat-ctx-menu__divider" />
          <button className="chat-ctx-menu__item chat-ctx-menu__item--danger" onClick={() => {
            handleDeleteConversation(contextMenu.convId)
            setContextMenu(null)
          }}>
            <Trash2 size={13} /> 删除
          </button>
        </div>
      )}

      {/* Sort/Filter Menu — rendered outside sidebar to avoid backdrop-filter breaking fixed positioning */}
      {sortMenuPos && (
        <div className="chat-sort-menu" style={{ top: sortMenuPos.y, left: sortMenuPos.x }}>
          <div className="chat-sort-menu__group">
            <span className="chat-sort-menu__label">整理</span>
            <button className={`chat-sort-menu__item ${sortMode === 'by-project' ? 'active' : ''}`} onClick={() => setSortMode('by-project')}>
              <FolderOpen size={14} /> 按项目 {sortMode === 'by-project' && <span className="chat-sort-menu__check">✓</span>}
            </button>
            <button className={`chat-sort-menu__item ${sortMode === 'recent-project' ? 'active' : ''}`} onClick={() => setSortMode('recent-project')}>
              <FolderOpen size={14} /> 近期项目 {sortMode === 'recent-project' && <span className="chat-sort-menu__check">✓</span>}
            </button>
            <button className={`chat-sort-menu__item ${sortMode === 'by-time' ? 'active' : ''}`} onClick={() => setSortMode('by-time')}>
              <Clock size={14} /> 按时间顺序 {sortMode === 'by-time' && <span className="chat-sort-menu__check">✓</span>}
            </button>
            <button className={`chat-sort-menu__item ${sortMode === 'pinned-first' ? 'active' : ''}`} onClick={() => setSortMode('pinned-first')}>
              <ArrowUpDown size={14} /> 上移 {sortMode === 'pinned-first' && <span className="chat-sort-menu__check">✓</span>}
            </button>
          </div>
          <div className="chat-sort-menu__group">
            <span className="chat-sort-menu__label">排序条件</span>
            <button className={`chat-sort-menu__item ${sortOrder === 'created' ? 'active' : ''}`} onClick={() => setSortOrder('created')}>
              <CalendarDays size={14} /> 创建时间 {sortOrder === 'created' && <span className="chat-sort-menu__check">✓</span>}
            </button>
            <button className={`chat-sort-menu__item ${sortOrder === 'updated' ? 'active' : ''}`} onClick={() => setSortOrder('updated')}>
              <PenLine size={14} /> 最近更新 {sortOrder === 'updated' && <span className="chat-sort-menu__check">✓</span>}
            </button>
          </div>
          <div className="chat-sort-menu__group">
            <span className="chat-sort-menu__label">显示</span>
            <button className={`chat-sort-menu__item ${displayFilter === 'all' ? 'active' : ''}`} onClick={() => setDisplayFilter('all')}>
              <MessageSquarePlus size={14} /> 所有对话 {displayFilter === 'all' && <span className="chat-sort-menu__check">✓</span>}
            </button>
            <button className={`chat-sort-menu__item ${displayFilter === 'relevant' ? 'active' : ''}`} onClick={() => setDisplayFilter('relevant')}>
              <Sparkles size={14} /> 相关 {displayFilter === 'relevant' && <span className="chat-sort-menu__check">✓</span>}
            </button>
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      {subView === 'persona' ? (
        <PersonaPage />
      ) : (
        <main className="chat-main">
          <header className="chat-pet-statusbar">
            <div className="chat-pet-statusbar__left">
              <span className="chat-pet-statusbar__signal"><Sparkles size={14} /></span>
              <span className="chat-pet-statusbar__text">{petStatusLine}</span>
            </div>
            <button type="button" className="chat-focus-mode-btn" title="专注模式入口" onClick={() => showTransientPetState('inspiration', 2200)}>
              <Maximize2 size={14} />
              <span>开启专注模式</span>
            </button>
          </header>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          {isWelcome ? (
            <div className="chat-welcome">
              {/* Avatar & Greeting */}
              <div className="chat-welcome__avatar">
                <div className="chat-welcome__avatar-ring">
                  <Sparkles size={28} />
                </div>
                <div className="chat-welcome__mood-icon">{greeting.icon}</div>
              </div>
              <div className="chat-welcome__greeting">{greeting.text}</div>
              <div className="chat-welcome__title">灵月在这里~</div>
              <div className="chat-welcome__subtitle">{greeting.mood}</div>

              {/* Topic suggestions */}
              <div className="chat-topics">
                {topics.map((topic, i) => (
                  <button
                    key={i}
                    className="chat-topics__chip"
                    onClick={() => handleTopicClick(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>

              <div className="chat-input-area">
                <InputBox
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onSend={handleSend}
                  onStop={handleStop}
                  disabled={chatStatus !== 'idle'}
                  isRunning={chatStatus !== 'idle' && chatStatus !== 'error'}
                  modelName={modelName}
                  connected={connected}
                  project={selectedProject}
                  onPermissionChange={handleUpdateProjectPermission}
                  onAttachFiles={handleAttachFiles}
                  canCreateAutomation={Boolean(input.trim())}
                  onCreateAutomation={handleCreateAutomation}
                  ref={textareaRef}
                />
                <div className="chat-input-context">
                  <ProjectPicker
                    projects={projects}
                    selectedId={selectedProjectId}
                    onSelect={selectProjectId}
                    onCreateProject={handleCreateProject}
                    fileChanges={selectedProjectFileChanges}
                    artifacts={selectedProjectArtifacts}
                    onError={setError}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-messages">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onOpenFileChange={handleOpenFileChange}
                    onShowFileChange={handleShowFileChange}
                    onOpenArtifact={handleOpenArtifact}
                    onShowArtifact={handleShowArtifact}
                  />
                ))}
                {chatStatus !== 'idle' && chatStatus !== 'error' && (
                  <div className="chat-msg chat-msg--assistant">
                    <div className="chat-msg__avatar chat-msg__avatar--ai">
                      <Bot size={16} />
                    </div>
                    <div className="chat-msg__content">
                      {(() => {
                        const items = buildAssistantContentTimeline({
                          text: streamingText,
                          toolCalls: activeToolCalls,
                          live: true,
                          status: chatStatus,
                          elapsedSeconds: elapsedTime,
                        })
                        return <AssistantContentTimeline items={items} live />
                      })()}
                      {/* Elapsed time inside the streaming bubble */}
                      {elapsedTime > 0 && (
                        <span className="chat-msg__elapsed">{elapsedTime}s</span>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-input-area">
                {latestRun && (
                  <AgentRunPanel
                    run={latestRun}
                    project={latestRunProject}
                    onRunUpdate={(updatedRun) => {
                      setAgentRuns((prev) => [updatedRun, ...prev.filter((item) => item.id !== updatedRun.id)])
                    }}
                  />
                )}
                {pendingApproval && (
                  <ApprovalDialog
                    approval={pendingApproval.approval}
                    project={projects.find((project) => project.id === pendingApproval.approval.workspaceId)}
                    onResolve={handleResolveApproval}
                  />
                )}
                {hasAutomationInbox && (
                  <AutomationInbox
                    automations={automations}
                    results={automationResults}
                    canCreate={Boolean(input.trim())}
                    onCreateManual={() => handleCreateAutomation('manual')}
                    onCreateHourly={() => handleCreateAutomation('interval')}
                    onRunNow={handleRunAutomation}
                    onToggle={handleToggleAutomation}
                    onDelete={handleDeleteAutomation}
                  />
                )}
                <InputBox
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onSend={handleSend}
                  onStop={handleStop}
                  disabled={chatStatus !== 'idle'}
                  isRunning={chatStatus !== 'idle' && chatStatus !== 'error'}
                  modelName={modelName}
                  connected={connected}
                  project={selectedProject}
                  onPermissionChange={handleUpdateProjectPermission}
                  onAttachFiles={handleAttachFiles}
                  canCreateAutomation={Boolean(input.trim())}
                  onCreateAutomation={handleCreateAutomation}
                  ref={textareaRef}
                />
                <div className="chat-input-context">
                  <ProjectPicker
                    projects={projects}
                    selectedId={selectedProjectId}
                    onSelect={selectProjectId}
                    onCreateProject={handleCreateProject}
                    fileChanges={selectedProjectFileChanges}
                    artifacts={selectedProjectArtifacts}
                    onError={setError}
                  />
                </div>
              </div>
            </>
          )}

          <aside className="chat-pet-dock" aria-label="当前宠物">
            {petPanelOpen && (
              <div className="chat-pet-popover">
                <div className="chat-pet-popover__header">
                  <div>
                    <div className="chat-pet-popover__name">{chatPet.name}</div>
                    <div className="chat-pet-popover__state">{petStateMeta.line}</div>
                  </div>
                  <button type="button" className="chat-pet-popover__close" onClick={() => setPetPanelOpen(false)} title="关闭">
                    <X size={14} />
                  </button>
                </div>
                <div className="chat-pet-stats">
                  <PetStatRow icon={<Heart size={14} />} label="心情" value={petStats.mood} tone="mood" />
                  <PetStatRow icon={<Target size={14} />} label="专注" value={petStats.focus} tone="focus" />
                  <PetStatRow icon={<Zap size={14} />} label="活力" value={petStats.vitality} tone="energy" />
                  <PetStatRow icon={<Sparkles size={14} />} label="陪伴值" value={petStats.bond} max={1000} tone="bond" suffix={`/ 1000`} />
                </div>
                <div className="chat-pet-popover__ghost">属性同步中</div>
              </div>
            )}
            <button type="button" className="chat-pet-stage" onClick={() => setPetPanelOpen((open) => !open)} title={chatPet.name}>
              <PixelPetCanvas
                pet={chatPet}
                settings={chatPetSettings}
                stateKey={displayPetState}
                className="chat-pet-stage__canvas"
                width={190}
                height="auto"
              />
              <span className="chat-pet-stage__shadow" />
            </button>
          </aside>
        </main>
      )}
    </div>
  )
}

function PetStatRow({
  icon,
  label,
  value,
  max = 100,
  tone,
  suffix = '',
}: {
  icon: ReactNode
  label: string
  value: number
  max?: number
  tone: 'mood' | 'focus' | 'energy' | 'bond'
  suffix?: string
}) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={`chat-pet-stat chat-pet-stat--${tone}`}>
      <div className="chat-pet-stat__top">
        <span className="chat-pet-stat__label">{icon}{label}</span>
        <span className="chat-pet-stat__value">{Math.round(value)}{suffix}</span>
      </div>
      <div className="chat-pet-stat__track">
        <span className="chat-pet-stat__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

// ─── Tool Call Display ─────────────────────────────────────
const TOOL_NAME_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_MANIFEST.map((entry) => [entry.name, entry.label]),
)

type ProcessFeedItem =
  | { type: 'text'; id: string; text: string }
  | { type: 'status'; id: string; text: string }
  | { type: 'tool'; id: string; call: ToolCallDisplay; count: number }

function mergeToolStatus(left: ToolCallDisplay['status'], right: ToolCallDisplay['status']): ToolCallDisplay['status'] {
  if (left === 'running' || right === 'running') return 'running'
  if (left === 'error' || right === 'error') return 'error'
  return 'done'
}

function groupToolCalls(calls: ToolCallDisplay[]): { call: ToolCallDisplay; count: number }[] {
  const groups = new Map<string, { call: ToolCallDisplay; count: number; order: number; durationMs: number | null }>()
  calls.forEach((call, index) => {
    const key = call.toolName
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        call: { ...call },
        count: 1,
        order: typeof call.textOffset === 'number' ? call.textOffset : Number.MAX_SAFE_INTEGER - index,
        durationMs: typeof call.durationMs === 'number' ? call.durationMs : null,
      })
      return
    }

    existing.count += 1
    existing.durationMs = typeof call.durationMs === 'number'
      ? (existing.durationMs ?? 0) + call.durationMs
      : existing.durationMs
    existing.call = {
      ...existing.call,
      status: mergeToolStatus(existing.call.status, call.status),
      output: call.output ?? existing.call.output,
      error: call.error ?? existing.call.error,
      durationMs: existing.durationMs ?? existing.call.durationMs,
    }
  })
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ call, count }) => ({ call, count }))
}

function buildProcessTimeline(narrative: string, calls: ToolCallDisplay[], live: boolean, status: ChatStatus, statusText = '', elapsedSeconds = 0): ProcessFeedItem[] {
  const items: ProcessFeedItem[] = []
  const text = narrative.trimEnd()
  const sortedCalls = groupToolCalls(calls)

  const appendText = (value: string) => {
    for (const paragraph of splitParagraphs(value)) {
      items.push({ type: 'text', id: `text-${items.length}`, text: paragraph })
    }
  }

  let cursor = 0
  for (const { call, count } of sortedCalls) {
    const offset = typeof call.textOffset === 'number'
      ? Math.max(0, Math.min(call.textOffset, text.length))
      : cursor
    if (offset > cursor) appendText(text.slice(cursor, offset))
    items.push({ type: 'tool', id: call.toolCallId, call, count })
    cursor = offset
  }
  if (cursor < text.length) appendText(text.slice(cursor))
  if (statusText.trim()) {
    items.push({ type: 'status', id: `status-${items.length}`, text: statusText.trim() })
  }
  if (items.length === 0 && live) {
    items.push({ type: 'status', id: 'fallback-thinking', text: toolProgressSentence(calls, status, elapsedSeconds) })
  }
  return items
}

function ToolActivityPanel({
  toolCalls,
  live = false,
  narrative = '',
  statusText = '',
  status = 'idle',
  elapsedSeconds = 0,
}: {
  toolCalls?: ToolCallDisplay[]
  live?: boolean
  narrative?: string
  statusText?: string
  defaultOpen?: boolean
  status?: ChatStatus
  elapsedSeconds?: number
}) {
  const calls = toolCalls ?? []
  const timeline = buildProcessTimeline(narrative, calls, live, status, statusText, elapsedSeconds)

  if (timeline.length === 0) return null
  return (
    <div className={`process-feed ${live ? 'process-feed--live' : ''}`}>
      <div className="process-feed__body">
        {timeline.map((item) => {
          if (item.type === 'text') return <div key={item.id} className="process-feed__text chat-msg__bubble">{item.text}</div>
          if (item.type === 'status') return <ProcessStatusItem key={item.id} text={item.text} live={live} />
          return <ToolProcessItem key={item.id} tc={item.call} count={item.count} />
        })}
      </div>
    </div>
  )
}

function ProcessStatusItem({ text, live }: { text: string; live?: boolean }) {
  const failed = text.startsWith('工具执行未完成') || text.includes('请调整权限')
  const approval = text.includes('授权') || text.includes('确认')
  const done = text.startsWith('已完成本轮任务')
  return (
    <div className={`process-status ${live ? 'process-status--live' : ''} ${failed ? 'process-status--error' : ''} ${approval ? 'process-status--approval' : ''} ${done ? 'process-status--done' : ''}`}>
      <span className="process-status__icon">{failed ? '!' : approval ? '?' : done ? '✓' : '•'}</span>
      <span className="process-status__text">{text}</span>
      {live && !failed && !approval && !done && <ThinkingDots />}
    </div>
  )
}

function compactToolTitle(toolName: string): string {
  if (toolName === 'memory_update' || toolName === 'memory_delete') return '记忆'
  return getToolManifest(toolName)?.compactLabel || '步骤'
}

function recordArrayValue(record: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
}

function desktopSceneSourceLabel(source: string | null): string {
  if (source === 'new') return '新增'
  if (source === 'existing') return '调整'
  if (source === 'persistent') return '保留'
  return '规划'
}

function desktopSceneLayerLabel(layer: string | null): string {
  if (layer === 'ambient') return '氛围'
  if (layer === 'information') return '信息'
  if (layer === 'persistent') return '常驻'
  if (layer === 'companion') return '陪伴'
  return '组件'
}

function DesktopSceneDraftCard({ output }: { output: unknown }) {
  const root = asRecord(output)
  const plan = asRecord(root?.plan)
  if (!plan) return null

  const widgets = recordArrayValue(plan, 'widgets')
  const patches = recordArrayValue(plan, 'widgetPatches')
  const hiddenWidgetIds = stringArrayValue(plan, 'hiddenWidgetIds')
  const check = asRecord(plan.aestheticCheck)
  const issues = recordArrayValue(check, 'issues')
  const score = numberValue(check, 'score')
  const ok = booleanValue(check, 'ok') !== false
  const sceneName = stringValue(plan, 'sceneName') ?? stringValue(plan, 'sceneId') ?? '桌面草案'
  const summary = stringValue(check, 'summary') ?? (ok ? '布局克制，主视觉清晰。' : '草案还需要微调。')
  const guidance = stringValue(root, 'guidance')
  const creates = patches.filter((item) => stringValue(item, 'op') === 'create').length
  const updates = patches.filter((item) => String(stringValue(item, 'op') ?? '').startsWith('update')).length
  const visibleWidgets = widgets.filter((item) => stringValue(item, 'source') !== 'persistent')
  const stats = [
    creates > 0 ? `新增 ${creates}` : null,
    updates > 0 ? `调整 ${updates}` : null,
    hiddenWidgetIds.length > 0 ? `弱化 ${hiddenWidgetIds.length}` : null,
  ].filter(Boolean).join(' · ') || '只读预览'

  return (
    <div className={`desktop-scene-card ${ok ? 'desktop-scene-card--ok' : 'desktop-scene-card--warn'}`}>
      <div className="desktop-scene-card__header">
        <div>
          <div className="desktop-scene-card__eyebrow">桌面编排草案</div>
          <div className="desktop-scene-card__title">{sceneName}</div>
        </div>
        <div className="desktop-scene-card__score">
          <span>{typeof score === 'number' ? score : '--'}</span>
          <small>美学分</small>
        </div>
      </div>
      <div className="desktop-scene-card__summary">{summary}</div>
      <div className="desktop-scene-card__stats">{stats}</div>
      {visibleWidgets.length > 0 && (
        <div className="desktop-scene-card__widgets">
          {visibleWidgets.slice(0, 5).map((widget, index) => {
            const type = stringValue(widget, 'type') ?? 'widget'
            const source = stringValue(widget, 'source')
            const layer = stringValue(widget, 'layer')
            const visualWeight = stringValue(widget, 'visualWeight')
            return (
              <div key={`${type}-${source}-${index}`} className="desktop-scene-card__widget">
                <span>{desktopSceneSourceLabel(source)}</span>
                <strong>{type}</strong>
                <small>{desktopSceneLayerLabel(layer)}{visualWeight === 'hero' ? ' · 主视觉' : ''}</small>
              </div>
            )
          })}
        </div>
      )}
      {issues.length > 0 && (
        <div className="desktop-scene-card__issues">
          {issues.slice(0, 2).map((issue, index) => (
            <span key={`${stringValue(issue, 'id') ?? index}`}>
              {stringValue(issue, 'label') ?? '需要微调'}
            </span>
          ))}
        </div>
      )}
      {guidance && <div className="desktop-scene-card__guidance">{guidance}</div>}
      <div className="desktop-scene-card__actions" aria-label="桌面草案操作">
        <button type="button" disabled>应用草案</button>
        <button type="button" disabled>再改一版</button>
        <button type="button" disabled>取消预览</button>
        <span>对我说“应用这个草案”即可写入</span>
      </div>
    </div>
  )
}

function DesktopSceneResultCard({ toolName, output }: { toolName: string; output: unknown }) {
  const root = asRecord(output)
  if (!root) return null

  const snapshot = asRecord(root.snapshot)
  const snapshotId = stringValue(snapshot, 'id')
  const reason = stringValue(snapshot, 'reason')
  const sceneName = stringValue(root, 'sceneName') ?? stringValue(root, 'sceneId') ?? '桌面编排'
  const count = numberValue(root, 'count')
  const applied = Array.isArray(root.appliedPatches) ? root.appliedPatches.length : 0
  const skipped = Array.isArray(root.skippedPatches) ? root.skippedPatches.length : 0
  const guidance = stringValue(root, 'guidance')
  const isRollback = toolName === 'desktop_scene_rollback'

  return (
    <div className={`desktop-scene-card desktop-scene-card--result ${isRollback ? 'desktop-scene-card--rollback' : ''}`}>
      <div className="desktop-scene-card__header">
        <div>
          <div className="desktop-scene-card__eyebrow">{isRollback ? '桌面布局回滚' : '桌面草案应用'}</div>
          <div className="desktop-scene-card__title">{isRollback ? '已恢复之前布局' : sceneName}</div>
        </div>
        {typeof count === 'number' && (
          <div className="desktop-scene-card__score">
            <span>{count}</span>
            <small>组件</small>
          </div>
        )}
      </div>
      <div className="desktop-scene-card__summary">
        {isRollback
          ? (reason ? `已恢复到“${reason}”应用前。` : '已恢复到上一次桌面编排应用前。')
          : `已写入 ${applied} 个布局操作${skipped > 0 ? `，跳过 ${skipped} 个受保护操作` : ''}。`}
      </div>
      {snapshotId && <div className="desktop-scene-card__stats">快照：{snapshotId}</div>}
      {guidance && <div className="desktop-scene-card__guidance">{guidance}</div>}
    </div>
  )
}

function ToolProcessItem({ tc, count = 1 }: { tc: ToolCallDisplay; count?: number }) {
  const info = toolActivityInfo(tc)
  const needsApproval = toolOutputNeedsApproval(tc.output)
  const failed = tc.status === 'error' || (info.ok === false && !needsApproval)
  let stateText = tc.status === 'running' ? '处理中' : needsApproval ? '需要确认' : failed ? '没成功' : count > 1 ? `已处理 ${count} 次` : '已处理'
  if (tc.toolName === 'web_search') {
    stateText = tc.status === 'running' ? '搜索中' : needsApproval ? '需要确认' : failed ? '没成功' : count > 1 ? `已搜索 ${count} 次` : '已搜索'
  }
  if (tc.toolName === 'get_user_location') {
    stateText = tc.status === 'running' ? '定位中' : failed ? '没成功' : count > 1 ? `已定位 ${count} 次` : '已定位'
  }
  const inputText = formatToolPayload(tc.input)
  const outputText = tc.error ? tc.error : formatToolPayload(tc.output)
  const sceneDraftCard = tc.toolName === 'desktop_scene_preview' && tc.status !== 'running'
    ? <DesktopSceneDraftCard output={tc.output} />
    : null
  const sceneResultCard = (tc.toolName === 'desktop_scene_apply' || tc.toolName === 'desktop_scene_rollback') && tc.status !== 'running'
    ? <DesktopSceneResultCard toolName={tc.toolName} output={tc.output} />
    : null
  const title = compactToolTitle(tc.toolName)
  return (
    <details className={`process-tool process-tool--${tc.status} ${failed ? 'process-tool--error' : ''} ${needsApproval ? 'process-tool--approval' : ''}`}>
      <summary className="process-tool__summary">
        <span className="process-tool__status">
          {tc.status === 'running' ? <Loader2 size={12} className="spin" /> : failed ? '!' : needsApproval ? '?' : '✓'}
        </span>
        <span className="process-tool__state">{stateText}</span>
        <span className="process-tool__title">{title}</span>
        <span className="process-tool__detail" title={info.detail}>{info.detail}</span>
        {tc.durationMs != null && <span className="process-tool__time">{formatDuration(tc.durationMs)}</span>}
        <ChevronDown size={12} className="process-tool__chevron" />
      </summary>
      <div className="process-tool__details">
        {info.meta && <div className="process-tool__meta">{info.meta}</div>}
        {sceneDraftCard}
        {sceneResultCard}
        {inputText && (
          <div className="process-tool__block">
            <span>输入</span>
            <pre>{inputText}</pre>
          </div>
        )}
        {outputText && !sceneDraftCard && !sceneResultCard && (
          <div className="process-tool__block">
            <span>{tc.status === 'error' ? '错误' : '输出'}</span>
            <pre>{outputText}</pre>
          </div>
        )}
      </div>
    </details>
  )
}

function AssistantContentTimeline({
  items,
  live = false,
  showErrorBadge = false,
}: {
  items: AssistantContentItem[]
  live?: boolean
  showErrorBadge?: boolean
}) {
  const lastBubbleIndex = items.reduce((last, item, index) => item.type === 'bubble' ? index : last, -1)
  return (
    <>
      {items.map((item, index) => {
        if (item.type === 'bubble') {
          return (
            <div key={item.id} className="chat-msg__bubble">
              {item.text}
              {live && index === lastBubbleIndex && <span className="chat-cursor" />}
              {showErrorBadge && index === lastBubbleIndex && (
                <span className="chat-msg__error-badge">
                  <AlertCircle size={12} /> 发送失败
                </span>
              )}
            </div>
          )
        }
        if (item.type === 'status') return <ProcessStatusItem key={item.id} text={item.text} live={live} />
        return <ToolActivityPanel key={item.id} toolCalls={item.calls} live={live} />
      })}
    </>
  )
}

// ─── Message Bubble ───────────────────────────────────────
function MessageBubble({
  message,
  onOpenFileChange,
  onShowFileChange,
  onOpenArtifact,
  onShowArtifact,
}: {
  message: DisplayMessage
  onOpenFileChange: (id: string) => void
  onShowFileChange: (id: string) => void
  onOpenArtifact: (id: string) => void
  onShowArtifact: (id: string) => void
}) {
  const isUser = message.role === 'user'
  const assistantItems = isUser ? [] : buildAssistantContentTimeline({ text: message.text, toolCalls: message.toolCalls })
  return (
    <div className={`chat-msg chat-msg--${message.role}`}>
      <div className={`chat-msg__avatar ${isUser ? 'chat-msg__avatar--user' : 'chat-msg__avatar--ai'}`}>
        {isUser ? <User size={14} /> : <Bot size={16} />}
      </div>
      <div className="chat-msg__content">
        {!isUser && <AssistantContentTimeline items={assistantItems} showErrorBadge={message.status === 'error'} />}
        {isUser && message.text && (
          <div className="chat-msg__bubble">
            {message.text}
            {message.status === 'error' && (
              <span className="chat-msg__error-badge">
                <AlertCircle size={12} /> 发送失败
              </span>
            )}
          </div>
        )}
        {!isUser && assistantItems.length === 0 && message.status === 'error' && (
          <ProcessStatusItem text="发送失败" />
        )}
        <MessageFileActions
          fileChanges={message.fileChanges}
          artifacts={message.artifacts}
          onOpenFileChange={onOpenFileChange}
          onShowFileChange={onShowFileChange}
          onOpenArtifact={onOpenArtifact}
          onShowArtifact={onShowArtifact}
        />
        {message.timestamp && (
          <span className="chat-msg__time">{formatTime(message.timestamp)}</span>
        )}
      </div>
    </div>
  )
}

function MessageFileActions({
  fileChanges = [],
  artifacts = [],
  onOpenFileChange,
  onShowFileChange,
  onOpenArtifact,
  onShowArtifact,
}: {
  fileChanges?: AgentFileChange[]
  artifacts?: AgentArtifact[]
  onOpenFileChange: (id: string) => void
  onShowFileChange: (id: string) => void
  onOpenArtifact: (id: string) => void
  onShowArtifact: (id: string) => void
}) {
  const changePaths = new Set(fileChanges.map((item) => item.path))
  const uniqueArtifacts = artifacts.filter((item) => !changePaths.has(item.path))
  if (fileChanges.length === 0 && uniqueArtifacts.length === 0) return null

  return (
    <div className="message-files">
      <div className="message-files__header">
        <FolderOpen size={13} />
        <span>本轮文件</span>
      </div>
      <div className="message-files__list">
        {fileChanges.slice(0, 6).map((change) => (
          <div key={change.id} className="message-files__row">
            <button className="message-files__main" onClick={() => onOpenFileChange(change.id)} title={change.path}>
              <span className="message-files__kind">{changeTypeLabel(change.type)}</span>
              <span className="message-files__path">{change.path}</span>
            </button>
            <button className="message-files__action" onClick={() => onShowFileChange(change.id)} title="打开所在目录">
              <FolderOpen size={13} />
            </button>
          </div>
        ))}
        {uniqueArtifacts.slice(0, 4).map((artifact) => (
          <div key={artifact.id} className="message-files__row">
            <button className="message-files__main" onClick={() => onOpenArtifact(artifact.id)} title={artifact.path}>
              <span className="message-files__kind">{artifactTypeLabel(artifact.type)}</span>
              <span className="message-files__path">{artifact.name}</span>
            </button>
            <button className="message-files__action" onClick={() => onShowArtifact(artifact.id)} title="打开所在目录">
              <FolderOpen size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Conversation Item ────────────────────────────────────
interface ConversationItemProps {
  conv: ChatConversation
  isActive: boolean
  isEditing: boolean
  editingTitle: string
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onStartRename: (id: string, title: string) => void
  onEditTitleChange: (title: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onDelete: (id: string) => void
  indent?: boolean
}

function ConversationItem({
  conv, isActive, isEditing, editingTitle,
  onSelect, onContextMenu, onStartRename, onEditTitleChange, onFinishRename, onCancelRename, onDelete, indent,
}: ConversationItemProps) {
  return (
    <div
      className={`chat-sidebar__item ${isActive ? 'active' : ''} ${indent ? 'chat-sidebar__item--indent' : ''}`}
      onClick={() => onSelect(conv.id)}
      onContextMenu={(e) => onContextMenu(e, conv.id)}
      onDoubleClick={() => onStartRename(conv.id, conv.title || '')}
    >
      {isEditing ? (
        <input
          className="chat-sidebar__rename-input"
          value={editingTitle}
          onChange={(e) => onEditTitleChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') onFinishRename()
            // Escape discards the edit; finishing here saved the typed title anyway.
            if (e.key === 'Escape') onCancelRename()
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="chat-sidebar__item-text">
            {conv.title || '新对话'}
          </span>
          <span className="chat-sidebar__item-time">
            {relativeTime(conv.updatedAt)}
          </span>
          <div className="chat-sidebar__item-actions">
            <button
              className="chat-sidebar__item-btn"
              onClick={(e) => { e.stopPropagation(); onStartRename(conv.id, conv.title || '') }}
              title="编辑"
            >
              <Pencil size={12} />
            </button>
            <button
              className="chat-sidebar__item-btn chat-sidebar__item-btn--danger"
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
              title="删除"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── AgentRun Panel ──────────────────────────────────────
function AgentRunPanel({ run, project }: { run: AgentRun; project?: ChatProject; onRunUpdate?: (run: AgentRun) => void }) {
  const statusLabel: Record<string, string> = {
    scoping: '理解任务',
    'loading-context': '读取上下文',
    planning: '规划中',
    'waiting-approval': '等待确认',
    checkpointing: '创建快照',
    executing: '执行中',
    verifying: '验证中',
    'review-ready': '待审查',
    completed: '已完成',
    failed: '失败',
    cancelled: '已停止',
  }
  const workspaceName = project?.displayName ?? project?.name ?? '未选择工作区'
  const elapsed = run.finishedAt
    ? Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))
    : Math.max(0, Math.round((Date.now() - run.startedAt) / 1000))
  const title = agentRunDisplayTitle(run)
  const pendingApprovals = run.approvals.filter((approval) => approval.status === 'pending')
  const completedSteps = run.plan.filter((step) => step.status === 'completed').length
  const totalSteps = run.plan.length

  return (
    <details className="agent-run-task">
      <summary className="agent-run-task__summary">
        <span className={`agent-run-task__dot agent-run-task__dot--${run.status}`} />
        <span className="agent-run-task__title" title={title}>{title}</span>
        {totalSteps > 0 && (
          <div className="agent-run-task__steps" aria-label="任务步骤进度">
            {run.plan.slice(0, 6).map((step) => (
              <span
                key={step.id}
                className={`agent-run-task__step-dot agent-run-task__step-dot--${taskStepStatusClass(step.status)}`}
                title={step.goal}
              />
            ))}
          </div>
        )}
        <span className="agent-run-task__status">{statusLabel[run.status] ?? run.status}{totalSteps > 0 ? ` · ${completedSteps}/${totalSteps}` : ''}</span>
        <ChevronDown size={14} className="agent-run-task__chevron" />
      </summary>
      <div className="agent-run-task__details">
        <span>{workspaceName}</span>
        <span>{elapsed}s</span>
        {run.checkpoints.length > 0 && <span>{run.checkpoints.length} 个快照</span>}
        {run.verification && <span>验证 {run.verification.passed}/{run.verification.items.length}</span>}
        {pendingApprovals.length > 0 && <span>{pendingApprovals.length} 个确认待处理</span>}
      </div>
      {run.plan.length > 0 && (
        <div className="agent-run-task__plan">
          {run.plan.map((step) => (
            <span key={step.id} className={`agent-run-task__plan-item agent-run-task__plan-item--${taskStepStatusClass(step.status)}`}>
              {step.goal}
            </span>
          ))}
        </div>
      )}
      {run.verification && (
        <div className="agent-run-task__verification">
          <span>{run.verification.passed} 通过</span>
          {run.verification.failed > 0 && <span>{run.verification.failed} 失败</span>}
          {run.verification.warnings > 0 && <span>{run.verification.warnings} 警告</span>}
          {run.verification.unchecked > 0 && <span>{run.verification.unchecked} 未验证</span>}
        </div>
      )}
    </details>
  )
}

function ApprovalDialog({ approval, project, onResolve }: { approval: AgentApproval; project?: ChatProject; onResolve: (approval: AgentApproval, decision: AgentApprovalDecision) => void }) {
  const paths = approval.affectedPaths.slice(0, 6)
  return (
    <div className="approval-dialog" role="dialog" aria-label="授权确认">
      <div className="approval-dialog__header">
        <AlertCircle size={16} />
        <div>
          <div className="approval-dialog__title">需要授权</div>
          <div className="approval-dialog__meta">{project?.displayName ?? project?.name ?? '当前工作区'} · {approval.riskLevel === 'high' ? '高风险' : '中风险'}</div>
        </div>
      </div>
      <div className="approval-dialog__body">
        <div className="approval-dialog__action">{approval.action}</div>
        <div className="approval-dialog__reason">{approval.reason}</div>
        {approval.command && <code className="approval-dialog__command">{approval.command}</code>}
        {paths.length > 0 && (
          <div className="approval-dialog__paths">
            {paths.map((item) => <span key={item} title={item}>{item}</span>)}
            {approval.affectedPaths.length > paths.length && <span>还有 {approval.affectedPaths.length - paths.length} 个路径</span>}
          </div>
        )}
      </div>
      <div className="approval-dialog__actions">
        <button onClick={() => onResolve(approval, 'deny')}>拒绝</button>
        <button onClick={() => onResolve(approval, 'allow-once')}>允许本次</button>
        <button className="approval-dialog__primary" onClick={() => onResolve(approval, 'allow-workspace')}>允许此工作区</button>
      </div>
    </div>
  )
}

function AutomationInbox({
  automations,
  results,
  canCreate,
  onCreateManual,
  onCreateHourly,
  onRunNow,
  onToggle,
  onDelete,
}: {
  automations: AgentAutomation[]
  results: AgentAutomationResult[]
  canCreate: boolean
  onCreateManual: () => void
  onCreateHourly: () => void
  onRunNow: (id: string) => void
  onToggle: (item: AgentAutomation) => void
  onDelete: (id: string) => void
}) {
  if (automations.length === 0 && results.length === 0) return null

  const visibleAutomations = automations.slice(0, 3)
  const visibleResults = results.slice(0, 3)
  const activeCount = automations.filter((item) => item.status === 'active').length
  const statusLabel: Record<string, string> = {
    running: '运行中',
    completed: '完成',
    failed: '失败',
    cancelled: '停止',
    pending: '等待',
  }
  return (
    <details className="automation-inbox">
      <summary className="automation-inbox__summary">
        <Inbox size={14} />
        <span className="automation-inbox__title">自动化收件箱</span>
        <span className="automation-inbox__meta">{activeCount} 启用 · {results.length} 结果</span>
        <ChevronDown size={14} className="automation-inbox__chevron" />
      </summary>
      <div className="automation-inbox__quick">
        <button onClick={onCreateManual} disabled={!canCreate}>保存当前输入</button>
        <button onClick={onCreateHourly} disabled={!canCreate}>每小时运行</button>
      </div>
      {visibleAutomations.length > 0 && (
        <div className="automation-inbox__list">
          {visibleAutomations.map((item) => (
            <div key={item.id} className="automation-inbox__item">
              <span className="automation-inbox__item-title" title={item.prompt}>{item.name}</span>
              <span className="automation-inbox__item-meta">{item.scheduleType === 'interval' ? `${item.intervalMinutes ?? 60}m` : item.scheduleType === 'daily' ? item.timeOfDay : '手动'}</span>
              <button onClick={() => onRunNow(item.id)} title="立即运行"><Play size={12} /></button>
              <button onClick={() => onToggle(item)} title={item.status === 'active' ? '暂停' : '启用'}>{item.status === 'active' ? <Pause size={12} /> : <Play size={12} />}</button>
              <button onClick={() => onDelete(item.id)} title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {visibleResults.length > 0 && (
        <div className="automation-inbox__results">
          {visibleResults.map((item) => (
            <div key={item.id} className={`automation-inbox__result automation-inbox__result--${item.status}`}>
              <span>{statusLabel[item.status] ?? item.status}</span>
              <span title={item.error ?? item.summary ?? undefined}>{item.error ?? item.summary ?? '无摘要'}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}

// ─── Input Component ──────────────────────────────────────
interface InputBoxProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onSend: () => void
  onStop: () => void
  onAttachFiles: () => void
  canCreateAutomation: boolean
  onCreateAutomation: (scheduleType: 'manual' | 'interval') => void
  project?: ChatProject
  onPermissionChange: (projectId: string, permissionProfile: WorkspacePermissionProfile) => void | Promise<void>
  disabled: boolean
  isRunning: boolean
  modelName: string
  connected: boolean | null
}

const InputBox = forwardRef<HTMLTextAreaElement, InputBoxProps>(
  ({ value, onChange, onKeyDown, onSend, onStop, onAttachFiles, canCreateAutomation, onCreateAutomation, project, onPermissionChange, disabled, isRunning, modelName, connected }, ref) => {
    const [addMenuOpen, setAddMenuOpen] = useState(false)

    useEffect(() => {
      if (!addMenuOpen) return
      const close = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.chat-input__add')) setAddMenuOpen(false)
      }
      setTimeout(() => window.addEventListener('click', close), 0)
      return () => window.removeEventListener('click', close)
    }, [addMenuOpen])

    const createHourlyAutomation = () => {
      if (!canCreateAutomation || disabled) return
      onCreateAutomation('interval')
      setAddMenuOpen(false)
    }

    return (
      <div className="chat-input-wrapper">
        <textarea
          ref={ref}
          className="chat-input__textarea"
          placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
        />
        <div className="chat-input__toolbar">
          <div className="chat-input__add">
            <button
              className="chat-input__tool-btn chat-input__tool-btn--add"
              title="添加"
              onClick={() => setAddMenuOpen((open) => !open)}
              disabled={disabled}
            >
              <Plus size={18} />
            </button>
            {addMenuOpen && (
              <div className="chat-input__add-menu">
                <button
                  className="chat-input__add-item"
                  onClick={() => { onAttachFiles(); setAddMenuOpen(false) }}
                >
                  <Paperclip size={16} />
                  <span>添加照片和文件</span>
                </button>
                <button
                  className="chat-input__add-item"
                  onClick={createHourlyAutomation}
                  disabled={!canCreateAutomation || disabled}
                >
                  <Clock size={16} />
                  <span>计划模式</span>
                  <span className="chat-input__add-toggle" />
                </button>
                <button className="chat-input__add-item" disabled>
                  <SlidersHorizontal size={16} />
                  <span>插件</span>
                  <ChevronRight size={16} className="chat-input__add-arrow" />
                </button>
              </div>
            )}
          </div>
          {project && <PermissionButton project={project} onChange={onPermissionChange} />}
          <div className="chat-input__model-tag">
            <ConnectionDot connected={connected} />
            <span>{modelName}</span>
          </div>
          <button
            className="chat-input__send-btn"
            onClick={isRunning ? onStop : onSend}
            disabled={isRunning ? false : disabled || !value.trim()}
            title={isRunning ? '停止' : '发送 (Enter)'}
          >
            {isRunning ? <Square size={15} /> : disabled ? <Loader2 size={16} className="spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
    )
  }
)
InputBox.displayName = 'InputBox'

function PermissionButton({
  project,
  onChange,
}: {
  project: ChatProject
  onChange: (projectId: string, permissionProfile: WorkspacePermissionProfile) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.permission-menu')) setOpen(false)
    }
    setTimeout(() => window.addEventListener('click', close), 0)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="permission-menu">
      <button
        className="permission-menu__trigger"
        onClick={() => setOpen((value) => !value)}
        title={`权限：${permissionLabel(project.permissionProfile)}`}
      >
        <SlidersHorizontal size={14} />
        <span>{permissionLabel(project.permissionProfile)}</span>
        <ChevronDown size={12} className={`permission-menu__chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="permission-menu__menu">
          {PERMISSION_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`permission-menu__item ${option.value === project.permissionProfile ? 'active' : ''}`}
              onClick={() => { void onChange(project.id, option.value); setOpen(false) }}
            >
              <span className="permission-menu__item-title">{option.label}</span>
              <span className="permission-menu__item-desc">{option.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Project Picker (below input) ─────────────────────────
function ProjectPicker({
  projects,
  selectedId,
  onSelect,
  onCreateProject,
  fileChanges = [],
  artifacts = [],
  onError,
}: {
  projects: ChatProject[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCreateProject: () => void
  fileChanges?: AgentFileChange[]
  artifacts?: AgentArtifact[]
  onError?: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const activeProjects = projects.filter(p => p.status === 'active')
  const selected = activeProjects.find(p => p.id === selectedId)
  const scanLabel = selected?.fileStats ? `Ready · ${selected.fileStats.fileCount} files` : selected?.indexStatus
  const activityCount = fileChanges.length + artifacts.length

  const openFileChange = async (id: string) => {
    const result = await window.lingyue.chat.openFileChange(id)
    if (!result.ok && result.error) onError?.(result.error)
  }
  const showFileChange = async (id: string) => {
    const result = await window.lingyue.chat.showFileChangeInFolder(id)
    if (!result.ok && result.error) onError?.(result.error)
  }
  const openArtifact = async (id: string) => {
    const result = await window.lingyue.chat.openArtifact(id)
    if (!result.ok && result.error) onError?.(result.error)
  }
  const showArtifact = async (id: string) => {
    const result = await window.lingyue.chat.showArtifactInFolder(id)
    if (!result.ok && result.error) onError?.(result.error)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.project-picker')) {
        setOpen(false)
      }
    }
    setTimeout(() => window.addEventListener('click', close), 0)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="project-picker">
      <button
        className={`project-picker__trigger ${selected ? 'project-picker__trigger--active' : ''}`}
        onClick={() => setOpen(!open)}
        title={selected?.rootPath ?? selected?.path ?? '选择本地文件夹作为工作空间'}
      >
        <FolderInput size={14} />
        <span className="project-picker__trigger-text">
          <span className="project-picker__trigger-title">
            {selected ? `Working in: ${selected.displayName}` : '进入项目工作'}
          </span>
          {selected && <span className="project-picker__trigger-meta">{scanLabel}</span>}
        </span>
        {selected && activityCount > 0 && <span className="project-picker__activity-badge">{activityCount} 个文件活动</span>}
        <ChevronDown size={12} className={`project-picker__chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="project-picker__menu">
          {selected && (
            <div className="project-picker__details">
              <div className="project-picker__details-title">Working folder</div>
              <div className="project-picker__details-name">{selected.displayName}</div>
              <div className="project-picker__details-path">{selected.rootPath ?? selected.path}</div>
              <div className="project-picker__details-grid">
                <span>{scanLabel}</span>
                {activityCount > 0 && <span>{activityCount} 个文件活动</span>}
                <span>{selected.fileStats?.instructionFiles.length ?? 0} rules</span>
                <span>{selected.fileStats?.sensitiveFiles.length ?? 0} sensitive</span>
              </div>
            </div>
          )}
          {selected && (fileChanges.length > 0 || artifacts.length > 0) && (
            <div className="project-picker__activity">
              <div className="project-picker__activity-title">最近文件活动</div>
              {fileChanges.map((change) => (
                <div key={change.id} className="project-picker__activity-row">
                  <button className="project-picker__activity-main" onClick={() => void openFileChange(change.id)} title={change.path}>
                    <span className="project-picker__activity-kind">{changeTypeLabel(change.type)}</span>
                    <span className="project-picker__activity-path">{change.path}</span>
                  </button>
                  <button className="project-picker__activity-action" onClick={() => void showFileChange(change.id)} title="打开所在目录">
                    <FolderOpen size={12} />
                  </button>
                </div>
              ))}
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="project-picker__activity-row">
                  <button className="project-picker__activity-main" onClick={() => void openArtifact(artifact.id)} title={artifact.path}>
                    <span className="project-picker__activity-kind">{artifactTypeLabel(artifact.type)}</span>
                    <span className="project-picker__activity-path">{artifact.name}</span>
                  </button>
                  <button className="project-picker__activity-action" onClick={() => void showArtifact(artifact.id)} title="打开所在目录">
                    <FolderOpen size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {selected && (
            <button
              className="project-picker__item project-picker__item--clear"
              onClick={() => { onSelect(null); setOpen(false) }}
            >
              <span>退出项目</span>
            </button>
          )}
          {activeProjects.map(p => (
            <button
              key={p.id}
              className={`project-picker__item ${p.id === selectedId ? 'active' : ''}`}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              title={p.rootPath ?? p.path ?? undefined}
            >
              <FolderOpen size={14} />
              <span className="project-picker__item-name">{p.name}</span>
              <span className="project-picker__item-path">
                {p.fileStats ? `Ready · ${p.fileStats.fileCount} files` : p.indexStatus}
              </span>
              {p.id === selectedId && <span className="project-picker__check">✓</span>}
            </button>
          ))}
          <div className="project-picker__divider" />
          <button
            className="project-picker__item project-picker__item--create"
            onClick={() => { onCreateProject(); setOpen(false) }}
          >
            <FolderPlus size={14} />
            <span>添加文件夹…</span>
          </button>
        </div>
      )}
    </div>
  )
}
