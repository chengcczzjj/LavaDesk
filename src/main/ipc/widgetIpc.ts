import { app, dialog, ipcMain, Menu } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { z } from 'zod'
import { isRetiredWidgetType, parseStoredWidgets, storedWidgetSchema, widgetConfigSchema, widgetInstanceSchema } from '@shared/widget-data'
import { createDebouncedWriter } from '@shared/debounced-writer'
import { persistWidgets } from '../services/widget-persistence'
import { withDesktopIconOperation } from '../services/desktop-icon-operations'
import { writeJsonAtomic } from '../runtime/atomicJson'
import type { DesktopIconItem, DisplayBounds, DisplayDescriptor, WidgetInstance } from '@shared/types'
import type { DesktopSceneLayoutPlan } from '@shared/desktop-scene-layout'
import { findSmartWidgetPlacement } from '@shared/widget-placement'
import {
  DEFAULT_WIDGET_SIZE_BY_TYPE,
  getWidgetCapability,
  type DesktopSceneSnapshot,
  type LayoutPatch,
  type WidgetPatch,
} from '@shared/desktop-scene'
import { store } from '../store'
import { sanitizeCanvasHitRegions } from '@shared/canvas-hit-test'
import { positionAtAnchor, type WidgetAnchor } from '@shared/widget-anchor'
import {
  getCanvasWidgetRenderedRect,
  getCanvasWindow,
  isCanvasEditMode,
  noteCanvasRendererActionPointerDown,
  setCanvasEditMode,
  setCanvasHitRegions,
  setCanvasMousePassthrough,
  setCanvasPointerActive,
} from '../windows/canvasWindow'
import {
  getUserWallpaperFolderName,
  getUserWallpapersRoot,
  getRemoteWallpaperFolderName,
  getRemoteWallpapersRoot,
  getWallpaperWidgetOverridePath,
  isRemoteWallpaperId,
  isUserWallpaperId,
  stableUserDataSegment,
} from '../runtime/userDataPaths'
import { getDesktopIconItems, restoreDesktopIconsForWidget } from './desktopIconIpc'
import { assertTrustedIpcSender } from './ipcSecurity'
import { logDockDiagnostic } from '../runtime/diagnosticLog'
import {
  getDesktopRenderBounds,
  getDisplayDescriptors,
  getWallpaperDisplayMode,
} from '../windows/displayLayout'
import { normalizeWidgetStackOrder, moveWidgetToFront } from '@shared/widget-order'
import {
  WIDGET_DISPLAY_COORDINATE_SPACE,
  getDisplayCanvasBounds,
  materializeWidgetsForCanvas,
  migrateLegacyWidgetToDisplay,
  persistWidgetFromCanvas,
  resolveWidgetDisplay,
} from '@shared/widget-display-layout'

/* ===== 布局常量 ===== */
const GRID_GAP = 16        // 组件之间间距
const EDGE_PADDING = 24    // 距屏幕边缘间距
const BOTTOM_EDGE_PADDING = EDGE_PADDING
const DOCK_DEFAULT_WIDTH = 340
const DOCK_DEFAULT_HEIGHT = 88
const DOCK_MIN_RESTORED_WIDTH = 240
const DOCK_MIN_RESTORED_HEIGHT = 72
const DOCK_BOTTOM_MARGIN = 72
const GLOBAL_ICON_WIDGET_TYPES = ['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive', 'desktop-icons-dock']
const MAX_DESKTOP_SCENE_SNAPSHOTS = 20
/** Built-in sticky notes moved to the separate LavaNotes app; old records are backed up, not loaded. */
const LEGACY_STICKY_NOTE_TYPE = 'todo-board'
const DEFAULT_DOCK_CONFIG: Record<string, unknown> = {
  items: [],
  dockStyle: 'glass',
  dockTint: '#ffffff',
  dockTintStrength: 0.1,
  dockOpacity: 0.18,
  dockBlur: 16,
  dockReflection: false,
  dockHoverScale: 1.72,
}

function canAddMultipleWidgetType(type: string): boolean {
  return ['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive', 'generated-widget'].includes(type)
}

function isGlobalIconWidgetType(type: string): boolean {
  return GLOBAL_ICON_WIDGET_TYPES.includes(type)
}

function withDefaultWidgetConfig(widget: WidgetInstance): WidgetInstance {
  if (widget.type !== 'desktop-icons-dock') return widget
  const config = widget.config ?? {}
  const widthInvalid = typeof widget.width !== 'number' || !Number.isFinite(widget.width) || widget.width < DOCK_MIN_RESTORED_WIDTH
  const heightInvalid = typeof widget.height !== 'number' || !Number.isFinite(widget.height) || widget.height < DOCK_MIN_RESTORED_HEIGHT
  const positionInvalid = typeof widget.x !== 'number' || !Number.isFinite(widget.x) || typeof widget.y !== 'number' || !Number.isFinite(widget.y)
  const width = widthInvalid ? DOCK_DEFAULT_WIDTH : widget.width
  const height = heightInvalid ? DOCK_DEFAULT_HEIGHT : widget.height
  const fallbackPlacement = widthInvalid || heightInvalid || positionInvalid ? getDockPlacement(width, height, widget) : null
  return {
    ...widget,
    x: fallbackPlacement?.x ?? widget.x,
    y: fallbackPlacement?.y ?? widget.y,
    width,
    height,
    config: {
      ...DEFAULT_DOCK_CONFIG,
      ...config,
      items: Array.isArray(config.items) ? config.items : [],
    },
  }
}

function withDefaultWidgetConfigs(widgets: WidgetInstance[]): WidgetInstance[] {
  return normalizeWidgetStackOrder(widgets.filter((widget) => !isRetiredWidgetType(widget.type)).map(withDefaultWidgetConfig))
}

function getWallpaperScopedWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.filter((widget) => !isGlobalIconWidgetType(widget.type))
}

function getIconWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.filter((widget) => isGlobalIconWidgetType(widget.type))
}

function readStoredGlobalIconWidgets(): WidgetInstance[] | undefined {
  const stored = store.get('globalIconWidgets')
  return stored === undefined ? undefined : parseStoredWidgets(stored)
}

function hasConfigKey(config: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(config, key)
}

function normalizeDesktopIconItems(items: DesktopIconItem[]): DesktopIconItem[] {
  return items.map((item, index) => ({ ...item, order: index, x: undefined, y: undefined }))
}

