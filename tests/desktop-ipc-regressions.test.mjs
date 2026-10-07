import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { desktopFixture, widget } from './helpers/desktop-fixture.mjs'
import { deferred, tick } from './helpers/load-ts.mjs'

const { structuredClone, setTimeout } = globalThis

async function override(f, id) { return JSON.parse(await fs.readFile(f.paths.getWallpaperWidgetOverridePath(id), 'utf8')) }

test('WIDGET_LIST is read-only for oversized/legacy lists and corrupt data is never replaced with empty stores', async (t) => {
  const items = Array.from({ length: 201 }, (_, i) => widget('w-' + i))
  items[0].config = { text: 'x'.repeat(600 * 1024) }
  const f = await desktopFixture(t, { initial: { widgets: items } })
  assert.equal(f.invoke('WIDGET_LIST').length, 201)
  assert.deepEqual(f.state.widgets, items)
  assert.equal(f.writes.length, 0)
  f.state.widgets.push({ id: 'broken' })
  const before = structuredClone(f.state)
  assert.throws(() => f.invoke('WIDGET_LIST'), /原数据已保留/)
  assert.deepEqual(f.state, before)
  assert.equal(f.writes.length, 0)
})

test('component edits survive immediate A-B-A switch and reloading the same namespace', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [widget('a')]), b = await f.addWallpaper('B', [widget('b')])
  await f.invoke('WALLPAPER_APPLY', a)
  f.invoke('WIDGET_UPDATE_CONFIG', 'a', { message: 'latest A' })
  await f.invoke('WALLPAPER_APPLY', b)
  assert.equal((await override(f, 'A')).widgets[0].config.message, 'latest A')
  f.invoke('WIDGET_UPDATE_CONFIG', 'b', { message: 'latest B' })
  await f.invoke('WALLPAPER_APPLY', a)
  assert.equal(f.state.widgets[0].config.message, 'latest A')
  f.invoke('WIDGET_UPDATE_CONFIG', 'a', { message: 'same namespace reload' })
  await f.widgets.loadWidgetsForWallpaper('A')
  assert.equal(f.state.widgets[0].config.message, 'same namespace reload')
  assert.equal((await override(f, 'B')).widgets[0].config.message, 'latest B')
})

test('failed save blocks wallpaper transition without losing current edits and retry succeeds', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [widget('a')]), b = await f.addWallpaper('B', [widget('b')])
  await f.invoke('WALLPAPER_APPLY', a)
  f.invoke('WIDGET_UPDATE_CONFIG', 'a', { text: 'unsaved' })
  f.controls.failWrite = true
  await assert.rejects(f.invoke('WALLPAPER_APPLY', b), /disk full/)
  assert.equal(f.state.wallpaper.current.id, 'A')
  assert.equal(f.state.widgets[0].config.text, 'unsaved')
  f.controls.failWrite = false
  await f.invoke('WALLPAPER_APPLY', b)
  assert.equal((await override(f, 'A')).widgets[0].config.text, 'unsaved')
})

test('corrupt or unreadable override refuses switch and leaves runtime and original file untouched', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [widget('a')]), b = await f.addWallpaper('B')
  await f.invoke('WALLPAPER_APPLY', a)
  const path = f.paths.getWallpaperWidgetOverridePath('B')
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, '{bad json')
  await assert.rejects(f.invoke('WALLPAPER_APPLY', b))
  assert.equal(f.state.wallpaper.current.id, 'A')
  assert.equal(f.state.widgets[0].id, 'a')
  assert.equal(await fs.readFile(path, 'utf8'), '{bad json')
  await fs.unlink(path)
  await fs.mkdir(path)
  await assert.rejects(f.invoke('WALLPAPER_APPLY', b))
  assert.equal(f.state.wallpaper.current.id, 'A')
})

test('unassigned desktop widgets survive restart and a wallpaper namespace round trip', async (t) => {
  const f = await desktopFixture(t, { initial: { widgets: [widget('unassigned')] } })
  await f.wallpaper.restoreWallpaper()
  await f.widgets.restoreWidgets()
  assert.equal(f.state.widgets[0].id, 'unassigned')
  f.invoke('WIDGET_UPDATE_CONFIG', 'unassigned', { text: 'standalone saved' })
  await f.widgets.loadWidgetsForWallpaper('A')
  await f.widgets.loadWidgetsForWallpaper()
  assert.equal(f.state.widgets[0].config.text, 'standalone saved')
  assert.equal((await override(f, 'workspace:unassigned')).widgets[0].id, 'unassigned')
})

