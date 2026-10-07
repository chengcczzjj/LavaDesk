import test from 'node:test'
import assert from 'node:assert/strict'

import { isTrustedRendererAssetOrigin, toAssetUrl, toRendererPublicUrl } from '../src/shared/asset-url.ts'
import { isGeneratedWidgetDefinition } from '../src/shared/generated-widget.ts'
import { DEFAULT_WIDGET_SIZE_BY_TYPE, WIDGET_TYPES } from '../src/shared/desktop-scene.ts'
import { TOOL_MANIFEST, getToolManifest } from '../src/shared/tool-manifest.ts'
import { approvalMatchesRequest } from '../src/shared/approval-scope.ts'
import { automationStatusFromChat } from '../src/shared/agent-runtime.ts'
import { rectCoversDisplay, StableBooleanTransition } from '../src/shared/desktop-occlusion.ts'
import { CanvasPointerGate } from '../src/shared/canvas-pointer-gate.ts'
import {
  DEEPSEEK_CONTEXT_TOKENS,
  DEEPSEEK_LATEST_MODEL,
  DEEPSEEK_MAX_OUTPUT_TOKENS,
  isDeepSeekV4Model,
  normalizeDeepSeekBaseURL,
  normalizeDeepSeekModel,
} from '../src/shared/model-defaults.ts'
import { normalizeStockSymbols } from '../src/shared/stock-symbols.ts'
import { findSmartWidgetPlacement } from '../src/shared/widget-placement.ts'
import {
  ICON_LAUNCH_FEEDBACK_MS,
  ICON_LAUNCH_OVERLAY_DELAY_SECONDS,
  ICON_LAUNCH_OVERLAY_DURATION_SECONDS,
  ICON_LAUNCH_OVERLAY_EASE,
  ICON_LAUNCH_OVERLAY_INITIAL_OPACITY,
  ICON_LAUNCH_OVERLAY_SCALE,
  ICON_LAUNCH_SCALE_DURATION_SECONDS,
  ICON_LAUNCH_SCALE_EASE,
  ICON_LAUNCH_SCALE_KEYFRAMES,
  shouldAnimateDockSystemAction,
} from '../src/shared/icon-launch-motion.ts'
import { createShowDesktopInputEvents } from '../src/main/windows/windowsDesktop.ts'
import {
  CANVAS_INTERACTION_REPAIR_DELAY_MS,
  CANVAS_STARTUP_OCCLUSION_GRACE_MS,
  CANVAS_STARTUP_OCCLUSION_RECREATE_MS,
  findInteractiveWidgetAtPoint,
  isCanvasInteractiveWidgetType,
  isDesktopIconWidgetType,
  isPassiveWidgetType,
  shouldIgnoreCanvasMouse,
  shouldRecreateCanvasAfterInitialOcclusion,
  shouldRecoverCanvasAfterDesktopReturn,
  shouldRepairCanvasInteraction,
} from '../src/shared/canvas-hit-test.ts'
import { selectAppWindowCandidate } from '../src/shared/window-activation.ts'
import { isNativeCanvasSurfaceHit, shouldFallbackNativeDockClick } from '../src/shared/native-dock-click.ts'
import { moveWidgetToFront } from '../src/shared/widget-order.ts'

test('asset URLs preserve Windows paths and packaged public assets', () => {
  assert.equal(
    toAssetUrl('G:\\壁纸\\a b.jpg'),
    'lyasset://local/G%3A/%E5%A3%81%E7%BA%B8/a%20b.jpg',
  )

  const originalLocation = globalThis.location
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'file:///C:/Lingyue/resources/app.asar/out/renderer/main-ui/index.html' },
  })
  assert.equal(
    toRendererPublicUrl('/audio/Water.WAV'),
    'file:///C:/Lingyue/resources/app.asar/out/renderer/audio/Water.WAV',
  )
  Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation })
})