function mergeDesktopIconItemsForConfig(
  currentWidget: WidgetInstance,
  incomingConfig: Record<string, unknown>
): DesktopIconItem[] {
  const incomingItems = getDesktopIconItems({ ...currentWidget, config: { items: incomingConfig.items } })
  const incomingIds = new Set(incomingItems.map((item) => item.id))
  const retainedItems = getDesktopIconItems(currentWidget).filter((item) => !incomingIds.has(item.id))
  return normalizeDesktopIconItems([...incomingItems, ...retainedItems])
}

function mergeConfigUpdate(currentWidget: WidgetInstance, incomingConfig: Record<string, unknown>): Record<string, unknown> {
  const nextConfig = { ...(currentWidget.config ?? {}), ...incomingConfig }
  if (!isGlobalIconWidgetType(currentWidget.type) || !hasConfigKey(incomingConfig, 'items')) return nextConfig
  return {
    ...nextConfig,
    items: mergeDesktopIconItemsForConfig(currentWidget, incomingConfig),
  }
}

function mergeWidgetUpdate(currentWidget: WidgetInstance, incomingWidget: WidgetInstance): WidgetInstance {
  const nextWidget = {
    ...currentWidget,
    ...incomingWidget,
    // Position/config updates from a stale renderer must not undo a newer
    // explicit stacking action.
    stackOrder: currentWidget.stackOrder ?? incomingWidget.stackOrder,
  }
  if (!isGlobalIconWidgetType(currentWidget.type) && !isGlobalIconWidgetType(incomingWidget.type)) return nextWidget

  const incomingConfig = incomingWidget.config ?? {}
  const nextConfig = { ...(currentWidget.config ?? {}), ...incomingConfig }
  const hasCurrentItems = hasConfigKey(currentWidget.config ?? {}, 'items')
  const items = hasCurrentItems
    ? getDesktopIconItems(currentWidget)
    : getDesktopIconItems({ ...currentWidget, config: incomingConfig })

  return {
    ...nextWidget,
    config: {
      ...nextConfig,
      items: normalizeDesktopIconItems(items),
    },
  }
}

interface LoadedWidgetConfig {
  widgets: WidgetInstance[]
  coordinateSpace?: string
  builtinDefault: boolean
}

async function readWidgetConfigFile(configPath: string, builtinDefault = false): Promise<LoadedWidgetConfig> {
  const txt = await fs.readFile(configPath, 'utf-8')
  const data = JSON.parse(txt) as { widgets?: unknown; coordinateSpace?: unknown }
  return {
    widgets: parseStoredWidgets(data.widgets),
    coordinateSpace: typeof data.coordinateSpace === 'string' ? data.coordinateSpace : undefined,
    builtinDefault,
  }
}

