# LavaDesk 开发日志（原灵月桌面）

> 近期事件，默认只读最近 3-5 条；当前能力看 [项目状态](project-status.md)，可复用结论看 [开发经验](dev-lessons.md)，资料取舍看 [知识索引](knowledge-index.md)。
> 历史记录只证明当时的事件，不代表当前方案或新的操作授权；旧路径/旧结论保留以便追溯。

历史归档：[2026-08](archive/dev-log-2026-08.md) · [2026-05](archive/dev-log-2026-05.md) · [2026-04](archive/dev-log-2026-04.md)。主页和归档不重复保存同一条事件。

## [2026-10-08] 1.2.0 合入已发布的 1.1.14，仓库改名与 LavaNotes 上线

**变更摘要**: 用户把仓库改名为 `chengcczzjj/LavaDesk` 并新建 `chengcczzjj/LavaNotes`，授权合并与提交。LavaNotes 1.0.0 源码已推送到其 main（CI 通过）。按授权把任务分支快进到 main 并触发 1.2.0 发布后，发现 1.1.14 已于 09-27 从 `claude/blissful-ritchie-iemaxr` 发布却从未合入 main；为避免 1.2.0 覆盖掉 1.1.14 的功能，在“安装依赖”步骤取消了该次运行（未生成 tag/Release），随后把该分支合入 1.2.0。`claude/nice-davinci-47j62f` 上 09-29 未发布的壁纸区界面改版未合入。

**涉及模块**:
- 冲突处理：`toolRouter.ts` 采用 1.1.14 的常驻工具与固定提示前缀，组件说明中的便笺任务改为 `open_lavanotes`；`tool-manifest.ts` 保留 `journal` 标记并去掉 `manage_todo_tasks`；`index.ts` 保留迁移模块为第一个 import，并保留提醒、快捷对话热键、`lingyue://` 深链。
- 1.1.14 新代码中引用内置便利贴的部分：快捷工具“便签”按钮改为经 `LAVANOTES_OPEN`（新增 canvas 发送方）新建 LavaNotes 便签，未安装时打开“便签”页；桌面现状摘要与 `desktopState.ts` 去掉 `todo-board` 分支；评测集 c026–c028 改为 `open_lavanotes`。
- 用户可见的应用名：FlowWall 下载确认、登录提示和壁纸工具说明里指应用的“灵月”改为 LavaDesk；伴侣说话场景（灵月提醒、灵月快捷对话、“灵月截图”文件夹）保持原名。协议显示名改为 LavaDesk，`lingyue://` 协议本身不变。
- 文档：经验 L15–L17 来自 1.1.14，改名经验顺延为 L18；状态、知识索引、AGENTS、1.2.0 发布说明同步。

**验证结果**:
- `npm test`：typecheck、lint 通过；单元/契约 142 项中 141 通过，1 项为已知依赖 Windows 路径分隔符的桌面图标导入测试。
- `npm run build:check` 通过；产物中迁移在任何 Store/数据库创建前执行。`ELECTRON_DISABLE_SANDBOX=1` 下 Electron 冒烟五组（协议沙箱、壁纸渲染、显示工具栏、快捷对话、FlowWall 下载）全部通过。
- 未在 Windows 实机验证；LavaNotes 1.0.0 与 LavaDesk 1.2.0 的发布在本条提交之后进行。

**经验关联**: L15–L17（随 1.1.14 合入），L18（编号调整）。
**提交意图**: `merge: bring released 1.1.14 into LavaDesk 1.2.0`

---

## [2026-10-07] 灵月桌面改名 LavaDesk、便签拆分为独立软件 LavaNotes

**变更摘要**: 按用户要求统一 Lava 命名并把便签拆成独立开源软件：本仓库移除画布内置便利贴，改为检测/唤起 LavaNotes；应用标识、安装包、数据目录与更新源改为 LavaDesk，首次启动自动迁移灵月桌面的旧数据。LavaNotes 1.0.0（透明纸张窗口、钉在桌面、图片/表格、待办）已在本地仓库完成并提交，等待用户创建 `chengcczzjj/LavaNotes` 后推送。

