import { screen } from 'electron'
import {
  describeWidgetDiff,
  diffWidgets,
  isEmptyWidgetDiff,
  revertWidgetDiff,
  wallpaperLayoutChanged,
  wallpaperSettingsChanged,
  type ActionUndoSpec,
  type DesktopStateCapture,
  type DesktopWallpaperCapture,
} from '@shared/agent-actions'
import { getWidgetCapability } from '@shared/desktop-scene'
import { describeAreaPosition, formatDesktopSnapshot, type SnapshotWidget } from '@shared/desktop-snapshot'
import { isGeneratedWidgetDefinition } from '@shared/generated-widget'
import { normalizeStockSymbols } from '@shared/stock-symbols'
import type { WidgetInstance } from '@shared/types'
import {
  getWidgetNamespaceWallpaperIdForTool,
  listWidgetsForTool,
  replaceWidgetsForTool,
} from '../../ipc/widgetIpc'
import {
  getWallpaperStateForTool,
  restoreWallpaperLayoutForTool,
  updateWallpaperSettingsForTool,
} from '../../ipc/wallpaperIpc'
import { getDisplayDescriptors } from '../../windows/displayLayout'
import { ReminderService } from './reminderService'
import { listDesktopModeNames } from './desktopModes'
import { getPetAgentState } from './petBridge'

const ICON_WIDGET_TYPES = new Set(['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive', 'desktop-icons-dock'])

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function widgetDisplayName(widget: Pick<WidgetInstance, 'type' | 'config'>): string {
  if (widget.type === 'generated-widget') {
    const definition = widget.config?.definition
    if (isGeneratedWidgetDefinition(definition) && definition.title) return `「${definition.title}」卡片`
  }
  return getWidgetCapability(widget.type)?.displayName ?? widget.type
}

export function captureDesktopWallpaper(): DesktopWallpaperCapture {
  const state = getWallpaperStateForTool()
  return {
    wallpaperId: state.current?.id ?? null,
    wallpaperName: state.current?.name,
    wallpaperSettings: state.current?.settings ? { ...state.current.settings } : undefined,
    displayMode: state.mode,
    assignments: state.assignments,
  }
}

export function captureDesktopState(): DesktopStateCapture {
  return { ...captureDesktopWallpaper(), widgets: clone(listWidgetsForTool()) }
}

function wallpaperPart(state: DesktopStateCapture): DesktopWallpaperCapture {
  return {
    wallpaperId: state.wallpaperId,
    wallpaperName: state.wallpaperName,
    wallpaperSettings: state.wallpaperSettings,
    displayMode: state.displayMode,
    assignments: state.assignments,
  }
}

export interface DesktopChangeRecord {
  summary: string
  undo: ActionUndoSpec | null
}

/**
 * Turn the state before/after one tool call into an undo spec. Removing a Dock
 * or icon box moves real files back to the desktop, so that part is never
 * offered as undoable.
 */
export function describeDesktopChange(before: DesktopStateCapture, after: DesktopStateCapture): DesktopChangeRecord | null {
  const layoutChanged = wallpaperLayoutChanged(before, after)
  const settingsChanged = wallpaperSettingsChanged(before, after)
  // A wallpaper switch swaps the whole per-wallpaper widget namespace; that is not a widget edit.
  const widgetDiff = before.wallpaperId === after.wallpaperId
    ? diffWidgets(before.widgets, after.widgets)
    : { added: [], removed: [], changed: [] }
  if (!layoutChanged && !settingsChanged && isEmptyWidgetDiff(widgetDiff)) return null

  const parts: string[] = []
  if (before.wallpaperId !== after.wallpaperId) parts.push(`壁纸换成「${after.wallpaperName ?? after.wallpaperId ?? '无'}」`)
  else if (layoutChanged) parts.push('调整了多屏壁纸布局')
  if (settingsChanged) parts.push('调整了壁纸播放设置')
  const widgetText = describeWidgetDiff(widgetDiff, widgetDisplayName)
  if (widgetText) parts.push(widgetText)

  const touchesIconFiles = widgetDiff.removed.some((widget) => ICON_WIDGET_TYPES.has(widget.type))
  return {
    summary: parts.join('；'),
    undo: touchesIconFiles
      ? null
      : {
          kind: 'desktop',
          before: wallpaperPart(before),
          after: wallpaperPart(after),
          widgetsWallpaperId: after.wallpaperId,
          widgetDiff,
        },
  }
}

