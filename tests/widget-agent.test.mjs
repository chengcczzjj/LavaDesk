import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

import {
  WIDGET_CONFIG_SPECS,
  WIDGET_THEME_IDS,
  normalizeWidgetConfigPatch,
  pickWidgetSettings,
} from '../src/shared/widget-config-spec.ts'
import { WIDGET_CAPABILITIES, WIDGET_TYPES } from '../src/shared/desktop-scene.ts'
import {
  estimateGeneratedWidgetHeight,
  getReadableGeneratedAccent,
} from '../src/shared/generated-widget.ts'
import { positionAtAnchor } from '../src/shared/widget-anchor.ts'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function extractIds(source, constantName) {
  const start = source.indexOf(`export const ${constantName}`)
  assert.ok(start >= 0, `${constantName} not found`)
  const end = source.indexOf(']', start)
  return [...source.slice(start, end).matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1])
}

test('AI widget settings match what the desktop toolbar offers and the widgets render', async () => {
  const constants = await read('src/renderer/widgets/shared/constants.tsx')
  assert.deepEqual([...WIDGET_THEME_IDS], extractIds(constants, 'COLOR_THEMES'))
  assert.deepEqual([...WIDGET_CONFIG_SPECS.clock.style.options], extractIds(constants, 'CLOCK_STYLES'))
  assert.deepEqual([...WIDGET_CONFIG_SPECS.pixelclock.style.options], extractIds(constants, 'PIXEL_CLOCK_STYLES'))
  assert.deepEqual([...WIDGET_CONFIG_SPECS.weather.style.options], extractIds(constants, 'WEATHER_STYLES'))
  assert.deepEqual([...WIDGET_CONFIG_SPECS.whitenoise.style.options], extractIds(constants, 'NOISE_STYLES'))
  assert.deepEqual([...WIDGET_CONFIG_SPECS.audio.style.options], extractIds(constants, 'AUDIO_STYLES'))

  // Every audio style the toolbar offers has a drawing branch.
  const audio = await read('src/renderer/widgets/Audio/Audio.tsx')
  for (const style of WIDGET_CONFIG_SPECS.audio.style.options) {
    assert.match(audio, new RegExp(`style === '${style}'`), `audio style ${style} is not rendered`)
  }
  assert.deepEqual(Object.keys(WIDGET_CONFIG_SPECS).sort(), [...WIDGET_TYPES].sort())
})

test('every built-in preset only uses real settings', async () => {
  for (const capability of WIDGET_CAPABILITIES) {
    assert.equal('configSchema' in capability, false, 'stale capability config schema must not come back')
    for (const preset of capability.presets) {
      const result = normalizeWidgetConfigPatch(capability.type, preset.config ?? {})
      assert.deepEqual(result.rejected, [], `${capability.type}/${preset.id}`)
      assert.deepEqual(result.adjusted, [], `${capability.type}/${preset.id}`)
    }
  }
})

test('config patches are validated, normalised and explained', () => {
  const clock = normalizeWidgetConfigPatch('clock', { style: 'Stacked', opacity: 5, themeId: 'blue', glow: true })
  assert.deepEqual(clock.config, { style: 'stacked', opacity: 1, themeId: 'blue' })
  assert.deepEqual(clock.applied, ['style', 'opacity', 'themeId'])
  assert.equal(clock.adjusted[0].key, 'opacity')
  assert.deepEqual(clock.rejected, [{ key: 'glow', reason: 'unknown-key', allowed: ['style', 'themeId', 'opacity'] }])

  const invalidStyle = normalizeWidgetConfigPatch('clock', { style: 'elegant' })
  assert.deepEqual(invalidStyle.rejected, [{ key: 'style', reason: 'invalid-value', allowed: ['minimal', 'stacked'] }])

  const dock = normalizeWidgetConfigPatch('desktop-icons-dock', { dockTint: '#ABC', dockOpacity: '0.5', items: [] })
  assert.deepEqual(dock.config, { dockTint: '#aabbcc', dockOpacity: 0.24 })
  assert.equal(dock.rejected[0].key, 'items')

  const text = normalizeWidgetConfigPatch('text', { text: '  专注  ' })
  assert.deepEqual(text.config, { text: '专注' })

  // Summaries never echo heavy payloads such as icon lists or note HTML.
  assert.deepEqual(pickWidgetSettings('desktop-icons-dock', { items: [{ icon: 'data:...' }], dockOpacity: 0.1 }), { dockOpacity: 0.1 })
  // Sticky notes moved to the separate LavaNotes app; the AI cannot create the old widget.
  assert.equal(WIDGET_TYPES.includes('todo-board'), false)
})

