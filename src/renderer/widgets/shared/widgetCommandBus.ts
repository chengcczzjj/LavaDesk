import { useEffect, useRef } from 'react'
import type { WidgetCommand, WidgetCommandEnvelope } from '@shared/widget-command'

/**
 * Canvas-side fan-out for transient widget commands (pet reactions, white
 * noise playback). A widget that mounts right after a command — e.g. the
 * white-noise widget the companion just added — still receives it.
 */
type Listener = (command: WidgetCommandEnvelope) => void

const REPLAY_WINDOW_MS = 5000
const listeners = new Set<Listener>()
let recent: WidgetCommandEnvelope[] = []
let subscribed = false

function ensureSubscribed(): void {
  if (subscribed || typeof window === 'undefined' || !window.canvasBridge?.onWidgetCommand) return
  subscribed = true
  window.canvasBridge.onWidgetCommand((command) => {
    const now = Date.now()
    recent = [...recent.filter((item) => now - item.issuedAt < REPLAY_WINDOW_MS), command]
    for (const listener of listeners) listener(command)
  })
}

export function useWidgetCommands<T extends WidgetCommand['target']>(
  target: T,
  handler: (command: Extract<WidgetCommandEnvelope, { target: T }>) => void,
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    ensureSubscribed()
    const listener: Listener = (command) => {
      if (command.target === target) handlerRef.current(command as Extract<WidgetCommandEnvelope, { target: T }>)
    }
    const now = Date.now()
    for (const command of recent) {
      if (command.target === target && now - command.issuedAt < REPLAY_WINDOW_MS) listener(command)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [target])
}
