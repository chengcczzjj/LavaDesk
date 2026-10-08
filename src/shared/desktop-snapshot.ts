/**
 * Compact, deterministic description of the user's desktop for the model's
 * context. It lets the companion act on "把天气挪到右边" without first
 * listing widgets, and keeps follow-ups grounded in the real state.
 */

export interface SnapshotWidget {
  id: string
  type: string
  displayName: string
  visible: boolean
  /** Human position label such as 右上, from describeAreaPosition. */
  position?: string
  detail?: string
}

export interface DesktopSnapshotInput {
  displayCount: number
  primarySize?: { width: number; height: number }
  displayMode: string
  wallpaper?: { name: string; type: string; volume?: number; speed?: number } | null
  widgets: SnapshotWidget[]
  pet?: { onDesktop: boolean; name?: string; state?: string }
  reminders?: { pending: number; next?: { text: string; at: number } }
  quietHours?: { start: string; end: string } | null
  customModes?: string[]
  now?: number
}

const DISPLAY_MODE_LABELS: Record<string, string> = {
  primary: '仅主屏',
  duplicate: '每屏相同',
  'per-display': '每屏独立',
  span: '跨屏延展',
}

const WALLPAPER_TYPE_LABELS: Record<string, string> = {
  video: '视频',
  image: '图片',
  web: '网页',
}

const MAX_LISTED_WIDGETS = 14

/** Position of a rectangle's centre inside an area, as a 3×3 grid label. */
export function describeAreaPosition(
  rect: { x: number; y: number; width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
): string {
  if (area.width <= 0 || area.height <= 0) return ''
  const cx = (rect.x + rect.width / 2 - area.x) / area.width
  const cy = (rect.y + rect.height / 2 - area.y) / area.height
  const col = cx < 1 / 3 ? 0 : cx > 2 / 3 ? 2 : 1
  const row = cy < 1 / 3 ? 0 : cy > 2 / 3 ? 2 : 1
  return [
    ['左上', '上方', '右上'],
    ['左侧', '中间', '右侧'],
    ['左下', '下方', '右下'],
  ][row][col]
}

function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDesktopSnapshot(input: DesktopSnapshotInput): string {
  const lines: string[] = []
  const size = input.primarySize ? `，主屏 ${input.primarySize.width}×${input.primarySize.height}` : ''
  lines.push(`显示器：${input.displayCount} 块${size}；壁纸模式：${DISPLAY_MODE_LABELS[input.displayMode] ?? input.displayMode}`)

  if (input.wallpaper) {
    const extras: string[] = []
    if (typeof input.wallpaper.volume === 'number' && input.wallpaper.type !== 'image') extras.push(`音量 ${Math.round(input.wallpaper.volume)}`)
    if (typeof input.wallpaper.speed === 'number' && input.wallpaper.speed !== 1 && input.wallpaper.type === 'video') extras.push(`速度 ${input.wallpaper.speed}x`)
    lines.push(`壁纸：「${input.wallpaper.name}」（${WALLPAPER_TYPE_LABELS[input.wallpaper.type] ?? input.wallpaper.type}${extras.length ? `，${extras.join('，')}` : ''}）`)
  } else {
    lines.push('壁纸：未设置')
  }

  const widgets = input.widgets
  if (widgets.length === 0) {
    lines.push('组件：桌面上还没有组件')
  } else {
    lines.push(`组件（${widgets.length}）：`)
    for (const widget of widgets.slice(0, MAX_LISTED_WIDGETS)) {
      const parts = [widget.displayName, widget.position, widget.visible ? '' : '已隐藏', widget.detail].filter(Boolean)
      lines.push(`- ${widget.id}：${parts.join('·')}`)
    }
    if (widgets.length > MAX_LISTED_WIDGETS) lines.push(`- 另有 ${widgets.length - MAX_LISTED_WIDGETS} 个组件，需要时用 list_widgets 查看`)
  }

  if (input.pet) {
    lines.push(input.pet.onDesktop
      ? `桌宠：${input.pet.name ?? '在桌面上'}${input.pet.state ? `（${input.pet.state}）` : ''}`
      : '桌宠：还没放到桌面（需要时可以用 add_widget 添加 pet）')
  }

  if (input.reminders) {
    lines.push(input.reminders.pending > 0
      ? `提醒：${input.reminders.pending} 条待触发${input.reminders.next ? `，最近一条 ${formatClock(input.reminders.next.at)}「${input.reminders.next.text}」` : ''}`
      : '提醒：暂无')
  }
  if (input.quietHours) lines.push(`安静时段：${input.quietHours.start}–${input.quietHours.end}`)
  if (input.customModes && input.customModes.length > 0) lines.push(`已保存的桌面模式：${input.customModes.slice(0, 8).join('、')}`)
  return lines.join('\n')
}
