import { app, dialog, ipcMain, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join, basename, extname, isAbsolute, relative, resolve } from 'path'
import { execFile } from 'child_process'
import { IPC } from '@shared/ipc-channels'
import type {
  WallpaperApplyTarget,
  WallpaperDisplayLayout,
  WallpaperDisplayMode,
  WallpaperDisplaySettings,
  WallpaperFramePayload,
  WallpaperItem,
  WallpaperSettings,
} from '@shared/types'
import {
  buildWallpaperLayoutForTarget,
  getDisplayStorageKey,
  normalizeWallpaperDisplayMode,
  planWallpaperApplication,
  resolveEffectiveWallpaper,
} from '@shared/wallpaper-display-layout'
import { store } from '../store'
import {
  getWallpaperWindows,
  getWallpaperWindowTarget,
  isWallpaperAttached,
  isWallpaperWebContents,
  ensureWallpaperAttached,
  refreshWallpaperBounds,
} from '../windows/wallpaperWindow'
import { refreshCanvasBounds, refreshCanvasZOrder, getCanvasWindow, isDesktopOccluded } from '../windows/canvasWindow'
import {
  getDisplayDescriptors,
  WALLPAPER_DISPLAY_SCHEMA_VERSION,
} from '../windows/displayLayout'
import { getMainWindow } from '../windows/mainWindow'
import {
  getUserWallpapersRoot,
  getRemoteWallpapersRoot,
  getUserWallpaperFolderName,
  getWallpaperSettingsOverridePath,
  getWallpaperOverrideDir,
  isUserWallpaperId,
  sanitizeUserDataSegment,
  toRemoteWallpaperId,
  toUserWallpaperId,
} from '../runtime/userDataPaths'
import { ensureWidgetCoordinateOrigin, loadWidgetsForWallpaper } from './widgetIpc'
import { allowUserSelectedAsset, createWallpaperWebUrl } from '../protocols'
import { assertTrustedIpcSender } from './ipcSecurity'
import { extractZipSafely } from '../services/safe-zip'
import { z } from 'zod'
import { writeJsonAtomic } from '../runtime/atomicJson'
import { beginWallpaperResourceMutation, reserveWallpaperUsage } from '../services/wallpaper-usage'

/**
 * 内置壁纸根目录：
 *   dev：g:\LingyueDesk\assets\wallpaper
 *   打包：<resources>/assets/wallpaper（见 electron-builder.yml extraResources）
 */
function getWallpaperRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'assets', 'wallpaper')
  }
  return join(__dirname, '../../assets/wallpaper')
}

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
const MAX_IMPORTED_ZIP_BYTES = 2 * 1024 * 1024 * 1024