async function tryReadWidgetConfigFile(configPath: string, builtinDefault = false): Promise<LoadedWidgetConfig | null> {
  try {
    return await readWidgetConfigFile(configPath, builtinDefault)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function getWallpaperDefaultWidgetConfigPath(wallpaperId: string): string {
  if (isUserWallpaperId(wallpaperId)) {
    return join(getUserWallpapersRoot(), getUserWallpaperFolderName(wallpaperId), 'widget-config.json')
  }
  if (isRemoteWallpaperId(wallpaperId)) {
    return join(getRemoteWallpapersRoot(), getRemoteWallpaperFolderName(wallpaperId), 'widget-config.json')
  }
  return join(getWallpaperRoot(), wallpaperId, 'widget-config.json')
}

async function readWallpaperWidgetConfig(wallpaperId: string): Promise<LoadedWidgetConfig> {
  const override = await tryReadWidgetConfigFile(getWallpaperWidgetOverridePath(wallpaperId))
  if (override) return override
  return await tryReadWidgetConfigFile(getWallpaperDefaultWidgetConfigPath(wallpaperId), true)
    ?? { widgets: [], builtinDefault: true }
}

async function writeWallpaperWidgetOverride(wallpaperId: string, widgets: WidgetInstance[]): Promise<void> {
  const configPath = getWallpaperWidgetOverridePath(wallpaperId)
  await writeJsonAtomic(configPath, {
    coordinateSpace: WIDGET_DISPLAY_COORDINATE_SPACE,
    widgets,
  })
}

function resolveGlobalIconWidgets(wallpaperWidgets: WidgetInstance[]): WidgetInstance[] {
  const storedGlobal = readStoredGlobalIconWidgets()
  if (storedGlobal) return storedGlobal

  const legacyRuntimeIcons = getIconWidgets(parseStoredWidgets(store.get('widgets')))
  return legacyRuntimeIcons.length > 0 ? legacyRuntimeIcons : getIconWidgets(wallpaperWidgets)
}

/**
 * Keep one copy of the retired built-in sticky notes of a namespace before the
 * widget list stops carrying them. The notes are not migrated into LavaNotes.
 */
async function backupLegacyStickyNotes(namespace: string, widgets: readonly WidgetInstance[]): Promise<void> {
  const seen = new Set<string>()
  const notes = widgets.filter((widget) => {
    if (widget.type !== LEGACY_STICKY_NOTE_TYPE || seen.has(widget.id)) return false
    seen.add(widget.id)
    return true
  })
  if (notes.length === 0) return
  const target = join(app.getPath('userData'), 'legacy-sticky-notes', `${stableUserDataSegment(namespace, 'desktop')}.json`)
  const exists = await fs.access(target).then(() => true, () => false)
  if (!exists) await writeJsonAtomic(target, { savedAt: new Date().toISOString(), namespace, widgets: notes })
}

let namespaceLoad: Promise<unknown> = Promise.resolve()

export function loadWidgetsForWallpaper(wallpaperId?: string): Promise<WidgetInstance[]> {
  const result = namespaceLoad.catch(() => undefined).then(() => loadWidgetNamespace(wallpaperId))
  namespaceLoad = result
  return result
}

async function loadWidgetNamespace(wallpaperId?: string): Promise<WidgetInstance[]> {
  parseStoredWidgets(store.get('widgets'))
  // The active namespace is already authoritative. Do not reread an older disk
  // snapshot while new edits may be arriving (including a repeated startup restore).
  if (widgetNamespaceInitialized && wallpaperId === widgetWallpaperId) {
    await flushPendingWidgetSave()
    syncToCanvas()
    return parseStoredWidgets(store.get('widgets'))
  }
  const wallpaperConfig: LoadedWidgetConfig = wallpaperId
    ? await readWallpaperWidgetConfig(wallpaperId)
    : await tryReadWidgetConfigFile(getWallpaperWidgetOverridePath(UNASSIGNED_WIDGET_NAMESPACE))
      ?? { widgets: widgetNamespaceInitialized ? [] : parseStoredWidgets(store.get('widgets')), builtinDefault: false, coordinateSpace: WIDGET_DISPLAY_COORDINATE_SPACE }
  // Resolve the next configuration first. A corrupt file must not discard the
  // current desktop. Drain edits made while the next file was being read.
  if (widgetNamespaceInitialized) await flushPendingWidgetSave()
  const legacySources = widgetNamespaceInitialized
    ? wallpaperConfig.widgets
    : [...wallpaperConfig.widgets, ...parseStoredWidgets(store.get('widgets'))]
  await backupLegacyStickyNotes(wallpaperId ?? UNASSIGNED_WIDGET_NAMESPACE, legacySources)
    .catch((error) => console.error('[widget] legacy sticky note backup failed:', error))

  const displays = getDisplayDescriptors()
  const primary = displays.find((display) => display.primary) ?? displays[0]
  const legacyOrigin = store.get('widgetCoordinateOrigin') ?? primary?.bounds ?? { x: 0, y: 0 }
  const wallpaperWidgets = wallpaperConfig.widgets.map((widget) => migrateLegacyWidgetToDisplay(
    widget,
    legacyOrigin,
    displays,
    wallpaperConfig.builtinDefault || wallpaperConfig.coordinateSpace === WIDGET_DISPLAY_COORDINATE_SPACE,
  ))
  const globalWidgets = resolveGlobalIconWidgets(wallpaperConfig.widgets).map((widget) => migrateLegacyWidgetToDisplay(
    widget,
    legacyOrigin,
    displays,
  ))
  const merged = withDefaultWidgetConfigs([...getWallpaperScopedWidgets(wallpaperWidgets), ...globalWidgets])
  persistWidgets(merged, true)
  widgetWallpaperId = wallpaperId
  widgetNamespaceInitialized = true
  const render = getDesktopRenderBounds()
  store.set('widgetCoordinateOrigin', { x: render.x, y: render.y })
  syncToCanvas()
  return merged
}

/** Migrate legacy canvas coordinates once; display-local positions need no mode translation. */
export function ensureWidgetCoordinateOrigin(): void {
  const current = getDesktopRenderBounds()
  const displays = getDisplayDescriptors()
  const primary = displays.find((display) => display.primary) ?? displays[0]
  const previous = store.get('widgetCoordinateOrigin') ?? primary?.bounds ?? { x: 0, y: 0 }
  const widgets = store.get('widgets').map((widget) => migrateLegacyWidgetToDisplay(widget, previous, displays))
  persistWidgets(widgets)
  store.set('widgetCoordinateOrigin', { x: current.x, y: current.y })
  syncToCanvas()
}

/** 根据 workArea 和已有组件，自动计算不重叠的放置位置 */
function getPrimaryDisplay(): DisplayDescriptor | undefined {
  const displays = getDisplayDescriptors()
  return displays.find((display) => display.primary) ?? displays[0]
}

function bindWidgetToPrimary(widget: WidgetInstance): WidgetInstance {
  const primary = getPrimaryDisplay()
  if (!primary) return widget
  return {
    ...widget,
    displayId: primary.id,
    displayKey: primary.key,
  }
}

function getDisplayLocalWorkArea(display: DisplayDescriptor): DisplayBounds {
  return {
    x: display.workArea.x - display.bounds.x,
    y: display.workArea.y - display.bounds.y,
    width: display.workArea.width,
    height: display.workArea.height,
  }
}

function getWidgetsForDisplay(existing: WidgetInstance[], display: DisplayDescriptor): WidgetInstance[] {
  return existing.filter((widget) => (
    widget.displayKey === display.key ||
    (!widget.displayKey && widget.displayId === display.id) ||
    (!widget.displayKey && widget.displayId === undefined && display.primary)
  ))
}

function findPlacement(
  w: number,
  h: number,
  existing: WidgetInstance[]
): { x: number; y: number } {
  const primary = getPrimaryDisplay()
  if (!primary) return { x: EDGE_PADDING, y: EDGE_PADDING }
  return findSmartWidgetPlacement(w, h, getWidgetsForDisplay(existing, primary), getDisplayLocalWorkArea(primary), {
    gap: GRID_GAP,
    edgePadding: EDGE_PADDING,
    grid: GRID_GAP,
  })
}

function getDockPlacement(width: number, height: number, widget?: WidgetInstance): { x: number; y: number } {
  const displays = getDisplayDescriptors()
  const display = widget ? resolveWidgetDisplay(widget, displays) : undefined
  const target = display ?? displays.find((candidate) => candidate.primary) ?? displays[0]
  const area = target?.bounds ?? { x: 0, y: 0, width: 1, height: 1 }
  const maxX = area.width - EDGE_PADDING - width
  const maxY = area.height - BOTTOM_EDGE_PADDING - height
  return {
    x: Math.max(EDGE_PADDING, Math.min(Math.round((area.width - width) / 2), Math.max(EDGE_PADDING, maxX))),
    y: Math.max(EDGE_PADDING, Math.min(Math.round(area.height - height - DOCK_BOTTOM_MARGIN), Math.max(EDGE_PADDING, maxY))),
  }
}

/** 将坐标对齐到网格 */
export function snapToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x / GRID_GAP) * GRID_GAP,
    y: Math.round(y / GRID_GAP) * GRID_GAP,
  }
}

/**
 * 综合处理：网格吸附 → 屏幕边界约束 → 重叠自动避让。
 * 返回离期望位置最近的、不与其他组件重叠的合法坐标。
 */
function resolvePosition(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  allWidgets: WidgetInstance[],
  snapPosition = true,
  area: DisplayBounds = { x: 0, y: 0, width: getDesktopRenderBounds().width, height: getDesktopRenderBounds().height },
): { x: number; y: number } {
  // 1. 网格吸附
  let sx = snapPosition ? Math.round(x / GRID_GAP) * GRID_GAP : x
  let sy = snapPosition ? Math.round(y / GRID_GAP) * GRID_GAP : y

  // 2. 屏幕边界约束
  const minX = area.x + EDGE_PADDING
  const minY = area.y + EDGE_PADDING
  const maxX = area.x + area.width - EDGE_PADDING - w
  const maxY = area.y + area.height - BOTTOM_EDGE_PADDING - h
  sx = Math.max(minX, Math.min(sx, Math.max(minX, maxX)))
  sy = Math.max(minY, Math.min(sy, Math.max(minY, maxY)))

  // 3. 检测重叠（排除自身，保留 GRID_GAP 间距）
  const others = allWidgets.filter((e) => e.id !== id && e.enabled)
  const hasOverlap = (px: number, py: number): boolean =>
    others.some(
      (e) =>
        px < e.x + e.width + GRID_GAP &&
        px + w + GRID_GAP > e.x &&
        py < e.y + e.height + GRID_GAP &&
        py + h + GRID_GAP > e.y
    )

  if (!hasOverlap(sx, sy)) return { x: sx, y: sy }

  // 4. 螺旋搜索：从期望位置向外扩展，找最近的空位
  const maxRadius = Math.max(area.width, area.height)
  for (let r = GRID_GAP; r <= maxRadius; r += GRID_GAP) {
    for (let dy = -r; dy <= r; dy += GRID_GAP) {
      for (let dx = -r; dx <= r; dx += GRID_GAP) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue // 只查外圈
        const cx = sx + dx
        const cy = sy + dy
        if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue
        if (!hasOverlap(cx, cy)) return { x: cx, y: cy }
      }
    }
  }

  return { x: sx, y: sy }
}