**涉及模块**:
- 移除 `todo-board` 组件、任务便笺工作台、`manage_todo_tasks`、画布文字输入焦点与便利贴置顶 IPC；`widget-data.ts` 仍可读取退役类型，加载时备份到 `legacy-sticky-notes/` 再过滤。
- 新增 `lavanotes-service.ts`、`LavaNotesPanel.tsx`、AI 工具 `open_lavanotes`（`lavanotes://new?text=` 等）。
- `package.json`/`electron-builder.yml`/发布流程/核验脚本：`LavaDesk`、`com.lavadesk.app`、`LavaDesk-Setup-<版本>.exe`、更新源 `chengcczzjj/LavaDesk`；数据文件 `lavadesk-config.json`、`lavadesk-*.db`；版本 1.2.0。
- `legacyUserDataCore.ts`/`legacyDataMigration.ts`：作为主进程第一个 import，关闭旧进程后复制 `%APPDATA%\lingyue-desk`、改名、改写 JSON 绝对路径并写迁移标记；就绪后取消旧开机启动、提示卸载旧版。

**验证结果**:
- `npm test`：typecheck、lint 通过；单元/契约 106 通过，1 项失败为基线已知、依赖 Windows 路径分隔符的桌面图标导入测试（改动前同样失败）。
- `npm run build:check` 通过；三组 Electron 冒烟在容器内加 `--no-sandbox`（root 限制）后全部通过。
- Linux 打包版对伪造旧目录实测迁移：标记 done、配置改名、快捷方式路径改写、缓存跳过。未在 Windows 实机验证关闭旧进程、开机启动清理、卸载提示与 `lavanotes://` 检测。
- GitHub：创建仓库返回 403、无改名工具，FlowWallDesk → LavaDesk 改名与 LavaNotes 建库需用户操作；1.2.0 未发布。

**经验关联**: L06（替代）、L18（新增）。
**提交意图**: `feat(desktop): rename to LavaDesk, move sticky notes to LavaNotes and migrate LingyueDesk data`

---

## [2026-09-27] 发布 1.1.14：伙伴桌面操作、快捷对话、FlowWall 在线壁纸库

**变更摘要**: 按用户“打包发布新版本”的要求，将 1.1.13 之后两轮开发（伴侣桌面控制与快捷对话、FlowWall 在线壁纸库与交互/组件升级）作为 1.1.14 发布；未合入 main，Release 由任务分支提交构建。

**涉及模块**:
- 版本与说明：`package.json` / `package-lock.json` 升至 1.1.14，新增 [1.1.14 发布说明](../../doc/发布说明/1.1.14.md)；`scripts/verify-windows-release.mjs` 要求安装包含快捷对话入口（首个带该窗口的版本），摘要文案同步为四个渲染入口。
- 发布：在 `claude/blissful-ritchie-iemaxr` 上手动运行 Windows 发布流程（Actions 运行 36294078856），构建 `90ff7f6` 并在发布时创建 tag `v1.1.14`。

**验证结果**:
- 容器内：`npm test` 152 项 151 通过（Linux 路径基线用例），`npm run build:check` 成功。
- Windows 运行器：`npm test` 152/152 通过，Electron 冒烟五组通过，NSIS 构建成功，核验脚本确认 latest.yml、安装包、app.asar 版本与四个入口一致；草稿资产大小核对后发布，公开 latest.yml 与构建一致，releases/latest 指向 v1.1.14。
- 会话内独立复核：Release 非草稿/预发布，tag 指向 `90ff7f6`，三项资产齐全；完整下载安装包 369,500,151 bytes，SHA-512 与 latest.yml 一致，SHA-256 `C8FC76691A16667524938FCD403A224DB4CE708D48E7E89657AA99CBA284F0A7`；blockmap 388,469 bytes、latest.yml 的 SHA-256 与 GitHub 资产摘要一致。
- 自动生成的 Release 构建校验摘要仍写“三个渲染入口”（发布时脚本文案未更新，检查本身已含快捷对话），本次已修正文案供下次使用。
- 未在 Windows 实机安装，也未实测客户端从 1.1.13 自动升级。

**提交意图**: `docs(release): record 1.1.14 remote delivery`

---

## [2026-09-27] FlowWall 在线壁纸库接入与伴侣交互、桌面组件升级

