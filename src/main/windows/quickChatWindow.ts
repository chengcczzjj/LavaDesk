import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc-channels'
import { store } from '../store'
import { secureWindowNavigation } from './navigationSecurity'
import { getDisplayDescriptors } from './displayLayout'

const WIDTH = 400
const HEIGHT = 560
const MARGIN = 20

let quickChatWindow: BrowserWindow | null = null

export function getQuickChatWindow(): BrowserWindow | null {
  return quickChatWindow && !quickChatWindow.isDestroyed() ? quickChatWindow : null
}

/** Open next to the desktop pet when there is one, otherwise above the tray corner. */
function resolvePosition(): { x: number; y: number } {
  const displays = getDisplayDescriptors()
  const widgets = store.get('widgets') ?? []
  const pet = widgets.find((widget) => widget.type === 'pet' && widget.enabled)
  const petDisplay = pet ? displays.find((display) => display.key === pet.displayKey) ?? displays.find((display) => display.primary) : undefined
  const area = petDisplay?.workArea ?? screen.getPrimaryDisplay().workArea
  const clamp = (x: number, y: number) => ({
    x: Math.round(Math.max(area.x + MARGIN, Math.min(x, area.x + area.width - WIDTH - MARGIN))),
    y: Math.round(Math.max(area.y + MARGIN, Math.min(y, area.y + area.height - HEIGHT - MARGIN))),
  })
  if (pet && petDisplay) {
    const petX = petDisplay.bounds.x + pet.x
    const petY = petDisplay.bounds.y + pet.y
    const petWidth = pet.width || 160
    const leftSide = petX - WIDTH - 12
    const x = leftSide >= area.x + MARGIN ? leftSide : petX + petWidth + 12
    return clamp(x, petY + (pet.height || 160) - HEIGHT)
  }
  return clamp(area.x + area.width - WIDTH - MARGIN, area.y + area.height - HEIGHT - MARGIN)
}

function createQuickChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '灵月快捷对话',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      additionalArguments: ['--lingyue-window-role=quick-chat'],
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  secureWindowNavigation(win, true)
  win.on('closed', () => {
    quickChatWindow = null
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-chat/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/quick-chat/index.html'))
  }
  return win
}

export function showQuickChat(): void {
  const win = getQuickChatWindow() ?? (quickChatWindow = createQuickChatWindow())
  const position = resolvePosition()
  win.setBounds({ ...position, width: WIDTH, height: HEIGHT })
  const reveal = () => {
    win.show()
    win.focus()
    win.webContents.send(IPC.QUICK_CHAT_SHOWN)
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', reveal)
  else reveal()
}

export function hideQuickChat(): void {
  const win = getQuickChatWindow()
  if (win?.isVisible()) win.hide()
}

export function toggleQuickChat(): void {
  const win = getQuickChatWindow()
  if (win?.isVisible() && win.isFocused()) hideQuickChat()
  else showQuickChat()
}

export function isQuickChatVisible(): boolean {
  return Boolean(getQuickChatWindow()?.isVisible())
}
