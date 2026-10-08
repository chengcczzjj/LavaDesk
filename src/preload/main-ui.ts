import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { CompanionSettings, CompanionSettingsSnapshot } from '@shared/companion-settings'
import type { FlowWallDownload, FlowWallViewState } from '@shared/flowwall'
import { createChatStreamApi } from './chat-stream'
import type { WallpaperApplyTarget, WallpaperItem, WallpaperSettings, WallpaperResourceCatalog, WallpaperResourceProgress, WallpaperResourceActionResult, WallpaperOwnerStatus, WallpaperOwnerConfigInput, WallpaperPublishInput, WallpaperPublishProgress, WallpaperPublishResult, WallpaperDisplayMode, WallpaperDisplaySettings, WidgetInstance, NewsItem, StockItem, StockSymbol, WeatherSnapshot, ApiEndpointMeta, ChatConversation, ChatMemory, ModelProfile, ConversationMode, ChatProject, AgentRun, AgentApproval, AgentApprovalDecision, AgentArtifact, AgentFileChange, AgentFileChangeReviewState, AgentAutomation, AgentAutomationResult, AgentAutomationScheduleType, AgentAutomationStatus, WorkspacePermissionProfile, AppUpdateStatus, LaunchAtLoginStatus, LavaNotesCommand, LavaNotesStatus } from '@shared/types'

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    getLaunchAtLogin: (): Promise<LaunchAtLoginStatus> => ipcRenderer.invoke(IPC.APP_GET_LAUNCH_AT_LOGIN),
    setLaunchAtLogin: (enabled: boolean): Promise<LaunchAtLoginStatus> =>
      ipcRenderer.invoke(IPC.APP_SET_LAUNCH_AT_LOGIN, enabled),
    getUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.APP_UPDATE_GET_STATUS),
    checkForUpdates: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK),
    downloadUpdate: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.APP_UPDATE_DOWNLOAD),
    installUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL),
    onUpdateStateChanged: (cb: (status: AppUpdateStatus) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on(IPC.APP_UPDATE_STATE_CHANGED, handler)
      return () => ipcRenderer.off(IPC.APP_UPDATE_STATE_CHANGED, handler)
    },
    getLocationSettings: (): Promise<{ preciseLocationEnabled: boolean }> => ipcRenderer.invoke(IPC.APP_GET_LOCATION_SETTINGS),
    setPreciseLocationEnabled: (enabled: boolean): Promise<{ ok: boolean; settings: { preciseLocationEnabled: boolean }; error?: string }> =>
      ipcRenderer.invoke(IPC.APP_SET_PRECISE_LOCATION_ENABLED, enabled),
    requestPreciseLocationAuthorization: (): Promise<{ ok: boolean; settings: { preciseLocationEnabled: boolean }; location?: { displayName: string; accuracyMeters?: number }; error?: string }> =>
      ipcRenderer.invoke(IPC.APP_REQUEST_PRECISE_LOCATION_AUTHORIZATION),
    validatePreciseLocation: (): Promise<{ ok: boolean; settings: { preciseLocationEnabled: boolean }; location?: { displayName: string; accuracyMeters?: number }; error?: string }> =>
      ipcRenderer.invoke(IPC.APP_VALIDATE_PRECISE_LOCATION),
    openLocationSettings: (): Promise<boolean> => ipcRenderer.invoke(IPC.APP_OPEN_LOCATION_SETTINGS),
    quit: (): void => ipcRenderer.send(IPC.APP_QUIT),
    getCompanionSettings: (): Promise<CompanionSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.COMPANION_GET_SETTINGS),
    setCompanionSettings: (patch: Partial<CompanionSettings>): Promise<CompanionSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.COMPANION_SET_SETTINGS, patch),
    revokeActionGrant: (key: string): Promise<CompanionSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.COMPANION_REVOKE_ACTION_GRANT, key),
    toggleQuickChat: (): void => ipcRenderer.send(IPC.QUICK_CHAT_TOGGLE),
    onNavigate: (cb: (target: { activity: string; subPage?: string; conversationId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, target: { activity: string; subPage?: string; conversationId?: string }) => cb(target)
      ipcRenderer.on(IPC.APP_NAVIGATE, handler)
      return () => ipcRenderer.off(IPC.APP_NAVIGATE, handler)
    },
  },
  /** Sticky notes live in the separate LavaNotes app. */
  lavanotes: {
    status: (): Promise<LavaNotesStatus> => ipcRenderer.invoke(IPC.LAVANOTES_STATUS),
    open: (command: LavaNotesCommand): Promise<LavaNotesStatus & { opened: boolean }> =>
      ipcRenderer.invoke(IPC.LAVANOTES_OPEN, command),
    download: (): Promise<boolean> => ipcRenderer.invoke(IPC.LAVANOTES_DOWNLOAD),
  },
  utils: {
    getFilePath: (file: File): string | undefined => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return undefined
      }
    },
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.WIN_MINIMIZE),
    maximizeToggle: () => ipcRenderer.send(IPC.WIN_MAXIMIZE_TOGGLE),
    close: () => ipcRenderer.send(IPC.WIN_CLOSE),
  },
  wallpaper: {
    list: (): Promise<WallpaperItem[]> => ipcRenderer.invoke(IPC.WALLPAPER_LIST),
    getCurrent: () => ipcRenderer.invoke(IPC.WALLPAPER_GET_CURRENT),
    apply: (item: WallpaperItem, target: WallpaperApplyTarget = 'current'): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WALLPAPER_APPLY, item, target),
    pickFile: (): Promise<WallpaperItem | null> => ipcRenderer.invoke(IPC.WALLPAPER_PICK_FILE),
    grantPreview: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WALLPAPER_GRANT_PREVIEW, filePath),
    attachStatus: (): Promise<boolean> => ipcRenderer.invoke(IPC.WALLPAPER_ATTACH_STATUS),
    saveSettings: (wallpaperId: string, settings: WallpaperSettings): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WALLPAPER_SAVE_SETTINGS, wallpaperId, settings),
    updateSetting: (wallpaperId: string, key: keyof WallpaperSettings, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WALLPAPER_UPDATE_SETTING, wallpaperId, key, value),
    getDisplaySettings: (): Promise<WallpaperDisplaySettings> =>
      ipcRenderer.invoke(IPC.WALLPAPER_DISPLAY_GET_SETTINGS),
    setDisplayMode: (mode: WallpaperDisplayMode): Promise<WallpaperDisplaySettings> =>
      ipcRenderer.invoke(IPC.WALLPAPER_DISPLAY_SET_MODE, mode),
    setDisplayAssignment: (displayId: number, wallpaperId: string | null): Promise<WallpaperDisplaySettings> =>
      ipcRenderer.invoke(IPC.WALLPAPER_DISPLAY_SET_ASSIGNMENT, displayId, wallpaperId),
    onDisplaySettingsChanged: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.WALLPAPER_DISPLAY_LAYOUT_CHANGED, handler)
      return () => ipcRenderer.off(IPC.WALLPAPER_DISPLAY_LAYOUT_CHANGED, handler)
    },
    import: (
      filePath: string,
      meta: { name: string; desc: string; author: string; contact: string }
    ): Promise<{ ok: boolean; item?: WallpaperItem; error?: string }> =>
      ipcRenderer.invoke(IPC.WALLPAPER_IMPORT, filePath, meta),
    remove: (wallpaperId: string): Promise<WallpaperResourceActionResult> =>
      ipcRenderer.invoke(IPC.WALLPAPER_REMOVE, wallpaperId),
    getResourceCatalog: (): Promise<WallpaperResourceCatalog> =>
      ipcRenderer.invoke(IPC.WALLPAPER_RESOURCE_CATALOG),
    refreshResourceCatalog: (): Promise<WallpaperResourceCatalog> =>
      ipcRenderer.invoke(IPC.WALLPAPER_RESOURCE_REFRESH),
    installResource: (resourceId: string): Promise<WallpaperResourceActionResult> =>
      ipcRenderer.invoke(IPC.WALLPAPER_RESOURCE_INSTALL, resourceId),
    removeResource: (resourceId: string): Promise<WallpaperResourceActionResult> =>
      ipcRenderer.invoke(IPC.WALLPAPER_RESOURCE_REMOVE, resourceId),
    onResourceProgress: (cb: (progress: WallpaperResourceProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: WallpaperResourceProgress) => cb(progress)
      ipcRenderer.on(IPC.WALLPAPER_RESOURCE_PROGRESS, handler)
      return () => ipcRenderer.off(IPC.WALLPAPER_RESOURCE_PROGRESS, handler)
    },
    onResourceCatalogChanged: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.WALLPAPER_RESOURCE_CATALOG_CHANGED, handler)
      return () => ipcRenderer.off(IPC.WALLPAPER_RESOURCE_CATALOG_CHANGED, handler)
    },
    getOwnerStatus: (): Promise<WallpaperOwnerStatus> =>
      ipcRenderer.invoke(IPC.WALLPAPER_OWNER_STATUS),
    configureOwner: (input: WallpaperOwnerConfigInput): Promise<WallpaperOwnerStatus> =>
      ipcRenderer.invoke(IPC.WALLPAPER_OWNER_CONFIGURE, input),
    clearOwnerCredentials: (): Promise<WallpaperOwnerStatus> =>
      ipcRenderer.invoke(IPC.WALLPAPER_OWNER_CLEAR_CREDENTIALS),
    publishResource: (input: WallpaperPublishInput): Promise<WallpaperPublishResult> =>
      ipcRenderer.invoke(IPC.WALLPAPER_OWNER_PUBLISH, input),
    onPublishProgress: (cb: (progress: WallpaperPublishProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: WallpaperPublishProgress) => cb(progress)
      ipcRenderer.on(IPC.WALLPAPER_OWNER_PUBLISH_PROGRESS, handler)
      return () => ipcRenderer.off(IPC.WALLPAPER_OWNER_PUBLISH_PROGRESS, handler)
    },
  },
  /** FlowWall 在线壁纸站：嵌入视图由主进程叠放在页面占位区域上。 */
  flowwall: {
    attach: (bounds: { x: number; y: number; width: number; height: number }): Promise<FlowWallViewState> =>
      ipcRenderer.invoke(IPC.FLOWWALL_ATTACH, bounds),
    detach: (): void => ipcRenderer.send(IPC.FLOWWALL_DETACH),
    navigate: (action: 'back' | 'forward' | 'reload' | 'home' | 'stop' | { url: string }): Promise<FlowWallViewState> =>
      ipcRenderer.invoke(IPC.FLOWWALL_NAVIGATE, action),
    openExternal: (): Promise<boolean> => ipcRenderer.invoke(IPC.FLOWWALL_OPEN_EXTERNAL),
    getState: (): Promise<{ view: FlowWallViewState; downloads: FlowWallDownload[] }> =>
      ipcRenderer.invoke(IPC.FLOWWALL_GET_STATE),
    cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.FLOWWALL_CANCEL_DOWNLOAD, id),
    clearDownloads: (): Promise<FlowWallDownload[]> => ipcRenderer.invoke(IPC.FLOWWALL_CLEAR_DOWNLOADS),
    onViewState: (cb: (state: FlowWallViewState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: FlowWallViewState) => cb(state)
      ipcRenderer.on(IPC.FLOWWALL_VIEW_STATE, handler)
      return () => ipcRenderer.off(IPC.FLOWWALL_VIEW_STATE, handler)
    },
    onDownloadChanged: (cb: (download: FlowWallDownload) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, download: FlowWallDownload) => cb(download)
      ipcRenderer.on(IPC.FLOWWALL_DOWNLOAD_CHANGED, handler)
      return () => ipcRenderer.off(IPC.FLOWWALL_DOWNLOAD_CHANGED, handler)
    },
  },
  widget: {
    list: (): Promise<WidgetInstance[]> => ipcRenderer.invoke(IPC.WIDGET_LIST),
    add: (w: WidgetInstance) => ipcRenderer.invoke(IPC.WIDGET_ADD, w),
    remove: (id: string) => ipcRenderer.invoke(IPC.WIDGET_REMOVE, id),
    update: (w: WidgetInstance) => ipcRenderer.invoke(IPC.WIDGET_UPDATE, w),
    updateConfig: (id: string, config: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC.WIDGET_UPDATE_CONFIG, id, config),
    saveConfig: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIDGET_CONFIG_SAVE),
    loadConfig: (wallpaperId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WIDGET_CONFIG_LOAD, wallpaperId),
  },
  data: {
    fetchNews: (source: string, maxItems: number): Promise<NewsItem[]> =>
      ipcRenderer.invoke(IPC.DATA_FETCH_NEWS, source, maxItems),
    fetchStocks: (symbols: StockSymbol[]): Promise<StockItem[]> =>
      ipcRenderer.invoke(IPC.DATA_FETCH_STOCKS, symbols),
    fetchWeather: (options?: { city?: string; days?: number }): Promise<WeatherSnapshot> =>
      ipcRenderer.invoke(IPC.DATA_FETCH_WEATHER, options),
    getApiRegistry: (): Promise<ApiEndpointMeta[]> =>
      ipcRenderer.invoke(IPC.DATA_GET_API_REGISTRY),
  },
  chat: {
    ...createChatStreamApi(),
    clearDesktopScenePreview: (): Promise<boolean> => ipcRenderer.invoke(IPC.CHAT_DESKTOP_SCENE_CLEAR_PREVIEW),
    newConversation: (mode?: ConversationMode): Promise<ChatConversation> =>
      ipcRenderer.invoke(IPC.CHAT_NEW_CONVERSATION, mode),
    listConversations: (): Promise<ChatConversation[]> =>
      ipcRenderer.invoke(IPC.CHAT_LIST_CONVERSATIONS),
    deleteConversation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_DELETE_CONVERSATION, id),
    renameConversation: (id: string, title: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_RENAME_CONVERSATION, id, title),
    archiveConversation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_ARCHIVE_CONVERSATION, id),
    unarchiveConversation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_UNARCHIVE_CONVERSATION, id),
    moveConversation: (id: string, projectId: string | null): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_MOVE_CONVERSATION, id, projectId),
    exportConversation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_EXPORT_CONVERSATION, id),
    listProfiles: (): Promise<ModelProfile[]> =>
      ipcRenderer.invoke(IPC.CHAT_LIST_PROFILES),
    getActiveProfile: (): Promise<ModelProfile | null> =>
      ipcRenderer.invoke(IPC.CHAT_GET_ACTIVE_PROFILE),
    upsertProfile: (profile: ModelProfile): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_UPSERT_PROFILE, profile),
    deleteProfile: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_DELETE_PROFILE, id),
    setActiveProfile: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_SET_ACTIVE_PROFILE, id),
    testProfile: (profile: ModelProfile): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CHAT_TEST_PROFILE, profile),
    listModels: (profile: ModelProfile): Promise<{ models: string[]; error?: string }> =>
      ipcRenderer.invoke(IPC.CHAT_LIST_MODELS, profile),
    savePersona: (persona: { name: string; prompt: string; avatar?: string }): Promise<boolean> =>
      ipcRenderer.invoke(IPC.CHAT_SAVE_PERSONA, persona),
    getPersona: (): Promise<{ name: string; prompt: string; avatar?: string }> =>
      ipcRenderer.invoke(IPC.CHAT_GET_PERSONA),
    listMemories: (): Promise<ChatMemory[]> =>
      ipcRenderer.invoke(IPC.CHAT_LIST_MEMORIES),
    listAgentRuns: (threadId: string): Promise<AgentRun[]> =>
      ipcRenderer.invoke(IPC.AGENT_RUN_LIST_BY_THREAD, threadId),
    getAgentRun: (id: string): Promise<AgentRun | null> =>
      ipcRenderer.invoke(IPC.AGENT_RUN_GET, id),
    listApprovals: (runId: string): Promise<AgentApproval[]> =>
      ipcRenderer.invoke(IPC.AGENT_APPROVAL_LIST_BY_RUN, runId),
    resolveApproval: (id: string, decision: AgentApprovalDecision): Promise<AgentApproval | null> =>
      ipcRenderer.invoke(IPC.AGENT_APPROVAL_RESOLVE, id, decision),
    listFileChanges: (runId: string): Promise<AgentFileChange[]> =>
      ipcRenderer.invoke(IPC.AGENT_FILE_CHANGE_LIST_BY_RUN, runId),
    setFileChangeReviewState: (id: string, reviewState: AgentFileChangeReviewState): Promise<AgentFileChange | null> =>
      ipcRenderer.invoke(IPC.AGENT_FILE_CHANGE_SET_REVIEW_STATE, id, reviewState),
    restoreFileChange: (id: string): Promise<{ ok: boolean; restored?: string[]; skipped?: string[]; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_FILE_CHANGE_RESTORE, id),
    openFileChange: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_FILE_CHANGE_OPEN, id),
    showFileChangeInFolder: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_FILE_CHANGE_SHOW_IN_FOLDER, id),
    listArtifacts: (runId: string): Promise<AgentArtifact[]> =>
      ipcRenderer.invoke(IPC.AGENT_ARTIFACT_LIST_BY_RUN, runId),
    openArtifact: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_ARTIFACT_OPEN, id),
    showArtifactInFolder: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_ARTIFACT_SHOW_IN_FOLDER, id),
    copyArtifactPath: (id: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_ARTIFACT_COPY_PATH, id),
    listAutomations: (): Promise<AgentAutomation[]> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_LIST),
    createAutomation: (data: { name: string; prompt: string; workspaceId?: string | null; conversationId?: string | null; scheduleType?: AgentAutomationScheduleType; intervalMinutes?: number | null; timeOfDay?: string | null }): Promise<AgentAutomation> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_CREATE, data),
    updateAutomation: (id: string, data: { name?: string; prompt?: string; workspaceId?: string | null; conversationId?: string | null; scheduleType?: AgentAutomationScheduleType; intervalMinutes?: number | null; timeOfDay?: string | null; status?: AgentAutomationStatus }): Promise<AgentAutomation | null> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_UPDATE, id, data),
    deleteAutomation: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_DELETE, id),
    runAutomationNow: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_RUN_NOW, id),
    listAutomationResults: (automationId?: string): Promise<AgentAutomationResult[]> =>
      ipcRenderer.invoke(IPC.AGENT_AUTOMATION_RESULT_LIST, automationId),
  },
  project: {
    create: (data: { name: string; path?: string; icon?: string; color?: string }): Promise<ChatProject> =>
      ipcRenderer.invoke(IPC.PROJECT_CREATE, data),
    list: (): Promise<ChatProject[]> =>
      ipcRenderer.invoke(IPC.PROJECT_LIST),
    get: (id: string): Promise<ChatProject | null> =>
      ipcRenderer.invoke(IPC.PROJECT_GET, id),
    update: (id: string, data: { name?: string; path?: string; icon?: string; color?: string; permissionProfile?: WorkspacePermissionProfile }): Promise<boolean> =>
      ipcRenderer.invoke(IPC.PROJECT_UPDATE, id, data),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.PROJECT_DELETE, id),
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.PROJECT_PICK_FOLDER),
    openFolder: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.PROJECT_OPEN_FOLDER, id),
  },
}

export type LingyueApi = typeof api

export function exposeMainUiApi(): void {
  if (process.contextIsolated) {
    try {
      contextBridge.exposeInMainWorld('lingyue', api)
    } catch (err) {
      console.error(err)
    }
  } else {
    ;(window as unknown as { lingyue: typeof api }).lingyue = api
  }
}