test('quit waits for atomic widget save; failure prevents quit and permits retry', async (t) => {
  const f = await desktopFixture(t)
  await f.widgets.loadWidgetsForWallpaper()
  let prevented = 0
  f.controls.failWrite = true
  f.app.emit('before-quit', { preventDefault: () => prevented++ })
  for (let i = 0; i < 100 && f.dialogs.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
  assert.equal(f.dialogs.length, 1)
  assert.equal(f.app.quitCalls, undefined)
  f.controls.failWrite = false
  f.app.emit('before-quit', { preventDefault: () => prevented++ })
  for (let i = 0; i < 100 && !f.app.quitCalls; i++) await new Promise((r) => setTimeout(r, 5))
  assert.equal(prevented, 2)
  assert.equal(f.app.quitCalls, 1)
  assert.equal((await override(f, 'workspace:unassigned')).widgets.length, 0)
})

test('Dock restore failure keeps managed records and concurrent edits; successful subset is not retried', async (t) => {
  const managed = (id) => ({ id, removedFromDesktop: true, name: id, originalPath: 'original', managedPath: 'managed' })
  const f = await desktopFixture(t, { initial: { widgets: [widget('dock', { type: 'desktop-icons-dock', config: { items: [managed('one'), managed('two')] } }), widget('other')] } })
  const gate = deferred()
  f.controls.restore = () => gate.promise
  const removing = f.invoke('WIDGET_REMOVE', 'dock')
  await tick()
  f.invoke('WIDGET_UPDATE_CONFIG', 'other', { text: 'concurrent change' })
  f.invoke('WIDGET_UPDATE_CONFIG', 'dock', { dockOpacity: 0.55 })
  gate.resolve({ ok: false, restoredItemIds: ['one'], skipped: ['two: locked'] })
  await removing
  assert.equal(f.state.widgets.length, 2)
  assert.equal(f.state.widgets[0].config.dockOpacity, 0.55)
  assert.deepEqual(f.state.widgets[0].config.items.map((i) => i.id), ['two'])
  assert.equal(f.state.widgets[1].config.text, 'concurrent change')
  assert.equal(f.dialogs.length, 1)
  f.controls.restore = async () => ({ ok: true, restoredItemIds: ['two'], skipped: [] })
  await f.invoke('WIDGET_REMOVE', 'dock')
  assert.deepEqual(f.state.widgets.map((w) => w.id), ['other'])
})

test('late update cannot resurrect a removed component', async (t) => {
  const f = await desktopFixture(t)
  f.invoke('WIDGET_UPDATE', widget('removed', { type: 'text' }))
  assert.deepEqual(f.state.widgets, [])
})

test('retired built-in sticky notes leave the desktop but are backed up once first', async (t) => {
  const note = widget('note', { type: 'todo-board', config: { version: 2, bodyHtml: '<p>keep me</p>' } })
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [widget('a'), note])
  await f.invoke('WALLPAPER_APPLY', a)
  assert.deepEqual(f.state.widgets.map((w) => w.id), ['a'])
  assert.deepEqual(f.invoke('WIDGET_LIST').map((w) => w.id), ['a'])
  const dir = join(f.userData, 'legacy-sticky-notes')
  const [file] = await fs.readdir(dir)
  const backup = JSON.parse(await fs.readFile(join(dir, file), 'utf8'))
  assert.equal(backup.namespace, 'A')
  assert.deepEqual(backup.widgets.map((w) => [w.id, w.config.bodyHtml]), [['note', '<p>keep me</p>']])
  assert.throws(() => f.invoke('WIDGET_ADD', widget('new-note', { type: 'todo-board' })), /LavaNotes/)
})

test('display mode and primary topology changes reconcile effective wallpaper and component namespace', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [widget('a')]), b = await f.addWallpaper('B', [widget('b')])
  await f.invoke('WALLPAPER_APPLY', b)
  f.state.wallpaperDisplay.assignments = { 'win32:one': a.id, 'win32:two': b.id }
  await f.invoke('WALLPAPER_DISPLAY_SET_MODE', 'per-display')
  assert.equal(f.state.wallpaper.current.id, 'A')
  assert.equal(f.state.widgets[0].id, 'a')
  f.controls.displays = f.controls.displays.map((d) => ({ ...d, primary: !d.primary }))
  f.screen.emit('display-metrics-changed')
  const timerId = [...f.timers.tasks].find(([, t]) => t.delay === 220)[0]
  f.timers.fire(timerId)
  // Queue a read-after-transition through the same serialized settings writer.
  await f.invoke('WALLPAPER_SAVE_SETTINGS', 'B', { volume: 25 })
  assert.equal(f.state.wallpaper.current.id, 'B')
  assert.equal(f.state.widgets[0].id, 'b')
})