test('asset CORS is limited to packaged and local development renderers', () => {
  assert.equal(isTrustedRendererAssetOrigin('null'), true)
  assert.equal(isTrustedRendererAssetOrigin('file://'), true)
  assert.equal(isTrustedRendererAssetOrigin('http://localhost:5174'), true)
  assert.equal(isTrustedRendererAssetOrigin('http://127.0.0.1:5174'), true)
  assert.equal(isTrustedRendererAssetOrigin('https://example.com'), false)
  assert.equal(isTrustedRendererAssetOrigin(null), false)
})

test('generated widgets use a validated declarative contract', () => {
  const valid = {
    version: 1,
    name: 'reading-plan',
    title: '阅读计划',
    theme: 'glass',
    accent: '#ffb86b',
    blocks: [{
      type: 'list',
      interactive: true,
      items: [{ id: 'book-1', text: '读完第一章', done: false }],
    }],
  }
  assert.equal(isGeneratedWidgetDefinition(valid), true)
  assert.equal(isGeneratedWidgetDefinition({ ...valid, blocks: [{ type: 'list', items: [{ text: 'missing id' }] }] }), false)
  assert.equal(isGeneratedWidgetDefinition({ ...valid, blocks: [{ type: 'script', code: 'alert(1)' }] }), false)
  assert.ok(WIDGET_TYPES.includes('generated-widget'))
  assert.ok(DEFAULT_WIDGET_SIZE_BY_TYPE['generated-widget'].width > 0)
})

test('tool manifest is unique and owns generated-widget routing metadata', () => {
  const names = TOOL_MANIFEST.map((entry) => entry.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(TOOL_MANIFEST.every((entry) => entry.label && entry.compactLabel))
  assert.deepEqual(
    getToolManifest('create_generated_widget'),
    {
      name: 'create_generated_widget',
      category: 'widget',
      risk: 'low',
      cacheable: false,
      tracksAgentRun: false,
      label: '生成桌面组件',
      compactLabel: '组件',
    },
  )
})

test('approval scope cannot cross workspace, command, tool, or path boundaries', () => {
  const approval = {
    workspaceId: 'workspace-a',
    toolName: 'run_command',
    action: '运行命令',
    affectedPaths: ['src\\app.ts'],
    command: 'npm test',
  }
  assert.equal(approvalMatchesRequest(approval, {
    workspaceId: 'workspace-a', toolName: 'run_command', action: '运行命令', affectedPaths: ['src/app.ts'], command: 'npm test',
  }), true)
  assert.equal(approvalMatchesRequest(approval, {
    workspaceId: 'workspace-b', toolName: 'run_command', action: '运行命令', affectedPaths: ['src/app.ts'], command: 'npm test',
  }), false)
  assert.equal(approvalMatchesRequest(approval, {
    workspaceId: 'workspace-a', toolName: 'run_command', action: '运行命令', affectedPaths: ['src/other.ts'], command: 'npm test',
  }), false)
  assert.equal(approvalMatchesRequest(approval, {
    workspaceId: 'workspace-a', toolName: 'run_command', action: '运行命令', affectedPaths: ['src/app.ts'], command: 'npm run build',
  }), false)
})

test('automations never report approval waits or failures as completed', () => {
  assert.deepEqual(automationStatusFromChat('completed'), { status: 'completed' })
  assert.deepEqual(automationStatusFromChat('cancelled'), { status: 'cancelled' })
  assert.equal(automationStatusFromChat('failed').status, 'failed')
  assert.equal(automationStatusFromChat('waiting-approval').status, 'failed')
})

test('desktop occlusion only commits stable coverage of the primary display', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(rectCoversDisplay({ left: 0, top: 0, right: 1920, bottom: 1080 }, primary), true)
  assert.equal(rectCoversDisplay({ left: 1920, top: 0, right: 3840, bottom: 1080 }, primary), false)
  assert.equal(rectCoversDisplay({ left: 0, top: 0, right: 1920, bottom: 1040 }, primary), false)

  const transition = new StableBooleanTransition(false, 2)
  assert.equal(transition.sample(true), null)
  assert.equal(transition.sample(false), null)
  assert.equal(transition.sample(true), null)
  assert.equal(transition.sample(true), true)
  assert.equal(transition.value, true)
  assert.equal(transition.sample(false), null)
  assert.equal(transition.sample(false), false)
  assert.equal(transition.value, false)
})