function isPathInside(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function safeSendToWindow(
  win: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false
  try {
    win.webContents.send(channel, ...args)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Render frame was disposed')) return false
    console.warn(`[wallpaper] IPC 发送失败: ${channel}`, err)
    return false
  }
}

/**
 * FlowWallDeskInfo.json 中的 Type 字段：
 *   1  = web (HTML)
 *   7  = video
 *   11 = picture
 */
function mapType(type: unknown, fileName?: string): WallpaperItem['type'] {
  if (typeof type === 'number') {
    if (type === 1) return 'web'
    if (type === 7) return 'video'
    if (type === 11) return 'image'
  }
  if (fileName) {
    const ext = extname(fileName).toLowerCase()
    if (VIDEO_EXT.has(ext)) return 'video'
    if (IMAGE_EXT.has(ext)) return 'image'
    if (ext === '.html' || ext === '.htm') return 'web'
  }
  return 'image'
}

interface FlowWallDeskInfo {
  [key: string]: unknown
  Title?: string
  Desc?: string
  Author?: string
  Contact?: string
  Type?: number
  FileName?: string
  Thumbnail?: string
  Preview?: string
  Tags?: string[]
  Id?: string
  // 壁纸独立设置
  Settings?: WallpaperSettings
}

function parseWallpaperSettingsOverride(data: unknown): WallpaperSettings | undefined {
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  if (record.settings && typeof record.settings === 'object') {
    return record.settings as WallpaperSettings
  }
  return data as WallpaperSettings
}

async function readWallpaperSettingsOverride(wallpaperId: string): Promise<WallpaperSettings | undefined> {
  try {
    const txt = await fs.readFile(getWallpaperSettingsOverridePath(wallpaperId), 'utf-8')
    return parseWallpaperSettingsOverride(JSON.parse(txt))
  } catch {
    return undefined
  }
}

/**
 * 用 ffmpeg 把视频前 3 秒生成 512x512 正方形 GIF 预览图。
 * 输出到同目录下 preview.gif。如果已存在则跳过。
 */
function generateVideoPreviewGif(videoPath: string, outputDir: string): Promise<string | undefined> {
  const outPath = join(outputDir, 'preview.gif')
  return new Promise((resolve) => {
    fs.access(outPath)
      .then(() => {
        // 已存在，直接返回
        resolve(outPath)
      })
      .catch(() => {
        // 不存在，用 ffmpeg 生成
        // 裁切为正方形（取中心）→ 缩放到 512x512 → 前 3 秒 → 10fps
        const args = [
          '-y',
          '-i',
          videoPath,
          '-t',
          '3',
          '-vf',
          'crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=10',
          '-loop',
          '0',
          outPath,
        ]
        execFile('ffmpeg', args, { timeout: 30000 }, (err) => {
          if (err) {
            console.warn(`[wallpaper] GIF 生成失败 (${basename(videoPath)}):`, err.message)
            resolve(undefined)
          } else {
            console.log(`[wallpaper] GIF 预览已生成: ${outPath}`)
            // 更新 FlowWallDeskInfo.json
            const infoPath = join(outputDir, 'FlowWallDeskInfo.json')
            fs.readFile(infoPath, 'utf-8')
              .then((txt) => {
                const info = JSON.parse(txt)
                info.Thumbnail = 'preview.gif'
                info.Preview = 'preview.gif'
                return fs.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8')
              })
              .catch(() => {
                // ignore - 无法更新配置文件不影响使用
              })
            resolve(outPath)
          }
        })
      })
  })
}

/** 保存单个壁纸的独立设置到用户数据覆盖层 */
const wallpaperSettingsSchema = z.object({
  volume: z.number().finite().min(0).max(100).optional(),
  speed: z.number().finite().min(0.1).max(4).optional(),
  scaling: z.enum(['覆盖', '填充', '居中', '拉伸', '自由']).optional(),
  flip: z.enum(['无', '水平', '垂直']).optional(),
}).strict()

async function saveWallpaperSettings(wallpaperId: string, settings: WallpaperSettings): Promise<void> {
  wallpaperId = z.string().min(1).max(512).parse(wallpaperId)
  const patch = wallpaperSettingsSchema.parse(settings)
  const release = reserveWallpaperUsage([wallpaperId])
  try {
    const state = store.get('wallpaper')
    const catalog = await listAllWallpapers()
    const item = catalog.find((entry) => entry.id === wallpaperId)
      ?? (state.current?.id === wallpaperId ? state.current : undefined)
    if (!item) throw new Error('壁纸不存在，请刷新列表后重试。')
    const updated = { ...item, settings: { ...item.settings, ...patch } }
    await writeJsonAtomic(getWallpaperSettingsOverridePath(wallpaperId), { settings: updated.settings })
    if (state.current?.id === wallpaperId) store.set('wallpaper', { ...store.get('wallpaper'), current: updated })
    await broadcastWallpaperDisplayLayout(catalog.map((entry) => entry.id === wallpaperId ? updated : entry))
    notifyDisplaySettingsChanged()
  } finally {
    release()
  }
}

const queuedSettings = new Map<string, { patch: WallpaperSettings; result: Promise<void> }>()

function queueWallpaperSettings(wallpaperId: string, settings: WallpaperSettings): Promise<void> {
  wallpaperId = z.string().min(1).max(512).parse(wallpaperId)
  const patch = wallpaperSettingsSchema.parse(settings)
  const queued = queuedSettings.get(wallpaperId)
  if (queued) {
    queued.patch = { ...queued.patch, ...patch }
    return queued.result
  }
  // Keep at most one waiting write per wallpaper when sliders outpace disk I/O.
  const entry = { patch, result: Promise.resolve() }
  entry.result = withWallpaperChange(async () => {
    queuedSettings.delete(wallpaperId)
    await saveWallpaperSettings(wallpaperId, entry.patch)
  })
  queuedSettings.set(wallpaperId, entry)
  return entry.result
}

async function pickPreview(folder: string, info?: FlowWallDeskInfo): Promise<string | undefined> {
  const tryAccess = async (p: string) => {
    try {
      await fs.access(p)
      return p
    } catch {
      return undefined
    }
  }
  if (info?.Thumbnail) {
    const r = await tryAccess(join(folder, info.Thumbnail))
    if (r) return r
  }
  if (info?.Preview) {
    const r = await tryAccess(join(folder, info.Preview))
    if (r) return r
  }
  // 文件夹内匹配 thumbnail/preview/cover/封面
  const entries = await fs.readdir(folder).catch(() => [] as string[])
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!IMAGE_EXT.has(ext)) continue
    if (/thumb|preview|cover|封面/i.test(name)) return join(folder, name)
  }
  // 嵌套 assets/images
  try {
    const inner = await fs.readdir(join(folder, 'assets', 'images'))
    const t = inner.find((n) => /thumbnail|preview|cover/i.test(n))
    if (t) return join(folder, 'assets', 'images', t)
  } catch {
    // ignore
  }
  return undefined
}