function syncToCanvas(): void {
  const list = store.get('widgets').filter((widget) => !isRetiredWidgetType(widget.type))
  const win = getCanvasWindow()
  if (!win || win.webContents.isDestroyed()) return
  const displays = getDisplayDescriptors()
  const render = getDesktopRenderBounds()
  const materialized = materializeWidgetsForCanvas(list, displays, render, getWallpaperDisplayMode())
  win.webContents.send(IPC.WIDGET_SYNC, materialized)
}

function getMaterializedWidgets(widgets: readonly WidgetInstance[]): WidgetInstance[] {
  const displays = getDisplayDescriptors()
  return materializeWidgetsForCanvas(
    widgets,
    displays,
    getDesktopRenderBounds(),
    getWallpaperDisplayMode(),
  )
}

function normalizeCanvasWidgetUpdate(incoming: WidgetInstance, stored: WidgetInstance[]): WidgetInstance {
  const displays = getDisplayDescriptors()
  const render = getDesktopRenderBounds()
  const mode = getWallpaperDisplayMode()
  const preliminary = persistWidgetFromCanvas(incoming, displays, render, mode)
  const targetDisplay = resolveWidgetDisplay(preliminary, displays)
    ?? displays.find((display) => display.primary)
    ?? displays[0]
  if (!targetDisplay) return incoming
  const displayArea = getDisplayCanvasBounds(targetDisplay, render)
  const canvasWidgets = materializeWidgetsForCanvas(stored, displays, render, mode)
  const resolved = resolvePosition(
    incoming.id,
    incoming.x,
    incoming.y,
    incoming.width,
    incoming.height,
    canvasWidgets,
    !canAddMultipleWidgetType(incoming.type),
    displayArea,
  )
  return persistWidgetFromCanvas({ ...incoming, ...resolved }, displays, render, mode)
}

export function showDesktopScenePreviewForTool(plan: DesktopSceneLayoutPlan): void {
  const win = getCanvasWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.DESKTOP_SCENE_PREVIEW_SHOW, plan)
}

export function clearDesktopScenePreviewForTool(): void {
  const win = getCanvasWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.DESKTOP_SCENE_PREVIEW_CLEAR)
}

function cloneWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return JSON.parse(JSON.stringify(widgets)) as WidgetInstance[]
}

function readDesktopSceneSnapshots(): DesktopSceneSnapshot[] {
  const snapshots = store.get('desktopSceneSnapshots')
  if (!Array.isArray(snapshots)) return []
  return snapshots
    .filter((snapshot): snapshot is DesktopSceneSnapshot => Boolean(snapshot && typeof snapshot.id === 'string'))
    .sort((left, right) => right.createdAt - left.createdAt)
}

function persistDesktopSceneSnapshots(snapshots: DesktopSceneSnapshot[]): void {
  store.set('desktopSceneSnapshots', snapshots.slice(0, MAX_DESKTOP_SCENE_SNAPSHOTS))
}

function createDesktopSceneSnapshot(params: {
  reason: string
  beforeWidgets: WidgetInstance[]
  afterWidgets?: WidgetInstance[]
}): DesktopSceneSnapshot {
  const currentWallpaper = store.get('wallpaper')?.current
  return {
    id: `scene-${Date.now()}-${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    wallpaperId: currentWallpaper?.id ?? '',
    reason: params.reason,
    source: 'ai-scene',
    beforeWidgets: cloneWidgets(params.beforeWidgets),
    afterWidgets: params.afterWidgets ? cloneWidgets(params.afterWidgets) : undefined,
    beforeWallpaperSettings: currentWallpaper?.settings,
    afterWallpaperSettings: currentWallpaper?.settings,
  }
}

function applyLayoutPatch(widget: WidgetInstance, layout: LayoutPatch): WidgetInstance {
  return {
    ...widget,
    x: typeof layout.x === 'number' ? layout.x : widget.x,
    y: typeof layout.y === 'number' ? layout.y : widget.y,
    width: typeof layout.width === 'number' ? layout.width : widget.width,
    height: typeof layout.height === 'number' ? layout.height : widget.height,
    config: typeof layout.opacity === 'number'
      ? { ...(widget.config ?? {}), opacity: layout.opacity }
      : widget.config,
  }
}

function createWidgetFromScenePatch(patch: Extract<WidgetPatch, { op: 'create' }>): WidgetInstance {
  const size = DEFAULT_WIDGET_SIZE_BY_TYPE[patch.type]
  return bindWidgetToPrimary(withDefaultWidgetConfig({
    id: `${patch.type}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    type: patch.type,
    x: typeof patch.layout.x === 'number' ? patch.layout.x : 0,
    y: typeof patch.layout.y === 'number' ? patch.layout.y : 0,
    width: typeof patch.layout.width === 'number' ? patch.layout.width : size.width,
    height: typeof patch.layout.height === 'number' ? patch.layout.height : size.height,
    enabled: true,
    config: patch.config ?? {},
  }))
}

function summarizeScenePatch(patch: WidgetPatch): string {
  if (patch.op === 'create') return `create:${patch.type}`
  if ('id' in patch) return `${patch.op}:${patch.id}`
  return 'patch'
}

