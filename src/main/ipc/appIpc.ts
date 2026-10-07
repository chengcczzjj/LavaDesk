import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import { IPC } from '@shared/ipc-channels'
import { getMainWindow, createMainWindow } from '../windows/mainWindow'
import type { MainWindowNavTarget } from '../windows/mainWindow'
import { getLocationPrivacySettings, requestPreciseLocationAuthorization, setPreciseLocationEnabled, validatePreciseLocationEnabled } from '../memory/tools/definitions/user-location'
import { assertTrustedIpcSender } from './ipcSecurity'
import { getLaunchAtLoginStatus, setLaunchAtLoginEnabled } from '../services/launch-at-login-service'
import { checkForAppUpdates, downloadAppUpdate, getAppUpdateStatus, installDownloadedUpdate } from '../services/update-service'
import { toggleWindowsDesktop } from '../windows/windowsDesktop'
import { logDockDiagnostic } from '../runtime/diagnosticLog'
import { getLavaNotesStatus, openLavaNotes, openLavaNotesDownload } from '../services/lavanotes-service'
import type { LavaNotesCommand } from '@shared/types'

const LAVANOTES_COMMANDS: readonly LavaNotesCommand[] = ['new', 'open', 'manager']

function showMainWindow(target?: MainWindowNavTarget): void {
  const win = getMainWindow() ?? createMainWindow(target)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (!target || win.webContents.isDestroyed()) return

  const sendNavigate = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.APP_NAVIGATE, target)
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendNavigate)
  } else {
    sendNavigate()
  }
}

export function registerAppIpc(): void {
  ipcMain.handle(IPC.APP_GET_VERSION, (event) => { assertTrustedIpcSender(event, ['main']); return app.getVersion() })
  ipcMain.handle(IPC.APP_GET_LAUNCH_AT_LOGIN, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return getLaunchAtLoginStatus()
  })
  ipcMain.handle(IPC.APP_SET_LAUNCH_AT_LOGIN, (event, enabled: boolean) => {
    assertTrustedIpcSender(event, ['main'])
    return setLaunchAtLoginEnabled(enabled === true)
  })
  ipcMain.handle(IPC.APP_UPDATE_GET_STATUS, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return getAppUpdateStatus()
  })
  ipcMain.handle(IPC.APP_UPDATE_CHECK, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return checkForAppUpdates()
  })
  ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return downloadAppUpdate()
  })
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return installDownloadedUpdate()
  })
  ipcMain.handle(IPC.APP_GET_LOCATION_SETTINGS, (event) => { assertTrustedIpcSender(event, ['main']); return getLocationPrivacySettings() })
  ipcMain.handle(IPC.APP_SET_PRECISE_LOCATION_ENABLED, (_e, enabled: boolean) => {
    assertTrustedIpcSender(_e, ['main'])
    return { ok: true, settings: setPreciseLocationEnabled(enabled === true) }
  })
  ipcMain.handle(IPC.APP_REQUEST_PRECISE_LOCATION_AUTHORIZATION, async (event) => {
    assertTrustedIpcSender(event, ['main'])
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow()
    const messageOptions: Electron.MessageBoxOptions = {
      type: 'question',
      title: '允许精准定位',
      message: '允许 LavaDesk 使用设备精准位置吗？',
      detail: '开启后，AI 的天气和位置相关工具可以使用设备/系统定位返回的坐标。关闭时只使用粗略城市级位置。',
      buttons: ['允许', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const result = win
      ? await dialog.showMessageBox(win, messageOptions)
      : await dialog.showMessageBox(messageOptions)
    if (result.response !== 0) {
      return { ok: false, settings: getLocationPrivacySettings(), error: '已取消精准定位授权。' }
    }
    return requestPreciseLocationAuthorization()
  })
  ipcMain.handle(IPC.APP_VALIDATE_PRECISE_LOCATION, (event) => { assertTrustedIpcSender(event, ['main']); return validatePreciseLocationEnabled() })
  ipcMain.handle(IPC.APP_OPEN_LOCATION_SETTINGS, async (event) => {
    assertTrustedIpcSender(event, ['main'])
    if (process.platform !== 'win32') return false
    try {
      await shell.openExternal('ms-settings:privacy-location')
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle(IPC.LAVANOTES_STATUS, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return getLavaNotesStatus()
  })
  ipcMain.handle(IPC.LAVANOTES_OPEN, (event, command: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    if (!LAVANOTES_COMMANDS.includes(command as LavaNotesCommand)) throw new Error('invalid LavaNotes command')
    return openLavaNotes(command as LavaNotesCommand)
  })
  ipcMain.handle(IPC.LAVANOTES_DOWNLOAD, async (event) => {
    assertTrustedIpcSender(event, ['main'])
    await openLavaNotesDownload()
    return true
  })
  ipcMain.on(IPC.APP_QUIT, (event) => { assertTrustedIpcSender(event, ['main']); app.quit() })
  ipcMain.on(IPC.APP_SHOW_MAIN, (event) => {
    assertTrustedIpcSender(event, ['main'])
    showMainWindow()
  })
  ipcMain.handle(IPC.APP_OPEN_SETTINGS, async (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    await shell.openExternal('ms-settings:')
    return true
  })
  ipcMain.handle(IPC.APP_OPEN_EXPLORER, async (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    const error = await shell.openPath(app.getPath('home'))
    return !error
  })
  ipcMain.handle(IPC.APP_OPEN_RECYCLE_BIN, (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    if (process.platform !== 'win32') return false
    try {
      const child = spawn('explorer.exe', ['shell:RecycleBinFolder'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle(IPC.APP_SHOW_DESKTOP, (event) => {
    assertTrustedIpcSender(event, ['main', 'canvas'])
    const ok = toggleWindowsDesktop()
    logDockDiagnostic('desktop.toggle-requested', { ok, method: 'send-input-win-d' })
    return ok
  })

  ipcMain.on(IPC.WIN_MINIMIZE, (e) => {
    assertTrustedIpcSender(e, ['main'])
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.on(IPC.WIN_MAXIMIZE_TOGGLE, (e) => {
    assertTrustedIpcSender(e, ['main'])
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })
  ipcMain.on(IPC.WIN_CLOSE, (e) => {
    assertTrustedIpcSender(e, ['main'])
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}