async function scanFolder(folder: string, id: string, options: { mutable?: boolean } = {}): Promise<WallpaperItem | null> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => e.name)

    let info: FlowWallDeskInfo | undefined
    if (files.includes('FlowWallDeskInfo.json')) {
      try {
        const txt = await fs.readFile(join(folder, 'FlowWallDeskInfo.json'), 'utf-8')
        info = JSON.parse(txt)
      } catch {
        // ignore
      }
    }

    let source: string | undefined
    let type: WallpaperItem['type'] = 'image'

    if (info?.FileName) {
      const configuredSource = resolve(folder, info.FileName)
      const configuredStat = isPathInside(resolve(folder), configuredSource)
        ? await fs.stat(configuredSource).catch(() => null)
        : null
      if (configuredStat?.isFile()) {
        source = configuredSource
        type = mapType(info.Type, info.FileName)
      }
    }
    if (!source) {
      const html = files.find((n) => /\.html?$/i.test(n))
      if (html) {
        source = join(folder, html)
        type = 'web'
      } else {
        const video = files.find((n) => VIDEO_EXT.has(extname(n).toLowerCase()))
        if (video) {
          source = join(folder, video)
          type = 'video'
        } else {
          const image = files.find((n) => IMAGE_EXT.has(extname(n).toLowerCase()))
          if (image) {
            source = join(folder, image)
            type = 'image'
          }
        }
      }
    }

    if (!source) return null

    const preview = await pickPreview(folder, info)

    // 视频壁纸没有预览图时，异步生成 GIF 预览
    if (type === 'video' && !preview && options.mutable) {
      // 先不阻塞扫描，异步生成后下次加载时就有了
      generateVideoPreviewGif(source, folder).then((gif) => {
        if (gif) console.log(`[wallpaper] 视频预览 GIF 已就绪: ${id}`)
      })
    }

    const settingsOverride = await readWallpaperSettingsOverride(id)

    return {
      id,
      name: info?.Title || id,
      source,
      type,
      preview,
      meta: info as unknown as Record<string, unknown>,
      settings: settingsOverride ?? info?.Settings,
    }
  } catch {
    return null
  }
}

async function listWallpapersFromRoot(
  root: string,
  options: { idPrefix?: 'user' | 'remote'; label: string; mutable?: boolean }
): Promise<WallpaperItem[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const items = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const id = options.idPrefix === 'user'
            ? toUserWallpaperId(e.name)
            : options.idPrefix === 'remote'
              ? toRemoteWallpaperId(e.name)
              : e.name
          return scanFolder(join(root, e.name), id, { mutable: options.mutable })
        })
    )
    return items.filter((x): x is WallpaperItem => x !== null)
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined
    if (code === 'ENOENT') return []
    console.warn(`[wallpaper] ${options.label}扫描失败：`, err)
    return []
  }
}

async function listBuiltinWallpapers(): Promise<WallpaperItem[]> {
  return listWallpapersFromRoot(getWallpaperRoot(), { label: '内置壁纸', mutable: false })
}

async function listUserWallpapers(): Promise<WallpaperItem[]> {
  return listWallpapersFromRoot(getUserWallpapersRoot(), { idPrefix: 'user', label: '用户壁纸', mutable: true })
}

function sendToWallpaperWindows(channel: string, ...args: unknown[]): void {
  for (const win of getWallpaperWindows()) safeSendToWindow(win, channel, ...args)
}

function notifyDisplaySettingsChanged(): void {
  safeSendToWindow(getMainWindow(), IPC.WALLPAPER_DISPLAY_LAYOUT_CHANGED)
}

let wallpaperChange: Promise<unknown> = Promise.resolve()
function withWallpaperChange<T>(operation: () => Promise<T>): Promise<T> {
  const result = wallpaperChange.then(operation)
  wallpaperChange = result.catch(() => undefined)
  return result
}

async function commitWallpaperDisplay(
  settings: Pick<WallpaperDisplaySettings, 'mode' | 'assignments'> & { schemaVersion?: number; userConfigured?: boolean },
  candidate = store.get('wallpaper').current,
): Promise<void> {
  const release = reserveWallpaperUsage([...Object.values(settings.assignments), ...(candidate ? [candidate.id] : [])])
  try {
    const catalog = await listAllWallpapers()
    const current = resolveEffectiveWallpaper({ ...settings, catalog, displays: getDisplayDescriptors(), current: candidate })
    const assignedIds = new Set(Object.values(settings.assignments))
    const used = settings.mode === 'per-display' ? catalog.filter((item) => assignedIds.has(item.id)) : []
    // Validate every assigned web package before changing widgets or persisted state.
    for (const item of [...used, ...(current ? [current] : [])]) {
      if (item.type === 'web') await createWallpaperWebUrl(item.source)
    }
    if (store.get('wallpaper').current?.id !== current?.id) await loadWidgetsForWallpaper(current?.id)
    store.set({ wallpaper: { ...store.get('wallpaper'), current }, wallpaperDisplay: settings })
    ensureWidgetCoordinateOrigin()
    refreshWallpaperBounds()
    refreshCanvasBounds()
    await broadcastWallpaperDisplayLayout(catalog)
    notifyDisplaySettingsChanged()
  } finally {
    release()
  }
}

const playbackClocks = new Map<string, { signature: string; epochMs: number }>()

