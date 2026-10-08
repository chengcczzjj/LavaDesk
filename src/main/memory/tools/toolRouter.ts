import type { ChatProject } from '@shared/types'
import {
  TOOL_MANIFEST,
  getToolManifest,
  getToolNamesByCategory,
  type RegisteredToolName,
} from '@shared/tool-manifest'

export const REGISTERED_TOOL_NAMES = TOOL_MANIFEST.map((entry) => entry.name)
export type { RegisteredToolName } from '@shared/tool-manifest'

/**
 * Everyday companion and desktop-control tools are always offered. Picking
 * them by keywords made the companion silently unable to act whenever the
 * user phrased a request differently; the full set is small enough to send
 * every turn and keeps the tool prefix stable for provider-side caching.
 */
const ALWAYS_ON_TOOL_NAMES = [
  ...getToolNamesByCategory('companion'),
  ...getToolNamesByCategory('memory'),
  ...getToolNamesByCategory('widget'),
  ...getToolNamesByCategory('desktop'),
] satisfies readonly RegisteredToolName[]

const ATTACHMENT_TOOL_NAMES = getToolNamesByCategory('attachment')

const DESKTOP_SCENE_TOOL_NAMES = getToolNamesByCategory('desktop-scene')

const WORKSPACE_READ_TOOL_NAMES = getToolNamesByCategory('workspace-read')

const WORKSPACE_WRITE_TOOL_NAMES = getToolNamesByCategory('workspace-write')

const DOCUMENT_TOOL_NAMES = getToolNamesByCategory('document')

const COMMAND_TOOL_NAMES = getToolNamesByCategory('command')

export const AGENT_RUN_TOOL_NAMES = TOOL_MANIFEST
  .filter((entry) => entry.tracksAgentRun)
  .map((entry) => entry.name)

export interface ToolRouteDecision {
  toolNames: RegisteredToolName[]
  /** Widget tools are always available; this marks a turn that is clearly about widgets. */
  usesWidgets: boolean
  usesAttachments: boolean
  usesDesktopScene: boolean
  usesWorkspaceRead: boolean
  usesWorkspaceWrite: boolean
  usesDocuments: boolean
  usesCommand: boolean
}

export function isRegisteredToolName(name: string): name is RegisteredToolName {
  return (REGISTERED_TOOL_NAMES as readonly string[]).includes(name)
}

function includesAny(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0
  return pattern.test(text)
}

const WIDGET_NOUN = /组件|小组件|挂件|桌面组件|桌面文字|便签|便笺|便利贴|贴纸|待办|任务|周记|周总结|提醒|天气|日历|时钟|时间组件|日期|白噪音|音频可视化|频谱|快捷工具|桌宠|萌宠|股票|行情|自选股|看盘|新闻|热搜|清单|倒计时|进度卡|目标卡|信息卡|仪表盘|dock|程序坞|图标收纳|收纳盒|系统监控/i
const WIDGET_ACTION = /放到桌面|加到桌面|摆到桌面|添加|加一个|放一个|删掉|移除|隐藏|显示出来|恢复|挪|移到|移动|放到|左上|右上|左下|右下|角落|居中|放大|缩小|大一点|小一点|换成|换个|改成|改为|样式|风格|颜色|配色|主题|透明|深色|浅色|霓虹|毛玻璃|置顶/i

function isWidgetIntent(text: string): boolean {
  if (includesAny(text, /放到桌面|加到桌面|摆到桌面|调整.*桌面|改.*组件|桌面上.*(有什么|哪些)/i)) return true
  if (includesAny(text, /组件|小组件|挂件|便利贴|便笺|便签|待办|周总结|倒计时|仪表盘|自选股|看盘/i)) return true
  return includesAny(text, WIDGET_NOUN) && includesAny(text, WIDGET_ACTION)
}

/** Short follow-ups ("再大一点", "换回去", "撤回") refer to the widget work of the previous turns. */
function recentlyUsedCategory(recentToolNames: readonly string[] | undefined, category: 'widget' | 'desktop-scene'): boolean {
  return (recentToolNames ?? []).some((name) => getToolManifest(name)?.category === category)
}

