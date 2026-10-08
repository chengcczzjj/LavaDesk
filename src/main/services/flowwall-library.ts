import { app, BrowserWindow, WebContentsView, dialog, session, shell, type DownloadItem, type Session, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync, promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import {
  FLOWWALL_HOME_URL,
  FLOWWALL_MAX_DOWNLOAD_BYTES,
  FLOWWALL_PARTITION,
  classifyFlowWallDownload,
  classifyFlowWallNavigation,
  cleanFlowWallTitle,
  normalizeSourceUrl,
  signatureMatchesKind,
  type FlowWallDownload,
  type FlowWallDownloadKind,
  type FlowWallViewState,
  type LingyueDeepLink,
} from '@shared/flowwall'
import { detectMediaSignature } from '@shared/media-signature'
import { store } from '../store'
import { getWallpaperDownloadsRoot, sanitizeUserDataSegment } from '../runtime/userDataPaths'
import { importWallpaperFile, listWallpapersForTool } from '../ipc/wallpaperIpc'

/**
 * FlowWall's discover page runs in a WebContentsView layered over the main
 * window: its own persistent partition (the user's FlowWall login stays in the
 * app, separate from the system browser), no preload, no Node, sandboxed.
 * Downloads started by the site's own buttons are captured, checked by content
 * and imported into "我的壁纸".
 */

const KEEP_DOWNLOADS = 60
const EXTENSIONS_FOR_SIGNATURE: Record<string, string> = { mp4: '.mp4', webm: '.webm', png: '.png', jpeg: '.jpg', gif: '.gif', webp: '.webp', zip: '.zip' }

/** Development builds may point the view at a local stand-in site for end-to-end tests. */
function homeUrl(): string {
  const override = process.env.LINGYUE_FLOWWALL_HOME
  return !app.isPackaged && override && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(override) ? override : FLOWWALL_HOME_URL
}

let view: WebContentsView | null = null
let hostWindow: BrowserWindow | null = null
let pendingUrl: string | null = null
let lastError: string | undefined
let sessionReady = false
const active = new Map<string, { item: DownloadItem; download: FlowWallDownload }>()

function readDownloads(): FlowWallDownload[] {
  const value = store.get('flowwallDownloads')
  return Array.isArray(value) ? value.filter((item): item is FlowWallDownload => Boolean(item && typeof item.id === 'string')) : []
}

function saveDownload(download: FlowWallDownload): void {
  const rest = readDownloads().filter((item) => item.id !== download.id)
  store.set('flowwallDownloads', [download, ...rest].slice(0, KEEP_DOWNLOADS))
}

function mainWindow(): BrowserWindow | null {
  return hostWindow && !hostWindow.isDestroyed() ? hostWindow : null
}

function notify(channel: string, payload: unknown): void {
  const win = mainWindow()
  if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
}

function emitDownload(download: FlowWallDownload): void {
  if (download.state !== 'downloading' && download.state !== 'importing') saveDownload(download)
  notify(IPC.FLOWWALL_DOWNLOAD_CHANGED, download)
}

export function getFlowWallViewState(): FlowWallViewState {
  const contents = view?.webContents
  if (!contents || contents.isDestroyed()) {
    return { url: pendingUrl ?? homeUrl(), title: 'FlowWall 发现', loading: false, canGoBack: false, canGoForward: false, error: lastError }
  }
  return {
    url: contents.getURL() || pendingUrl || homeUrl(),
    title: contents.getTitle() || 'FlowWall 发现',
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    error: lastError,
  }
}

function emitViewState(): void {
  notify(IPC.FLOWWALL_VIEW_STATE, getFlowWallViewState())
}

export function listFlowWallDownloads(): FlowWallDownload[] {
  const running = [...active.values()].map((entry) => entry.download)
  const finished = readDownloads().filter((item) => !active.has(item.id))
  return [...running, ...finished]
}

/** An earlier download of the same file that is still in the library. */
async function findExistingImport(url: string): Promise<FlowWallDownload | undefined> {
  const key = normalizeSourceUrl(url)
  const previous = readDownloads().find((item) => item.state === 'completed' && item.wallpaperId && normalizeSourceUrl(item.url) === key)
  if (!previous?.wallpaperId) return undefined
  const library = await listWallpapersForTool()
  return library.some((item) => item.id === previous.wallpaperId) ? previous : undefined
}

async function importDownloaded(download: FlowWallDownload, filePath: string): Promise<void> {
  download.state = 'importing'
  emitDownload(download)
  try {
    const handle = await fs.open(filePath, 'r')
    const head = Buffer.alloc(16)
    await handle.read(head, 0, 16, 0)
    await handle.close()
    const signature = detectMediaSignature(head)
    if (!signatureMatchesKind(signature, download.kind)) {
      throw new Error(download.kind === 'package' ? '下载的文件不是有效的壁纸包' : '下载的文件不是有效的视频或图片')
    }
    // Name the file by what it really is, so the library picks the right player.
    const expected = EXTENSIONS_FOR_SIGNATURE[signature as string]
    let source = filePath
    if (expected && !filePath.toLowerCase().endsWith(expected)) {
      source = filePath.replace(/\.[a-z0-9]+$/i, '') + expected
      await fs.rename(filePath, source)
    }
    const result = await importWallpaperFile(source, {
      name: download.title,
      desc: 'FlowWall 在线壁纸',
      author: 'FlowWall',
      contact: download.pageUrl ?? '',
      extra: {
        Source: 'flowwall',
        SourceUrl: normalizeSourceUrl(download.url),
        PageUrl: download.pageUrl ?? '',
        DownloadedAt: new Date().toISOString(),
      },
    })
    if (!result.ok || !result.item) throw new Error(result.error || '导入壁纸库失败')
    download.state = 'completed'
    download.wallpaperId = result.item.id
  } catch (error) {
    download.state = 'failed'
    download.error = (error as Error).message
  } finally {
    download.finishedAt = Date.now()
    await fs.rm(join(filePath, '..'), { recursive: true, force: true }).catch(() => undefined)
    emitDownload(download)
  }
}

function handleWillDownload(item: DownloadItem, contents: WebContents | undefined, hint?: { title?: string; pageUrl?: string }): void {
  const url = item.getURL()
  const classified = classifyFlowWallDownload({ filename: item.getFilename(), mimeType: item.getMimeType(), url })
  // Not a wallpaper (documents, installers...): leave it to Electron's normal save dialog.
  if (!classified) return
  const pageUrl = hint?.pageUrl ?? (contents && !contents.isDestroyed() ? contents.getURL() : undefined)
  const pageTitle = hint?.title ?? (contents && !contents.isDestroyed() ? contents.getTitle() : undefined)
  const download: FlowWallDownload = {
    id: randomUUID(),
    title: hint?.title ?? cleanFlowWallTitle(pageTitle, item.getFilename()),
    url,
    pageUrl,
    kind: classified.kind as FlowWallDownloadKind,
    state: 'downloading',
    receivedBytes: 0,
    totalBytes: item.getTotalBytes(),
    startedAt: Date.now(),
  }
  if (download.totalBytes > FLOWWALL_MAX_DOWNLOAD_BYTES) {
    item.cancel()
    emitDownload({ ...download, state: 'failed', error: '文件超过 2 GB，暂不支持作为壁纸导入。', finishedAt: Date.now() })
    return
  }
  const folder = join(getWallpaperDownloadsRoot(), download.id)
  const filename = sanitizeUserDataSegment(item.getFilename().replace(/\.[a-z0-9]{2,5}$/i, ''), 'wallpaper') + classified.extension
  mkdirSync(folder, { recursive: true })
  item.setSavePath(join(folder, filename))
  active.set(download.id, { item, download })
  emitDownload(download)

  // Small files can finish before the library lookup does, so 'done' waits for this answer too.
  const duplicateCheck = findExistingImport(url).catch(() => undefined)
  void duplicateCheck.then((existing) => {
    if (existing && item.getState() === 'progressing') item.cancel()
  })

  item.on('updated', () => {
    download.receivedBytes = item.getReceivedBytes()
    download.totalBytes = item.getTotalBytes() || download.totalBytes
    if (download.receivedBytes > FLOWWALL_MAX_DOWNLOAD_BYTES) {
      item.cancel()
      return
    }
    notify(IPC.FLOWWALL_DOWNLOAD_CHANGED, download)
  })
  item.once('done', async (_event, state) => {
    const existing = await duplicateCheck
    active.delete(download.id)
    download.receivedBytes = item.getReceivedBytes()
    if (existing) {
      void fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
      emitDownload({ ...download, state: 'duplicate', wallpaperId: existing.wallpaperId, title: existing.title, finishedAt: Date.now() })
      return
    }
    if (state === 'completed') {
      void importDownloaded(download, item.getSavePath())
      return
    }
    download.state = state === 'cancelled' ? 'cancelled' : 'failed'
    download.error = state === 'interrupted' ? '下载中断了，可以在 FlowWall 页面上重新下载。' : download.receivedBytes > FLOWWALL_MAX_DOWNLOAD_BYTES ? '文件超过 2 GB，暂不支持作为壁纸导入。' : undefined
    download.finishedAt = Date.now()
    void fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
    emitDownload(download)
  })
}

let downloadHint: { url: string; title?: string; pageUrl?: string } | null = null

function flowWallSession(): Session {
  const ses = session.fromPartition(FLOWWALL_PARTITION)
  if (sessionReady) return ses
  sessionReady = true
  // The site needs no camera, microphone, location or notifications from inside the app.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen')
  })
  ses.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write' || permission === 'fullscreen')
  ses.on('will-download', (_event, item, contents) => {
    const hint = downloadHint && downloadHint.url === item.getURL() ? downloadHint : undefined
    downloadHint = null
    handleWillDownload(item, contents, hint)
  })
  return ses
}