export function applyDesktopScenePlanForTool(params: {
  plan: DesktopSceneLayoutPlan
  reason?: string
}): {
  ok: boolean
  snapshot?: DesktopSceneSnapshot
  widgets: WidgetInstance[]
  appliedPatches: string[]
  skippedPatches: string[]
  error?: string
} {
  const before = withDefaultWidgetConfigs(store.get('widgets'))
  let next = cloneWidgets(before)
  const appliedPatches: string[] = []
  const skippedPatches: string[] = []

  for (const patch of params.plan.widgetPatches) {
    if (patch.op === 'create') {
      const existing = !canAddMultipleWidgetType(patch.type)
        ? next.find((widget) => widget.type === patch.type)
        : undefined
      if (existing) {
        next = next.map((widget) => (
          widget.id === existing.id
            ? {
                ...applyLayoutPatch(widget, patch.layout),
                config: mergeConfigUpdate(widget, patch.config ?? {}),
                enabled: true,
              }
            : widget
        ))
        appliedPatches.push(`restore-existing:${existing.id}`)
      } else {
        next.push(createWidgetFromScenePatch(patch))
        appliedPatches.push(summarizeScenePatch(patch))
      }
      continue
    }

    if (patch.op === 'update-layout') {
      const target = next.find((widget) => widget.id === patch.id)
      if (!target) {
        skippedPatches.push(`${summarizeScenePatch(patch)}:missing`)
        continue
      }
      next = next.map((widget) => widget.id === patch.id ? applyLayoutPatch(widget, patch.layout) : widget)
      appliedPatches.push(summarizeScenePatch(patch))
      continue
    }

    if (patch.op === 'update-config') {
      const target = next.find((widget) => widget.id === patch.id)
      if (!target) {
        skippedPatches.push(`${summarizeScenePatch(patch)}:missing`)
        continue
      }
      next = next.map((widget) => (
        widget.id === patch.id
          ? { ...widget, config: mergeConfigUpdate(widget, patch.config) }
          : widget
      ))
      appliedPatches.push(summarizeScenePatch(patch))
      continue
    }

    if (patch.op === 'hide') {
      const target = next.find((widget) => widget.id === patch.id)
      const capability = target ? getWidgetCapability(target.type) : null
      if (!target) {
        skippedPatches.push(`${summarizeScenePatch(patch)}:missing`)
        continue
      }
      if (capability?.persistent) {
        skippedPatches.push(`${summarizeScenePatch(patch)}:persistent-protected`)
        continue
      }
      next = next.map((widget) => widget.id === patch.id ? { ...widget, enabled: false } : widget)
      appliedPatches.push(summarizeScenePatch(patch))
      continue
    }

    if (patch.op === 'restore') {
      const target = next.find((widget) => widget.id === patch.id)
      if (!target) {
        skippedPatches.push(`${summarizeScenePatch(patch)}:missing`)
        continue
      }
      next = next.map((widget) => widget.id === patch.id ? { ...widget, enabled: true } : widget)
      appliedPatches.push(summarizeScenePatch(patch))
      continue
    }

    skippedPatches.push(`${summarizeScenePatch(patch)}:unsupported`)
  }

  const snapshot = createDesktopSceneSnapshot({
    reason: params.reason ?? params.plan.sceneName,
    beforeWidgets: before,
    afterWidgets: next,
  })
  persistWidgets(next)
  persistDesktopSceneSnapshots([snapshot, ...readDesktopSceneSnapshots().filter((item) => item.id !== snapshot.id)])
  syncToCanvas()
  autoSaveToWallpaper()
  clearDesktopScenePreviewForTool()
  if (!isCanvasEditMode()) setCanvasMousePassthrough(true)

  return { ok: true, snapshot, widgets: next, appliedPatches, skippedPatches }
}

export function rollbackDesktopSceneForTool(snapshotId?: string): {
  ok: boolean
  snapshot?: DesktopSceneSnapshot
  widgets: WidgetInstance[]
  error?: string
} {
  const snapshots = readDesktopSceneSnapshots()
  const snapshot = snapshotId
    ? snapshots.find((item) => item.id === snapshotId)
    : snapshots[0]
  if (!snapshot) {
    return { ok: false, widgets: store.get('widgets'), error: 'snapshot-not-found' }
  }

  const restored = withDefaultWidgetConfigs(cloneWidgets(snapshot.beforeWidgets))
  persistWidgets(restored)
  syncToCanvas()
  autoSaveToWallpaper()
  clearDesktopScenePreviewForTool()
  if (!isCanvasEditMode()) setCanvasMousePassthrough(true)
  return { ok: true, snapshot, widgets: restored }
}

function getWallpaperRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'assets', 'wallpaper')
  }
  return join(__dirname, '../../assets/wallpaper')
}

const UNASSIGNED_WIDGET_NAMESPACE = 'workspace:unassigned'
let widgetWallpaperId: string | undefined
let widgetNamespaceInitialized = false
const widgetWriter = createDebouncedWriter(
  (entry: { wallpaperId: string; widgets: WidgetInstance[] }) => writeWallpaperWidgetOverride(entry.wallpaperId, entry.widgets),
  (error) => console.error('[widget] autosave failed; pending data retained:', error),
)

function autoSaveToWallpaper(): void {
  const wallpaperId = (widgetNamespaceInitialized ? widgetWallpaperId : store.get('wallpaper')?.current?.id)
    ?? UNASSIGNED_WIDGET_NAMESPACE
  widgetWriter.schedule({ wallpaperId, widgets: structuredClone(getWallpaperScopedWidgets(parseStoredWidgets(store.get('widgets')))) })
}

export async function flushPendingWidgetSave(): Promise<void> {
  autoSaveToWallpaper()
  await widgetWriter.flush()
}

async function removeWidgetWithRestore(id: string): Promise<{ list: WidgetInstance[]; deleted: boolean }> {
  return withDesktopIconOperation(id, async () => {
    const target = store.get('widgets').find((widget) => widget.id === id)
    if (!target) return { list: store.get('widgets'), deleted: false }

    const restoreResult = await restoreDesktopIconsForWidget(target)
    const current = store.get('widgets').find((widget) => widget.id === id)
    const restoredIds = new Set(restoreResult.restoredItemIds ?? [])
    const remainingItems = current ? getDesktopIconItems(current).filter((item) => !restoredIds.has(item.id)) : []
    const hasManagedItems = remainingItems.some((item) => item.removedFromDesktop)
    if (current && (!restoreResult.ok || hasManagedItems)) {
      const retained = { ...current, config: { ...(current.config ?? {}), items: remainingItems } }
      const updated = store.get('widgets').map((widget) => widget.id === id ? retained : widget)
      persistWidgets(updated)
      syncToCanvas()
      autoSaveToWallpaper()
      await dialog.showMessageBox({ type: 'warning', message: '部分桌面文件未能恢复，已保留组件及文件记录。', detail: restoreResult.skipped.join('\n'), buttons: ['保留并稍后重试'] })
      return { list: updated, deleted: false }
    }

    const list = store.get('widgets').filter((widget) => widget.id !== id)
    persistWidgets(list)
    syncToCanvas()
    autoSaveToWallpaper()
    return { list, deleted: true }
  })
}