test('canvas mouse passthrough stays locked until an active pointer gesture ends', () => {
  const gate = new CanvasPointerGate()
  assert.equal(gate.shouldIgnoreMouse(false, false), true)
  assert.equal(gate.shouldIgnoreMouse(true, false), false)

  gate.begin(7)
  assert.equal(gate.shouldIgnoreMouse(false, false), false)
  gate.end(7)
  assert.equal(gate.shouldIgnoreMouse(false, false), true)

  gate.begin(8)
  gate.reset()
  assert.equal(gate.shouldIgnoreMouse(false, false), true)
  assert.equal(gate.shouldIgnoreMouse(false, true), false)
})

test('widget stack order is an explicit, persisted interaction contract', () => {
  const widgets = [
    { id: 'note-a', stackOrder: 4 },
    { id: 'note-b', stackOrder: 8 },
  ]
  const updated = moveWidgetToFront(widgets, 'note-a')
  assert.equal(updated[0].stackOrder, 9)
  assert.equal(updated[1].stackOrder, 8)
})

test('native canvas hit testing follows visual z-order and keeps widgets alive without renderer mousemove events', () => {
  const dock = {
    id: 'dock-1', type: 'desktop-icons-dock', x: 800, y: 900, width: 600, height: 88, enabled: true, config: {},
  }
  const lowerNote = {
    id: 'card-lower', type: 'generated-widget', x: 100, y: 100, width: 220, height: 190, enabled: true, config: {},
  }
  const upperNote = { ...lowerNote, id: 'card-upper', x: 130, y: 120 }
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(findInteractiveWidgetAtPoint({ x: 810, y: 890 }, display, [dock])?.id, dock.id)
  assert.equal(findInteractiveWidgetAtPoint({ x: 400, y: 400 }, display, [dock]), undefined)
  assert.equal(findInteractiveWidgetAtPoint({ x: 180, y: 150 }, display, [lowerNote, upperNote])?.id, upperNote.id)
  assert.equal(findInteractiveWidgetAtPoint({ x: 180, y: 150 }, display, [
    { ...upperNote, stackOrder: 1 },
    { ...lowerNote, stackOrder: 8 },
  ])?.id, lowerNote.id)
  assert.equal(findInteractiveWidgetAtPoint({ x: 99, y: 150 }, display, [lowerNote]), undefined)
  assert.equal(shouldIgnoreCanvasMouse({
    desktopOccluded: false, editing: false, pointerActive: false, widgetUnderCursor: true,
  }), false)
  assert.equal(shouldIgnoreCanvasMouse({
    desktopOccluded: false, editing: false, pointerActive: true, widgetUnderCursor: false,
  }), false)
  assert.equal(shouldIgnoreCanvasMouse({
    desktopOccluded: false, editing: false, pointerActive: false, widgetUnderCursor: false,
  }), true)
  assert.equal(shouldIgnoreCanvasMouse({
    desktopOccluded: false, recompositing: true, editing: false, pointerActive: false, widgetUnderCursor: true,
  }), true)
  assert.equal(isDesktopIconWidgetType('desktop-icons-box'), true)
  assert.equal(isDesktopIconWidgetType('desktop-icons-horizontal'), true)
  assert.equal(isDesktopIconWidgetType('desktop-icons-adaptive'), true)
  assert.equal(isDesktopIconWidgetType('desktop-icons-dock'), true)
  assert.equal(isDesktopIconWidgetType('clock'), false)
  assert.equal(isPassiveWidgetType('clock'), true)
  assert.equal(isPassiveWidgetType('graphicdatetime'), true)
  assert.equal(isPassiveWidgetType('weather'), true)
  assert.equal(isPassiveWidgetType('quicktools'), true)
  assert.equal(isCanvasInteractiveWidgetType('clock'), false)
  assert.equal(isCanvasInteractiveWidgetType('generated-widget'), true)
  assert.equal(findInteractiveWidgetAtPoint({ x: 180, y: 150 }, display, [{
    id: 'clock-1', type: 'clock', x: 100, y: 100, width: 220, height: 190, enabled: true, config: {},
  }]), undefined)
})