**变更摘要**: 新增“FlowWall 发现”内嵌在线壁纸库：接管站点自己的下载，按内容校验后导入「我的壁纸」并可一键设为壁纸，另有 `lingyue://` 协议；对上一轮伴侣功能做交互复查升级（确认卡键盘与倒计时、回执状态与全部撤回、快捷对话输入/粘贴/拖入、热键录制与授权收回）；快捷工具、系统监控接入真实功能，白噪音定时关闭，桌宠悬停/点击回应/未读红点。设计见 [FlowWall 在线壁纸库接入设计](../../doc/FlowWall在线壁纸库接入设计.md) 与 [伴侣智能体桌面控制设计](../../doc/伴侣智能体桌面控制设计.md) §8。

**涉及模块**:
- `src/shared/flowwall.ts` / `media-signature.ts` / `main/services/flowwall-library.ts` / `ipc/flowwallIpc.ts` / `main/index.ts` / `electron-builder.yml` / `renderer/main-ui/pages/FlowWallPage.tsx`: 隔离分区视图、导航分类、下载状态机、判重与内容校验、协议注册（仅安装版）。
- `src/renderer/shared/chat/*` / `quick-chat/QuickChat.tsx` / `pages/chat/ChatPage.tsx` / `ipc/chatIpc.ts` / `desktop/attachmentStore.ts` / `actionJournal.ts` / `actionPolicy.ts` / `ipc/companionIpc.ts` / `settings/SettingsGeneralPage.tsx`: 交互升级；粘贴/拖入只传字节。
- `src/renderer/widgets/{Pet,WhiteNoise,QuickTools,SysMonitor}` / `main/services/system-stats.ts` / `ipc/appIpc.ts` / `shared/canvas-hit-test.ts`: 组件升级；桌宠与快捷工具移出被动名单。
- 修复：小文件先于判重完成导致同一壁纸导入两份；桌宠点击在 Windows 会穿透到桌面（被动名单遗漏，见 L16）。

**验证结果**:
- `npm test`：类型检查、lint 通过；152 项测试 151 通过，失败项仍为基线提交上同样失败的 Windows 路径用例（已在基线工作树复现）。新增 `flowwall.test.mjs` 12 项（判重竞态用例在旧逻辑下失败）、`companion-ux.test.mjs` 6 项。
- `npm run build:check` 成功；`ELECTRON_DISABLE_SANDBOX=1` 下冒烟五组通过，含新增 flowwall 组与扩充的 quick-chat 组。
- 临时 Playwright 脚本驱动真实应用：FlowWall 页（本地替身站点）下载→导入→设为壁纸、重复、伪装文件拒绝、对话框遮挡与面板让位；伴侣快捷对话添加/撤回/截屏确认/提醒；组件实测 CPU/内存、便签新增、白噪音定时环、桌宠红点；设置页热键录制与授权收回，均通过并人工检查截图；脚本未提交。
- 未验证：容器网络拦截 `www.flowwall.ai`，真实站点下载按钮与登录未测；Windows 实机的点击穿透、`ms-screenclip:`、视图 DPI 贴合、协议注册未测。

**经验关联**: L16、L17（新增），L15（补充），L10。
**提交意图**: `feat(wallpaper): FlowWall online library, companion UX and widget upgrades`

---

## [2026-09-26] 伴侣智能体桌面控制迭代：常驻工具、确认挂起、回执撤回与快捷对话

**变更摘要**: 按调研方案重做聊天智能体的桌面控制底座并补齐能力：桌面类工具每轮常驻，确认由界面挂起执行，桌面改动有回执和撤回；新增壁纸、应用、系统、白噪音、桌宠、提醒、桌面模式、附件工具，以及全局热键/桌宠唤出的快捷对话。设计见 [伴侣智能体桌面控制设计](../../doc/伴侣智能体桌面控制设计.md)。

**涉及模块**:
- `src/main/memory/tools/toolRouter.ts` / `chat/toolExecution.ts` / `chat/chatService.ts` / `routing/contextPacker.ts`: 常驻工具与固定提示前缀；策略→确认→快照→执行→回执的托管执行；时间/记忆/桌面现状/最近操作放尾部；图片附件直接给看图模型。
- `src/main/memory/desktop/*` / `tools/definitions/desktop-control.ts` / `ipc/wallpaperIpc.ts` / `ipc/widgetIpc.ts`: 桌面状态差异与撤回、确认策略与挂起、应用索引、系统控制、提醒调度、桌面模式、附件授权；壁纸/组件导出 `*ForTool` 复用原队列。
- `src/renderer/quick-chat/` / `windows/quickChatWindow.ts` / `ipc/companionIpc.ts` / `preload/*`: 独立 quick-chat 窗口角色、全局热键、托盘入口；ChatPage 与快捷对话共用 Markdown、确认卡、回执、附件组件；桌宠与白噪音接收画布组件指令。
- 修复：`open_url`/剪贴板/记忆工具 `success` 口径导致失败显示为已处理；删除 Dock 的确认改由界面执行；写操作后仍命中缓存的只读结果；天气工具描述乱码；审批卡把 critical 显示为中风险；场景模板无效桌宠状态。