async function buildWallpaperDisplayLayout(webContentsId: number, snapshot?: WallpaperItem[]): Promise<WallpaperDisplayLayout | null> {
  const candidate = store.get('wallpaper').current
  const settings = store.get('wallpaperDisplay')
  const mode = normalizeWallpaperDisplayMode(settings?.mode)
  const catalog = snapshot ?? await listAllWallpapers()
  const displays = getDisplayDescriptors()
  const current = resolveEffectiveWallpaper({ mode, displays, assignments: settings?.assignments ?? {}, catalog, current: candidate })
  if (!current) return null
  const target = getWallpaperWindowTarget(webContentsId)
  if (!target) return null
  const layout = buildWallpaperLayoutForTarget({
    mode,
    target,
    displays,
    assignments: settings?.assignments ?? {},
    catalog,
    current,
  })
  for (const surface of layout.displays) {
    if (surface.item.type === 'web') surface.item = { ...surface.item, webUrl: await createWallpaperWebUrl(surface.item.source) }
  }
  const item = layout.displays[0]?.item ?? current
  const signature = JSON.stringify([mode, item.source, item.settings?.speed ?? 1])
  let clock = playbackClocks.get(item.id)
  if (!clock || clock.signature !== signature) {
    clock = { signature, epochMs: Date.now() }
    playbackClocks.set(item.id, clock)
  }
  layout.playback = { epochMs: clock.epochMs, audioEnabled: mode === 'per-display' || target.primary }
  return layout
}

export async function getWallpaperDisplaySettings(): Promise<WallpaperDisplaySettings> {
  const settings = store.get('wallpaperDisplay')
  return {
    mode: normalizeWallpaperDisplayMode(settings?.mode),
    assignments: { ...(settings?.assignments ?? {}) },
    displays: getDisplayDescriptors(),
  }
}

async function applyWallpaperItem(item: WallpaperItem, target: WallpaperApplyTarget): Promise<void> {
  const state = store.get('wallpaper')
  const settings = store.get('wallpaperDisplay')
  const plan = planWallpaperApplication({ target, mode: settings.mode, assignments: settings.assignments,
    displays: getDisplayDescriptors(), currentId: state.current?.id, itemId: item.id })
  await commitWallpaperDisplay({ ...settings, mode: plan.mode, assignments: plan.assignments },
    plan.currentId === item.id ? item : state.current ?? item)
  // No z-order refresh here: it briefly lifts the canvas to always-on-top,
  // which flashed every widget above the user's apps. New wallpaper windows
  // re-sync the canvas when they attach (WALLPAPER_READY).
  resetWallpaperFrameWatchdog()
  if (wallpaperFrameDemanded) startMainCapture()
}

// ─── AI companion helpers: same queue, validation and usage locks as the UI ───

export function listWallpapersForTool(): Promise<WallpaperItem[]> {
  return listAllWallpapers()
}

export function getWallpaperStateForTool(): { current?: WallpaperItem; mode: WallpaperDisplayMode; assignments: Record<string, string> } {
  const settings = store.get('wallpaperDisplay')
  return {
    current: store.get('wallpaper')?.current,
    mode: normalizeWallpaperDisplayMode(settings?.mode),
    assignments: { ...(settings?.assignments ?? {}) },
  }
}

export async function applyWallpaperForTool(wallpaperId: string, target: WallpaperApplyTarget = 'current'): Promise<{ ok: boolean; item?: WallpaperItem; error?: string }> {
  return withWallpaperChange(async () => {
    const item = (await listAllWallpapers()).find((entry) => entry.id === wallpaperId)
    if (!item) return { ok: false, error: 'wallpaper-not-found' }
    await applyWallpaperItem(item, target)
    return { ok: true, item: store.get('wallpaper')?.current?.id === item.id ? store.get('wallpaper').current : item }
  })
}

/** Put back an earlier wallpaper + display layout (AI undo). */
export async function restoreWallpaperLayoutForTool(layout: { wallpaperId: string | null; displayMode: WallpaperDisplayMode; assignments: Record<string, string> }): Promise<{ ok: boolean; error?: string }> {
  return withWallpaperChange(async () => {
    const catalog = await listAllWallpapers()
    const item = layout.wallpaperId ? catalog.find((entry) => entry.id === layout.wallpaperId) : undefined
    if (layout.wallpaperId && !item) return { ok: false, error: '原来的壁纸已经不在了，没法切回去。' }
    const assignments = Object.fromEntries(Object.entries(layout.assignments).filter(([, id]) => catalog.some((entry) => entry.id === id)))
    await commitWallpaperDisplay({ ...store.get('wallpaperDisplay'), mode: layout.displayMode, assignments, userConfigured: true }, item)
    resetWallpaperFrameWatchdog()
    if (wallpaperFrameDemanded) startMainCapture()
    return { ok: true }
  })
}

export async function updateWallpaperSettingsForTool(wallpaperId: string, settings: WallpaperSettings): Promise<{ ok: boolean; error?: string }> {
  const patch = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as WallpaperSettings
  const parsed = wallpaperSettingsSchema.safeParse(patch)
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }
  await queueWallpaperSettings(wallpaperId, parsed.data)
  return { ok: true }
}

export async function setWallpaperDisplayModeForTool(mode: WallpaperDisplayMode): Promise<WallpaperDisplaySettings> {
  return withWallpaperChange(async () => {
    await commitWallpaperDisplay({ ...store.get('wallpaperDisplay'), mode, schemaVersion: WALLPAPER_DISPLAY_SCHEMA_VERSION, userConfigured: true })
    return getWallpaperDisplaySettings()
  })
}

