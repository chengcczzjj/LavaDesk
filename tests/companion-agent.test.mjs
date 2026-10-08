import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

import { createTsLoader, plain } from './helpers/load-ts.mjs'
import { TOOL_MANIFEST, getToolManifest } from '../src/shared/tool-manifest.ts'
import { isDeclinedToolOutput, isFailedToolOutput, readActionReceipt } from '../src/shared/tool-result.ts'
import {
  describeWidgetDiff,
  diffWidgets,
  isEmptyDesktopChange,
  revertWidgetDiff,
} from '../src/shared/agent-actions.ts'
import { describeAreaPosition, formatDesktopSnapshot } from '../src/shared/desktop-snapshot.ts'
import { searchApps, volumeKeyPresses, SETTINGS_PAGES, KNOWN_FOLDER_IDS } from '../src/shared/system-control.ts'
import {
  computeNextOccurrence,
  decideReminderFire,
  isInQuietHours,
  resolveFirstReminderTime,
} from '../src/shared/reminders.ts'
import { looksLikeMarkdown, parseMarkdown, parseMarkdownInline } from '../src/shared/markdown.ts'
import { PET_EXPRESSION_STATES, WHITE_NOISE_SOUNDS, petStateForTool } from '../src/shared/widget-command.ts'
import { detectVisionModelForTest } from './helpers/vision-detect.mjs'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const load = createTsLoader()
const w = (id, extra = {}) => ({ id, type: 'clock', x: 10, y: 10, width: 200, height: 100, enabled: true, stackOrder: 1, ...extra })

test('tool results: ok/success failures, approvals and declined confirmations', () => {
  assert.equal(isFailedToolOutput({ ok: false }), true)
  assert.equal(isFailedToolOutput({ success: false, error: 'x' }), true, 'legacy success=false tools count as failures')
  assert.equal(isFailedToolOutput({ ok: true }), false)
  assert.equal(isFailedToolOutput(undefined, new Error('boom')), true)
  assert.equal(isFailedToolOutput({ ok: false, approvalRequired: true }), false)
  assert.equal(isFailedToolOutput({ ok: false, declined: true }), false, 'a user saying no is not a tool failure')
  assert.equal(isDeclinedToolOutput({ ok: false, declined: true }), true)
  assert.deepEqual(readActionReceipt({ ok: true, receipt: { id: 'a1', summary: '新增天气', undoable: true } }), { id: 'a1', summary: '新增天气', undoable: true })
  assert.equal(readActionReceipt({ ok: true }), null)
})

test('widget diffs revert only what one action touched', () => {
  const before = [w('a'), w('b', { type: 'weather' }), w('c', { type: 'news' })]
  const after = [w('a', { x: 500 }), w('c', { type: 'news' }), w('d', { type: 'calendar' })]
  const diff = diffWidgets(before, after)
  assert.deepEqual(diff.added.map((item) => item.id), ['d'])
  assert.deepEqual(diff.removed.map((item) => item.id), ['b'])
  assert.deepEqual(diff.changed.map((item) => item.after.id), ['a'])

  // The user later moved "c" and added "e": undo must keep both.
  const current = [w('a', { x: 500 }), w('c', { type: 'news', x: 777 }), w('d', { type: 'calendar' }), w('e', { type: 'text' })]
  const reverted = revertWidgetDiff(current, diff)
  const byId = Object.fromEntries(reverted.map((item) => [item.id, item]))
  assert.equal(byId.a.x, 10)
  assert.equal(byId.c.x, 777)
  assert.ok(byId.b, 'removed widget comes back')
  assert.equal(byId.d, undefined, 'added widget goes away')
  assert.ok(byId.e)

  const names = { clock: '时钟', weather: '天气', news: '新闻', calendar: '日历' }
  assert.equal(describeWidgetDiff(diff, (item) => names[item.type]), '新增日历，调整时钟，移除天气')
  const hidden = diffWidgets([w('a')], [w('a', { enabled: false })])
  assert.equal(describeWidgetDiff(hidden, () => '时钟'), '隐藏时钟')
})