**验证结果**:
- Linux 容器：`npm test` 类型检查、lint 通过，134 项测试 133 通过；失败项为基线即失败的 Windows 路径分隔符用例。新增 `tests/companion-agent.test.mjs` 17 项（含 87 句指令可达性评测）。
- `npm run build:check` 成功；`ELECTRON_DISABLE_SANDBOX=1`（容器以 root 运行）下 Electron 冒烟四组通过，含新增 quick-chat 组。
- 临时脚本 + 本地伪 OpenAI 兼容模型 + Playwright 驱动真实应用：快捷对话添加组件→回执→撤回、截屏确认卡→同意后原参数执行、下一轮摘要含已撤回、交接主界面后拒绝确认返回 declined，均通过；未提交该脚本。
- 未用真实模型跑 `eval:companion`（容器无 API Key）；未在 Windows 实机验证热键、`SendInput`、应用唤起、通知与多屏落位。

**经验关联**: L15（新增），L09。
**提交意图**: `feat(agent): companion desktop control with confirmations, undo and quick chat`

---

## [2026-09-26] 发布 1.1.13 并将开发收拢到 main

**变更摘要**: 按用户授权把工作分支快进合并到 main（不改写历史），此后直接在 main 上开发；在 main 上手动运行 Windows 发布流程完成 1.1.13 远端发布。

**涉及模块**:
- Git：`main` 由 `f72d418`（1.1.10）快进到 `217a400`。远端删除分支被会话 git 代理拒绝（403），`codex/release-1.0.3`、`codex/release-1.0.5`、`claude/youthful-planck-k0lx2c` 已完全包含在 main 中，待用户删除；`codex/dock-foreground-input-guard` 仍有 2 个 main 没有的 1.1.12 文档提交，本地合并被会话权限检查拦截，未合入、未删除。
- 发布：Actions 运行 36214604620 在 `217a400` 上构建，发布时创建 tag `v1.1.13`。

**验证结果**:
- Windows 运行器：`npm test` 117/117 通过，Electron 冒烟三组通过，NSIS 构建成功，核验脚本确认 latest.yml 与安装包、app.asar 版本和入口一致；草稿资产大小核对后发布，公开 latest.yml 与构建一致，releases/latest 指向 v1.1.13。
- 会话内独立复核：Release 非草稿/预发布，tag 指向 `217a400`，三项资产齐全；完整下载安装包 369,452,270 bytes，SHA-512 与 latest.yml 一致，SHA-256 `B1897B098E055356432582D8C0F852B97379CB5A14AF84EC9181DF39B969C3A5`，blockmap 386,722 bytes。
- 未在 Windows 实机安装，也未实测客户端从 1.1.12 自动升级。

**提交意图**: `docs(release): record 1.1.13 remote delivery`

---

## [2026-09-25] 聊天伙伴组件控制、自动更新可靠性与 1.1.13 发布流程

**变更摘要**: 审查聊天 Agent 对桌面组件的控制链路，补齐布局与生成卡片编辑能力并校验所有设置；修复自动更新“有时不灵”；合并已发布的 1.1.12，升版 1.1.13 并新增 Windows Actions 发布流程，让其他电脑可通过自动更新获取。

**涉及模块**:
- `src/shared/widget-config-spec.ts` / `src/main/memory/tools/definitions/widgets.ts` / `src/main/ipc/widgetIpc.ts`: 组件设置单一规格与校验（拒绝项返回可选值）；新增 `arrange_widget`（锚点/缩放/隐藏恢复/置顶，按组件所在显示器的本地工作区落位）与 `update_generated_widget`；预设、锚点、删除常驻组件确认、摘要瘦身。
- `src/main/memory/tools/toolRouter.ts` / `chatService.ts` / `ChatPage.tsx`: 追问沿用最近的组件工具类别；修正过程标题。
- `src/main/services/update-service.ts` / `src/main/tray.ts`: 失败退避重试、唤醒复查、发现即后台下载、系统通知与托盘“重启并更新”。
- 合并 v1.1.12：画布命中回退改用 `materializeWidgetsForCanvas`，毛玻璃采用 1.1.12 逐屏帧（替代 09-25 早先的逐窗口帧来源方案），移除被替代的并集矩形适配与渲染偏移辅助函数。
- `.github/workflows/release-windows.yml` / `scripts/verify-windows-release.mjs`: Windows 构建→核验清单/哈希/asar 版本与入口→草稿上传→核对资产→发布→复核公开更新源。