function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    const target = classifyFlowWallNavigation(url)
    if (target === 'internal') {
      void contents.loadURL(url)
    } else if (target === 'auth') {
      // Sign-in popups keep window.opener so the provider can hand the result back.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: { partition: FLOWWALL_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      }
    } else if (target === 'media') {
      contents.downloadURL(url)
    } else if (target === 'external') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const target = classifyFlowWallNavigation(url)
    if (target === 'internal' || target === 'auth') return
    event.preventDefault()
    if (target === 'media') contents.downloadURL(url)
    else if (target === 'external') void shell.openExternal(url)
  })
  contents.on('did-create-window', (child) => {
    guardContents(child.webContents)
  })
}

function ensureView(win: BrowserWindow): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view
  flowWallSession()
  view = new WebContentsView({
    webPreferences: {
      partition: FLOWWALL_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  view.setBackgroundColor('#ffffff')
  const contents = view.webContents
  guardContents(contents)
  contents.on('did-start-loading', () => {
    lastError = undefined
    emitViewState()
  })
  contents.on('did-stop-loading', emitViewState)
  contents.on('page-title-updated', emitViewState)
  contents.on('did-navigate', emitViewState)
  contents.on('did-navigate-in-page', emitViewState)
  // Focus sits inside the page while browsing, so the usual browser keys are handled here.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key
    let action: 'back' | 'forward' | 'reload' | 'stop' | null = null
    if (input.alt && key === 'ArrowLeft') action = 'back'
    else if (input.alt && key === 'ArrowRight') action = 'forward'
    else if (key === 'F5' || ((input.control || input.meta) && key.toLowerCase() === 'r')) action = 'reload'
    else if (key === 'Escape' && contents.isLoading()) action = 'stop'
    if (!action) return
    event.preventDefault()
    navigateFlowWall(action)
  })
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3: aborted by a newer navigation
    lastError = code === -106 || code === -105 || code === -118
      ? '网络连不上 FlowWall，检查一下网络后重试。'
      : `页面没有打开（${description || code}）。`
    emitViewState()
  })
  win.on('closed', () => {
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
    view = null
    hostWindow = null
  })
  void contents.loadURL(pendingUrl ?? homeUrl())
  pendingUrl = null
  return view
}