test('assigning secondary first on a fresh install produces a coherent effective wallpaper and layout', async (t) => {
  const f = await desktopFixture(t)
  await f.addWallpaper('B', [widget('b')])
  await f.invoke('WALLPAPER_DISPLAY_SET_ASSIGNMENT', 202, 'B')
  assert.equal(f.state.wallpaper.current.id, 'B')
  assert.equal(f.state.widgets[0].id, 'b')
  assert.ok(f.messages.some((m) => m.id === 202 && m.channel === f.IPC.WALLPAPER_DISPLAY_LAYOUT && m.args[0].displays[0].item.id === 'B'))
})

test('settings stay scoped, zero-volume survives future layouts, and serialized patches merge without stale overwrite', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A'), b = await f.addWallpaper('B')
  await f.invoke('WALLPAPER_APPLY', a)
  await f.invoke('WALLPAPER_DISPLAY_SET_ASSIGNMENT', 202, b.id)
  await Promise.all([
    f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { volume: 0 }),
    f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { speed: 1.7 }),
    f.invoke('WALLPAPER_UPDATE_SETTING', 'B', 'flip', '水平'),
  ])
  assert.equal(f.state.wallpaper.current.settings.volume, 0)
  assert.equal(f.state.wallpaper.current.settings.speed, 1.7)
  for (const mode of ['primary', 'duplicate', 'span', 'per-display']) {
    await f.invoke('WALLPAPER_DISPLAY_SET_MODE', mode)
    const messages = f.messages.filter((m) => m.channel === f.IPC.WALLPAPER_DISPLAY_LAYOUT && m.id === 101)
    assert.equal(messages.at(-1).args[0].displays[0].item.settings.volume, 0)
  }
  const items = await f.invoke('WALLPAPER_LIST')
  assert.equal(items.find((i) => i.id === 'B').settings.volume, 50)
  assert.equal(items.find((i) => i.id === 'B').settings.flip, '水平')
  for (const patch of [{ volume: -1 }, { speed: Infinity }, { flip: 'bad' }, { unknown: 1 }]) {
    await assert.rejects(f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', patch))
  }
})

test('duplicate/span video layouts share clock and only primary window owns audio', async (t) => {
  const f = await desktopFixture(t)
  const a = await f.addWallpaper('A', [], 'video')
  await f.invoke('WALLPAPER_APPLY', a)
  for (const mode of ['duplicate', 'span']) {
    f.messages.length = 0
    await f.invoke('WALLPAPER_DISPLAY_SET_MODE', mode)
    const layouts = f.messages.filter((m) => m.channel === f.IPC.WALLPAPER_DISPLAY_LAYOUT)
    assert.equal(layouts.length, 2)
    assert.equal(layouts[0].args[0].playback.epochMs, layouts[1].args[0].playback.epochMs)
    assert.equal(layouts[0].args[0].playback.audioEnabled, true)
    assert.equal(layouts[1].args[0].playback.audioEnabled, false)
    assert.ok(f.messages.some((m) => m.id === 202 && m.muted === true))
  }
})

test('atomic save failure preserves original override and cleans temporary files', async (t) => {
  const f = await desktopFixture(t)
  const path = f.paths.getWallpaperWidgetOverridePath('A')
  const { writeJsonAtomic } = f.load('src/main/runtime/atomicJson.ts')
  await writeJsonAtomic(path, { before: true })
  f.controls.failWrite = true
  await assert.rejects(writeJsonAtomic(path, { before: false }), /disk full/)
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { before: true })
  assert.deepEqual(await fs.readdir(dirname(path)), ['widget-config.json'])
})

test('IPC rejects count growth, duplicate IDs and merged-config growth but permits moving legacy data', async (t) => {
  const items = Array.from({ length: 200 }, (_, i) => widget('w-' + i, { type: 'generated-widget' }))
  const f = await desktopFixture(t, { initial: { widgets: items } })
  assert.throws(() => f.invoke('WIDGET_ADD', widget('extra', { type: 'generated-widget' })), /200/)
  assert.throws(() => f.invoke('WIDGET_ADD', items[0]), /200|ID/)
  f.state.widgets = [widget('large', { config: { before: 'x'.repeat(350 * 1024) } })]
  assert.throws(() => f.invoke('WIDGET_UPDATE_CONFIG', 'large', { after: 'y'.repeat(350 * 1024) }), /512KB/)
  assert.equal(f.state.widgets[0].config.after, undefined)
  f.state.widgets[0].config = { legacy: 'x'.repeat(600 * 1024) }
  f.invoke('WIDGET_UPDATE', { ...f.state.widgets[0], x: 90 })
  assert.equal(f.state.widgets[0].x, 90)
  assert.equal(f.state.widgets[0].config.legacy.length, 600 * 1024)
})

