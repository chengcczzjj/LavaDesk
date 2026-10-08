import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import { assertTrustedIpcSender } from './ipcSecurity'
import { getMainWindow } from '../windows/mainWindow'
import {
  attachFlowWallView,
  cancelFlowWallDownload,
  clearFinishedFlowWallDownloads,
  detachFlowWallView,
  getFlowWallViewState,
  listFlowWallDownloads,
  navigateFlowWall,
  openFlowWallInBrowser,
} from '../services/flowwall-library'

const boundsSchema = z.object({
  x: z.number().finite().min(0).max(20_000),
  y: z.number().finite().min(0).max(20_000),
  width: z.number().finite().min(0).max(20_000),
  height: z.number().finite().min(0).max(20_000),
})
const navigateSchema = z.union([
  z.enum(['back', 'forward', 'reload', 'home', 'stop']),
  z.object({ url: z.string().url().max(4096) }),
])

export function registerFlowWallIpc(): void {
  ipcMain.handle(IPC.FLOWWALL_ATTACH, (event, bounds: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    const win = getMainWindow()
    if (!win) throw new Error('主窗口不可用')
    return attachFlowWallView(win, boundsSchema.parse(bounds))
  })
  ipcMain.on(IPC.FLOWWALL_DETACH, (event) => {
    assertTrustedIpcSender(event, ['main'])
    detachFlowWallView()
  })
  ipcMain.handle(IPC.FLOWWALL_NAVIGATE, (event, action: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    return navigateFlowWall(navigateSchema.parse(action))
  })
  ipcMain.handle(IPC.FLOWWALL_OPEN_EXTERNAL, (event) => {
    assertTrustedIpcSender(event, ['main'])
    openFlowWallInBrowser()
    return true
  })
  ipcMain.handle(IPC.FLOWWALL_GET_STATE, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return { view: getFlowWallViewState(), downloads: listFlowWallDownloads() }
  })
  ipcMain.handle(IPC.FLOWWALL_CANCEL_DOWNLOAD, (event, id: unknown) => {
    assertTrustedIpcSender(event, ['main'])
    return cancelFlowWallDownload(z.string().uuid().parse(id))
  })
  ipcMain.handle(IPC.FLOWWALL_CLEAR_DOWNLOADS, (event) => {
    assertTrustedIpcSender(event, ['main'])
    return clearFinishedFlowWallDownloads()
  })
}
