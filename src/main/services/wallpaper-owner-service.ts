import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import { request as httpsRequest } from 'https'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { ZipFile } from 'yazl'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import { WALLPAPER_RESOURCE_ID_PATTERN, WALLPAPER_RESOURCE_VERSION_PATTERN } from '@shared/wallpaper-resource'
import type {
  WallpaperOwnerConfigInput,
  WallpaperOwnerStatus,
  WallpaperPublishInput,
  WallpaperPublishProgress,
  WallpaperPublishResult,
  WallpaperResourceEntry,
} from '@shared/types'
import {
  getRemoteWallpaperFolderName,
  getRemoteWallpapersRoot,
  getUserWallpaperFolderName,
  getUserWallpapersRoot,
  getWallpaperOwnerConfigPath,
  getWallpaperResourceCacheRoot,
  isRemoteWallpaperId,
  isUserWallpaperId,
} from '../runtime/userDataPaths'
import { getMainWindow } from '../windows/mainWindow'
import {
  OFFICIAL_WALLPAPER_MANIFEST_URL,
  OFFICIAL_WALLPAPER_REPOSITORY,
  parseWallpaperResourceManifest,
  saveWallpaperResourceManifestCache,
} from './wallpaper-resource-service'

const OWNER_MODE_ARGUMENT = '--lingyue-wallpaper-owner'
const DEFAULT_BRANCH = 'main'
const DEFAULT_MANIFEST_PATH = 'manifest.json'
const GITHUB_API_VERSION = '2022-11-28'
const TOKEN_PREFIX = 'safe:v1:'
const MAX_GITHUB_RESPONSE_BYTES = 5 * 1024 * 1024
let ownerModeRequested = process.argv.includes(OWNER_MODE_ARGUMENT)

const ownerConfigSchema = z.object({
  token: z.string().trim().min(20).max(500),
  branch: z.literal(DEFAULT_BRANCH),
  manifestPath: z.literal(DEFAULT_MANIFEST_PATH),
})

const publishInputSchema = z.object({
  wallpaperId: z.string().min(1).max(300),
  remoteId: z.string().regex(WALLPAPER_RESOURCE_ID_PATTERN),
  version: z.string().trim().regex(WALLPAPER_RESOURCE_VERSION_PATTERN).max(64),
  releaseTag: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,200}$/),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  author: z.string().max(200).optional(),
  license: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
})

interface StoredOwnerConfig {
  token: string
  branch: string
  manifestPath: string
}

interface FlowWallDeskInfo {
  Title?: string
  Desc?: string
  Author?: string
  Type?: number
  FileName?: string
  Thumbnail?: string
  Preview?: string
  Tags?: string[]
}

interface GitHubReleaseAsset {
  id: number
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  id: number
  html_url: string
  upload_url: string
  assets: GitHubReleaseAsset[]
}

interface GitHubContentResponse {
  sha: string
  content: string
  encoding: string
}

function ownerModeEnabled(): boolean {
  return !app.isPackaged || ownerModeRequested
}

export function enableWallpaperOwnerMode(): void {
  ownerModeRequested = true
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 400) || '未知错误'
}

function isInside(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，无法保存 GitHub Token')
  return `${TOKEN_PREFIX}${safeStorage.encryptString(token).toString('base64')}`
}

function decryptToken(token: string): string {
  if (!token.startsWith(TOKEN_PREFIX)) return ''
  try {
    return safeStorage.decryptString(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function maskToken(token: string): string | undefined {
  if (!token) return undefined
  return token.length <= 10 ? `${token.slice(0, 3)}...` : `${token.slice(0, 6)}...${token.slice(-4)}`
}

async function readOwnerConfig(): Promise<StoredOwnerConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(getWallpaperOwnerConfigPath(), 'utf8')) as StoredOwnerConfig
    const token = decryptToken(parsed.token)
    if (!token) return null
    const validated = ownerConfigSchema.safeParse({
      token,
      branch: parsed.branch || DEFAULT_BRANCH,
      manifestPath: parsed.manifestPath || DEFAULT_MANIFEST_PATH,
    })
    return validated.success ? validated.data : null
  } catch {
    return null
  }
}

async function writeOwnerConfig(config: StoredOwnerConfig): Promise<void> {
  const path = getWallpaperOwnerConfigPath()
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify({
    ...config,
    token: encryptToken(config.token),
  }, null, 2), 'utf8')
}

function publishProgress(progress: WallpaperPublishProgress): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(IPC.WALLPAPER_OWNER_PUBLISH_PROGRESS, progress)
}

function requireOwnerMode(): void {
  if (!ownerModeEnabled()) throw new Error('壁纸发布管理未在所有者模式下启用')
}

function githubHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'LavaDesk-Wallpaper-Publisher',
    ...extra,
  }
}