test('canvas interaction repair only recomposes when Windows still hits the desktop shell', () => {
  const base = {
    desktopOccluded: false,
    recompositing: false,
    nativeMousePassthrough: false,
    rendererMousePassthrough: true,
    captureRequestedAt: 1_000,
    now: 1_000 + CANVAS_INTERACTION_REPAIR_DELAY_MS,
    canvasTopmost: true,
    desktopSurface: false,
    alreadyAttempted: false,
  }
  assert.equal(shouldRepairCanvasInteraction(base), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, canvasTopmost: false, desktopSurface: true }), true)
  // The renderer can report a healthy hover while the native HWND is still
  // behind the desktop compositor after a fullscreen transition.
  assert.equal(
    shouldRepairCanvasInteraction({ ...base, rendererMousePassthrough: false, canvasTopmost: false, desktopSurface: true }),
    true,
  )
  assert.equal(shouldRepairCanvasInteraction({ ...base, canvasTopmost: false, desktopSurface: false }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, rendererMousePassthrough: false }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, nativeMousePassthrough: true }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, desktopOccluded: true }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, recompositing: true }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, alreadyAttempted: true }), false)
  assert.equal(shouldRepairCanvasInteraction({ ...base, now: base.now - 1 }), false)
})

test('a canvas created behind a long startup lock screen is rebuilt on desktop return', () => {
  const base = {
    canvasAgeAtOcclusionMs: CANVAS_STARTUP_OCCLUSION_GRACE_MS,
    occlusionDurationMs: CANVAS_STARTUP_OCCLUSION_RECREATE_MS,
    rendererPointerDownObserved: false,
  }
  assert.equal(shouldRecreateCanvasAfterInitialOcclusion(base), true)
  assert.equal(shouldRecreateCanvasAfterInitialOcclusion({
    ...base,
    canvasAgeAtOcclusionMs: CANVAS_STARTUP_OCCLUSION_GRACE_MS + 1,
  }), false)
  assert.equal(shouldRecreateCanvasAfterInitialOcclusion({
    ...base,
    occlusionDurationMs: CANVAS_STARTUP_OCCLUSION_RECREATE_MS - 1,
  }), false)
  assert.equal(shouldRecreateCanvasAfterInitialOcclusion({
    ...base,
    rendererPointerDownObserved: true,
  }), false)
})

test('desktop-return z-order recovery only runs for the Windows shell', () => {
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'desktop-progman', className: 'Progman' }), true)
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'display-coverage', className: 'WorkerW' }), true)
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'no-foreground-window' }), true)
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'display-coverage', className: 'H-SMILE-FRAME' }), false)
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'display-coverage', className: 'TWINCONTROL' }), false)
  assert.equal(shouldRecoverCanvasAfterDesktopReturn({ reason: 'display-coverage', className: 'Chrome_WidgetWin_1' }), false)
})

