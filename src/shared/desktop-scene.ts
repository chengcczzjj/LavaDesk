import type { WidgetInstance, WallpaperSettings } from './types'

export const WIDGET_TYPES = [
  'clock',
  'elegantclock',
  'pixelclock',
  'graphicdatetime',
  'audio',
  'weather',
  'whitenoise',
  'text',
  'stocks',
  'news',
  'calendar',
  'quicktools',
  'pet',
  'sysmonitor',
  'generated-widget',
  'desktop-icons-box',
  'desktop-icons-horizontal',
  'desktop-icons-adaptive',
  'desktop-icons-dock',
] as const

export type WidgetTypeId = typeof WIDGET_TYPES[number]

export type DesktopAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type WidgetLayer = 'persistent' | 'ambient' | 'information' | 'companion'
export type DesktopSceneDensity = 'minimal' | 'balanced' | 'dense'
export type DesktopAestheticStyle = 'minimal' | 'soft' | 'neon' | 'pixel' | 'workbench' | 'poster'
export type DesktopRiskLevel = 'low' | 'medium' | 'high'
export type WidgetMaterial = 'text-only' | 'glass' | 'neon' | 'pixel' | 'card' | 'paper'
export type WidgetVisualWeight = 'quiet' | 'normal' | 'strong'
export type WallpaperContrastMode = 'auto' | 'light-on-dark' | 'dark-on-light'

export type WidgetOperation =
  | 'create'
  | 'update-layout'
  | 'update-config'
  | 'set-preset'
  | 'set-opacity'
  | 'set-theme'
  | 'hide'
  | 'restore'
  | 'remove'
  | 'refresh'
  | 'play'
  | 'pause'

export interface DesktopSize {
  width: number
  height: number
}

export interface WidgetPreset {
  id: string
  label: string
  intent?: string[]
  config?: Record<string, unknown>
}

export interface WidgetAestheticHints {
  visualWeight: WidgetVisualWeight
  material: WidgetMaterial
  maxDefaultInstances: number
  canBeHero: boolean
  shouldGroupWith?: WidgetTypeId[]
  wallpaperContrast: WallpaperContrastMode
}

export interface WidgetLayoutHints {
  preferredAnchors: DesktopAnchor[]
  avoidAnchors?: DesktopAnchor[]
  avoidCenter: boolean
  reserveEdge?: 'top' | 'right' | 'bottom' | 'left'
}

export interface WidgetCapability {
  type: WidgetTypeId
  displayName: string
  layer: WidgetLayer
  role: string
  intents: string[]
  defaultSize: DesktopSize
  minSize?: DesktopSize
  maxSize?: DesktopSize
  allowMultiple: boolean
  persistent: boolean
  canAutoHide: boolean
  aesthetics: WidgetAestheticHints
  /** Editable settings live in widget-config-spec.ts (validated against the real widgets). */
  presets: WidgetPreset[]
  layoutHints: WidgetLayoutHints
  allowedOps: WidgetOperation[]
  risk: DesktopRiskLevel
}

export interface SceneWidgetRule {
  type: WidgetTypeId
  preset?: string
  anchor: DesktopAnchor
  required?: boolean
  attachTo?: WidgetTypeId
  requiresConfirm?: boolean
}

export interface DesktopSceneTemplate {
  id: string
  displayName: string
  description: string
  intents: string[]
  moodTags: string[]
  density: DesktopSceneDensity
  aestheticStyle: DesktopAestheticStyle
  maxVisibleWidgets: number
  heroWidget?: WidgetTypeId
  wallpaperPreference?: string[]
  keepPersistentLayer: true
  widgets: SceneWidgetRule[]
  hiddenWidgetLayers?: WidgetLayer[]
  petState?: string
}

export interface LayoutPatch {
  anchor?: DesktopAnchor
  x?: number
  y?: number
  width?: number
  height?: number
  opacity?: number
}

