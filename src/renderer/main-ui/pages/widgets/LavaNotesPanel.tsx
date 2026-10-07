import { useCallback, useEffect, useState } from 'react'
import { Download, ExternalLink, LayoutList, Plus, RefreshCw, StickyNote } from 'lucide-react'
import type { LavaNotesCommand, LavaNotesStatus } from '@shared/types'

/**
 * Sticky notes moved out of the desktop widget layer into the separate
 * LavaNotes app. This page opens it, or explains where to get it.
 */
export function LavaNotesPanel() {
  const [status, setStatus] = useState<LavaNotesStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await window.lingyue.lavanotes.status())
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.lingyue.lavanotes.status().then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const open = async (command: LavaNotesCommand) => {
    const result = await window.lingyue.lavanotes.open(command)
    setStatus(result)
    setMessage(result.opened ? null : result.installed ? 'LavaNotes 没有响应，请稍后再试。' : null)
  }

  const installed = status?.installed === true

  return (
    <section className="lavanotes-panel">
      <div className="lavanotes-panel__hero">
        <div className="lavanotes-panel__paper" aria-hidden>
          <i />
          <span />
          <span />
          <span />
        </div>
        <div className="lavanotes-panel__copy">
          <span className="lavanotes-panel__kicker"><StickyNote size={14} /> LavaNotes</span>
          <h2>便签已经独立成一个软件</h2>
          <p>
            每张便签都是一个可以拖动、缩放的透明纸张窗口，支持图片、表格和待办；还可以钉在桌面上，显示桌面或最小化全部窗口时也不会被收起。
          </p>
          {status === null ? (
            <p className="lavanotes-panel__hint">正在检查是否已安装…</p>
          ) : installed ? (
            <div className="lavanotes-panel__actions">
              <button type="button" className="lavanotes-panel__primary" onClick={() => void open('new')}><Plus size={15} />新建便签</button>
              <button type="button" onClick={() => void open('open')}><StickyNote size={15} />显示全部便签</button>
              <button type="button" onClick={() => void open('manager')}><LayoutList size={15} />便签管理</button>
            </div>
          ) : (
            <>
              <p className="lavanotes-panel__hint">这台电脑还没有安装 LavaNotes。安装后回到这里就能直接打开。</p>
              <div className="lavanotes-panel__actions">
                <button type="button" className="lavanotes-panel__primary" onClick={() => void window.lingyue.lavanotes.download()}>
                  <Download size={15} />下载安装 LavaNotes
                </button>
                <button type="button" disabled={checking} onClick={() => void check()}><RefreshCw size={15} />重新检测</button>
              </div>
            </>
          )}
          {message && <p className="lavanotes-panel__hint">{message}</p>}
          <button type="button" className="lavanotes-panel__link" onClick={() => void window.lingyue.lavanotes.download()}>
            LavaNotes 开源主页 <ExternalLink size={12} />
          </button>
        </div>
      </div>
      <p className="lavanotes-panel__footnote">
        旧版桌面便利贴不再显示在桌面上；它们的内容已在本机备份到数据目录的 legacy-sticky-notes 文件夹。
      </p>
    </section>
  )
}
