import { randomUUID } from 'crypto'
import { tool } from 'ai'
import { z } from 'zod'
import type { WidgetInstance } from '@shared/types'
import { DEFAULT_WIDGET_SIZE_BY_TYPE, WIDGET_TYPES, getWidgetCapability, type WidgetTypeId } from '@shared/desktop-scene'
import {
  GENERATED_WIDGET_MAX_SIZE,
  GENERATED_WIDGET_MIN_SIZE,
  GENERATED_WIDGET_THEMES,
  estimateGeneratedWidgetHeight,
  isGeneratedWidgetDefinition,
  type GeneratedWidgetBlock,
  type GeneratedWidgetDefinition,
} from '@shared/generated-widget'
import {
  WIDGET_CONFIG_MANAGED_BY,
  describeWidgetConfigSpec,
  normalizeWidgetConfigPatch,
  pickWidgetSettings,
  type NormalizedWidgetConfigPatch,
} from '@shared/widget-config-spec'
import { normalizeStockSymbols } from '@shared/stock-symbols'
import { WIDGET_ANCHORS } from '@shared/widget-anchor'
import {
  addWidgetForTool,
  arrangeWidgetForTool,
  listWidgetsForTool,
  removeWidgetForTool,
  updateWidgetConfigForTool,
} from '../../../ipc/widgetIpc'

const PERSISTENT_WIDGET_TYPES = new Set(['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive', 'desktop-icons-dock'])

/**
 * Compact, model-friendly view of a widget: its documented settings plus a
 * short content summary. Raw config can hold icon data URLs, note HTML with
 * inline images or whole generated definitions, which bloated every tool
 * result and pushed conversation context out.
 */
export function summarizeWidget(widget: WidgetInstance) {
  const config = widget.config ?? {}
  const content: Record<string, unknown> = {}
  if (widget.type === 'generated-widget' && isGeneratedWidgetDefinition(config.definition)) {
    content.title = config.definition.title
    content.theme = config.definition.theme
    content.blocks = config.definition.blocks.map((block) => block.type)
  } else if (widget.type === 'stocks') {
    content.symbols = normalizeStockSymbols(config.symbols).map((symbol) => symbol.code)
  } else if (PERSISTENT_WIDGET_TYPES.has(widget.type)) {
    content.iconCount = Array.isArray(config.items) ? config.items.length : 0
  }
  return {
    id: widget.id,
    type: widget.type,
    displayName: getWidgetCapability(widget.type)?.displayName ?? widget.type,
    visible: widget.enabled,
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
    settings: pickWidgetSettings(widget.type, config),
    ...(Object.keys(content).length > 0 ? { content } : {}),
  }
}

function reportConfigPatch(type: string, patch: NormalizedWidgetConfigPatch) {
  return {
    applied: patch.applied,
    ...(patch.adjusted.length > 0 ? { adjusted: patch.adjusted } : {}),
    ...(patch.rejected.length > 0
      ? {
          rejected: patch.rejected,
          guidance: WIDGET_CONFIG_MANAGED_BY[type as WidgetTypeId]
            ?? '被拒绝的设置没有生效。请只使用 allowed 中列出的键和取值后重试，不要告诉用户已经修改成功。',
        }
      : {}),
  }
}

function resolvePresetConfig(type: WidgetTypeId, presetId: string | undefined): { config: Record<string, unknown>; error?: string } {
  if (!presetId) return { config: {} }
  const capability = getWidgetCapability(type)
  const preset = capability?.presets.find((candidate) => candidate.id === presetId)
  if (!preset) {
    return { config: {}, error: `unknown-preset；可用预设：${capability?.presets.map((candidate) => candidate.id).join(', ') || '无'}` }
  }
  return { config: { ...(preset.config ?? {}) } }
}