export function registerWidgetIpc(): void {
  let quitAfterFlush = false
  let quitFlushInProgress = false
  app.on('before-quit', (event) => {
    if (quitAfterFlush || !widgetNamespaceInitialized) return
    event.preventDefault()
    if (quitFlushInProgress) return
    quitFlushInProgress = true
    void flushPendingWidgetSave().then(() => { quitAfterFlush = true; app.quit() }).catch((error) => {
      quitFlushInProgress = false
      console.error('[widget] quit save failed:', error)
      dialog.showErrorBox('组件配置保存失败', '原数据和待保存修改已保留，请检查磁盘空间或权限后重试退出。')
    })
  })
  ipcMain.handle(IPC.WIDGET_LIST, (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    const list = withDefaultWidgetConfigs(parseStoredWidgets(store.get('widgets')))
    return event.sender.id === getCanvasWindow()?.webContents.id ? getMaterializedWidgets(list) : list
  })

  ipcMain.handle(IPC.WIDGET_ADD, (_e, w: WidgetInstance) => {
    assertTrustedIpcSender(_e, ['main'])
    w = widgetInstanceSchema.parse(w)
    if (isRetiredWidgetType(w.type)) throw new Error('便利贴已移到独立的 LavaNotes')
    const list = store.get('widgets')
    // Most widget types are single-instance; icon storage containers can have multiple copies.
    if (!canAddMultipleWidgetType(w.type) && list.some((existing) => existing.type === w.type)) {
      return list
    }
    const widget = bindWidgetToPrimary(withDefaultWidgetConfig(w))
    const placement = widget.type === 'desktop-icons-dock'
      ? getDockPlacement(widget.width, widget.height)
      : findPlacement(widget.width, widget.height, list)
    widget.x = placement.x
    widget.y = placement.y
    list.push(widget)
    persistWidgets(list)
    syncToCanvas()
    autoSaveToWallpaper()
    if (!isCanvasEditMode()) setCanvasMousePassthrough(true)
    return list
  })

  ipcMain.handle(IPC.WIDGET_REMOVE, async (_e, id: string) => {
    assertTrustedIpcSender(_e, ['main', 'canvas'])
    id = z.string().min(1).max(160).parse(id)
    const { list } = await removeWidgetWithRestore(id)
    return list
  })

  ipcMain.handle(IPC.WIDGET_UPDATE, (_e, w: WidgetInstance) => {
    assertTrustedIpcSender(_e, ['main', 'canvas'])
    w = storedWidgetSchema.parse(w)
    const list = store.get('widgets')
    if (_e.sender.id === getCanvasWindow()?.webContents.id) {
      w = normalizeCanvasWidgetUpdate(w, list)
    } else if (!w.displayKey) {
      w = bindWidgetToPrimary(w)
    }
    // Late renderer updates after removal/switching must not recreate a widget.
    if (!list.some((widget) => widget.id === w.id)) return list
    const updated = list.map((it) => (it.id === w.id ? mergeWidgetUpdate(it, w) : it))
    persistWidgets(updated)
    syncToCanvas()
    autoSaveToWallpaper()
    return updated
  })

  // 仅更新组件 config，不触发位置吸附
  ipcMain.handle(IPC.WIDGET_UPDATE_CONFIG, (_e, id: string, config: Record<string, unknown>) => {
    assertTrustedIpcSender(_e, ['main', 'canvas'])
    id = z.string().min(1).max(160).parse(id)
    config = widgetConfigSchema.parse(config)
    const list = store.get('widgets')
    const updated = list.map((it) => (it.id === id ? { ...it, config: mergeConfigUpdate(it, config) } : it))
    persistWidgets(updated)
    syncToCanvas()
    autoSaveToWallpaper()
    return updated
  })

  // 画布鼠标穿透切换
  ipcMain.on(IPC.CANVAS_SET_IGNORE_MOUSE, (_e, ignore: boolean) => {
    assertTrustedIpcSender(_e, ['canvas'])
    if (typeof ignore !== 'boolean') return
    setCanvasMousePassthrough(ignore)
  })

  ipcMain.on(IPC.CANVAS_SET_POINTER_ACTIVE, (_e, active: boolean) => {
    assertTrustedIpcSender(_e, ['canvas'])
    if (typeof active !== 'boolean') return
    setCanvasPointerActive(active)
  })

  ipcMain.on(IPC.CANVAS_SET_HIT_REGIONS, (_e, regions: unknown) => {
    assertTrustedIpcSender(_e, ['canvas'])
    const sanitized = sanitizeCanvasHitRegions(regions)
    if (sanitized) setCanvasHitRegions(_e.sender.id, sanitized)
  })

  ipcMain.on(IPC.CANVAS_DIAGNOSTIC, (_e, event: string, details: Record<string, unknown>) => {
    assertTrustedIpcSender(_e, ['canvas'])
    if (typeof event !== 'string' || event.length === 0 || event.length > 100) return
    const safeDetails = details && typeof details === 'object' ? details : {}
    try {
      if (JSON.stringify(safeDetails).length > 4_096) return
    } catch {
      return
    }
    if (
      event === 'dock-icon-pointer-down' ||
      (event === 'pointer-down-observed' && safeDetails.action === true)
    ) {
      noteCanvasRendererActionPointerDown()
    }
    logDockDiagnostic(`renderer.${event}`, safeDetails)
  })

  // 原生右键菜单（避免 setIgnoreMouseEvents 冲突）
  ipcMain.handle(IPC.CANVAS_CONTEXT_MENU, (_e, widgetId: string) => {
    assertTrustedIpcSender(_e, ['canvas'])
    widgetId = z.string().min(1).max(160).parse(widgetId)
    const win = getCanvasWindow()
    if (!win) return null

    return new Promise<'edit' | 'delete' | null>((resolve) => {
      let resolved = false
      const menu = Menu.buildFromTemplate([
        {
          label: '全局编辑',
          click: () => { resolved = true; resolve('edit') },
        },
        { type: 'separator' },
        {
          label: '删除',
          click: async () => {
            resolved = true
            const { deleted } = await removeWidgetWithRestore(widgetId)
            if (deleted && !isCanvasEditMode()) setCanvasMousePassthrough(true)
            resolve(deleted ? 'delete' : null)
          },
        },
      ])
      menu.popup({
        window: win,
        callback: () => { if (!resolved) resolve(null) },
      })
    })
  })

  // 编辑模式：z-order + 穿透 + 焦点统一切换
  ipcMain.on(IPC.CANVAS_SET_EDIT_MODE, (_e, on: boolean) => {
    assertTrustedIpcSender(_e, ['canvas'])
    if (typeof on !== 'boolean') return
    setCanvasEditMode(on)
  })

  // 保存组件配置到用户数据覆盖层
  ipcMain.handle(IPC.WIDGET_CONFIG_SAVE, async (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    try {
      await flushPendingWidgetSave()
      return true
    } catch (e) {
      console.error('[widget] config save failed:', e)
      return false
    }
  })

  // 加载壁纸文件夹中的组件配置
  ipcMain.handle(IPC.WIDGET_CONFIG_LOAD, async (_e, wallpaperId: string) => {
    assertTrustedIpcSender(_e, ['main'])
    wallpaperId = z.string().min(1).max(160).parse(wallpaperId)
    try {
      await loadWidgetsForWallpaper(wallpaperId)
      return true
    } catch {
      return false
    }
  })
}

