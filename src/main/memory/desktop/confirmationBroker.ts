import { randomUUID } from 'crypto'
import type { ActionConfirmDecision, ActionConfirmRequest } from '@shared/agent-actions'

/** How long a confirmation card waits before the action counts as declined. */
export const ACTION_CONFIRM_TIMEOUT_MS = 120_000

export type ActionConfirmOutcome = ActionConfirmDecision | 'timeout' | 'cancelled'

interface PendingConfirmation {
  streamId: string
  resolve: (outcome: ActionConfirmOutcome) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingConfirmation>()

/**
 * Suspend a tool call until the user answers the card in the chat surface
 * that started the turn. The same call then runs with its original input, so
 * nothing depends on the model repeating itself after the approval.
 */
export function requestActionConfirmation(params: {
  request: Omit<ActionConfirmRequest, 'confirmId' | 'expiresAt'>
  send: (request: ActionConfirmRequest) => boolean
  abortSignal?: AbortSignal
}): Promise<ActionConfirmOutcome> {
  const confirmId = randomUUID()
  const request: ActionConfirmRequest = { ...params.request, confirmId, expiresAt: Date.now() + ACTION_CONFIRM_TIMEOUT_MS }
  return new Promise((resolve) => {
    if (params.abortSignal?.aborted) {
      resolve('cancelled')
      return
    }
    const finish = (outcome: ActionConfirmOutcome) => {
      const entry = pending.get(confirmId)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(confirmId)
      params.abortSignal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => finish('cancelled')
    pending.set(confirmId, {
      streamId: request.streamId,
      resolve: finish,
      timer: setTimeout(() => finish('timeout'), ACTION_CONFIRM_TIMEOUT_MS),
    })
    params.abortSignal?.addEventListener('abort', onAbort, { once: true })
    if (!params.send(request)) finish('cancelled')
  })
}

export function resolveActionConfirmation(confirmId: string, decision: ActionConfirmDecision): boolean {
  const entry = pending.get(confirmId)
  if (!entry) return false
  entry.resolve(decision)
  return true
}

export function cancelActionConfirmations(streamId: string): void {
  for (const [, entry] of pending) {
    if (entry.streamId === streamId) entry.resolve('cancelled')
  }
}
