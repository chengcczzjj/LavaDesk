import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { createMainWindow, getMainWindow } from './windows/mainWindow'
import { showQuickChat } from './windows/quickChatWindow'

let tray: Tray | null = null
let updateEntry: TrayUpdateEntry | null = null

export interface TrayUpdateEntry {
  label: string
  enabled: boolean
  onClick?: () => void
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        const win = getMainWindow()
        if (win) {
          win.show()
          win.focus()
        } else {
          createMainWindow()
        }
      },
    },
    { label: '快捷对话', click: () => showQuickChat() },
    ...(updateEntry
      ? [
          { type: 'separator' as const },
          { label: updateEntry.label, enabled: updateEntry.enabled, click: () => updateEntry?.onClick?.() },
        ]
      : []),
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])
}

/** Show (or clear) an update action in the tray menu and tooltip. */
export function setTrayUpdateEntry(entry: TrayUpdateEntry | null): void {
  updateEntry = entry
  tray?.setToolTip(entry?.enabled ? `LavaDesk · ${entry.label}` : 'LavaDesk')
}

export function createTray(): Tray {
  // 资源在 dev 与打包后路径不同
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'build', 'icon.ico')
    : join(__dirname, '../../resources/build/icon.ico')

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('LavaDesk')

  // 不用 setContextMenu（Windows 上会吞掉首次左键点击），改用 right-click 弹出；
  // 每次弹出时重建，以便显示最新的更新状态。
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildTrayMenu())
  })

  tray.on('click', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isVisible() && !win.isMinimized()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    } else {
      createMainWindow()
    }
  })

  return tray
}

export function getTray(): Tray | null {
  return tray
}