**遇到的问题**:
- 旧 `update_widget_config` 直接合并任意键，模型写入组件不读取的配置后仍宣称成功；预设里也有不存在的样式值。
- 自动更新只在启动和每 6 小时检查一次，失败后不重试，且需要用户进主界面手动下载，托盘常驻时几乎发现不了新版本。
- `@electron/asar` 3.4.1 的打包函数在 Node 22 下不返回（仅影响测试造包，读取与 electron-builder 构建不受影响）。
- 云端会话的 git 代理只允许推送工作分支，推送 tag 返回 403；GitHub 也只允许默认分支上已有的工作流手动运行（dispatch 返回 404）。流程已支持两种触发，但本次需由用户推送 `v1.1.13` tag 才能真正构建发布；截至本条记录尚未发布。

**验证结果**:
- Linux 容器：`npm test` 类型检查、lint 通过，117 项测试 116 通过；失败项为依赖 Windows 路径分隔符的桌面图标导入测试，在未改动的 v1.1.12 上同样失败。Xvfb 下 `test:electron:smoke` 三组通过；`build:check` 成功；发布核验脚本用合成产物验证了通过与篡改检测。
- 未在 Windows 实机安装验收；远端构建与发布结果以 Actions 运行和 Release 复核为准。

**提交意图**: `chore(release): prepare LingyueDesk 1.1.13`

---

## [2026-09-25 21:44] 整治桌面层级闪烁、多显示器对齐与主界面规范问题

**变更摘要**: 系统排查桌面组件在开启应用、操作输入法时的闪烁与指针跳变、需要多次点击才能输入/拖拽的问题，修复多显示器下毛玻璃错位与组件落位，并按审查结果修正主界面和设置页的层级、状态与设计规范问题。

**涉及模块**:
- `src/main/windows/canvasWindow.ts` / `src/shared/canvas-hit-test.ts`: `setFocusable` 只在状态变化时调用并立即隐藏任务栏标签；便利贴获取键盘焦点后回到桌面层；输入期间不再整屏截获鼠标；原生命中改用 renderer 上报的 DOM 命中区域，并在光标处组件被其他窗口遮住（且该窗口确在画布之上）时保持穿透、通知 renderer 暂停悬停。
- `src/main/index.ts`: Windows 下关闭 Chromium `CalculateNativeWinOcclusion`。
- `src/renderer/canvas/Canvas.tsx` / `canvas.css` / `src/renderer/widgets/TodoBoard/TodoBoard.tsx`: 上报命中区域、遮挡时关闭指针事件；便利贴窗口短暂失焦（输入法/系统浮层）不立即结束编辑。
- `src/main/ipc/wallpaperIpc.ts` / `src/main/windows/wallpaperWindow.ts` / `src/renderer/canvas/wallpaperFrameStore.ts` / `src/renderer/widgets/FrostedGlassBackground.tsx` / `src/renderer/wallpaper/Wallpaper.tsx`: 每个壁纸窗口独立抽帧并按画布坐标对齐毛玻璃；静态图片不再持续主进程截图；应用壁纸不再触发置顶闪烁；壁纸属性实时调整不再被旧布局回弹。
- `src/shared/widget-display-fit.ts` / `src/main/ipc/widgetIpc.ts` / `src/main/windows/displayLayout.ts`: Dock、新组件和便利贴落在主显示器工作区；拖放按所在显示器约束；切换布局/拔插显示器后移回不可见组件并同步画布；组件配置文件改为相对主显示器坐标。
- `src/renderer/main-ui/`：修复添加壁纸对话框被壁纸网格遮挡、Electron 39 下拖放路径失效、模型配置按钮卡在加载中、壁纸库每次应用都闪烁重载、显示器拓扑比例失真与状态提示、聊天发送按钮被桌宠遮挡、重命名 Esc 仍保存、便笺管理页覆盖桌面编辑、样式串扰与焦点可见性等问题。