function isDesktopSceneIntent(text: string): boolean {
  return includesAny(text, /(布置|整理|美化|收拾|装扮).{0,8}桌面|桌面编排|桌面.{0,6}(方案|布局|风格)|极简|专注|夜间|氛围|场景|模式|桌面.*好看|壁纸.*组件|不要挡住|不挡壁纸|应用.*草案|应用.*方案|确认应用|就按这个|就这样|回滚.*桌面|撤回.*桌面|恢复.*布局|还原.*桌面/i)
}

function isDocumentIntent(text: string): boolean {
  return includesAny(text, /pdf|docx|xlsx|excel|word|表格|文档|OCR|图片文字|识别图片/i)
}

function isCommandIntent(text: string): boolean {
  return includesAny(text, /运行|执行|命令|脚本|测试|构建|启动|npm|pnpm|yarn|python|node|typecheck|lint|build/i)
}

function isProblemInspectionIntent(text: string): boolean {
  return includesAny(text, /(检查|定位|排查|看看|查一下).*(工具|问题|失败|报错|错误|bug|为什么)|为什么.*(失败|报错|错误)|调试|修复|修一下|改一下/i)
}

function isWorkspaceWriteIntent(text: string): boolean {
  if (isWidgetIntent(text)) return false
  return includesAny(text, /创建文件|新建文件|写入|写到|保存到|存成|导出|输出到|修改文件|改写|替换|删除|移动|重命名|整理文件|归类文件|生成报告|生成文档|生成表格|生成HTML|生成JSON|修复|修一下|改一下/i)
}

function isWorkspaceReadIntent(text: string): boolean {
  if (isWidgetIntent(text)) return false
  return includesAny(text, /文件|文件夹|目录|项目|代码|工具|读取|查看|查找|搜索|分析|总结|检查|定位|排查|失败|报错|错误|bug|pdf|docx|xlsx|excel|word/i)
}

function addTools(target: Set<RegisteredToolName>, names: readonly RegisteredToolName[]): void {
  for (const name of names) target.add(name)
}

export function decideToolRoute(params: {
  text: string
  workspace?: ChatProject | null
  /** Tool names called in the last few turns of this conversation. */
  recentToolNames?: readonly string[]
  /** The conversation carries files the user attached. */
  hasAttachments?: boolean
}): ToolRouteDecision {
  const text = params.text ?? ''
  const hasWorkspace = Boolean(params.workspace?.rootPath ?? params.workspace?.path)
  const usesDesktopScene = isDesktopSceneIntent(text) || recentlyUsedCategory(params.recentToolNames, 'desktop-scene')
  const usesWidgets = isWidgetIntent(text) || usesDesktopScene || recentlyUsedCategory(params.recentToolNames, 'widget')
  const usesDocuments = isDocumentIntent(text)
  const usesProblemInspection = isProblemInspectionIntent(text)
  const usesCommand = isCommandIntent(text) && hasWorkspace
  const usesWorkspaceWrite = (isWorkspaceWriteIntent(text) || /修复|修一下|改一下|调试/.test(text)) && hasWorkspace
  const usesWorkspaceRead = (isWorkspaceReadIntent(text) || usesProblemInspection || usesWorkspaceWrite || usesCommand || usesDocuments) && hasWorkspace

  const usesAttachments = params.hasAttachments === true

  const selected = new Set<RegisteredToolName>()
  addTools(selected, ALWAYS_ON_TOOL_NAMES)

  if (usesAttachments) addTools(selected, ATTACHMENT_TOOL_NAMES)
  if (usesDesktopScene) addTools(selected, DESKTOP_SCENE_TOOL_NAMES)
  if (usesWorkspaceRead) addTools(selected, WORKSPACE_READ_TOOL_NAMES)
  if (usesWorkspaceWrite) addTools(selected, WORKSPACE_WRITE_TOOL_NAMES)
  if (usesDocuments) addTools(selected, DOCUMENT_TOOL_NAMES)
  if (usesCommand) addTools(selected, COMMAND_TOOL_NAMES)

  // Keep the manifest order so the tool list (and its cache prefix) is stable between turns.
  const toolNames = REGISTERED_TOOL_NAMES.filter((name) => selected.has(name))

  return {
    toolNames,
    usesWidgets,
    usesAttachments,
    usesDesktopScene,
    usesWorkspaceRead,
    usesWorkspaceWrite,
    usesDocuments,
    usesCommand,
  }
}

