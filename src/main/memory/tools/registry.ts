/**
 * Tool Registry — 收集并导出所有注册工具
 *
 * 使用 Vercel AI SDK v6 的 tool() helper，自动获得:
 * - Zod schema 输入验证
 * - 类型推导
 * - multi-step 自动流转
 */

import { currentTimeTool } from './definitions/current-time'
import { calculatorTool } from './definitions/calculator'
import { userLocationTool } from './definitions/user-location'
import { webSearchTool } from './definitions/web-search'
import { readClipboardTool, writeClipboardTool } from './definitions/clipboard'
import { openUrlTool } from './definitions/open-url'
import { systemInfoTool } from './definitions/system-info'
import { memoryStoreTool, memoryRecallTool } from './definitions/memory-tools'
import { weatherTool } from './definitions/weather'
import { newsTool } from './definitions/news'
import {
  addWidgetTool,
  arrangeWidgetTool,
  createGeneratedWidgetTool,
  listWidgetsTool,
  removeWidgetTool,
  updateGeneratedWidgetTool,
  updateWidgetConfigTool,
} from './definitions/widgets'
import { openLavaNotesTool } from './definitions/lavanotes'
import {
  desktopSceneApplyTool,
  desktopSceneGetTool,
  desktopScenePreviewTool,
  desktopSceneRollbackTool,
  widgetCapabilityListTool,
} from './definitions/desktop-scene'
import {
  ambientSoundTool,
  appControlTool,
  createDesktopTools,
  desktopModeTool,
  petExpressTool,
  systemControlTool,
  wallpaperTool,
} from './definitions/desktop-control'
import { createWorkspaceFileTools, type WorkspaceToolContext } from './definitions/workspace-files'
import { createCheckpointTools } from './definitions/checkpoints'
import { createWorkspaceWriteTools } from './definitions/workspace-writes'
import { createArtifactTools } from './definitions/artifacts'
import { createVerificationTools } from './definitions/verification'
import { createCommandTools } from './definitions/commands'
import { createDocumentTools } from './definitions/documents'
import type { RegisteredToolName } from '@shared/tool-manifest'

/** Tool 调用事件（用于 UI 反馈） */
export interface ToolCallEvent {
  toolCallId: string
  toolName: string
  input: unknown
  status: 'start' | 'complete' | 'error'
  output?: unknown
  error?: string
  durationMs?: number
}

/**
 * 获取完整工具集
 * 所有工具都使用 AI SDK tool() 定义，可直接传入 streamText/generateText
 */
export function getToolSet(context: WorkspaceToolContext = {}, selectedToolNames?: readonly string[]) {
  const allTools = {
    get_current_time: currentTimeTool,
    get_user_location: userLocationTool,
    calculator: calculatorTool,
    web_search: webSearchTool,
    read_clipboard: readClipboardTool,
    write_clipboard: writeClipboardTool,
    open_url: openUrlTool,
    get_system_info: systemInfoTool,
    memory_store: memoryStoreTool,
    memory_recall: memoryRecallTool,
    weather: weatherTool,
    news: newsTool,
    list_widgets: listWidgetsTool,
    add_widget: addWidgetTool,
    update_widget_config: updateWidgetConfigTool,
    arrange_widget: arrangeWidgetTool,
    update_generated_widget: updateGeneratedWidgetTool,
    remove_widget: removeWidgetTool,
    create_generated_widget: createGeneratedWidgetTool,
    open_lavanotes: openLavaNotesTool,
    widget_capability_list: widgetCapabilityListTool,
    desktop_scene_get: desktopSceneGetTool,
    desktop_scene_preview: desktopScenePreviewTool,
    desktop_scene_apply: desktopSceneApplyTool,
    desktop_scene_rollback: desktopSceneRollbackTool,
    wallpaper: wallpaperTool,
    desktop_mode: desktopModeTool,
    ambient_sound: ambientSoundTool,
    app_control: appControlTool,
    system_control: systemControlTool,
    pet_express: petExpressTool,
    ...createDesktopTools(context),
    ...createWorkspaceFileTools(context),
    ...createCheckpointTools(context),
    ...createWorkspaceWriteTools(context),
    ...createArtifactTools(context),
    ...createVerificationTools(context),
    ...createCommandTools(context),
    ...createDocumentTools(context),
  } satisfies Record<RegisteredToolName, unknown>

  if (!selectedToolNames) return allTools

  const selected = new Set(selectedToolNames)
  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) => selected.has(name))
  ) as typeof allTools
}