/**
 * 组件标准尺寸（仿 macOS 桌面组件规范）
 * 基础单元 160px，间距 16px
 */
export function listWidgetsForTool(): WidgetInstance[] {
  return withDefaultWidgetConfigs(parseStoredWidgets(store.get('widgets')))
}

export function addWidgetForTool(widget: WidgetInstance, options: { anchor?: WidgetAnchor } = {}): { ok: boolean; added: boolean; widget: WidgetInstance; list: WidgetInstance[]; reason?: string } {
  const list = store.get('widgets')
  const existing = !canAddMultipleWidgetType(widget.type)
    ? list.find((item) => item.type === widget.type)
    : undefined
  if (existing) {
    return { ok: true, added: false, widget: existing, list, reason: 'already-exists' }
  }

  const normalized = bindWidgetToPrimary(withDefaultWidgetConfig(widgetInstanceSchema.parse(widget)))
  const layoutSize = {
    width: normalized.width || FIT_CONTENT_LAYOUT_SIZE.width,
    height: normalized.height || FIT_CONTENT_LAYOUT_SIZE.height,
  }
  const placement = normalized.type === 'desktop-icons-dock'
    ? getDockPlacement(normalized.width, normalized.height)
    : options.anchor
      ? resolveAnchoredPosition(normalized, options.anchor, layoutSize, list)
    : findPlacement(normalized.width, normalized.height, list)
  normalized.x = placement.x
  normalized.y = placement.y
  list.push(normalized)
  persistWidgets(list)
  syncToCanvas()
  autoSaveToWallpaper()
  if (!isCanvasEditMode()) setCanvasMousePassthrough(true)
  return { ok: true, added: true, widget: normalized, list }
}

function findWidgetByIdOrType(params: { id?: string; type?: string }): WidgetInstance | undefined {
  const list = store.get('widgets')
  if (params.id) return list.find((item) => item.id === params.id)
  if (params.type) return list.find((item) => item.type === params.type)
  return undefined
}

export function updateWidgetConfigForTool(params: { id?: string; type?: string; config: Record<string, unknown> }): { ok: boolean; widget?: WidgetInstance; list: WidgetInstance[]; error?: string } {
  const list = store.get('widgets')
  const target = findWidgetByIdOrType(params)
  if (!target) return { ok: false, list, error: 'widget-not-found' }

  const updated = list.map((item) => (
    item.id === target.id
      ? { ...item, config: mergeConfigUpdate(item, params.config) }
      : item
  ))
  persistWidgets(updated)
  syncToCanvas()
  autoSaveToWallpaper()
  return { ok: true, widget: updated.find((item) => item.id === target.id), list: updated }
}

/** Fit-content widgets (clocks, weather, text) have no stored size until the user resizes them. */
const FIT_CONTENT_LAYOUT_SIZE = { width: 240, height: 120 }
/** Card widgets are reset to their grid size on startup (WIDGET_SIZE_MAP); icon containers snap to icon cells. */
const FIXED_SIZE_WIDGET_TYPES = new Set([
  'stocks', 'news', 'calendar', 'quicktools', 'pet', 'sysmonitor',
  ...GLOBAL_ICON_WIDGET_TYPES,
])
/** Scaled around their natural content size by the canvas; only a scale factor is meaningful. */
const NATURAL_SIZE_WIDGET_TYPES = new Set(['clock', 'elegantclock', 'pixelclock', 'graphicdatetime', 'weather', 'whitenoise', 'text'])

interface WidgetDisplayContext {
  display: DisplayDescriptor
  /** Display-local work area (excludes the taskbar). */
  workArea: DisplayBounds
  /** Display-local full bounds. */
  bounds: DisplayBounds
}

/** The monitor a stored widget lives on, in the display-local space widgets are persisted in. */
function getWidgetDisplayContext(widget: WidgetInstance): WidgetDisplayContext | undefined {
  const displays = getDisplayDescriptors()
  const display = resolveWidgetDisplay(widget, displays) ?? displays.find((item) => item.primary) ?? displays[0]
  if (!display) return undefined
  return {
    display,
    workArea: getDisplayLocalWorkArea(display),
    bounds: { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height },
  }
}

/** Same clamping and overlap avoidance as a user drag, against the widgets on that monitor. */
function placeWidgetOnDisplay(
  widget: WidgetInstance,
  position: { x: number; y: number },
  size: { width: number; height: number },
  list: WidgetInstance[],
  context: WidgetDisplayContext,
): { x: number; y: number } {
  const neighbours = getWidgetsForDisplay(list, context.display).map((item) => (
    item.width > 0 && item.height > 0 ? item : { ...item, ...fitContentSize(item) }
  ))
  return resolvePosition(
    widget.id,
    position.x,
    position.y,
    size.width,
    size.height,
    neighbours,
    !canAddMultipleWidgetType(widget.type),
    context.workArea,
  )
}

function fitContentSize(widget: WidgetInstance): { width: number; height: number } {
  const rendered = getCanvasWidgetRenderedRect(widget.id)
  return {
    width: widget.width || rendered?.width || FIT_CONTENT_LAYOUT_SIZE.width,
    height: widget.height || rendered?.height || FIT_CONTENT_LAYOUT_SIZE.height,
  }
}

function resolveAnchoredPosition(
  widget: WidgetInstance,
  anchor: WidgetAnchor,
  size: { width: number; height: number },
  list: WidgetInstance[],
): { x: number; y: number } {
  const context = getWidgetDisplayContext(widget)
  if (!context) return { x: EDGE_PADDING, y: EDGE_PADDING }
  return placeWidgetOnDisplay(widget, positionAtAnchor(anchor, size, context.workArea), size, list, context)
}

