/**
 * FlowWall online wallpaper library (https://www.flowwall.ai/wallpaper/discover).
 * The site runs inside an isolated view; these pure rules decide what it may
 * navigate to, which downloads become wallpapers, and what a lingyue:// link
 * from a web page is allowed to ask for.
 */

import type { MediaSignature } from './media-signature'

export const FLOWWALL_HOME_URL = 'https://www.flowwall.ai/wallpaper/discover'
export const FLOWWALL_PARTITION = 'persist:flowwall'
export const LINGYUE_PROTOCOL = 'lingyue'
/** Largest single download accepted as a wallpaper (same cap as manual ZIP import). */
export const FLOWWALL_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024

const FLOWWALL_DOMAINS = ['flowwall.ai', 'flowwall.art']

/**
 * Sign-in providers a web login may pass through. Everything else leaves the
 * embedded view for the system browser.
 */
const AUTH_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'open.weixin.qq.com',
  'graph.qq.com',
  'api.weibo.com',
]

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function isFlowWallUrl(value: string): boolean {
  const url = parseUrl(value)
  return Boolean(url && url.protocol === 'https:' && FLOWWALL_DOMAINS.some((domain) => hostMatches(url.hostname.toLowerCase(), domain)))
}

export type FlowWallNavigation = 'internal' | 'auth' | 'media' | 'external' | 'blocked'

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv']
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
const PACKAGE_EXTENSIONS = ['.zip']

function extensionOf(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  const slash = clean.lastIndexOf('/')
  return dot > slash ? clean.slice(dot).toLowerCase() : ''
}

/** Where a navigation or new-window request from the embedded page should go. */
export function classifyFlowWallNavigation(value: string): FlowWallNavigation {
  const url = parseUrl(value)
  if (!url) return 'blocked'
  if (url.protocol === 'about:' && url.href === 'about:blank') return 'internal'
  if (url.protocol !== 'https:') return url.protocol === 'http:' || url.protocol === 'mailto:' ? 'external' : 'blocked'
  const ext = extensionOf(url.pathname)
  if (VIDEO_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext) || PACKAGE_EXTENSIONS.includes(ext)) return 'media'
  const host = url.hostname.toLowerCase()
  if (FLOWWALL_DOMAINS.some((domain) => hostMatches(host, domain))) return 'internal'
  if (AUTH_HOSTS.some((domain) => hostMatches(host, domain))) return 'auth'
  return 'external'
}

export type FlowWallDownloadKind = 'video' | 'image' | 'package'

const MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
}

/**
 * Decide whether a download is a wallpaper and which extension it gets.
 * Anything else (documents, installers...) is left to the normal save dialog.
 */
export function classifyFlowWallDownload(params: { filename?: string; mimeType?: string; url?: string }): { kind: FlowWallDownloadKind; extension: string } | null {
  const candidates = [
    extensionOf(params.filename ?? ''),
    MIME_EXTENSIONS[(params.mimeType ?? '').split(';')[0].trim().toLowerCase()] ?? '',
    params.url ? extensionOf(parseUrl(params.url)?.pathname ?? '') : '',
  ].filter(Boolean)
  for (const extension of candidates) {
    if (VIDEO_EXTENSIONS.includes(extension)) return { kind: 'video', extension }
    if (IMAGE_EXTENSIONS.includes(extension)) return { kind: 'image', extension }
    if (PACKAGE_EXTENSIONS.includes(extension)) return { kind: 'package', extension }
  }
  return null
}

export function signatureMatchesKind(signature: MediaSignature | null, kind: FlowWallDownloadKind): boolean {
  if (!signature) return false
  if (kind === 'video') return signature === 'mp4' || signature === 'webm'
  if (kind === 'image') return signature === 'png' || signature === 'jpeg' || signature === 'gif' || signature === 'webp'
  return signature === 'zip'
}

/** "星空之下 | FlowWall AI" → "星空之下"; list pages give no useful title. */
export function cleanFlowWallTitle(pageTitle: string | undefined, filename: string | undefined): string {
  const fromPage = (pageTitle ?? '')
    .replace(/\s*[|｜\-–—]\s*(FlowWall( AI)?|Curated AI Live Wallpapers.*)$/i, '')
    .trim()
  const generic = !fromPage || /^(FlowWall( AI)?|Curated AI Live Wallpapers.*|Discover.*|发现.*)$/i.test(fromPage)
  if (!generic) return fromPage.slice(0, 60)
  const base = (filename ?? '').replace(/\.[a-z0-9]{2,5}$/i, '')
  let decoded = base
  try {
    decoded = decodeURIComponent(base)
  } catch {
    // keep the raw name
  }
  return decoded.replace(/[_]+/g, ' ').trim().slice(0, 60) || 'FlowWall 壁纸'
}

/** Identity of a download for de-duplication: signed CDN query strings change, the path does not. */
export function normalizeSourceUrl(value: string): string {
  const url = parseUrl(value)
  return url ? `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}` : value
}

export type LingyueDeepLink =
  | { action: 'open-library'; pageUrl: string }
  | { action: 'import-wallpaper'; mediaUrl: string; title?: string; pageUrl?: string; trustedHost: boolean }

/**
 * lingyue://wallpaper/open?page=<flowwall page>
 * lingyue://wallpaper/import?url=<https media url>&title=<name>&page=<flowwall page>
 * Anything else is ignored. Import requests are always confirmed by the user.
 */
export function parseLingyueDeepLink(value: string): LingyueDeepLink | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${LINGYUE_PROTOCOL}:`) return null
  const route = `${url.hostname}${url.pathname}`.replace(/\/+$/, '').toLowerCase()
  const page = url.searchParams.get('page') ?? undefined
  const pageUrl = page && isFlowWallUrl(page) ? page : undefined
  if (route === 'wallpaper/open' || route === 'wallpaper' || route === 'library') {
    return { action: 'open-library', pageUrl: pageUrl ?? FLOWWALL_HOME_URL }
  }
  if (route === 'wallpaper/import') {
    const media = url.searchParams.get('url') ?? ''
    const mediaUrl = parseUrl(media)
    if (!mediaUrl || mediaUrl.protocol !== 'https:') return null
    if (!classifyFlowWallDownload({ url: media })) return null
    const title = url.searchParams.get('title')?.trim().slice(0, 60) || undefined
    return { action: 'import-wallpaper', mediaUrl: mediaUrl.href, title, pageUrl, trustedHost: isFlowWallUrl(media) }
  }
  return null
}

export type FlowWallDownloadState = 'downloading' | 'importing' | 'completed' | 'duplicate' | 'failed' | 'cancelled'

export interface FlowWallDownload {
  id: string
  title: string
  url: string
  pageUrl?: string
  kind: FlowWallDownloadKind
  state: FlowWallDownloadState
  receivedBytes: number
  totalBytes: number
  startedAt: number
  finishedAt?: number
  /** Library wallpaper created (or already present) for this download. */
  wallpaperId?: string
  error?: string
}

export interface FlowWallViewState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
}