test('legacy stack-order bookkeeping is not reported as a change', () => {
  const legacy = { ...w('a'), stackOrder: undefined }
  delete legacy.stackOrder
  assert.equal(diffWidgets([legacy], [w('a', { stackOrder: 0 })]).changed.length, 0)
  assert.equal(diffWidgets([w('a', { stackOrder: 1 })], [w('a', { stackOrder: 5 })]).changed.length, 1, 'bring-to-front stays undoable')
  const capture = (widgets, id = 'wp1') => ({ wallpaperId: id, displayMode: 'primary', assignments: {}, widgets })
  assert.equal(isEmptyDesktopChange(capture([w('a')]), capture([w('a')])), true)
  assert.equal(isEmptyDesktopChange(capture([w('a')]), capture([w('a')], 'wp2')), false)
})

test('desktop snapshot gives the model ids, positions and state', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  assert.equal(describeAreaPosition({ x: 1600, y: 30, width: 280, height: 120 }, area), '右上')
  assert.equal(describeAreaPosition({ x: 20, y: 900, width: 200, height: 100 }, area), '左下')
  assert.equal(describeAreaPosition({ x: 860, y: 470, width: 200, height: 100 }, area), '中间')
  const text = formatDesktopSnapshot({
    displayCount: 2,
    primarySize: { width: 2560, height: 1440 },
    displayMode: 'duplicate',
    wallpaper: { name: '星空', type: 'video', volume: 30, speed: 1 },
    widgets: [
      { id: 'weather-1', type: 'weather', displayName: '天气', visible: true, position: '右上' },
      { id: 'clock-1', type: 'clock', displayName: '时钟', visible: false, position: '左上' },
    ],
    pet: { onDesktop: false },
    reminders: { pending: 1, next: { text: '喝水', at: new Date(2026, 8, 26, 15, 30).getTime() } },
    customModes: ['工作'],
  })
  assert.match(text, /显示器：2 块，主屏 2560×1440；壁纸模式：每屏相同/)
  assert.match(text, /壁纸：「星空」（视频，音量 30）/)
  assert.match(text, /- weather-1：天气·右上/)
  assert.match(text, /- clock-1：时钟·左上·已隐藏/)
  assert.match(text, /组件（2）：/)
  assert.match(text, /桌宠：还没放到桌面/)
  assert.match(text, /09-26 15:30「喝水」/)
  assert.match(text, /已保存的桌面模式：工作/)
})

test('app search understands Chinese names and skips uninstallers', () => {
  const index = [
    { id: '1', name: 'WeChat', path: 'C:/Start/WeChat.lnk', source: 'start-menu' },
    { id: '2', name: 'Uninstall WeChat', path: 'C:/Start/Uninstall WeChat.lnk', source: 'start-menu' },
    { id: '3', name: '网易云音乐', path: 'C:/Desktop/网易云音乐.lnk', source: 'desktop' },
    { id: '4', name: 'Google Chrome', path: 'C:/Start/Google Chrome.lnk', source: 'start-menu' },
    { id: '5', name: '记事本', path: 'C:/Windows/System32/notepad.exe', source: 'system' },
    { id: '6', name: 'Visual Studio Code', path: 'C:/Start/Visual Studio Code.lnk', source: 'start-menu' },
  ]
  assert.deepEqual(searchApps('微信', index).map((item) => item.id), ['1'])
  assert.equal(searchApps('网易云', index)[0].id, '3')
  assert.equal(searchApps('谷歌浏览器', index)[0].id, '4')
  assert.equal(searchApps('记事本', index)[0].id, '5')
  assert.equal(searchApps('vscode', index)[0].id, '6')
  assert.deepEqual(searchApps('Photoshop', index), [])
  assert.equal(volumeKeyPresses(10), 5)
  assert.equal(volumeKeyPresses(500), 50)
  assert.ok(Object.values(SETTINGS_PAGES).every((page) => page.uri.startsWith('ms-settings:')), 'only settings pages are reachable')
  assert.ok(KNOWN_FOLDER_IDS.includes('downloads') && KNOWN_FOLDER_IDS.includes('recycle_bin'))
})