**遇到的问题**:
- Electron 在 Windows 上的 `setFocusable()` 会调用 `SetSkipTaskbar(!focusable)` 和 `Deactivate()` → 每次全屏遮挡或便利贴输入都可能把前台交给画布下方的窗口并闪出任务栏按钮；改为仅在状态变化时调用，并先把画布放回桌面层。
- `forward: true` 会把鼠标移动转发给被其他窗口遮住的画布，renderer 据此声称悬停 → 主进程以 `WindowFromPoint` 和 z-order 判断是否真的被遮挡后再决定是否截获。
- 多屏模式下只抽取主屏壁纸帧并拉伸到整个虚拟桌面，偏移还叠加了 `screenX` → 按壁纸窗口分别抽帧并下发各自在画布中的区域。

**验证结果**:
- `npm test` 通过全部 65 项测试（新增 `tests/desktop-layer.test.mjs`）；`npm run build:check` 成功。
- 未在 Windows 实机验证：涉及原生窗口层级的行为需安装后按“开应用/切输入法/多屏拖放”场景复测。

**关联提交**: `f6abab4 fix(desktop): stop widget layer flicker and align multi-monitor glass`

---

## [2026-09-05 22:25] 记录提交与打包的远端交付约定

**变更摘要**: 根据用户明确约定统一“提交/打包”的交付范围，避免本机完成却让其他电脑无法取得版本；本次为未来规则维护，不补发旧安装包。

**涉及模块**:
- AGENTS.md / dev-progress：替代旧的单独推送/发布确认规则，保留本次仅本地限制、分支边界和无关工作保护；增加完整更新资产与远端验证流程。
- dev-lessons.md / project-status.md：记录跨电脑更新缺失的原因及约定入口，不把规则修改写成已发布事实。
- tests/agent-docs.test.mjs：新增交付约定、显式限制与旧冲突文案回归检查；一条较早事件原文移入 2026-08 归档，主页保留 12 条。

**验证结果**:
- npm.cmd test：类型、只读 lint 和全部 105 项测试通过；归档前后旧条目标题与正文逐项一致。
- 未改业务源码或用户数据，未重打包、安装、推送或发布；1.1.12 远端更新资产仍待实际发布。

**经验关联**: L11 验证与交付分层。
**提交意图**: docs(agent): remember commit and package delivery expectations

---

## [2026-09-05 15:31] 精简显示设置并重新打包更新本机 1.1.12

**变更摘要**: 将本轮安全稳定修复升版为 1.1.12；根据安装后反馈删除三行横幅、统一菜单样式，重新打包并覆盖本机；不扩展远端发布。

**涉及模块**:
- App / LibraryPage / WallpaperDisplayControls / styles：显示模式与逐屏目标收进顶部单行导航，本地/在线共用；补充请求中保护和行内失败提示。
- tests/electron：新增生产 preload/界面工具栏验收，临时 profile 在子进程退出后由父进程清理，避免 Chromium 数据库占用。
- package.json / package-lock.json / 发布契约 / 1.1.12 发布说明 / 项目状态：同步版本、最终安装资产与验证边界；构建及备份不进入 Git。

**验证结果**:
- npm.cmd test：类型、只读 lint、104 项测试通过；生产构建及三组隔离 Electron 冒烟通过。工具栏覆盖鼠标/键盘、关闭、逐屏联动、并发保护、错误恢复和三种宽度；离屏菜单截图已核验。
- npm.cmd run build:win -- --publish never 成功；最终安装包 369,431,413 bytes，SHA-256：20797E40846F6CCC20493461A3A09A991B1AB0336223BB1DF9CE9F815734F4A6；latest.yml 大小/SHA-512 一致。
- 重新安装前在线数据库快照和完整 userData 备份完成，2,874 文件逐一校验；安装退出码 0，EXE/asar/注册表为 1.1.12，安装 asar 与新构建完全一致。
- 新基线的用户配置、8 个组件、2 个全局图标组件保留，记忆库完整性通过、14 张表记录数未变；组件覆盖/图标/checkpoint 哈希一致，未用旧快照覆盖真实设置。
- 重启后主界面加载，单屏 2560x1440 DIP / 3840x2160 物理边界原生回退贴合成功；安装态菜单未抢占前台全屏窗口点击验收，混合 DPI 双屏等仍待实测；未 push、tag 或远端发布。

