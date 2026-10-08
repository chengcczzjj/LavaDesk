import { app, desktopCapturer, screen, shell } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  KNOWN_FOLDERS,
  MEDIA_KEYS,
  SETTINGS_PAGES,
  volumeKeyPresses,
  type KnownFolderId,
  type MediaKeyId,
  type SettingsPageId,
} from '@shared/system-control'
import { pressVirtualKey, toggleWindowsDesktop } from '../../windows/windowsDesktop'
import { getMainWindow } from '../../windows/mainWindow'
import { getQuickChatWindow } from '../../windows/quickChatWindow'

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function showDesktop(): boolean {
  return toggleWindowsDesktop()
}

export async function openSettingsPage(page: SettingsPageId): Promise<{ ok: boolean; label: string; error?: string }> {
  const entry = SETTINGS_PAGES[page]
  try {
    await shell.openExternal(entry.uri)
    return { ok: true, label: entry.label }
  } catch (error) {
    return { ok: false, label: entry.label, error: (error as Error).message }
  }
}

export function screenshotFolder(): string {
  return join(app.getPath('pictures'), '灵月截图')
}

function folderPath(folder: Exclude<KnownFolderId, 'recycle_bin'>): string {
  switch (folder) {
    case 'home': return app.getPath('home')
    case 'screenshots': return screenshotFolder()
    default: return app.getPath(folder)
  }
}

export async function openKnownFolder(folder: KnownFolderId): Promise<{ ok: boolean; label: string; error?: string }> {
  const label = KNOWN_FOLDERS[folder]
  if (folder === 'recycle_bin') {
    if (!isWindows()) return { ok: false, label, error: 'unsupported-platform' }
    try {
      spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref()
      return { ok: true, label }
    } catch (error) {
      return { ok: false, label, error: (error as Error).message }
    }
  }
  const target = folderPath(folder)
  if (folder === 'screenshots') await fs.mkdir(target, { recursive: true })
  const error = await shell.openPath(target)
  return error ? { ok: false, label, error } : { ok: true, label }
}

export function pressMediaKey(key: MediaKeyId, times = 1): boolean {
  return pressVirtualKey(MEDIA_KEYS[key], times)
}

export function changeVolume(direction: 'up' | 'down' | 'mute', percent = 10): { ok: boolean; presses: number } {
  if (direction === 'mute') return { ok: pressMediaKey('mute'), presses: 1 }
  const presses = volumeKeyPresses(percent)
  return { ok: pressMediaKey(direction === 'up' ? 'volume_up' : 'volume_down', presses), presses }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Capture the primary screen (or every screen) as PNG. The companion's own
 * windows are hidden briefly so the picture shows what the user is looking at.
 */
export async function captureScreen(options: { allDisplays?: boolean; hideOwnWindows?: boolean } = {}): Promise<{ ok: boolean; files: string[]; images: Buffer[]; error?: string }> {
  const hidden: Electron.BrowserWindow[] = []
  if (options.hideOwnWindows !== false) {
    for (const win of [getMainWindow(), getQuickChatWindow()]) {
      if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
        win.hide()
        hidden.push(win)
      }
    }
    if (hidden.length > 0) await delay(280)
  }
  try {
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const largest = displays.reduce((max, display) => Math.max(max, display.size.width * display.scaleFactor, display.size.height * display.scaleFactor), 0)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(largest) || 1920, height: Math.round(largest) || 1080 },
    })
    const wanted = options.allDisplays
      ? sources
      : [sources.find((source) => source.display_id === String(primary.id)) ?? sources[0]].filter(Boolean)
    if (wanted.length === 0) return { ok: false, files: [], images: [], error: '没有找到可截取的屏幕。' }
    const folder = screenshotFolder()
    await fs.mkdir(folder, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const files: string[] = []
    const images: Buffer[] = []
    for (const [index, source] of wanted.entries()) {
      const png = source.thumbnail.toPNG()
      if (png.length === 0) continue
      const file = join(folder, `截图-${stamp}${wanted.length > 1 ? `-${index + 1}` : ''}.png`)
      await fs.writeFile(file, png)
      files.push(file)
      images.push(png)
    }
    return files.length > 0 ? { ok: true, files, images } : { ok: false, files, images, error: '截图是空的，可能没有屏幕录制权限。' }
  } catch (error) {
    return { ok: false, files: [], images: [], error: (error as Error).message }
  } finally {
    for (const win of hidden) {
      if (!win.isDestroyed()) win.showInactive()
    }
  }
}
