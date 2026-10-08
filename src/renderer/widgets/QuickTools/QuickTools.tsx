import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, FolderOpen, Loader2, MessageCircle, Monitor, Scissors, Settings, StickyNote, X } from 'lucide-react'
import { FrostedGlassBackground } from '../FrostedGlassBackground'
import './quick-tools.css'

type ToolState = 'idle' | 'running' | 'done' | 'error'

interface QuickTool {
  id: string
  label: string
  hint: string
  icon: ReactNode
  tint: string
  run: () => Promise<boolean> | boolean
}

const TOOLS: QuickTool[] = [
  {
    id: 'chat',
    label: '快聊',
    hint: '唤出桌面快捷对话',
    icon: <MessageCircle size={18} />,
    tint: '#6366f1',
    run: () => {
      window.canvasBridge.toggleQuickChat()
      return true
    },
  },
  {
    id: 'snip',
    label: '截图',
    hint: '框选屏幕截图',
    icon: <Scissors size={18} />,
    tint: '#0ea5e9',
    run: async () => (await window.canvasBridge.startScreenSnip()).ok,
  },
  {
    id: 'note',
    label: '便签',
    hint: '用 LavaNotes 新建一张便签',
    icon: <StickyNote size={18} />,
    tint: '#f59e0b',
    run: () => window.canvasBridge.newLavaNote(),
  },
  {
    id: 'desktop',
    label: '桌面',
    hint: '显示桌面（再点一次还原窗口）',
    icon: <Monitor size={18} />,
    tint: '#10b981',
    run: () => window.canvasBridge.showDesktop(),
  },
  {
    id: 'files',
    label: '文件',
    hint: '打开文件资源管理器',
    icon: <FolderOpen size={18} />,
    tint: '#eab308',
    run: () => window.canvasBridge.openExplorer(),
  },
  {
    id: 'settings',
    label: '设置',
    hint: '打开 Windows 设置',
    icon: <Settings size={18} />,
    tint: '#64748b',
    run: () => window.canvasBridge.openSettings(),
  },
]

export function QuickToolsWidget() {
  const [states, setStates] = useState<Record<string, ToolState>>({})
  const timers = useRef<Record<string, number>>({})

  useEffect(() => () => Object.values(timers.current).forEach((timer) => window.clearTimeout(timer)), [])

  const settle = (id: string, state: ToolState) => {
    setStates((prev) => ({ ...prev, [id]: state }))
    window.clearTimeout(timers.current[id])
    timers.current[id] = window.setTimeout(() => setStates((prev) => ({ ...prev, [id]: 'idle' })), 1400)
  }

  const run = async (tool: QuickTool) => {
    if (states[tool.id] === 'running') return
    setStates((prev) => ({ ...prev, [tool.id]: 'running' }))
    try {
      settle(tool.id, (await tool.run()) ? 'done' : 'error')
    } catch {
      settle(tool.id, 'error')
    }
  }

  return (
    <div className="qtools">
      <FrostedGlassBackground />
      <div className="qtools__grid" role="toolbar" aria-label="快捷工具">
        {TOOLS.map((tool) => {
          const state = states[tool.id] ?? 'idle'
          return (
            <button
              key={tool.id}
              type="button"
              className={`qtools__tool qtools__tool--${state}`}
              style={{ ['--tool-tint' as string]: tool.tint }}
              title={state === 'error' ? `${tool.hint}（没有成功，再试一次）` : tool.hint}
              onClick={() => void run(tool)}
            >
              <span className="qtools__icon">
                {state === 'running' ? <Loader2 size={18} className="qtools__spin" /> : state === 'done' ? <Check size={18} /> : state === 'error' ? <X size={18} /> : tool.icon}
              </span>
              <span className="qtools__label">{tool.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