async function broadcastWallpaperDisplayLayout(snapshot?: WallpaperItem[]): Promise<void> {
  const catalog = snapshot ?? await listAllWallpapers()
  for (const win of getWallpaperWindows()) {
    const layout = await buildWallpaperDisplayLayout(win.webContents.id, catalog)
    if (layout) {
      const item = layout.displays[0]?.item
      win.webContents.setAudioMuted(layout.playback?.audioEnabled === false || item?.settings?.volume === 0)
      safeSendToWindow(win, IPC.WALLPAPER_DISPLAY_LAYOUT, layout)
    }
  }
}

async function listRemoteWallpapers(): Promise<WallpaperItem[]> {
  return listWallpapersFromRoot(getRemoteWallpapersRoot(), { idPrefix: 'remote', label: '在线壁纸', mutable: true })
}

async function listAllWallpapers(): Promise<WallpaperItem[]> {
  const [builtin, user, remote] = await Promise.all([
    listBuiltinWallpapers(),
    listUserWallpapers(),
    listRemoteWallpapers(),
  ])
  return [...builtin, ...user, ...remote]
}

// ─── 壁纸帧捕获（用于组件毛玻璃效果）───
// video/image 类型由壁纸渲染进程 canvas 抽帧，通过 IPC 中转
// web 类型与渲染端断帧场景由主进程 capturePage 兜底
let captureTimer: ReturnType<typeof setInterval> | null = null
const captureInFlight = new Set<string>()
let wallpaperFrameDemanded = false
const lastRendererFrameAt = new Map<string, number>()
const rendererFrameSeen = new Set<string>()
const fallbackCaptureActive = new Set<string>()
const RENDERER_FRAME_STALE_MS = 1_250

async function captureWallpaperFrameFallback(): Promise<void> {
  if (!wallpaperFrameDemanded || isDesktopOccluded()) return
  const canvas = getCanvasWindow()
  if (!canvas || canvas.isDestroyed() || canvas.webContents.isDestroyed()) return

  for (const wp of getWallpaperWindows()) {
    if (wp.isDestroyed() || wp.webContents.isDestroyed()) continue
    const target = getWallpaperWindowTarget(wp.webContents.id)
    if (!target?.displayKey || captureInFlight.has(target.displayKey)) continue
    if (Date.now() - (lastRendererFrameAt.get(target.displayKey) ?? 0) < RENDERER_FRAME_STALE_MS) continue
    if (!fallbackCaptureActive.has(target.displayKey)) {
      fallbackCaptureActive.add(target.displayKey)
      console.warn(`[wallpaper:${target.displayKey}] renderer frames stale; using main capture fallback`)
    }

    captureInFlight.add(target.displayKey)
    try {
      const img = await wp.webContents.capturePage()
      const width = 768
      const height = Math.max(1, Math.round(width * target.bounds.height / Math.max(1, target.bounds.width)))
      const resized = img.resize({ width, height, quality: 'good' })
      const data = `data:image/jpeg;base64,${resized.toJPEG(48).toString('base64')}`
      const payload: WallpaperFramePayload = {
        displayKey: target.displayKey,
        bounds: { ...target.bounds },
        data,
      }
      safeSendToWindow(canvas, IPC.WALLPAPER_FRAME, payload)
    } catch {
      // capturePage can fail while a window or frame is being replaced.
    } finally {
      captureInFlight.delete(target.displayKey)
    }
  }
}

function resetWallpaperFrameWatchdog(): void {
  const now = Date.now()
  lastRendererFrameAt.clear()
  rendererFrameSeen.clear()
  fallbackCaptureActive.clear()
  for (const win of getWallpaperWindows()) {
    const target = getWallpaperWindowTarget(win.webContents.id)
    if (target?.displayKey) lastRendererFrameAt.set(target.displayKey, now)
  }
}

function startMainCapture(): void {
  if (!wallpaperFrameDemanded || captureTimer) return
  void captureWallpaperFrameFallback()
  captureTimer = setInterval(() => void captureWallpaperFrameFallback(), 250)
}

function stopMainCapture(): void {
  if (captureTimer) {
    clearInterval(captureTimer)
    captureTimer = null
  }
}