test('reminder scheduling: first time, repeats and quiet hours', () => {
  const now = new Date(2026, 8, 26, 14, 0).getTime() // Saturday 14:00
  assert.equal(resolveFirstReminderTime({ inMinutes: 20, now }), now + 20 * 60_000)
  assert.equal(resolveFirstReminderTime({ at: '15:30', now }), new Date(2026, 8, 26, 15, 30).getTime())
  assert.equal(resolveFirstReminderTime({ at: '08:00', now }), new Date(2026, 8, 27, 8, 0).getTime(), 'past time of day means tomorrow')
  assert.equal(resolveFirstReminderTime({ at: '2026-10-01 09:00', now }), new Date(2026, 9, 1, 9, 0).getTime())
  assert.equal(resolveFirstReminderTime({ now }), null)

  const daily = { repeat: 'daily', timeOfDay: '23:00', nextAt: new Date(2026, 8, 26, 23, 0).getTime() }
  assert.equal(computeNextOccurrence(daily, daily.nextAt), new Date(2026, 8, 27, 23, 0).getTime())
  const weekdays = { repeat: 'weekdays', timeOfDay: '09:00', nextAt: new Date(2026, 8, 25, 9, 0).getTime() }
  assert.equal(computeNextOccurrence(weekdays, now), new Date(2026, 8, 28, 9, 0).getTime(), 'Saturday skips to Monday')
  const interval = { repeat: 'interval', intervalMinutes: 60, nextAt: now - 5 * 60_000 }
  assert.equal(computeNextOccurrence(interval, now), now + 55 * 60_000)
  assert.equal(computeNextOccurrence({ repeat: 'none', nextAt: now }, now), null)

  const quiet = { enabled: true, start: '23:00', end: '08:00' }
  assert.equal(isInQuietHours(quiet, new Date(2026, 8, 26, 23, 30).getTime()), true)
  assert.equal(isInQuietHours(quiet, new Date(2026, 8, 27, 7, 59).getTime()), true)
  assert.equal(isInQuietHours(quiet, new Date(2026, 8, 27, 8, 0).getTime()), false)
  assert.equal(isInQuietHours({ ...quiet, enabled: false }, new Date(2026, 8, 26, 23, 30).getTime()), false)

  const night = new Date(2026, 8, 26, 23, 30).getTime()
  assert.deepEqual(decideReminderFire({ kind: 'break', repeat: 'interval', nextAt: night }, night, quiet), { action: 'skip' })
  assert.deepEqual(decideReminderFire({ kind: 'text', repeat: 'none', nextAt: night }, night, quiet), { action: 'fire', silent: true, missed: false })
  const muchLater = night + 5 * 60 * 60_000
  assert.equal(decideReminderFire({ kind: 'text', repeat: 'none', nextAt: night }, muchLater, null).action, 'fire', 'an explicit one-shot still surfaces once')
  assert.equal(decideReminderFire({ kind: 'text', repeat: 'daily', nextAt: night }, muchLater, null).action, 'skip', 'stale repeats move on')
})

test('markdown subset renders structure and never links unsafe schemes', () => {
  const blocks = parseMarkdown('## 今日安排\n\n1. **写周报**\n2. 开会 `10:00`\n\n- 带伞\n- 喝水\n\n```ts\nconst a = 1\n```\n\n| 城市 | 温度 |\n| --- | --- |\n| 杭州 | 26°C |\n\n> 小提醒\n\n[官网](https://example.com)')
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'list', 'list', 'code', 'table', 'quote', 'paragraph'])
  assert.equal(blocks[1].ordered, true)
  assert.equal(blocks[1].items[0][0].type, 'strong')
  assert.equal(blocks[3].text, 'const a = 1')
  assert.deepEqual(plain(blocks[4].rows[0].map((cell) => cell[0].text)), ['杭州', '26°C'])
  assert.equal(blocks[6].children[0].type, 'link')
  const unsafe = parseMarkdownInline('[点我](javascript:alert(1))')
  assert.ok(unsafe.every((node) => node.type !== 'link'))
  assert.equal(looksLikeMarkdown('好呀，我帮你换好了～'), false)
  assert.equal(looksLikeMarkdown('- 第一件事\n- 第二件事'), true)
})

