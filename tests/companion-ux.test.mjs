import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTsLoader, plain, projectRoot } from './helpers/load-ts.mjs'

const { Buffer } = globalThis
const load = createTsLoader()
const read = (path) => readFile(join(projectRoot, path), 'utf8')

test('receipt status tells active, undone, never-undoable and expired entries apart', async () => {
  const { ActionJournal } = createTsLoader({
    mocks: {
      './desktopState': { applyDesktopUndo: async () => ({ ok: true }) },
      './reminderService': { ReminderService: { cancel: () => true } },
    },
  })('src/main/memory/desktop/actionJournal.ts')
  const active = ActionJournal.record({ conversationId: 'c', turnId: 't', toolName: 'add_widget', summary: 'a', undo: { kind: 'desktop' } })
  const undone = ActionJournal.record({ conversationId: 'c', turnId: 't', toolName: 'add_widget', summary: 'b', undo: { kind: 'desktop' } })
  const final = ActionJournal.record({ conversationId: 'c', turnId: 't', toolName: 'app_control', summary: 'c', undo: null })
  await ActionJournal.undo(undone.id)
  assert.deepEqual(plain(ActionJournal.status([active.id, undone.id, final.id, 'gone'])), {
    [active.id]: 'active', [undone.id]: 'undone', [final.id]: 'final', gone: 'expired',
  })
})

test('"以后都直接做" grants can be listed and taken back', () => {
  const saved = { agentActionGrants: [] }
  const policy = createTsLoader({
    mocks: {
      '../../store': { store: { get: (key) => saved[key], set: (key, value) => { saved[key] = plain(value) } } },
      './appIndex': { AppIndex: {} },
      './desktopState': { findWidget: () => undefined, isIconWidgetType: () => false, widgetDisplayName: () => '' },
    },
  })('src/main/memory/desktop/actionPolicy.ts')
  policy.addActionGrant('app:微信')
  policy.addActionGrant('system:screenshot')
  assert.deepEqual(plain(policy.listActionGrants()), ['system:screenshot', 'app:微信'])
  assert.deepEqual(plain(policy.revokeActionGrant('app:微信')), ['system:screenshot'])
  assert.equal(policy.hasActionGrant('app:微信'), false)
  policy.addActionGrant('app:记事本')
  assert.deepEqual(plain(policy.revokeActionGrant('*')), [])
  const { describeActionGrant } = load('src/shared/companion-settings.ts')
  assert.equal(describeActionGrant('app:微信'), '打开「微信」')
  assert.equal(describeActionGrant('system:screenshot'), '截屏看屏幕')
})

test('the shortcut recorder turns key presses into accelerators Windows can register', () => {
  const { acceleratorFromKeyEvent: record, shortcutKeyLabels } = load('src/shared/companion-settings.ts')
  const press = (code, mods = {}, key = 'x') => record({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })
  assert.equal(press('Space', { ctrlKey: true, altKey: true }, ' '), 'CommandOrControl+Alt+Space')
  assert.equal(press('KeyK', { ctrlKey: true, shiftKey: true }, 'K'), 'CommandOrControl+Shift+K')
  assert.equal(press('Digit1', { altKey: true }, '¡'), 'Alt+1', 'physical key, not the produced character')
  assert.equal(press('F9', { metaKey: true }, 'F9'), 'Super+F9')
  assert.equal(press('Backquote', { ctrlKey: true }, '`'), 'CommandOrControl+`')
  assert.equal(press('KeyA', { shiftKey: true }, 'A'), null, 'Shift alone would hijack typing')
  assert.equal(press('KeyA'), null)
  assert.equal(press('ControlLeft', { ctrlKey: true }, 'Control'), null, 'waits for the real key')
  assert.equal(press('IntlRo', { ctrlKey: true }, 'ろ'), null, 'unknown keys are not guessed')
  assert.deepEqual(plain(shortcutKeyLabels('CommandOrControl+Alt+Space')), ['Ctrl', 'Alt', '空格'])
  assert.deepEqual(plain(shortcutKeyLabels('Super+Shift+K')), ['Win', 'Shift', 'K'])
})

