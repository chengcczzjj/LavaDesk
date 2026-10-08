import { screen } from 'electron'
import { tool } from 'ai'
import { z } from 'zod'
import type { WidgetInstance } from '@shared/types'
import {
  getDesktopSceneTemplate,
  getDesktopSceneTemplates,
  getWidgetCapabilities,
  getWidgetCapability,
  type WidgetCapability,
  type WidgetLayer,
} from '@shared/desktop-scene'
import { buildDesktopSceneLayoutPlan, type DesktopSceneLayoutPlan } from '@shared/desktop-scene-layout'
import { describeWidgetConfigSpec, pickWidgetSettings } from '@shared/widget-config-spec'
import { PET_EXPRESSION_STATES, type PetExpressionState } from '@shared/widget-command'
import { store } from '../../../store'
import { expressPet } from '../../desktop/petBridge'
import {
  applyDesktopScenePlanForTool,
  listWidgetsForTool,
  rollbackDesktopSceneForTool,
  showDesktopScenePreviewForTool,
} from '../../../ipc/widgetIpc'

function summarizeCapability(capability: WidgetCapability) {
  return {
    type: capability.type,
    displayName: capability.displayName,
    layer: capability.layer,
    role: capability.role,
    intents: capability.intents,
    persistent: capability.persistent,
    canAutoHide: capability.canAutoHide,
    allowMultiple: capability.allowMultiple,
    risk: capability.risk,
    aesthetics: capability.aesthetics,
    layoutHints: capability.layoutHints,
    presets: capability.presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      intent: preset.intent ?? [],
      config: preset.config ?? {},
    })),
    allowedOps: capability.allowedOps,
    editableSettings: describeWidgetConfigSpec(capability.type),
  }
}

function summarizeWidget(widget: WidgetInstance) {
  const capability = getWidgetCapability(widget.type)
  return {
    id: widget.id,
    type: widget.type,
    displayName: capability?.displayName ?? widget.type,
    layer: capability?.layer ?? 'unknown',
    role: capability?.role ?? '未登记组件',
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
    enabled: widget.enabled,
    persistent: capability?.persistent ?? false,
    canAutoHide: capability?.canAutoHide ?? true,
    visualWeight: capability?.aesthetics.visualWeight ?? 'normal',
    material: capability?.aesthetics.material ?? 'card',
    // Only documented settings: raw config can carry icon data URLs and note HTML.
    settings: pickWidgetSettings(widget.type, widget.config),
  }
}

function summarizeTemplate() {
  return getDesktopSceneTemplates().map((template) => ({
    id: template.id,
    displayName: template.displayName,
    description: template.description,
    intents: template.intents,
    density: template.density,
    aestheticStyle: template.aestheticStyle,
    maxVisibleWidgets: template.maxVisibleWidgets,
    heroWidget: template.heroWidget,
    widgets: template.widgets,
    hiddenWidgetLayers: template.hiddenWidgetLayers ?? [],
    petState: template.petState,
  }))
}

function getPrimaryScreenSize() {
  const bounds = screen.getPrimaryDisplay().bounds
  return {
    width: bounds.width,
    height: bounds.height,
  }
}

function summarizePlan(plan: DesktopSceneLayoutPlan) {
  return {
    sceneId: plan.sceneId,
    sceneName: plan.sceneName,
    screen: plan.screen,
    widgets: plan.widgets.map((widget) => ({
      id: widget.id,
      type: widget.type,
      source: widget.source,
      preset: widget.preset,
      anchor: widget.anchor,
      rect: widget.rect,
      layer: widget.layer,
      material: widget.material,
      visualWeight: widget.visualWeight,
      persistent: widget.persistent,
    })),
    hiddenWidgetIds: plan.hiddenWidgetIds,
    widgetPatches: plan.widgetPatches,
    preservedEmptyAreas: plan.preservedEmptyAreas,
    aestheticCheck: plan.aestheticCheck,
  }
}

