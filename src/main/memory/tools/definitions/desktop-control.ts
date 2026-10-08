/**
 * Desktop control for the companion: wallpaper, saved desktop modes, ambient
 * sound, apps, light Windows actions, the desktop pet, reminders and undo.
 * Every tool reuses the main-process path the UI already uses; risky ones are
 * gated by the action policy in the chat service, not by these schemas.
 */
import { promises as fs } from 'fs'
import { basename } from 'path'
import { tool } from 'ai'
import { z } from 'zod'
import type { WallpaperItem } from '@shared/types'
import { PET_EXPRESSION_STATES, WHITE_NOISE_MAX_TIMER_MINUTES, WHITE_NOISE_SOUNDS, WHITE_NOISE_SOUND_LABELS } from '@shared/widget-command'
import { KNOWN_FOLDER_IDS, SETTINGS_PAGE_IDS } from '@shared/system-control'
import {
  REMINDER_KINDS,
  REMINDER_REPEATS,
  describeReminderRepeat,
  formatTimeOfDay,
  parseTimeOfDay,
  resolveFirstReminderTime,
} from '@shared/reminders'
import { imageMediaType } from '@shared/chat-attachments'
import { DEFAULT_WIDGET_SIZE_BY_TYPE } from '@shared/desktop-scene'
import {
  applyWallpaperForTool,
  getWallpaperStateForTool,
  listWallpapersForTool,
  setWallpaperDisplayModeForTool,
  updateWallpaperSettingsForTool,
} from '../../../ipc/wallpaperIpc'
import { addWidgetForTool, listWidgetsForTool, updateWidgetConfigForTool } from '../../../ipc/widgetIpc'
import { getWallpaperResourceCatalog, installWallpaperResource } from '../../../services/wallpaper-resource-service'
import { showMainWindow } from '../../../ipc/appIpc'
import { applyDesktopMode, deleteDesktopMode, listDesktopModes, saveDesktopMode } from '../../desktop/desktopModes'
import { expressPet, hasDesktopPet, sendWidgetCommand } from '../../desktop/petBridge'
import { AppIndex } from '../../desktop/appIndex'
import {
  captureScreen,
  changeVolume,
  isWindows,
  openKnownFolder,
  openSettingsPage,
  pressMediaKey,
  showDesktop,
} from '../../desktop/systemControl'
import { analyzeImage } from '../../desktop/visionAnalyzer'
import { ReminderService } from '../../desktop/reminderService'
import { ActionJournal } from '../../desktop/actionJournal'
import { AttachmentStore } from '../../desktop/attachmentStore'
import type { WorkspaceToolContext } from './workspace-files'

const MAX_ATTACHMENT_TEXT = 60_000

function wallpaperSourceLabel(id: string, meta?: Record<string, unknown>): string {
  if (meta?.Source === 'flowwall') return 'FlowWall'
  if (id.startsWith('remote')) return '在线'
  if (id.startsWith('user')) return '我的'
  if (id.startsWith('local:')) return '本地文件'
  return '内置'
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[\s_\-·.()（）]+/g, '')
}

function wallpaperHaystack(item: WallpaperItem): string {
  const meta = item.meta ? JSON.stringify(item.meta) : ''
  return normalizeSearch(`${item.name} ${item.id} ${meta}`)
}

/** Name / description / tag match, best first. */
function matchWallpapers(items: WallpaperItem[], query?: string, type?: WallpaperItem['type']): WallpaperItem[] {
  const filtered = type ? items.filter((item) => item.type === type) : items
  const terms = (query ?? '').split(/[\s,，、]+/).map(normalizeSearch).filter(Boolean)
  if (terms.length === 0) return filtered
  return filtered
    .map((item) => {
      const name = normalizeSearch(item.name)
      const haystack = wallpaperHaystack(item)
      const score = terms.reduce((sum, term) => sum + (name === term ? 5 : name.includes(term) ? 3 : haystack.includes(term) ? 1 : 0), 0)
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item)
}

function summarizeWallpaper(item: WallpaperItem, currentId?: string) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    source: wallpaperSourceLabel(item.id, item.meta),
    ...(item.id === currentId ? { current: true } : {}),
  }
}