test('generated cards size to their content and keep accent text readable', () => {
  const short = estimateGeneratedWidgetHeight({ blocks: [{ type: 'metric', label: '今日', value: '3' }] }, 340)
  const long = estimateGeneratedWidgetHeight({
    subtitle: '本周目标',
    blocks: [
      { type: 'text', text: '把复杂的事情拆成小步，每天完成一点点。'.repeat(3) },
      { type: 'list', title: '清单', items: Array.from({ length: 8 }, (_, index) => ({ id: `i${index}`, text: `第 ${index + 1} 项任务` })) },
      { type: 'countdown', label: '截止', targetAt: '2030-01-01T00:00:00Z' },
    ],
  }, 340)
  assert.ok(short >= 120 && short < 160, `short card ${short}`)
  assert.ok(long > 360 && long <= 720, `long card ${long}`)

  assert.notEqual(getReadableGeneratedAccent('#ffe066', 'paper'), '#ffe066')
  assert.equal(getReadableGeneratedAccent('#ffe066', 'glass'), '#ffe066')
  assert.notEqual(getReadableGeneratedAccent('#101010', 'solid'), '#101010')
})

test('anchors place widgets inside the work area with a consistent margin', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1032 }
  assert.deepEqual(positionAtAnchor('top-right', { width: 300, height: 200 }, area), { x: 1920 - 32 - 300, y: 32 })
  assert.deepEqual(positionAtAnchor('bottom-left', { width: 300, height: 200 }, area), { x: 32, y: 1032 - 32 - 200 })
  assert.deepEqual(positionAtAnchor('top-center', { width: 300, height: 200 }, area), { x: 810, y: 32 })
})

test('agent widget tools: layout tool, validated edits and follow-up routing', async () => {
  const [widgetTools, router, chatService, manifest, widgetIpc] = await Promise.all([
    read('src/main/memory/tools/definitions/widgets.ts'),
    read('src/main/memory/tools/toolRouter.ts'),
    read('src/main/memory/chat/chatService.ts'),
    read('src/shared/tool-manifest.ts'),
    read('src/main/ipc/widgetIpc.ts'),
  ])
  assert.match(manifest, /name: 'arrange_widget', category: 'widget'/)
  assert.match(manifest, /name: 'update_generated_widget', category: 'widget'/)
  assert.match(manifest, /name: 'widget_capability_list', category: 'widget'/)
  assert.match(widgetTools, /export const updateWidgetConfigTool[\s\S]*normalizeWidgetConfigPatch\(widgetType/)
  assert.match(widgetTools, /export const addWidgetTool[\s\S]*normalizeWidgetConfigPatch\(type/)
  // Deleting a Dock / icon box is confirmed by the chat surface, not by a flag the model can set itself.
  assert.doesNotMatch(widgetTools, /confirmed/)
  assert.match(widgetTools, /estimateGeneratedWidgetHeight\(definition, width\)/)
  assert.doesNotMatch(widgetTools, /config: widget\.config \?\? \{\}/)
  assert.match(router, /recentlyUsedCategory\(params\.recentToolNames, 'widget'\)/)
  assert.match(chatService, /decideToolRoute\(\{\s*text,\s*workspace,\s*recentToolNames,/)
  // Layout edits stay on the widget's own monitor, in the display-local space widgets are stored in.
  assert.match(widgetIpc, /export function arrangeWidgetForTool[\s\S]*getWidgetDisplayContext\(target\)[\s\S]*positionAtAnchor\(params\.anchor, layoutSize, context\.workArea\)/)
  assert.match(widgetIpc, /function placeWidgetOnDisplay[\s\S]*getWidgetsForDisplay\(list, context\.display\)/)
})