export interface ArrangeWidgetParams {
  id?: string
  type?: string
  anchor?: WidgetAnchor
  /** Display-local coordinates of the widget's current monitor. */
  x?: number
  y?: number
  scale?: number
  width?: number
  height?: number
  visible?: boolean
  bringToFront?: boolean
}

/**
 * Move, resize, hide/restore or raise one widget for the AI companion. Every
 * change goes through the same display-aware clamping and overlap avoidance as
 * a user drag, and sizes stay within what each widget type can render well.
 */
export function arrangeWidgetForTool(params: ArrangeWidgetParams): {
  ok: boolean
  widget?: WidgetInstance
  list: WidgetInstance[]
  error?: string
  notes: string[]
} {
  let list = withDefaultWidgetConfigs(store.get('widgets'))
  const target = params.id
    ? list.find((item) => item.id === params.id)
    : params.type ? list.find((item) => item.type === params.type) : undefined
  if (!target) return { ok: false, list, error: 'widget-not-found', notes: [] }
  const capability = getWidgetCapability(target.type)
  const notes: string[] = []
  const next: WidgetInstance = { ...target }

  if (params.visible === false) {
    if (capability && !capability.canAutoHide) {
      return { ok: false, list, error: 'cannot-hide-persistent-widget', notes: ['Dock 与图标收纳是常驻入口，不能隐藏；可以调整透明度或位置。'] }
    }
    next.enabled = false
  } else if (params.visible === true) {
    next.enabled = true
  }

  const rendered = getCanvasWidgetRenderedRect(target.id)
  const wantsResize = params.scale !== undefined || params.width !== undefined || params.height !== undefined
  if (wantsResize) {
    if (FIXED_SIZE_WIDGET_TYPES.has(target.type)) {
      notes.push(`${capability?.displayName ?? target.type} 使用固定规格尺寸，未调整大小。`)
    } else if (NATURAL_SIZE_WIDGET_TYPES.has(target.type)) {
      const base = target.width > 0 && target.height > 0
        ? { width: target.width, height: target.height }
        : rendered
      if (!base) {
        notes.push('组件还没有渲染出尺寸，稍后再调整大小。')
      } else {
        const requestedScale = params.scale
          ?? (params.width !== undefined ? params.width / base.width : params.height !== undefined ? params.height / base.height : 1)
        const scale = Math.max(0.5, Math.min(3, requestedScale))
        next.width = Math.max(48, Math.min(1400, Math.round(base.width * scale)))
        next.height = Math.max(32, Math.min(900, Math.round(base.height * scale)))
        if (params.width !== undefined || params.height !== undefined) notes.push('该组件按内容等比缩放，已换算为统一缩放比例。')
      }
    } else {
      const minSize = capability?.minSize ?? { width: 80, height: 80 }
      const maxSize = capability?.maxSize ?? { width: 1200, height: 900 }
      const base = { width: target.width || rendered?.width || minSize.width, height: target.height || rendered?.height || minSize.height }
      const width = params.width ?? (params.scale ? base.width * params.scale : base.width)
      const height = params.height ?? (params.scale ? base.height * params.scale : base.height)
      next.width = Math.round(Math.max(minSize.width, Math.min(maxSize.width, width)))
      next.height = Math.round(Math.max(minSize.height, Math.min(maxSize.height, height)))
      if (next.width !== Math.round(width) || next.height !== Math.round(height)) {
        notes.push(`尺寸已限制在 ${minSize.width}×${minSize.height} 到 ${maxSize.width}×${maxSize.height} 之间。`)
      }
    }
  }

  const moved = params.anchor !== undefined || params.x !== undefined || params.y !== undefined
  if (moved || wantsResize) {
    const context = getWidgetDisplayContext(target)
    if (context) {
      const layoutSize = {
        width: next.width || rendered?.width || FIT_CONTENT_LAYOUT_SIZE.width,
        height: next.height || rendered?.height || FIT_CONTENT_LAYOUT_SIZE.height,
      }
      const desired = params.anchor
        ? positionAtAnchor(params.anchor, layoutSize, context.workArea)
        : { x: params.x ?? target.x, y: params.y ?? target.y }
      const position = placeWidgetOnDisplay(next, desired, layoutSize, list, context)
      next.x = position.x
      next.y = position.y
      next.displayId = context.display.id
      next.displayKey = context.display.key
    }
  }

  list = list.map((item) => (item.id === target.id ? next : item))
  if (params.bringToFront) list = moveWidgetToFront(list, target.id)
  persistWidgets(list)
  syncToCanvas()
  autoSaveToWallpaper()
  if (!isCanvasEditMode()) setCanvasMousePassthrough(true)
  const persisted = store.get('widgets')
  return { ok: true, widget: persisted.find((item) => item.id === target.id), list: persisted, notes }
}

export async function removeWidgetForTool(params: { id?: string; type?: string }): Promise<{ ok: boolean; deleted: boolean; list: WidgetInstance[]; error?: string }> {
  const target = findWidgetByIdOrType(params)
  if (!target) return { ok: false, deleted: false, list: store.get('widgets'), error: 'widget-not-found' }
  const result = await removeWidgetWithRestore(target.id)
  return { ok: true, deleted: result.deleted, list: result.list }
}

const UNIT = 160
/** 卡片组件的标准尺寸（悬浮组件使用 fit-content，不参与迁移） */
const WIDGET_SIZE_MAP: Record<string, { w: number; h: number }> = {
  stocks:     { w: UNIT * 2 + GRID_GAP, h: UNIT * 2 + GRID_GAP }, // 大 2×2
  news:       { w: UNIT,                h: UNIT * 2 + GRID_GAP }, // 中-竖 1×2
  calendar:   { w: UNIT,                h: UNIT },            // 小
  quicktools: { w: UNIT * 2 + GRID_GAP, h: UNIT },           // 中-横
  pet:        { w: UNIT,                h: UNIT },            // 小
  sysmonitor: { w: UNIT * 2 + GRID_GAP, h: UNIT },           // 中-横
}

export async function restoreWidgets(): Promise<void> {
  const current = store.get('wallpaper')?.current
  await loadWidgetsForWallpaper(current?.id)
  ensureWidgetCoordinateOrigin()

  // 迁移旧版组件尺寸到标准尺寸
  const widgets = store.get('widgets') as WidgetInstance[]
  if (!widgets || widgets.length === 0) return
  let changed = false
  for (const w of widgets) {
    const std = WIDGET_SIZE_MAP[w.type]
    if (std && (w.width !== std.w || w.height !== std.h)) {
      w.width = std.w
      w.height = std.h
      changed = true
    }
  }
  if (changed) {
    persistWidgets(widgets)
    autoSaveToWallpaper()
    syncToCanvas()
  }
}
