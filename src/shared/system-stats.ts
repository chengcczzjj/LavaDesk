/** Live numbers for the desktop system monitor widget. */
export interface SystemStats {
  /** Whole-machine CPU use since the previous sample; null on the very first sample. */
  cpuPercent: number | null
  memoryUsedBytes: number
  memoryTotalBytes: number
  cores: number
  uptimeSeconds: number
  sampledAt: number
}

export interface CpuTimesSample {
  idle: number
  total: number
}

/** Sum per-core times (as reported by os.cpus()) into one machine-wide sample. */
export function sumCpuTimes(cpus: readonly { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuTimesSample {
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const { user, nice, sys, idle: cpuIdle, irq } = cpu.times
    idle += cpuIdle
    total += user + nice + sys + cpuIdle + irq
  }
  return { idle, total }
}

export function cpuPercentBetween(previous: CpuTimesSample | null, next: CpuTimesSample): number | null {
  if (!previous) return null
  const total = next.total - previous.total
  const idle = next.idle - previous.idle
  if (total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((1 - idle / total) * 1000) / 10))
}

export type LoadLevel = 'calm' | 'busy' | 'high'

export function loadLevel(percent: number | null): LoadLevel {
  if (percent === null || percent < 60) return 'calm'
  return percent < 85 ? 'busy' : 'high'
}

export function formatGigabytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${Math.max(1, minutes)} 分钟`
}
