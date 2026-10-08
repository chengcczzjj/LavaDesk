import Store from 'electron-store'
import type { WallpaperState, WidgetInstance, ModelProfile, WallpaperDisplayMode } from '@shared/types'
import type { DesktopSceneSnapshot } from '@shared/desktop-scene'
import type { Reminder } from '@shared/reminders'
import type { CompanionSettings, DesktopMode } from '@shared/companion-settings'
import type { FlowWallDownload } from '@shared/flowwall'

interface ModelSettings {
  profiles: ModelProfile[]
  activeProfileId: string
}

interface PrivacySettings {
  preciseLocationEnabled: boolean
}

interface AppSettings {
  launchAtLogin: boolean
}

interface WallpaperDisplaySettingsStore {
  /** Determines whether wallpaper windows target one monitor, every monitor, or the virtual desktop. */
  mode: WallpaperDisplayMode
  /** Stable display key -> wallpaper id; absent entries fall back to wallpaper.current. */
  assignments: Record<string, string>
  /** Version of the persisted layout contract. Older releases used incompatible coordinates. */
  schemaVersion?: number
  /** Set after the user explicitly chooses a display layout. */
  userConfigured?: boolean
}

interface Schema {
  wallpaper: WallpaperState
  wallpaperDisplay: WallpaperDisplaySettingsStore
  widgets: WidgetInstance[]
  /** 跨壁纸保存的图标收纳与 Dock 组件 */
  globalIconWidgets?: WidgetInstance[]
  /** AI 桌面编排应用前后的可回滚快照 */
  desktopSceneSnapshots?: DesktopSceneSnapshot[]
  /** 主界面窗口最后位置 */
  mainWindowBounds?: { x: number; y: number; width: number; height: number }
  /** Legacy Canvas origin retained only while old widget coordinates are migrated. */
  widgetCoordinateOrigin?: { x: number; y: number }
  /** AI 模型配置 */
  modelSettings: ModelSettings
  /** AI 人设 */
  persona?: { name: string; prompt: string; avatar?: string }
  /** 隐私设置 */
  privacySettings: PrivacySettings
  /** 应用生命周期设置 */
  appSettings: AppSettings
  /** 伴侣提醒（主进程定时触发） */
  reminders?: Reminder[]
  /** 伴侣行为设置：快捷对话热键、安静时段 */
  companionSettings?: CompanionSettings
  /** 用户让伴侣保存的桌面模式 */
  desktopModes?: DesktopMode[]
  /** 用户选择“以后都允许”的桌面动作（如启动某个应用、截图） */
  agentActionGrants?: string[]
  /** 桌面快捷对话使用的会话 */
  quickChatConversationId?: string
  /** FlowWall 在线壁纸站的下载记录（去重与历史） */
  flowwallDownloads?: FlowWallDownload[]
}

const defaults: Schema = {
  wallpaper: { volume: 0.5, muted: true },
  // Start conservatively on the primary display. The user can opt into
  // duplicate, per-display, or span layouts after the first frame is stable.
  wallpaperDisplay: { mode: 'primary', assignments: {}, schemaVersion: 3, userConfigured: false },
  widgets: [],
  modelSettings: {
    profiles: [
      {
        id: 'default',
        name: 'Unimand',
        provider: 'openai-compatible',
        baseURL: 'https://your-api-domain.com/v1',
        apiKey: '',
        model: 'gpt-5.4',
      },
    ],
    activeProfileId: 'default',
  },
  privacySettings: {
    preciseLocationEnabled: false,
  },
  appSettings: {
    launchAtLogin: true,
  },
}

export const store = new Store<Schema>({
  name: 'lavadesk-config',
  defaults,
})