export function registerWallpaperIpc(): void {
  let topologyTimer: ReturnType<typeof setTimeout> | undefined
  const reconcileTopology = (): void => {
    clearTimeout(topologyTimer)
    topologyTimer = setTimeout(() => {
      void withWallpaperChange(() => commitWallpaperDisplay(store.get('wallpaperDisplay')))
        .catch((error) => console.error('[wallpaper] topology reconciliation failed:', error))
    }, 220)
  }
  screen.on('display-added', reconcileTopology)
  screen.on('display-removed', reconcileTopology)
  screen.on('display-metrics-changed', reconcileTopology)
  ipcMain.handle(IPC.WALLPAPER_LIST, (event) => { assertTrustedIpcSender(event, ['main']); return listAllWallpapers() })
  ipcMain.handle(IPC.WALLPAPER_GET_CURRENT, (event) => { assertTrustedIpcSender(event, ['main', 'wallpaper']); return store.get('wallpaper') })
  ipcMain.handle(IPC.WALLPAPER_ATTACH_STATUS, (event) => { assertTrustedIpcSender(event, ['main']); return isWallpaperAttached() })
  ipcMain.handle(IPC.WALLPAPER_DISPLAY_GET_SETTINGS, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return getWallpaperDisplaySettings()
  })
  ipcMain.handle(IPC.WALLPAPER_DISPLAY_GET_LAYOUT, (event) => {
    assertTrustedIpcSender(event, ['wallpaper'])
    return buildWallpaperDisplayLayout(event.sender.id)
  })
  ipcMain.handle(IPC.WALLPAPER_DISPLAY_SET_MODE, async (event, mode: WallpaperDisplayMode) => {
    assertTrustedIpcSender(event, ['main'])
    if (!['primary', 'duplicate', 'per-display', 'span'].includes(mode)) throw new Error('不支持的显示器壁纸模式')
    return withWallpaperChange(async () => {
      await commitWallpaperDisplay({ ...store.get('wallpaperDisplay'), mode, schemaVersion: WALLPAPER_DISPLAY_SCHEMA_VERSION, userConfigured: true })
      return getWallpaperDisplaySettings()
    })
  })
  ipcMain.handle(IPC.WALLPAPER_DISPLAY_SET_ASSIGNMENT, async (event, displayId: number, wallpaperId: string | null) => {
    assertTrustedIpcSender(event, ['main'])
    if (!Number.isInteger(displayId)) throw new Error('无效的显示器')
    return withWallpaperChange(async () => {
      const display = getDisplayDescriptors().find((item) => item.id === displayId)
      if (!display) throw new Error('显示器不存在')
      const assignments = { ...(store.get('wallpaperDisplay')?.assignments ?? {}) }
      const displayKey = getDisplayStorageKey(display)
      delete assignments[String(displayId)]
      delete assignments['electron:' + displayId]
      if (wallpaperId === null || wallpaperId === '') delete assignments[displayKey]
      else {
        if (!(await listAllWallpapers()).some((item) => item.id === wallpaperId)) throw new Error('壁纸不存在')
        assignments[displayKey] = wallpaperId
      }
      await commitWallpaperDisplay({ mode: 'per-display', assignments, schemaVersion: WALLPAPER_DISPLAY_SCHEMA_VERSION, userConfigured: true })
      return getWallpaperDisplaySettings()
    })
  })

  ipcMain.on(IPC.WALLPAPER_FRAME, (_e, data: string) => {
    if (!isWallpaperWebContents(_e.sender.id)) return
    if (typeof data !== 'string' || data.length > 5 * 1024 * 1024 || !data.startsWith('data:image/jpeg;base64,')) return
    if (!wallpaperFrameDemanded || isDesktopOccluded()) return
    const target = getWallpaperWindowTarget(_e.sender.id)
    if (!target?.displayKey) return
    lastRendererFrameAt.set(target.displayKey, Date.now())
    if (!rendererFrameSeen.has(target.displayKey)) {
      rendererFrameSeen.add(target.displayKey)
      console.log(`[wallpaper:${target.displayKey}] renderer frame stream active`)
    }
    if (fallbackCaptureActive.delete(target.displayKey)) {
      console.log(`[wallpaper:${target.displayKey}] renderer frame stream recovered; fallback idle`)
    }
    const canvas = getCanvasWindow()
    const payload: WallpaperFramePayload = {
      displayKey: target.displayKey,
      bounds: { ...target.bounds },
      data,
    }
    safeSendToWindow(canvas, IPC.WALLPAPER_FRAME, payload)
  })

  ipcMain.on(IPC.WALLPAPER_CAPTURE_DEMAND, (event, enabled: boolean) => {
    if (event.sender.id !== getCanvasWindow()?.webContents.id || typeof enabled !== 'boolean') return
    wallpaperFrameDemanded = enabled
    sendToWallpaperWindows(IPC.WALLPAPER_CAPTURE_DEMAND, enabled)
    if (!enabled) {
      stopMainCapture()
      resetWallpaperFrameWatchdog()
    } else {
      resetWallpaperFrameWatchdog()
      startMainCapture()
    }
  })

  ipcMain.on(IPC.WALLPAPER_READY, async (_e, payload?: { itemId?: string; source?: string }) => {
    if (!isWallpaperWebContents(_e.sender.id)) return
    if (payload?.itemId && (typeof payload.itemId !== 'string' || payload.itemId.length > 1024)) return
    if (payload?.source && (typeof payload.source !== 'string' || payload.source.length > 32_768)) return
    const layout = await buildWallpaperDisplayLayout(_e.sender.id)
    const expected = layout?.displays[0]?.item
    if (!expected) return
    if (payload?.itemId && payload.itemId !== expected.id) return
    if (payload?.source && payload.source !== expected.source) return
    const senderWindow = getWallpaperWindows().find((win) => win.webContents.id === _e.sender.id)
    if (!senderWindow) return
    safeSendToWindow(senderWindow, IPC.WALLPAPER_CAPTURE_DEMAND, wallpaperFrameDemanded)
    const target = getWallpaperWindowTarget(_e.sender.id)
    if (target?.displayKey) lastRendererFrameAt.set(target.displayKey, Date.now())
    // READY may arrive after the edge-triggered occlusion event, so always resync it.
    safeSendToWindow(senderWindow, IPC.WALLPAPER_PAUSE_CAPTURE, isDesktopOccluded())
    if (wallpaperFrameDemanded) startMainCapture()
    if (!isWallpaperAttached()) {
      await ensureWallpaperAttached(_e.sender.id)
      refreshCanvasZOrder()
    }
  })

  ipcMain.handle(IPC.WALLPAPER_APPLY, async (_e, item: WallpaperItem, target: WallpaperApplyTarget = 'current') => {
    assertTrustedIpcSender(_e, ['main'])
    if (target !== 'current' && target !== 'all' && !Number.isInteger(target)) throw new Error('无效的壁纸显示目标')
    return withWallpaperChange(async () => {
      await applyWallpaperItem(item, target)
      return true
    })
  })

  // 保存单个壁纸的独立设置
  ipcMain.handle(
    IPC.WALLPAPER_SAVE_SETTINGS,
    async (_e, wallpaperId: string, settings: WallpaperSettings) => {
      assertTrustedIpcSender(_e, ['main'])
      await queueWallpaperSettings(wallpaperId, settings)
      return true
    }
  )

  // 实时更新壁纸窗口的某个设置（如音量、速度）
  ipcMain.handle(
    IPC.WALLPAPER_UPDATE_SETTING,
    async (_e, wallpaperId: string, key: string, value: unknown) => {
      assertTrustedIpcSender(_e, ['main'])
      await queueWallpaperSettings(wallpaperId, { [key]: value })
      return true
    }
  )

  ipcMain.handle(IPC.WALLPAPER_PICK_FILE, async (_event) => {
    assertTrustedIpcSender(_event, ['main'])
    const result = await dialog.showOpenDialog({
      title: '选择本地壁纸',
      properties: ['openFile'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4', 'webm', 'mkv', 'mov',
            'jpg', 'jpeg', 'png', 'gif', 'webp',
            'html', 'zip',
          ],
        },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    const ext = extname(file).toLowerCase()
    if (ext !== '.zip') await allowUserSelectedAsset(file)
    const type: WallpaperItem['type'] = VIDEO_EXT.has(ext)
      ? 'video'
      : ext === '.html' || ext === '.htm' || ext === '.zip'
        ? 'web'
        : 'image'
    const item: WallpaperItem = {
      id: `local:${file}`,
      name: basename(file),
      source: file,
      type,
    }
    return item
  })

  ipcMain.handle(IPC.WALLPAPER_GRANT_PREVIEW, async (_event, filePath: string) => {
    assertTrustedIpcSender(_event, ['main'])
    try {
      const extension = extname(filePath).toLowerCase()
      if (!VIDEO_EXT.has(extension) && !IMAGE_EXT.has(extension)) return false
      await allowUserSelectedAsset(filePath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.WALLPAPER_REMOVE, async (_event, wallpaperId: string) => {
    assertTrustedIpcSender(_event, ['main'])
    if (!isUserWallpaperId(wallpaperId)) return { ok: false, error: '只能删除用户导入的本地壁纸' }
    return withWallpaperChange(async () => {
      let release: (() => void) | undefined
      try {
        release = beginWallpaperResourceMutation(wallpaperId)
        await fs.rm(join(getUserWallpapersRoot(), getUserWallpaperFolderName(wallpaperId)), { recursive: true, force: true })
        await fs.rm(getWallpaperOverrideDir(wallpaperId), { recursive: true, force: true })
        notifyDisplaySettingsChanged()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        release?.()
      }
    })
  })

  // 导入壁纸：将文件复制到用户数据目录，创建配置，生成预览
  // 支持：视频、图片、HTML（仅单文件，依赖资源使用 ZIP）、ZIP（解压为网页壁纸）
  ipcMain.handle(
    IPC.WALLPAPER_IMPORT,
    async (
      _e,
      filePath: string,
      meta: { name: string; desc: string; author: string; contact: string }
    ): Promise<{ ok: boolean; item?: WallpaperItem; error?: string }> => {
      assertTrustedIpcSender(_e, ['main'])
      // Source metadata such as "flowwall" is only set by the main process, never by the renderer.
      return importWallpaperFile(filePath, { name: meta.name, desc: meta.desc, author: meta.author, contact: meta.contact })
    }
  )
}

export interface WallpaperImportMeta {
  name: string
  desc: string
  author: string
  contact: string
  /** Extra FlowWallDeskInfo fields, e.g. where an online download came from. */
  extra?: Record<string, unknown>
}

/**
 * Copy a video / image / HTML / ZIP into the user wallpaper library with its
 * FlowWallDeskInfo.json. Shared by manual import and online-library downloads.
 */
export async function importWallpaperFile(filePath: string, meta: WallpaperImportMeta): Promise<{ ok: boolean; item?: WallpaperItem; error?: string }> {
  let createdFolder: string | undefined
  try {
    const ext = extname(filePath).toLowerCase()
    const isZip = ext === '.zip'
    const isHtml = ext === '.html' || ext === '.htm'
    if (!VIDEO_EXT.has(ext) && !IMAGE_EXT.has(ext) && !isHtml && !isZip) throw new Error('不支持的壁纸文件格式')
    const type: WallpaperItem['type'] = VIDEO_EXT.has(ext)
      ? 'video'
      : isHtml || isZip
        ? 'web'
        : 'image'

    // 用壁纸名字做用户数据目录下的文件夹名
    const displayName = meta.name.trim() || basename(filePath, ext)
    const safeName = sanitizeUserDataSegment(displayName, 'wallpaper')
    const root = getUserWallpapersRoot()
    let folderName = safeName
    let folder = join(root, folderName)

    // 避免重名
    let counter = 1
    while (true) {
      try {
        await fs.access(folder)
        folderName = `${safeName}_${counter++}`
        folder = join(root, folderName)
      } catch {
        break
      }
    }

    await fs.mkdir(folder, { recursive: true })
    createdFolder = folder

    let mainFileName: string

    if (isZip) {
      // ZIP 解压到目标文件夹
      await extractZip(filePath, folder)
      // 在解压后的文件中查找 index.html 或第一个 .html
      const entry = await findHtmlEntry(folder)
      if (!entry) throw new Error('ZIP 中没有找到 HTML 入口，请提供包含 index.html 的壁纸包。')
      mainFileName = entry
    } else {
      // 视频/图片：单文件复制
      mainFileName = basename(filePath)
      const destFile = join(folder, mainFileName)
      await fs.copyFile(filePath, destFile)
    }

    // 创建 FlowWallDeskInfo.json
    const typeNum = type === 'web' ? 1 : type === 'video' ? 7 : 11
    const info: FlowWallDeskInfo = {
      ...(meta.extra ?? {}),
      Title: displayName,
      Desc: meta.desc || '',
      Author: meta.author || '',
      Contact: meta.contact || '',
      Type: typeNum,
      FileName: mainFileName,
      Tags: [type],
      Id: folderName,
    }

    // 如果是图片类型，源文件本身就是预览
    if (type === 'image') {
      info.Thumbnail = mainFileName
      info.Preview = mainFileName
    }

    await fs.writeFile(
      join(folder, 'FlowWallDeskInfo.json'),
      JSON.stringify(info, null, 2),
      'utf-8'
    )

    const destSource = join(folder, mainFileName)

    // 如果是视频，生成 GIF 预览
    let preview: string | undefined
    if (type === 'video') {
      preview = await generateVideoPreviewGif(destSource, folder)
    } else if (type === 'image') {
      preview = destSource
    }

    const item: WallpaperItem = {
      id: toUserWallpaperId(folderName),
      name: displayName,
      source: destSource,
      type,
      preview,
      meta: info as unknown as Record<string, unknown>,
    }

    return { ok: true, item }
  } catch (err) {
    if (createdFolder) await fs.rm(createdFolder, { recursive: true, force: true }).catch(() => undefined)
    console.error('[wallpaper] 导入失败:', err)
    return { ok: false, error: String(err) }
  }
}

/**
 * 安全解压用户选择的 ZIP，规则与在线壁纸包保持一致。
 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  return extractZipSafely(zipPath, destDir, {
    maxEntries: 100_000,
    maxUncompressedBytes: MAX_IMPORTED_ZIP_BYTES,
  })
}

/**
 * 在目录中查找 HTML 入口文件
 */
async function findHtmlEntry(dir: string): Promise<string | null> {
  // 先在当前层查找
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const htmlFiles = entries.filter(
    (e) => e.isFile() && /\.(html|htm)$/i.test(e.name)
  )
  // 优先 index.html
  const idx = htmlFiles.find((e) => e.name.toLowerCase() === 'index.html')
  if (idx) return idx.name

  // 如果当前层只有一个子目录且无 HTML，进入子目录
  const dirs = entries.filter((e) => e.isDirectory())
  if (htmlFiles.length === 0 && dirs.length === 1) {
    const subEntries = await fs.readdir(join(dir, dirs[0].name), { withFileTypes: true })
    const subHtml = subEntries.filter(
      (e) => e.isFile() && /\.(html|htm)$/i.test(e.name)
    )
    const subIdx = subHtml.find((e) => e.name.toLowerCase() === 'index.html')
    if (subIdx) return join(dirs[0].name, subIdx.name)
    if (subHtml[0]) return join(dirs[0].name, subHtml[0].name)
  }

  if (htmlFiles[0]) return htmlFiles[0].name
  return null
}

/** 应用启动时恢复上次的壁纸 */
export async function restoreWallpaper(): Promise<void> {
  const previous = store.get('wallpaper')
  if (previous.current && !/^[a-z]+:\/\//i.test(previous.current.source)) {
    try {
      await allowUserSelectedAsset(previous.current.source)
    } catch {
      // 内置和 userData 壁纸已由根目录授权，不需要额外授权。
    }
  }
  await withWallpaperChange(() => commitWallpaperDisplay(store.get('wallpaperDisplay')))
  const state = store.get('wallpaper')
  if (!state.current) return
  const windows = getWallpaperWindows()
  if (windows.length === 0) return
  const send = (win: BrowserWindow) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    console.log(`[wallpaper] restore 布局到 renderer ${win.webContents.id}:`, state.current?.name)
    void broadcastWallpaperDisplayLayout()
    resetWallpaperFrameWatchdog()
    if (wallpaperFrameDemanded) startMainCapture()
  }
  for (const win of windows) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => send(win))
    else send(win)
  }
}
