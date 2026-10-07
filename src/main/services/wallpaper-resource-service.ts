import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import {
  isValidWallpaperResourceId,
  resolveWallpaperResourceInstallState,
  WALLPAPER_RESOURCE_ID_PATTERN,
  WALLPAPER_RESOURCE_VERSION_PATTERN,
} from '@shared/wallpaper-resource'
import type {
  WallpaperResourceActionResult,
  WallpaperResourceCatalog,
  WallpaperResourceCatalogItem,
  WallpaperResourceEntry,
  WallpaperResourceProgress,
} from '@shared/types'
import {
  getRemoteWallpapersRoot,
  getWallpaperOverrideDir,
  getWallpaperResourceCacheRoot,
  getWallpaperResourceManifestCachePath,
  toRemoteWallpaperId,
} from '../runtime/userDataPaths'
import { beginWallpaperResourceMutation } from './wallpaper-usage'
import { getMainWindow } from '../windows/mainWindow'
import { extractZipSafely } from './safe-zip'

export const OFFICIAL_WALLPAPER_REPOSITORY = 'chengcczzjj/LavaDesk-Wallpapers'
export const OFFICIAL_WALLPAPER_MANIFEST_URL =
  `https://raw.githubusercontent.com/${OFFICIAL_WALLPAPER_REPOSITORY}/main/manifest.json`

const MANIFEST_MEMORY_TTL_MS = 5 * 60 * 1000
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 100_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const INITIAL_MANIFEST_REFRESH_DELAY_MS = 20_000
const MANIFEST_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const RESOURCE_METADATA_FILE = '.lingyue-resource.json'
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mkv', '.mov', '.avi',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.html', '.htm',
])

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', {
  message: '必须使用 HTTPS 地址',
})

const resourceEntrySchema = z.object({
  id: z.string().regex(WALLPAPER_RESOURCE_ID_PATTERN),
  title: z.string().trim().min(1).max(200),
  type: z.enum(['video', 'image', 'web']),
  version: z.string().trim().regex(WALLPAPER_RESOURCE_VERSION_PATTERN).max(64),
  size: z.number().int().positive().max(MAX_PACKAGE_BYTES),
  previewUrl: httpsUrl.optional(),
  packageUrl: httpsUrl,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  author: z.string().max(200).optional(),
  license: z.string().max(200).optional(),
  updatedAt: z.string().max(64).optional(),
})

const resourceManifestSchema = z.object({
  version: z.number().int().positive().optional(),
  schemaVersion: z.number().int().positive().optional(),
  updatedAt: z.string().max(64).optional(),
  wallpapers: z.array(resourceEntrySchema).max(10_000),
})

interface WallpaperResourceManifest {
  version?: number
  schemaVersion?: number
  updatedAt?: string
  wallpapers: WallpaperResourceEntry[]
}

interface InstalledResourceMetadata {
  id: string
  version: string
  sha256: string
  packageUrl: string
  installedAt: string
}

let memoryManifest: {
  manifest: WallpaperResourceManifest
  fetchedAt: number
  source: WallpaperResourceCatalog['source']
  warning?: string
} | null = null
let catalogPromise: Promise<WallpaperResourceCatalog> | null = null
const activeInstalls = new Map<string, Promise<WallpaperResourceActionResult>>()
const transientStates = new Map<string, Pick<WallpaperResourceCatalogItem, 'installState' | 'error'>>()
let manifestRefreshInitialized = false
let initialManifestTimer: ReturnType<typeof setTimeout> | null = null
let manifestRefreshTimer: ReturnType<typeof setInterval> | null = null

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300) || '未知错误'
}

function isInside(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function publishProgress(progress: WallpaperResourceProgress): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(IPC.WALLPAPER_RESOURCE_PROGRESS, progress)
}

function publishCatalogChanged(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(IPC.WALLPAPER_RESOURCE_CATALOG_CHANGED)
}

function setTransientState(
  wallpaperId: string,
  installState: WallpaperResourceCatalogItem['installState'],
  error?: string,
): void {
  transientStates.set(wallpaperId, { installState, error })
}

export function parseWallpaperResourceManifest(input: unknown): WallpaperResourceManifest {
  const parsed = resourceManifestSchema.parse(input)
  const ids = new Set<string>()
  for (const entry of parsed.wallpapers) {
    if (ids.has(entry.id)) throw new Error(`远程壁纸清单包含重复 ID：${entry.id}`)
    ids.add(entry.id)
  }
  return parsed
}

