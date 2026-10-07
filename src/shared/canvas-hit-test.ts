/** Anything the native hit test can resolve: persisted widgets or DOM regions reported by the canvas. */
export interface CanvasHitCandidate {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  enabled?: boolean
  stackOrder?: number
}

/**
 * A widget's rendered footprint in canvas client coordinates, measured from
 * the DOM. Persisted rects can differ from what is painted (fit-content
 * clocks, animated Dock icons), and every disagreement
 * between the main-process poll and the renderer used to flip the transparent
 * canvas between capture and click-through.
 */
export interface CanvasHitRegion extends CanvasHitCandidate {
  stackOrder: number
}

export const CANVAS_HIT_REGION_LIMIT = 200

function getWidgetStackOrder(widget: CanvasHitCandidate, fallbackIndex = 0): number {
  return typeof widget.stackOrder === 'number' && Number.isFinite(widget.stackOrder)
    ? widget.stackOrder
    : fallbackIndex
}

const DESKTOP_ICON_WIDGET_TYPES = new Set([
  'desktop-icons-box',
  'desktop-icons-horizontal',
  'desktop-icons-adaptive',
  'desktop-icons-dock',
])

// These widgets only paint changing information. They belong to the settled
// desktop layer and should not make the transparent canvas capture the mouse
// or trigger a temporary always-on-top repair during app/window switches.
const PASSIVE_WIDGET_TYPES = new Set([
  'clock',
  'elegantclock',
  'pixelclock',
  'graphicdatetime',
  'audio',
  'weather',
  'text',
  'stocks',
  'news',
  'calendar',
  'quicktools',
  'pet',
  'sysmonitor',
])

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasBounds {
  x: number
  y: number
  width: number
  height: number
}

export const CANVAS_INTERACTION_REPAIR_DELAY_MS = 140
export const CANVAS_STARTUP_OCCLUSION_GRACE_MS = 5_000
export const CANVAS_STARTUP_OCCLUSION_RECREATE_MS = 3_000

// A desktop-return z-order refresh briefly raises the transparent canvas above
// every normal window. Only run it when Windows is actually showing the shell;
// remote-control windows (notably ToDesk) can report the same non-occluded state
// while they are still the active foreground surface.
const DESKTOP_RETURN_SHELL_REASONS = new Set([
  'no-foreground-window',
  'desktop-progman',
  'desktop-taskbar',
  'desktop-root',
])

const DESKTOP_SHELL_WINDOW_CLASSES = new Set([
  'PROGMAN',
  'WORKERW',
  'SHELL_TRAYWND',
  'SHELL_SECONDARYTRAYWND',
  'SHELLDLL_DEFVIEW',
])

const TODESK_WINDOW_CLASSES = new Set([
  'H-SMILE-FRAME',
  'TWINCONTROL',
])

export function shouldRecoverCanvasAfterDesktopReturn(options: {
  reason?: string | null
  className?: string | null
}): boolean {
  const reason = options.reason?.trim() ?? ''
  const className = options.className?.trim().toUpperCase() ?? ''
  if (TODESK_WINDOW_CLASSES.has(className)) return false
  if (DESKTOP_RETURN_SHELL_REASONS.has(reason)) return true
  return DESKTOP_SHELL_WINDOW_CLASSES.has(className)
}

export function isDesktopIconWidgetType(type: string): boolean {
  return DESKTOP_ICON_WIDGET_TYPES.has(type)
}

export function isPassiveWidgetType(type: string): boolean {
  return PASSIVE_WIDGET_TYPES.has(type)
}

export function isCanvasInteractiveWidgetType(type: string): boolean {
  return !isPassiveWidgetType(type)
}

export function findInteractiveWidgetAtPoint<T extends CanvasHitCandidate>(
  point: CanvasPoint,
  displayBounds: CanvasBounds,
  widgets: readonly T[],
): T | undefined {
  const clientX = point.x - displayBounds.x
  const clientY = point.y - displayBounds.y

  let topWidget: T | undefined
  let topOrder = Number.NEGATIVE_INFINITY
  for (let index = 0; index < widgets.length; index += 1) {
    const widget = widgets[index]
    if (widget.enabled === false) continue
    const padding = widget.type === 'desktop-icons-dock' ? 28 : 0
    if (
      clientX >= widget.x - padding &&
      clientX <= widget.x + widget.width + padding &&
      clientY >= widget.y - padding &&
      clientY <= widget.y + widget.height + padding
    ) {
      const order = getWidgetStackOrder(widget, index)
      if (order >= topOrder) {
        topOrder = order
        topWidget = widget
      }
    }
  }
  return topWidget && isCanvasInteractiveWidgetType(topWidget.type) ? topWidget : undefined
}