test('native desktop icon click fallback only runs when the renderer missed a short stationary click', () => {
  const base = {
    startedAt: 1_000,
    endedAt: 1_120,
    start: { x: 900, y: 800 },
    end: { x: 903, y: 802 },
    widgetId: 'dock-1',
    releaseWidgetId: 'dock-1',
    rendererActionPointerDownAt: 0,
    canvasTopmostAtStart: true,
    canvasTopmostAtEnd: true,
  }
  assert.equal(shouldFallbackNativeDockClick(base), true)
  assert.equal(shouldFallbackNativeDockClick({ ...base, rendererActionPointerDownAt: 1_050 }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, rendererActionPointerDownAt: 950 }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, rendererActionPointerDownAt: 900 }), true)
  assert.equal(shouldFallbackNativeDockClick({ ...base, end: { x: 930, y: 802 } }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, endedAt: 1_900 }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, releaseWidgetId: null }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, canvasTopmostAtStart: false }), false)
  assert.equal(shouldFallbackNativeDockClick({ ...base, canvasTopmostAtEnd: false }), false)
  assert.equal(
    shouldFallbackNativeDockClick({
      ...base,
      canvasTopmostAtStart: false,
      canvasTopmostAtEnd: false,
      desktopSurfaceAtStart: true,
      desktopSurfaceAtEnd: true,
    }),
    true,
  )

  assert.equal(isNativeCanvasSurfaceHit({ hitHwnd: 11, rootHwnd: 10, canvasHwnd: 10 }), true)
  assert.equal(isNativeCanvasSurfaceHit({ hitHwnd: 10, rootHwnd: 10, canvasHwnd: 10 }), true)
  assert.equal(isNativeCanvasSurfaceHit({ hitHwnd: 21, rootHwnd: 20, canvasHwnd: 10 }), false)
  assert.equal(isNativeCanvasSurfaceHit({ hitHwnd: 0, rootHwnd: 0, canvasHwnd: 0 }), false)
})

test('moving a widget to the front preserves the other widgets and source order', () => {
  const first = { id: 'first', stackOrder: 0 }
  const second = { id: 'second', stackOrder: 1 }
  const third = { id: 'third', stackOrder: 2 }
  const widgets = [first, second, third]
  const updated = moveWidgetToFront(widgets, 'first')
  assert.deepEqual(updated.map((widget) => widget.id), ['first', 'second', 'third'])
  assert.equal(updated[0].stackOrder, 3)
  assert.equal(updated[1].stackOrder, 1)
  assert.equal(updated[2].stackOrder, 2)
  assert.deepEqual(widgets.map((widget) => widget.stackOrder), [0, 1, 2])
  assert.equal(moveWidgetToFront(widgets, 'third'), widgets)
  assert.equal(moveWidgetToFront(widgets, 'missing'), widgets)
})

test('show desktop emits a complete Win+D key sequence', () => {
  assert.deepEqual(
    createShowDesktopInputEvents().map((event) => [event.u.ki.wVk, event.u.ki.dwFlags]),
    [
      [0x5b, 0],
      [0x44, 0],
      [0x44, 0x0002],
      [0x5b, 0x0002],
    ],
  )
})

test('existing single-instance apps prefer a visible family window for reactivation', () => {
  const candidates = [
    {
      hwnd: 5, processId: 99, processPath: 'G:\\STEAM\\steam.exe', title: 'GDI+ Window (steam.exe)', visible: true,
      enabled: true, minimized: false, owned: false, toolWindow: false, zOrder: 1,
      className: 'GDI+ Hook Window Class', rect: { left: 0, top: 0, right: 1, bottom: 1 },
    },
    {
      hwnd: 10, processId: 100, processPath: 'G:\\STEAM\\steam.exe', title: '', visible: false,
      enabled: true, minimized: false, owned: false, toolWindow: false, zOrder: 5,
    },
    {
      hwnd: 20, processId: 101, processPath: 'G:\\STEAM\\bin\\cef\\steamwebhelper.exe', title: 'Steam', visible: true,
      enabled: true, minimized: true, owned: false, toolWindow: false, zOrder: 2,
    },
    {
      hwnd: 30, processId: 102, processPath: 'D:\\Other\\helper.exe', title: 'Other', visible: true,
      enabled: true, minimized: false, owned: false, toolWindow: false, zOrder: 0,
    },
  ]
  assert.equal(selectAppWindowCandidate('G:\\STEAM\\steam.exe', candidates)?.hwnd, 20)

  const hiddenMainWindow = {
    hwnd: 40, processId: 103, processPath: 'D:\\Apps\\Chat\\Chat.exe', title: 'Chat', visible: false,
    enabled: true, minimized: false, owned: false, toolWindow: false, zOrder: 4,
  }
  assert.equal(selectAppWindowCandidate('D:\\Apps\\Chat\\Chat.exe', [hiddenMainWindow])?.hwnd, 40)

  const nestedLauncherWindow = {
    hwnd: 50, processId: 104, processPath: 'D:\\Apps\\Feishu\\app\\Feishu.exe', title: '飞书', visible: true,
    enabled: true, minimized: false, owned: false, toolWindow: false, zOrder: 3,
    className: 'Chrome_WidgetWin_1', rect: { left: 100, top: 100, right: 1400, bottom: 1000 },
  }
  assert.equal(selectAppWindowCandidate('D:\\Apps\\Feishu\\Feishu.exe', [nestedLauncherWindow])?.hwnd, 50)
})

