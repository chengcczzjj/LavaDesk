import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, ShieldQuestion } from 'lucide-react'
import type { ActionConfirmDecision, ActionConfirmRequest } from '@shared/agent-actions'
import './chat-shared.css'

/**
 * The companion paused a desktop action (open an app, take a screenshot,
 * delete the Dock...) and waits here for the user's answer.
 * Enter confirms (the primary button has focus), Esc declines.
 */
export function ActionConfirmCard({
  request,
  onResolve,
  compact = false,
}: {
  request: ActionConfirmRequest
  onResolve: (request: ActionConfirmRequest, decision: ActionConfirmDecision) => void
  compact?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  const [answered, setAnswered] = useState<ActionConfirmDecision | null>(null)
  // The bar drains from whatever time was left when the card appeared.
  const initialMs = useRef(Math.max(1, request.expiresAt - Date.now()))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const remainingMs = Math.max(0, request.expiresAt - now)
  const secondsLeft = Math.ceil(remainingMs / 1000)

  const answer = (decision: ActionConfirmDecision) => {
    if (answered || remainingMs <= 0) return
    setAnswered(decision)
    onResolve(request, decision)
  }

  const Icon = request.risk === 'high' ? ShieldAlert : ShieldQuestion
  return (
    <div
      className={`ly-confirm ly-confirm--${request.risk} ${compact ? 'ly-confirm--compact' : ''} ${answered ? 'ly-confirm--answered' : ''}`}
      role="alertdialog"
      aria-label={request.title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          answer('deny')
        }
      }}
    >
      <div className="ly-confirm__head">
        <Icon size={16} />
        <div className="ly-confirm__title">{request.title}</div>
      </div>
      {request.detail && <div className="ly-confirm__detail">{request.detail}</div>}
      <div className="ly-confirm__actions">
        <span className="ly-confirm__timer">
          {answered
            ? answered === 'deny' ? '好，不做了' : '收到，马上做'
            : remainingMs <= 0 ? '已超时，这一步没有执行' : secondsLeft <= 30 ? `${secondsLeft}s 后自动取消` : 'Enter 确认 · Esc 不用了'}
        </span>
        <button type="button" disabled={Boolean(answered)} onClick={() => answer('deny')}>不用了</button>
        {request.rememberKey && (
          <button type="button" disabled={Boolean(answered)} onClick={() => answer('allow-always')} title="同类操作以后不再询问，可在设置里收回">
            以后都直接做
          </button>
        )}
        <button type="button" className="ly-confirm__primary" disabled={Boolean(answered)} onClick={() => answer('allow')} autoFocus>好的</button>
      </div>
      {!answered && remainingMs > 0 && (
        <div className="ly-confirm__countdown" aria-hidden="true">
          <div style={{ width: `${(remainingMs / initialMs.current) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