function summarizeSnapshot(snapshot: { id: string; createdAt: number; reason: string; beforeWidgets: WidgetInstance[]; afterWidgets?: WidgetInstance[] }) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    beforeWidgetCount: snapshot.beforeWidgets.length,
    afterWidgetCount: snapshot.afterWidgets?.length,
  }
}

export const widgetCapabilityListTool = tool({
  description: '查看桌面组件的 AI 可编排能力、视觉层级、可用预设、布局偏好和操作边界。用户要求布置桌面、调整组件风格、了解能放什么组件时使用。',
  inputSchema: z.object({
    layer: z.enum(['persistent', 'ambient', 'information', 'companion']).optional().describe('按组件层级筛选。persistent 是 Dock/图标收纳，ambient 是装饰氛围，information 是信息卡片，companion 是桌宠反馈。'),
    intent: z.string().optional().describe('按意图筛选，例如 focus、music、minimal、weather、dock。'),
  }),
  execute: async ({ layer, intent }) => {
    const normalizedIntent = intent?.trim().toLowerCase()
    const capabilities = getWidgetCapabilities().filter((capability) => {
      if (layer && capability.layer !== layer as WidgetLayer) return false
      if (!normalizedIntent) return true
      return capability.intents.some((item) => item.toLowerCase().includes(normalizedIntent))
        || capability.presets.some((preset) => preset.intent?.some((item) => item.toLowerCase().includes(normalizedIntent)))
    })
    return {
      ok: true,
      count: capabilities.length,
      capabilities: capabilities.map(summarizeCapability),
    }
  },
})

export const desktopSceneGetTool = tool({
  description: '读取当前桌面编排上下文，包括当前壁纸、已有组件、组件视觉层级、Dock 常驻状态和内置场景模板。用户要求“布置桌面/专注模式/极简模式/音乐氛围/桌面美化”时先使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const wallpaper = store.get('wallpaper')?.current
    const widgets = listWidgetsForTool()
    const widgetSummaries = widgets.map(summarizeWidget)
    const visibleWidgets = widgetSummaries.filter((widget) => widget.enabled)
    const persistentWidgets = visibleWidgets.filter((widget) => widget.layer === 'persistent')
    const informationWidgets = visibleWidgets.filter((widget) => widget.layer === 'information')
    const heroCandidates = visibleWidgets.filter((widget) => {
      const capability = getWidgetCapability(widget.type)
      return capability?.aesthetics.canBeHero === true
    })

    return {
      ok: true,
      wallpaper: wallpaper
        ? {
            id: wallpaper.id,
            name: wallpaper.name,
            type: wallpaper.type,
            settings: wallpaper.settings ?? {},
          }
        : null,
      widgets: widgetSummaries,
      sceneTemplates: summarizeTemplate(),
      aestheticSummary: {
        visibleWidgetCount: visibleWidgets.length,
        persistentWidgetCount: persistentWidgets.length,
        informationWidgetCount: informationWidgets.length,
        heroCandidateCount: heroCandidates.length,
        hasDock: visibleWidgets.some((widget) => widget.type === 'desktop-icons-dock'),
        guidance: '默认桌面应保留 Dock，最多保留一个主视觉组件，信息卡片只在用户明确要求工作/资讯/看盘时出现。',
      },
      missingImplementation: [
        'desktop-layout.json 读取还未接入，当前布局预览会保守避开屏幕中心。',
      ],
    }
  },
})

export const desktopScenePreviewTool = tool({
  description: '为指定桌面场景生成只读布局预览和美学检查结果，不会写入或移动真实组件。用于“先看看怎么布置”“极简/夜间专注/音乐氛围怎么摆”等请求。',
  inputSchema: z.object({
    sceneId: z.string().default('minimal').describe('场景模板 id：minimal、night-focus、music-ambient。'),
  }),
  execute: async ({ sceneId }) => {
    const template = getDesktopSceneTemplate(sceneId)
    if (!template) {
      return {
        ok: false,
        error: 'scene-not-found',
        availableScenes: summarizeTemplate(),
      }
    }

    const widgets = listWidgetsForTool()
    const plan = buildDesktopSceneLayoutPlan({
      sceneId: template.id,
      currentWidgets: widgets,
      screen: getPrimaryScreenSize(),
    })
    showDesktopScenePreviewForTool(plan)

    return {
      ok: true,
      plan: summarizePlan(plan),
      guidance: plan.aestheticCheck.ok
        ? '这个预览可以作为草案说明；用户确认后可以调用桌面编排应用工具写入布局。'
        : '这个预览还有美学问题，应先调整位置、减少组件或弱化信息卡片。',
    }
  },
})

