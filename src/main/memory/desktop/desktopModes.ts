import { randomUUID } from 'crypto'
import type { DesktopMode } from '@shared/companion-settings'
import type { WidgetInstance } from '@shared/types'
import { store } from '../../store'
import { listWidgetsForTool, replaceWidgetsForTool } from '../../ipc/widgetIpc'
import { applyWallpaperForTool, getWallpaperStateForTool } from '../../ipc/wallpaperIpc'

const ICON_WIDGET_TYPES = new Set(['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive', 'desktop-icons-dock'])
const MAX_MODES = 12

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readModes(): DesktopMode[] {
  const value = store.get('desktopModes')
  return Array.isArray(value) ? value.filter((mode): mode is DesktopMode => Boolean(mode && typeof mode.id === 'string' && Array.isArray(mode.widgets))) : []
}

function normalizeName(name: string): string {
  return name.trim().replace(/模式$/, '').toLowerCase()
}

export function listDesktopModeNames(): string[] {
  return readModes().map((mode) => mode.name)
}

export function listDesktopModes(): Array<Pick<DesktopMode, 'id' | 'name' | 'wallpaperName' | 'updatedAt'> & { widgetCount: number }> {
  return readModes().map((mode) => ({
    id: mode.id,
    name: mode.name,
    wallpaperName: mode.wallpaperName,
    updatedAt: mode.updatedAt,
    widgetCount: mode.widgets.length,
  }))
}

export function findDesktopMode(idOrName: string): DesktopMode | undefined {
  const key = normalizeName(idOrName)
  return readModes().find((mode) => mode.id === idOrName || normalizeName(mode.name) === key)
}

/** Remember the current wallpaper and its widgets under a name; the same name overwrites. */
export function saveDesktopMode(name: string): { ok: boolean; mode?: DesktopMode; replaced?: boolean; error?: string } {
  const trimmed = name.trim().slice(0, 24)
  if (!trimmed) return { ok: false, error: '给这个桌面模式起个名字吧。' }
  const modes = readModes()
  const existing = modes.find((mode) => normalizeName(mode.name) === normalizeName(trimmed))
  if (!existing && modes.length >= MAX_MODES) return { ok: false, error: `最多保存 ${MAX_MODES} 个桌面模式，先删掉一个旧的。` }
  const wallpaper = getWallpaperStateForTool().current
  const now = Date.now()
  const mode: DesktopMode = {
    id: existing?.id ?? `mode-${randomUUID().slice(0, 8)}`,
    name: trimmed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    wallpaperId: wallpaper?.id ?? null,
    wallpaperName: wallpaper?.name,
    widgets: clone(listWidgetsForTool().filter((widget) => !ICON_WIDGET_TYPES.has(widget.type))),
  }
  store.set('desktopModes', existing ? modes.map((item) => item.id === existing.id ? mode : item) : [...modes, mode])
  return { ok: true, mode, replaced: Boolean(existing) }
}

export function deleteDesktopMode(idOrName: string): boolean {
  const target = findDesktopMode(idOrName)
  if (!target) return false
  store.set('desktopModes', readModes().filter((mode) => mode.id !== target.id))
  return true
}

/**
 * Switch to a saved mode: its wallpaper first (which loads that wallpaper's
 * widget namespace), then its widgets. Dock and icon boxes are left as they are.
 */
export async function applyDesktopMode(idOrName: string): Promise<{ ok: boolean; mode?: DesktopMode; wallpaperChanged?: boolean; error?: string }> {
  const mode = findDesktopMode(idOrName)
  if (!mode) return { ok: false, error: 'mode-not-found' }
  let wallpaperChanged = false
  const current = getWallpaperStateForTool().current
  if (mode.wallpaperId && current?.id !== mode.wallpaperId) {
    const applied = await applyWallpaperForTool(mode.wallpaperId)
    if (!applied.ok) return { ok: false, mode, error: '这个模式用的壁纸已经不在了，组件我也就先不动了。' }
    wallpaperChanged = true
  }
  const iconWidgets = listWidgetsForTool().filter((widget) => ICON_WIDGET_TYPES.has(widget.type))
  const modeWidgets: WidgetInstance[] = clone(mode.widgets).filter((widget) => !ICON_WIDGET_TYPES.has(widget.type))
  replaceWidgetsForTool([...modeWidgets, ...iconWidgets])
  return { ok: true, mode, wallpaperChanged }
}
