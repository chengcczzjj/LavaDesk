import { app, shell } from 'electron'
import { promises as fs } from 'fs'
import type { LavaNotesCommand, LavaNotesStatus } from '@shared/types'

/** Sticky notes live in the separate LavaNotes app, reached through its lavanotes:// protocol. */
export const LAVANOTES_DOWNLOAD_URL = 'https://github.com/chengcczzjj/LavaNotes/releases/latest'
const PROTOCOL = 'lavanotes'
const TEXT_LIMIT = 2000

/** Installed means Windows maps lavanotes:// to an executable that still exists. */
export async function getLavaNotesStatus(): Promise<LavaNotesStatus> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return { installed: false, downloadUrl: LAVANOTES_DOWNLOAD_URL }
  }
  try {
    const info = await app.getApplicationInfoForProtocol(`${PROTOCOL}://open`)
    const exists = info.path ? await fs.access(info.path).then(() => true, () => false) : false
    return exists
      ? { installed: true, name: info.name, downloadUrl: LAVANOTES_DOWNLOAD_URL }
      : { installed: false, downloadUrl: LAVANOTES_DOWNLOAD_URL }
  } catch {
    return { installed: false, downloadUrl: LAVANOTES_DOWNLOAD_URL }
  }
}

export function buildLavaNotesUrl(command: LavaNotesCommand, text?: string): string {
  const url = new URL(`${PROTOCOL}://${command}`)
  const content = typeof text === 'string' ? text.trim().slice(0, TEXT_LIMIT) : ''
  if (command === 'new' && content) url.searchParams.set('text', content)
  return url.toString()
}

/** Open LavaNotes when it is installed. Returns the status so callers can offer the download instead. */
export async function openLavaNotes(command: LavaNotesCommand, text?: string): Promise<LavaNotesStatus & { opened: boolean }> {
  const status = await getLavaNotesStatus()
  if (!status.installed) return { ...status, opened: false }
  try {
    await shell.openExternal(buildLavaNotesUrl(command, text))
    return { ...status, opened: true }
  } catch {
    return { ...status, opened: false }
  }
}

export async function openLavaNotesDownload(): Promise<void> {
  await shell.openExternal(LAVANOTES_DOWNLOAD_URL)
}
