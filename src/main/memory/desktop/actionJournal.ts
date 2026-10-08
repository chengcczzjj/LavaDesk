import { randomUUID } from 'crypto'
import type { ActionJournalEntry, ActionReceiptStatus, ActionUndoSpec } from '@shared/agent-actions'
import { applyDesktopUndo } from './desktopState'
import { ReminderService } from './reminderService'

/**
 * Receipts for the companion's desktop actions. Kept in memory only: undo is
 * for "that was wrong, put it back" moments, and snapshots can hold large
 * widget data that should not be written into settings files.
 */
const MAX_ENTRIES = 60
const entries: ActionJournalEntry[] = []

export interface RecordActionParams {
  conversationId: string | null
  turnId: string | null
  toolName: string
  summary: string
  undo: ActionUndoSpec | null
}

export const ActionJournal = {
  record(params: RecordActionParams): ActionJournalEntry {
    const entry: ActionJournalEntry = {
      id: randomUUID().slice(0, 8),
      createdAt: Date.now(),
      conversationId: params.conversationId,
      turnId: params.turnId,
      toolName: params.toolName,
      summary: params.summary,
      undoable: Boolean(params.undo),
      ...(params.undo ? { undo: params.undo } : {}),
    }
    entries.unshift(entry)
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
    return entry
  },

  get(id: string): ActionJournalEntry | undefined {
    return entries.find((entry) => entry.id === id)
  },

  /**
   * Current state of receipts shown in a chat surface. Entries live in memory,
   * so after a restart old receipts read as expired instead of offering an undo that cannot work.
   */
  status(ids: string[]): Record<string, ActionReceiptStatus> {
    const result: Record<string, ActionReceiptStatus> = {}
    for (const id of ids) {
      const entry = this.get(id)
      result[id] = !entry ? 'expired' : entry.undoneAt ? 'undone' : entry.undoable ? 'active' : 'final'
    }
    return result
  },

  /** Most recent entries of one conversation, newest first. */
  recent(conversationId: string | null, limit = 6): ActionJournalEntry[] {
    return entries.filter((entry) => entry.conversationId === conversationId).slice(0, limit)
  },

  /** Digest injected into the next turn so follow-ups ("换回去", "再大一点") stay grounded. */
  digest(conversationId: string | null, limit = 5): string {
    const recent = this.recent(conversationId, limit)
    if (recent.length === 0) return ''
    return recent
      .map((entry) => {
        const state = entry.undoneAt ? '已撤回' : entry.undoable ? '可撤回' : '不可撤回'
        return `- [${entry.id}] ${entry.summary}（${state}）`
      })
      .join('\n')
  },

  async undo(id: string): Promise<{ ok: boolean; entry?: ActionJournalEntry; error?: string }> {
    const entry = this.get(id)
    if (!entry) return { ok: false, error: '这条操作记录已经过期了（应用重启后不能再撤回）。' }
    if (entry.undoneAt) return { ok: false, entry, error: '这一步已经撤回过了。' }
    if (!entry.undo) return { ok: false, entry, error: '这一步动了真实文件或系统状态，没法自动撤回。' }
    const result = entry.undo.kind === 'desktop'
      ? await applyDesktopUndo(entry.undo)
      : ReminderService.cancel(entry.undo.reminderId)
        ? { ok: true }
        : { ok: false, error: '这条提醒已经不在了。' }
    if (!result.ok) return { ok: false, entry, error: result.error }
    entry.undoneAt = Date.now()
    return { ok: true, entry }
  },

  /** Undo the newest undoable action, or every action of the newest turn. */
  async undoLatest(params: { conversationId: string | null; scope: 'last' | 'turn' }): Promise<{ ok: boolean; undone: ActionJournalEntry[]; error?: string }> {
    const candidates = entries.filter((entry) => entry.conversationId === params.conversationId && entry.undoable && !entry.undoneAt)
    const latest = candidates[0]
    if (!latest) return { ok: false, undone: [], error: '最近没有可以撤回的桌面操作。' }
    const targets = params.scope === 'turn' && latest.turnId
      ? candidates.filter((entry) => entry.turnId === latest.turnId)
      : [latest]
    const undone: ActionJournalEntry[] = []
    // Newest first, so later edits come off before the earlier ones they built on.
    for (const entry of targets) {
      const result = await this.undo(entry.id)
      if (!result.ok) return { ok: undone.length > 0, undone, error: result.error }
      undone.push(entry)
    }
    return { ok: true, undone }
  },
}