async function fetchManifestFromNetwork(): Promise<WallpaperResourceManifest> {
  const response = await fetch(OFFICIAL_WALLPAPER_MANIFEST_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`在线壁纸清单请求失败（HTTP ${response.status}）`)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('在线壁纸清单超过大小限制')
  const manifest = parseWallpaperResourceManifest(JSON.parse(text))
  const cachePath = getWallpaperResourceManifestCachePath()
  await fs.mkdir(dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(manifest, null, 2), 'utf8')
  publishCatalogChanged()
  return manifest
}

async function readCachedManifest(): Promise<WallpaperResourceManifest> {
  const text = await fs.readFile(getWallpaperResourceManifestCachePath(), 'utf8')
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('本地壁纸清单缓存超过大小限制')
  return parseWallpaperResourceManifest(JSON.parse(text))
}

async function loadManifest(forceNetwork: boolean): Promise<{
  manifest: WallpaperResourceManifest
  source: WallpaperResourceCatalog['source']
  warning?: string
}> {
  if (!forceNetwork && memoryManifest && Date.now() - memoryManifest.fetchedAt < MANIFEST_MEMORY_TTL_MS) {
    return {
      manifest: memoryManifest.manifest,
      source: memoryManifest.source,
      warning: memoryManifest.warning,
    }
  }

  try {
    const manifest = await fetchManifestFromNetwork()
    memoryManifest = { manifest, fetchedAt: Date.now(), source: 'network' }
    return { manifest, source: 'network' }
  } catch (networkError) {
    try {
      const manifest = await readCachedManifest()
      const warning = `在线资源暂时不可用，正在显示本地缓存：${safeError(networkError)}`
      memoryManifest = { manifest, fetchedAt: Date.now(), source: 'cache', warning }
      return {
        manifest,
        source: 'cache',
        warning,
      }
    } catch {
      return {
        manifest: { wallpapers: [] },
        source: 'empty',
        warning: `在线壁纸库尚不可用：${safeError(networkError)}`,
      }
    }
  }
}

async function readInstalledMetadata(resourceId: string): Promise<InstalledResourceMetadata | null> {
  try {
    const text = await fs.readFile(join(getRemoteWallpapersRoot(), resourceId, RESOURCE_METADATA_FILE), 'utf8')
    const data = JSON.parse(text) as Partial<InstalledResourceMetadata>
    if (data.id !== resourceId || typeof data.version !== 'string') return null
    return data as InstalledResourceMetadata
  } catch {
    return null
  }
}

async function buildCatalog(forceNetwork: boolean): Promise<WallpaperResourceCatalog> {
  const loaded = await loadManifest(forceNetwork)
  const items = await Promise.all(loaded.manifest.wallpapers.map(async (entry) => {
    const installed = await readInstalledMetadata(entry.id)
    const transient = transientStates.get(entry.id)
    const installState = transient?.installState ?? resolveWallpaperResourceInstallState(
      installed?.version,
      entry.version,
    )
    return {
      ...entry,
      installState,
      installedVersion: installed?.version,
      localWallpaperId: installed ? toRemoteWallpaperId(entry.id) : undefined,
      error: transient?.error,
    } satisfies WallpaperResourceCatalogItem
  }))
  return {
    source: loaded.source,
    updatedAt: loaded.manifest.updatedAt,
    fetchedAt: Date.now(),
    items,
    warning: loaded.warning,
  }
}

export async function getWallpaperResourceCatalog(forceNetwork = false): Promise<WallpaperResourceCatalog> {
  if (catalogPromise) return catalogPromise
  catalogPromise = buildCatalog(forceNetwork).finally(() => {
    catalogPromise = null
  })
  return catalogPromise
}

export function initializeWallpaperResourceUpdates(): void {
  if (manifestRefreshInitialized) return
  manifestRefreshInitialized = true
  initialManifestTimer = setTimeout(() => {
    void getWallpaperResourceCatalog(true)
  }, INITIAL_MANIFEST_REFRESH_DELAY_MS)
  initialManifestTimer.unref()
  manifestRefreshTimer = setInterval(() => {
    void getWallpaperResourceCatalog(true)
  }, MANIFEST_REFRESH_INTERVAL_MS)
  manifestRefreshTimer.unref()
  process.once('exit', () => {
    if (initialManifestTimer) clearTimeout(initialManifestTimer)
    if (manifestRefreshTimer) clearInterval(manifestRefreshTimer)
  })
}