**经验关联**: L11 验证与交付分层。
**提交意图**: fix(ui): streamline wallpaper controls and package 1.1.12

---

## [2026-09-05 13:04] 修复壁纸、组件与多屏管理高优先级问题

**变更摘要**: 先处理数据丢失、安全边界及功能一致性，补足真实 IPC 与隔离生产渲染器回归，不改真实桌面和已安装应用数据。

**涉及模块**:
- 组件持久化 / Dock：读取不回写、兼容旧大记录、命名空间快照/原子保存、切换/退出 flush；移动前保存恢复记录，导入/删除串行，部分恢复失败保留剩余记录。
- 壁纸 / 显示器：有效主屏与组件命名空间统一、设置按 ID 合并并限制待写队列、资源使用/变更互斥、视频共同时钟/单音频来源、工作区缩小只调整显示投影。
- 网页安全 / 导入：HTML 不再复制或授权父目录、ZIP 入口校验、包级独立来源与 CSP/iframe 沙箱、拖入文件改用受支持的 preload 路径 API。
- 天气 / renderer：定时刷新、重试、过期提示与无伪初值；补修迟到主屏快照把已加载图片/网页变透明的问题。

**验证结果**:
- `npm.cmd test` 通过 typecheck、只读 lint 与全部 104 项测试；`npm.cmd run test:electron:smoke` 通过生产构建及两组隐藏 Electron 冒烟。
- 实际 Chromium 验证包内资源可用、父页面/bridge/跨包/越界拒绝；生产 preload/renderer 验证零音量、次屏设置、音频归属、合成视频纠偏及图片/网页迟到消息后的可见性。静态壁纸用例先复现失败再修复，并验证测试失败返回非零退出码。
- 混合 DPI 双屏、全屏/远控、真实 Shell 与公网天气未实机验收；未打包、安装或发布。高频 Canvas 查询、静态 capturePage 和占位组件后续单独处理。

**经验关联**: 修订 L01/L03/L08/L10/L11；新增 L13/L14，明确旧经验替代关系与验证边界。
**提交意图**: `fix(desktop): protect widget data and reconcile wallpaper state`

---

## [2026-09-05 10:28] 统一开发 Agent 规则并整理工程知识

**变更摘要**: 消除自动提交/重复确认、提交后回填日志、过时测试说明和历史方案误用；工程记忆与应用用户记忆分离。

**涉及模块**:
- `AGENTS.md` / `.github/` / `README.md`: 单一规则入口、按需上下文、先记录后提交与授权边界。
- `TempFile/文档资料/`: 状态改为能力/缺口/验收边界，新增知识索引与 12 条可复用经验，原文按月归档历史。
- `doc/` / `TempFile/demo/` / `tests/agent-docs.test.mjs`: 标注旧设计及未创建文档，限制原型规则作用域，新增 7 项文档契约检查。

**验证结果**:
- `npm.cmd test` 通过类型、只读 lint 与全部 69 项测试；`npm.cmd run build:check` 成功。
- 原有 47 条事件全部保留：9 条留在近期日志、38 条归档；逐条核验正文一致，仅清理文件尾多余空行。
- `git diff --check` 通过；未改业务源码/用户记忆，未启动应用、安装、push 或发布。Node 模块类型与 Vite 混合导入提示不阻断验证，未扩展修改构建配置。

**经验关联**: L01-L12；历史方案替代关系见 knowledge-index.md。
**提交意图**: `docs(agent): consolidate development rules and project memory`

---

## [2026-09-04 21:25] 构建并本机安装 1.1.11 多显示器稳定布局版

**变更摘要**: 将多显示器底层修复升版为 1.1.11，生成 Windows NSIS 更新资产并在本机静默覆盖安装；本次未上传 GitHub Release。

**涉及模块**:
- `package.json` / `package-lock.json` / `tests/release-contracts.test.mjs`: 升级 1.1.11 版本元数据和发布契约。
- `doc/发布说明/1.1.11.md` / `TempFile/文档资料/project-status.md`: 记录功能、构建哈希、本机安装和双屏验收边界。
- `dist/`: 生成安装包、blockmap、`latest.yml` 和未打包目录；构建产物不进入 Git。