/** Validates renderer-reported hit regions before the main process trusts them for input routing. */
export function sanitizeCanvasHitRegions(value: unknown): CanvasHitRegion[] | null {
  if (!Array.isArray(value) || value.length > CANVAS_HIT_REGION_LIMIT) return null
  const regions: CanvasHitRegion[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const { id, type, x, y, width, height, stackOrder } = entry as Record<string, unknown>
    if (typeof id !== 'string' || id.length === 0 || id.length > 160) return null
    if (typeof type !== 'string' || type.length === 0 || type.length > 80) return null
    const numbers = [x, y, width, height, stackOrder]
    if (!numbers.every((number) => typeof number === 'number' && Number.isFinite(number))) return null
    if ((width as number) <= 0 || (height as number) <= 0) continue
    regions.push({
      id,
      type,
      x: x as number,
      y: y as number,
      width: Math.min(width as number, 32_768),
      height: Math.min(height as number, 32_768),
      stackOrder: stackOrder as number,
    })
  }
  return regions
}

export type NativeCursorSurfaceKind = 'canvas' | 'desktop' | 'foreign' | 'unknown'

/**
 * Classifies the native window under the cursor. `foreign` means another
 * window (an app, the taskbar, an IME candidate list, a menu) is physically on
 * top of the canvas at that point, so the widget underneath is not reachable.
 */
export function classifyNativeCursorSurface(surface: {
  hitHwnd: number
  canvasTopmost: boolean
  desktopSurface: boolean
}): NativeCursorSurfaceKind {
  if (surface.canvasTopmost) return 'canvas'
  if (surface.desktopSurface) return 'desktop'
  return surface.hitHwnd ? 'foreign' : 'unknown'
}

export function shouldIgnoreCanvasMouse(options: {
  desktopOccluded: boolean
  recompositing?: boolean
  editing: boolean
  pointerActive: boolean
  widgetUnderCursor: boolean
  /** Another window covers the canvas at the cursor; capturing would only fight that window. */
  cursorCovered?: boolean
}): boolean {
  if (options.desktopOccluded || options.recompositing) return true
  if (options.editing || options.pointerActive) return false
  if (options.cursorCovered) return true
  return !options.widgetUnderCursor
}

export function shouldRepairCanvasInteraction(options: {
  desktopOccluded: boolean
  recompositing: boolean
  nativeMousePassthrough: boolean | null
  rendererMousePassthrough: boolean
  captureRequestedAt: number
  now: number
  canvasTopmost: boolean
  desktopSurface: boolean
  alreadyAttempted: boolean
}): boolean {
  if (options.desktopOccluded || options.recompositing || options.alreadyAttempted) return false
  if (options.nativeMousePassthrough !== false) return false
  // A renderer hover acknowledgement is normally enough to avoid a repair,
  // but it is not proof that Windows will route the next pointer event to the
  // transparent HWND.  When the native hit surface is the desktop shell we
  // can safely re-enter the compositor even if Chromium currently reports the
  // widget as interactive.
  if (!options.rendererMousePassthrough && !options.desktopSurface) return false
  if (options.captureRequestedAt <= 0 || options.now - options.captureRequestedAt < CANVAS_INTERACTION_REPAIR_DELAY_MS) {
    return false
  }
  // If WindowFromPoint already resolves to the canvas, Windows has restored the
  // native input surface. Renderer disagreement then usually means the cursor is
  // only inside a coarse/padded native hit region, not that z-order is broken.
  // Recompose only when Windows still routes the point to the desktop shell.
  return options.desktopSurface
}

export function shouldRecreateCanvasAfterInitialOcclusion(options: {
  canvasAgeAtOcclusionMs: number
  occlusionDurationMs: number
  rendererPointerDownObserved: boolean
}): boolean {
  return (
    !options.rendererPointerDownObserved &&
    options.canvasAgeAtOcclusionMs >= 0 &&
    options.canvasAgeAtOcclusionMs <= CANVAS_STARTUP_OCCLUSION_GRACE_MS &&
    options.occlusionDurationMs >= CANVAS_STARTUP_OCCLUSION_RECREATE_MS
  )
}