test('system monitor numbers: CPU from time deltas, load levels and readable sizes', () => {
  const stats = load('src/shared/system-stats.ts')
  const core = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } })
  const first = stats.sumCpuTimes([core(100, 900), core(100, 900)])
  const second = stats.sumCpuTimes([core(400, 1100), core(100, 1300)])
  assert.deepEqual(plain(first), { idle: 1800, total: 2000 })
  assert.equal(stats.cpuPercentBetween(null, first), null, 'first sample has nothing to compare with')
  assert.equal(stats.cpuPercentBetween(first, second), 33.3)
  assert.equal(stats.cpuPercentBetween(second, second), null)
  assert.equal(stats.loadLevel(null), 'calm')
  assert.equal(stats.loadLevel(59), 'calm')
  assert.equal(stats.loadLevel(70), 'busy')
  assert.equal(stats.loadLevel(92), 'high')
  assert.equal(stats.formatGigabytes(12.4 * 1024 ** 3), '12.4 GB')
  assert.equal(stats.formatGigabytes(128 * 1024 ** 3), '128 GB')
  assert.equal(stats.formatUptime(59), '1 分钟')
  assert.equal(stats.formatUptime(3 * 3600 + 5 * 60), '3 小时 5 分')
  assert.equal(stats.formatUptime(2 * 86_400 + 7200), '2 天 2 小时')
})

test('pasted and dropped files are stored as copies, checked by content, and never expose a path', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'chat-drops-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { AttachmentStore } = createTsLoader({
    mocks: {
      '../../runtime/userDataPaths': {
        getChatDropsRoot: () => root,
        sanitizeUserDataSegment: (value, fallback) => value.replace(/[<>:"/\\|?*]/g, '_') || fallback,
      },
    },
  })('src/main/memory/desktop/attachmentStore.ts')
  const png = Uint8Array.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]))
  const result = await AttachmentStore.registerData([
    { name: '截图-101500.png', bytes: png },
    { name: 'notes.txt', bytes: Uint8Array.from(Buffer.from('买牛奶')) },
    { name: 'fake.png', bytes: Uint8Array.from(Buffer.from('<html>')) },
    { name: 'empty.pdf', bytes: new Uint8Array(0) },
    { name: '../../escape.txt', bytes: Uint8Array.from(Buffer.from('x')) },
  ], 'conv-1')
  assert.deepEqual(plain(result.attachments.map((item) => [item.name, item.kind])), [['截图-101500.png', 'image'], ['notes.txt', 'text'], ['escape.txt', 'text']])
  assert.deepEqual(plain(result.rejected), [{ name: 'fake.png', reason: '不是有效的图片' }, { name: 'empty.pdf', reason: '文件是空的' }])
  for (const item of result.attachments) {
    assert.equal(Object.hasOwn(item, 'path'), false, 'renderers never learn where the copy lives')
    const grant = AttachmentStore.get(item.id)
    assert.ok(grant.path.startsWith(root), 'every copy stays in the drops folder')
    assert.equal(grant.conversationId, 'conv-1')
  }
  assert.equal(readFileSync(AttachmentStore.get(result.attachments[1].id).path, 'utf8'), '买牛奶')
  assert.equal(readdirSync(root).length, 3)
})

test('round-2 wiring: content-only drops, role-checked widget IPC, white-noise timer', async () => {
  const [chatIpc, chatPreload, appIpc, canvasPreload, companionIpc, desktopControl, widgetCommand] = await Promise.all([
    read('src/main/ipc/chatIpc.ts'),
    read('src/preload/chat-stream.ts'),
    read('src/main/ipc/appIpc.ts'),
    read('src/preload/canvas.ts'),
    read('src/main/ipc/companionIpc.ts'),
    read('src/main/memory/tools/definitions/desktop-control.ts'),
    read('src/shared/widget-command.ts'),
  ])
  assert.match(chatIpc, /IPC\.CHAT_ATTACH_DATA[\s\S]*attachDataSchema\.parse[\s\S]*AttachmentStore\.registerData/)
  assert.match(chatIpc, /bytes: z\.instanceof\(Uint8Array\)/)
  assert.doesNotMatch(chatPreload, /getPathForFile/, 'chat surfaces never forward file paths')
  assert.match(chatIpc, /IPC\.CHAT_ACTION_STATUS[\s\S]*ActionJournal\.status/)
  assert.match(appIpc, /IPC\.APP_SCREEN_SNIP, async \(event\) => \{\s*assertTrustedIpcSender\(event, \['canvas'\]\)/)
  assert.match(appIpc, /IPC\.SYSTEM_STATS, \(event\) => \{\s*assertTrustedIpcSender\(event, \['canvas', 'main'\]\)/)
  assert.match(canvasPreload, /startScreenSnip[\s\S]*getSystemStats/)
  assert.match(companionIpc, /IPC\.COMPANION_REVOKE_ACTION_GRANT, \(event, key: unknown\) => \{\s*assertTrustedIpcSender\(event, \['main'\]\)/)
  assert.match(desktopControl, /command: 'play', sound, volumeLevel, minutes/)
  assert.match(widgetCommand, /command: 'play'; sound\?: WhiteNoiseSound; volumeLevel\?: number; minutes\?: number/)
})
