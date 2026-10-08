import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, Maximize2, Paperclip, RotateCcw, Sparkles, Square, Upload, X } from 'lucide-react'
import type { ActionConfirmDecision, ActionConfirmRequest } from '@shared/agent-actions'
import type { ChatAttachment } from '@shared/chat-attachments'
import type { ChatMessage } from '@shared/types'
import { getToolManifest } from '@shared/tool-manifest'
import { isDeclinedToolOutput, isFailedToolOutput, readActionReceipt, type ActionReceipt } from '@shared/tool-result'
import { MarkdownText } from '@renderer/shared/chat/MarkdownText'
import { ActionConfirmCard } from '@renderer/shared/chat/ActionConfirmCard'
import { ActionReceipts } from '@renderer/shared/chat/ActionReceipts'
import { AttachmentChips } from '@renderer/shared/chat/AttachmentChips'
import { useAttachmentDrop } from '@renderer/shared/chat/attachmentDrop'

interface QuickMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  receipts?: ActionReceipt[]
  attachments?: ChatAttachment[]
}

interface ActiveTool {
  toolCallId: string
  toolName: string
  status: 'running' | 'done' | 'error' | 'declined'
}

const SUGGESTIONS = ['随便换一张壁纸', '放点雨声', '20 分钟后提醒我喝水', '把天气放到右上角', '打开记事本']

function readAttachments(value: unknown): ChatAttachment[] {
  return Array.isArray(value) ? value.filter((item): item is ChatAttachment => Boolean(item && typeof item === 'object' && typeof (item as ChatAttachment).id === 'string')) : []
}

function buildMessages(events: ChatMessage[]): QuickMessage[] {
  const result: QuickMessage[] = []
  let receipts: ActionReceipt[] = []
  for (const event of events) {
    if (event.eventType === 'user_message') {
      result.push({ id: event.id, role: 'user', text: event.content.text ?? '', attachments: readAttachments(event.content.attachments) })
    } else if (event.eventType === 'tool_result') {
      const receipt = readActionReceipt(event.content.output)
      if (receipt) receipts.push(receipt)
    } else if (event.eventType === 'assistant_message' && event.content.text) {
      result.push({ id: event.id, role: 'assistant', text: event.content.text, receipts })
      receipts = []
    }
  }
  return result.slice(-30)
}

function toolLabel(toolName: string): string {
  return getToolManifest(toolName)?.label ?? '处理中'
}

