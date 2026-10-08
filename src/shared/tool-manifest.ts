export type ToolCategory =
  | 'companion'
  | 'memory'
  | 'widget'
  | 'desktop-scene'
  | 'desktop'
  | 'attachment'
  | 'workspace-read'
  | 'workspace-write'
  | 'document'
  | 'command'

export type ToolRisk = 'read-only' | 'low' | 'medium' | 'high' | 'critical'

export interface ToolManifestEntry<Name extends string = string> {
  name: Name
  category: ToolCategory
  risk: ToolRisk
  cacheable: boolean
  tracksAgentRun: boolean
  label: string
  compactLabel: string
  /**
   * The tool changes the desktop (widgets, wallpaper, display layout). The chat
   * service snapshots that state around the call so the change can be undone.
   */
  journal?: true
}

function defineTool<const Name extends string>(entry: ToolManifestEntry<Name>): ToolManifestEntry<Name> {
  return entry
}

export const TOOL_MANIFEST = [
  defineTool({ name: 'get_current_time', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '获取时间', compactLabel: '时间' }),
  defineTool({ name: 'get_user_location', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '获取位置', compactLabel: '位置' }),
  defineTool({ name: 'calculator', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '计算器', compactLabel: '计算' }),
  defineTool({ name: 'web_search', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '网络搜索', compactLabel: '网页搜索' }),
  defineTool({ name: 'read_clipboard', category: 'companion', risk: 'read-only', cacheable: false, tracksAgentRun: false, label: '读取剪贴板', compactLabel: '剪贴板' }),
  defineTool({ name: 'write_clipboard', category: 'companion', risk: 'low', cacheable: false, tracksAgentRun: false, label: '写入剪贴板', compactLabel: '剪贴板' }),
  defineTool({ name: 'open_url', category: 'companion', risk: 'low', cacheable: false, tracksAgentRun: false, label: '打开链接', compactLabel: '链接' }),
  defineTool({ name: 'get_system_info', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '系统信息', compactLabel: '系统' }),
  defineTool({ name: 'memory_store', category: 'memory', risk: 'low', cacheable: false, tracksAgentRun: false, label: '存储记忆', compactLabel: '记忆' }),
  defineTool({ name: 'memory_recall', category: 'memory', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '回忆', compactLabel: '回忆' }),
  defineTool({ name: 'weather', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '天气查询', compactLabel: '天气' }),
  defineTool({ name: 'news', category: 'companion', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '新闻热搜', compactLabel: '资讯' }),
  defineTool({ name: 'list_widgets', category: 'widget', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '查看组件', compactLabel: '组件' }),
  defineTool({ name: 'add_widget', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '添加组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'update_widget_config', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '调整组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'arrange_widget', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '摆放组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'update_generated_widget', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '修改生成组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'remove_widget', category: 'widget', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '移除组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'create_generated_widget', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '生成桌面组件', compactLabel: '组件', journal: true }),
  defineTool({ name: 'open_lavanotes', category: 'widget', risk: 'low', cacheable: false, tracksAgentRun: false, label: '打开便签', compactLabel: '便签' }),
  defineTool({ name: 'widget_capability_list', category: 'widget', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '组件能力', compactLabel: '组件' }),
  defineTool({ name: 'desktop_scene_get', category: 'desktop-scene', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '桌面上下文', compactLabel: '桌面编排' }),
  defineTool({ name: 'desktop_scene_preview', category: 'desktop-scene', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '桌面草案', compactLabel: '桌面编排' }),
  defineTool({ name: 'desktop_scene_apply', category: 'desktop-scene', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '应用桌面草案', compactLabel: '桌面编排', journal: true }),
  defineTool({ name: 'desktop_scene_rollback', category: 'desktop-scene', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '回滚桌面布局', compactLabel: '桌面编排', journal: true }),
  defineTool({ name: 'wallpaper', category: 'desktop', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '壁纸', compactLabel: '壁纸', journal: true }),
  defineTool({ name: 'desktop_mode', category: 'desktop', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '桌面模式', compactLabel: '桌面模式', journal: true }),
  defineTool({ name: 'ambient_sound', category: 'desktop', risk: 'low', cacheable: false, tracksAgentRun: false, label: '白噪音', compactLabel: '白噪音', journal: true }),
  defineTool({ name: 'app_control', category: 'desktop', risk: 'high', cacheable: false, tracksAgentRun: false, label: '打开应用', compactLabel: '应用' }),
  defineTool({ name: 'system_control', category: 'desktop', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '系统操作', compactLabel: '系统' }),
  defineTool({ name: 'pet_express', category: 'desktop', risk: 'low', cacheable: false, tracksAgentRun: false, label: '桌宠互动', compactLabel: '桌宠' }),
  defineTool({ name: 'reminder', category: 'desktop', risk: 'low', cacheable: false, tracksAgentRun: false, label: '提醒', compactLabel: '提醒' }),
  defineTool({ name: 'undo_last_action', category: 'desktop', risk: 'medium', cacheable: false, tracksAgentRun: false, label: '撤回操作', compactLabel: '撤回' }),
  defineTool({ name: 'read_attachment', category: 'attachment', risk: 'read-only', cacheable: true, tracksAgentRun: false, label: '读取附件', compactLabel: '附件' }),
  defineTool({ name: 'list_directory', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '列目录', compactLabel: '读取' }),
  defineTool({ name: 'read_file', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '读取文件', compactLabel: '读取' }),
  defineTool({ name: 'search_text', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '搜索文本', compactLabel: '搜索' }),
  defineTool({ name: 'get_file_info', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '文件信息', compactLabel: '读取' }),
  defineTool({ name: 'create_checkpoint', category: 'workspace-write', risk: 'low', cacheable: false, tracksAgentRun: true, label: '创建快照', compactLabel: '快照' }),
  defineTool({ name: 'restore_checkpoint', category: 'workspace-write', risk: 'high', cacheable: false, tracksAgentRun: true, label: '恢复快照', compactLabel: '快照' }),
  defineTool({ name: 'compare_file_versions', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '版本对比', compactLabel: '读取' }),
  defineTool({ name: 'create_file', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '创建文件', compactLabel: '文件' }),
  defineTool({ name: 'patch_file', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '修改文件', compactLabel: '文件' }),
  defineTool({ name: 'write_file', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '写入文件', compactLabel: '文件' }),
  defineTool({ name: 'create_directory', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '创建目录', compactLabel: '文件' }),
  defineTool({ name: 'copy_path', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '复制文件', compactLabel: '文件' }),
  defineTool({ name: 'move_path', category: 'workspace-write', risk: 'high', cacheable: false, tracksAgentRun: true, label: '移动文件', compactLabel: '文件' }),
  defineTool({ name: 'delete_to_trash', category: 'workspace-write', risk: 'high', cacheable: false, tracksAgentRun: true, label: '移入回收区', compactLabel: '文件' }),
  defineTool({ name: 'restore_from_trash', category: 'workspace-write', risk: 'high', cacheable: false, tracksAgentRun: true, label: '回收区恢复', compactLabel: '文件' }),
  defineTool({ name: 'generate_artifact', category: 'workspace-write', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '生成产物', compactLabel: '产物' }),
  defineTool({ name: 'verify_workspace_result', category: 'workspace-read', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '验证结果', compactLabel: '验证' }),
  defineTool({ name: 'run_command', category: 'command', risk: 'critical', cacheable: false, tracksAgentRun: true, label: '运行命令', compactLabel: '命令' }),
  defineTool({ name: 'extract_pdf_text', category: 'document', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '读取PDF', compactLabel: '读取' }),
  defineTool({ name: 'read_docx', category: 'document', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '读取Word', compactLabel: '读取' }),
  defineTool({ name: 'write_docx', category: 'document', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '生成Word', compactLabel: '产物' }),
  defineTool({ name: 'read_xlsx', category: 'document', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '读取Excel', compactLabel: '读取' }),
  defineTool({ name: 'write_xlsx', category: 'document', risk: 'medium', cacheable: false, tracksAgentRun: true, label: '生成Excel', compactLabel: '产物' }),
  defineTool({ name: 'ocr_image', category: 'document', risk: 'read-only', cacheable: true, tracksAgentRun: true, label: '图片识别', compactLabel: '读取' }),
] as const

export type RegisteredToolName = typeof TOOL_MANIFEST[number]['name']

const TOOL_MANIFEST_BY_NAME = new Map<string, ToolManifestEntry>(
  TOOL_MANIFEST.map((entry) => [entry.name, entry]),
)

export function getToolManifest(name: string): ToolManifestEntry | undefined {
  return TOOL_MANIFEST_BY_NAME.get(name)
}

export function getToolNamesByCategory(category: ToolCategory): RegisteredToolName[] {
  return TOOL_MANIFEST
    .filter((entry) => entry.category === category)
    .map((entry) => entry.name)
}