async function githubJson<T>(
  config: StoredOwnerConfig,
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(config.token),
      ...(init?.headers || {}),
    },
  })
  if (allowNotFound && response.status === 404) return null
  const text = await response.text()
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(text) as { message?: string }
      if (parsed.message) detail += `：${parsed.message}`
    } catch {
      // Keep the status-only error so response headers or tokens never reach the UI.
    }
    throw new Error(`GitHub 请求失败（${detail}）`)
  }
  if (!text) return null
  if (Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES) throw new Error('GitHub 响应超过大小限制')
  return JSON.parse(text) as T
}

async function validateRepositoryAccess(config: StoredOwnerConfig, createIfMissing = false): Promise<void> {
  const account = await githubJson<{ login?: string }>(config, '/user')
  const expectedOwner = OFFICIAL_WALLPAPER_REPOSITORY.split('/')[0]
  if (account?.login?.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`该 Token 不属于官方资源库所有者 ${expectedOwner}`)
  }

  let repo = await githubJson<{ permissions?: { push?: boolean } }>(
    config,
    `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}`,
    undefined,
    true,
  )
  if (!repo && createIfMissing) {
    try {
      await githubJson(config, '/user/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: OFFICIAL_WALLPAPER_REPOSITORY.split('/')[1],
          description: 'Official wallpaper packages and manifest for LavaDesk.',
          private: false,
          auto_init: true,
        }),
      })
      repo = await githubJson<{ permissions?: { push?: boolean } }>(
        config,
        `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}`,
      )
    } catch {
      throw new Error('官方壁纸仓库尚不存在；请先在 GitHub 创建公开仓库 LavaDesk-Wallpapers，或使用具备仓库创建权限的 Token')
    }
  }
  if (!repo) throw new Error('官方壁纸仓库不存在')
  if (!repo?.permissions?.push) throw new Error('Token 没有官方壁纸仓库的写入权限')
}

export async function getWallpaperOwnerStatus(): Promise<WallpaperOwnerStatus> {
  const config = await readOwnerConfig()
  return {
    enabled: ownerModeEnabled(),
    configured: Boolean(config),
    repository: OFFICIAL_WALLPAPER_REPOSITORY,
    branch: config?.branch || DEFAULT_BRANCH,
    manifestPath: config?.manifestPath || DEFAULT_MANIFEST_PATH,
    manifestUrl: OFFICIAL_WALLPAPER_MANIFEST_URL,
    tokenHint: config ? maskToken(config.token) : undefined,
  }
}

export async function configureWallpaperOwner(input: WallpaperOwnerConfigInput): Promise<WallpaperOwnerStatus> {
  requireOwnerMode()
  const config = ownerConfigSchema.parse({
    token: input.token,
    branch: input.branch || DEFAULT_BRANCH,
    manifestPath: input.manifestPath || DEFAULT_MANIFEST_PATH,
  })
  await validateRepositoryAccess(config, true)
  await writeOwnerConfig(config)
  return getWallpaperOwnerStatus()
}

export async function clearWallpaperOwnerCredentials(): Promise<WallpaperOwnerStatus> {
  requireOwnerMode()
  await fs.rm(getWallpaperOwnerConfigPath(), { force: true })
  return getWallpaperOwnerStatus()
}

function getBuiltinWallpaperRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', 'wallpaper')
    : join(__dirname, '../../assets/wallpaper')
}

async function resolveWallpaperFolder(wallpaperId: string): Promise<string> {
  let root: string
  let folderName: string
  if (isUserWallpaperId(wallpaperId)) {
    root = getUserWallpapersRoot()
    folderName = getUserWallpaperFolderName(wallpaperId)
  } else if (isRemoteWallpaperId(wallpaperId)) {
    root = getRemoteWallpapersRoot()
    folderName = getRemoteWallpaperFolderName(wallpaperId)
  } else {
    root = getBuiltinWallpaperRoot()
    folderName = wallpaperId
  }
  const folder = resolve(root, folderName)
  if (!isInside(resolve(root), folder)) throw new Error('壁纸目录越界')
  const stat = await fs.stat(folder).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('找不到待发布的壁纸目录')
  return folder
}

async function readWallpaperInfo(folder: string): Promise<FlowWallDeskInfo> {
  try {
    const info = JSON.parse(await fs.readFile(join(folder, 'FlowWallDeskInfo.json'), 'utf8')) as FlowWallDeskInfo
    if (!info.FileName) throw new Error('missing FileName')
    const source = resolve(folder, info.FileName)
    if (!isInside(resolve(folder), source) || !(await fs.stat(source)).isFile()) throw new Error('invalid FileName')
    return info
  } catch {
    throw new Error('待发布壁纸必须包含有效的 FlowWallDeskInfo.json 和主文件')
  }
}

