import { IPC } from '@shared/ipc-channels'
import type { PetExpressionState, WidgetCommand } from '@shared/widget-command'
import { getCanvasWindow } from '../../windows/canvasWindow'
import { listWidgetsForTool } from '../../ipc/widgetIpc'

let agentPhase: PetExpressionState | null = null
let phaseTimer: ReturnType<typeof setTimeout> | null = null

/** Send a transient command to live widgets on the desktop canvas. */
export function sendWidgetCommand(command: WidgetCommand): boolean {
  const canvas = getCanvasWindow()
  if (!canvas || canvas.isDestroyed() || canvas.webContents.isDestroyed()) return false
  canvas.webContents.send(IPC.WIDGET_COMMAND, { ...command, issuedAt: Date.now() })
  return true
}

export function hasDesktopPet(): boolean {
  return listWidgetsForTool().some((widget) => widget.type === 'pet' && widget.enabled)
}

/** A short reaction with an optional speech bubble. */
export function expressPet(params: { state?: PetExpressionState; message?: string; durationMs?: number }): boolean {
  if (!hasDesktopPet()) return false
  return sendWidgetCommand({
    target: 'pet',
    command: 'express',
    state: params.state,
    message: params.message?.slice(0, 80),
    durationMs: Math.max(1500, Math.min(60_000, params.durationMs ?? 6000)),
  })
}

/**
 * Mirror what the chat agent is doing on the desktop pet. The phase expires by
 * itself so a crashed turn never leaves the pet stuck in "thinking".
 */
export function setPetAgentPhase(state: PetExpressionState | null, ttlMs = 45_000): void {
  if (phaseTimer) clearTimeout(phaseTimer)
  phaseTimer = null
  if (agentPhase === state) return
  agentPhase = state
  sendWidgetCommand({ target: 'pet', command: 'phase', state })
  if (state) {
    phaseTimer = setTimeout(() => {
      agentPhase = null
      phaseTimer = null
      sendWidgetCommand({ target: 'pet', command: 'phase', state: null })
    }, ttlMs)
  }
}

export function getPetAgentState(): PetExpressionState | null {
  return agentPhase
}