test('desktop import checks storage limits before moving the original file', async (t) => {
  const f = await desktopFixture(t, { realIcons: true, initial: {
    widgets: [widget('dock', { type: 'desktop-icons-dock', config: { legacy: 'x'.repeat(600 * 1024), items: [] } })],
  } })
  const source = join(f.root, 'Desktop', 'important.txt')
  await fs.writeFile(source, 'synthetic personal file')
  const result = await f.invoke('DESKTOP_ICON_IMPORT', 'dock', [source])
  assert.equal(result.ok, false)
  assert.match(result.skipped[0], /512KB/)
  assert.equal(await fs.readFile(source, 'utf8'), 'synthetic personal file')
  assert.equal(f.state.widgets[0].config.items.length, 0)
})

test('desktop import persists recovery record before moving and removal restores the synthetic file', async (t) => {
  const f = await desktopFixture(t, { realIcons: true, initial: {
    widgets: [widget('dock', { type: 'desktop-icons-dock', config: { items: [] } })],
  } })
  const source = join(f.root, 'Desktop', 'important.txt')
  await fs.writeFile(source, 'synthetic personal file')
  const result = await f.invoke('DESKTOP_ICON_IMPORT', 'dock', [source])
  assert.equal(result.ok, true)
  assert.equal(result.items.length, 1)
  const stored = f.state.widgets[0].config.items[0]
  assert.equal(stored.removedFromDesktop, true)
  assert.equal(await fs.readFile(stored.managedPath, 'utf8'), 'synthetic personal file')
  await assert.rejects(fs.access(source))
  assert.equal(f.state.globalIconWidgets[0].config.items.length, 1)
  await f.invoke('WIDGET_REMOVE', 'dock')
  assert.equal(await fs.readFile(source, 'utf8'), 'synthetic personal file')
  assert.equal(f.state.widgets.length, 0)
})

test('simultaneous import and removal cannot orphan files or overwrite component records', async (t) => {
  const f = await desktopFixture(t, { realIcons: true, initial: {
    widgets: [widget('dock', { type: 'desktop-icons-dock', config: { items: [] } })],
  } })
  const source = join(f.root, 'Desktop', 'important.txt')
  await fs.writeFile(source, 'synthetic personal file')
  const importing = f.invoke('DESKTOP_ICON_IMPORT', 'dock', [source])
  const removing = f.invoke('WIDGET_REMOVE', 'dock')
  const [imported] = await Promise.all([importing, removing])
  assert.equal(imported.ok, true)
  assert.equal(await fs.readFile(source, 'utf8'), 'synthetic personal file')
  assert.deepEqual(f.state.widgets, [])
})

test('loading a wallpaper cannot overwrite a corrupt runtime/global store or partially seed global icons', async (t) => {
  const f = await desktopFixture(t, { initial: { widgets: [{ id: 'broken' }], globalIconWidgets: undefined } })
  await f.addWallpaper('A')
  const before = structuredClone(f.state)
  await assert.rejects(f.widgets.loadWidgetsForWallpaper('A'), /原数据已保留/)
  assert.deepEqual(f.state, before)
  assert.equal(f.writes.length, 0)
  f.state.widgets = []
  f.state.globalIconWidgets = [{ id: 'broken-global' }]
  await assert.rejects(f.widgets.loadWidgetsForWallpaper('A'), /原数据已保留/)
  assert.equal(f.writes.length, 0)
})

test('rapid settings patches coalesce into one pending write per wallpaper and recover after failure', async (t) => {
  const f = await desktopFixture(t)
  await f.invoke('WALLPAPER_APPLY', await f.addWallpaper('A'))
  f.messages.length = 0
  await Promise.all([
    ...Array.from({ length: 100 }, (_, volume) => f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { volume })),
    f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { speed: 1.2 }),
  ])
  assert.equal(f.state.wallpaper.current.settings.volume, 99)
  assert.equal(f.state.wallpaper.current.settings.speed, 1.2)
  assert.equal(f.messages.filter((m) => m.channel === f.IPC.WALLPAPER_DISPLAY_LAYOUT_CHANGED).length, 1)
  f.controls.failWrite = true
  await assert.rejects(f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { volume: 0 }), /disk full/)
  assert.equal(f.state.wallpaper.current.settings.volume, 99)
  f.controls.failWrite = false
  await f.invoke('WALLPAPER_SAVE_SETTINGS', 'A', { volume: 0 })
  assert.equal(f.state.wallpaper.current.settings.volume, 0)
})
