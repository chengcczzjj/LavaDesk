// Must stay the first import: moves LingyueDesk's data into LavaDesk's folder
// before electron-store, the memory database or Chromium open it.
import { finishLegacyMigrationAfterReady } from './runtime/legacyDataMigration'
import { app, BrowserWindow, session } from 'electron'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc-channels'
import { createMainWindow, getMainWindow } from './windows/mainWindow'
import { createWallpaperWindow } from './windows/wallpaperWindow'
import { createCanvasWindow } from './windows/canvasWindow'
import { normalizePersistedWallpaperDisplay } from './windows/displayLayout'
import { createTray } from './tray'
import { registerAppIpc } from './ipc/appIpc'
import { registerWallpaperIpc, restoreWallpaper } from './ipc/wallpaperIpc'
import { registerWallpaperResourceIpc } from './ipc/wallpaperResourceIpc'
import { registerWidgetIpc, restoreWidgets } from './ipc/widgetIpc'
import { registerDesktopIconIpc } from './ipc/desktopIconIpc'
import { registerDataIpc } from './ipc/dataIpc'
import { registerChatIpc } from './ipc/chatIpc'
import { registerCompanionIpc } from './ipc/companionIpc'
import { registerFlowWallIpc } from './ipc/flowwallIpc'
import { showMainWindow } from './ipc/appIpc'
import { handleLingyueDeepLink } from './services/flowwall-library'
import { LINGYUE_PROTOCOL, parseLingyueDeepLink } from '@shared/flowwall'
import { ReminderService } from './memory/desktop/reminderService'
import { applyQuickChatShortcut } from './services/quick-chat-shortcut'
import { allowAssetRoot, registerAssetProtocol, registerAssetSchemePrivileged } from './protocols'
import { getRemoteWallpapersRoot, getUserWallpapersRoot } from './runtime/userDataPaths'
import { initMemorySystem } from './memory'
import { isPreciseLocationPermissionAllowed } from './memory/tools/definitions/user-location'
import { applyLaunchAtLoginPreference } from './services/launch-at-login-service'
import { initializeAutoUpdate } from './services/update-service'
import { enableWallpaperOwnerMode } from './services/wallpaper-owner-service'
import { initializeWallpaperResourceUpdates } from './services/wallpaper-resource-service'
import { getDockDiagnosticLogPath, logDockDiagnostic } from './runtime/diagnosticLog'
import { runDockLaunchSelfTest } from './runtime/dockLaunchSelfTest'

// 必须在 app.ready 之前注册
registerAssetSchemePrivileged()

// Chromium's native window-occlusion tracker marks the bottom-most transparent
// canvas and the WorkerW-embedded wallpaper windows as occluded whenever a
// maximised or full-screen app covers them, and does not reliably un-occlude
// them afterwards. That left stale input surfaces (lost pointerdown) and
// forced the always-on-top repairs that flash widgets over other apps.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

// 开发模式下把 Chromium 会话缓存挪到临时目录，避免默认 profile 缓存权限冲突刷屏。
if (is.dev) {
  const sessionDataPath = join(app.getPath('temp'), 'LavaDesk', `electron-session-${process.pid}`)
  const diskCachePath = join(sessionDataPath, 'Cache')
  try {
    mkdirSync(diskCachePath, { recursive: true })
    app.setPath('sessionData', sessionDataPath)
    app.commandLine.appendSwitch('disk-cache-dir', diskCachePath)
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
    app.on('will-quit', () => {
      try {
        rmSync(sessionDataPath, { recursive: true, force: true })
      } catch {
        // ignore
      }
    })
  } catch (error) {
    console.warn('[startup] 开发缓存目录配置失败：', error)
  }
}

// 单实例
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

/**
 * lingyue:// links from the FlowWall site (or any page) open the online library
 * or offer a wallpaper download; the parser rejects everything else.
 */
