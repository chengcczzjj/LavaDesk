import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

import {
  classifyNativeCursorSurface,
  findInteractiveWidgetAtPoint,
  sanitizeCanvasHitRegions,
  shouldIgnoreCanvasMouse,
} from '../src/shared/canvas-hit-test.ts'

test('renderer hit regions are validated before they route native input', () => {
  const region = { id: 'card-1', type: 'generated-widget', x: 10, y: 20, width: 220, height: 190, stackOrder: 3 }
  assert.deepEqual(sanitizeCanvasHitRegions([region]), [region])
  // Empty rectangles are skipped, malformed payloads are rejected as a whole.
  assert.deepEqual(sanitizeCanvasHitRegions([{ ...region, width: 0 }]), [])
  assert.equal(sanitizeCanvasHitRegions([{ ...region, x: Number.NaN }]), null)
  assert.equal(sanitizeCanvasHitRegions([{ ...region, id: '' }]), null)
  assert.equal(sanitizeCanvasHitRegions('nope'), null)
  assert.equal(sanitizeCanvasHitRegions(Array.from({ length: 201 }, () => region)), null)

  // A widget's measured footprint can extend past its persisted rect.
  const persisted = { ...region, x: 100, y: 100, enabled: true }
  const measured = { ...region, x: 96, y: 98, width: 228, height: 196 }
  const canvas = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(findInteractiveWidgetAtPoint({ x: 97, y: 150 }, canvas, [persisted]), undefined)
  assert.equal(findInteractiveWidgetAtPoint({ x: 97, y: 150 }, canvas, [measured])?.id, 'card-1')
})

test('widgets covered by another window never make the canvas capture the mouse', () => {
  assert.equal(classifyNativeCursorSurface({ hitHwnd: 5, canvasTopmost: true, desktopSurface: false }), 'canvas')
  assert.equal(classifyNativeCursorSurface({ hitHwnd: 5, canvasTopmost: false, desktopSurface: true }), 'desktop')
  assert.equal(classifyNativeCursorSurface({ hitHwnd: 9, canvasTopmost: false, desktopSurface: false }), 'foreign')
  assert.equal(classifyNativeCursorSurface({ hitHwnd: 0, canvasTopmost: false, desktopSurface: false }), 'unknown')

  const base = { desktopOccluded: false, editing: false, pointerActive: false, widgetUnderCursor: true }
  assert.equal(shouldIgnoreCanvasMouse(base), false)
  assert.equal(shouldIgnoreCanvasMouse({ ...base, cursorCovered: true }), true)
  // A drag that started on the canvas keeps capture while passing under an app.
  assert.equal(shouldIgnoreCanvasMouse({ ...base, cursorCovered: true, pointerActive: true }), false)
  assert.equal(shouldIgnoreCanvasMouse({ ...base, cursorCovered: true, editing: true }), false)
})

test('display topology preview keeps every monitor at its real aspect ratio', async () => {
  const { layoutDisplayTopology, formatDisplayResolution, getDisplayModeOption } = await import('../src/shared/display-topology.ts')
  const single = layoutDisplayTopology([{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], { width: 800, height: 220 }, 18)
  const ratio = single[0].rect.width / single[0].rect.height
  assert.ok(Math.abs(ratio - 16 / 9) < 0.08, `16:9 monitor drawn at ${ratio.toFixed(2)}:1`)
  // Centred horizontally inside the preview box.
  assert.ok(Math.abs(single[0].rect.left + single[0].rect.width / 2 - 400) <= 2)

  const portraitAndLandscape = layoutDisplayTopology([
    { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { id: 2, bounds: { x: 2560, y: -240, width: 1080, height: 1920 } },
  ], { width: 800, height: 220 }, 18)
  const portrait = portraitAndLandscape[1].rect
  assert.ok(portrait.height > portrait.width, 'portrait monitor must stay portrait')
  // Neighbouring monitors never overlap.
  const landscape = portraitAndLandscape[0].rect
  assert.ok(landscape.left + landscape.width <= portrait.left)

  assert.equal(formatDisplayResolution({ bounds: { x: 0, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 }), '2561 × 1440')
  assert.equal(getDisplayModeOption('span').label, '跨屏延展')
})

test('desktop layer contracts: covered widgets, DOM hit regions and quiet z-order', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const [canvasWindow, mainIndex, wallpaperIpc, widgetIpc, canvasRenderer, canvasCss] = await Promise.all([
    read('src/main/windows/canvasWindow.ts'),
    read('src/main/index.ts'),
    read('src/main/ipc/wallpaperIpc.ts'),
    read('src/main/ipc/widgetIpc.ts'),
    read('src/renderer/canvas/Canvas.tsx'),
    read('src/renderer/canvas/canvas.css'),
  ])

  // Native hit testing uses what the renderer painted, and ignores widgets another window covers.
  assert.match(canvasWindow, /findInteractiveWidgetAtPoint\(cursor, displayBounds, getCanvasHitCandidates\(displayBounds\)\)/)
  // Until the renderer reports, stored display-local widgets are projected into canvas space.
  assert.match(canvasWindow, /return rendererHitRegions \?\? materializeWidgetsForCanvas\(/)
  assert.match(widgetIpc, /IPC\.CANVAS_SET_HIT_REGIONS[\s\S]*sanitizeCanvasHitRegions\(regions\)[\s\S]*setCanvasHitRegions\(_e\.sender\.id, sanitized\)/)
  assert.match(canvasWindow, /cursorCovered: cursorSurfaceCovered/)
  assert.match(canvasWindow, /const covered = !rendererPointerActive && isCoveredCursorSurface\(widgetSurface\)/)
  assert.match(canvasWindow, /export function setCanvasMousePassthrough[\s\S]*isCoveredCursorSurface\(inspectNativeCursorSurface\(\)\)/)
  assert.match(canvasRenderer, /setHitRegions\?\.\(regions\)/)
  assert.match(canvasRenderer, /dataset\.pointerOccluded = 'true'/)
  assert.match(canvasCss, /html\[data-pointer-occluded='true'\] body \* \{\s*pointer-events: none !important;/)

  // Chromium's native occlusion tracker is what kept marking the bottom-most canvas stale.
  assert.match(mainIndex, /appendSwitch\('disable-features', 'CalculateNativeWinOcclusion'\)/)

  // Applying a wallpaper no longer flashes the canvas above every window.
  const applyHandler = wallpaperIpc.slice(
    wallpaperIpc.indexOf('ipcMain.handle(IPC.WALLPAPER_APPLY'),
    wallpaperIpc.indexOf('IPC.WALLPAPER_SAVE_SETTINGS'),
  )
  assert.doesNotMatch(applyHandler, /refreshCanvasZOrder\(\)/)
})
