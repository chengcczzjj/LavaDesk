import { app, Notification, powerMonitor } from 'electron'
import { spawn } from 'child_process'
import { statSync } from 'fs'
import { constants as osConstants, setPriority } from 'os'
import { extname, isAbsolute } from 'path'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC } from '@shared/ipc-channels'
import type { AppUpdateStatus } from '@shared/types'
import { toSafeUpdateErrorMessage } from '@shared/update-error'
import { logUpdateDiagnostic } from '../runtime/diagnosticLog'
import { getMainWindow } from '../windows/mainWindow'
import { setTrayUpdateEntry } from '../tray'

const INITIAL_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const INSTALLER_QUIT_DELAY_MS = 450
const INSTALLER_ARGS = ['--updated', '/S', '--force-run'] as const
/**
 * Back-off after a failed check or download. The first check runs shortly
 * after login, often before Wi-Fi/proxy is ready, and GitHub downloads can
 * drop midway; waiting the full 6h interval made updates feel unreliable.
 */
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000] as const
/** After sleep/hibernate, re-check if the last check is older than this. */
const RESUME_RECHECK_AFTER_MS = 60 * 60_000
const RESUME_CHECK_DELAY_MS = 20_000

let initialized = false
let checkingPromise: Promise<void> | null = null
let downloadPromise: Promise<void> | null = null
let installPromise: Promise<boolean> | null = null
let initialCheckTimer: ReturnType<typeof setTimeout> | null = null
let scheduledCheckTimer: ReturnType<typeof setInterval> | null = null
let downloadedInstallerPath: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let consecutiveFailures = 0
let notifiedDownloadedVersion: string | null = null

let updateStatus: AppUpdateStatus = {
  phase: app.isPackaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  message: app.isPackaged ? '尚未检查更新。' : '开发模式不连接更新服务。',
  canCheck: app.isPackaged,
  canInstall: false,
}

function publishStatus(patch: Partial<AppUpdateStatus>): void {
  updateStatus = { ...updateStatus, ...patch, currentVersion: app.getVersion() }
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(IPC.APP_UPDATE_STATE_CHANGED, updateStatus)
  }
  syncTrayUpdateEntry()
}

/**
 * The app normally lives in the tray with the main window closed, so the
 * sidebar button alone was easy to miss. Mirror actionable states in the
 * tray menu.
 */