function wallpaperType(info: FlowWallDeskInfo): WallpaperResourceEntry['type'] {
  if (info.Type === 1) return 'web'
  if (info.Type === 7) return 'video'
  return 'image'
}

function previewContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function findPreview(folder: string, info: FlowWallDeskInfo): Promise<string | null> {
  for (const candidate of [info.Thumbnail, info.Preview, wallpaperType(info) === 'image' ? info.FileName : undefined]) {
    if (!candidate) continue
    const path = resolve(folder, candidate)
    if (!isInside(resolve(folder), path)) continue
    const stat = await fs.stat(path).catch(() => null)
    if (stat?.isFile() && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extname(path).toLowerCase())) {
      return path
    }
  }
  return null
}

async function createWallpaperZip(sourceFolder: string, zipPath: string): Promise<void> {
  await fs.mkdir(dirname(zipPath), { recursive: true })
  const archive = new ZipFile()
  const completed = new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(zipPath)
    output.once('close', resolvePromise)
    output.once('error', reject)
    archive.outputStream.once('error', reject)
    archive.outputStream.pipe(output)
  })

  const addFolder = async (folder: string, relativeFolder = ''): Promise<void> => {
    const entries = (await fs.readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.lingyue-resource.json')
      .sort((left, right) => left.name.localeCompare(right.name))
    if (entries.length === 0 && relativeFolder) archive.addEmptyDirectory(`${relativeFolder}/`)
    for (const entry of entries) {
      const fullPath = join(folder, entry.name)
      const metadataPath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error('待发布壁纸不能包含符号链接')
      if (entry.isDirectory()) await addFolder(fullPath, metadataPath)
      else if (entry.isFile()) archive.addFile(fullPath, metadataPath)
      else throw new Error('待发布壁纸包含不受支持的特殊文件')
    }
  }

  await addFolder(sourceFolder)
  archive.end()
  await completed
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function getOrCreateRelease(config: StoredOwnerConfig, tag: string): Promise<GitHubRelease> {
  const encodedTag = encodeURIComponent(tag)
  const existing = await githubJson<GitHubRelease>(
    config,
    `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}/releases/tags/${encodedTag}`,
    undefined,
    true,
  )
  if (existing) return existing
  const created = await githubJson<GitHubRelease>(
    config,
    `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}/releases`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: config.branch,
        name: tag,
        body: 'LavaDesk 在线壁纸资源包。',
        draft: false,
        prerelease: false,
      }),
    },
  )
  if (!created) throw new Error('GitHub Release 创建失败')
  return created
}

async function deleteDuplicateAsset(
  config: StoredOwnerConfig,
  release: GitHubRelease,
  assetName: string,
): Promise<void> {
  const duplicate = release.assets.find((asset) => asset.name === assetName)
  if (!duplicate) return
  await githubJson(config, `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}/releases/assets/${duplicate.id}`, {
    method: 'DELETE',
  })
}