export type WidgetPatch =
  | { op: 'create'; type: WidgetTypeId; preset?: string; layout: LayoutPatch; config?: Record<string, unknown> }
  | { op: 'update-layout'; id: string; layout: LayoutPatch }
  | { op: 'update-config'; id: string; config: Record<string, unknown> }
  | { op: 'hide'; id: string; reason: string }
  | { op: 'restore'; id: string }
  | { op: 'remove'; id: string; requiresConfirmation: true }

export interface WallpaperPatch {
  wallpaperId?: string
  settings?: WallpaperSettings
}

export interface PetPatch {
  state?: string
  line?: string
}

export interface DesktopSceneRisk {
  id: string
  level: DesktopRiskLevel
  label: string
  reason: string
  requiresConfirmation: boolean
}

export interface DesktopSceneDraft {
  id: string
  title: string
  userRequest: string
  sceneId: string
  summary: string
  aestheticSummary: string
  visualPlan: {
    style: DesktopAestheticStyle
    heroWidget?: WidgetTypeId
    preservedEmptyAreas: string[]
    colorStrategy: string
    motionStyle: string
  }
  wallpaperChange?: WallpaperPatch
  widgetPatches: WidgetPatch[]
  petPatch?: PetPatch
  risks: DesktopSceneRisk[]
  requiresConfirmation: boolean
  rollbackLabel: string
}

export interface DesktopSceneSnapshot {
  id: string
  createdAt: number
  wallpaperId: string
  reason: string
  source: 'user' | 'ai-scene'
  beforeWidgets: WidgetInstance[]
  afterWidgets?: WidgetInstance[]
  beforeWallpaperSettings?: WallpaperSettings
  afterWallpaperSettings?: WallpaperSettings
}

export interface WallpaperLayoutArea {
  id: string
  anchor?: DesktopAnchor
  rect: [number, number, number, number]
  reason?: string
}

export interface WallpaperLayoutMetadata {
  version: 1
  wallpaperId: string
  moodTags: string[]
  dominantTone: 'dark' | 'light' | 'mixed'
  composition: 'center-subject' | 'side-subject' | 'landscape' | 'poster' | 'abstract'
  palette?: {
    primary?: string
    secondary?: string
    textOnDark?: string
    textOnLight?: string
  }
  safeAreas: WallpaperLayoutArea[]
  avoidAreas: WallpaperLayoutArea[]
  recommendedWidgets: WidgetTypeId[]
  aestheticHints?: {
    preferredMaterials?: WidgetMaterial[]
    maxVisibleWidgets?: number
    avoidCardWidgets?: boolean
  }
  defaultScene?: string
}

export const DEFAULT_WIDGET_SIZE_BY_TYPE: Record<WidgetTypeId, DesktopSize> = {
  clock: { width: 0, height: 0 },
  elegantclock: { width: 0, height: 0 },
  pixelclock: { width: 0, height: 0 },
  graphicdatetime: { width: 0, height: 0 },
  audio: { width: 400, height: 160 },
  weather: { width: 0, height: 0 },
  whitenoise: { width: 0, height: 0 },
  text: { width: 0, height: 0 },
  stocks: { width: 336, height: 336 },
  news: { width: 160, height: 336 },
  calendar: { width: 160, height: 160 },
  quicktools: { width: 336, height: 160 },
  pet: { width: 160, height: 160 },
  sysmonitor: { width: 336, height: 160 },
  'generated-widget': { width: 360, height: 260 },
  'desktop-icons-box': { width: 246, height: 344 },
  'desktop-icons-horizontal': { width: 356, height: 242 },
  'desktop-icons-adaptive': { width: 246, height: 242 },
  'desktop-icons-dock': { width: 340, height: 88 },
}

const LOW_RISK_DECORATION_OPS: WidgetOperation[] = [
  'create',
  'update-layout',
  'update-config',
  'set-preset',
  'set-opacity',
  'set-theme',
  'hide',
  'restore',
]

const CARD_OPS: WidgetOperation[] = ['create', 'update-layout', 'update-config', 'refresh', 'hide', 'restore']
const PERSISTENT_OPS: WidgetOperation[] = ['update-layout', 'update-config', 'set-opacity', 'set-theme']

