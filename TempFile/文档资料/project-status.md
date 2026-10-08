# LavaDesk 项目进展

> 源码与容器验证：2026-10-08；最近本机安装验证：2026-09-05（1.1.12）。
> 1.2.0 起应用改名 LavaDesk（原灵月桌面 / LingyueDesk）：新安装标识、可执行文件与数据目录，首次启动自动迁移旧数据；便签拆分为独立软件 [LavaNotes](https://github.com/chengcczzjj/LavaNotes)。1.2.0 合入了已发布的 1.1.14（原在任务分支 `claude/blissful-ritchie-iemaxr`，此前未进 main），main 现包含两者。
> 1.2.0 已于 10-08 由 GitHub Actions（windows-latest）在 main 的 `169da5d` 上构建并发布到 `chengcczzjj/LavaDesk` 的 GitHub Release，远端资产与更新源已复核，旧仓库名 FlowWallDesk 的更新地址可跳转；尚未在 Windows 实机安装验收。LavaNotes 1.0.0 源码已上线但尚未发布 Release。
> 状态依据现有源码与开发记录，不使用无验收口径的完成百分比；“已实现”不等于所有设备场景均已实测。

## 当前方向与阅读入口

AI 伴侣优先：有形象、有温度、陪伴式对话、桌宠和轻量桌面帮助。工作区文件/命令 Agent 已有底层能力，但不是默认产品主线；保留安全边界，不因简化体验而移除权限校验。

- 架构与运行时数据边界：[项目开发指南](other/灵月项目开发指南%20.md)。
- 修复经验与测试入口：[开发经验](dev-lessons.md)；事件证据：[近期日志及归档](dev-log.md)。
- 设计草案、有效性和旧路径：[知识索引](knowledge-index.md)；工程协作规则：[AGENTS.md](../../AGENTS.md)。

## 技术与架构快照

依赖版本以 [package.json](../../package.json) / `package-lock.json` 为准。当前主线为 Electron 39、electron-vite 5、React 19、TypeScript 5.9、Tailwind CSS v4、Zustand 5；存储使用 electron-store 与 SQLite/Drizzle，AI 调用使用 AI SDK v6 与模型兼容层。

- 三类渲染入口：main-ui 设置管理、逐显示器 wallpaper、单一透明 canvas；托盘不是窗口类型。
- 壁纸四模式均以显示器本地窗口渲染，延展为同一虚拟构图逐屏裁切；组件保存稳定显示器键与屏幕本地坐标。
- 主进程通过角色化、单入口 sandbox preload 连接三个渲染入口。
- 安装包内资源提供只读默认值；用户导入、在线下载、壁纸设置与组件覆盖写 userData。

## 核心系统

| 模块 | 当前能力 | 未完成/验证边界 |
| --- | --- | --- |
| 壁纸管理 | 三源导入/下载/校验/更新/应用/删除；当前、次屏、断开屏幕的分配及进行中的应用均阻止资源删除/替换 | 远端服务可用性需运行时核验；清除分配后才可删除资源 |
| 网页壁纸 | HTML 仅导入选中文件；依赖资源用 ZIP；按包独立来源、realpath 边界与 CSP/iframe 沙箱 | 隔离 Electron 已验证资源加载与越界拒绝；不保证任意第三方网页兼容 |
| 原生壁纸贴合 | Win32 父级本地坐标、物理矩形校验、失败重试 | 多设备/DPI 组合仍需实机验收 |
| 多显示器 | 四模式/逐屏窗口/稳定归属；切模式与拓扑统一协调实际主屏壁纸和组件命名空间；视频共同时钟、复制/延展仅主屏出声 | 混合 DPI 双屏未验收；独立视频纠偏不是帧精确同步，通用网页动画未同步 |
| 壁纸设置 | 按壁纸 ID 串行合并和原子保存，合并排队中的滑条写入；范围校验，当前快照与逐屏渲染同源，零音量可持久化 | 隔离生产渲染器已验证延迟旧快照不覆盖设置或隐藏已加载图片/网页；实际多设备仍需验收 |
| 毛玻璃 | 逐屏抽帧与边界，watchdog、capturePage 与预模糊兜底 | 多屏视觉与持续运行性能待结合设备验收 |
| 主界面与托盘 | 页面恢复、单实例、主窗口显隐、托盘退出；本地/在线壁纸共用顶部单行显示设置，菜单使用现有主题 | 工具栏隔离生产界面交互/截图已验收；无完整 UI E2E |
| IPC/preload | 共享通道、角色化 bridge、sandbox 窗口 | 新增能力仍须同步校验与契约测试 |
| 自动更新 | 启动/每 6 小时/唤醒后检查，失败按 2–60 分钟退避重试；发现新版本后台自动下载，完成后系统通知与托盘“重启并更新”，安装由用户确认 | 配置/安全/重试契约已测试；真实网络中断与睡眠唤醒需实机观察 |
| 开机启动 | 安装版注册启动项，设置可关闭 | 锁屏/开机恢复依赖 Windows 实机验证 |
| 发行 | [1.2.0](../../doc/发布说明/1.2.0.md) 改名版已远端发布并复核（含 1.1.14 全部内容；安装包改为 `LavaDesk-Setup-<版本>.exe`，更新源改为 `chengcczzjj/LavaDesk`）；[1.1.14](../../doc/发布说明/1.1.14.md) 为上一版；自 1.1.13 起由 [Windows 发布流程](../../.github/workflows/release-windows.yml) 在 CI 构建、核验清单/哈希/asar 后先草稿再发布，同版本已发布即拒绝覆盖 | 推送 tag 触发；手动运行需工作流已在 main，可指定任意分支构建（发布时在构建提交上建 tag）；未配置 Windows 代码签名证书 |

## 桌面组件与管理界面

| 模块 | 当前能力 | 未完成/验证边界 |
| --- | --- | --- |
| 通用组件系统 | 增删改、编辑拖拽/安全长按、网格、边界、避让、显式 stackOrder | 已退役类型（`todo-board`）仍能读取，加载时备份并过滤，见 [widget-data.ts](../../src/shared/widget-data.ts) |
| 配置持久化 | 实际主屏壁纸/无壁纸独立命名空间；只读不回写、旧数据读取与新增限额分离、原子保存，切换/退出前排空待写快照；损坏/写失败保留现场并阻止替换 | 跨屏拖动与异常断电仍需实机复核；退出保存失败需处理磁盘/权限后重试 |
| 组件可见性 | 工作区缩小时临时钳制显示位置，保存坐标不变；断开显示器的绑定仍保留 | 极小屏幕上大尺寸组件不自动缩放 |
| 组件管理 | 分类列表、浮动工具栏、主题、模态设置、新闻/股票预览 | AI 生成组件的可视化编辑、复制/撤销待完善 |
| 时钟 | clock/elegantclock/pixelclock/graphicdatetime 四种形态 | 按一个时钟能力模块维护 |
| Text / WhiteNoise / Calendar | 自定义桌面文字；11 种白噪音（中文名）、音量档位、定时关闭（到点渐弱）与播放波纹；日历多视图 | 功能记录保留，不把设计中的新增动作当现有 API |
| News / Stocks | 新闻热搜和行情 API 已对接 | 公网接口时效/异常值需运行时兜底 |
| Weather / GraphicDateTime 天气 | 共用主进程天气服务和轮询 hook；10 分钟刷新、失败 1 分钟重试、恢复联网/可见时刷新；保留过期数据并提示，不显示伪初始天气 | 本轮用可控时钟验证刷新/失败/切城市；未实时调用公网接口验收 |
| Audio | 可视化展示和频率映射已实现 | 缺少实时音频输入 |
| QuickTools / SysMonitor | 快捷工具六项真实动作（快聊、截图、便签、显示桌面、资源管理器、Windows 设置）并有执行反馈；系统监控每 2 秒读取真实 CPU/内存、CPU 折线与负载配色 | 截图依赖 Windows `ms-screenclip:`，其他系统退回全屏截图；快捷工具与桌宠已改为交互组件（经验 L16），实机点击需在 Windows 验收 |
| 图标收纳 / Dock | 四种形态与全局保存；导入/删除按组件串行，移动前先持久化恢复记录，部分恢复失败保留组件及剩余记录 | 隔离目录已验证真实文件移动；单项移回桌面/拖出恢复体验与真实 Shell 场景仍待细化 |
| 便签（LavaNotes） | 内置便利贴已移除；“小组件 > 便签”页检测 `lavanotes://` 协议，已安装则新建/显示/打开管理，未安装则提示下载；旧便利贴按命名空间备份到 userData 的 `legacy-sticky-notes/` | LavaNotes 的透明窗口、钉在桌面等能力在其独立仓库验证；协议检测需 Windows 实机确认 |
| AI 生成组件 | 声明式协议、真实股票参数、落位、入场、交互、持久化和移除；对话内修改内容/配色，按内容估算高度，强调色保证可读 | 可视化编辑/撤销体验待完善 |
| 像素宠物 | 配置分页、默认角色、动作预览、模型生成入口、桌面同步；桌面 Pet 组件悬停提示、点击回应并打开快捷对话、未读回复红点 | 细腻情绪联动、Q 版宠物和行为增强待完成 |
| 壁纸库/在线库 UI | 本地库、在线下载/更新/删除，所有者发布管理入口 | 所有者 UI 不等同授权，后端身份与仓库权限独立检查 |
| FlowWall 在线壁纸库 | 壁纸资源下的“FlowWall 发现”内嵌站点（独立分区、无 Node/preload、导航分类）；接管站点下载，按文件头校验、改名、判重后导入「我的壁纸」并标注来源，面板内一键设为壁纸；`lingyue://` 打开/导入协议（导入需确认）；设计见 [FlowWall 在线壁纸库接入设计](../../doc/FlowWall在线壁纸库接入设计.md) | 开发容器无法访问 flowwall.ai，真实站点下载按钮（直链/blob/需登录）未实测，仅用本地替身站点验证；Windows DPI 下视图贴合与安装版协议注册待实机验收 |

## 数据服务与 AI 伴侣

| 模块 | 当前能力 | 未完成/验证边界 |
| --- | --- | --- |
| 新闻/股票服务 | 新闻源 codelife/weibo、东方财富行情、API 能力注册与缓存兜底 | 这里记录代码接入，不保证当前服务在线 |
| 天气/位置/系统信息工具 | AI weather、城市级定位/可选精准定位、get_system_info 已接入；天气与系统监控小组件复用主进程服务 | 精准定位取决于授权与设备可用性 |
| 模型与流式聊天 | OpenAI 兼容/Gemini/DeepSeek profile、模型列表和连接测试；DeepSeek 专用 thinking/tool-call 续聊；按模型名判断能否看图（设置页可改），系统提示固定前缀在前、时间/记忆/桌面现状在尾部 | 新模型兼容性要实际验证，不仅替换名称；工具选择正确率需用 `npm.cmd run eval:companion` 对实际模型测量 |
| 人设与过程 UI | Persona、默认伴侣基调、工具前短句、textOffset 交错时间线、耗时和失败反馈；回复按 Markdown 子集渲染，桌面改动显示回执条与一键撤回，需要确认的动作显示确认卡（Enter 同意/Esc 拒绝、倒计时条），多条改动可全部撤回，重启后的旧回执显示为过期；真实附件（原生选择器授权，粘贴/拖入以副本导入） | 回复仍偏任务型；口吻、情绪识别需增强 |
| 长期记忆 | SQLite 迁移、关键词/语义混合检索、上下文预算、结构化归档和敏感度边界已接入 | 尚无完整记忆场景 E2E；设计中的管理/检索目标不自动算已实现 |
| 轻量电脑控制 | 剪贴板、打开链接、搜索；壁纸切换/设置/多屏模式/在线安装；开始菜单/桌面/Dock 应用搜索与打开；显示桌面、系统设置页白名单、常用文件夹、音量与媒体键、截屏（可看图或 OCR）；白噪音；提醒（一次/重复/天气早报/久坐/安静时段）。桌面类工具每轮常驻，打开应用与截屏由界面确认，设计见 [伴侣智能体桌面控制设计](../../doc/伴侣智能体桌面控制设计.md) | 容器内已验证托管执行、确认、撤回与截屏链路；`SendInput`、开始菜单索引、应用唤起、通知需 Windows 实机验收 |
| 桌面组件控制 | 声明式生成；设置按 [组件设置规格](../../src/shared/widget-config-spec.ts) 校验并返回可选值；预设/锚点添加、`arrange_widget` 移动缩放隐藏置顶（组件所在显示器本地工作区）；删除 Dock/图标收纳由界面确认；便签与待办经 `open_lavanotes` 交给 LavaNotes（未安装时返回下载地址）；AI 的桌面改动按组件差异记录并可逐条/按轮撤回；用户桌面模式保存与切换 | 新增组件设置时须同步规格与测试；删除图标类组件不可自动撤回（涉及真实文件） |
| 桌面快捷对话与桌宠联动 | 全局热键（默认 Ctrl+Alt+Space，设置页按键录制/恢复默认/关闭）、点击桌宠或托盘打开独立 quick-chat 窗口；输入框自动增高、↑ 找回上一句、Ctrl+N 新话题、粘贴截图/拖入文件；“以后都直接做”的授权可在设置收回；独立会话可交给主界面继续；收起后回复由桌宠气泡说出；桌宠跟随思考/检索/整理/出错阶段 | 隔离生产渲染器已验证发送、确认、撤回；热键冲突、窗口层级与多屏落位待 Windows 实机验收 |
| 高级工作区 Agent | Planner、审批作用域、checkpoint、artifact、自动化终态、验证结构已有实现 | 作为高级辅助保留；不要把审批等待/失败标为完成 |
| 自检/自修复 | 明确应用本体只读、运行时数据可修的设计边界 | 诊断 UI 与受控修复流程待补，不宣称已具备完整自修复 |

## 验证与待办

已有 Node 单元/契约测试，`npm.cmd test` 包含类型、只读 lint 和测试；部分测试核对源码结构，不等于端到端。命令与分层验证规则见根规则，测试数量只写实际执行当次日志，不在此维护常驻计数。

新增 `npm.cmd run test:electron:smoke`：先生产构建，再用隐藏 Electron 窗口、独立临时 userData 与合成资源验证协议沙箱、生产壁纸渲染器、显示工具栏、快捷对话与 FlowWall 下载接管（本地替身站点），不加载应用正常入口或真实桌面数据。这是有限的集成冒烟测试，不是完整 E2E。

最近设备验证为 09-05 本机 1.1.12 单屏安装态：主界面可用，壁纸原生贴合成功，原组件/全局图标配置及记忆库保留。模拟多屏、合成视频时钟测试与 Win32 直接调用不能替代目标公司环境验收。

- [ ] 混合 DPI 双屏：左右/负坐标、主屏切换、四种壁纸模式、热插拔、组件跨屏持久化与逐屏毛玻璃。
- [ ] 补齐 Windows 全屏/长锁屏/远控场景验证与可重复的集成/E2E 覆盖。
- [ ] 完成 Audio 实时输入、QuickTools 功能、SysMonitor 真实数据；天气公网异常与长期运行实测。
- [ ] 优化 Canvas 高频同步存储/原生拓扑查询，以及静态壁纸 watchdog 的重复 capturePage；保持输入/毛玻璃效果等价。
- [ ] 增强伴侣回复、情绪反馈、等待状态、Q 版桌宠与行为联动。
- [ ] AI 组件可视化编辑、复制（AI 改动的撤回已由回执提供）；图标单项移回/拖出恢复体验。
- [ ] 运行时自检/自修复诊断 UI。
- [ ] 伴侣桌面控制 Windows 实机验收：快捷对话热键与窗口层级、开始菜单应用唤起、音量/媒体键、截屏与系统通知、提醒到点和安静时段；用实际模型跑 `npm.cmd run eval:companion`，工具选择正确率目标 ≥ 90%。
- [ ] 1.2.0 Windows 实机安装验收：已装 1.1.14 的灵月桌面能自动下载 1.2.0 并安装为 LavaDesk；首次启动自动关闭旧版并迁移 `%APPDATA%\lingyue-desk`（壁纸、组件、图标收纳快捷方式、聊天记忆、设置），旧版开机启动被取消、可卸载旧版；“便签”页与 AI 能检测并唤起 LavaNotes。配置 Windows 代码签名。
- [ ] 桌面图标导入测试依赖 Windows 路径分隔符，在 Linux 上失败；如需跨平台 CI 应改为平台无关断言。

## 常用源码入口

| 需求 | 入口 |
| --- | --- |
| 共享通道/类型 | [ipc-channels.ts](../../src/shared/ipc-channels.ts)、[types.ts](../../src/shared/types.ts) |
| 组件尺寸/保存/置顶 | [widgetIpc.ts](../../src/main/ipc/widgetIpc.ts) 的 WIDGET_SIZE_MAP 与配置处理 |
| 组件渲染/主题 | [widgets/index.tsx](../../src/renderer/widgets/index.tsx)、[shared/constants.tsx](../../src/renderer/widgets/shared/constants.tsx) |
| 运行时可变路径 | [userDataPaths.ts](../../src/main/runtime/userDataPaths.ts) |
| 图标收纳 / 便签入口 | [DesktopIcons.tsx](../../src/renderer/widgets/DesktopIcons/DesktopIcons.tsx)、[LavaNotesPanel.tsx](../../src/renderer/main-ui/pages/widgets/LavaNotesPanel.tsx)、[lavanotes-service.ts](../../src/main/services/lavanotes-service.ts) |
| 旧版数据迁移 | [legacyUserDataCore.ts](../../src/main/runtime/legacyUserDataCore.ts)、[legacyDataMigration.ts](../../src/main/runtime/legacyDataMigration.ts) |
| 像素桌宠 | [PixelPetPage.tsx](../../src/renderer/main-ui/pages/pet/PixelPetPage.tsx)、[pixel-pet.ts](../../src/renderer/shared/pixel-pet.ts)、[PixelPetCanvas.tsx](../../src/renderer/shared/PixelPetCanvas.tsx) |
| 聊天 UI/IPC | [ChatPage.tsx](../../src/renderer/main-ui/pages/chat/ChatPage.tsx)、[chatIpc.ts](../../src/main/ipc/chatIpc.ts) |
| 伴侣桌面控制/快捷对话 | [toolExecution.ts](../../src/main/memory/chat/toolExecution.ts)、[desktop-control.ts](../../src/main/memory/tools/definitions/desktop-control.ts)、[QuickChat.tsx](../../src/renderer/quick-chat/QuickChat.tsx) |

更多代码与测试入口按知识索引/经验检索，不在状态页重复维护全量文件清单。
