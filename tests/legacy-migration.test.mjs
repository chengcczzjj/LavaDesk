import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MIGRATION_MARKER_FILE,
  copyLegacyUserData,
  planLegacyMigration,
  readMigrationMarker,
  rewriteLegacyPathsInText,
  writeMigrationMarker,
} from '../src/main/runtime/legacyUserDataCore.ts'

async function appData(t) {
  const root = await mkdtemp(join(tmpdir(), 'lavadesk-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, legacy: join(root, 'lingyue-desk'), target: join(root, 'LavaDesk') }
}

async function seedLegacy(legacy) {
  await mkdir(join(legacy, 'desktop-icons', 'dock-1'), { recursive: true })
  await mkdir(join(legacy, 'wallpaper-overrides', 'a'), { recursive: true })
  await mkdir(join(legacy, 'Cache', 'Cache_Data'), { recursive: true })
  await mkdir(join(legacy, 'Local Storage', 'leveldb'), { recursive: true })
  const managedPath = join(legacy, 'desktop-icons', 'dock-1', 'Game.lnk')
  await writeFile(managedPath, 'shortcut')
  await writeFile(join(legacy, 'lingyue-config.json'), JSON.stringify({
    widgets: [{ id: 'dock-1', config: { items: [{ managedPath, originalPath: 'C:/Users/me/Desktop/Game.lnk' }] } }],
  }))
  await writeFile(join(legacy, 'lingyue-memory.db'), 'sqlite')
  await writeFile(join(legacy, 'lingyue-memory.db-wal'), 'wal')
  await writeFile(join(legacy, 'wallpaper-overrides', 'a', 'widget-config.json'), JSON.stringify({ widgets: [] }))
  await writeFile(join(legacy, 'Cache', 'Cache_Data', 'big'), 'x'.repeat(1000))
  await writeFile(join(legacy, 'Local Storage', 'leveldb', '000003.log'), 'nav state')
  await writeFile(join(legacy, 'lockfile'), '')
  return managedPath
}

test('a fresh install records that there was nothing to migrate', async (t) => {
  const { root, target } = await appData(t)
  const plan = planLegacyMigration({ appDataDir: root, targetDir: target })
  assert.equal(plan.action, 'record')
  assert.equal(plan.marker.status, 'fresh')
  writeMigrationMarker(target, plan.marker)
  assert.equal(planLegacyMigration({ appDataDir: root, targetDir: target }).action, 'none')
})

test('old data is copied once, renamed for LavaDesk, with caches skipped and paths rewritten', async (t) => {
  const { root, legacy, target } = await appData(t)
  const managedPath = await seedLegacy(legacy)
  const plan = planLegacyMigration({ appDataDir: root, targetDir: target })
  assert.deepEqual(plan, { action: 'migrate', legacyDir: legacy })

  const stats = copyLegacyUserData(plan.legacyDir, target)
  assert.ok(stats.files >= 5)
  assert.equal(stats.rewrittenFiles, 1)
  assert.equal(existsSync(join(target, 'lingyue-config.json')), false)
  assert.equal(await readFile(join(target, 'lavadesk-memory.db'), 'utf8'), 'sqlite')
  assert.equal(await readFile(join(target, 'lavadesk-memory.db-wal'), 'utf8'), 'wal')
  assert.equal(await readFile(join(target, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'nav state')
  assert.equal(existsSync(join(target, 'Cache')), false)
  assert.equal(existsSync(join(target, 'lockfile')), false)

  const config = JSON.parse(await readFile(join(target, 'lavadesk-config.json'), 'utf8'))
  const item = config.widgets[0].config.items[0]
  assert.equal(item.managedPath, join(target, 'desktop-icons', 'dock-1', 'Game.lnk'))
  assert.equal(await readFile(item.managedPath, 'utf8'), 'shortcut')
  assert.equal(item.originalPath, 'C:/Users/me/Desktop/Game.lnk')

  // The old folder is a backup: nothing in it changes.
  assert.equal(await readFile(managedPath, 'utf8'), 'shortcut')
  assert.ok(existsSync(join(legacy, 'lingyue-config.json')))
  assert.equal((await readdir(root)).some((name) => name.includes('.migrating-')), false)
})

test('existing LavaDesk data is never overwritten unless a migration was left pending', async (t) => {
  const { root, legacy, target } = await appData(t)
  await seedLegacy(legacy)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'lavadesk-config.json'), '{"mine":true}')
  const skipped = planLegacyMigration({ appDataDir: root, targetDir: target })
  assert.equal(skipped.action, 'record')
  assert.equal(skipped.marker.status, 'skipped-existing')

  // A start that could not close the old app left defaults behind and a pending marker.
  await rm(join(target, MIGRATION_MARKER_FILE), { force: true })
  writeMigrationMarker(target, { status: 'pending', at: new Date().toISOString(), from: legacy })
  const retry = planLegacyMigration({ appDataDir: root, targetDir: target })
  assert.equal(retry.action, 'migrate')
  copyLegacyUserData(retry.legacyDir, target)
  const config = JSON.parse(await readFile(join(target, 'lavadesk-config.json'), 'utf8'))
  assert.equal(config.mine, undefined)
  assert.equal(readMigrationMarker(target).status, 'pending', 'the caller records done after copying')
})

test('Windows paths are rewritten in their JSON-escaped and slash forms only for the whole folder', () => {
  const legacy = 'C:\\Users\\me\\AppData\\Roaming\\lingyue-desk'
  const target = 'C:\\Users\\me\\AppData\\Roaming\\LavaDesk'
  const text = JSON.stringify({
    a: `${legacy}\\desktop-icons\\x.lnk`,
    b: 'c:/users/me/appdata/roaming/LINGYUE-DESK/wallpapers/w.mp4',
    c: `${legacy}-backup\\keep.json`,
    d: legacy,
  })
  const rewritten = JSON.parse(rewriteLegacyPathsInText(text, legacy, target))
  assert.equal(rewritten.a, `${target}\\desktop-icons\\x.lnk`)
  assert.equal(rewritten.b, 'C:/Users/me/AppData/Roaming/LavaDesk/wallpapers/w.mp4')
  assert.equal(rewritten.c, `${legacy}-backup\\keep.json`)
  assert.equal(rewritten.d, target)
})
