import { useCallback, useEffect, useState } from 'react'
import type { WallpaperItem, WallpaperSettings } from '@shared/types'
import { toAssetUrl } from '@shared/asset-url'
import { Check, Monitor, RotateCcw, Trash2, X } from 'lucide-react'

const TYPE_LABEL: Record<WallpaperItem['type'], string> = {
  video: '视频',
  image: '图片',
  web: '网页',
}

const DEFAULT_SETTINGS: Required<WallpaperSettings> = {
  volume: 50,
  speed: 1.0,
  scaling: '覆盖',
  flip: '无',
}

export function WallpaperSidebar(props: {
  item: WallpaperItem
  isApplied: boolean
  onApply: () => void
  onClose: () => void
  onDelete?: () => void
}) {
  const { item, isApplied } = props
  const cover =
    toAssetUrl(item.preview) ?? (item.type === 'image' ? toAssetUrl(item.source) : undefined)

  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(t)
  }, [])

  // 从壁纸配置文件加载设置
  const [volume, setVolume] = useState(item.settings?.volume ?? DEFAULT_SETTINGS.volume)
  const [speed, setSpeed] = useState(item.settings?.speed ?? DEFAULT_SETTINGS.speed)
  const [scaling, setScaling] = useState(item.settings?.scaling ?? DEFAULT_SETTINGS.scaling)
  const [flip, setFlip] = useState(item.settings?.flip ?? DEFAULT_SETTINGS.flip)

  const [saveError, setSaveError] = useState('')
  const saveSettings = useCallback((settings: WallpaperSettings) => {
    setSaveError('')
    void window.lingyue.wallpaper.saveSettings(item.id, settings).catch((error) => {
      setSaveError(error instanceof Error ? error.message : '设置保存失败，请重试。')
    })
  }, [item.id])

  const handleVolume = (v: number) => {
    setVolume(v)
    saveSettings({ volume: v })
  }
  const handleSpeed = (v: number) => {
    setSpeed(v)
    saveSettings({ speed: v })
  }
  const handleScaling = (v: string) => {
    setScaling(v)
    saveSettings({ scaling: v })
  }
  const handleFlip = (v: string) => {
    setFlip(v)
    saveSettings({ flip: v })
  }
  const handleReset = () => {
    setVolume(DEFAULT_SETTINGS.volume)
    setSpeed(DEFAULT_SETTINGS.speed)
    setScaling(DEFAULT_SETTINGS.scaling)
    setFlip(DEFAULT_SETTINGS.flip)
    const s = { ...DEFAULT_SETTINGS }
    saveSettings(s)
  }

  const showVolume = item.type === 'video' || item.type === 'web'
  const showSpeed = item.type === 'video'

  return (
    <aside className={`wallpaper-sidebar ${open ? 'open' : ''}`}>
      <button
        className="nav-btn"
        title="关闭"
        onClick={props.onClose}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
      >
        <X size={14} />
      </button>

      <div className="sidebar__header">
        {cover ? (
          <img className="sidebar__cover" src={cover} alt={item.name} />
        ) : (
          <div className="sidebar__cover-placeholder">{TYPE_LABEL[item.type]}</div>
        )}
        <div className="sidebar__title-row">
          <h2 className="sidebar__title" title={item.name}>
            {item.name}
          </h2>
          <span className="sidebar__type-tag">{TYPE_LABEL[item.type]}</span>
        </div>
      </div>

      <div className="sidebar__content">
        {saveError && <div role="alert">{saveError}</div>}
        <div className="settings-group">
          <div className="settings-group__header">壁纸属性</div>

          <Property label="显示策略">
            <select className="combo-box" value={scaling} onChange={(e) => handleScaling(e.target.value)}>
              <option>覆盖</option>
              <option>填充</option>
              <option>居中</option>
              <option>拉伸</option>
              <option>自由</option>
            </select>
          </Property>

          <Property label="镜像翻转">
            <select className="combo-box" value={flip} onChange={(e) => handleFlip(e.target.value)}>
              <option>无</option>
              <option>水平</option>
              <option>垂直</option>
            </select>
          </Property>

          {showSpeed && (
            <Property label="播放速度">
              <div className="slider-container">
                <input
                  type="range"
                  className="slider"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={speed}
                  onChange={(e) => handleSpeed(Number(e.target.value))}
                />
                <div className="slider__value">{speed.toFixed(1)}x</div>
              </div>
            </Property>
          )}

          {showVolume && (
            <Property label="音量">
              <div className="slider-container">
                <input
                  type="range"
                  className="slider"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  onChange={(e) => handleVolume(Number(e.target.value))}
                />
                <div className="slider__value">{volume}%</div>
              </div>
            </Property>
          )}
        </div>

        {item.meta && (
          <div className="settings-group">
            <div className="settings-group__header">资源信息</div>
            <div className="sidebar-property" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {(item.meta.Author as string) && (
                <InfoLine label="作者" value={String(item.meta.Author)} />
              )}
              {(item.meta.Desc as string) && <InfoLine label="描述" value={String(item.meta.Desc)} />}
              {Array.isArray(item.meta.Tags) && (
                <InfoLine label="标签" value={(item.meta.Tags as string[]).join(' / ')} />
              )}
              {item.meta.Source === 'flowwall' && (
                <InfoLine
                  label="来源"
                  value={`FlowWall 在线壁纸${typeof item.meta.DownloadedAt === 'string' ? ` · ${new Date(item.meta.DownloadedAt).toLocaleDateString()} 下载` : ''}`}
                />
              )}
              <InfoLine label="ID" value={item.id} mono />
            </div>
          </div>
        )}
      </div>

      <div className="sidebar__footer">
        <button className="btn btn--primary" onClick={props.onApply} title="应用并保存到当前显示器">
          {isApplied ? <Check size={14} /> : <Monitor size={14} />}
          <span>{isApplied ? '已应用并保存' : '应用并保存'}</span>
        </button>
        <button
          className="btn"
          onClick={handleReset}
          title="恢复默认参数"
        >
          <RotateCcw size={14} />
          <span>重置</span>
        </button>
        {props.onDelete && (
          <button className="btn sidebar-delete-btn" onClick={props.onDelete} title="删除本地壁纸">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </aside>
  )
}

function Property(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="sidebar-property">
      <div className="sidebar-property__body">
        <div className="sidebar-property__title">{props.label}</div>
        <div className="sidebar-property__control">{props.children}</div>
      </div>
    </div>
  )
}

function InfoLine(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        padding: '4px 0',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{props.label}</span>
      <span
        style={{
          color: 'var(--text-primary)',
          textAlign: 'right',
          fontFamily: props.mono ? 'monospace' : 'inherit',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={props.value}
      >
        {props.value}
      </span>
    </div>
  )
}