async function uploadReleaseAsset(
  config: StoredOwnerConfig,
  release: GitHubRelease,
  assetName: string,
  filePath: string,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<GitHubReleaseAsset> {
  await deleteDuplicateAsset(config, release, assetName)
  const stat = await fs.stat(filePath)
  const uploadUrl = new URL(release.upload_url.replace('{?name,label}', ''))
  uploadUrl.searchParams.set('name', assetName)

  return new Promise((resolvePromise, reject) => {
    const request = httpsRequest(uploadUrl, {
      method: 'POST',
      headers: {
        ...githubHeaders(config.token, {
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
        }),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      let received = 0
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received <= MAX_GITHUB_RESPONSE_BYTES) chunks.push(chunk)
      })
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub 资源上传失败（HTTP ${response.statusCode || 0}）`))
          return
        }
        try {
          resolvePromise(JSON.parse(text) as GitHubReleaseAsset)
        } catch {
          reject(new Error('GitHub 资源上传响应无效'))
        }
      })
    })
    request.once('error', reject)
    const input = createReadStream(filePath)
    let sent = 0
    input.on('data', (chunk: string | Buffer) => {
      sent += Buffer.byteLength(chunk)
      onProgress(stat.size > 0 ? sent / stat.size * 100 : 100)
    })
    input.once('error', reject)
    input.pipe(request)
  })
}

async function readRemoteManifest(config: StoredOwnerConfig): Promise<{
  manifest: { version: number; updatedAt?: string; wallpapers: WallpaperResourceEntry[] }
  sha?: string
}> {
  const encodedPath = config.manifestPath.split('/').map(encodeURIComponent).join('/')
  const existing = await githubJson<GitHubContentResponse>(
    config,
    `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
    undefined,
    true,
  )
  if (!existing) return { manifest: { version: 1, wallpapers: [] } }
  if (existing.encoding !== 'base64') throw new Error('远程 manifest 编码不受支持')
  const manifest = parseWallpaperResourceManifest(JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8')))
  return {
    manifest: {
      version: manifest.version || manifest.schemaVersion || 1,
      updatedAt: manifest.updatedAt,
      wallpapers: manifest.wallpapers,
    },
    sha: existing.sha,
  }
}

async function updateRemoteManifest(
  config: StoredOwnerConfig,
  entry: WallpaperResourceEntry,
): Promise<void> {
  const current = await readRemoteManifest(config)
  const index = current.manifest.wallpapers.findIndex((item) => item.id === entry.id)
  if (index >= 0) current.manifest.wallpapers[index] = entry
  else current.manifest.wallpapers.push(entry)
  current.manifest.wallpapers.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  current.manifest.updatedAt = new Date().toISOString()
  const content = Buffer.from(JSON.stringify(current.manifest, null, 2), 'utf8').toString('base64')
  const encodedPath = config.manifestPath.split('/').map(encodeURIComponent).join('/')
  await githubJson(config, `/repos/${OFFICIAL_WALLPAPER_REPOSITORY}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `content(wallpaper): publish ${entry.id} ${entry.version}`,
      content,
      branch: config.branch,
      sha: current.sha,
    }),
  })
  await saveWallpaperResourceManifestCache(current.manifest)
}

async function runPublish(input: WallpaperPublishInput): Promise<WallpaperPublishResult> {
  requireOwnerMode()
  const payload = publishInputSchema.parse(input)
  const config = await readOwnerConfig()
  if (!config) throw new Error('请先配置具有官方资源仓库写权限的 GitHub Token')
  await validateRepositoryAccess(config)
  const sourceFolder = await resolveWallpaperFolder(payload.wallpaperId)
  const info = await readWallpaperInfo(sourceFolder)
  const previewPath = await findPreview(sourceFolder, info)
  const workRoot = join(getWallpaperResourceCacheRoot(), 'publisher', `${payload.remoteId}-${Date.now()}`)
  const packageName = `${payload.remoteId}-${payload.version}.zip`
  const packagePath = join(workRoot, packageName)
  try {
    publishProgress({ phase: 'packing', percent: 5, message: '正在打包壁纸资源' })
    await createWallpaperZip(sourceFolder, packagePath)
    const packageStat = await fs.stat(packagePath)
    if (packageStat.size >= 2 * 1024 * 1024 * 1024) throw new Error('壁纸 ZIP 必须小于 2 GiB')
    const sha256 = await hashFile(packagePath)
    const release = await getOrCreateRelease(config, payload.releaseTag)
    const packageAsset = await uploadReleaseAsset(
      config,
      release,
      packageName,
      packagePath,
      'application/zip',
      (percent) => publishProgress({
        phase: 'uploading-package',
        percent: 10 + percent * 0.65,
        message: `正在上传壁纸包（${Math.round(percent)}%）`,
      }),
    )

    let previewUrl: string | undefined
    if (previewPath) {
      const previewName = `${payload.remoteId}-${payload.version}-preview${extname(previewPath).toLowerCase()}`
      const previewAsset = await uploadReleaseAsset(
        config,
        release,
        previewName,
        previewPath,
        previewContentType(previewPath),
        (percent) => publishProgress({
          phase: 'uploading-preview',
          percent: 76 + percent * 0.12,
          message: `正在上传预览图（${Math.round(percent)}%）`,
        }),
      )
      previewUrl = previewAsset.browser_download_url
    }

    const entry: WallpaperResourceEntry = {
      id: payload.remoteId,
      title: payload.title,
      type: wallpaperType(info),
      version: payload.version,
      size: packageStat.size,
      previewUrl,
      packageUrl: packageAsset.browser_download_url,
      sha256,
      description: payload.description || info.Desc,
      author: payload.author || info.Author,
      license: payload.license,
      tags: payload.tags?.length ? payload.tags : info.Tags,
      updatedAt: new Date().toISOString(),
    }
    publishProgress({ phase: 'updating-manifest', percent: 90, message: '正在更新在线壁纸清单' })
    await updateRemoteManifest(config, entry)
    publishProgress({ phase: 'complete', percent: 100, message: `${payload.title} 已发布` })
    return { ok: true, entry, releaseUrl: release.html_url }
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

let publishTask: Promise<WallpaperPublishResult> | null = null

export async function publishWallpaperResource(input: WallpaperPublishInput): Promise<WallpaperPublishResult> {
  if (publishTask) return { ok: false, error: '已有壁纸发布任务正在进行' }
  publishTask = runPublish(input)
    .catch((error: unknown) => {
      const message = safeError(error)
      publishProgress({ phase: 'error', percent: 0, message })
      return { ok: false, error: message }
    })
    .finally(() => {
      publishTask = null
    })
  return publishTask
}