test('legacy DeepSeek aliases migrate to the current V4 Flash API contract', () => {
  assert.equal(DEEPSEEK_LATEST_MODEL, 'deepseek-v4-flash')
  assert.equal(normalizeDeepSeekModel('deepseek-chat'), DEEPSEEK_LATEST_MODEL)
  assert.equal(normalizeDeepSeekModel('deepseek-reasoner'), DEEPSEEK_LATEST_MODEL)
  assert.equal(normalizeDeepSeekModel('deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(normalizeDeepSeekBaseURL('https://api.deepseek.com/v1'), 'https://api.deepseek.com')
  assert.equal(isDeepSeekV4Model(DEEPSEEK_LATEST_MODEL), true)
  assert.equal(DEEPSEEK_CONTEXT_TOKENS, 1_000_000)
  assert.equal(DEEPSEEK_MAX_OUTPUT_TOKENS, 384_000)
})

test('conversation stock inputs normalize into fetchable A-share symbols', () => {
  assert.deepEqual(normalizeStockSymbols([
    '贵州茅台',
    { code: '0.000858', name: '五粮液' },
    { symbol: '600519.SH' },
    'AAPL',
  ]), [
    { code: '600519', name: '贵州茅台', market: '1' },
    { code: '000858', name: '五粮液', market: '0' },
  ])
})

test('new widgets continue an aligned group instead of defaulting to the upper-left', () => {
  const area = { x: 0, y: 0, width: 1600, height: 900 }
  const emptyPlacement = findSmartWidgetPlacement(320, 200, [], area)
  assert.ok(emptyPlacement.x > area.width / 2)

  const existing = [{ x: 1008, y: 32, width: 320, height: 200, enabled: true, type: 'generated-widget' }]
  const groupedPlacement = findSmartWidgetPlacement(320, 200, existing, area)
  assert.equal(groupedPlacement.x, 1008)
  assert.ok(groupedPlacement.y >= existing[0].y + existing[0].height + 16)
})

test('Dock and storage icons share the same launch feedback', () => {
  assert.equal(ICON_LAUNCH_FEEDBACK_MS, 500)
  assert.deepEqual(ICON_LAUNCH_SCALE_KEYFRAMES, [1, 0.82, 1.06, 1])
  assert.equal(ICON_LAUNCH_SCALE_DURATION_SECONDS, 0.38)
  assert.deepEqual(ICON_LAUNCH_SCALE_EASE, [0.28, 0, 0.42, 1])
  assert.equal(ICON_LAUNCH_OVERLAY_INITIAL_OPACITY, 0.7)
  assert.equal(ICON_LAUNCH_OVERLAY_SCALE, 2.6)
  assert.equal(ICON_LAUNCH_OVERLAY_DURATION_SECONDS, 0.48)
  assert.equal(ICON_LAUNCH_OVERLAY_DELAY_SECONDS, 0.15)
  assert.deepEqual(ICON_LAUNCH_OVERLAY_EASE, [0.22, 0, 0.36, 1])
  assert.equal(shouldAnimateDockSystemAction('settings'), true)
  assert.equal(shouldAnimateDockSystemAction('explorer'), true)
  assert.equal(shouldAnimateDockSystemAction('recycle-bin'), true)
  assert.equal(shouldAnimateDockSystemAction('desktop'), false)
})
