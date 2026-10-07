import {
  Image as ImageIcon,
  LayoutGrid,
  Cat,
  MessageCircle,
  Settings,
  MoreHorizontal,
  Plus,
  Search,
  Minus,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { WallpaperApplyTarget, WallpaperDisplaySettings } from '@shared/types'
import { LibraryPage } from './pages/LibraryPage'
import { WallpaperDisplayControls } from './components/WallpaperDisplayControls'
import { OnlineWallpaperPage } from './pages/OnlineWallpaperPage'
import { EmptyPage } from './pages/EmptyPage'
import { WidgetsPage } from './pages/WidgetsPage'
import { PixelPetPage } from './pages/pet/PixelPetPage'
import { ChatPage } from './pages/chat/ChatPage'
import { SettingsGeneralPage } from './pages/settings/SettingsGeneralPage'
import { DisplaySettingsPage } from './pages/settings/DisplaySettingsPage'
import { AddWallpaperDialog, type InitialFile } from './components/AddWallpaperDialog'
import { SidebarUpdateButton } from './components/SidebarUpdateButton'
import {
  PIXEL_PET_SETTINGS_KEY,
  PIXEL_PET_STORAGE_KEY,
  PIXEL_PET_THEME_EVENT,
  buildPixelPetThemeVars,
  createDefaultPixelPets,
  getActivePixelPet,
  normalizePixelPet,
  normalizePixelPetSettings,
  resolvePixelPetPalette,
  type PixelPet,
} from '@renderer/shared/pixel-pet'
import appIcon from './assets/app-icon.png'
import './styles.css'

type ActivityKey = 'memory' | 'library' | 'widgets' | 'pet' | 'settings'

const NAV_TABS: Record<ActivityKey, { label: string; pages?: { id: string; label: string }[] }> = {
  memory: { label: 'AI 对话' },
  library: {
    label: '壁纸资源',
    pages: [
      { id: 'library', label: '本地壁纸' },
      { id: 'store', label: '壁纸库' },
      { id: 'maker', label: '壁纸制作' },
    ],
  },
  widgets: {
    label: '小组件',
    pages: [
      { id: 'widgets-tasks', label: '便签' },
      { id: 'widgets-floating', label: '悬浮挂件' },
      { id: 'widgets-card', label: '卡片组件' },
      { id: 'widgets-icons', label: '图标收纳' },
    ],
  },
  pet: {
    label: '桌宠',
    pages: [{ id: 'pet-pixel', label: '像素宠物' }],
  },
  settings: {
    label: '设置',
    pages: [
      { id: 'settings-general', label: '通用' },
      { id: 'settings-displays', label: '显示器' },
      { id: 'settings-performance', label: '性能' },
      { id: 'settings-wallpaper', label: '壁纸' },
      { id: 'settings-screensaver', label: '屏保' },
      { id: 'settings-system', label: '系统' },
    ],
  },
}

/** 判断 URL 是否携带 restore 参数（窗口重建时恢复上次页面） */
const initialParams = new URLSearchParams(window.location.search)
const shouldRestore = initialParams.has('restore')

function loadPixelPetAppThemeStyle(): CSSProperties {
  const defaults = createDefaultPixelPets()
  let pets: PixelPet[] = defaults
  try {
    const saved = JSON.parse(localStorage.getItem(PIXEL_PET_STORAGE_KEY) || '[]')
    const defaultIds = new Set(defaults.map((pet) => pet.id))
    const generated = Array.isArray(saved)
      ? saved.filter((pet) => !defaultIds.has(isRecord(pet) ? String(pet.id || '') : '')).map(normalizePixelPet)
      : []
    pets = [...defaults, ...generated]
  } catch {
    pets = defaults
  }

  let settings = normalizePixelPetSettings({}, pets)
  try {
    settings = normalizePixelPetSettings(JSON.parse(localStorage.getItem(PIXEL_PET_SETTINGS_KEY) || '{}'), pets)
  } catch {
    settings = normalizePixelPetSettings({}, pets)
  }

  const palette = resolvePixelPetPalette(getActivePixelPet(pets, settings), settings.theme)
  return buildPixelPetThemeVars(palette) as CSSProperties
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isActivityKey(value: string | null | undefined): value is ActivityKey {
  return Boolean(value && NAV_TABS[value as ActivityKey])
}

function loadSavedNav(): { activity: ActivityKey; subPage: string } {
  const resolveSubPage = (activity: ActivityKey, candidate: string | null | undefined): string => {
    const pages = NAV_TABS[activity].pages ?? []
    return pages.some((page) => page.id === candidate) ? String(candidate) : pages[0]?.id || ''
  }
  const activityParam = initialParams.get('activity')
  if (isActivityKey(activityParam)) {
    return {
      activity: activityParam,
      subPage: resolveSubPage(activityParam, initialParams.get('subPage')),
    }
  }

  if (shouldRestore) {
    try {
      const saved = localStorage.getItem('lingyue-nav')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.activity && NAV_TABS[parsed.activity as ActivityKey]) {
          const savedActivity = parsed.activity as ActivityKey
          return { activity: savedActivity, subPage: resolveSubPage(savedActivity, parsed.subPage) }
        }
      }
    } catch { /* ignore */ }
  }
  return { activity: 'memory', subPage: '' }
}