export const desktopSceneApplyTool = tool({
  description: '在用户明确确认“应用这个桌面草案/就按这个来/确认应用”后，按指定场景重新计算布局并写入真实桌面组件。应用前会自动创建快照，可用 rollback 撤回。不要在用户只是询问或预览时调用。',
  inputSchema: z.object({
    sceneId: z.string().default('minimal').describe('要应用的场景模板 id：minimal、night-focus、music-ambient。通常使用刚才预览的 sceneId。'),
    reason: z.string().optional().describe('本次应用原因，用于回滚快照说明。'),
    allowAestheticIssues: z.boolean().default(false).describe('是否允许带着美学检查错误强制应用。默认 false。'),
  }),
  execute: async ({ sceneId, reason, allowAestheticIssues }) => {
    const template = getDesktopSceneTemplate(sceneId)
    if (!template) {
      return {
        ok: false,
        error: 'scene-not-found',
        availableScenes: summarizeTemplate(),
      }
    }

    const widgets = listWidgetsForTool()
    const plan = buildDesktopSceneLayoutPlan({
      sceneId: template.id,
      currentWidgets: widgets,
      screen: getPrimaryScreenSize(),
    })

    if (!allowAestheticIssues && !plan.aestheticCheck.ok) {
      showDesktopScenePreviewForTool(plan)
      return {
        ok: false,
        error: 'aesthetic-check-failed',
        plan: summarizePlan(plan),
        guidance: '美学检查仍有阻断问题，已重新投到桌面预览。请先调整草案，或在用户明确接受风险时再强制应用。',
      }
    }

    const result = applyDesktopScenePlanForTool({
      plan,
      reason: reason?.trim() || `应用 ${template.displayName}`,
    })
    if (result.ok && template.petState && (PET_EXPRESSION_STATES as readonly string[]).includes(template.petState)) {
      expressPet({ state: template.petState as PetExpressionState, durationMs: 4000 })
    }

    return {
      ok: result.ok,
      sceneId: plan.sceneId,
      sceneName: plan.sceneName,
      snapshot: result.snapshot ? summarizeSnapshot(result.snapshot) : undefined,
      appliedPatches: result.appliedPatches,
      skippedPatches: result.skippedPatches,
      count: result.widgets.length,
      aestheticCheck: plan.aestheticCheck,
      guidance: result.snapshot
        ? `已应用桌面草案，并创建回滚快照 ${result.snapshot.id}。如果用户不喜欢，可以调用 desktop_scene_rollback 撤回。`
        : undefined,
    }
  },
})

export const desktopSceneRollbackTool = tool({
  description: '撤回最近一次 AI 桌面编排，恢复应用前的组件布局、启用状态和配置。用户说“撤回刚才的桌面布置/回滚/恢复之前布局/不喜欢这个方案”时使用。',
  inputSchema: z.object({
    snapshotId: z.string().optional().describe('要恢复的快照 id。未提供时恢复最近一次桌面编排快照。'),
  }),
  execute: async ({ snapshotId }) => {
    const result = rollbackDesktopSceneForTool(snapshotId)
    return {
      ok: result.ok,
      error: result.error,
      snapshot: result.snapshot ? summarizeSnapshot(result.snapshot) : undefined,
      count: result.widgets.length,
      guidance: result.ok ? '已恢复到应用桌面草案前的布局。' : '没有找到可回滚的桌面编排快照。',
    }
  },
})
