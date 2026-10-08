import { app } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'

const USER_WALLPAPER_PREFIX = 'user:'
const REMOTE_WALLPAPER_PREFIX = 'remote:'

export function sanitizeUserDataSegment(value: string, fallback = 'item'): string {
  const withoutControls = Array.from(value, (char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('')
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return (cleaned || fallback).slice(0, 120)
}

export function stableUserDataSegment(value: string, fallback = 'item'): string {
  const base = sanitizeUserDataSegment(value, fallback).slice(0, 96)
  const hash = createHash('sha1').update(value).digest('hex').slice(0, 10)
  return `${base}-${hash}`
}

export function getUserWallpapersRoot(): string {
  return join(app.getPath('userData'), 'wallpapers')
}

/** Online-library downloads land here before they are validated and imported. */
export function getWallpaperDownloadsRoot(): string {
  return join(app.getPath('userData'), 'wallpaper-downloads')
}

/** Copies of files pasted or dropped into a chat (the app never learns their original path). */
export function getChatDropsRoot(): string {
  return join(app.getPath('userData'), 'chat-drops')
}

export function getRemoteWallpapersRoot(): string {
  return join(app.getPath('userData'), 'remote-wallpapers')
}

export function getWallpaperResourceCacheRoot(): string {
  return join(app.getPath('userData'), 'wallpaper-resource-cache')
}

export function getWallpaperResourceManifestCachePath(): string {
  return join(getWallpaperResourceCacheRoot(), 'manifest.json')
}

export function getWallpaperOwnerConfigPath(): string {
  return join(app.getPath('userData'), 'wallpaper-owner.json')
}

export function toUserWallpaperId(folderName: string): string {
  return `${USER_WALLPAPER_PREFIX}${folderName}`
}

export function isUserWallpaperId(id?: string): boolean {
  return typeof id === 'string' && id.startsWith(USER_WALLPAPER_PREFIX)
}

export function getUserWallpaperFolderName(id: string): string {
  return sanitizeUserDataSegment(id.slice(USER_WALLPAPER_PREFIX.length), 'wallpaper')
}

export function toRemoteWallpaperId(resourceId: string): string {
  return `${REMOTE_WALLPAPER_PREFIX}${resourceId}`
}

export function isRemoteWallpaperId(id?: string): boolean {
  return typeof id === 'string' && id.startsWith(REMOTE_WALLPAPER_PREFIX)
}

export function getRemoteWallpaperFolderName(id: string): string {
  return sanitizeUserDataSegment(id.slice(REMOTE_WALLPAPER_PREFIX.length), 'wallpaper')
}

export function getWallpaperOverrideDir(wallpaperId: string): string {
  return join(app.getPath('userData'), 'wallpaper-overrides', stableUserDataSegment(wallpaperId, 'wallpaper'))
}

export function getWallpaperWidgetOverridePath(wallpaperId: string): string {
  return join(getWallpaperOverrideDir(wallpaperId), 'widget-config.json')
}

export function getWallpaperSettingsOverridePath(wallpaperId: string): string {
  return join(getWallpaperOverrideDir(wallpaperId), 'settings.json')
}