const WALLPAPER_SWITCH_NOTE = '组件是跟着壁纸保存的：换壁纸后桌面会显示这张壁纸自己的组件布局。'

export const wallpaperTool = tool({
  description: '查看、搜索和切换动态壁纸，调整壁纸音量/播放速度/缩放方式，切换多显示器壁纸模式，或从在线壁纸库搜索并安装；flowwall 会在主界面打开 FlowWall 在线壁纸站，用户在页面里点下载后自动加入“我的壁纸”。用户说“换个壁纸/换张安静点的/随便换一张/壁纸声音小一点/在线找个下雨的壁纸/去 FlowWall 逛逛”时使用。切换可以被撤回。',
  inputSchema: z.object({
    action: z.enum(['list', 'current', 'apply', 'random', 'settings', 'display_mode', 'online_search', 'online_install', 'flowwall'])
      .describe('list 搜索本地壁纸；current 当前壁纸；apply 切换到指定壁纸；random 随机换一张；settings 调当前壁纸的音量/速度等；display_mode 多显示器模式；online_search 搜 LavaDesk 官方在线壁纸库；online_install 下载官方在线壁纸（默认装好后直接用）；flowwall 在主界面打开 FlowWall 在线壁纸站让用户挑选下载。'),
    query: z.string().trim().max(80).optional().describe('按名称、描述或标签找壁纸，如“樱花”“雨”。apply/random 时可代替 wallpaperId。'),
    wallpaperId: z.string().trim().max(512).optional().describe('list 返回的壁纸 id。'),
    type: z.enum(['video', 'image', 'web']).optional().describe('只看某种壁纸：video 动态视频、image 静态图片、web 网页。'),
    target: z.enum(['current', 'all']).optional().describe('多显示器时 all 表示每块屏都换成这张。默认 current。'),
    volume: z.number().min(0).max(100).optional().describe('settings：壁纸音量 0-100。'),
    speed: z.number().min(0.1).max(4).optional().describe('settings：视频播放速度 0.1-4。'),
    scaling: z.enum(['覆盖', '填充', '居中', '拉伸', '自由']).optional(),
    flip: z.enum(['无', '水平', '垂直']).optional(),
    mode: z.enum(['primary', 'duplicate', 'per-display', 'span']).optional().describe('display_mode：primary 仅主屏、duplicate 每屏相同、per-display 每屏独立、span 跨屏延展。'),
    resourceId: z.string().trim().max(120).optional().describe('online_install：online_search 返回的 resourceId。'),
    applyAfterInstall: z.boolean().optional().describe('online_install 后是否立即使用，默认 true。'),
  }),
  execute: async (input) => {
    const state = getWallpaperStateForTool()
    const currentId = state.current?.id
    switch (input.action) {
      case 'flowwall': {
        showMainWindow({ activity: 'library', subPage: 'flowwall' })
        return { ok: true, opened: 'FlowWall 在线壁纸站', note: '用户在页面里点下载后，壁纸会自动加入“我的壁纸”，下载完成可以直接应用。' }
      }
      case 'current':
        return {
          ok: true,
          current: state.current ? { ...summarizeWallpaper(state.current, currentId), settings: state.current.settings ?? {} } : null,
          displayMode: state.mode,
        }
      case 'list': {
        const items = matchWallpapers(await listWallpapersForTool(), input.query, input.type)
        return {
          ok: true,
          total: items.length,
          items: items.slice(0, 20).map((item) => summarizeWallpaper(item, currentId)),
          ...(items.length === 0 && input.query ? { hint: '本地没有匹配的壁纸，可以用 online_search 去在线壁纸库找。' } : {}),
        }
      }
      case 'apply':
      case 'random': {
        const catalog = await listWallpapersForTool()
        let target: WallpaperItem | undefined
        if (input.wallpaperId) target = catalog.find((item) => item.id === input.wallpaperId)
        if (!target && input.action === 'apply' && input.query) target = matchWallpapers(catalog, input.query, input.type)[0]
        if (!target && input.action === 'random') {
          const pool = matchWallpapers(catalog, input.query, input.type).filter((item) => item.id !== currentId)
          target = pool[Math.floor(Math.random() * pool.length)]
        }
        if (!target) {
          return { ok: false, error: 'wallpaper-not-found', userMessage: '没找到符合的壁纸。', hint: '先用 list 看看有哪些，或者用 online_search 去在线库找。' }
        }
        if (target.id === currentId && input.target !== 'all') {
          return { ok: true, unchanged: true, applied: summarizeWallpaper(target, currentId) }
        }
        const result = await applyWallpaperForTool(target.id, input.target ?? 'current')
        if (!result.ok) return { ok: false, error: result.error, userMessage: '壁纸没换成功。' }
        return { ok: true, applied: summarizeWallpaper(result.item ?? target), note: WALLPAPER_SWITCH_NOTE }
      }
      case 'settings': {
        const wallpaperId = input.wallpaperId ?? currentId
        if (!wallpaperId) return { ok: false, error: 'no-wallpaper', userMessage: '现在还没有在用的壁纸。' }
        const patch = { volume: input.volume, speed: input.speed, scaling: input.scaling, flip: input.flip }
        if (Object.values(patch).every((value) => value === undefined)) {
          return { ok: false, error: 'nothing-to-change', allowed: ['volume', 'speed', 'scaling', 'flip'] }
        }
        const result = await updateWallpaperSettingsForTool(wallpaperId, patch)
        if (!result.ok) return { ok: false, error: result.error }
        return { ok: true, wallpaperId, applied: Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
      }
      case 'display_mode': {
        if (!input.mode) return { ok: false, error: 'mode-required', allowed: ['primary', 'duplicate', 'per-display', 'span'] }
        const settings = await setWallpaperDisplayModeForTool(input.mode)
        return { ok: true, mode: settings.mode, displayCount: settings.displays.length }
      }
      case 'online_search': {
        const catalog = await getWallpaperResourceCatalog(false)
        const terms = (input.query ?? '').split(/[\s,，、]+/).map(normalizeSearch).filter(Boolean)
        const items = catalog.items
          .filter((item) => !input.type || item.type === input.type)
          .filter((item) => terms.length === 0 || terms.some((term) => normalizeSearch(`${item.title} ${item.description ?? ''} ${(item.tags ?? []).join(' ')}`).includes(term)))
        return {
          ok: catalog.items.length > 0,
          source: catalog.source,
          ...(catalog.warning ? { warning: catalog.warning } : {}),
          items: items.slice(0, 12).map((item) => ({
            resourceId: item.id,
            title: item.title,
            type: item.type,
            sizeMB: Math.round(item.size / 1024 / 1024 * 10) / 10,
            installed: item.installState === 'installed' || item.installState === 'update-available',
            ...(item.localWallpaperId ? { wallpaperId: item.localWallpaperId } : {}),
          })),
          ...(catalog.items.length === 0 ? { userMessage: '在线壁纸库暂时连不上。' } : {}),
        }
      }
      case 'online_install': {
        if (!input.resourceId) return { ok: false, error: 'resourceId-required', hint: '先用 online_search 找到 resourceId。' }
        const installed = await installWallpaperResource(input.resourceId)
        if (!installed.ok || !installed.item) return { ok: false, error: installed.error, userMessage: '在线壁纸下载没成功。' }
        if (input.applyAfterInstall === false) return { ok: true, installed: summarizeWallpaper(installed.item) }
        const applied = await applyWallpaperForTool(installed.item.id, input.target ?? 'current')
        return applied.ok
          ? { ok: true, installed: summarizeWallpaper(installed.item), applied: true, note: WALLPAPER_SWITCH_NOTE }
          : { ok: true, installed: summarizeWallpaper(installed.item), applied: false, error: applied.error }
      }
    }
  },
})

export const desktopModeTool = tool({
  description: '保存和切换用户自己的桌面模式（当前壁纸 + 这张壁纸上的组件布局）。用户说“把现在的桌面存成工作模式”“切到工作模式”“我有哪些桌面模式”时使用。内置的极简/夜间专注/音乐氛围草案用 desktop_scene 工具。切换可撤回。',
  inputSchema: z.object({
    action: z.enum(['list', 'save', 'apply', 'delete']),
    name: z.string().trim().max(24).optional().describe('模式名称，如“工作”“摸鱼”“睡前”。apply/delete 也可以传 list 返回的 id。'),
  }),
  execute: async ({ action, name }) => {
    if (action === 'list') return { ok: true, modes: listDesktopModes() }
    if (!name) return { ok: false, error: 'name-required', modes: listDesktopModes().map((mode) => mode.name) }
    if (action === 'save') {
      const result = saveDesktopMode(name)
      return result.ok
        ? { ok: true, saved: result.mode?.name, replaced: result.replaced, widgetCount: result.mode?.widgets.length, wallpaper: result.mode?.wallpaperName }
        : { ok: false, error: result.error }
    }
    if (action === 'delete') {
      return deleteDesktopMode(name) ? { ok: true, deleted: name } : { ok: false, error: 'mode-not-found', modes: listDesktopModes().map((mode) => mode.name) }
    }
    const result = await applyDesktopMode(name)
    if (!result.ok) {
      return { ok: false, error: result.error, userMessage: result.error === 'mode-not-found' ? `没有叫「${name}」的桌面模式。` : result.error, modes: listDesktopModes().map((mode) => mode.name) }
    }
    return { ok: true, applied: result.mode?.name, wallpaperChanged: result.wallpaperChanged }
  },
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const ambientSoundTool = tool({
  description: '播放或暂停桌面白噪音（雨声、海浪、咖啡馆、壁炉等），可调音量档位，可定时关闭。用户说“放点雨声”“来点白噪音”“放 30 分钟雨声助眠”“把白噪音关了”时使用。桌面上没有白噪音组件时会自动放一个。',
  inputSchema: z.object({
    action: z.enum(['play', 'pause']),
    sound: z.enum(WHITE_NOISE_SOUNDS).optional().describe(`声音：${WHITE_NOISE_SOUNDS.map((id) => `${id}=${WHITE_NOISE_SOUND_LABELS[id]}`).join('，')}`),
    volumeLevel: z.number().int().min(1).max(3).optional().describe('音量档位 1 小、2 中、3 大。'),
    minutes: z.number().int().min(0).max(WHITE_NOISE_MAX_TIMER_MINUTES).optional().describe('多少分钟后渐弱并自动停止（助眠/专注计时）；0 表示取消定时。用户没提时间就不要填。'),
  }),
  execute: async ({ action, sound, volumeLevel, minutes }) => {
    let widget = listWidgetsForTool().find((item) => item.type === 'whitenoise')
    let addedWidget = false
    if (!widget) {
      if (action === 'pause') return { ok: true, unchanged: true, note: '桌面上没有在放的白噪音。' }
      const size = DEFAULT_WIDGET_SIZE_BY_TYPE.whitenoise
      const added = addWidgetForTool({
        id: `whitenoise-${Date.now()}`,
        type: 'whitenoise',
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        enabled: true,
        config: volumeLevel ? { volume: volumeLevel } : {},
      }, { anchor: 'bottom-left' })
      widget = added.widget
      addedWidget = true
      // Give the canvas a moment to mount the new widget before it receives the command.
      await delay(1200)
    } else if (!widget.enabled) {
      return { ok: false, error: 'widget-hidden', userMessage: '白噪音组件现在是隐藏的。', hint: '先用 arrange_widget(visible=true) 恢复显示再播放。' }
    } else if (volumeLevel) {
      updateWidgetConfigForTool({ id: widget.id, config: { volume: volumeLevel } })
    }
    const sent = sendWidgetCommand(action === 'play'
      ? { target: 'whitenoise', command: 'play', sound, volumeLevel, minutes }
      : { target: 'whitenoise', command: 'pause' })
    if (!sent) return { ok: false, error: 'canvas-unavailable', userMessage: '桌面组件层暂时没响应。' }
    return {
      ok: true,
      action,
      ...(sound ? { sound: WHITE_NOISE_SOUND_LABELS[sound] } : {}),
      ...(action === 'play' && minutes ? { stopsInMinutes: minutes } : {}),
      addedWidget,
    }
  },
})

export const appControlTool = tool({
  description: '在用户电脑上查找并打开应用（开始菜单、桌面快捷方式、Dock/图标收纳里的应用，以及记事本、计算器等系统工具）；应用已经开着时会切到前台。用户说“打开微信”“帮我开一下网易云”时使用。打开前系统会向用户确认，不要自己再追问一遍。',
  inputSchema: z.object({
    action: z.enum(['search', 'open']),
    query: z.string().trim().max(60).optional().describe('应用名称，如“微信”“Chrome”“记事本”。'),
    appId: z.string().trim().max(64).optional().describe('search 返回的 appId，比名字更准确。'),
  }),
  execute: async ({ action, query, appId }) => {
    if (!AppIndex.supported()) return { ok: false, error: 'unsupported-platform', userMessage: '打开应用目前只支持 Windows。' }
    if (action === 'search') {
      if (!query) return { ok: false, error: 'query-required' }
      const results = await AppIndex.search(query, 6)
      return { ok: true, results: results.map((entry) => ({ appId: entry.id, name: entry.name, source: entry.source })) }
    }
    const entry = await AppIndex.resolve({ appId, query })
    if (!entry) {
      const similar = query ? await AppIndex.search(query.slice(0, 2), 4) : []
      return {
        ok: false,
        error: 'app-not-found',
        userMessage: `没在开始菜单、桌面和 Dock 里找到「${query ?? appId}」。`,
        ...(similar.length ? { similar: similar.map((item) => item.name) } : {}),
      }
    }
    const result = await AppIndex.launch(entry)
    if (!result.ok) return { ok: false, app: entry.name, error: result.error, userMessage: `「${entry.name}」没能打开。` }
    return { ok: true, app: entry.name, activatedExisting: result.activatedExisting === true }
  },
})

export const systemControlTool = tool({
  description: '轻量 Windows 操作：显示桌面（最小化所有窗口/再按一次恢复）、打开指定的系统设置页、打开常用文件夹、调节系统音量或静音、控制媒体播放（播放暂停/上一首/下一首）、截屏（可让你看图回答问题）。截屏前系统会向用户确认。',
  inputSchema: z.object({
    action: z.enum(['show_desktop', 'open_settings', 'open_folder', 'volume', 'media', 'screenshot']),
    page: z.enum(SETTINGS_PAGE_IDS as [string, ...string[]]).optional().describe('open_settings 的页面：display 显示、sound 声音、bluetooth 蓝牙、wifi、network、power 电源、battery、notifications 通知、focus 专注助手、night_light 夜间模式、background 系统背景、colors 深浅色、taskbar、apps、default_apps、startup_apps、storage、mouse、keyboard、language、date_time、privacy、location、windows_update、about、home。'),
    folder: z.enum(KNOWN_FOLDER_IDS as [string, ...string[]]).optional().describe('open_folder：desktop、downloads、documents、pictures、music、videos、home、screenshots（灵月截图）、recycle_bin。'),
    direction: z.enum(['up', 'down', 'mute']).optional().describe('volume：up 调大、down 调小、mute 静音/取消静音。'),
    percent: z.number().min(2).max(60).optional().describe('volume：调整幅度（百分比），默认 10。无法读取当前音量，只能相对调整。'),
    key: z.enum(['play_pause', 'next', 'previous', 'stop']).optional().describe('media：媒体键。'),
    analyze: z.boolean().optional().describe('screenshot：截完后要不要看图（回答用户关于屏幕内容的问题时设为 true）。'),
    question: z.string().trim().max(300).optional().describe('screenshot + analyze：想从截图里了解什么。'),
    allDisplays: z.boolean().optional().describe('screenshot：是否截所有显示器，默认只截主屏。'),
  }),
  execute: async (input) => {
    const needsWindows = input.action === 'show_desktop' || input.action === 'volume' || input.action === 'media' || input.action === 'open_settings'
    if (needsWindows && !isWindows()) return { ok: false, error: 'unsupported-platform', userMessage: '这个操作目前只支持 Windows。' }
    switch (input.action) {
      case 'show_desktop':
        return showDesktop() ? { ok: true, note: '再执行一次可以把窗口恢复回来。' } : { ok: false, error: 'send-input-failed' }
      case 'open_settings': {
        if (!input.page) return { ok: false, error: 'page-required', allowed: SETTINGS_PAGE_IDS }
        const result = await openSettingsPage(input.page as (typeof SETTINGS_PAGE_IDS)[number])
        return result.ok ? { ok: true, opened: result.label } : { ok: false, error: result.error, userMessage: `${result.label}没打开。` }
      }
      case 'open_folder': {
        if (!input.folder) return { ok: false, error: 'folder-required', allowed: KNOWN_FOLDER_IDS }
        const result = await openKnownFolder(input.folder as (typeof KNOWN_FOLDER_IDS)[number])
        return result.ok ? { ok: true, opened: result.label } : { ok: false, error: result.error, userMessage: `${result.label}文件夹没打开。` }
      }
      case 'volume': {
        const direction = input.direction ?? 'up'
        const result = changeVolume(direction, input.percent ?? 10)
        return result.ok
          ? { ok: true, direction, ...(direction === 'mute' ? { note: '静音键是开关，再按一次会取消静音。' } : { changedPercent: result.presses * 2 }) }
          : { ok: false, error: 'send-input-failed' }
      }
      case 'media': {
        const key = input.key ?? 'play_pause'
        return pressMediaKey(key) ? { ok: true, key } : { ok: false, error: 'send-input-failed' }
      }
      case 'screenshot': {
        const shot = await captureScreen({ allDisplays: input.allDisplays })
        if (!shot.ok) return { ok: false, error: shot.error, userMessage: '截图没成功。' }
        const files = shot.files.map((file) => basename(file))
        if (!input.analyze) return { ok: true, files, folder: '图片/灵月截图' }
        const analysis = await analyzeImage(shot.images[0], 'image/png', input.question)
        return {
          ok: true,
          files,
          folder: '图片/灵月截图',
          analysis: analysis.ok ? { method: analysis.method === 'vision' ? '看图' : '文字识别', text: analysis.text } : undefined,
          ...(analysis.ok ? {} : { analysisError: analysis.error }),
        }
      }
    }
  },
})

export const petExpressTool = tool({
  description: '让桌面上的像素桌宠做一个表情/动作，可附带一句气泡台词。适合在安慰、庆祝、提醒、打招呼等时刻配合回复使用，不要每句话都用。',
  inputSchema: z.object({
    state: z.enum(PET_EXPRESSION_STATES).optional().describe('joy 开心、delight 愉快、surprise 惊讶、sorrow 难过、anger 生气、thinking 思考、inspiration 灵感、confused 困惑、speaking 说话、sleepy 睡觉、jump 跳跃、music 听音乐、reading 读书、charging 充电等。'),
    message: z.string().trim().max(60).optional().describe('气泡里显示的一句短台词。'),
    durationSec: z.number().min(2).max(60).optional().describe('持续秒数，默认 6。'),
  }),
  execute: async ({ state, message, durationSec }) => {
    if (!hasDesktopPet()) {
      return { ok: false, error: 'pet-not-on-desktop', userMessage: '桌面上还没有桌宠。', hint: '用户想要的话可以用 add_widget(type=pet) 放一个。' }
    }
    if (!state && !message) return { ok: false, error: 'state-or-message-required' }
    const sent = expressPet({ state, message, durationMs: (durationSec ?? 6) * 1000 })
    return sent ? { ok: true, ...(state ? { state } : {}), ...(message ? { message } : {}) } : { ok: false, error: 'canvas-unavailable' }
  },
})

function describeReminder(reminder: { id: string; text: string; kind: string; nextAt: number; repeat: string; intervalMinutes?: number; timeOfDay?: string }) {
  return {
    reminderId: reminder.id,
    text: reminder.text,
    kind: reminder.kind,
    next: new Date(reminder.nextAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    repeat: describeReminderRepeat(reminder as Parameters<typeof describeReminderRepeat>[0]),
  }
}

export function createDesktopTools(context: WorkspaceToolContext) {
  return {
    reminder: tool({
      description: '设置、查看和取消提醒：一次性提醒（“20 分钟后提醒我喝水”“明早 8 点叫我开会”），重复提醒（每天/工作日/每周/每隔 N 分钟），天气早报（kind=weather-brief）和久坐休息提醒（kind=break）。也可以设置安静时段（期间主动类提醒不打扰）。到点会弹系统通知并让桌宠提醒。',
      inputSchema: z.object({
        action: z.enum(['create', 'list', 'cancel', 'quiet_hours']),
        text: z.string().trim().max(200).optional().describe('提醒内容，用用户的话，如“喝水”“给妈妈打电话”。'),
        at: z.string().trim().max(40).optional().describe('时间：HH:mm（下一个这个时间点）、YYYY-MM-DD HH:mm 或 ISO 时间。'),
        inMinutes: z.number().min(1).max(60 * 24 * 7).optional().describe('多少分钟后提醒，优先于 at。'),
        repeat: z.enum(REMINDER_REPEATS).optional().describe('none 一次、daily 每天、weekdays 工作日、weekly 每周、interval 每隔 intervalMinutes 分钟。'),
        intervalMinutes: z.number().min(5).max(24 * 60).optional(),
        kind: z.enum(REMINDER_KINDS).optional().describe('text 普通提醒；weather-brief 到点先查天气再播报；break 休息提醒。'),
        reminderId: z.string().trim().max(40).optional().describe('cancel：list 返回的 reminderId。'),
        quietEnabled: z.boolean().optional().describe('quiet_hours：开启或关闭安静时段。'),
        quietStart: z.string().trim().max(5).optional().describe('quiet_hours：开始时间 HH:mm。'),
        quietEnd: z.string().trim().max(5).optional().describe('quiet_hours：结束时间 HH:mm。'),
      }),
      execute: async (input) => {
        if (input.action === 'list') {
          return { ok: true, reminders: ReminderService.list().map(describeReminder), quietHours: ReminderService.getQuietHours() }
        }
        if (input.action === 'cancel') {
          const target = input.reminderId
            ? ReminderService.list().find((item) => item.id === input.reminderId)
            : input.text ? ReminderService.list().find((item) => item.text.includes(input.text!)) : undefined
          if (!target) return { ok: false, error: 'reminder-not-found', reminders: ReminderService.list().map(describeReminder) }
          ReminderService.cancel(target.id)
          return { ok: true, cancelled: describeReminder(target) }
        }
        if (input.action === 'quiet_hours') {
          const current = ReminderService.getQuietHours()
          if ((input.quietStart && !parseTimeOfDay(input.quietStart)) || (input.quietEnd && !parseTimeOfDay(input.quietEnd))) {
            return { ok: false, error: 'invalid-time', hint: '时间格式是 HH:mm，比如 23:00。' }
          }
          const quietHours = ReminderService.setQuietHours({
            enabled: input.quietEnabled ?? true,
            start: input.quietStart ?? current.start,
            end: input.quietEnd ?? current.end,
          })
          return { ok: true, quietHours }
        }
        const repeat = input.repeat ?? 'none'
        const kind = input.kind ?? 'text'
        const now = Date.now()
        let firstAt = resolveFirstReminderTime({ at: input.at, inMinutes: input.inMinutes, now })
        if (firstAt == null && repeat === 'interval') firstAt = now + (input.intervalMinutes ?? 60) * 60_000
        if (firstAt == null) return { ok: false, error: 'time-required', hint: '需要提醒时间：at（HH:mm 或日期时间）或 inMinutes。' }
        if (firstAt <= now) return { ok: false, error: 'time-in-past', hint: '这个时间已经过去了。' }
        if (!input.text && kind === 'text') return { ok: false, error: 'text-required' }
        const created = ReminderService.create({
          text: input.text ?? '',
          kind,
          repeat,
          firstAt,
          intervalMinutes: input.intervalMinutes,
          timeOfDay: repeat === 'daily' || repeat === 'weekdays' || repeat === 'weekly' ? formatTimeOfDay(firstAt) : undefined,
          conversationId: context.threadId ?? null,
        })
        if (!created.ok) return { ok: false, error: created.error }
        return {
          ok: true,
          reminder: describeReminder(created.reminder),
          undo: { kind: 'reminder-cancel', reminderId: created.reminder.id },
        }
      },
    }),

    undo_last_action: tool({
      description: '撤回刚才的桌面操作（添加/移动/隐藏组件、换壁纸、切换桌面模式、设置提醒等）。用户说“撤回”“换回去”“刚才那个不要了”“恢复原样”时使用。默认撤回最近一步；scope=turn 撤回上一轮对话里做的所有桌面操作；也可以传最近操作记录里的 journalId。',
      inputSchema: z.object({
        journalId: z.string().trim().max(20).optional().describe('【最近的桌面操作】里方括号中的 id。'),
        scope: z.enum(['last', 'turn']).optional(),
      }),
      execute: async ({ journalId, scope }) => {
        const conversationId = context.threadId ?? null
        if (journalId) {
          const result = await ActionJournal.undo(journalId)
          return result.ok
            ? { ok: true, undone: [result.entry?.summary] }
            : { ok: false, error: result.error, userMessage: result.error }
        }
        const result = await ActionJournal.undoLatest({ conversationId, scope: scope ?? 'last' })
        return result.undone.length > 0
          ? { ok: true, undone: result.undone.map((entry) => entry.summary), ...(result.error ? { partialError: result.error } : {}) }
          : { ok: false, error: result.error, userMessage: result.error }
      },
    }),

    read_attachment: tool({
      description: '读取用户在本次对话里添加的附件：文本/代码、PDF、Word、Excel 取文字内容；图片会看图描述（模型不支持看图时做文字识别）。只能读用户附加的文件。',
      inputSchema: z.object({
        attachmentId: z.string().trim().max(40).describe('附件 id（在用户消息的附件列表里）。'),
        question: z.string().trim().max(300).optional().describe('图片附件：想从图里了解什么。'),
      }),
      execute: async ({ attachmentId, question }) => {
        const grant = AttachmentStore.get(attachmentId)
        if (!grant || (grant.conversationId && context.threadId && grant.conversationId !== context.threadId)) {
          return { ok: false, error: 'attachment-not-found', userMessage: '这个附件已经失效了，重新添加一次就好。' }
        }
        try {
          if (grant.kind === 'image') {
            const analysis = await analyzeImage(await fs.readFile(grant.path), imageMediaType(grant.name), question)
            return analysis.ok
              ? { ok: true, name: grant.name, method: analysis.method === 'vision' ? '看图' : '文字识别', text: analysis.text }
              : { ok: false, name: grant.name, error: analysis.error }
          }
          if (grant.kind === 'text') {
            const text = await fs.readFile(grant.path, 'utf8')
            return { ok: true, name: grant.name, text: text.slice(0, MAX_ATTACHMENT_TEXT), truncated: text.length > MAX_ATTACHMENT_TEXT }
          }
          if (grant.kind === 'pdf') {
            const { PDFParse } = await import('pdf-parse')
            const parser = new PDFParse({ data: new Uint8Array(await fs.readFile(grant.path)) })
            try {
              const result = await parser.getText()
              return { ok: true, name: grant.name, pages: result.total, text: result.text.slice(0, MAX_ATTACHMENT_TEXT), truncated: result.text.length > MAX_ATTACHMENT_TEXT }
            } finally {
              await parser.destroy()
            }
          }
          if (grant.kind === 'docx') {
            const mammoth = await import('mammoth')
            const result = await mammoth.extractRawText({ buffer: await fs.readFile(grant.path) })
            return { ok: true, name: grant.name, text: result.value.slice(0, MAX_ATTACHMENT_TEXT), truncated: result.value.length > MAX_ATTACHMENT_TEXT }
          }
          if (grant.kind === 'xlsx') {
            const ExcelJS = await import('exceljs')
            const workbook = new ExcelJS.Workbook()
            await workbook.xlsx.readFile(grant.path)
            const sheets = workbook.worksheets.slice(0, 5).map((sheet) => {
              const rows: unknown[][] = []
              sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber > 200) return
                const values = Array.isArray(row.values) ? row.values.slice(1, 51) : []
                rows.push(values.map((value) => (value && typeof value === 'object' && 'text' in value ? (value as { text: unknown }).text : value)))
              })
              return { name: sheet.name, rows }
            })
            return { ok: true, name: grant.name, sheets }
          }
          return { ok: false, name: grant.name, error: 'unsupported-type', userMessage: '这种文件我还读不了。' }
        } catch (error) {
          return { ok: false, name: grant.name, error: (error as Error).message, userMessage: '附件没读出来。' }
        }
      },
    }),
  }
}