test('widget commands and pet mapping only use states the pet can draw', async () => {
  const pixelPet = await read('src/renderer/shared/pixel-pet.ts')
  for (const state of PET_EXPRESSION_STATES) assert.match(pixelPet, new RegExp(`\\b${state}: \\{ label:`), state)
  const whiteNoise = await read('src/renderer/widgets/WhiteNoise/WhiteNoise.tsx')
  for (const sound of WHITE_NOISE_SOUNDS) assert.match(whiteNoise, new RegExp(`id: '${sound}'`), sound)
  assert.equal(petStateForTool('web_search'), 'surfing')
  assert.equal(petStateForTool('wallpaper'), 'organizing')
  const scenes = await read('src/shared/desktop-scene.ts')
  for (const [, state] of scenes.matchAll(/petState: '([a-z]+)'/g)) assert.ok(PET_EXPRESSION_STATES.includes(state), state)
})

test('everyday desktop tools are always offered; heavy tools stay gated', () => {
  const { decideToolRoute, buildToolRouterPrompt } = load('src/main/memory/tools/toolRouter.ts')
  const plainChat = decideToolRoute({ text: '今天好累啊' })
  for (const name of ['wallpaper', 'app_control', 'system_control', 'reminder', 'undo_last_action', 'add_widget', 'ambient_sound', 'pet_express', 'desktop_mode']) {
    assert.ok(plainChat.toolNames.includes(name), name)
  }
  for (const name of ['run_command', 'write_file', 'read_file', 'read_attachment', 'desktop_scene_apply']) {
    assert.ok(!plainChat.toolNames.includes(name), name)
  }
  assert.deepEqual(plain(plainChat.toolNames), TOOL_MANIFEST.map((entry) => entry.name).filter((name) => plainChat.toolNames.includes(name)), 'manifest order keeps the tool prefix stable')
  assert.ok(decideToolRoute({ text: '看看这张图', hasAttachments: true }).toolNames.includes('read_attachment'))
  const workspace = { id: 'p', name: 'p', rootPath: '/tmp/p' }
  assert.ok(decideToolRoute({ text: '运行 npm test', workspace }).toolNames.includes('run_command'))
  assert.ok(!decideToolRoute({ text: '运行 npm test' }).toolNames.includes('run_command'), 'no workspace, no command tools')
  const prompt = buildToolRouterPrompt({ route: plainChat })
  assert.match(prompt, /【桌面控制】/)
  assert.doesNotMatch(prompt, /\d{1,2}:\d{2}:\d{2}|\d{4}\/\d{1,2}\/\d{1,2}/, 'volatile facts (time) live in the dynamic tail')
  assert.equal(buildToolRouterPrompt({ route: plainChat }), prompt, 'identical between turns')
  assert.equal(buildToolRouterPrompt({ route: { ...plainChat, toolNames: [] } }), '')
})

test('companion eval set: every request can reach the tool it needs', async () => {
  const cases = JSON.parse(await read('tests/fixtures/companion-eval.json'))
  const { decideToolRoute } = load('src/main/memory/tools/toolRouter.ts')
  assert.ok(cases.length >= 80)
  const ids = new Set()
  for (const item of cases) {
    assert.ok(!ids.has(item.id), `duplicate ${item.id}`)
    ids.add(item.id)
    assert.ok(getToolManifest(item.tool), `${item.id}: unknown tool ${item.tool}`)
    const route = decideToolRoute({ text: item.utterance })
    assert.ok(route.toolNames.includes(item.tool), `${item.id} 「${item.utterance}」 cannot reach ${item.tool}`)
  }
})

test('model vision detection is conservative', () => {
  assert.equal(detectVisionModelForTest('openai-compatible', 'gpt-4o-mini'), true)
  assert.equal(detectVisionModelForTest('openai-compatible', 'qwen2.5-vl-72b-instruct'), true)
  assert.equal(detectVisionModelForTest('openai-compatible', 'glm-4v-plus'), true)
  assert.equal(detectVisionModelForTest('google', 'gemini-2.5-flash'), true)
  assert.equal(detectVisionModelForTest('openai-compatible', 'qwen-max'), false)
  assert.equal(detectVisionModelForTest('openai-compatible', 'moonshot-v1-8k'), false)
})