function openDeepLink(argv: readonly string[]): boolean {
  const raw = argv.find((argument) => argument.startsWith(`${LINGYUE_PROTOCOL}://`))
  const link = raw ? parseLingyueDeepLink(raw) : null
  if (!link) return false
  showMainWindow({ activity: 'library', subPage: 'flowwall' })
  const win = getMainWindow()
  if (win) void handleLingyueDeepLink(link, win)
  return true
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (app.isReady()) openDeepLink([url])
})

app.on('second-instance', (_event, argv) => {
  if (openDeepLink(argv)) return
  const main = getMainWindow() ?? createMainWindow()
  if (argv.includes('--lingyue-wallpaper-owner')) {
    enableWallpaperOwnerMode()
    const navigateToPublisher = () => main.webContents.send(IPC.APP_NAVIGATE, {
      activity: 'library',
      subPage: 'store',
    })
    main.webContents.once('did-finish-load', navigateToPublisher)
    main.webContents.reload()
  }
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.lavadesk.app')
  logDockDiagnostic('app.started', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    logPath: getDockDiagnosticLogPath(),
  })
  await allowAssetRoot(app.isPackaged
    ? join(process.resourcesPath, 'assets', 'wallpaper')
    : join(__dirname, '../../assets/wallpaper'))
  await allowAssetRoot(getUserWallpapersRoot())
  await allowAssetRoot(getRemoteWallpapersRoot())
  registerAssetProtocol()

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      const main = getMainWindow()
      callback(Boolean(main && !main.isDestroyed() && webContents.id === main.webContents.id && isPreciseLocationPermissionAllowed()))
      return
    }
    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission !== 'geolocation') return false
    const main = getMainWindow()
    return Boolean(webContents && main && !main.isDestroyed() && webContents.id === main.webContents.id && isPreciseLocationPermissionAllowed())
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册 IPC
  registerAppIpc()
  registerWallpaperIpc()
  registerWallpaperResourceIpc()
  registerWidgetIpc()
  registerDesktopIconIpc()
  registerDataIpc()
  registerChatIpc()
  registerCompanionIpc()
  registerFlowWallIpc()
  if (app.isPackaged) app.setAsDefaultProtocolClient(LINGYUE_PROTOCOL)

  // Older releases stored monitor-relative coordinates and could leave a
  // virtual-desktop window straddling two displays.  Normalize before any
  // wallpaper or canvas window is created so the first frame is deterministic.
  normalizePersistedWallpaperDisplay()

  // 初始化记忆系统（建库/建表）
  initMemorySystem()

  // 创建窗口 — canvas 先于 mainWindow 创建，确保透明合成正确
  createWallpaperWindow()
  createCanvasWindow()
  createTray()
  applyLaunchAtLoginPreference()
  initializeAutoUpdate()
  initializeWallpaperResourceUpdates()
  if (process.argv.includes('--lingyue-wallpaper-owner')) {
    createMainWindow({ activity: 'library', subPage: 'store' })
  }
  // 普通启动延迟创建主窗口；所有者发布模式直接打开在线壁纸库。

  // 恢复上次状态
  await restoreWallpaper()
  await restoreWidgets()
  void finishLegacyMigrationAfterReady()
  ReminderService.start()
  applyQuickChatShortcut()
  openDeepLink(process.argv)
  if (is.dev && process.env.LINGYUE_DOCK_SELF_TEST) {
    const rounds = Math.max(1, Math.min(10, Number(process.env.LINGYUE_DOCK_SELF_TEST_ROUNDS) || 3))
    const initialDelayMs = Math.max(500, Math.min(60_000, Number(process.env.LINGYUE_DOCK_SELF_TEST_DELAY_MS) || 2_500))
    void runDockLaunchSelfTest(process.env.LINGYUE_DOCK_SELF_TEST, rounds, initialDelayMs)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// 关闭主界面不退出应用（壁纸/画布/托盘仍在运行）
app.on('window-all-closed', () => {
  // 桌面伴侣应用，保持后台。仅在显式调用 app.quit() 时退出。
})