**验证结果**:
- `npm.cmd test` 通过全部 62 项测试；`npm.cmd run build:win` 成功。
- 安装包 369,425,676 bytes，SHA-256 `00A3BC8D7CFF59BCAA69BF980A83474CA305DE54AF9613BE08C492131B1A98DF`。
- 本机 EXE、`app.asar`、卸载注册表和全部运行进程均为 1.1.11；原壁纸、8 个组件和 2 个全局图标组件保留。
- 安装态诊断确认主屏 `2560x1440` DIP / `3840x2160` 物理边界经 Raised Desktop 原生方案贴合成功。

**Git Commit**: 本次任务提交 — `chore(release): package LingyueDesk 1.1.11`

---

## [2026-09-04] 完成多显示器原生坐标、稳定归属与逐屏渲染链路

**变更摘要**: 重新审计从 Electron 显示器枚举、持久化、BrowserWindow、WorkerW 子窗口定位到 Canvas 组件坐标的完整链路，不再用 UI 状态修补原生坐标问题。默认安全落到主显示器，并补齐复制、按屏、延展和组件跨屏持久化。

**涉及模块**:
- `src/main/windows/nativeDisplayIdentity.ts` / `src/main/windows/displayLayout.ts` / `src/main/windows/attachWallpaperNative.ts`: 用 Win32 设备名和物理矩形匹配 Electron 显示器；修复 `GetMonitorInfoW.cbSize` 被 Koffi 纯输出参数清零的问题；`SetParent` 后显式切换 `WS_CHILD`、移除 `WS_POPUP`，经 `ScreenToClient` 定位并用 `GetWindowRect` 校验。
- `src/main/windows/wallpaperWindow.ts` / `src/shared/wallpaper-display-layout.ts` / `src/main/ipc/wallpaperIpc.ts`: 所有模式均使用显示器本地窗口；延展改为同一虚拟构图的逐屏负偏移裁切；贴合失败自动退避重试，壁纸分配迁移到稳定显示器键。
- `src/shared/widget-display-layout.ts` / `src/main/ipc/widgetIpc.ts` / `src/main/windows/canvasWindow.ts` / `src/main/ipc/desktopIconIpc.ts`: 组件改为稳定显示器键 + 屏幕本地坐标持久化，单 Canvas 只在同步和拖拽边界做双向映射，旧虚拟桌面坐标按覆盖面积一次性迁移。
- `src/renderer/canvas/wallpaperFrameStore.ts` / `src/renderer/widgets/FrostedGlassBackground.tsx` / `src/renderer/wallpaper/Wallpaper.tsx`: 毛玻璃帧改为逐屏传输和选择，renderer 与主进程 fallback 都保留显示器边界，延展抽帧使用真实本地裁切区域。
- `src/main/runtime/diagnosticLog.ts` / `doc/双显示器支持方案.md`: 增加 `%APPDATA%\lingyue-desk\logs\display-diagnostics.jsonl`，记录拓扑、逻辑/物理边界、贴合结果和失败重试，并同步真实架构及验收边界。

**遇到的问题**:
- 旧实现把“模式能保存、窗口数会变化”当成多屏完成，但 `electron-as-wallpaper` 只执行 `SetParent`，没有负责每块屏幕的坐标；父子窗口坐标、DIP/物理像素和负坐标仍混用，因此 UI 改多少轮都不能消除半张壁纸跨屏。
- 初版稳定键代码虽然存在，`GetMonitorInfoW` 却声明成 Koffi `out` 参数，调用前必需的 `cbSize` 被清零，真实 Windows 调用始终失败并静默退回 Electron id；改为 `inout` 后已直接读到 `\\.\DISPLAY1` 和 `2560x1440` 物理边界。
- 旧组件一直保存联合 Canvas 坐标，切换主屏/联合画布必然改变原点；现永久保存显示器本地坐标，只有跨屏拖拽才改变显示器归属。

**验证结果**:
- `npm.cmd test` 通过全部 62 项测试；`npm.cmd run build:check` 成功。
- 使用 Node + Koffi 直接调用 Win32 枚举，确认本机 `GetMonitorInfoW` 返回稳定设备名、主屏标志及物理矩形。
- 当前开发机只有一台 `2560x1440` 显示器，不能把自动测试冒充公司混合 DPI 双屏验收；后续实机异常可直接依据 `display-diagnostics.jsonl` 中的 expected/actual 边界定位。

**Git Commit**: 本次任务提交 — `fix(display): complete stable multi-monitor layout`

---
