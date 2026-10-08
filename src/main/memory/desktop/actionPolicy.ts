import type { ActionPolicyResult } from '@shared/agent-actions'
import { normalizeAppName } from '@shared/system-control'
import { store } from '../../store'
import { AppIndex } from './appIndex'
import { findWidget, isIconWidgetType, widgetDisplayName } from './desktopState'

/**
 * Which desktop actions need the user's explicit yes. This is enforced here,
 * around the tool call, so a model cannot talk itself past it.
 */

const MAX_GRANTS = 200

function readGrants(): string[] {
  const grants = store.get('agentActionGrants')
  return Array.isArray(grants) ? grants.filter((grant): grant is string => typeof grant === 'string') : []
}

export function hasActionGrant(key: string): boolean {
  return readGrants().includes(key)
}

export function addActionGrant(key: string): void {
  const grants = readGrants().filter((grant) => grant !== key)
  store.set('agentActionGrants', [key, ...grants].slice(0, MAX_GRANTS))
}

export function listActionGrants(): string[] {
  return readGrants()
}

/** Settings: take back an "以后都直接做" answer ('*' clears all). */
export function revokeActionGrant(key: string): string[] {
  const next = key === '*' ? [] : readGrants().filter((grant) => grant !== key)
  store.set('agentActionGrants', next)
  return next
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function evaluateActionPolicy(toolName: string, input: unknown): Promise<ActionPolicyResult> {
  const args = asRecord(input)

  if (toolName === 'remove_widget') {
    const target = findWidget(stringField(args, 'id'), stringField(args, 'type'))
    if (target && isIconWidgetType(target.type)) {
      return {
        decision: 'confirm',
        risk: 'high',
        title: `要把「${widgetDisplayName(target)}」整个删掉吗？`,
        detail: '里面放的是你的桌面图标，删除时我会尽量把它们移回桌面。只是暂时不想看到的话，可以改成调低透明度。',
      }
    }
    return { decision: 'auto' }
  }

  if (toolName === 'app_control' && stringField(args, 'action') === 'open') {
    if (!AppIndex.supported()) return { decision: 'auto' }
    const entry = await AppIndex.resolve({ appId: stringField(args, 'appId'), query: stringField(args, 'query') })
    if (!entry) return { decision: 'auto' }
    const rememberKey = `app:${normalizeAppName(entry.name)}`
    if (hasActionGrant(rememberKey)) return { decision: 'auto' }
    return {
      decision: 'confirm',
      risk: 'high',
      title: `要我帮你打开「${entry.name}」吗？`,
      detail: entry.source === 'dock' ? '来自你的 Dock / 图标收纳。' : entry.source === 'desktop' ? '来自桌面快捷方式。' : entry.source === 'system' ? 'Windows 自带工具。' : '来自开始菜单。',
      rememberKey,
    }
  }

  if (toolName === 'system_control' && stringField(args, 'action') === 'screenshot') {
    if (hasActionGrant('system:screenshot')) return { decision: 'auto' }
    return {
      decision: 'confirm',
      risk: 'medium',
      title: '要我截一张现在的屏幕吗？',
      detail: '截图只保存在本机「图片/灵月截图」文件夹；需要我看图时才会发给当前模型。',
      rememberKey: 'system:screenshot',
    }
  }

  return { decision: 'auto' }
}
