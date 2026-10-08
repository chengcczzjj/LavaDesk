import type { WallpaperDisplayMode, WallpaperSettings, WidgetInstance } from './types'

/**
 * Desktop state the companion can change. The chat service captures it
 * around every journaled tool call; the difference is what an undo reverts.
 */
export interface DesktopWallpaperCapture {
  wallpaperId: string | null
  wallpaperName?: string
  wallpaperSettings?: WallpaperSettings
  displayMode: WallpaperDisplayMode
  assignments: Record<string, string>
}

export interface DesktopStateCapture extends DesktopWallpaperCapture {
  widgets: WidgetInstance[]
}

export interface WidgetDiff {
  added: WidgetInstance[]
  removed: WidgetInstance[]
  changed: { before: WidgetInstance; after: WidgetInstance }[]
}

export type ActionUndoSpec =
  | {
      kind: 'desktop'
      before: DesktopWallpaperCapture
      after: DesktopWallpaperCapture
      /** Wallpaper namespace the widget diff belongs to (widgets are stored per wallpaper). */
      widgetsWallpaperId: string | null
      widgetDiff: WidgetDiff
    }
  | { kind: 'reminder-cancel'; reminderId: string }

/** active: can be undone · undone · final: never undoable · expired: gone after an app restart. */
export type ActionReceiptStatus = 'active' | 'undone' | 'final' | 'expired'

export interface ActionJournalEntry {
  id: string
  createdAt: number
  conversationId: string | null
  /** Groups the actions of one chat turn so "撤回刚才的" can revert them together. */
  turnId: string | null
  toolName: string
  summary: string
  undoable: boolean
  undoneAt?: number
  undo?: ActionUndoSpec
}

export type ActionConfirmDecision = 'allow' | 'allow-always' | 'deny'

export interface ActionConfirmRequest {
  confirmId: string
  streamId: string
  toolName: string
  /** Persona-friendly question shown on the card. */
  title: string
  detail?: string
  risk: 'medium' | 'high'
  /** Present when the user may allow this kind of action permanently. */
  rememberKey?: string
  expiresAt: number
}

export type ActionPolicyResult =
  | { decision: 'auto' }
  | { decision: 'confirm'; title: string; detail?: string; risk: 'medium' | 'high'; rememberKey?: string }
  | { decision: 'deny'; reason: string }

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

/**
 * Legacy records get an explicit stackOrder the first time any widget is
 * saved; that bookkeeping is not a change the companion made to the widget.
 */
function sameWidget(before: WidgetInstance, after: WidgetInstance): boolean {
  if (typeof before.stackOrder !== 'number') return sameValue(before, { ...after, stackOrder: undefined })
  return sameValue(before, after)
}

export function diffWidgets(before: readonly WidgetInstance[], after: readonly WidgetInstance[]): WidgetDiff {
  const beforeById = new Map(before.map((widget) => [widget.id, widget]))
  const afterById = new Map(after.map((widget) => [widget.id, widget]))
  const diff: WidgetDiff = { added: [], removed: [], changed: [] }
  for (const widget of after) {
    const previous = beforeById.get(widget.id)
    if (!previous) diff.added.push(widget)
    else if (!sameWidget(previous, widget)) diff.changed.push({ before: previous, after: widget })
  }
  for (const widget of before) {
    if (!afterById.has(widget.id)) diff.removed.push(widget)
  }
  return diff
}

export function isEmptyWidgetDiff(diff: WidgetDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}

export function wallpaperLayoutChanged(before: DesktopWallpaperCapture, after: DesktopWallpaperCapture): boolean {
  return before.wallpaperId !== after.wallpaperId
    || before.displayMode !== after.displayMode
    || !sameValue(before.assignments, after.assignments)
}

export function wallpaperSettingsChanged(before: DesktopWallpaperCapture, after: DesktopWallpaperCapture): boolean {
  return before.wallpaperId === after.wallpaperId && !sameValue(before.wallpaperSettings ?? {}, after.wallpaperSettings ?? {})
}

/**
 * Revert only the widgets one action touched. Widgets the user moved or added
 * afterwards are left alone, so an undo never throws away unrelated edits.
 */
export function revertWidgetDiff(current: readonly WidgetInstance[], diff: WidgetDiff): WidgetInstance[] {
  const addedIds = new Set(diff.added.map((widget) => widget.id))
  const restoreById = new Map(diff.changed.map((change) => [change.before.id, change.before]))
  const next = current
    .filter((widget) => !addedIds.has(widget.id))
    .map((widget) => restoreById.get(widget.id) ?? widget)
  const present = new Set(next.map((widget) => widget.id))
  for (const change of diff.changed) {
    if (!present.has(change.before.id)) {
      next.push(change.before)
      present.add(change.before.id)
    }
  }
  for (const widget of diff.removed) {
    if (!present.has(widget.id)) {
      next.push(widget)
      present.add(widget.id)
    }
  }
  return next
}

function joinNames(names: string[], limit = 3): string {
  const unique = [...new Set(names)]
  return unique.length > limit ? `${unique.slice(0, limit).join('、')}等 ${unique.length} 个` : unique.join('、')
}

export function describeWidgetDiff(diff: WidgetDiff, nameOf: (widget: WidgetInstance) => string): string {
  const parts: string[] = []
  if (diff.added.length > 0) parts.push(`新增${joinNames(diff.added.map(nameOf))}`)
  const shown = diff.changed.filter((change) => change.before.enabled !== change.after.enabled)
  const hidden = shown.filter((change) => !change.after.enabled).map((change) => nameOf(change.after))
  const restored = shown.filter((change) => change.after.enabled).map((change) => nameOf(change.after))
  const adjusted = diff.changed.filter((change) => change.before.enabled === change.after.enabled).map((change) => nameOf(change.after))
  if (hidden.length > 0) parts.push(`隐藏${joinNames(hidden)}`)
  if (restored.length > 0) parts.push(`恢复${joinNames(restored)}`)
  if (adjusted.length > 0) parts.push(`调整${joinNames(adjusted)}`)
  if (diff.removed.length > 0) parts.push(`移除${joinNames(diff.removed.map(nameOf))}`)
  return parts.join('，')
}

/** Undo spec for an action that changed nothing is not worth a journal entry. */
export function isEmptyDesktopChange(before: DesktopStateCapture, after: DesktopStateCapture): boolean {
  return !wallpaperLayoutChanged(before, after)
    && !wallpaperSettingsChanged(before, after)
    && isEmptyWidgetDiff(diffWidgets(before.widgets, after.widgets))
}