export function invalidateWallpaperResourceCatalog(): void {
  memoryManifest = null
}

export async function saveWallpaperResourceManifestCache(input: unknown): Promise<void> {
  const manifest = parseWallpaperResourceManifest(input)
  const cachePath = getWallpaperResourceManifestCachePath()
  await fs.mkdir(dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(manifest, null, 2), 'utf8')
  memoryManifest = { manifest, fetchedAt: Date.now(), source: 'cache' }
  publishCatalogChanged()
}

async function downloadPackage(entry: WallpaperResourceEntry, destination: string): Promise<string> {
  const response = await fetch(entry.packageUrl, {
    headers: { Accept: 'application/zip, application/octet-stream' },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) throw new Error(`壁纸包下载失败（HTTP ${response.status}）`)
  if (new URL(response.url).protocol !== 'https:') throw new Error('壁纸包下载被重定向到不安全地址')

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_PACKAGE_BYTES) throw new Error('壁纸包超过 2 GiB 限制')
  await fs.mkdir(dirname(destination), { recursive: true })

  const file = await fs.open(destination, 'w')
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let transferred = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      transferred += value.byteLength
      if (transferred > MAX_PACKAGE_BYTES) throw new Error('壁纸包超过 2 GiB 限制')
      hash.update(value)
      await file.write(value)
      const total = contentLength || entry.size
      publishProgress({
        wallpaperId: entry.id,
        phase: 'downloading',
        percent: total > 0 ? Math.min(95, transferred / total * 95) : 0,
        transferredBytes: transferred,
        totalBytes: total || undefined,
        message: `正在下载 ${entry.title}`,
      })
    }
  } finally {
    await file.close()
  }

  if (transferred !== entry.size) {
    throw new Error(`壁纸包大小不匹配（预期 ${entry.size}，实际 ${transferred}）`)
  }
  const digest = hash.digest('hex')
  if (digest !== entry.sha256.toLowerCase()) throw new Error('壁纸包 SHA-256 校验失败')
  return digest
}

async function containsWallpaperDescriptor(folder: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    return entries.some((entry) => (
      entry.isFile() && (entry.name === 'FlowWallDeskInfo.json' || MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    ))
  } catch {
    return false
  }
}

async function findWallpaperPackageRoot(extractedRoot: string): Promise<string> {
  if (await containsWallpaperDescriptor(extractedRoot)) return extractedRoot
  const entries = await fs.readdir(extractedRoot, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory())
  if (directories.length === 1) {
    const nested = join(extractedRoot, directories[0].name)
    if (await containsWallpaperDescriptor(nested)) return nested
  }
  throw new Error('壁纸包缺少有效的顶层资源或 FlowWallDeskInfo.json')
}

async function validateExtractedTree(root: string): Promise<void> {
  const rootReal = await fs.realpath(root)
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error('壁纸包不允许包含符号链接')
      const realPath = await fs.realpath(fullPath)
      if (!isInside(rootReal, realPath)) throw new Error('壁纸包包含越界路径')
      if (entry.isDirectory()) pending.push(fullPath)
    }
  }
}

async function validateWallpaperPackage(root: string): Promise<void> {
  await validateExtractedTree(root)
  const descriptorPath = join(root, 'FlowWallDeskInfo.json')
  let descriptor: { FileName?: unknown }
  try {
    descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8')) as { FileName?: unknown }
  } catch {
    throw new Error('远程壁纸包必须包含有效的 FlowWallDeskInfo.json')
  }
  if (typeof descriptor.FileName !== 'string' || !descriptor.FileName.trim()) {
    throw new Error('FlowWallDeskInfo.json 缺少 FileName')
  }
  const sourcePath = resolve(root, descriptor.FileName)
  if (!isInside(resolve(root), sourcePath)) throw new Error('壁纸主文件路径越界')
  const sourceStat = await fs.stat(sourcePath).catch(() => null)
  if (!sourceStat?.isFile() || !MEDIA_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
    throw new Error('壁纸主文件不存在或类型不受支持')
  }
}

