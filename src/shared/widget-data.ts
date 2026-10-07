import { z } from 'zod'
import { WIDGET_TYPES } from './desktop-scene'
import type { WidgetInstance } from './types'

export const MAX_WIDGETS = 200
/**
 * Types older releases stored but this release no longer renders. Stored lists
 * that contain them must still parse; otherwise an upgrade would report every
 * desktop as corrupt. They are filtered out (and backed up) when loaded.
 * todo-board: the built-in sticky note, replaced by the separate LavaNotes app.
 */
export const RETIRED_WIDGET_TYPES = ['todo-board'] as const

export function isRetiredWidgetType(type: string): boolean {
  return (RETIRED_WIDGET_TYPES as readonly string[]).includes(type)
}
export const MAX_WIDGET_CONFIG_BYTES = 512 * 1024
const configBytes = (config: unknown): number => new TextEncoder().encode(JSON.stringify(config ?? {})).length

export const widgetConfigSchema = z.record(z.string().max(120), z.unknown()).superRefine((value, context) => {
  try {
    if (configBytes(value) > MAX_WIDGET_CONFIG_BYTES) context.addIssue({ code: 'custom', message: '组件配置不能超过 512KB。' })
  } catch {
    context.addIssue({ code: 'custom', message: '组件配置必须可以序列化。' })
  }
})

export const storedWidgetSchema = z.object({
  id: z.string().min(1).max(160).regex(/^[\w.-]+$/),
  type: z.enum([...WIDGET_TYPES, ...RETIRED_WIDGET_TYPES]),
  x: z.number().finite().min(-32_768).max(32_768),
  y: z.number().finite().min(-32_768).max(32_768),
  width: z.number().finite().min(0).max(4096),
  height: z.number().finite().min(0).max(4096),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  stackOrder: z.number().finite().optional(),
  displayId: z.number().int().optional(),
  displayKey: z.string().min(1).max(160).optional(),
}).passthrough()

export const widgetInstanceSchema = storedWidgetSchema.extend({ config: widgetConfigSchema.optional() })

// Read limits must not destroy records written by older versions. Corruption
// is an error, never an empty list that can be persisted as a successful read.
export function parseStoredWidgets(value: unknown): WidgetInstance[] {
  const result = z.array(storedWidgetSchema).safeParse(value)
  if (!result.success) throw new Error('组件记录格式异常，原数据已保留，请检查配置或恢复备份。')
  return result.data
}

export function assertWidgetWriteLimits(next: WidgetInstance[], previous: WidgetInstance[]): void {
  parseStoredWidgets(next)
  if (next.length > MAX_WIDGETS && next.length > previous.length) throw new Error('组件数量不能超过 200 个。')
  const previousById = new Map(previous.map((widget) => [widget.id, widget]))
  if (new Set(next.map((widget) => widget.id)).size !== next.length) throw new Error('组件 ID 不能重复。')
  for (const widget of next) {
    const bytes = configBytes(widget.config)
    if (bytes > MAX_WIDGET_CONFIG_BYTES && bytes > configBytes(previousById.get(widget.id)?.config)) {
      throw new Error('组件配置不能超过 512KB，请减少内容后重试。')
    }
  }
}