function managedToolHarness({ policy = { decision: 'auto' }, states }) {
  const journal = []
  const grants = []
  let captureIndex = 0
  const { createManagedToolSet } = createTsLoader({
    mocks: {
      '../desktop/actionPolicy': {
        evaluateActionPolicy: async () => policy,
        addActionGrant: (key) => grants.push(key),
      },
      '../desktop/actionJournal': {
        ActionJournal: {
          record: (entry) => {
            const saved = { ...entry, id: `j${journal.length + 1}`, undoable: Boolean(entry.undo) }
            journal.push(saved)
            return saved
          },
        },
      },
      '../desktop/desktopState': {
        captureDesktopState: () => states[Math.min(captureIndex++, states.length - 1)],
        describeDesktopChange: (before, after) => (before === after ? null : { summary: '新增天气', undo: { kind: 'desktop' } }),
      },
    },
  })('src/main/memory/chat/toolExecution.ts')
  return { createManagedToolSet, journal, grants }
}

test('managed tools: confirmation suspends the call and runs it with the original input', async () => {
  const calls = []
  const { createManagedToolSet, grants } = managedToolHarness({
    policy: { decision: 'confirm', title: '要我打开「微信」吗？', risk: 'high', rememberKey: 'app:wechat' },
    states: [{}],
  })
  const requests = []
  const tools = createManagedToolSet(
    { app_control: { execute: async (input) => { calls.push(input); return { ok: true, app: '微信' } } } },
    { conversationId: 'c1', turnId: 't1', requestConfirmation: async (request) => { requests.push(request); return 'allow-always' } },
  )
  const output = await tools.app_control.execute({ action: 'open', query: '微信' })
  assert.deepEqual(plain(calls), [{ action: 'open', query: '微信' }])
  assert.equal(requests[0].title, '要我打开「微信」吗？')
  assert.deepEqual(grants, ['app:wechat'])
  assert.equal(output.ok, true)

  const declined = createManagedToolSet(
    { app_control: { execute: async () => { calls.push('should-not-run'); return { ok: true } } } },
    { conversationId: 'c1', turnId: 't1', requestConfirmation: async () => 'deny' },
  )
  const result = await declined.app_control.execute({ action: 'open', query: '微信' })
  assert.equal(result.declined, true)
  assert.equal(calls.includes('should-not-run'), false)

  const background = createManagedToolSet({ app_control: { execute: async () => ({ ok: true }) } }, { conversationId: 'c1', turnId: 't1' })
  assert.equal((await background.app_control.execute({ action: 'open' })).outcome, 'no-channel', 'automations cannot self-approve')
})

test('managed tools: desktop changes get an undoable receipt and invalidate cached reads', async () => {
  const before = { widgets: [] }
  const after = { widgets: [{ id: 'weather-1' }] }
  const { createManagedToolSet, journal } = managedToolHarness({ states: [before, after, after, after] })
  let listCalls = 0
  const tools = createManagedToolSet({
    list_widgets: { execute: async () => ({ ok: true, call: ++listCalls }) },
    add_widget: { execute: async () => ({ ok: true, added: true }) },
    reminder: { execute: async () => ({ ok: true, reminder: { text: '喝水', next: '15:30' }, undo: { kind: 'reminder-cancel', reminderId: 'rem-1' } }) },
  }, { conversationId: 'c1', turnId: 't1' })

  assert.equal((await tools.list_widgets.execute({})).call, 1)
  assert.equal((await tools.list_widgets.execute({})).call, 1, 'read-only results are cached within a turn')
  const added = await tools.add_widget.execute({ type: 'weather' })
  assert.deepEqual(plain(added.receipt), { id: 'j1', summary: '新增天气', undoable: true })
  assert.equal((await tools.list_widgets.execute({})).call, 2, 'a write clears the cache so reads see the new desktop')

  const reminder = await tools.reminder.execute({ action: 'create' })
  assert.equal(reminder.undo, undefined, 'undo specs never reach the model')
  assert.equal(reminder.receipt.summary, '设置提醒「喝水」（15:30）')
  assert.deepEqual(journal.map((entry) => [entry.toolName, entry.turnId, entry.undoable]), [['add_widget', 't1', true], ['reminder', 't1', true]])
})