async function atomicInstall(entry: WallpaperResourceEntry, packageRoot: string): Promise<void> {
  const remoteRoot = getRemoteWallpapersRoot()
  const target = join(remoteRoot, entry.id)
  const staging = join(remoteRoot, `.install-${entry.id}-${randomUUID()}`)
  const backup = join(remoteRoot, `.backup-${entry.id}-${randomUUID()}`)
  await fs.mkdir(remoteRoot, { recursive: true })
  await fs.cp(packageRoot, staging, { recursive: true, force: false, errorOnExist: true })
  const metadata: InstalledResourceMetadata = {
    id: entry.id,
    version: entry.version,
    sha256: entry.sha256,
    packageUrl: entry.packageUrl,
    installedAt: new Date().toISOString(),
  }
  await fs.writeFile(join(staging, RESOURCE_METADATA_FILE), JSON.stringify(metadata, null, 2), 'utf8')

  let hadExisting = false
  try {
    await fs.rename(target, backup)
    hadExisting = true
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined
    if (code !== 'ENOENT') throw error
  }

  try {
    await fs.rename(staging, target)
    if (hadExisting) await fs.rm(backup, { recursive: true, force: true })
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    if (hadExisting) await fs.rename(backup, target).catch(() => undefined)
    throw error
  }
}

async function runInstall(entry: WallpaperResourceEntry): Promise<WallpaperResourceActionResult> {
  const workRoot = join(getWallpaperResourceCacheRoot(), 'downloads', `${entry.id}-${randomUUID()}`)
  const zipPath = join(workRoot, `${basename(entry.id)}.zip`)
  const extractedRoot = join(workRoot, 'extracted')
  setTransientState(entry.id, 'downloading')
  try {
    await downloadPackage(entry, zipPath)
    publishProgress({
      wallpaperId: entry.id,
      phase: 'verifying',
      percent: 96,
      message: '校验完成，正在安全解压',
    })
    await fs.mkdir(extractedRoot, { recursive: true })
    await extractZipSafely(zipPath, extractedRoot, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxUncompressedBytes: MAX_PACKAGE_BYTES,
    })
    const packageRoot = await findWallpaperPackageRoot(extractedRoot)
    await validateWallpaperPackage(packageRoot)
    setTransientState(entry.id, 'installing')
    publishProgress({
      wallpaperId: entry.id,
      phase: 'installing',
      percent: 98,
      message: '正在安装壁纸资源',
    })
    await atomicInstall(entry, packageRoot)
    transientStates.delete(entry.id)
    publishProgress({
      wallpaperId: entry.id,
      phase: 'complete',
      percent: 100,
      message: `${entry.title} 已安装`,
    })
    return { ok: true }
  } catch (error) {
    const message = safeError(error)
    setTransientState(entry.id, 'error', message)
    publishProgress({
      wallpaperId: entry.id,
      phase: 'error',
      percent: 0,
      message,
    })
    return { ok: false, error: message }
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function installWallpaperResource(resourceId: string): Promise<WallpaperResourceActionResult> {
  if (!isValidWallpaperResourceId(resourceId)) return { ok: false, error: '无效的壁纸资源 ID' }
  const existing = activeInstalls.get(resourceId)
  if (existing) return existing
  let release: (() => void) | undefined
  try {
    release = beginWallpaperResourceMutation(toRemoteWallpaperId(resourceId))
    const task = (async () => {
      const catalog = await getWallpaperResourceCatalog(false)
      const entry = catalog.items.find((item) => item.id === resourceId)
      if (!entry) return { ok: false, error: '远程清单中不存在该壁纸' }
      return runInstall(entry)
    })().finally(() => { activeInstalls.delete(resourceId); release?.() })
    activeInstalls.set(resourceId, task)
    return await task
  } catch (error) {
    release?.()
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function removeWallpaperResource(resourceId: string): Promise<WallpaperResourceActionResult> {
  if (!isValidWallpaperResourceId(resourceId)) return { ok: false, error: '无效的壁纸资源 ID' }
  let release: (() => void) | undefined
  try {
    release = beginWallpaperResourceMutation(toRemoteWallpaperId(resourceId))
    await fs.rm(join(getRemoteWallpapersRoot(), resourceId), { recursive: true, force: true })
    await fs.rm(getWallpaperOverrideDir(toRemoteWallpaperId(resourceId)), { recursive: true, force: true })
    transientStates.delete(resourceId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    release?.()
  }
}
