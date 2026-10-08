import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  WallpaperApplyTarget,
  WallpaperDisplaySettings,
  WallpaperItem,
} from '@shared/types'
import { toAssetUrl } from '@shared/asset-url'
import { getDisplayAssignment } from '@shared/wallpaper-display-layout'
import { WallpaperSidebar } from '../components/WallpaperSidebar'
import { ImageOff, Plus } from 'lucide-react'
import type { InitialFile } from '../components/AddWallpaperDialog'

const TYPE_LABEL: Record<WallpaperItem['type'], string> = {
  video: '视频',
  image: '图片',
  web: '网页',
}

export function LibraryPage({
  search,
  refreshKey,
  wallpaperTarget = 'current',
  displaySettings,
  onDisplaySelect,
  onDisplaySettingsChange,
  onDropFile,
}: {
  search: string
  refreshKey?: number
  wallpaperTarget?: WallpaperApplyTarget
  displaySettings?: WallpaperDisplaySettings | null
  onDisplaySelect?: (target: WallpaperApplyTarget) => void
  onDisplaySettingsChange?: (settings: WallpaperDisplaySettings) => void
  onDropFile?: (file: InitialFile) => void
}) {
  const [list, setList] = useState<WallpaperItem[]>([])
  const [loadedDisplaySettings, setLoadedDisplaySettings] = useState<WallpaperDisplaySettings | null>(displaySettings ?? null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [appliedId, setAppliedId] = useState<string | undefined>()
  const lastSelectionTarget = useRef(wallpaperTarget)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const hasLoadedRef = useRef(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    let alive = true
    // Only the first load shows the placeholder; switching monitors or layout
    // refreshes in place instead of flashing the grid away.
    if (!hasLoadedRef.current) setLoading(true)
    Promise.all([
      window.lingyue.wallpaper.list(),
      window.lingyue.wallpaper.getCurrent(),
      window.lingyue.wallpaper.getDisplaySettings(),
    ]).then(
      ([items, current, nextDisplaySettings]) => {
        if (!alive) return
        hasLoadedRef.current = true
        setList(items)
        setLoadedDisplaySettings(nextDisplaySettings)
        setLoadError('')
        setLoading(false)
        const displayId = typeof wallpaperTarget === 'number' && nextDisplaySettings.displays.some((display) => display.id === wallpaperTarget)
          ? wallpaperTarget
          : nextDisplaySettings.displays.find((display) => display.primary)?.id ?? nextDisplaySettings.displays[0]?.id
        if (nextDisplaySettings.mode === 'per-display' && displayId !== undefined && displayId !== wallpaperTarget) {
          onDisplaySelect?.(displayId)
        }
        const selectedDisplay = nextDisplaySettings.displays.find((display) => display.id === displayId)
        const effectiveId = nextDisplaySettings.mode === 'per-display' && selectedDisplay
          ? getDisplayAssignment(nextDisplaySettings.assignments, selectedDisplay) ?? current?.current?.id
          : current?.current?.id
        if (effectiveId) {
          setAppliedId(effectiveId)
          const targetChanged = lastSelectionTarget.current !== wallpaperTarget
          lastSelectionTarget.current = wallpaperTarget
          setSelectedId((previous) => !targetChanged && items.some((entry) => entry.id === previous) ? previous : effectiveId)
        } else if (items[0]) {
          setSelectedId(items[0].id)
        }
      },
      (error: unknown) => {
        if (!alive) return
        setLoadError(error instanceof Error ? error.message : '壁纸列表读取失败')
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [refreshKey, wallpaperTarget, displaySettings, onDisplaySelect])

  const activeSettings = displaySettings ?? loadedDisplaySettings
  const activeDisplayId = typeof wallpaperTarget === 'number' && activeSettings?.displays.some((display) => display.id === wallpaperTarget)
    ? wallpaperTarget
    : activeSettings?.displays.find((display) => display.primary)?.id ?? activeSettings?.displays[0]?.id
  const activeMode = activeSettings?.mode ?? 'primary'

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q))
  }, [list, search])

  const selected = useMemo(
    () => filtered.find((w) => w.id === selectedId) ?? list.find((w) => w.id === selectedId),
    [filtered, list, selectedId]
  )

  const apply = async (item: WallpaperItem) => {
    try {
      const target = activeMode === 'per-display' && activeDisplayId !== undefined
        ? activeDisplayId
        : 'current'
      await window.lingyue.wallpaper.apply(item, target)
      const nextSettings = await window.lingyue.wallpaper.getDisplaySettings()
      setAppliedId(item.id)
      setLoadedDisplaySettings(nextSettings)
      onDisplaySettingsChange?.(nextSettings)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '应用壁纸失败')
    }
  }

  const remove = async (item: WallpaperItem) => {
    if (item.id === appliedId) {
      window.alert('当前正在使用这张壁纸，请先切换到其他壁纸。')
      return
    }
    if (!window.confirm(`删除本地壁纸“${item.name}”？此操作会移除本机副本。`)) return
    const result = await window.lingyue.wallpaper.remove(item.id)
    if (!result.ok) {
      window.alert(result.error || '删除失败')
      return
    }
    setList((current) => current.filter((candidate) => candidate.id !== item.id))
    setSelectedId(undefined)
  }

  // 页面级拖放
  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    // 只在离开 library-page 时关闭
    const rel = e.relatedTarget as HTMLElement | null
    const page = e.currentTarget as HTMLElement
    if (!rel || !page.contains(rel)) {
      setDragOver(false)
    }
  }, [])
  const handlePageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = e.dataTransfer.files
      if (files.length > 0 && onDropFile) {
        const f = files[0]
        const path = window.lingyue.utils.getFilePath(f)
        if (path) {
          onDropFile({ path, name: f.name })
        }
      }
    },
    [onDropFile]
  )

  return (
    <div
      className="library-page"
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {/* 拖放覆盖层 */}
      {dragOver && (
        <div className="library-dropzone active">
          <div className="library-dropzone__border">
            <Plus size={48} style={{ color: 'var(--text-tertiary)' }} />
            <span className="library-dropzone__text">拖放壁纸文件到此处</span>
          </div>
        </div>
      )}
      {/* 模糊背景 */}
      <div className={`library-bg ${selected?.preview ? 'show' : ''}`}>
        {selected?.preview && <img src={toAssetUrl(selected.preview)} alt="" />}
      </div>

      <div className="library-content" style={{ marginRight: selected ? 320 : 0 }}>
        {loading ? (
          <div className="empty-page">加载中…</div>
        ) : loadError ? (
          <div className="empty-page">
            <ImageOff size={48} />
            <div className="empty-page__title">壁纸列表读取失败</div>
            <div>{loadError}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-page">
            <ImageOff size={48} />
            <div className="empty-page__title">未找到壁纸</div>
          </div>
        ) : (
          <div className="library-grid">
            {filtered.map((w, i) => (
              <WallpaperCard
                key={w.id}
                item={w}
                index={i}
                selected={w.id === selectedId}
                applied={w.id === appliedId}
                onClick={() => setSelectedId(w.id)}
                onDoubleClick={() => apply(w)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <WallpaperSidebar
          key={selected.id}
          item={selected}
          isApplied={selected.id === appliedId}
          onApply={() => apply(selected)}
          onClose={() => setSelectedId(undefined)}
          onDelete={selected.id.startsWith('user:') ? () => void remove(selected) : undefined}
        />
      )}
    </div>
  )
}

function WallpaperCard(props: {
  item: WallpaperItem
  index: number
  selected: boolean
  applied: boolean
  onClick: () => void
  onDoubleClick: () => void
}) {
  const { item, index, selected, applied } = props
  const previewUrl = toAssetUrl(item.preview)
  const fallbackUrl = item.type === 'image' ? toAssetUrl(item.source) : undefined
  const src = previewUrl ?? fallbackUrl

  return (
    <div
      className={`wallpaper-card ${selected ? 'selected' : ''} ${applied ? 'applied' : ''}`}
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      title={item.name}
    >
      {src ? (
        <img className="wallpaper-card__image" src={src} alt={item.name} loading="lazy" />
      ) : (
        <div className="wallpaper-card__placeholder">{TYPE_LABEL[item.type]}</div>
      )}
      <div className="wallpaper-card__type">{TYPE_LABEL[item.type]}</div>
      {item.meta?.Source === 'flowwall' && <div className="wallpaper-card__source">FlowWall</div>}
      <div className="wallpaper-card__gradient" />
      <div className="wallpaper-card__title">{item.name}</div>
    </div>
  )
}