export const WIDGET_CAPABILITIES: WidgetCapability[] = [
  {
    type: 'clock',
    displayName: '时间',
    layer: 'ambient',
    role: '桌面时间锚点',
    intents: ['time', 'minimal', 'focus', 'daily'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.clock,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'text-only', maxDefaultInstances: 1, canBeHero: true, shouldGroupWith: ['weather'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'minimal-light', label: '轻时间', intent: ['minimal'], config: { style: 'minimal', opacity: 0.85 } },
      { id: 'elegant-focus', label: '竖排专注时间', intent: ['focus'], config: { style: 'stacked', opacity: 0.9 } },
    ],
    layoutHints: { preferredAnchors: ['top-left', 'top-right'], avoidCenter: true },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'elegantclock',
    displayName: '日期时钟',
    layer: 'ambient',
    role: '优雅日期与时间组合',
    intents: ['time', 'poster', 'soft', 'focus'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.elegantclock,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'text-only', maxDefaultInstances: 1, canBeHero: true, shouldGroupWith: ['weather'], wallpaperContrast: 'auto' },
    presets: [{ id: 'soft-date', label: '柔和日期', intent: ['soft', 'focus'] }],
    layoutHints: { preferredAnchors: ['top-left', 'top-right', 'bottom-left'], avoidCenter: true },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'pixelclock',
    displayName: '像素时钟',
    layer: 'ambient',
    role: '像素风时间装饰',
    intents: ['time', 'pixel', 'game'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.pixelclock,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'pixel', maxDefaultInstances: 1, canBeHero: true, shouldGroupWith: ['pet'], wallpaperContrast: 'auto' },
    presets: [{ id: 'retro-pixel', label: '复古像素周历', intent: ['pixel', 'game'], config: { style: 'weekday' } }],
    layoutHints: { preferredAnchors: ['top-left', 'bottom-left'], avoidCenter: true },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'graphicdatetime',
    displayName: '图形时间',
    layer: 'ambient',
    role: '海报式日期时间主视觉',
    intents: ['time', 'poster', 'minimal', 'focus', 'night'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.graphicdatetime,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'strong', material: 'text-only', maxDefaultInstances: 1, canBeHero: true, shouldGroupWith: ['weather'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'quiet-date', label: '安静图形时间', intent: ['night', 'focus'], config: { themeId: 'yellow', darkMode: true } },
      { id: 'poster-date', label: '海报图形时间', intent: ['poster'], config: { darkMode: false } },
    ],
    layoutHints: { preferredAnchors: ['top-left', 'top-right', 'bottom-left'], avoidCenter: true },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'audio',
    displayName: '音频可视化',
    layer: 'ambient',
    role: '音乐与氛围主视觉',
    intents: ['music', 'ambient', 'neon', 'showcase'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.audio,
    minSize: { width: 280, height: 96 },
    maxSize: { width: 900, height: 260 },
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'strong', material: 'neon', maxDefaultInstances: 1, canBeHero: true, shouldGroupWith: ['clock'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'soft-wave', label: '柔和波形', intent: ['ambient'], config: { style: 'wave', opacity: 0.78 } },
      { id: 'neon-bars', label: '霓虹频谱', intent: ['music', 'neon'], config: { style: 'bars', opacity: 0.9 } },
    ],
    layoutHints: { preferredAnchors: ['bottom-center', 'bottom-left', 'bottom-right'], avoidCenter: true, reserveEdge: 'bottom' },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'weather',
    displayName: '天气',
    layer: 'ambient',
    role: '轻量天气状态',
    intents: ['weather', 'daily', 'minimal', 'focus'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.weather,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'quiet', material: 'text-only', maxDefaultInstances: 1, canBeHero: false, shouldGroupWith: ['clock', 'graphicdatetime'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'minimal', label: '极简天气', intent: ['minimal', 'focus'], config: { style: 'minimal' } },
      { id: 'soft-glass', label: '轻毛玻璃天气', intent: ['daily'], config: { style: 'glass' } },
    ],
    layoutHints: { preferredAnchors: ['top-left', 'top-right'], avoidCenter: true },
    allowedOps: [...LOW_RISK_DECORATION_OPS, 'refresh'],
    risk: 'low',
  },
  {
    type: 'whitenoise',
    displayName: '白噪音',
    layer: 'ambient',
    role: '休息与专注声音控制',
    intents: ['focus', 'rest', 'night', 'noise'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.whitenoise,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'quiet', material: 'glass', maxDefaultInstances: 1, canBeHero: false, shouldGroupWith: ['text'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'rain-low', label: '小音量深色', intent: ['focus', 'night'], config: { style: 'glass', volume: 1, darkMode: true } },
      { id: 'coffee-soft', label: '轻量浅色', intent: ['rest'], config: { style: 'minimal', volume: 1 } },
    ],
    layoutHints: { preferredAnchors: ['bottom-right', 'bottom-left'], avoidCenter: true },
    allowedOps: [...LOW_RISK_DECORATION_OPS, 'play', 'pause'],
    risk: 'medium',
  },
  {
    type: 'text',
    displayName: '桌面文字',
    layer: 'ambient',
    role: '桌面短句、便签和轻提醒',
    intents: ['note', 'text', 'todo', 'focus', 'mood'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.text,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'quiet', material: 'text-only', maxDefaultInstances: 1, canBeHero: false, shouldGroupWith: ['whitenoise'], wallpaperContrast: 'auto' },
    presets: [
      { id: 'focus-line', label: '专注短句', intent: ['focus'], config: { text: '今晚只做一件事' } },
      { id: 'soft-note', label: '轻便签', intent: ['note'], config: { text: '别忘了休息一下' } },
    ],
    layoutHints: { preferredAnchors: ['bottom-left', 'bottom-right', 'top-left'], avoidCenter: true },
    allowedOps: LOW_RISK_DECORATION_OPS,
    risk: 'low',
  },
  {
    type: 'stocks',
    displayName: '自选股',
    layer: 'information',
    role: '看盘信息卡片',
    intents: ['stocks', 'market', 'work'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.stocks,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'strong', material: 'card', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'compact-market', label: '紧凑看盘', intent: ['market'] }],
    layoutHints: { preferredAnchors: ['center-right', 'top-right'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'medium',
  },
  {
    type: 'news',
    displayName: '新闻',
    layer: 'information',
    role: '热点资讯卡片',
    intents: ['news', 'information', 'daily'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.news,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'card', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'light-hotlist', label: '轻热点', intent: ['information'], config: { source: 'toutiao', maxItems: 5 } }],
    layoutHints: { preferredAnchors: ['top-right', 'center-right'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'medium',
  },
  {
    type: 'calendar',
    displayName: '日历',
    layer: 'information',
    role: '日期与计划卡片',
    intents: ['calendar', 'work', 'plan'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.calendar,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'card', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'small-calendar', label: '小日历', intent: ['plan'] }],
    layoutHints: { preferredAnchors: ['top-right', 'bottom-right'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'medium',
  },
  {
    type: 'quicktools',
    displayName: '快捷工具',
    layer: 'information',
    role: '轻工具入口',
    intents: ['tools', 'shortcut'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.quicktools,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'card', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'basic-tools', label: '基础工具', intent: ['tools'] }],
    layoutHints: { preferredAnchors: ['bottom-right'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'medium',
  },
  {
    type: 'pet',
    displayName: '桌面萌宠',
    layer: 'companion',
    role: '桌宠状态展示',
    intents: ['pet', 'companion', 'emotion'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.pet,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'pixel', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'companion-idle', label: '安静陪伴', intent: ['companion'] }],
    layoutHints: { preferredAnchors: ['bottom-right', 'bottom-left'], avoidCenter: true },
    allowedOps: ['create', 'update-layout', 'update-config', 'hide', 'restore'],
    risk: 'medium',
  },
  {
    type: 'sysmonitor',
    displayName: '系统监控',
    layer: 'information',
    role: '系统状态卡片',
    intents: ['system', 'monitor', 'work'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE.sysmonitor,
    allowMultiple: false,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'card', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'compact-system', label: '紧凑系统状态', intent: ['work'] }],
    layoutHints: { preferredAnchors: ['top-right', 'center-right'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'medium',
  },
  {
    type: 'generated-widget',
    displayName: 'AI 生成组件',
    layer: 'information',
    role: '由对话生成的安全声明式信息卡、清单、进度或倒计时',
    intents: ['custom', 'generated', 'dashboard', 'checklist', 'countdown', 'progress', 'personal'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE['generated-widget'],
    minSize: { width: 220, height: 120 },
    maxSize: { width: 760, height: 720 },
    allowMultiple: true,
    persistent: false,
    canAutoHide: true,
    aesthetics: { visualWeight: 'normal', material: 'glass', maxDefaultInstances: 3, canBeHero: true, wallpaperContrast: 'auto' },
    presets: [],
    layoutHints: { preferredAnchors: ['top-right', 'bottom-right', 'top-left', 'bottom-left'], avoidCenter: true },
    allowedOps: CARD_OPS,
    risk: 'low',
  },
  {
    type: 'desktop-icons-box',
    displayName: '纵向图标收纳',
    layer: 'persistent',
    role: '桌面图标常驻收纳',
    intents: ['dock', 'icons', 'organize'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE['desktop-icons-box'],
    minSize: { width: 180, height: 220 },
    allowMultiple: true,
    persistent: true,
    canAutoHide: false,
    aesthetics: { visualWeight: 'normal', material: 'glass', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'quiet-box', label: '轻收纳盒', intent: ['organize'] }],
    layoutHints: { preferredAnchors: ['center-left', 'center-right'], avoidCenter: true },
    allowedOps: PERSISTENT_OPS,
    risk: 'high',
  },
  {
    type: 'desktop-icons-horizontal',
    displayName: '横向图标收纳',
    layer: 'persistent',
    role: '横向常用入口收纳',
    intents: ['dock', 'icons', 'organize'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE['desktop-icons-horizontal'],
    minSize: { width: 240, height: 140 },
    allowMultiple: true,
    persistent: true,
    canAutoHide: false,
    aesthetics: { visualWeight: 'normal', material: 'glass', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'quiet-horizontal', label: '轻横向收纳', intent: ['organize'] }],
    layoutHints: { preferredAnchors: ['bottom-center', 'top-center'], avoidCenter: true, reserveEdge: 'bottom' },
    allowedOps: PERSISTENT_OPS,
    risk: 'high',
  },
  {
    type: 'desktop-icons-adaptive',
    displayName: '自适应图标收纳',
    layer: 'persistent',
    role: '自动排布图标收纳',
    intents: ['dock', 'icons', 'organize'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE['desktop-icons-adaptive'],
    minSize: { width: 220, height: 180 },
    allowMultiple: true,
    persistent: true,
    canAutoHide: false,
    aesthetics: { visualWeight: 'normal', material: 'glass', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [{ id: 'adaptive-box', label: '自适应收纳', intent: ['organize'] }],
    layoutHints: { preferredAnchors: ['center-left', 'center-right', 'bottom-right'], avoidCenter: true },
    allowedOps: PERSISTENT_OPS,
    risk: 'high',
  },
  {
    type: 'desktop-icons-dock',
    displayName: '桌面 Dock',
    layer: 'persistent',
    role: '高频启动常驻入口',
    intents: ['dock', 'icons', 'launcher'],
    defaultSize: DEFAULT_WIDGET_SIZE_BY_TYPE['desktop-icons-dock'],
    minSize: { width: 240, height: 72 },
    allowMultiple: false,
    persistent: true,
    canAutoHide: false,
    aesthetics: { visualWeight: 'normal', material: 'glass', maxDefaultInstances: 1, canBeHero: false, wallpaperContrast: 'auto' },
    presets: [
      { id: 'quiet-dock', label: '轻 Dock', intent: ['minimal'], config: { dockOpacity: 0.18 } },
      { id: 'focus-dock', label: '专注 Dock', intent: ['focus'], config: { dockOpacity: 0.14 } },
    ],
    layoutHints: { preferredAnchors: ['bottom-center'], avoidCenter: true, reserveEdge: 'bottom' },
    allowedOps: PERSISTENT_OPS,
    risk: 'high',
  },
]

export const DESKTOP_SCENE_TEMPLATES: DesktopSceneTemplate[] = [
  {
    id: 'minimal',
    displayName: '极简桌面',
    description: '保留 Dock 和一组轻时间/天气，隐藏高密度信息卡片，让壁纸成为主角。',
    intents: ['极简', '干净', '清爽', '少一点', 'minimal'],
    moodTags: ['quiet', 'clean', 'wallpaper-first'],
    density: 'minimal',
    aestheticStyle: 'minimal',
    maxVisibleWidgets: 3,
    heroWidget: 'graphicdatetime',
    keepPersistentLayer: true,
    widgets: [
      { type: 'graphicdatetime', preset: 'quiet-date', anchor: 'top-left', required: true },
      { type: 'weather', preset: 'minimal', anchor: 'top-left', attachTo: 'graphicdatetime' },
    ],
    hiddenWidgetLayers: ['information'],
    petState: 'idle',
  },
  {
    id: 'night-focus',
    displayName: '夜间专注',
    description: '低亮度、少颜色、少组件，保留 Dock，使用时间、短句和可确认的白噪音营造安静工作感。',
    intents: ['专注', '学习', '工作', '夜间', '晚上', 'focus', 'night'],
    moodTags: ['quiet', 'dark', 'soft', 'focus'],
    density: 'minimal',
    aestheticStyle: 'soft',
    maxVisibleWidgets: 3,
    heroWidget: 'graphicdatetime',
    keepPersistentLayer: true,
    widgets: [
      { type: 'graphicdatetime', preset: 'quiet-date', anchor: 'top-left', required: true },
      { type: 'text', preset: 'focus-line', anchor: 'bottom-left' },
      { type: 'whitenoise', preset: 'rain-low', anchor: 'bottom-right', requiresConfirm: true },
    ],
    hiddenWidgetLayers: ['information'],
    petState: 'organizing',
  },
  {
    id: 'music-ambient',
    displayName: '音乐氛围',
    description: '让音频可视化成为主视觉，时间弱化到角落，隐藏大卡片，适合展示和听歌。',
    intents: ['音乐', '氛围', '听歌', '可视化', 'music', 'ambient'],
    moodTags: ['music', 'neon', 'showcase'],
    density: 'minimal',
    aestheticStyle: 'neon',
    maxVisibleWidgets: 3,
    heroWidget: 'audio',
    keepPersistentLayer: true,
    widgets: [
      { type: 'audio', preset: 'soft-wave', anchor: 'bottom-center', required: true },
      { type: 'clock', preset: 'minimal-light', anchor: 'top-left' },
    ],
    hiddenWidgetLayers: ['information'],
    petState: 'joy',
  },
]

export function getWidgetCapabilities(): WidgetCapability[] {
  return WIDGET_CAPABILITIES
}

export function getWidgetCapability(type: string): WidgetCapability | undefined {
  return WIDGET_CAPABILITIES.find((capability) => capability.type === type)
}

export function getDesktopSceneTemplates(): DesktopSceneTemplate[] {
  return DESKTOP_SCENE_TEMPLATES
}

export function getDesktopSceneTemplate(id: string): DesktopSceneTemplate | undefined {
  return DESKTOP_SCENE_TEMPLATES.find((template) => template.id === id)
}

export function isKnownWidgetType(type: string): type is WidgetTypeId {
  return (WIDGET_TYPES as readonly string[]).includes(type)
}
