import { app } from 'electron'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { searchApps, type AppIndexEntry } from '@shared/system-control'
import type { DesktopIconItem, DesktopIconLaunchResult } from '@shared/types'
import { listWidgetsForTool } from '../../ipc/widgetIpc'
import { launchDesktopIcon } from '../../ipc/desktopIconIpc'

const LAUNCHABLE_EXTENSIONS = new Set(['.lnk', '.url', '.appref-ms', '.exe'])
const INDEX_TTL_MS = 5 * 60_000
const MAX_DEPTH = 4
const MAX_ENTRIES = 3000

interface IndexedApp extends AppIndexEntry {
  /** Dock / icon-box items launch through their widget so hydration and focus reuse stay identical. */
  widgetId?: string
  item?: DesktopIconItem
}

let cache: { builtAt: number; entries: IndexedApp[] } | null = null
let building: Promise<IndexedApp[]> | null = null

function hashId(value: string): string {
  return createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 10)
}

async function walk(dir: string, source: AppIndexEntry['source'], depth: number, out: IndexedApp[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
  let names: import('fs').Dirent[]
  try {
    names = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of names) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath, source, depth + 1, out)
    } else if (LAUNCHABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push({ id: hashId(fullPath), name: basename(entry.name, extname(entry.name)), path: fullPath, source })
    }
  }
}

function systemApps(): IndexedApp[] {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const system32 = join(root, 'System32')
  return [
    { name: '记事本', path: join(system32, 'notepad.exe') },
    { name: '计算器', path: join(system32, 'calc.exe') },
    { name: '画图', path: join(system32, 'mspaint.exe') },
    { name: '任务管理器', path: join(system32, 'Taskmgr.exe') },
    { name: '文件资源管理器', path: join(root, 'explorer.exe') },
    { name: '截图工具', path: join(system32, 'SnippingTool.exe') },
    { name: '控制面板', path: join(system32, 'control.exe') },
  ].map((item) => ({ ...item, id: hashId(item.path), source: 'system' as const }))
}

function dockApps(): IndexedApp[] {
  const result: IndexedApp[] = []
  for (const widget of listWidgetsForTool()) {
    const items = Array.isArray(widget.config?.items) ? widget.config.items as DesktopIconItem[] : []
    for (const item of items) {
      if (!item || typeof item.name !== 'string' || item.isDirectory) continue
      result.push({
        id: `dock-${hashId(`${widget.id}:${item.id}`)}`,
        name: item.name.replace(/\.(lnk|url|exe)$/i, ''),
        path: item.managedPath || item.originalPath,
        source: 'dock',
        widgetId: widget.id,
        item,
      })
    }
  }
  return result
}

async function buildIndex(): Promise<IndexedApp[]> {
  const entries: IndexedApp[] = []
  if (process.platform === 'win32') {
    const startMenus = [
      process.env.ProgramData && join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      process.env.APPDATA && join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter((dir): dir is string => Boolean(dir))
    for (const dir of startMenus) await walk(dir, 'start-menu', 0, entries)
    const desktops = [app.getPath('desktop'), process.env.PUBLIC && join(process.env.PUBLIC, 'Desktop')]
      .filter((dir): dir is string => Boolean(dir))
    for (const dir of desktops) await walk(dir, 'desktop', MAX_DEPTH, entries)
    entries.push(...systemApps())
  }
  return entries
}

async function getIndex(): Promise<IndexedApp[]> {
  if (cache && Date.now() - cache.builtAt < INDEX_TTL_MS) return [...dockApps(), ...cache.entries]
  if (!building) {
    building = buildIndex()
      .then((entries) => {
        cache = { builtAt: Date.now(), entries }
        return entries
      })
      .finally(() => {
        building = null
      })
  }
  return [...dockApps(), ...(await building)]
}

export const AppIndex = {
  supported(): boolean {
    return process.platform === 'win32'
  },

  async search(query: string, limit = 5): Promise<IndexedApp[]> {
    return searchApps(query, await getIndex(), limit)
  },

  async resolve(params: { appId?: string; query?: string }): Promise<IndexedApp | undefined> {
    const index = await getIndex()
    if (params.appId) {
      const byId = index.find((entry) => entry.id === params.appId)
      if (byId) return byId
    }
    return params.query ? searchApps(params.query, index, 1)[0] : undefined
  },

  /** Bring an already running copy to the front, otherwise launch it the way the Dock does. */
  async launch(entry: IndexedApp): Promise<DesktopIconLaunchResult> {
    if (entry.item && entry.widgetId) {
      return launchDesktopIcon(entry.item, { widgetId: entry.widgetId })
    }
    return launchDesktopIcon({
      id: entry.id,
      name: entry.name,
      originalPath: entry.path,
      managedPath: entry.path,
      removedFromDesktop: false,
      addedAt: Date.now(),
      ...(extname(entry.path).toLowerCase() === '.exe' ? { targetPath: entry.path } : {}),
    })
  },

  invalidate(): void {
    cache = null
  },
}

export type { IndexedApp }
