import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CloudOff,
  Download,
  ExternalLink,
  Film,
  Home,
  Image as ImageIcon,
  Loader2,
  Lock,
  Monitor,
  Package,
  RotateCw,
  X,
} from 'lucide-react'
import type { WallpaperApplyTarget } from '@shared/types'
import { FLOWWALL_HOME_URL, type FlowWallDownload, type FlowWallViewState } from '@shared/flowwall'

const INITIAL_VIEW: FlowWallViewState = { url: FLOWWALL_HOME_URL, title: 'FlowWall 发现', loading: true, canGoBack: false, canGoForward: false }

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function describeUrl(value: string): { host: string; path: string } {
  try {
    const url = new URL(value)
    return { host: url.hostname.replace(/^www\./, ''), path: decodeURIComponent(url.pathname).replace(/\/$/, '') }
  } catch {
    return { host: 'flowwall.ai', path: '' }
  }
}

function downloadStatus(download: FlowWallDownload): string {
  switch (download.state) {
    case 'downloading': {
      const percent = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : null
      const size = download.totalBytes > 0 ? `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}` : formatBytes(download.receivedBytes)
      return percent === null ? `下载中 ${size}` : `下载中 ${percent}% · ${size}`
    }
    case 'importing': return '正在检查并加入我的壁纸…'
    case 'completed': return '已加入我的壁纸'
    case 'duplicate': return '之前已下载过，已在我的壁纸里'
    case 'cancelled': return '已取消'
    default: return download.error || '下载失败'
  }
}

const KIND_ICON = {
  video: <Film size={15} />,
  image: <ImageIcon size={15} />,
  package: <Package size={15} />,
}

/** Any app dialog open over the page must not be covered by the native web view. */
function isAppOverlayOpen(): boolean {
  return Boolean(document.querySelector('.dialog-overlay.active, [aria-modal="true"]'))
}