function syncTrayUpdateEntry(): void {
  const version = updateStatus.availableVersion ? ` v${updateStatus.availableVersion}` : ''
  if (updateStatus.phase === 'downloaded') {
    setTrayUpdateEntry({ label: `重启并更新到${version}`, enabled: true, onClick: () => { installDownloadedUpdate() } })
  } else if (updateStatus.phase === 'downloading') {
    setTrayUpdateEntry({ label: `正在下载更新${version}（${Math.round(updateStatus.progressPercent ?? 0)}%）`, enabled: false })
  } else if (updateStatus.phase === 'installing') {
    setTrayUpdateEntry({ label: '正在安装更新…', enabled: false })
  } else if (updateStatus.phase === 'error' && updateStatus.availableVersion) {
    setTrayUpdateEntry({ label: `重试下载更新${version}`, enabled: true, onClick: () => { void downloadAppUpdate() } })
  } else {
    setTrayUpdateEntry(null)
  }
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

function scheduleRetry(reason: string): void {
  consecutiveFailures += 1
  if (retryTimer) return
  const delay = RETRY_DELAYS_MS[Math.min(consecutiveFailures, RETRY_DELAYS_MS.length) - 1]
  logUpdateDiagnostic('update.retry.scheduled', { reason, attempt: consecutiveFailures, delayMs: delay })
  retryTimer = setTimeout(() => {
    retryTimer = null
    void runUpdateCycle('retry')
  }, delay)
  retryTimer.unref()
}

/** One unattended step: resume a failed download, or look for a new version. */
async function runUpdateCycle(trigger: string): Promise<void> {
  logUpdateDiagnostic('update.cycle', { trigger, phase: updateStatus.phase })
  if (updateStatus.phase === 'error' && updateStatus.availableVersion) {
    await downloadAppUpdate()
    return
  }
  await checkForAppUpdates()
}

function notifyUpdateReady(version: string): void {
  if (notifiedDownloadedVersion === version || !Notification.isSupported()) return
  notifiedDownloadedVersion = version
  try {
    const notification = new Notification({
      title: 'LavaDesk 已准备好更新',
      body: `新版本 v${version} 已下载完成。点击这里重启完成更新，也可以稍后从托盘菜单更新。`,
      silent: true,
    })
    notification.on('click', () => { installDownloadedUpdate() })
    notification.show()
  } catch (error) {
    logUpdateDiagnostic('update.notification.failed', { message: error instanceof Error ? error.message : String(error) })
  }
}

function onUpdateAvailable(info: UpdateInfo): void {
  downloadedInstallerPath = null
  logUpdateDiagnostic('update.available', {
    currentVersion: app.getVersion(),
    availableVersion: info.version,
  })
  publishStatus({
    phase: 'available',
    availableVersion: info.version,
    progressPercent: 0,
    lastCheckedAt: Date.now(),
    message: `发现新版本 ${info.version}，正在后台下载。`,
    canCheck: false,
    canInstall: false,
  })
  // Download in the background right away; installing still waits for the user.
  setImmediate(() => { void downloadAppUpdate() })
}

function onUpdateNotAvailable(info: UpdateInfo): void {
  publishStatus({
    phase: 'not-available',
    availableVersion: info.version,
    progressPercent: undefined,
    lastCheckedAt: Date.now(),
    message: '当前已是最新版本。',
    canCheck: true,
    canInstall: false,
  })
}

function onDownloadProgress(progress: ProgressInfo): void {
  publishStatus({
    phase: 'downloading',
    progressPercent: Math.max(0, Math.min(100, progress.percent)),
    transferredBytes: progress.transferred,
    totalBytes: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
    message: `新版本正在后台下载（${Math.round(progress.percent)}%）。`,
    canCheck: false,
    canInstall: false,
  })
}

function onUpdateDownloaded(info: UpdateInfo): void {
  logUpdateDiagnostic('update.downloaded', {
    availableVersion: info.version,
    installerPath: downloadedInstallerPath,
  })
  publishStatus({
    phase: 'downloaded',
    availableVersion: info.version,
    progressPercent: 100,
    lastCheckedAt: Date.now(),
    message: `版本 ${info.version} 已下载。点击左侧按钮或托盘菜单后会以低占用模式安装并自动重启。`,
    canCheck: true,
    canInstall: true,
  })
  consecutiveFailures = 0
  clearRetry()
  notifyUpdateReady(info.version)
}

export function initializeAutoUpdate(): void {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) {
    publishStatus({
      phase: 'unsupported',
      message: '开发模式不连接更新服务。',
      canCheck: false,
      canInstall: false,
    })
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    publishStatus({
      phase: 'checking',
      availableVersion: undefined,
      progressPercent: undefined,
      message: '正在检查更新…',
      canCheck: false,
      canInstall: updateStatus.phase === 'downloaded',
    })
  })
  autoUpdater.on('update-available', onUpdateAvailable)
  autoUpdater.on('update-not-available', onUpdateNotAvailable)
  autoUpdater.on('download-progress', onDownloadProgress)
  autoUpdater.on('update-downloaded', onUpdateDownloaded)
  autoUpdater.on('error', (error) => {
    const downloadCanRetry = Boolean(updateStatus.availableVersion)
    publishStatus({
      phase: 'error',
      lastCheckedAt: Date.now(),
      message: `${downloadCanRetry ? '更新下载' : '更新检查'}失败：${toSafeUpdateErrorMessage(error)}`,
      canCheck: !downloadCanRetry,
      canInstall: false,
    })
  })

  initialCheckTimer = setTimeout(() => {
    void runUpdateCycle('startup')
  }, INITIAL_CHECK_DELAY_MS)
  initialCheckTimer.unref()

  scheduledCheckTimer = setInterval(() => {
    void runUpdateCycle('interval')
  }, CHECK_INTERVAL_MS)
  scheduledCheckTimer.unref()

  // Laptops mostly sleep instead of restarting; the interval alone could skip
  // days of releases. Give the network a moment to come back first.
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      const lastCheckedAt = updateStatus.lastCheckedAt ?? 0
      if (Date.now() - lastCheckedAt >= RESUME_RECHECK_AFTER_MS) void runUpdateCycle('resume')
    }, RESUME_CHECK_DELAY_MS).unref()
  })

  app.once('will-quit', () => {
    if (initialCheckTimer) clearTimeout(initialCheckTimer)
    if (scheduledCheckTimer) clearInterval(scheduledCheckTimer)
    clearRetry()
  })
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return { ...updateStatus }
}

