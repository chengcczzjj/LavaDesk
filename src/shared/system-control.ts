/**
 * Allow-lists for the companion's light Windows control. Only these settings
 * pages, folders and keys are reachable; nothing takes a free-form command.
 */

export const SETTINGS_PAGES = {
  home: { uri: 'ms-settings:', label: '系统设置首页' },
  display: { uri: 'ms-settings:display', label: '显示设置' },
  night_light: { uri: 'ms-settings:nightlight', label: '夜间模式' },
  sound: { uri: 'ms-settings:sound', label: '声音设置' },
  notifications: { uri: 'ms-settings:notifications', label: '通知设置' },
  focus: { uri: 'ms-settings:quiethours', label: '专注助手' },
  power: { uri: 'ms-settings:powersleep', label: '电源和睡眠' },
  battery: { uri: 'ms-settings:batterysaver', label: '电池设置' },
  storage: { uri: 'ms-settings:storagesense', label: '存储设置' },
  bluetooth: { uri: 'ms-settings:bluetooth', label: '蓝牙和设备' },
  network: { uri: 'ms-settings:network-status', label: '网络设置' },
  wifi: { uri: 'ms-settings:network-wifi', label: 'WLAN 设置' },
  personalization: { uri: 'ms-settings:personalization', label: '个性化' },
  background: { uri: 'ms-settings:personalization-background', label: '系统背景' },
  colors: { uri: 'ms-settings:personalization-colors', label: '颜色与深浅色' },
  taskbar: { uri: 'ms-settings:taskbar', label: '任务栏设置' },
  apps: { uri: 'ms-settings:appsfeatures', label: '应用和功能' },
  default_apps: { uri: 'ms-settings:defaultapps', label: '默认应用' },
  startup_apps: { uri: 'ms-settings:startupapps', label: '启动应用' },
  mouse: { uri: 'ms-settings:mousetouchpad', label: '鼠标设置' },
  keyboard: { uri: 'ms-settings:typing', label: '输入设置' },
  language: { uri: 'ms-settings:regionlanguage', label: '语言和区域' },
  date_time: { uri: 'ms-settings:dateandtime', label: '日期和时间' },
  privacy: { uri: 'ms-settings:privacy', label: '隐私设置' },
  location: { uri: 'ms-settings:privacy-location', label: '定位权限' },
  windows_update: { uri: 'ms-settings:windowsupdate', label: 'Windows 更新' },
  about: { uri: 'ms-settings:about', label: '关于本机' },
} as const

export type SettingsPageId = keyof typeof SETTINGS_PAGES
export const SETTINGS_PAGE_IDS = Object.keys(SETTINGS_PAGES) as SettingsPageId[]

export const KNOWN_FOLDERS = {
  desktop: '桌面',
  downloads: '下载',
  documents: '文档',
  pictures: '图片',
  music: '音乐',
  videos: '视频',
  home: '用户文件夹',
  screenshots: '灵月截图',
  recycle_bin: '回收站',
} as const

export type KnownFolderId = keyof typeof KNOWN_FOLDERS
export const KNOWN_FOLDER_IDS = Object.keys(KNOWN_FOLDERS) as KnownFolderId[]

/** Windows virtual-key codes for media and volume keys. */
export const MEDIA_KEYS = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  stop: 0xb2,
  volume_up: 0xaf,
  volume_down: 0xae,
  mute: 0xad,
} as const

export type MediaKeyId = keyof typeof MEDIA_KEYS

/** Each volume key press changes the Windows master volume by 2%. */
export const VOLUME_STEP_PERCENT = 2

export function volumeKeyPresses(percent: number): number {
  return Math.max(1, Math.min(50, Math.round(Math.abs(percent) / VOLUME_STEP_PERCENT)))
}

// ─── App search ───────────────────────────────────────────────

export interface AppIndexEntry {
  id: string
  name: string
  /** Shortcut, .url or executable that launches the app. */
  path: string
  source: 'start-menu' | 'desktop' | 'dock' | 'system'
}