export function FlowWallPage({
  wallpaperTarget = 'current',
  onShowLibrary,
}: {
  wallpaperTarget?: WallpaperApplyTarget
  onShowLibrary: () => void
}) {
  const [view, setView] = useState<FlowWallViewState>(INITIAL_VIEW)
  const [downloads, setDownloads] = useState<FlowWallDownload[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [obscured, setObscured] = useState(isAppOverlayOpen)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [appliedWallpaperId, setAppliedWallpaperId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void window.lingyue.flowwall.getState().then((state) => {
      if (!alive) return
      setView(state.view)
      setDownloads(state.downloads)
      if (state.downloads.some((item) => item.state === 'downloading' || item.state === 'importing')) setPanelOpen(true)
    })
    void window.lingyue.wallpaper.getCurrent().then((state) => {
      if (alive && state.current?.meta?.Source === 'flowwall') setAppliedWallpaperId(state.current.id)
    }).catch(() => undefined)
    const offView = window.lingyue.flowwall.onViewState(setView)
    const offDownload = window.lingyue.flowwall.onDownloadChanged((download) => {
      // A new download opens the panel so its progress is visible right away.
      if (download.state === 'downloading' && download.receivedBytes === 0) setPanelOpen(true)
      setDownloads((prev) => (
        prev.some((item) => item.id === download.id)
          ? prev.map((item) => (item.id === download.id ? download : item))
          : [download, ...prev]
      ))
    })
    return () => {
      alive = false
      offView()
      offDownload()
    }
  }, [])

  // Keep the native view glued to the placeholder; hide it under app dialogs and error states.
  const hidden = obscured || Boolean(view.error)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = viewport.getBoundingClientRect()
        if (hidden || rect.width < 2 || rect.height < 2) {
          window.lingyue.flowwall.detach()
          return
        }
        void window.lingyue.flowwall.attach({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
          .then(setView)
          .catch((error) => setNotice(error instanceof Error ? error.message : 'FlowWall 页面打开失败'))
      })
    }
    sync()
    const resize = new ResizeObserver(sync)
    resize.observe(viewport)
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('resize', sync)
      window.lingyue.flowwall.detach()
    }
  }, [hidden, panelOpen])

  useEffect(() => {
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setObscured(isAppOverlayOpen()))
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-modal'] })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const navigate = useCallback((action: Parameters<typeof window.lingyue.flowwall.navigate>[0]) => {
    void window.lingyue.flowwall.navigate(action).then(setView)
  }, [])

  const applyDownload = useCallback(async (download: FlowWallDownload) => {
    if (!download.wallpaperId) return
    setApplyingId(download.id)
    setNotice('')
    try {
      const item = (await window.lingyue.wallpaper.list()).find((candidate) => candidate.id === download.wallpaperId)
      if (!item) throw new Error('这张壁纸已经从我的壁纸里删除了，可以在 FlowWall 页面重新下载。')
      await window.lingyue.wallpaper.apply(item, wallpaperTarget)
      setAppliedWallpaperId(item.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '应用壁纸失败')
    } finally {
      setApplyingId(null)
    }
  }, [wallpaperTarget])

  const activeCount = downloads.filter((item) => item.state === 'downloading' || item.state === 'importing').length
  const address = useMemo(() => describeUrl(view.url), [view.url])

  return (
    <div className="flowwall-page">
      <div className="flowwall-toolbar" role="toolbar" aria-label="FlowWall 页面导航">
        <button className="nav-btn" title="后退（Alt+←）" disabled={!view.canGoBack} onClick={() => navigate('back')}><ArrowLeft size={16} /></button>
        <button className="nav-btn" title="前进（Alt+→）" disabled={!view.canGoForward} onClick={() => navigate('forward')}><ArrowRight size={16} /></button>
        <button className="nav-btn" title={view.loading ? '停止（Esc）' : '刷新（F5）'} onClick={() => navigate(view.loading ? 'stop' : 'reload')}>
          {view.loading ? <X size={16} /> : <RotateCw size={15} />}
        </button>
        <button className="nav-btn" title="回到 FlowWall 发现页" onClick={() => navigate('home')}><Home size={15} /></button>
        <div className="flowwall-address" title={view.url}>
          {view.loading ? <Loader2 size={13} className="spin" /> : <Lock size={12} />}
          <span className="flowwall-address__host">{address.host}</span>
          <span className="flowwall-address__path">{address.path}</span>
        </div>
        <button className="btn flowwall-toolbar__btn" onClick={() => void window.lingyue.flowwall.openExternal()} title="在系统浏览器中打开当前页面">
          <ExternalLink size={14} />
          <span>浏览器打开</span>
        </button>
        <button
          className={`btn flowwall-toolbar__btn ${panelOpen ? 'active' : ''}`}
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          title="下载与导入记录"
        >
          <Download size={14} />
          <span>下载</span>
          {activeCount > 0 && <span className="flowwall-badge">{activeCount}</span>}
        </button>
      </div>

      <div className="flowwall-body">
        <div className="flowwall-viewport" ref={viewportRef}>
          {view.error ? (
            <div className="flowwall-state">
              <CloudOff size={40} />
              <div className="flowwall-state__title">FlowWall 暂时打不开</div>
              <div className="flowwall-state__text">{view.error}</div>
              <div className="flowwall-state__actions">
                <button className="btn btn--primary" onClick={() => navigate('reload')}><RotateCw size={14} /><span>重试</span></button>
                <button className="btn" onClick={() => void window.lingyue.flowwall.openExternal()}><ExternalLink size={14} /><span>在浏览器打开</span></button>
              </div>
            </div>
          ) : (
            <div className="flowwall-state flowwall-state--loading">
              <Loader2 size={28} className="spin" />
              <div className="flowwall-state__text">{obscured ? '对话框关闭后继续浏览' : '正在打开 FlowWall…'}</div>
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="flowwall-downloads" aria-label="FlowWall 下载">
            <div className="flowwall-downloads__header">
              <span>下载与导入</span>
              {downloads.some((item) => item.state !== 'downloading' && item.state !== 'importing') && (
                <button
                  className="flowwall-link-btn"
                  onClick={() => void window.lingyue.flowwall.clearDownloads().then(setDownloads)}
                >
                  清空记录
                </button>
              )}
              <button className="nav-btn" title="收起" onClick={() => setPanelOpen(false)}><X size={14} /></button>
            </div>
            {notice && <div className="flowwall-downloads__notice">{notice}</div>}
            {downloads.length === 0 ? (
              <div className="flowwall-downloads__empty">
                <Download size={26} />
                <p>在 FlowWall 页面点下载，动态或 4K 壁纸会自动检查并加入「我的壁纸」，然后可以直接设为壁纸。</p>
                <p className="flowwall-downloads__hint">登录状态只保存在 LavaDesk 里，不影响系统浏览器。</p>
              </div>
            ) : (
              <ul className="flowwall-downloads__list">
                {downloads.map((download) => {
                  const running = download.state === 'downloading' || download.state === 'importing'
                  const ready = (download.state === 'completed' || download.state === 'duplicate') && download.wallpaperId
                  const percent = download.totalBytes > 0 ? Math.min(100, (download.receivedBytes / download.totalBytes) * 100) : 0
                  const applied = ready && appliedWallpaperId === download.wallpaperId
                  return (
                    <li key={download.id} className={`flowwall-download flowwall-download--${download.state}`}>
                      <div className="flowwall-download__icon">{KIND_ICON[download.kind]}</div>
                      <div className="flowwall-download__body">
                        <div className="flowwall-download__title" title={download.title}>{download.title}</div>
                        <div className="flowwall-download__status">{downloadStatus(download)}</div>
                        {running && (
                          <div className="flowwall-download__bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                            <div style={{ width: download.state === 'importing' ? '100%' : `${Math.max(3, percent)}%` }} className={download.state === 'importing' ? 'indeterminate' : ''} />
                          </div>
                        )}
                        <div className="flowwall-download__actions">
                          {download.state === 'downloading' && (
                            <button className="flowwall-link-btn" onClick={() => void window.lingyue.flowwall.cancelDownload(download.id)}>取消</button>
                          )}
                          {ready && (
                            <button className="btn btn--primary btn--sm" disabled={applyingId === download.id || Boolean(applied)} onClick={() => void applyDownload(download)}>
                              {applyingId === download.id ? <Loader2 size={13} className="spin" /> : applied ? <Check size={13} /> : <Monitor size={13} />}
                              <span>{applied ? '已设为壁纸' : '设为壁纸'}</span>
                            </button>
                          )}
                          {ready && <button className="flowwall-link-btn" onClick={onShowLibrary}>在我的壁纸中查看</button>}
                          {(download.state === 'failed' || download.state === 'cancelled') && download.pageUrl && (
                            <button className="flowwall-link-btn" onClick={() => navigate({ url: download.pageUrl! })}>回到下载页</button>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
