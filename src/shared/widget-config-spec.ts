import type { WidgetTypeId } from './desktop-scene'

/**
 * What the AI companion may change on each built-in widget, mirroring the
 * options users get in the desktop edit toolbar (FloatingToolbar) and what
 * the widget renderers actually read. Anything outside this spec is rejected
 * with the allowed values, so the model corrects itself instead of silently
 * writing keys the widget ignores (and leaving it on its default look).
 */

/** Ids of COLOR_THEMES in src/renderer/widgets/shared/constants.tsx (kept in sync by tests). */
export const WIDGET_THEME_IDS = [
  'white', 'black', 'orange', 'blue', 'purple', 'green', 'pink',
  'cyan', 'yellow', 'red', 'indigo', 'teal', 'lime', 'rose',
] as const

export type WidgetConfigFieldSpec =
  | { kind: 'enum'; label: string; options: readonly string[]; description?: string }
  | { kind: 'number'; label: string; min: number; max: number; integer?: boolean; description?: string }
  | { kind: 'boolean'; label: string; description?: string }
  | { kind: 'string'; label: string; maxLength: number; description?: string }
  | { kind: 'color'; label: string; description?: string }

type Spec = Readonly<Record<string, WidgetConfigFieldSpec>>

const themeId: WidgetConfigFieldSpec = { kind: 'enum', label: '配色主题', options: WIDGET_THEME_IDS }
const opacity: WidgetConfigFieldSpec = { kind: 'number', label: '不透明度', min: 0.1, max: 1 }
const darkMode: WidgetConfigFieldSpec = { kind: 'boolean', label: '深色文字/深色外观' }
const city: WidgetConfigFieldSpec = { kind: 'string', label: '城市', maxLength: 40, description: '留空时按定位获取' }

const ICON_STORAGE_SPEC: Spec = {
  storageStyle: { kind: 'enum', label: '外观', options: ['plain', 'titled'], description: 'titled 会显示标题栏' },
  storageTitle: { kind: 'string', label: '标题', maxLength: 20 },
  storageHideLabels: { kind: 'boolean', label: '隐藏图标文字' },
  storageTint: { kind: 'color', label: '玻璃底色' },
  storageTintStrength: { kind: 'number', label: '底色浓度', min: 0, max: 0.2 },
  storageOpacity: { kind: 'number', label: '玻璃不透明度', min: 0.02, max: 0.22 },
  storageBlur: { kind: 'number', label: '模糊程度', min: 6, max: 32 },
  iconScale: { kind: 'number', label: '图标大小倍数', min: 0.65, max: 1.8 },
}

export const WIDGET_CONFIG_SPECS: Readonly<Record<WidgetTypeId, Spec>> = {
  clock: { style: { kind: 'enum', label: '样式', options: ['minimal', 'stacked'] }, themeId, opacity },
  elegantclock: { themeId, opacity },
  pixelclock: { style: { kind: 'enum', label: '样式', options: ['minimal', 'weekday'] }, themeId, opacity },
  graphicdatetime: { themeId, darkMode, city },
  audio: { style: { kind: 'enum', label: '形态', options: ['bars', 'wave', 'circle', 'spectrum', 'dna'] }, themeId, opacity },
  weather: { style: { kind: 'enum', label: '样式', options: ['minimal', 'realism', 'glass', 'neon'] }, darkMode, city },
  whitenoise: {
    style: { kind: 'enum', label: '外观', options: ['glass', 'cd', 'minimal'] },
    darkMode,
    themeId,
    opacity,
    volume: { kind: 'number', label: '音量档位', min: 0, max: 3, integer: true, description: '0 静音，3 最大' },
  },
  text: {
    text: { kind: 'string', label: '文字', maxLength: 120 },
    author: { kind: 'string', label: '署名', maxLength: 40 },
  },
  stocks: {
    refreshInterval: { kind: 'number', label: '刷新间隔（秒）', min: 10, max: 3600, integer: true },
  },
  news: {
    source: { kind: 'enum', label: '来源', options: ['toutiao', 'weibo', 'baidu', 'zhihu', 'bilibili'] },
    maxItems: { kind: 'number', label: '条数', min: 3, max: 10, integer: true },
    refreshInterval: { kind: 'number', label: '刷新间隔（分钟）', min: 1, max: 120, integer: true },
  },
  calendar: {},
  quicktools: {},
  pet: {},
  sysmonitor: {},
  'generated-widget': {},
  'desktop-icons-box': ICON_STORAGE_SPEC,
  'desktop-icons-horizontal': ICON_STORAGE_SPEC,
  'desktop-icons-adaptive': ICON_STORAGE_SPEC,
  'desktop-icons-dock': {
    dockStyle: { kind: 'enum', label: '外形', options: ['glass', 'trapezoid'] },
    dockTint: { kind: 'color', label: '玻璃底色' },
    dockTintStrength: { kind: 'number', label: '底色浓度', min: 0, max: 0.24 },
    dockOpacity: { kind: 'number', label: '玻璃不透明度', min: 0, max: 0.24 },
    dockBlur: { kind: 'number', label: '模糊程度', min: 6, max: 32 },
    dockReflection: { kind: 'boolean', label: '倒影' },
    dockHoverScale: { kind: 'number', label: '悬停放大倍数', min: 1.1, max: 2.1 },
  },
}