export interface FlowWallBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Show the page over the placeholder the renderer reports (CSS pixels = DIPs at zoom 1). */
export function attachFlowWallView(win: BrowserWindow, bounds: FlowWallBounds): FlowWallViewState {
  hostWindow = win
  const current = ensureView(win)
  if (!win.contentView.children.includes(current)) win.contentView.addChildView(current)
  current.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  })
  current.setVisible(bounds.width > 0 && bounds.height > 0)
  if (pendingUrl) {
    void current.webContents.loadURL(pendingUrl)
    pendingUrl = null
  }
  return getFlowWallViewState()
}

/** Leaving the page (or a dialog over it) hides the view but keeps its session and history. */
export function detachFlowWallView(): void {
  const win = mainWindow()
  if (win && view && win.contentView.children.includes(view)) win.contentView.removeChildView(view)
}

export function navigateFlowWall(action: 'back' | 'forward' | 'reload' | 'home' | 'stop' | { url: string }): FlowWallViewState {
  const contents = view?.webContents
  if (typeof action === 'object') {
    const target = classifyFlowWallNavigation(action.url) === 'internal' ? action.url : homeUrl()
    if (contents && !contents.isDestroyed()) void contents.loadURL(target)
    else pendingUrl = target
    return getFlowWallViewState()
  }
  if (!contents || contents.isDestroyed()) {
    if (action === 'home') pendingUrl = homeUrl()
    return getFlowWallViewState()
  }
  if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
  else if (action === 'reload') {
    lastError = undefined
    contents.reload()
  } else if (action === 'stop') contents.stop()
  else if (action === 'home') void contents.loadURL(homeUrl())
  return getFlowWallViewState()
}