test('action policy and wiring contracts', async () => {
  const [policy, execution, chatService, chatIpc, widgets, registry, manifest, preload, quickPreload, security] = await Promise.all([
    read('src/main/memory/desktop/actionPolicy.ts'),
    read('src/main/memory/chat/toolExecution.ts'),
    read('src/main/memory/chat/chatService.ts'),
    read('src/main/ipc/chatIpc.ts'),
    read('src/main/memory/tools/definitions/widgets.ts'),
    read('src/main/memory/tools/registry.ts'),
    read('src/shared/tool-manifest.ts'),
    read('src/preload/index.ts'),
    read('src/preload/quick-chat.ts'),
    read('src/main/ipc/ipcSecurity.ts'),
  ])
  assert.match(policy, /toolName === 'remove_widget'[\s\S]*isIconWidgetType\(target\.type\)[\s\S]*decision: 'confirm'/)
  assert.match(policy, /toolName === 'app_control'[\s\S]*decision: 'confirm'[\s\S]*rememberKey/)
  assert.match(policy, /action'\) === 'screenshot'[\s\S]*decision: 'confirm'/)
  assert.match(execution, /evaluateActionPolicy\(toolName, input\)[\s\S]*requestConfirmation[\s\S]*executable\.execute/)
  assert.match(execution, /captureDesktopState\(\)[\s\S]*executable\.execute[\s\S]*describeDesktopChange\(before, captureDesktopState\(\)\)/)
  assert.match(chatService, /createManagedToolSet\(rawTools, \{[\s\S]*requestConfirmation: callbacks\.requestConfirmation/)
  assert.match(chatService, /【桌面现状】[\s\S]*buildDesktopSnapshotText\(\)/)
  assert.match(chatIpc, /isTrustedIpcSender\(event, \['main', 'quick-chat'\]\)/)
  assert.match(chatIpc, /IPC\.CHAT_ATTACH_FILES[\s\S]*dialog\.showOpenDialog/, 'attachments come from a native picker, not renderer paths')
  assert.doesNotMatch(widgets, /confirmed/)
  for (const entry of TOOL_MANIFEST) {
    assert.ok(registry.includes(`${entry.name}:`) || ['reminder', 'undo_last_action', 'read_attachment'].includes(entry.name) || entry.category.startsWith('workspace') || ['command', 'document'].includes(entry.category), `${entry.name} registered`)
  }
  const journaled = TOOL_MANIFEST.filter((entry) => entry.journal).map((entry) => entry.name)
  for (const name of ['add_widget', 'arrange_widget', 'update_widget_config', 'remove_widget', 'wallpaper', 'desktop_mode', 'desktop_scene_apply']) {
    assert.ok(journaled.includes(name), `${name} is journaled for undo`)
  }
  assert.match(manifest, /name: 'app_control', category: 'desktop', risk: 'high'/)
  assert.match(preload, /role === 'quick-chat'[\s\S]*exposeQuickChatApi\(\)/)
  assert.doesNotMatch(quickPreload, /wallpaper|widget\b|project/, 'quick chat exposes chat only')
  assert.match(security, /'quick-chat'/)
})

function desktopStateHarness({ namespace = 'wp1', wallpaper }) {
  const calls = { replaced: [], restoredLayouts: [], settings: [] }
  let widgets = []
  let currentWallpaper = wallpaper
  const mod = createTsLoader({
    mocks: {
      electron: { screen: { getAllDisplays: () => [] } },
      '../../ipc/widgetIpc': {
        listWidgetsForTool: () => widgets,
        replaceWidgetsForTool: (next) => { calls.replaced.push(next); widgets = next; return next },
        getWidgetNamespaceWallpaperIdForTool: () => namespace,
      },
      '../../ipc/wallpaperIpc': {
        getWallpaperStateForTool: () => currentWallpaper,
        restoreWallpaperLayoutForTool: async (layout) => { calls.restoredLayouts.push(layout); return { ok: true } },
        updateWallpaperSettingsForTool: async (id, settings) => { calls.settings.push([id, settings]); return { ok: true } },
      },
      '../../windows/displayLayout': { getDisplayDescriptors: () => [] },
      './reminderService': { ReminderService: { summary: () => ({ pending: 0 }), getQuietHours: () => ({ enabled: false }) } },
      './desktopModes': { listDesktopModeNames: () => [] },
      './petBridge': { getPetAgentState: () => null },
    },
  })('src/main/memory/desktop/desktopState.ts')
  return {
    mod,
    calls,
    setWidgets: (next) => { widgets = next },
    setWallpaper: (next) => { currentWallpaper = next },
  }
}

test('desktop undo: widget edits, wallpaper switches and icon-box safety', async () => {
  const wallpaperA = { current: { id: 'wp1', name: 'A', type: 'image', settings: { volume: 20 } }, mode: 'primary', assignments: {} }
  const h = desktopStateHarness({ wallpaper: wallpaperA })
  const capture = (widgets, wp = wallpaperA) => ({ wallpaperId: wp.current.id, wallpaperName: wp.current.name, wallpaperSettings: wp.current.settings, displayMode: wp.mode, assignments: wp.assignments, widgets })

  const added = h.mod.describeDesktopChange(capture([]), capture([w('weather-1', { type: 'weather' })]))
  assert.equal(added.summary, '新增天气')
  assert.equal(added.undo.kind, 'desktop')
  h.setWidgets([w('weather-1', { type: 'weather' }), w('note', { type: 'text' })])
  assert.deepEqual(plain(await h.mod.applyDesktopUndo(added.undo)), { ok: true })
  assert.deepEqual(plain(h.calls.replaced.at(-1).map((item) => item.id)), ['note'], 'only the added widget is removed')

  const iconRemoved = h.mod.describeDesktopChange(capture([w('dock-1', { type: 'desktop-icons-dock' })]), capture([]))
  assert.equal(iconRemoved.undo, null, 'files moved back to the desktop are not auto-restored')

  const wallpaperB = { current: { id: 'wp2', name: 'B', type: 'video', settings: {} }, mode: 'primary', assignments: {} }
  const switched = h.mod.describeDesktopChange(capture([w('a')]), capture([w('b')], wallpaperB))
  assert.equal(switched.summary, '壁纸换成「B」')
  assert.equal(switched.undo.widgetDiff.added.length, 0, 'a wallpaper switch is not a widget edit')
  h.setWallpaper(wallpaperB)
  assert.deepEqual(plain(await h.mod.applyDesktopUndo(switched.undo)), { ok: true })
  assert.equal(h.calls.restoredLayouts.at(-1).wallpaperId, 'wp1')

  const wallpaperC = { current: { id: 'wp3', name: 'C', type: 'image', settings: {} }, mode: 'primary', assignments: {} }
  h.setWallpaper(wallpaperC)
  const refused = await h.mod.applyDesktopUndo(switched.undo)
  assert.equal(refused.ok, false, 'no undo over a wallpaper the user changed again')

  const volume = h.mod.describeDesktopChange(capture([]), capture([], { ...wallpaperA, current: { ...wallpaperA.current, settings: { volume: 60 } } }))
  assert.equal(volume.summary, '调整了壁纸播放设置')
  h.setWallpaper(wallpaperA)
  await h.mod.applyDesktopUndo(volume.undo)
  assert.deepEqual(plain(h.calls.settings.at(-1)), ['wp1', { volume: 20 }])

  const otherNamespace = desktopStateHarness({ namespace: 'wp9', wallpaper: wallpaperA })
  const result = await otherNamespace.mod.applyDesktopUndo(added.undo)
  assert.equal(result.ok, false, 'widget undo waits for its own wallpaper namespace')
})

test('action journal: digest, per-turn undo and expiry', async () => {
  const undone = []
  const { ActionJournal } = createTsLoader({
    mocks: {
      './desktopState': { applyDesktopUndo: async (spec) => { undone.push(spec.tag); return { ok: true } } },
      './reminderService': { ReminderService: { cancel: (id) => { undone.push(id); return true } } },
    },
  })('src/main/memory/desktop/actionJournal.ts')
  const desktop = (tag) => ({ kind: 'desktop', tag })
  ActionJournal.record({ conversationId: 'c1', turnId: 't1', toolName: 'add_widget', summary: '新增天气', undo: desktop('first') })
  ActionJournal.record({ conversationId: 'c1', turnId: 't2', toolName: 'wallpaper', summary: '壁纸换成「B」', undo: desktop('second') })
  ActionJournal.record({ conversationId: 'c1', turnId: 't2', toolName: 'reminder', summary: '设置提醒「喝水」', undo: { kind: 'reminder-cancel', reminderId: 'rem-1' } })
  ActionJournal.record({ conversationId: 'c1', turnId: 't2', toolName: 'app_control', summary: '打开微信', undo: null })
  ActionJournal.record({ conversationId: 'c2', turnId: 't9', toolName: 'add_widget', summary: '别的对话', undo: desktop('other') })
  assert.match(ActionJournal.digest('c1'), /\[[0-9a-f]{8}\] 打开微信（不可撤回）/)

  const turn = await ActionJournal.undoLatest({ conversationId: 'c1', scope: 'turn' })
  assert.equal(turn.ok, true)
  assert.deepEqual(undone, ['rem-1', 'second'], 'newest first, only the latest turn')
  assert.match(ActionJournal.digest('c1'), /设置提醒「喝水」（已撤回）/)
  const again = await ActionJournal.undoLatest({ conversationId: 'c1', scope: 'last' })
  assert.deepEqual(undone.at(-1), 'first')
  assert.equal(again.undone.length, 1)
  const empty = await ActionJournal.undoLatest({ conversationId: 'c1', scope: 'last' })
  assert.equal(empty.ok, false)
  assert.equal((await ActionJournal.undo('missing')).ok, false)
})

test('reminder loop fires, notifies, advances repeats and respects quiet hours', async () => {
  const data = { companionSettings: { quickChatShortcut: '', quietHours: { enabled: false, start: '23:00', end: '08:00' } } }
  const notifications = []
  const pet = []
  const events = []
  const { ReminderService } = createTsLoader({
    mocks: {
      electron: { Notification: class { static isSupported() { return true } constructor(options) { this.options = options } show() { notifications.push(this.options) } } },
      '../../store': { store: { get: (key) => data[key], set: (key, value) => { data[key] = value } } },
      '../events/eventStore': { EventStore: { append: (event) => events.push(event) } },
      '../conversations/conversationStore': { ConversationStore: { touch: () => {} } },
      '../../services/weather-service': { fetchWeatherSnapshot: async () => ({ ok: true, city: '杭州', location: '杭州', current: { weather: '小雨', temperature: 21 }, forecast: [{ tempMin: 18, tempMax: 24, precipitation: 3 }] }) },
      './petBridge': { expressPet: (payload) => { pet.push(payload); return true } },
    },
  })('src/main/memory/desktop/reminderService.ts')

  const now = Date.now()
  const once = ReminderService.create({ text: '喝水', kind: 'text', repeat: 'none', firstAt: now - 1000, conversationId: 'c1' })
  const daily = ReminderService.create({ text: '', kind: 'weather-brief', repeat: 'daily', firstAt: now - 1000, timeOfDay: '07:30' })
  assert.equal(once.ok && daily.ok, true)
  await ReminderService.tick(now)
  assert.equal(notifications.length, 2)
  assert.equal(notifications[0].body, '喝水')
  assert.match(notifications[1].body, /杭州现在小雨 21°C，今天 18~24°C，记得带伞/)
  assert.equal(pet.length, 2)
  assert.match(events[0].content.text, /⏰ 喝水/)
  const stored = ReminderService.list(true)
  assert.equal(stored.find((item) => item.text === '喝水').status, 'done')
  assert.ok(stored.find((item) => item.kind === 'weather-brief').nextAt > now, 'daily repeat moves to the next day')

  ReminderService.setQuietHours({ enabled: true, start: '00:00', end: '23:59' })
  const breakReminder = ReminderService.create({ text: '', kind: 'break', repeat: 'interval', intervalMinutes: 60, firstAt: now - 1000 })
  await ReminderService.tick(now)
  assert.equal(notifications.length, 2, 'proactive nudges stay quiet in quiet hours')
  assert.ok(ReminderService.list().find((item) => item.id === breakReminder.reminder.id).nextAt > now)
  assert.equal(ReminderService.cancel(breakReminder.reminder.id), true)
  assert.equal(ReminderService.summary().pending, 1)
})