/** Config that has its own structured tool; generic config edits must not touch it. */
export const WIDGET_CONFIG_MANAGED_BY: Partial<Record<WidgetTypeId, string>> = {
  stocks: '股票列表通过 add_widget 的 stockSymbols 设置',
  'generated-widget': '内容用 update_generated_widget 修改',
  pet: '桌宠外观在“桌宠”页面设置',
}

export interface WidgetConfigRejection {
  key: string
  reason: 'unknown-key' | 'invalid-value'
  allowed?: readonly string[] | { min: number; max: number } | string
}

export interface NormalizedWidgetConfigPatch {
  config: Record<string, unknown>
  applied: string[]
  adjusted: Array<{ key: string; note: string }>
  rejected: WidgetConfigRejection[]
}

function describeAllowed(spec: WidgetConfigFieldSpec): WidgetConfigRejection['allowed'] {
  if (spec.kind === 'enum') return spec.options
  if (spec.kind === 'number') return { min: spec.min, max: spec.max }
  if (spec.kind === 'boolean') return 'true | false'
  if (spec.kind === 'color') return '#RRGGBB'
  return `最多 ${spec.maxLength} 个字符`
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

/** Validate an AI-proposed config patch against the widget's real settings. */
export function normalizeWidgetConfigPatch(type: string, patch: Record<string, unknown> | undefined): NormalizedWidgetConfigPatch {
  const spec: Spec = (WIDGET_CONFIG_SPECS as Record<string, Spec>)[type] ?? {}
  const result: NormalizedWidgetConfigPatch = { config: {}, applied: [], adjusted: [], rejected: [] }
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const field = spec[key]
    if (!field) {
      result.rejected.push({ key, reason: 'unknown-key', allowed: Object.keys(spec) })
      continue
    }
    const reject = () => result.rejected.push({ key, reason: 'invalid-value', allowed: describeAllowed(field) })

    if (field.kind === 'enum') {
      const match = typeof raw === 'string'
        ? field.options.find((option) => option.toLowerCase() === raw.trim().toLowerCase())
        : undefined
      if (!match) { reject(); continue }
      result.config[key] = match
    } else if (field.kind === 'number') {
      const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
      if (!Number.isFinite(numeric)) { reject(); continue }
      let value = Math.max(field.min, Math.min(field.max, numeric))
      if (field.integer) value = Math.round(value)
      else value = Math.round(value * 1000) / 1000
      if (value !== numeric) result.adjusted.push({ key, note: `已限制到 ${field.min}–${field.max} 范围内：${value}` })
      result.config[key] = value
    } else if (field.kind === 'boolean') {
      if (typeof raw === 'boolean') result.config[key] = raw
      else if (raw === 'true' || raw === 'false') result.config[key] = raw === 'true'
      else { reject(); continue }
    } else if (field.kind === 'color') {
      const color = normalizeColor(raw)
      if (!color) { reject(); continue }
      result.config[key] = color
    } else {
      if (typeof raw !== 'string') { reject(); continue }
      const trimmed = raw.trim()
      if (trimmed.length > field.maxLength) result.adjusted.push({ key, note: `已截断到 ${field.maxLength} 个字符` })
      result.config[key] = trimmed.slice(0, field.maxLength)
    }
    result.applied.push(key)
  }
  return result
}

/** Compact "what can I change" description for tool results and the capability list. */
export function describeWidgetConfigSpec(type: string): Record<string, { label: string; allowed: WidgetConfigRejection['allowed']; description?: string }> {
  const spec: Spec = (WIDGET_CONFIG_SPECS as Record<string, Spec>)[type] ?? {}
  return Object.fromEntries(Object.entries(spec).map(([key, field]) => [
    key,
    { label: field.label, allowed: describeAllowed(field), ...(field.description ? { description: field.description } : {}) },
  ]))
}

/** Only the documented settings of a widget, for compact summaries (no icon data URLs, note HTML, etc.). */
export function pickWidgetSettings(type: string, config: Record<string, unknown> | undefined): Record<string, unknown> {
  const spec: Spec = (WIDGET_CONFIG_SPECS as Record<string, Spec>)[type] ?? {}
  const settings: Record<string, unknown> = {}
  for (const key of Object.keys(spec)) {
    if (config && Object.prototype.hasOwnProperty.call(config, key)) settings[key] = config[key]
  }
  return settings
}