const CAPABILITY_BLOCK = `【本轮可用能力】
你可以在需要真实信息或真实操作时使用工具。不要暴露内部工具名；对用户只说自然的进展，比如“我看一下”“我帮你放上去”“我换一张给你”。能直接回答就直接回答；涉及实时信息、真实系统状态或要真的改动桌面时再用工具，工具前后用一句短的、符合人设的话过渡。`

const DESKTOP_CONTROL_BLOCK = `【桌面控制】
你能真的动用户的桌面，不要只口头答应：
- 桌面现状写在【桌面现状】里（每轮实时读取），里面的组件 id 可以直接用；信息不够时再用 list_widgets。
- 壁纸：换壁纸、随机换一张、调壁纸音量/速度、多屏模式、在线壁纸库搜索下载、带用户去 FlowWall 发现页逛新壁纸（action=flowwall；用户在页面里点下载后会自动进“我的壁纸”，我不替用户点下载），都用 wallpaper。组件是跟着壁纸保存的，换壁纸后桌面组件会变成那张壁纸自己的布局，第一次换时顺口提一句。
- 桌面模式：用户想“把现在的桌面存成工作模式/切到工作模式”用 desktop_mode；内置的极简/夜间专注/音乐氛围草案用桌面编排工具。
- 打开应用用 app_control(open)；系统操作（显示桌面、打开某个系统设置页、常用文件夹、音量、媒体播放暂停/切歌、截屏看屏幕）用 system_control；白噪音用 ambient_sound；提醒、定时、天气早报、久坐提醒、安静时段用 reminder（时间按【当前时间】推算）。
- 打开应用和截屏会由界面弹出确认卡：直接调用工具即可，不要先在文字里问“要不要打开”；工具返回 declined=true 表示用户没同意，就轻轻带过，不要重试。
- 桌宠在桌面上时，可以在开心、安慰、提醒等时刻偶尔用 pet_express 配一个表情或一句气泡，不要每句话都用。
- 改动桌面的操作都会自动生成可撤回的回执；用户说“撤回/换回去/不要了”时用 undo_last_action，【最近的桌面操作】里方括号是可用的 journalId。
- 工具返回 ok=false 就是没做成，照实说，不要说已经好了；返回 ok=true 才能说完成。
- 用户明确表达喜欢的桌面风格、配色、摆放习惯或壁纸类型时，用 memory_store(kind=preference) 记下来，之后布置桌面时参考。`

const WIDGET_BLOCK = `【桌面组件操作】
用户要求添加、查看、调整或移除桌面组件时，用组件工具完成真实操作。组件操作是轻量桌面陪伴能力，不要把它说成文件任务、项目任务或工作区任务。
内置组件类型包括：clock、elegantclock、pixelclock、graphicdatetime、audio、weather、whitenoise、text、stocks、news、calendar、quicktools、pet、sysmonitor、desktop-icons-box、desktop-icons-horizontal、desktop-icons-adaptive、desktop-icons-dock。
操作流程：改样式、配色、透明度、文字等用 update_widget_config，只能使用 widget_capability_list 或 list_widgets(includeOptions=true) 列出的设置项和取值；移动、缩放、隐藏/恢复、置顶用 arrange_widget；修改已生成的 AI 组件用 update_generated_widget。工具返回 rejected 或 ok=false 时，说明没有生效，按返回的 allowed 修正后再试一次，不要对用户说已经改好。
设计原则：优先使用预设(preset)和位置锚点(anchor)，不要随意给像素坐标；同一位置不要叠放多个组件，桌面保持一个主视觉加少量轻组件；配色优先与壁纸和已有组件一致，一次只做用户要求的改动；Dock 和图标收纳里是用户的桌面图标，不能隐藏，删除会由界面向用户确认。
便签和待办已经独立成 LavaNotes 软件：用户想记一件事、写便签或看待办时，用 open_lavanotes 打开 LavaNotes（新建时把要记的内容放进 text）；返回 installed=false 时告诉用户需要先安装 LavaNotes 并给出下载地址，不要说已经记好。桌面短句才用 text 组件。实时股票、天气、新闻必须使用对应内置组件，绝不能用生成式组件编造静态数据。创建 stocks 时把用户指定的六位 A 股代码放进 stockSymbols；用户没说具体股票时只问一次名称或代码，不要先创建空卡片。只有个性化进度、倒计时、组合静态信息卡才调用 create_generated_widget，高度通常省略让系统按内容计算。`