export async function applyDesktopUndo(spec: Extract<ActionUndoSpec, { kind: 'desktop' }>): Promise<{ ok: boolean; error?: string }> {
  const current = captureDesktopWallpaper()
  if (wallpaperLayoutChanged(spec.before, spec.after)) {
    if (wallpaperLayoutChanged(current, spec.after)) {
      return { ok: false, error: '壁纸在那之后又换过了，我就不硬改回去了。' }
    }
    const restored = await restoreWallpaperLayoutForTool(spec.before)
    if (!restored.ok) return restored
  }
  if (wallpaperSettingsChanged(spec.before, spec.after) && spec.before.wallpaperId) {
    const restored = await updateWallpaperSettingsForTool(spec.before.wallpaperId, spec.before.wallpaperSettings ?? {})
    if (!restored.ok) return restored
  }
  if (!isEmptyWidgetDiff(spec.widgetDiff)) {
    if (getWidgetNamespaceWallpaperIdForTool() !== spec.widgetsWallpaperId) {
      return { ok: false, error: '这些组件属于另一张壁纸，先切回那张壁纸再撤回。' }
    }
    replaceWidgetsForTool(revertWidgetDiff(listWidgetsForTool(), spec.widgetDiff))
  }
  return { ok: true }
}

function widgetDetail(widget: WidgetInstance): string | undefined {
  const config = widget.config ?? {}
  if (widget.type === 'stocks') {
    const codes = normalizeStockSymbols(config.symbols).map((symbol) => symbol.code)
    return codes.length ? codes.slice(0, 4).join(',') : undefined
  }
  if (widget.type === 'text' && typeof config.text === 'string') return `“${config.text.slice(0, 16)}”`
  if (ICON_WIDGET_TYPES.has(widget.type)) return `${Array.isArray(config.items) ? config.items.length : 0} 个图标`
  return undefined
}

/** Compact desktop description injected into each chat turn. */
export function buildDesktopSnapshotText(): string {
  try {
    const displays = getDisplayDescriptors()
    const primary = displays.find((display) => display.primary) ?? displays[0]
    const state = getWallpaperStateForTool()
    const widgets = listWidgetsForTool()
    const snapshotWidgets: SnapshotWidget[] = widgets.map((widget) => {
      const display = displays.find((item) => item.key === widget.displayKey) ?? primary
      const area = display ? { x: 0, y: 0, width: display.workArea.width, height: display.workArea.height } : null
      const width = widget.width || 240
      const height = widget.height || 120
      const position = area ? describeAreaPosition({ x: widget.x, y: widget.y, width, height }, area) : undefined
      return {
        id: widget.id,
        type: widget.type,
        displayName: widgetDisplayName(widget),
        visible: widget.enabled,
        position: displays.length > 1 && display && !display.primary ? `副屏${position ?? ''}` : position,
        detail: widgetDetail(widget),
      }
    })
    const pet = widgets.find((widget) => widget.type === 'pet' && widget.enabled)
    const petConfig = (pet?.config?.pixelPet ?? {}) as { pet?: { name?: string }; settings?: { petName?: string; state?: string } }
    const reminders = ReminderService.summary()
    return formatDesktopSnapshot({
      displayCount: displays.length || screen.getAllDisplays().length,
      primarySize: primary ? { width: primary.bounds.width, height: primary.bounds.height } : undefined,
      displayMode: state.mode,
      wallpaper: state.current
        ? { name: state.current.name, type: state.current.type, volume: state.current.settings?.volume, speed: state.current.settings?.speed }
        : null,
      widgets: snapshotWidgets,
      pet: {
        onDesktop: Boolean(pet),
        name: petConfig.settings?.petName || petConfig.pet?.name,
        state: getPetAgentState() ?? petConfig.settings?.state,
      },
      reminders,
      quietHours: ReminderService.getQuietHours().enabled ? ReminderService.getQuietHours() : null,
      customModes: listDesktopModeNames(),
    })
  } catch (error) {
    return `（桌面状态暂时读取失败：${(error as Error).message}）`
  }
}

export function isIconWidgetType(type: string): boolean {
  return ICON_WIDGET_TYPES.has(type)
}

export function findWidget(id?: string, type?: string): WidgetInstance | undefined {
  const widgets = listWidgetsForTool()
  if (id) return widgets.find((widget) => widget.id === id)
  if (type) return widgets.find((widget) => widget.type === type)
  return undefined
}