function createWidget(type: WidgetTypeId, config?: Record<string, unknown>): WidgetInstance {
  const size = DEFAULT_WIDGET_SIZE_BY_TYPE[type]
  return {
    id: `${type}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    type,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    enabled: true,
    config: config ?? {},
  }
}

export const listWidgetsTool = tool({
  description: '查看当前桌面上的组件：id、类型、位置尺寸、是否显示、当前设置和内容摘要。调整、移动或删除某个组件前先调用，用返回的 id 定位，不要猜 id。',
  inputSchema: z.object({
    type: z.enum(WIDGET_TYPES).optional().describe('只看某一类组件。'),
    includeOptions: z.boolean().optional().describe('为 true 时附带每类组件可修改的设置项和允许的取值。'),
  }),
  execute: async ({ type, includeOptions }) => {
    const widgets = listWidgetsForTool().filter((widget) => !type || widget.type === type)
    const types = [...new Set(widgets.map((widget) => widget.type))]
    return {
      ok: true,
      count: widgets.length,
      widgets: widgets.map(summarizeWidget),
      ...(includeOptions ? { editableSettings: Object.fromEntries(types.map((item) => [item, describeWidgetConfigSpec(item)])) } : {}),
    }
  },
})

export const addWidgetTool = tool({
  description: '把一个内置桌面组件添加到桌面，会自动避开已有组件并对齐网格。优先用 preset 选择设计好的样式、用 anchor 指定位置；config 只能使用 widget_capability_list / list_widgets(includeOptions) 给出的设置项。实时股票必须使用 type=stocks 并在 stockSymbols 中传入 A 股代码；便签和待办用 open_lavanotes 交给 LavaNotes；不要用 generated-widget 伪造静态行情。',
  inputSchema: z.object({
    type: z.enum(WIDGET_TYPES).describe('组件类型。桌面短句用 text；股票用 stocks；天气用 weather；日历用 calendar。'),
    preset: z.string().max(60).optional().describe('组件能力列表中的预设 id，例如 clock 的 minimal-light。'),
    anchor: z.enum(WIDGET_ANCHORS).optional().describe('放在主显示器的哪个位置；省略时自动寻找整齐的空位。'),
    config: z.record(z.string(), z.unknown()).optional().describe('额外设置，会覆盖预设。例如 text: { text, author }；weather: { style: "glass" }；news: { source, maxItems }。'),
    stockSymbols: z.array(z.object({
      code: z.string().regex(/^\d{6}$/).describe('六位 A 股或指数代码，例如 600519。'),
      name: z.string().min(1).max(40).optional(),
      market: z.enum(['0', '1']).optional().describe('可省略；1=沪市，0=深市。'),
    })).min(1).max(6).optional().describe('仅 type=stocks 使用。必须根据用户指定的股票填写，不确定股票时先询问，不要猜。'),
  }),
  execute: async ({ type, preset, anchor, config, stockSymbols }) => {
    const presetConfig = resolvePresetConfig(type, preset)
    if (presetConfig.error) return { ok: false, added: false, reason: presetConfig.error }
    // Models sometimes pass stock codes inside config; accept them here instead of rejecting them as unknown settings.
    const rawConfig: Record<string, unknown> = { ...(config ?? {}) }
    const legacyStockInput = rawConfig.symbols ?? rawConfig.stocks ?? rawConfig.stockCodes ?? rawConfig.symbol ?? rawConfig.stockSymbols
    for (const key of ['symbols', 'stocks', 'stockCodes', 'symbol', 'stockSymbols']) delete rawConfig[key]
    const patch = normalizeWidgetConfigPatch(type, { ...presetConfig.config, ...rawConfig })
    let normalizedConfig: Record<string, unknown> = { ...patch.config }
    if (type === 'stocks') {
      const symbols = normalizeStockSymbols(stockSymbols ?? legacyStockInput)
      if (symbols.length === 0) {
        return {
          ok: false,
          added: false,
          reason: 'stock-symbols-required',
          message: '请先询问用户要添加的 A 股名称或六位代码，再重试创建股票组件。',
        }
      }
      const refreshInterval = typeof normalizedConfig.refreshInterval === 'number' ? normalizedConfig.refreshInterval : 30
      normalizedConfig = { ...normalizedConfig, symbols, refreshInterval }
    } else if (type === 'generated-widget') {
      return { ok: false, added: false, reason: 'use-create-generated-widget', message: '生成式组件请使用 create_generated_widget。' }
    }

    const result = addWidgetForTool(createWidget(type, normalizedConfig), { anchor })
    return {
      ok: result.ok,
      added: result.added,
      reason: result.reason,
      ...(result.reason === 'already-exists' ? { guidance: '这类组件只能放一个，已存在的组件保持不变；需要改样式或位置请用 update_widget_config / arrange_widget。' } : {}),
      widget: summarizeWidget(result.widget),
      config: reportConfigPatch(type, patch),
      count: result.list.length,
    }
  },
})

function normalizeGeneratedBlocks(blocks: z.infer<typeof generatedBlockSchema>[]): GeneratedWidgetBlock[] {
  return blocks.map((block, blockIndex): GeneratedWidgetBlock => {
    if (block.type !== 'list') return block
    return {
      ...block,
      items: block.items.map((item, itemIndex) => ({
        id: `item-${blockIndex}-${itemIndex}-${randomUUID().slice(0, 6)}`,
        text: item.text,
        done: item.done,
      })),
    }
  })
}

const generatedBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(500), style: z.enum(['body', 'caption', 'headline', 'quote']).optional(), align: z.enum(['left', 'center', 'right']).optional() }),
  z.object({ type: z.literal('metric'), label: z.string().min(1).max(60), value: z.string().min(1).max(80), unit: z.string().max(20).optional(), trend: z.string().max(80).optional() }),
  z.object({ type: z.literal('progress'), label: z.string().min(1).max(60), value: z.number(), max: z.number().positive().max(1_000_000).optional(), detail: z.string().max(80).optional() }),
  z.object({ type: z.literal('list'), title: z.string().max(80).optional(), items: z.array(z.object({ text: z.string().min(1).max(160), done: z.boolean().optional() })).min(1).max(12), interactive: z.boolean().optional() }),
  z.object({ type: z.literal('clock'), format: z.enum(['time', 'date', 'datetime']).optional(), locale: z.enum(['zh-CN', 'en-US']).optional(), showSeconds: z.boolean().optional() }),
  z.object({ type: z.literal('countdown'), label: z.string().min(1).max(80), targetAt: z.string().min(1).max(80), completedText: z.string().max(80).optional() }),
  z.object({ type: z.literal('divider') }),
])

export const createGeneratedWidgetTool = tool({
  description: '生成静态或本地交互的个性化组件，适用于清单、目标进度、倒计时和组合信息卡。不得用于股票、天气、新闻等实时数据；这些场景必须使用对应内置组件。',
  inputSchema: z.object({
    name: z.string().min(1).max(60).describe('组件内部名称。'),
    title: z.string().min(1).max(80).describe('显示在组件顶部的标题。'),
    subtitle: z.string().max(140).optional(),
    theme: z.enum(GENERATED_WIDGET_THEMES).default('glass'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffb86b'),
    width: z.number().min(GENERATED_WIDGET_MIN_SIZE.width).max(GENERATED_WIDGET_MAX_SIZE.width).default(340).describe('卡片宽度，常用 300–420。'),
    height: z.number().min(GENERATED_WIDGET_MIN_SIZE.height).max(GENERATED_WIDGET_MAX_SIZE.height).optional().describe('通常省略，按内容自动计算高度，避免内容被裁切或留白过多。'),
    anchor: z.enum(WIDGET_ANCHORS).optional().describe('放在主显示器的哪个位置；省略时自动寻找整齐的空位。'),
    blocks: z.array(generatedBlockSchema).min(1).max(12).describe('从上到下显示的内容积木。清单设置 interactive=true 后可以直接在桌面勾选。'),
  }),
  execute: async ({ name, title, subtitle, theme, accent, width, height, anchor, blocks }) => {
    const normalizedBlocks = normalizeGeneratedBlocks(blocks)
    const definition: GeneratedWidgetDefinition = {
      version: 1,
      name,
      title,
      subtitle,
      theme,
      accent,
      blocks: normalizedBlocks,
      generatedAt: Date.now(),
    }
    const widget = createWidget('generated-widget', { definition })
    widget.width = Math.round(width)
    widget.height = Math.round(height ?? estimateGeneratedWidgetHeight(definition, width))
    const result = addWidgetForTool(widget, { anchor })
    return {
      ok: result.ok,
      added: result.added,
      reason: result.reason,
      widget: summarizeWidget(result.widget),
      definition,
      count: result.list.length,
    }
  },
})

export const updateWidgetConfigTool = tool({
  description: '修改已有组件的外观或内容设置（样式、配色主题、透明度、深色模式、文字、新闻源等），也可以套用预设。只能使用该组件允许的设置项；不认识的键或取值会被拒绝并返回允许值。移动/缩放/隐藏请用 arrange_widget。',
  inputSchema: z.object({
    id: z.string().optional().describe('组件 id。已知具体组件时优先使用。'),
    type: z.enum(WIDGET_TYPES).optional().describe('组件类型。没有 id 时可用类型定位已有组件。'),
    preset: z.string().max(60).optional().describe('套用组件能力列表中的预设 id。'),
    config: z.record(z.string(), z.unknown()).optional().describe('要修改的设置，例如 { style: "neon" }、{ themeId: "blue", opacity: 0.8 }。'),
  }),
  execute: async ({ id, type, preset, config }) => {
    const target = listWidgetsForTool().find((widget) => (id ? widget.id === id : widget.type === type))
    if (!target) return { ok: false, error: 'widget-not-found', guidance: '先用 list_widgets 找到准确的组件 id。' }
    const widgetType = target.type as WidgetTypeId
    const presetConfig = resolvePresetConfig(widgetType, preset)
    if (presetConfig.error) return { ok: false, error: presetConfig.error }
    const patch = normalizeWidgetConfigPatch(widgetType, { ...presetConfig.config, ...(config ?? {}) })
    if (patch.applied.length === 0) {
      return {
        ok: false,
        error: 'no-valid-settings',
        widget: summarizeWidget(target),
        editableSettings: describeWidgetConfigSpec(widgetType),
        config: reportConfigPatch(widgetType, patch),
      }
    }
    const result = updateWidgetConfigForTool({ id: target.id, config: patch.config })
    return {
      ok: result.ok,
      error: result.error,
      widget: result.widget ? summarizeWidget(result.widget) : undefined,
      config: reportConfigPatch(widgetType, patch),
    }
  },
})

export const arrangeWidgetTool = tool({
  description: '调整单个组件的位置、大小、显示状态或叠放层级：anchor 把组件放到显示器的角落/边缘（推荐，比坐标更整齐），scale 等比放大缩小，visible=false 暂时隐藏、true 恢复显示，bringToFront 置顶。会自动避开其他组件并保持在屏幕内。',
  inputSchema: z.object({
    id: z.string().optional().describe('组件 id，先用 list_widgets 获取。'),
    type: z.enum(WIDGET_TYPES).optional().describe('没有 id 且该类组件只有一个时可用类型定位。'),
    anchor: z.enum(WIDGET_ANCHORS).optional().describe('移动到组件所在显示器的哪个位置。'),
    x: z.number().min(-32_768).max(32_768).optional().describe('以组件所在显示器左上角为原点的 x（像素）；一般用 anchor 代替。'),
    y: z.number().min(-32_768).max(32_768).optional().describe('以组件所在显示器左上角为原点的 y（像素）；一般用 anchor 代替。'),
    scale: z.number().min(0.5).max(3).optional().describe('相对当前大小的缩放倍数，例如 1.2 放大 20%。'),
    width: z.number().min(40).max(1400).optional().describe('目标宽度（仅音频可视化、生成式组件等可自由缩放的组件）。'),
    height: z.number().min(40).max(1000).optional().describe('目标高度。'),
    visible: z.boolean().optional().describe('false 隐藏，true 恢复显示。Dock 和图标收纳不能隐藏。'),
    bringToFront: z.boolean().optional().describe('把组件叠放到最上层。'),
  }),
  execute: async (params) => {
    if (!params.id && !params.type) return { ok: false, error: 'widget-id-required', guidance: '先用 list_widgets 找到组件 id。' }
    const result = arrangeWidgetForTool(params)
    return {
      ok: result.ok,
      error: result.error,
      notes: result.notes,
      widget: result.widget ? summarizeWidget(result.widget) : undefined,
    }
  },
})

export const updateGeneratedWidgetTool = tool({
  description: '修改已经生成的 AI 组件（generated-widget）的标题、副标题、主题、强调色或内容积木；提供 blocks 时整体替换内容。高度会按内容重新计算。',
  inputSchema: z.object({
    id: z.string().min(1).describe('generated-widget 的组件 id，先用 list_widgets 获取。'),
    title: z.string().min(1).max(80).optional(),
    subtitle: z.string().max(140).nullable().optional().describe('传 null 移除副标题。'),
    theme: z.enum(GENERATED_WIDGET_THEMES).optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    width: z.number().min(GENERATED_WIDGET_MIN_SIZE.width).max(GENERATED_WIDGET_MAX_SIZE.width).optional(),
    blocks: z.array(generatedBlockSchema).min(1).max(12).optional(),
  }),
  execute: async ({ id, title, subtitle, theme, accent, width, blocks }) => {
    const target = listWidgetsForTool().find((widget) => widget.id === id)
    if (!target || target.type !== 'generated-widget') return { ok: false, error: 'generated-widget-not-found' }
    const current = isGeneratedWidgetDefinition(target.config?.definition) ? target.config.definition : null
    if (!current) return { ok: false, error: 'definition-unreadable', guidance: '这个组件的内容已损坏，请用 create_generated_widget 重新生成后删除旧组件。' }
    const definition: GeneratedWidgetDefinition = {
      ...current,
      title: title ?? current.title,
      subtitle: subtitle === null ? undefined : subtitle ?? current.subtitle,
      theme: theme ?? current.theme,
      accent: accent ?? current.accent,
      blocks: blocks ? normalizeGeneratedBlocks(blocks) : current.blocks,
      generatedAt: Date.now(),
    }
    const nextWidth = width ?? (target.width || 340)
    const configResult = updateWidgetConfigForTool({ id, config: { definition } })
    if (!configResult.ok) return { ok: false, error: configResult.error }
    const layout = arrangeWidgetForTool({ id, width: nextWidth, height: estimateGeneratedWidgetHeight(definition, nextWidth) })
    return {
      ok: layout.ok,
      error: layout.error,
      widget: layout.widget ? summarizeWidget(layout.widget) : undefined,
    }
  },
})

export const removeWidgetTool = tool({
  description: '从桌面移除一个组件。只是暂时不想看到时优先用 arrange_widget(visible=false)。Dock 和图标收纳里存放着用户的桌面图标，删除前界面会弹出确认卡，由用户点头后才会执行。',
  inputSchema: z.object({
    id: z.string().optional().describe('组件 id。已知具体组件时优先使用。'),
    type: z.enum(WIDGET_TYPES).optional().describe('组件类型。没有 id 时可用类型定位已有组件。'),
  }),
  // The chat surface asks the user before a Dock / icon box is removed (action policy), then this runs.
  execute: async ({ id, type }) => {
    const result = await removeWidgetForTool({ id, type })
    return {
      ok: result.ok,
      deleted: result.deleted,
      error: result.error,
      count: result.list.length,
    }
  },
})