/**
 * Common Chinese names users say for apps whose shortcuts are named in
 * English (or vice versa). Matching still requires an indexed shortcut.
 */
export const APP_ALIASES: Record<string, string[]> = {
  微信: ['wechat', 'weixin'],
  企业微信: ['wxwork', 'wecom'],
  qq: ['qq', 'tencent qq'],
  钉钉: ['dingtalk', 'dingding'],
  飞书: ['feishu', 'lark'],
  网易云音乐: ['cloudmusic', 'netease cloud music', '网易云'],
  qq音乐: ['qqmusic'],
  酷狗: ['kugou'],
  浏览器: ['edge', 'chrome', 'firefox', 'msedge'],
  谷歌浏览器: ['chrome', 'google chrome'],
  edge: ['microsoft edge', 'msedge'],
  记事本: ['notepad'],
  计算器: ['calculator', 'calc'],
  画图: ['paint', 'mspaint'],
  截图工具: ['snipping tool', 'snippingtool', '截图'],
  任务管理器: ['task manager', 'taskmgr'],
  资源管理器: ['file explorer', 'explorer', '文件资源管理器'],
  控制面板: ['control panel'],
  设置: ['settings'],
  word: ['microsoft word', 'winword'],
  excel: ['microsoft excel'],
  ppt: ['powerpoint', 'microsoft powerpoint'],
  wps: ['wps office', 'kingsoft'],
  vscode: ['visual studio code', 'code'],
  steam: ['steam'],
  哔哩哔哩: ['bilibili', 'b站'],
  腾讯会议: ['wemeet', 'tencent meeting'],
  百度网盘: ['baidunetdisk', 'baidu netdisk'],
  outlook: ['microsoft outlook'],
  终端: ['windows terminal', 'terminal'],
}

export function normalizeAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(lnk|url|exe|appref-ms)$/i, '')
    .replace(/[\s_\-·.()（）[\]]+/g, '')
}

function expandQuery(query: string): string[] {
  const normalized = normalizeAppName(query)
  const terms = new Set([normalized])
  for (const [alias, names] of Object.entries(APP_ALIASES)) {
    const aliasKey = normalizeAppName(alias)
    const nameKeys = names.map(normalizeAppName)
    if (aliasKey === normalized || nameKeys.includes(normalized)) {
      terms.add(aliasKey)
      for (const name of nameKeys) terms.add(name)
    }
  }
  return [...terms].filter(Boolean)
}

const UNINSTALL_PATTERN = /uninstall|卸载|readme|帮助|help|manual|说明|website|官网|release notes/i

/** Score how well an indexed app matches what the user said; 0 means no match. */
export function scoreAppMatch(query: string, entry: Pick<AppIndexEntry, 'name' | 'source'>): number {
  if (UNINSTALL_PATTERN.test(entry.name)) return 0
  const name = normalizeAppName(entry.name)
  if (!name) return 0
  let best = 0
  for (const term of expandQuery(query)) {
    if (!term) continue
    if (name === term) best = Math.max(best, 100)
    else if (name.startsWith(term)) best = Math.max(best, 80 - Math.min(20, name.length - term.length))
    else if (name.includes(term)) best = Math.max(best, 60 - Math.min(20, name.length - term.length))
    else if (term.length >= 3 && term.includes(name)) best = Math.max(best, 40)
  }
  if (best === 0) return 0
  const sourceBonus = entry.source === 'dock' ? 6 : entry.source === 'desktop' ? 4 : entry.source === 'start-menu' ? 2 : 0
  return best + sourceBonus
}

export function searchApps<T extends AppIndexEntry>(query: string, entries: readonly T[], limit = 5): T[] {
  const seen = new Set<string>()
  return entries
    .map((entry) => ({ entry, score: scoreAppMatch(query, entry) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.name.length - right.entry.name.length)
    .filter((item) => {
      const key = normalizeAppName(item.entry.name)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((item) => item.entry)
}
