import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Moving from LingyueDesk to LavaDesk changed the app name, and with it the
 * userData folder. This copies the old folder into the new one once, before
 * anything opens the new folder. Pure Node so it can be tested without Electron.
 */

/** userData folder names used by LingyueDesk (package name, then product name). */
export const LEGACY_USER_DATA_DIR_NAMES = ['lingyue-desk', 'LingyueDesk'] as const
export const LEGACY_CONFIG_FILE = 'lingyue-config.json'
export const MIGRATION_MARKER_FILE = '.lavadesk-migration.json'

/** Data files whose names carried the old product name. */
export const LEGACY_FILE_RENAMES: Readonly<Record<string, string>> = {
  'lingyue-config.json': 'lavadesk-config.json',
  'lingyue-memory.db': 'lavadesk-memory.db',
  'lingyue-memory.db-wal': 'lavadesk-memory.db-wal',
  'lingyue-memory.db-shm': 'lavadesk-memory.db-shm',
  'lingyue-private.db': 'lavadesk-private.db',
  'lingyue-private.db-wal': 'lavadesk-private.db-wal',
  'lingyue-private.db-shm': 'lavadesk-private.db-shm',
}

/** Chromium caches and process locks are rebuilt on start; copying them only costs time. */
const SKIPPED_TOP_LEVEL = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GrShaderCache', 'ShaderCache', 'Crashpad', 'blob_storage', 'lockfile',
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
])

const JSON_REWRITE_LIMIT_BYTES = 32 * 1024 * 1024

export type MigrationStatus = 'done' | 'fresh' | 'skipped-existing' | 'pending' | 'failed'

export interface MigrationMarker {
  status: MigrationStatus
  at: string
  from?: string
  files?: number
  bytes?: number
  rewrittenFiles?: number
  error?: string
}

export type MigrationPlan =
  | { action: 'none' }
  | { action: 'record'; marker: MigrationMarker }
  | { action: 'migrate'; legacyDir: string }

export function readMigrationMarker(targetDir: string): MigrationMarker | null {
  try {
    const value = JSON.parse(readFileSync(join(targetDir, MIGRATION_MARKER_FILE), 'utf8')) as MigrationMarker
    return value && typeof value.status === 'string' ? value : null
  } catch {
    return null
  }
}

export function writeMigrationMarker(targetDir: string, marker: MigrationMarker): void {
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, MIGRATION_MARKER_FILE), JSON.stringify(marker, null, 2))
}

export function findLegacyUserDataDir(appDataDir: string, targetDir: string): string | null {
  for (const name of LEGACY_USER_DATA_DIR_NAMES) {
    const dir = join(appDataDir, name)
    // On case-insensitive disks the old and new names may be the same folder.
    if (dir.toLowerCase() === targetDir.toLowerCase()) continue
    if (existsSync(join(dir, LEGACY_CONFIG_FILE))) return dir
  }
  return null
}

/** LavaDesk already has its own settings or memory here; never overwrite them silently. */
export function targetHasOwnData(targetDir: string): boolean {
  return existsSync(join(targetDir, 'lavadesk-config.json')) || existsSync(join(targetDir, 'lavadesk-memory.db'))
}

export function planLegacyMigration(params: { appDataDir: string; targetDir: string; now?: Date }): MigrationPlan {
  const at = (params.now ?? new Date()).toISOString()
  const marker = readMigrationMarker(params.targetDir)
  if (marker && marker.status !== 'pending') return { action: 'none' }
  const legacyDir = findLegacyUserDataDir(params.appDataDir, params.targetDir)
  if (!legacyDir) return marker ? { action: 'none' } : { action: 'record', marker: { status: 'fresh', at } }
  // A pending marker means a previous start could not close the old app; the
  // files LavaDesk created meanwhile are defaults and may be replaced.
  if (!marker && targetHasOwnData(params.targetDir)) {
    return { action: 'record', marker: { status: 'skipped-existing', at, from: legacyDir } }
  }
  return { action: 'migrate', legacyDir }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The forms an absolute folder path takes inside JSON text. */
function pathForms(dir: string): { raw: string; json: string; slash: string } {
  return { raw: dir, json: JSON.stringify(dir).slice(1, -1), slash: dir.replace(/\\/g, '/') }
}

/**
 * Point absolute paths into the old folder at the new folder. Desktop shortcuts
 * kept by the icon-storage widgets, for example, are referenced by full path.
 */
export function rewriteLegacyPathsInText(text: string, legacyDir: string, targetDir: string): string {
  const from = pathForms(legacyDir)
  const to = pathForms(targetDir)
  let next = text
  const pairs: Array<[string, string]> = [[from.json, to.json], [from.slash, to.slash]]
  if (from.raw !== from.json) pairs.push([from.raw, to.raw])
  for (const [source, replacement] of pairs) {
    // Only whole folder names: the old path followed by a separator, a quote or the end.
    const pattern = new RegExp(`${escapeRegExp(source)}(?=\\\\|/|"|$)`, 'gi')
    next = next.replace(pattern, () => replacement)
  }
  return next
}

function walkFiles(dir: string, visit: (path: string) => void): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(path, visit)
    else if (entry.isFile()) visit(path)
  }
}

export function rewriteLegacyPathsInDir(dir: string, legacyDir: string, targetDir: string): number {
  let rewritten = 0
  walkFiles(dir, (path) => {
    if (!path.toLowerCase().endsWith('.json')) return
    try {
      if (statSync(path).size > JSON_REWRITE_LIMIT_BYTES) return
      const text = readFileSync(path, 'utf8')
      const next = rewriteLegacyPathsInText(text, legacyDir, targetDir)
      if (next !== text) {
        writeFileSync(path, next)
        rewritten += 1
      }
    } catch {
      // A file that cannot be read keeps its old paths; the old folder is left in place.
    }
  })
  return rewritten
}

/**
 * Copy the old folder into the new one. Everything is staged next to the
 * target first, so a failed copy leaves the target untouched.
 */
export function copyLegacyUserData(legacyDir: string, targetDir: string, now = Date.now()): { files: number; bytes: number; rewrittenFiles: number } {
  const staging = `${targetDir}.migrating-${now}`
  rmSync(staging, { recursive: true, force: true })
  try {
    cpSync(legacyDir, staging, {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) => {
        const top = relative(legacyDir, source).split(sep)[0]
        return !top || !SKIPPED_TOP_LEVEL.has(top)
      },
    })
    for (const [oldName, newName] of Object.entries(LEGACY_FILE_RENAMES)) {
      const oldPath = join(staging, oldName)
      if (existsSync(oldPath)) renameSync(oldPath, join(staging, newName))
    }
    const rewrittenFiles = rewriteLegacyPathsInDir(staging, legacyDir, targetDir)
    let files = 0
    let bytes = 0
    walkFiles(staging, (path) => {
      files += 1
      bytes += statSync(path).size
    })
    mkdirSync(targetDir, { recursive: true })
    for (const name of readdirSync(staging)) {
      const destination = join(targetDir, name)
      rmSync(destination, { recursive: true, force: true })
      renameSync(join(staging, name), destination)
    }
    return { files, bytes, rewrittenFiles }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