export function openFlowWallInBrowser(): void {
  const url = getFlowWallViewState().url
  void shell.openExternal(classifyFlowWallNavigation(url) === 'internal' ? url : FLOWWALL_HOME_URL)
}

export function cancelFlowWallDownload(id: string): boolean {
  const entry = active.get(id)
  if (!entry) return false
  entry.item.cancel()
  return true
}

export function clearFinishedFlowWallDownloads(): FlowWallDownload[] {
  store.set('flowwallDownloads', [])
  return listFlowWallDownloads()
}

/** Queue the next page for the embedded view (used before the library page mounts). */
export function setFlowWallPendingUrl(url: string): void {
  if (view && !view.webContents.isDestroyed()) void view.webContents.loadURL(url)
  else pendingUrl = url
}

/**
 * Handle a lingyue:// link a web page opened. Opening the library needs no
 * confirmation; importing a file always asks first and names the host.
 */
export async function handleLingyueDeepLink(link: LingyueDeepLink, win: BrowserWindow): Promise<void> {
  hostWindow = win
  if (link.action === 'open-library') {
    setFlowWallPendingUrl(link.pageUrl)
    return
  }
  const host = new URL(link.mediaUrl).hostname
  const answer = await dialog.showMessageBox(win, {
    type: link.trustedHost ? 'question' : 'warning',
    buttons: ['下载并加入我的壁纸', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '添加在线壁纸',
    message: `要把「${link.title ?? '这张壁纸'}」下载到 LavaDesk 吗？`,
    detail: link.trustedHost
      ? `来源：${host}（FlowWall）`
      : `来源：${host}\n这个地址不属于 FlowWall，请确认你信任它。下载后仍会检查文件是否为视频或图片。`,
  })
  if (answer.response !== 0) return
  downloadHint = { url: link.mediaUrl, title: link.title, pageUrl: link.pageUrl }
  flowWallSession().downloadURL(link.mediaUrl)
}