export function QuickChat() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<QuickMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [tools, setTools] = useState<ActiveTool[]>([])
  const [receipts, setReceipts] = useState<ActionReceipt[]>([])
  const [confirms, setConfirms] = useState<ActionConfirmRequest[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const streamTextRef = useRef('')
  const receiptsRef = useRef<ActionReceipt[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const loadConversation = useCallback(async (reset = false) => {
    const { conversationId: id, history } = await window.quickChat.chat.getQuickConversation({ reset })
    setConversationId(id)
    setMessages(buildMessages(history))
  }, [])

  useEffect(() => {
    void loadConversation()
    return window.quickChat.window.onShown(() => {
      focusInput()
      if (!streamIdRef.current) void loadConversation()
    })
  }, [focusInput, loadConversation])

  useEffect(() => {
    const api = window.quickChat.chat
    const finish = (text: string) => {
      const finalReceipts = receiptsRef.current
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text, receipts: finalReceipts }])
      streamIdRef.current = null
      streamTextRef.current = ''
      receiptsRef.current = []
      setStreaming(false)
      setStreamText('')
      setTools([])
      setReceipts([])
      setConfirms([])
      focusInput()
    }
    const offs = [
      api.onStreamChunk(({ streamId, delta }) => {
        if (streamId !== streamIdRef.current) return
        streamTextRef.current += delta
        setStreamText(streamTextRef.current)
      }),
      api.onStreamEnd(({ streamId, full, conversationId: id }) => {
        if (streamId !== streamIdRef.current) return
        setConversationId(id)
        finish(full || streamTextRef.current)
      }),
      api.onStreamError(({ streamId }) => {
        if (streamId !== streamIdRef.current) return
        finish(streamTextRef.current || '我这边刚刚卡了一下，你再说一次？')
      }),
      api.onToolCall(({ streamId, toolCallId, toolName, status, output, error: toolError }) => {
        if (streamId !== streamIdRef.current) return
        if (status === 'start') {
          setTools((prev) => [...prev, { toolCallId, toolName, status: 'running' }])
          return
        }
        const receipt = readActionReceipt(output)
        if (receipt) {
          receiptsRef.current = [...receiptsRef.current, receipt]
          setReceipts(receiptsRef.current)
        }
        const nextStatus: ActiveTool['status'] = isDeclinedToolOutput(output) ? 'declined' : isFailedToolOutput(output, toolError) ? 'error' : 'done'
        setTools((prev) => prev.map((tool) => tool.toolCallId === toolCallId ? { ...tool, status: nextStatus } : tool))
      }),
      api.onActionConfirmRequest((request) => {
        if (request.streamId !== streamIdRef.current) return
        setConfirms((prev) => [...prev.filter((item) => item.confirmId !== request.confirmId), request])
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [focusInput])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streamText, tools, confirms])

  const send = useCallback((raw?: string) => {
    const text = (raw ?? input).trim() || (attachments.length > 0 ? '帮我看看这些附件' : '')
    if (!text || streamIdRef.current) return
    setError(null)
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text, attachments }])
    streamTextRef.current = ''
    receiptsRef.current = []
    setStreamText('')
    setTools([])
    setReceipts([])
    setStreaming(true)
    streamIdRef.current = window.quickChat.chat.sendMessage({
      conversationId: conversationId ?? undefined,
      text,
      ...(attachments.length > 0 ? { attachmentIds: attachments.map((item) => item.id) } : {}),
    })
    setInput('')
    setAttachments([])
  }, [attachments, conversationId, input])

  const stop = useCallback(() => {
    const streamId = streamIdRef.current
    if (streamId) void window.quickChat.chat.stopStream(streamId)
  }, [])

  const resolveConfirm = useCallback(async (request: ActionConfirmRequest, decision: ActionConfirmDecision) => {
    setConfirms((prev) => prev.filter((item) => item.confirmId !== request.confirmId))
    const delivered = await window.quickChat.chat.resolveActionConfirm(request.confirmId, decision)
    if (!delivered) setError('这张确认卡已经过期了。')
  }, [])

  const attach = useCallback(async () => {
    const result = await window.quickChat.chat.attachFiles(conversationId)
    if (result.attachments.length > 0) setAttachments((prev) => [...prev, ...result.attachments].slice(0, 8))
    if (result.rejected.length > 0) setError(result.rejected.map((item) => `${item.name}：${item.reason}`).join('；'))
    focusInput()
  }, [conversationId, focusInput])

  const undo = useCallback((id: string) => window.quickChat.chat.undoAction(id), [])
  const loadActionStatus = useCallback((ids: string[]) => window.quickChat.chat.getActionStatus(ids), [])

  const addAttachments = useCallback((added: ChatAttachment[]) => {
    setAttachments((prev) => [...prev, ...added].slice(0, 8))
    focusInput()
  }, [focusInput])
  const drop = useAttachmentDrop({
    attachData: (files) => window.quickChat.chat.attachData(files, conversationId),
    onAttached: addAttachments,
    onRejected: setError,
    disabled: streaming,
  })

  // Grow with the text up to about five lines, then scroll.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 110)}px`
  }, [input])

  const lastUserText = [...messages].reverse().find((message) => message.role === 'user')?.text ?? ''

  const runningTool = [...tools].reverse().find((tool) => tool.status === 'running')
  const empty = messages.length === 0 && !streaming

  return (
    <div
      className={`qc ${drop.dragging ? 'qc--dragging' : ''}`}
      {...drop.dropProps}
      onKeyDown={(event) => {
        if (event.key === 'Escape') window.quickChat.window.hide()
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !streaming) {
          event.preventDefault()
          void loadConversation(true)
        }
      }}
    >
      {drop.dragging && (
        <div className="qc__drop" aria-hidden="true">
          <Upload size={22} />
          <span>松开添加图片或文件</span>
        </div>
      )}
      <header className="qc__header">
        <div className="qc__brand">
          <Sparkles size={15} />
          <span>灵月</span>
          <small>{streaming ? (runningTool ? `${toolLabel(runningTool.toolName)}中…` : '正在想…') : '桌面快聊'}</small>
        </div>
        <div className="qc__header-actions">
          <button type="button" title="新话题（Ctrl+N）" onClick={() => void loadConversation(true)} disabled={streaming}><RotateCcw size={14} /></button>
          <button type="button" title="在主界面继续" onClick={() => window.quickChat.window.openMain(conversationId ?? undefined)}><Maximize2 size={14} /></button>
          <button type="button" title="收起（Esc）" onClick={() => window.quickChat.window.hide()}><X size={15} /></button>
        </div>
      </header>

      <main className="qc__messages">
        {empty && (
          <div className="qc__empty">
            <div className="qc__empty-title">想让我帮你做点什么？</div>
            <div className="qc__suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)}>{suggestion}</button>
              ))}
            </div>
            <div className="qc__empty-hint">Ctrl+V 粘贴截图让我看 · 拖入文件 · ↑ 找回上一句</div>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`qc__msg qc__msg--${message.role}`}>
            {message.attachments && message.attachments.length > 0 && <AttachmentChips attachments={message.attachments} />}
            {message.text && (
              <div className="qc__bubble">
                {message.role === 'assistant' ? <MarkdownText text={message.text} /> : message.text}
              </div>
            )}
            {message.receipts && message.receipts.length > 0 && <ActionReceipts receipts={message.receipts} onUndo={undo} onLoadStatus={loadActionStatus} />}
          </div>
        ))}
        {streaming && (
          <div className="qc__msg qc__msg--assistant">
            {tools.length > 0 && (
              <div className="qc__tools">
                {tools.map((tool) => (
                  <span key={tool.toolCallId} className={`qc__tool qc__tool--${tool.status}`}>
                    {tool.status === 'running' ? <Loader2 size={11} className="ly-spin" /> : tool.status === 'error' ? '!' : tool.status === 'declined' ? '–' : '✓'}
                    {toolLabel(tool.toolName)}
                  </span>
                ))}
              </div>
            )}
            <div className="qc__bubble">
              {streamText ? <MarkdownText text={streamText} /> : <span className="qc__dots"><i /><i /><i /></span>}
            </div>
            {receipts.length > 0 && <ActionReceipts receipts={receipts} onUndo={undo} />}
          </div>
        )}
        {confirms.map((request) => (
          <ActionConfirmCard key={request.confirmId} request={request} onResolve={resolveConfirm} compact />
        ))}
        <div ref={endRef} />
      </main>

      {error && (
        <div className="qc__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      <footer className="qc__composer">
        {attachments.length > 0 && (
          <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))} />
        )}
        <div className="qc__input-row">
          <button type="button" className="qc__icon-btn" title="添加照片和文件" onClick={() => void attach()} disabled={streaming}>
            <Paperclip size={16} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="说点什么… Enter 发送，Shift+Enter 换行"
            onChange={(event) => setInput(event.target.value)}
            onPaste={drop.onPaste}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              } else if (event.key === 'ArrowUp' && !input && lastUserText) {
                // Like a terminal: bring back the last thing said, to fix or resend it.
                event.preventDefault()
                setInput(lastUserText)
              }
            }}
          />
          {streaming ? (
            <button type="button" className="qc__send" title="停止" onClick={stop}><Square size={13} /></button>
          ) : (
            <button type="button" className="qc__send" title="发送" onClick={() => send()} disabled={!input.trim() && attachments.length === 0}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