export async function checkForAppUpdates(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) return getAppUpdateStatus()
  if (checkingPromise) {
    await checkingPromise
    return getAppUpdateStatus()
  }
  if (
    updateStatus.phase === 'available' ||
    updateStatus.phase === 'downloading' ||
    updateStatus.phase === 'downloaded' ||
    (updateStatus.phase === 'error' && Boolean(updateStatus.availableVersion))
  ) {
    return getAppUpdateStatus()
  }

  checkingPromise = autoUpdater.checkForUpdates()
    .then(() => undefined)
    .catch((error: unknown) => {
      publishStatus({
        phase: 'error',
        availableVersion: undefined,
        lastCheckedAt: Date.now(),
        message: `更新检查失败：${toSafeUpdateErrorMessage(error)}`,
        canCheck: true,
        canInstall: false,
      })
    })
    .finally(() => {
      checkingPromise = null
      if (updateStatus.phase === 'error' && !updateStatus.availableVersion) {
        scheduleRetry('check-failed')
      } else if (updateStatus.phase !== 'error') {
        consecutiveFailures = 0
        clearRetry()
      }
    })
  await checkingPromise
  return getAppUpdateStatus()
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged || updateStatus.phase === 'downloaded') return getAppUpdateStatus()
  const canDownload = updateStatus.phase === 'available' || (
    updateStatus.phase === 'error' && Boolean(updateStatus.availableVersion)
  )
  if (!canDownload && !downloadPromise) return getAppUpdateStatus()
  if (!downloadPromise) {
    downloadedInstallerPath = null
    publishStatus({
      phase: 'downloading',
      progressPercent: 0,
      message: '正在准备下载新版本…',
      canCheck: false,
      canInstall: false,
    })
    downloadPromise = autoUpdater.downloadUpdate()
      .then((downloadedFiles) => {
        downloadedInstallerPath = downloadedFiles.find((filePath) => (
          isAbsolute(filePath) && extname(filePath).toLowerCase() === '.exe'
        )) ?? null
        logUpdateDiagnostic('update.download.complete', {
          installerPath: downloadedInstallerPath,
          installerSizeBytes: getFileSize(downloadedInstallerPath),
        })
      })
      .catch((error: unknown) => {
        publishStatus({
          phase: 'error',
          message: `更新下载失败：${toSafeUpdateErrorMessage(error)}`,
          canCheck: false,
          canInstall: false,
        })
      })
      .finally(() => {
        downloadPromise = null
        if (updateStatus.phase === 'error' && updateStatus.availableVersion) scheduleRetry('download-failed')
      })
  }
  await downloadPromise
  return getAppUpdateStatus()
}

export function installDownloadedUpdate(): boolean {
  if (!app.isPackaged) return false
  if (updateStatus.phase === 'installing' || installPromise) return true
  if (updateStatus.phase !== 'downloaded') return false

  publishStatus({
    phase: 'installing',
    message: '正在准备重启安装，安装过程会保持低系统占用。',
    canCheck: false,
    canInstall: false,
  })

  installPromise = launchDownloadedInstaller()
    .catch((error: unknown) => {
      logUpdateDiagnostic('update.install.failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      publishStatus({
        phase: 'downloaded',
        message: `启动更新安装失败：${toSafeUpdateErrorMessage(error)}`,
        canCheck: false,
        canInstall: true,
      })
      return false
    })
    .finally(() => {
      installPromise = null
    })
  return true
}

async function launchDownloadedInstaller(): Promise<boolean> {
  if (downloadPromise) await downloadPromise
  const installerPath = downloadedInstallerPath
  if (!installerPath) {
    logUpdateDiagnostic('update.install.fallback', { reason: 'downloaded installer path unavailable' })
    autoUpdater.quitAndInstall(true, true)
    return true
  }

  const installerSizeBytes = getFileSize(installerPath)
  logUpdateDiagnostic('update.install.requested', {
    installerPath,
    installerSizeBytes,
    args: INSTALLER_ARGS,
  })

  const installerPid = await spawnLowPriorityInstaller(installerPath)
  logUpdateDiagnostic('update.install.started', {
    installerPath,
    installerPid,
    installerSizeBytes,
    priority: 'below-normal',
  })

  const quitTimer = setTimeout(() => app.quit(), INSTALLER_QUIT_DELAY_MS)
  quitTimer.unref()
  return true
}

function spawnLowPriorityInstaller(installerPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(installerPath, [...INSTALLER_ARGS], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      const pid = child.pid
      if (!pid) {
        reject(new Error('更新安装器未返回进程标识。'))
        return
      }
      try {
        setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch (error) {
        logUpdateDiagnostic('update.install.priority.failed', {
          installerPid: pid,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      child.unref()
      resolve(pid)
    })
  })
}

function getFileSize(filePath: string | null): number | null {
  if (!filePath) return null
  try {
    return statSync(filePath).size
  } catch {
    return null
  }
}
