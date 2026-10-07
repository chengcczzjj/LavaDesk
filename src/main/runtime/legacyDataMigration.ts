import { app, dialog, shell } from 'electron'
import { execFileSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  copyLegacyUserData,
  planLegacyMigration,
  writeMigrationMarker,
  type MigrationStatus,
} from './legacyUserDataCore'

/**
 * LingyueDesk → LavaDesk data move. Imported first by src/main/index.ts so it
 * runs before electron-store, the memory database or Chromium open the new
 * userData folder.
 */

const LEGACY_EXE = 'LingyueDesk.exe'
/** Run-key names the old app may have used for "start with Windows". */
const LEGACY_LOGIN_ITEM_NAMES = ['com.lingyue.desk', 'electron.app.LingyueDesk', 'electron.app.lingyue-desk']

export interface LegacyMigrationResult {
  status: MigrationStatus | 'none' | 'skipped'
  legacyDir?: string
  files?: number
  bytes?: number
  error?: string
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isLegacyAppRunning(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${LEGACY_EXE}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
    return output.toLowerCase().includes(`"${LEGACY_EXE.toLowerCase()}"`)
  } catch {
    return false
  }
}

function waitUntilClosed(timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isLegacyAppRunning()) return true
    sleepSync(400)
  }
  return !isLegacyAppRunning()
}

/** The old app keeps its database open; ask it to close, then force it. */
function closeLegacyApp(): boolean {
  if (!isLegacyAppRunning()) return true
  try {
    execFileSync('taskkill', ['/IM', LEGACY_EXE, '/T'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  } catch {
    // An Electron tray app often ignores WM_CLOSE; fall through to /F.
  }
  if (waitUntilClosed(6000)) return true
  try {
    execFileSync('taskkill', ['/IM', LEGACY_EXE, '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
  } catch {
    // Reported below if the process is still there.
  }
  const closed = waitUntilClosed(4000)
  // Give Windows a moment to release the database file handles.
  if (closed) sleepSync(800)
  return closed
}

function runMigration(): LegacyMigrationResult {
  if (!app.isPackaged || process.env.LAVADESK_SKIP_LEGACY_MIGRATION === '1') return { status: 'skipped' }
  const targetDir = app.getPath('userData')
  const at = () => new Date().toISOString()
  let plan: ReturnType<typeof planLegacyMigration>
  try {
    plan = planLegacyMigration({ appDataDir: app.getPath('appData'), targetDir })
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  if (plan.action === 'none') return { status: 'none' }
  if (plan.action === 'record') {
    try {
      writeMigrationMarker(targetDir, plan.marker)
    } catch {
      // Planning runs again next start; nothing was copied.
    }
    return { status: plan.marker.status, legacyDir: plan.marker.from }
  }
  if (!closeLegacyApp()) {
    writeMigrationMarker(targetDir, { status: 'pending', at: at(), from: plan.legacyDir, error: 'legacy-app-running' })
    return { status: 'pending', legacyDir: plan.legacyDir }
  }
  try {
    const stats = copyLegacyUserData(plan.legacyDir, targetDir)
    writeMigrationMarker(targetDir, { status: 'done', at: at(), from: plan.legacyDir, ...stats })
    return { status: 'done', legacyDir: plan.legacyDir, files: stats.files, bytes: stats.bytes }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeMigrationMarker(targetDir, { status: 'failed', at: at(), from: plan.legacyDir, error: message })
    return { status: 'failed', legacyDir: plan.legacyDir, error: message }
  }
}

export const legacyMigrationResult: LegacyMigrationResult = runMigration()

function findLegacyUninstaller(): string | null {
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'LingyueDesk') : '',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'LingyueDesk') : '',
  ].filter(Boolean)
  for (const root of roots) {
    const uninstaller = join(root, 'Uninstall LingyueDesk.exe')
    if (existsSync(uninstaller)) return uninstaller
  }
  return null
}

/** Stop the old app from starting with Windows next to LavaDesk. */
function removeLegacyLoginItems(): void {
  if (process.platform !== 'win32') return
  for (const name of LEGACY_LOGIN_ITEM_NAMES) {
    try {
      app.setLoginItemSettings({ openAtLogin: false, name })
    } catch {
      // Missing entries are fine.
    }
  }
}

/** Dialogs and clean-up that need app.ready. */
export async function finishLegacyMigrationAfterReady(): Promise<void> {
  const result = legacyMigrationResult
  if (result.status === 'done') {
    removeLegacyLoginItems()
    const uninstaller = findLegacyUninstaller()
    if (!uninstaller) return
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'LavaDesk',
      message: '灵月桌面已经升级为 LavaDesk',
      detail: `壁纸、组件、聊天记忆和设置已经迁移到 LavaDesk。\n旧版灵月桌面仍然安装着，可以现在卸载它；旧的数据文件夹会保留在：\n${result.legacyDir ?? ''}`,
      buttons: ['卸载旧版', '以后再说'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (choice.response === 0) spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (result.status === 'pending') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'LavaDesk',
      message: '旧版灵月桌面还在运行，数据暂时没有迁移',
      detail: '请在任务栏托盘里退出旧版灵月桌面，然后重新打开 LavaDesk，它会自动把壁纸、组件、聊天记忆和设置迁移过来。',
      buttons: ['好的'],
      noLink: true,
    })
    return
  }
  if (result.status === 'failed') {
    const choice = await dialog.showMessageBox({
      type: 'error',
      title: 'LavaDesk',
      message: '旧版数据迁移没有完成',
      detail: `原来的数据没有被改动，仍在：\n${result.legacyDir ?? '（未找到）'}\n\n错误：${result.error ?? '未知'}\n可以检查磁盘空间后重试；重试会用旧数据替换 LavaDesk 这次新建的默认设置。`,
      buttons: ['重试迁移', '打开旧数据文件夹', '关闭'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (choice.response === 0) {
      writeMigrationMarker(app.getPath('userData'), { status: 'pending', at: new Date().toISOString(), from: result.legacyDir, error: 'retry-requested' })
      app.relaunch()
      app.exit(0)
    } else if (choice.response === 1 && result.legacyDir) {
      void shell.openPath(result.legacyDir)
    }
  }
}
