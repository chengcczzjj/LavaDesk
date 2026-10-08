import { useEffect, useState } from 'react'
import { Cpu, MemoryStick } from 'lucide-react'
import { FrostedGlassBackground } from '../FrostedGlassBackground'
import { formatGigabytes, formatUptime, loadLevel, type LoadLevel, type SystemStats } from '@shared/system-stats'
import './sys-monitor.css'

const POLL_MS = 2000
const HISTORY = 40
const LEVEL_COLORS: Record<LoadLevel, string> = { calm: '#0a84ff', busy: '#f59e0b', high: '#ef4444' }

/** CPU history as a filled sparkline; the newest sample sits at the right edge. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 100
  const height = 28
  if (values.length < 2) return <svg className="sysmon__spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" />
  const step = width / (HISTORY - 1)
  const offset = (HISTORY - values.length) * step
  const points = values.map((value, index) => `${(offset + index * step).toFixed(2)},${(height - (value / 100) * (height - 2) - 1).toFixed(2)}`)
  const line = points.join(' ')
  return (
    <svg className="sysmon__spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`${offset.toFixed(2)},${height} ${line} ${width},${height}`} fill={color} opacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export function SysMonitorWidget() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let alive = true
    let timer = 0
    const poll = async () => {
      if (!document.hidden) {
        try {
          const next = await window.canvasBridge.getSystemStats()
          if (!alive) return
          setStats(next)
          setUnavailable(false)
          const cpu = next.cpuPercent
          if (cpu !== null) setHistory((prev) => [...prev, cpu].slice(-HISTORY))
        } catch {
          if (alive) setUnavailable(true)
        }
      }
      if (alive) timer = window.setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  const cpu = stats?.cpuPercent ?? null
  const cpuColor = LEVEL_COLORS[loadLevel(cpu)]
  const memoryPercent = stats && stats.memoryTotalBytes > 0 ? (stats.memoryUsedBytes / stats.memoryTotalBytes) * 100 : 0
  const memoryColor = LEVEL_COLORS[loadLevel(memoryPercent)]

  return (
    <div className="sysmon" role="group" aria-label="系统状态">
      <FrostedGlassBackground />
      <div className="sysmon__body">
        <div className="sysmon__row">
          <div className="sysmon__label"><Cpu size={13} />处理器</div>
          <div className="sysmon__value" style={{ color: cpuColor }}>{cpu === null ? '—' : `${Math.round(cpu)}%`}</div>
        </div>
        <Sparkline values={history} color={cpuColor} />

        <div className="sysmon__row sysmon__row--memory">
          <div className="sysmon__label"><MemoryStick size={13} />内存</div>
          <div className="sysmon__value sysmon__value--small">
            {stats ? `${formatGigabytes(stats.memoryUsedBytes)} / ${formatGigabytes(stats.memoryTotalBytes)}` : '—'}
          </div>
        </div>
        <div className="sysmon__bar" role="meter" aria-label="内存占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(memoryPercent)}>
          <div style={{ width: `${memoryPercent}%`, background: memoryColor }} />
        </div>

        <div className="sysmon__foot">
          {unavailable ? '暂时读不到系统状态' : stats ? `${stats.cores} 核 · 已开机 ${formatUptime(stats.uptimeSeconds)}` : '正在读取…'}
        </div>
      </div>
    </div>
  )
}