export function buildToolRouterPrompt(params: { workspace?: ChatProject | null; route: ToolRouteDecision }): string {
  const { workspace, route } = params
  const rootPath = workspace?.rootPath ?? workspace?.path
  const workspaceName = workspace?.displayName ?? workspace?.name ?? '未选择'
  if (route.toolNames.length === 0) return ''
  // Always-on guidance first so the prompt prefix stays identical between turns.
  const blocks: string[] = [CAPABILITY_BLOCK, DESKTOP_CONTROL_BLOCK, WIDGET_BLOCK]

  if (route.usesAttachments) {
    blocks.push(`【用户附件】\n用户消息里的【附件】列出了本次对话中用户主动添加的文件（名称和 id）。需要内容时用 read_attachment 读取；已经直接附在消息里的图片不用再读。只处理用户附加的文件，不要猜测其他文件。`)
  }

  if (route.usesDesktopScene) {
    blocks.push(`【AI 桌面编排】\n用户要求“布置桌面、极简模式、夜间专注、音乐氛围、桌面更好看、不挡壁纸”等整桌调整时，先读取当前桌面和组件能力，再用只读预览生成确定性布局和美学检查结果，然后给出场景草案。桌面编排的第一原则是美观和克制：保留 Dock，不清空图标，不默认删除组件，不默认铺满新闻/股票/系统监控；默认最多一个主视觉组件和两三个轻组件。只有在用户明确确认“应用/就按这个/确认应用”后，才调用桌面编排应用工具；应用前会自动创建快照，用户不喜欢时用回滚工具恢复。用户只是要单个轻组件时，可用普通组件工具完成。`)
  }

  if (route.usesWorkspaceRead || route.usesWorkspaceWrite || route.usesDocuments || route.usesCommand) {
    blocks.push(`【当前本地文件夹】\n名称：${workspaceName}\n路径：${rootPath ?? '未选择'}\n只有用户明确要求你查看、分析、整理、生成或修改本地文件时，才使用本地文件相关工具。文件工具只能接收当前文件夹内的相对路径。`)
  }

  if (route.usesWorkspaceRead) {
    blocks.push(`【读取本地文件】\n查看、总结、搜索、理解本地文件，或用户要求检查工具失败/报错原因时，先用 list_directory、search_text、read_file 或 get_file_info 获取真实上下文，不要凭空猜测文件内容。`)
  }

  if (route.usesWorkspaceWrite) {
    blocks.push(`【修改本地文件】\n创建、修改、移动、删除、生成本地文件，或用户明确要求修复问题时，必须通过写入工具完成；工具返回 ok=true 才能说已经完成。涉及已有文件变更时，按工具要求创建 checkpoint 和等待确认。完成后用 verify_workspace_result 检查结果。`)
  }

  if (route.usesDocuments) {
    blocks.push(`【文档/表格/图片文字】\n处理 PDF、Word、Excel 或图片文字时，使用对应文档工具。生成 DOCX/XLSX 时只在用户明确要文件结果时使用。`)
  }

  if (route.usesCommand) {
    blocks.push(`【运行命令】\n只有用户明确要求运行命令、脚本、测试或构建时才使用 run_command。不要声称已经执行未获批准或未返回结果的命令。`)
  }

  return blocks.join('\n\n')
}
