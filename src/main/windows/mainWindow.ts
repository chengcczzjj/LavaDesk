import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { store } from '../store'
import { secureWindowNavigation } from './navigationSecurity'

const appIconPath = app.isPackaged
  ? join(process.resourcesPath, 'build', 'icon.ico')
  : join(__dirname, '../../resources/build/icon.ico')

let mainWindow: BrowserWindow | null = null
/** 标记本次应用会话是否已经展示过主窗口（用于导航状态恢复） */
let hasShownMainWindow = false

export interface MainWindowNavTarget {
  activity: string
  subPage?: string
}

export function createMainWindow(target?: MainWindowNavTarget): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  const bounds = getRestorableMainWindowBounds(store.get('mainWindowBounds'))

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 780,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Match the light UI so resizing/maximising never flashes dark edges before repaint.
    backgroundColor: '#eef2f7',
    frame: false,
    titleBarStyle: 'hidden',
    title: 'LavaDesk',
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      additionalArguments: ['--lingyue-window-role=main'],
    },
  })

  // 窗口加载完毕后自动显示（createMainWindow 只在用户主动操作时调用）
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds()
      store.set('mainWindowBounds', b)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  secureWindowNavigation(mainWindow, true)

  if (is.dev) {
    mainWindow.webContents.on('console-message', (details) => {
      if (details.level === 'warning' || details.level === 'error') {
        console.error(`[main-ui] ${details.sourceId}:${details.lineNumber} ${details.message}`)
      }
    })
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[main-ui] load failed ${errorCode} ${errorDescription}: ${validatedUrl}`)
    })
  }

  // 首次启动不传 restore 参数（回到首页），后续窗口重建传 restore=1（恢复上次页面）
  const shouldRestore = hasShownMainWindow
  hasShownMainWindow = true

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const params = new URLSearchParams()
    if (shouldRestore) params.set('restore', '1')
    if (target?.activity) params.set('activity', target.activity)
    if (target?.subPage) params.set('subPage', target.subPage)
    const q = params.toString() ? `?${params.toString()}` : ''
    mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/main-ui/index.html${q}`)
  } else {
    const query: Record<string, string> = {}
    if (shouldRestore) query.restore = '1'
    if (target?.activity) query.activity = target.activity
    if (target?.subPage) query.subPage = target.subPage
    mainWindow.loadFile(join(__dirname, '../renderer/main-ui/index.html'), {
      query: Object.keys(query).length > 0 ? query : undefined,
    })
  }

  return mainWindow
}

/**
 * Only reuse the saved position while enough of the title bar is still on a
 * connected monitor; after a monitor is unplugged the window would otherwise
 * open off-screen. Size is kept, position falls back to Electron's centring.
 */
function getRestorableMainWindowBounds(
  saved: Electron.Rectangle | undefined,
): { width: number; height: number; x?: number; y?: number } | undefined {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return undefined
  const size = { width: Math.max(960, saved.width), height: Math.max(640, saved.height) }
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return size
  try {
    const titleBar = { x: saved.x, y: saved.y, width: size.width, height: 48 }
    const visible = screen.getAllDisplays().some(({ workArea }) => {
      const width = Math.min(titleBar.x + titleBar.width, workArea.x + workArea.width) - Math.max(titleBar.x, workArea.x)
      const height = Math.min(titleBar.y + titleBar.height, workArea.y + workArea.height) - Math.max(titleBar.y, workArea.y)
      return width >= 160 && height >= 24
    })
    return visible ? { ...size, x: saved.x, y: saved.y } : size
  } catch {
    return size
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// 防止 unused 警告
void app