export function App() {
  const saved = loadSavedNav()
  const [activity, setActivity] = useState<ActivityKey>(saved.activity)
  const [subPage, setSubPage] = useState<string>(saved.subPage)
  const [appThemeStyle, setAppThemeStyle] = useState<CSSProperties>(() => loadPixelPetAppThemeStyle())
  const [search, setSearch] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [droppedWallpaperFile, setDroppedWallpaperFile] = useState<InitialFile | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [displaySettings, setDisplaySettings] = useState<WallpaperDisplaySettings | null>(null)
  const [wallpaperTarget, setWallpaperTarget] = useState<WallpaperApplyTarget>('current')

  const openAddDialog = useCallback((file: InitialFile | null = null) => {
    setDroppedWallpaperFile(file)
    setShowAddDialog(true)
  }, [])

  // 持久化当前导航状态到 localStorage（窗口重建时可恢复）
  useEffect(() => {
    localStorage.setItem('lingyue-nav', JSON.stringify({ activity, subPage }))
  }, [activity, subPage])

  useEffect(() => {
    const syncStoredTheme = (event?: StorageEvent) => {
      if (event && event.key !== PIXEL_PET_SETTINGS_KEY && event.key !== PIXEL_PET_STORAGE_KEY) return
      setAppThemeStyle(loadPixelPetAppThemeStyle())
    }
    const syncLiveTheme = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, string>>).detail
      setAppThemeStyle((detail || loadPixelPetAppThemeStyle()) as CSSProperties)
    }
    window.addEventListener('storage', syncStoredTheme)
    window.addEventListener(PIXEL_PET_THEME_EVENT, syncLiveTheme)
    return () => {
      window.removeEventListener('storage', syncStoredTheme)
      window.removeEventListener(PIXEL_PET_THEME_EVENT, syncLiveTheme)
    }
  }, [])

  useEffect(() => {
    return window.lingyue.app.onNavigate((target) => {
      if (!isActivityKey(target.activity)) return
      const pages = NAV_TABS[target.activity].pages ?? []
      const requested = target.subPage
      const nextSubPage = pages.some((page) => page.id === requested) ? String(requested) : pages[0]?.id || ''
      setActivity(target.activity)
      setSubPage(nextSubPage)
    })
  }, [])

  // Keep display selection in the shared toolbar across local and online tabs.
  useEffect(() => {
    let alive = true
    const sync = async () => {
      try {
        const next = await window.lingyue.wallpaper.getDisplaySettings()
        if (!alive) return
        setDisplaySettings(next)
        setWallpaperTarget((target) => {
          if (typeof target === 'number' && next.displays.some((display) => display.id === target)) return target
          return next.displays.find((display) => display.primary)?.id ?? next.displays[0]?.id ?? 'current'
        })
      } catch {
        // The selector renders an empty state until Electron exposes displays.
      }
    }
    void sync()
    const off = window.lingyue.wallpaper.onDisplaySettingsChanged(() => void sync())
    return () => {
      alive = false
      off()
    }
  }, [])

  const tabs = NAV_TABS[activity].pages
  const effectiveWallpaperTarget: WallpaperApplyTarget = displaySettings?.mode === 'per-display'
    ? wallpaperTarget
    : 'current'

  const switchActivity = (key: ActivityKey) => {
    setActivity(key)
    const first = NAV_TABS[key].pages?.[0]?.id
    if (first) setSubPage(first)
  }

  return (
    <div
      className={`app-shell app-shell--${activity} ${activity === 'library' ? 'app-shell--wallpaper' : 'app-shell--pet-theme'}`}
      style={activity === 'library' ? undefined : appThemeStyle}
    >
      <header className="title-bar">
        <img className="title-bar__icon" src={appIcon} alt="" />
        <span className="title-bar__text">LavaDesk</span>
        <div className="title-bar__spacer" />
        {activity === 'library' && (
          <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                top: '50%',
                left: 10,
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
                pointerEvents: 'none',
              }}
            />
            <input
              className="title-bar__search"
              type="text"
              placeholder="搜索壁纸…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 28 }}
            />
          </div>
        )}
        <div className="title-bar__spacer" />
        <WindowControls />
      </header>

      <div className="app-body">
        <nav className="activity-bar">
          <ActivityItem
            icon={<MessageCircle size={20} />}
            active={activity === 'memory'}
            onClick={() => switchActivity('memory')}
            title="AI 对话"
          />
          <ActivityItem
            icon={<ImageIcon size={20} />}
            active={activity === 'library'}
            onClick={() => switchActivity('library')}
            title="壁纸资源"
          />
          <ActivityItem
            icon={<LayoutGrid size={20} />}
            active={activity === 'widgets'}
            onClick={() => switchActivity('widgets')}
            title="小组件"
          />
          <ActivityItem
            icon={<Cat size={20} />}
            active={activity === 'pet'}
            onClick={() => switchActivity('pet')}
            title="桌宠"
          />
          <div className="activity-bar__spacer" />
          <SidebarUpdateButton />
          <ActivityItem
            icon={<Settings size={20} />}
            active={activity === 'settings'}
            onClick={() => switchActivity('settings')}
            title="设置"
          />
          <ActivityItem icon={<MoreHorizontal size={20} />} onClick={() => undefined} title="更多（即将推出）" disabled />
        </nav>

        <div className="app-content">
          {activity === 'memory' ? (
            <ChatPage />
          ) : (
          <>
          <nav className="top-nav">
            <div className="top-nav__items">
              {tabs?.map((t) => (
                <button
                  key={t.id}
                  className={`nav-item ${subPage === t.id ? 'active' : ''}`}
                  onClick={() => setSubPage(t.id)}
                >
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            {activity === 'library' && (
              <div className="nav-footer">
                {(subPage === 'library' || subPage === 'store') && (
                  <WallpaperDisplayControls
                    settings={displaySettings}
                    target={wallpaperTarget}
                    onTargetChange={setWallpaperTarget}
                    onSettingsChange={setDisplaySettings}
                  />
                )}
                <button className="nav-btn" title="添加壁纸" onClick={() => openAddDialog()}>
                  <Plus size={16} />
                </button>
              </div>
            )}
          </nav>

          <div className="page-content">
            {activity === 'library' && subPage === 'library' && (
              <LibraryPage
                search={search}
                refreshKey={refreshKey}
                wallpaperTarget={effectiveWallpaperTarget}
                displaySettings={displaySettings}
                onDisplaySelect={setWallpaperTarget}
                onDisplaySettingsChange={setDisplaySettings}
                onDropFile={openAddDialog}
              />
            )}
            {activity === 'library' && subPage === 'store' && (
              <OnlineWallpaperPage
                search={search}
                refreshKey={refreshKey}
                wallpaperTarget={effectiveWallpaperTarget}
                displaySettings={displaySettings}
              />
            )}
            {activity === 'library' && subPage === 'maker' && (
              <EmptyPage icon={<ImageIcon size={48} />} title="壁纸制作" subtitle="即将推出" />
            )}
            {activity === 'widgets' && (
              <WidgetsPage subPage={subPage} />
            )}
            {activity === 'pet' && subPage === 'pet-pixel' && <PixelPetPage />}
            {activity === 'settings' && subPage === 'settings-general' && (
              <SettingsGeneralPage />
            )}
            {activity === 'settings' && subPage === 'settings-displays' && (
              <DisplaySettingsPage />
            )}
            {activity === 'settings' && subPage !== 'settings-general' && subPage !== 'settings-displays' && (
              <EmptyPage
                icon={<Settings size={48} />}
                title={tabs?.find((tab) => tab.id === subPage)?.label ?? '设置'}
                subtitle="即将推出"
              />
            )}
          </div>
          </>
          )}
        </div>
      </div>

      <AddWallpaperDialog
        open={showAddDialog}
        initialFile={droppedWallpaperFile}
        onClose={() => {
          setShowAddDialog(false)
          setDroppedWallpaperFile(null)
        }}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}

function ActivityItem(props: {
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
  title: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`activity-bar__item ${props.active ? 'active' : ''}`}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      aria-current={props.active ? 'page' : undefined}
      disabled={props.disabled}
    >
      {props.icon}
    </button>
  )
}

function WindowControls() {
  return (
    <div className="window-controls">
      <button
        className="window-controls__btn"
        title="最小化"
        onClick={() => window.lingyue.window.minimize()}
      >
        <Minus size={14} />
      </button>
      <button
        className="window-controls__btn"
        title="最大化"
        onClick={() => window.lingyue.window.maximizeToggle()}
      >
        <Square size={12} />
      </button>
      <button
        className="window-controls__btn window-controls__btn--close"
        title="关闭"
        onClick={() => window.lingyue.window.close()}
      >
        <X size={14} />
      </button>
    </div>
  )
}
