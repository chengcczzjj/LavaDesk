/**
 * IPC 通道常量集中定义。
 * 渲染进程与主进程必须使用同一组常量，避免散落硬编码字符串。
 */
export const IPC = {
  // 应用 / 窗口
  APP_QUIT: 'app:quit',
  APP_SHOW_MAIN: 'app:show-main',
  APP_NAVIGATE: 'app:navigate',
  APP_SCREEN_SNIP: 'app:screen-snip',
  SYSTEM_STATS: 'system:stats',
  APP_OPEN_SETTINGS: 'app:open-settings',
  APP_OPEN_EXPLORER: 'app:open-explorer',
  APP_OPEN_RECYCLE_BIN: 'app:open-recycle-bin',
  APP_SHOW_DESKTOP: 'app:show-desktop',
  APP_GET_VERSION: 'app:get-version',
  APP_GET_LAUNCH_AT_LOGIN: 'app:get-launch-at-login',
  APP_SET_LAUNCH_AT_LOGIN: 'app:set-launch-at-login',
  APP_UPDATE_GET_STATUS: 'app:update-get-status',
  APP_UPDATE_CHECK: 'app:update-check',
  APP_UPDATE_DOWNLOAD: 'app:update-download',
  APP_UPDATE_INSTALL: 'app:update-install',
  APP_UPDATE_STATE_CHANGED: 'app:update-state-changed',
  APP_GET_LOCATION_SETTINGS: 'app:get-location-settings',
  APP_SET_PRECISE_LOCATION_ENABLED: 'app:set-precise-location-enabled',
  APP_REQUEST_PRECISE_LOCATION_AUTHORIZATION: 'app:request-precise-location-authorization',
  APP_VALIDATE_PRECISE_LOCATION: 'app:validate-precise-location',
  APP_OPEN_LOCATION_SETTINGS: 'app:open-location-settings',
  // 主界面 → 主进程：独立便签软件 LavaNotes 的检测、唤起与下载
  LAVANOTES_STATUS: 'lavanotes:status',
  LAVANOTES_OPEN: 'lavanotes:open',
  LAVANOTES_DOWNLOAD: 'lavanotes:download',
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE_TOGGLE: 'win:maximize-toggle',
  WIN_CLOSE: 'win:close',

  // 壁纸
  WALLPAPER_LIST: 'wallpaper:list',
  WALLPAPER_APPLY: 'wallpaper:apply',
  WALLPAPER_GET_CURRENT: 'wallpaper:get-current',
  WALLPAPER_PICK_FILE: 'wallpaper:pick-file',
  WALLPAPER_GRANT_PREVIEW: 'wallpaper:grant-preview',
  WALLPAPER_IMPORT: 'wallpaper:import',
  WALLPAPER_REMOVE: 'wallpaper:remove',
  WALLPAPER_ATTACH_STATUS: 'wallpaper:attach-status',
  WALLPAPER_SAVE_SETTINGS: 'wallpaper:save-settings',
  WALLPAPER_UPDATE_SETTING: 'wallpaper:update-setting',
  WALLPAPER_DISPLAY_GET_SETTINGS: 'wallpaper-display:get-settings',
  WALLPAPER_DISPLAY_SET_MODE: 'wallpaper-display:set-mode',
  WALLPAPER_DISPLAY_SET_ASSIGNMENT: 'wallpaper-display:set-assignment',
  WALLPAPER_DISPLAY_LAYOUT: 'wallpaper-display:layout',
  WALLPAPER_DISPLAY_LAYOUT_CHANGED: 'wallpaper-display:layout-changed',
  WALLPAPER_DISPLAY_GET_LAYOUT: 'wallpaper-display:get-layout',
  WALLPAPER_RESOURCE_CATALOG: 'wallpaper-resource:catalog',
  WALLPAPER_RESOURCE_REFRESH: 'wallpaper-resource:refresh',
  WALLPAPER_RESOURCE_INSTALL: 'wallpaper-resource:install',
  WALLPAPER_RESOURCE_REMOVE: 'wallpaper-resource:remove',
  WALLPAPER_RESOURCE_PROGRESS: 'wallpaper-resource:progress',
  WALLPAPER_RESOURCE_CATALOG_CHANGED: 'wallpaper-resource:catalog-changed',
  // FlowWall 在线壁纸站（嵌入视图 + 下载导入）
  FLOWWALL_ATTACH: 'flowwall:attach',
  FLOWWALL_DETACH: 'flowwall:detach',
  FLOWWALL_NAVIGATE: 'flowwall:navigate',
  FLOWWALL_OPEN_EXTERNAL: 'flowwall:open-external',
  FLOWWALL_GET_STATE: 'flowwall:get-state',
  FLOWWALL_CANCEL_DOWNLOAD: 'flowwall:cancel-download',
  FLOWWALL_CLEAR_DOWNLOADS: 'flowwall:clear-downloads',
  // 主进程 → 主界面
  FLOWWALL_VIEW_STATE: 'flowwall:view-state',
  FLOWWALL_DOWNLOAD_CHANGED: 'flowwall:download-changed',
  WALLPAPER_OWNER_STATUS: 'wallpaper-owner:status',
  WALLPAPER_OWNER_CONFIGURE: 'wallpaper-owner:configure',
  WALLPAPER_OWNER_CLEAR_CREDENTIALS: 'wallpaper-owner:clear-credentials',
  WALLPAPER_OWNER_PUBLISH: 'wallpaper-owner:publish',
  WALLPAPER_OWNER_PUBLISH_PROGRESS: 'wallpaper-owner:publish-progress',
  // 主进程 → 壁纸窗口
  WALLPAPER_LOAD: 'wallpaper:load',
  // 壁纸窗口 → 主进程：媒体首帧/页面已可显示
  WALLPAPER_READY: 'wallpaper:ready',
  // 壁纸抽帧（壁纸窗口 → 主进程 → 画布窗口）
  WALLPAPER_FRAME: 'wallpaper:frame',
  // 画布根据当前组件声明是否需要实时壁纸帧
  WALLPAPER_CAPTURE_DEMAND: 'wallpaper:capture-demand',

  // 桌面组件
  WIDGET_LIST: 'widget:list',
  WIDGET_ADD: 'widget:add',
  WIDGET_REMOVE: 'widget:remove',
  WIDGET_UPDATE: 'widget:update',
  WIDGET_UPDATE_CONFIG: 'widget:update-config',
  WIDGET_CONFIG_SAVE: 'widget:config-save',
  WIDGET_CONFIG_LOAD: 'widget:config-load',
  DESKTOP_ICON_IMPORT: 'desktop-icon:import',
  DESKTOP_ICON_LAUNCH: 'desktop-icon:launch',
  DESKTOP_ICON_REFRESH: 'desktop-icon:refresh',
  DESKTOP_ICON_CONTEXT_MENU: 'desktop-icon:context-menu',
  // 主进程 → 画布
  WIDGET_SYNC: 'widget:sync',
  DESKTOP_SCENE_PREVIEW_SHOW: 'desktop-scene:preview-show',
  DESKTOP_SCENE_PREVIEW_CLEAR: 'desktop-scene:preview-clear',
  // 主进程 → 画布：桌宠反应、白噪音播放等不落盘的组件指令
  WIDGET_COMMAND: 'widget:command',
  // 画布 → 主进程：鼠标穿透切换
  CANVAS_SET_IGNORE_MOUSE: 'canvas:set-ignore-mouse',
  // 画布 → 主进程：指针手势生命周期，防止拖拽中途穿透
  CANVAS_SET_POINTER_ACTIVE: 'canvas:set-pointer-active',
  // 画布 → 主进程：Dock 交互链路持久化诊断事件
  CANVAS_DIAGNOSTIC: 'canvas:diagnostic',
  // 主进程 -> 画布：Windows 透明窗口丢失 pointerdown 时的 Dock 单击兜底
  CANVAS_NATIVE_DOCK_CLICK: 'canvas:native-dock-click',
  // 画布 → 主进程：原生右键菜单
  CANVAS_CONTEXT_MENU: 'canvas:context-menu',
  // 画布 → 主进程：编辑模式（z-order + 穿透 + 焦点）
  CANVAS_SET_EDIT_MODE: 'canvas:set-edit-mode',
  // 主进程 → 画布：桌面被全屏窗口遮挡/重新可见
  CANVAS_OCCLUSION_CHANGED: 'canvas:occlusion-changed',
  // 主进程 → 画布：原生鼠标抬起但 renderer 丢失 pointerup 时强制清理手势
  CANVAS_POINTER_RESET: 'canvas:pointer-reset',
  // 画布 → 主进程：按实际 DOM 渲染结果上报可交互组件的命中区域
  CANVAS_SET_HIT_REGIONS: 'canvas:set-hit-regions',
  // 主进程 → 画布：光标处组件被其他窗口遮住，暂停悬停反馈
  CANVAS_POINTER_OCCLUDED: 'canvas:pointer-occluded',
  // 主进程 → 壁纸窗口：暂停/恢复帧捕获（全屏遮挡优化）
  WALLPAPER_PAUSE_CAPTURE: 'wallpaper:pause-capture',

  // 数据服务
  DATA_FETCH_NEWS: 'data:fetch-news',
  DATA_FETCH_STOCKS: 'data:fetch-stocks',
  DATA_FETCH_WEATHER: 'data:fetch-weather',
  DATA_GET_API_REGISTRY: 'data:get-api-registry',

  // AI 聊天
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_STREAM_CHUNK: 'chat:stream-chunk',
  CHAT_STREAM_END: 'chat:stream-end',
  CHAT_STREAM_ERROR: 'chat:stream-error',
  CHAT_TOOL_CALL: 'chat:tool-call',
  CHAT_NEW_CONVERSATION: 'chat:new-conversation',
  CHAT_LIST_CONVERSATIONS: 'chat:list-conversations',
  CHAT_GET_HISTORY: 'chat:get-history',
  CHAT_DELETE_CONVERSATION: 'chat:delete-conversation',
  CHAT_RENAME_CONVERSATION: 'chat:rename-conversation',
  CHAT_ARCHIVE_CONVERSATION: 'chat:archive-conversation',
  CHAT_UNARCHIVE_CONVERSATION: 'chat:unarchive-conversation',
  CHAT_MOVE_CONVERSATION: 'chat:move-conversation',
  CHAT_EXPORT_CONVERSATION: 'chat:export-conversation',
  CHAT_LIST_PROFILES: 'chat:list-profiles',
  CHAT_UPSERT_PROFILE: 'chat:upsert-profile',
  CHAT_DELETE_PROFILE: 'chat:delete-profile',
  CHAT_SET_ACTIVE_PROFILE: 'chat:set-active-profile',
  CHAT_TEST_PROFILE: 'chat:test-profile',
  CHAT_GET_ACTIVE_PROFILE: 'chat:get-active-profile',
  CHAT_STOP_STREAM: 'chat:stop-stream',
  CHAT_LIST_MODELS: 'chat:list-models',
  CHAT_SAVE_PERSONA: 'chat:save-persona',
  CHAT_GET_PERSONA: 'chat:get-persona',
  CHAT_LIST_MEMORIES: 'chat:list-memories',
  // 主进程 → 聊天界面：桌面动作需要用户点头（工具调用在此挂起等待）
  CHAT_ACTION_CONFIRM_REQUEST: 'chat:action-confirm-request',
  CHAT_ACTION_CONFIRM_RESOLVE: 'chat:action-confirm-resolve',
  // 撤回某条桌面操作回执
  CHAT_ACTION_UNDO: 'chat:action-undo',
  CHAT_ACTION_STATUS: 'chat:action-status',
  // 用户显式选择的附件：登记一次性读取授权
  CHAT_ATTACH_FILES: 'chat:attach-files',
  CHAT_ATTACH_DATA: 'chat:attach-data',
  CHAT_DESKTOP_SCENE_CLEAR_PREVIEW: 'chat:desktop-scene-clear-preview',
  CHAT_GET_QUICK_CONVERSATION: 'chat:get-quick-conversation',

  // 桌面快捷对话窗口 / 伴侣设置
  QUICK_CHAT_TOGGLE: 'quick-chat:toggle',
  QUICK_CHAT_HIDE: 'quick-chat:hide',
  QUICK_CHAT_OPEN_MAIN: 'quick-chat:open-main',
  QUICK_CHAT_SHOWN: 'quick-chat:shown',
  COMPANION_GET_SETTINGS: 'companion:get-settings',
  COMPANION_SET_SETTINGS: 'companion:set-settings',
  COMPANION_REVOKE_ACTION_GRANT: 'companion:revoke-action-grant',

  // AgentRun
  AGENT_RUN_LIST_BY_THREAD: 'agent-run:list-by-thread',
  AGENT_RUN_GET: 'agent-run:get',
  AGENT_RUN_EVENT: 'agent-run:event',
  AGENT_APPROVAL_LIST_BY_RUN: 'agent-approval:list-by-run',
  AGENT_APPROVAL_RESOLVE: 'agent-approval:resolve',
  AGENT_FILE_CHANGE_LIST_BY_RUN: 'agent-file-change:list-by-run',
  AGENT_FILE_CHANGE_SET_REVIEW_STATE: 'agent-file-change:set-review-state',
  AGENT_FILE_CHANGE_RESTORE: 'agent-file-change:restore',
  AGENT_FILE_CHANGE_OPEN: 'agent-file-change:open',
  AGENT_FILE_CHANGE_SHOW_IN_FOLDER: 'agent-file-change:show-in-folder',
  AGENT_ARTIFACT_LIST_BY_RUN: 'agent-artifact:list-by-run',
  AGENT_ARTIFACT_OPEN: 'agent-artifact:open',
  AGENT_ARTIFACT_SHOW_IN_FOLDER: 'agent-artifact:show-in-folder',
  AGENT_ARTIFACT_COPY_PATH: 'agent-artifact:copy-path',
  AGENT_AUTOMATION_LIST: 'agent-automation:list',
  AGENT_AUTOMATION_CREATE: 'agent-automation:create',
  AGENT_AUTOMATION_UPDATE: 'agent-automation:update',
  AGENT_AUTOMATION_DELETE: 'agent-automation:delete',
  AGENT_AUTOMATION_RUN_NOW: 'agent-automation:run-now',
  AGENT_AUTOMATION_RESULT_LIST: 'agent-automation-result:list',

  // 项目管理
  PROJECT_CREATE: 'project:create',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  PROJECT_PICK_FOLDER: 'project:pick-folder',
  PROJECT_OPEN_FOLDER: 'project:open-folder',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
