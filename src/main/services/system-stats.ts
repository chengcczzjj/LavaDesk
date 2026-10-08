import os from 'os'
import { cpuPercentBetween, sumCpuTimes, type CpuTimesSample, type SystemStats } from '@shared/system-stats'

let previous: CpuTimesSample | null = null

/** One reading for the system monitor widget; CPU use is measured against the previous call. */
export function sampleSystemStats(): SystemStats {
  const cpus = os.cpus()
  const next = sumCpuTimes(cpus)
  const cpuPercent = cpuPercentBetween(previous, next)
  previous = next
  const total = os.totalmem()
  return {
    cpuPercent,
    memoryUsedBytes: Math.max(0, total - os.freemem()),
    memoryTotalBytes: total,
    cores: cpus.length,
    uptimeSeconds: Math.round(os.uptime()),
    sampledAt: Date.now(),
  }
}
