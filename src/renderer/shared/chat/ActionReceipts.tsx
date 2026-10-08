import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Loader2, Undo2 } from 'lucide-react'
import type { ActionReceiptStatus } from '@shared/agent-actions'
import type { ActionReceipt } from '@shared/tool-result'
import './chat-shared.css'

type ReceiptState = { status: 'idle' | 'undoing' | 'undone' | 'error' | 'expired'; message?: string }

/** Desktop changes of one reply, each with a one-click undo, plus "undo all" for multi-step replies. */
export function ActionReceipts({
  receipts,
  onUndo,
  onLoadStatus,
}: {
  receipts: ActionReceipt[]
  onUndo: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** Reads the journal so receipts undone elsewhere (or lost to a restart) show their real state. */
  onLoadStatus?: (ids: string[]) => Promise<Record<string, ActionReceiptStatus>>
}) {
  const [states, setStates] = useState<Record<string, ReceiptState>>({})
  const [undoingAll, setUndoingAll] = useState(false)
  const idKey = useMemo(() => receipts.map((receipt) => receipt.id).join(','), [receipts])

  useEffect(() => {
    if (!onLoadStatus || !idKey) return
    let alive = true
    const refresh = () => {
      void onLoadStatus(idKey.split(',')).then((statuses) => {
        if (!alive) return
        setStates((prev) => {
          const next = { ...prev }
          for (const [id, status] of Object.entries(statuses)) {
            if (next[id]?.status === 'undoing') continue
            if (status === 'undone') next[id] = { status: 'undone' }
            else if (status === 'expired') next[id] = { status: 'expired', message: '应用重启后，之前的操作不能再撤回' }
          }
          return next
        })
      }).catch(() => undefined)
    }
    refresh()
    // "撤回刚才的" can also happen by talking; re-check when the window comes back.
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [idKey, onLoadStatus])

  const undo = useCallback(async (id: string): Promise<boolean> => {
    setStates((prev) => ({ ...prev, [id]: { status: 'undoing' } }))
    try {
      const result = await onUndo(id)
      setStates((prev) => ({ ...prev, [id]: result.ok ? { status: 'undone' } : { status: 'error', message: result.error } }))
      return result.ok
    } catch (error) {
      setStates((prev) => ({ ...prev, [id]: { status: 'error', message: (error as Error).message } }))
      return false
    }
  }, [onUndo])

  if (receipts.length === 0) return null
  const pending = receipts.filter((receipt) => receipt.undoable && (states[receipt.id]?.status ?? 'idle') === 'idle')

  const undoAll = async () => {
    setUndoingAll(true)
    // Newest first, so later edits come off before the ones they built on.
    for (const receipt of [...pending].reverse()) {
      if (!(await undo(receipt.id))) break
    }
    setUndoingAll(false)
  }

  return (
    <div className="ly-receipts">
      {receipts.map((receipt) => {
        const state = states[receipt.id] ?? { status: 'idle' }
        const canUndo = receipt.undoable && (state.status === 'idle' || state.status === 'undoing' || state.status === 'error')
        return (
          <div key={receipt.id} className={`ly-receipt ly-receipt--${state.status}`} title={state.message}>
            {state.status === 'expired' ? <Clock3 size={12} className="ly-receipt__icon" /> : <Check size={12} className="ly-receipt__icon" />}
            <span className="ly-receipt__text">{state.status === 'undone' ? `已撤回：${receipt.summary}` : receipt.summary}</span>
            {canUndo && (
              <button type="button" className="ly-receipt__undo" disabled={state.status === 'undoing' || undoingAll} onClick={() => void undo(receipt.id)}>
                {state.status === 'undoing' ? <Loader2 size={11} className="ly-spin" /> : <Undo2 size={11} />}
                {state.status === 'error' ? '重试' : '撤回'}
              </button>
            )}
            {state.status === 'error' && <span className="ly-receipt__error">{state.message ?? '没撤回成功'}</span>}
          </div>
        )
      })}
      {(pending.length >= 2 || undoingAll) && (
        <button type="button" className="ly-receipts__all" disabled={undoingAll} onClick={() => void undoAll()}>
          {undoingAll ? <Loader2 size={11} className="ly-spin" /> : <Undo2 size={11} />}
          全部撤回（{pending.length}）
        </button>
      )}
    </div>
  )
}
