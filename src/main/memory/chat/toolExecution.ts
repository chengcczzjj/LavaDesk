import type { ToolSet } from 'ai'
import type { ActionConfirmRequest, ActionUndoSpec } from '@shared/agent-actions'
import { getToolManifest } from '@shared/tool-manifest'
import { isFailedToolOutput } from '@shared/tool-result'
import { evaluateActionPolicy, addActionGrant } from '../desktop/actionPolicy'
import { ActionJournal } from '../desktop/actionJournal'
import { captureDesktopState, describeDesktopChange } from '../desktop/desktopState'
import type { ActionConfirmOutcome } from '../desktop/confirmationBroker'

type ExecutableTool = { execute?: (...args: unknown[]) => unknown }

export type ConfirmationRequester = (
  request: Omit<ActionConfirmRequest, 'confirmId' | 'expiresAt' | 'streamId'>,
) => Promise<ActionConfirmOutcome>

export interface ManagedToolOptions {
  conversationId: string
  turnId: string
  /** Absent for background runs (automations): actions that need a yes are declined. */
  requestConfirmation?: ConfirmationRequester
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function normalizeToolCacheInput(toolName: string, input: unknown): unknown {
  if (toolName === 'get_user_location') {
    const record = asRecord(input)
    const precision = typeof record?.precision === 'string' ? record.precision : 'auto'
    return { refresh: record?.refresh === true, precision }
  }
  if (toolName === 'weather') {
    const record = asRecord(input)
    const city = typeof record?.city === 'string'
      ? record.city.trim().replace(/市$/, '').toLowerCase()
      : ''
    const days = typeof record?.days === 'number' ? record.days : 3
    return { city, days }
  }
  return input
}

export function toolCacheKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(normalizeToolCacheInput(toolName, input))}`
}

export function shouldCacheToolCall(toolName: string): boolean {
  return getToolManifest(toolName)?.cacheable === true
}

export function compactToolOutput(value: unknown, maxChars: number): unknown {
  const budget = { remaining: maxChars, truncated: false }
  const visit = (input: unknown, depth: number): unknown => {
    if (budget.remaining <= 0) {
      budget.truncated = true
      return '[已按工具上下文预算截断]'
    }
    if (typeof input === 'string') {
      if (input.length <= budget.remaining) {
        budget.remaining -= input.length
        return input
      }
      const result = `${input.slice(0, Math.max(0, budget.remaining - 18))}\n[内容已截断]`
      budget.remaining = 0
      budget.truncated = true
      return result
    }
    if (input == null || typeof input === 'number' || typeof input === 'boolean') {
      budget.remaining -= 8
      return input
    }
    if (depth >= 8) {
      budget.truncated = true
      return '[嵌套内容已截断]'
    }
    if (Array.isArray(input)) {
      const result: unknown[] = []
      for (const item of input.slice(0, 100)) {
        if (budget.remaining <= 0) break
        result.push(visit(item, depth + 1))
      }
      if (result.length < input.length) {
        budget.truncated = true
        result.push({ truncatedItems: input.length - result.length })
      }
      return result
    }
    if (typeof input === 'object') {
      const result: Record<string, unknown> = {}
      const entries = Object.entries(input as Record<string, unknown>)
      for (const [key, item] of entries.slice(0, 100)) {
        if (budget.remaining <= 0) break
        budget.remaining -= key.length
        result[key] = visit(item, depth + 1)
      }
      if (Object.keys(result).length < entries.length) {
        budget.truncated = true
        result._truncatedFields = entries.length - Object.keys(result).length
      }
      return result
    }
    return String(input)
  }
  return visit(value, 0)
}

function outputBudget(toolName: string): number {
  return toolName === 'read_file' || toolName === 'extract_pdf_text' || toolName === 'read_docx' || toolName === 'read_attachment'
    ? 60_000
    : 24_000
}

function isUndoSpec(value: unknown): value is ActionUndoSpec {
  const record = asRecord(value)
  return record?.kind === 'reminder-cancel' && typeof record.reminderId === 'string'
}

/** Receipt text for tools whose effect is not a desktop-state diff. */
function describeCustomAction(toolName: string, output: Record<string, unknown>): string {
  if (toolName === 'reminder') {
    const reminder = asRecord(output.reminder)
    return `设置提醒「${String(reminder?.text || '提醒')}」${reminder?.next ? `（${String(reminder.next)}）` : ''}`
  }
  return getToolManifest(toolName)?.label ?? toolName
}

function declinedOutput(outcome: ActionConfirmOutcome | 'no-channel'): Record<string, unknown> {
  const userMessage = outcome === 'timeout'
    ? '等了一会儿没等到你确认，这一步先没做。'
    : outcome === 'no-channel'
      ? '这一步需要你在聊天窗口里点头，我先不动。'
      : '好，这一步不做了。'
  return { ok: false, declined: true, outcome, userMessage }
}

/**
 * Wrap the turn's tools with the companion's execution rules:
 * - the action policy decides whether the user must confirm, and the call is
 *   suspended until they answer (then runs with its original input);
 * - desktop-changing tools are snapshotted before/after and journaled, and
 *   their output carries an undoable receipt;
 * - read-only results are cached per turn, and any write clears that cache
 *   so a later read never returns the stale pre-write state;
 * - outputs are trimmed to a context budget.
 */
export function createManagedToolSet(tools: ToolSet, options: ManagedToolOptions): ToolSet {
  const cache = new Map<string, Promise<unknown>>()
  let desktopLock: Promise<unknown> = Promise.resolve()
  const wrapped: Record<string, unknown> = {}

  const runManaged = async (toolName: string, executable: ExecutableTool, args: unknown[]): Promise<unknown> => {
    const input = args[0]
    const policy = await evaluateActionPolicy(toolName, input)
    if (policy.decision === 'deny') return { ok: false, error: 'denied-by-policy', userMessage: policy.reason }
    if (policy.decision === 'confirm') {
      if (!options.requestConfirmation) return declinedOutput('no-channel')
      const outcome = await options.requestConfirmation({
        toolName,
        title: policy.title,
        detail: policy.detail,
        risk: policy.risk,
        rememberKey: policy.rememberKey,
      })
      if (outcome === 'allow-always' && policy.rememberKey) addActionGrant(policy.rememberKey)
      if (outcome !== 'allow' && outcome !== 'allow-always') return declinedOutput(outcome)
    }

    const manifest = getToolManifest(toolName)
    if (manifest?.risk !== 'read-only') cache.clear()
    if (!manifest?.journal) {
      const output = await executable.execute!(...args)
      const record = asRecord(output)
      if (record && isUndoSpec(record.undo) && !isFailedToolOutput(output)) {
        const { undo, ...rest } = record
        const entry = ActionJournal.record({
          conversationId: options.conversationId,
          turnId: options.turnId,
          toolName,
          summary: describeCustomAction(toolName, rest),
          undo: undo as ActionUndoSpec,
        })
        return { ...rest, receipt: { id: entry.id, summary: entry.summary, undoable: entry.undoable } }
      }
      return output
    }

    // Desktop changes run one at a time so before/after snapshots never interleave.
    const run = desktopLock.then(async () => {
      const before = captureDesktopState()
      const output = await executable.execute!(...args)
      const change = describeDesktopChange(before, captureDesktopState())
      const record = asRecord(output)
      if (!change || !record) return output
      const summary = toolName === 'ambient_sound' && typeof record.sound === 'string'
        ? `${change.summary}，播放${record.sound}`
        : change.summary
      const entry = ActionJournal.record({
        conversationId: options.conversationId,
        turnId: options.turnId,
        toolName,
        summary,
        undo: change.undo,
      })
      return { ...record, receipt: { id: entry.id, summary: entry.summary, undoable: entry.undoable } }
    })
    desktopLock = run.catch(() => undefined)
    return run
  }

  for (const [toolName, toolDef] of Object.entries(tools)) {
    const executable = toolDef as ExecutableTool
    if (typeof executable.execute !== 'function') {
      wrapped[toolName] = toolDef
      continue
    }
    const executeWithBudget = async (...args: unknown[]) => compactToolOutput(await runManaged(toolName, executable, args), outputBudget(toolName))
    wrapped[toolName] = {
      ...toolDef,
      execute: (...args: unknown[]) => {
        if (!shouldCacheToolCall(toolName)) return executeWithBudget(...args)
        const key = toolCacheKey(toolName, args[0])
        const existing = cache.get(key)
        if (existing) return existing
        const promise = executeWithBudget(...args)
        cache.set(key, promise)
        return promise
      },
    }
  }

  return wrapped as ToolSet
}
