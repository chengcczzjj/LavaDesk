# 可复用开发经验

> 整理日期：2026-09-05。来源为现有代码、测试与 [开发日志及月度归档](dev-log.md)。本页是按需检索的工程知识，不替代 [AGENTS.md](../../AGENTS.md) 或用户本次要求；不包含应用用户的长期记忆。
> “代码/测试入口”表示可复核证据，不承诺完整测试覆盖；仅有源码契约的部分仍需实机验证。新增经验沿用编号；失效时修订原条并说明替代关系。

## L01 运行时持久化：默认资源与用户覆盖分离

- 适用：壁纸导入、配置保存、AI 组件调整、打包后自修复。
- 根因：安装目录/asar 不应写入；直接改内置默认值会受权限、更新覆盖影响。切换壁纸时旧防抖保存还可能写错命名空间。
- 当前约束：路径经 userData helper 生成；待写快照绑定产生时的命名空间，防抖仅合并不丢弃。切换和正常退出前排空写入；新覆盖文件先读/校验，只有 ENOENT 回退默认，损坏/权限失败保留当前状态并拒绝切换。覆盖文件使用同目录临时文件加 rename，无壁纸使用独立命名空间。
- 代码：[userDataPaths.ts](../../src/main/runtime/userDataPaths.ts)、[widgetIpc.ts](../../src/main/ipc/widgetIpc.ts)、[wallpaperIpc.ts](../../src/main/ipc/wallpaperIpc.ts)。
- 验证：[desktop-ipc-regressions.test.mjs](../../tests/desktop-ipc-regressions.test.mjs) 覆盖快速 A-B-A、同命名空间重载、损坏/写失败、无壁纸重启、退出 flush；开发态可写目录不代替安装态/断电验证。
- 替代关系：2026-09-05 修复替代早期“切换前取消保存、加载失败清空”的做法；保留 2026-05-26 默认资源与运行时可变层分离的原则。

## L02 sandbox preload：单入口不是可随意拆分的打包细节

- 适用：preload、构建入口、新窗口或 bridge 变更。
- 根因：多 preload 入口被 Rollup 拆成本地共享 chunk，sandbox 中加载失败会造成主界面白屏。
- 当前约束：保留一个 preload 打包入口，按 `--lingyue-window-role` 暴露对应 API；修白屏不能靠关闭 sandbox 或把全部角色 API 暴露给每个窗口。
- 代码：[electron.vite.config.ts](../../electron.vite.config.ts)、[preload/index.ts](../../src/preload/index.ts)。测试：[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)。
- 验证：类型与契约之外检查生产构建；若用户授权打包，检查产物中的 preload 引用及三类窗口启动。
- 来源：2026-08-01 首个正式版本白屏修复。

## L03 多屏：完整核对模式、稳定归属与坐标空间

- 适用：壁纸跨屏错位、组件切模式跳动、混合 DPI、负坐标和热插拔。
- 根因：`SetParent` 不负责显示器位置；DIP/物理像素/父窗口坐标混用会产生半屏错位。`GetMonitorInfoW` 的 `cbSize` 若被纯 `out` 参数清零，稳定键查询会静默失效。
- 当前约束：保持持久化的四种显示模式；每个目标屏幕建本地壁纸窗口，延展只共享虚拟构图并逐屏裁切。原生参数使用 `inout` 保留输入，调整 `WS_CHILD/WS_POPUP`、`ScreenToClient` 后以 `GetWindowRect` 校验实际边界。
- 组件保存设备键与显示器本地坐标，旧虚拟 Canvas 坐标只做一次迁移；工作区缩小时只钳制渲染投影，不覆盖保存坐标。Win32 设备键并非任意硬件变化下的永久身份，匹配失败/降级必须结合诊断确认。
- 模式、分配、应用与热插拔统一协调实际主屏壁纸及组件命名空间。壁纸设置按 ID 合并后同步当前快照/布局，未开始的滑条保存按 ID 合并，避免磁盘较慢时无界排队。renderer 只使用自己显示器的有效设置；延迟初始请求不得覆盖更新推送，旧主屏快照不得重置已加载图片/网页的可见状态。复制/延展视频共用时钟并只有一个音频所有者；通用 Web 动画没有因此获得同步。
- 代码：[nativeDisplayIdentity.ts](../../src/main/windows/nativeDisplayIdentity.ts)、[attachWallpaperNative.ts](../../src/main/windows/attachWallpaperNative.ts)、[widget-display-layout.ts](../../src/shared/widget-display-layout.ts)。测试：[wallpaper-display.test.mjs](../../tests/wallpaper-display.test.mjs)、[widget-display-layout.test.mjs](../../tests/widget-display-layout.test.mjs)。
- 验证：检查 `display-diagnostics.jsonl` 的拓扑、expected/actual 边界、归属与重试；单屏/纯函数测试不证明混合 DPI 双屏通过。
- 替代关系：2026-08-27 固定按屏模式被 08-30 恢复四模式替代；08-24 的单跨屏延展窗口被 09-04 逐屏裁切替代。09-05 补齐状态一致性与视频纠偏；[wallpaper-renderer.cjs](../../tests/electron/wallpaper-renderer.cjs) 验证生产渲染器，不代表硬件帧精确同步。

## L04 原生点击补偿：先确认前台归属，不只看坐标

- 适用：Dock/图标收纳点击失效、前台窗口遮挡、远控输入。
- 根因：renderer 没收到 `pointerdown` 不一定是丢事件，也可能是用户正在点击覆盖它的其他窗口；仅按坐标补偿会误启动桌面应用。
- 当前约束：原生命中与 IPC 双端校验真实 Canvas 归属，无法确认时拒绝；只补偿 renderer 未确认的短距离真实点击。启动目标从持久化组件记录解析，不能信任 renderer 任意传入的路径。
- 代码：[canvas-hit-test.ts](../../src/shared/canvas-hit-test.ts)、[canvasWindow.ts](../../src/main/windows/canvasWindow.ts)、[desktopIconIpc.ts](../../src/main/ipc/desktopIconIpc.ts)。测试：[shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs)、[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)。
- 验证：前台普通窗口盖住图标时不能闪动/启动；无 renderer 回执时只补偿一次；日志与实际输入共同判定。
- 来源：2026-08-05 的点击兜底在 08-08 因前台误触被收紧，不能恢复最早的坐标级无条件补偿。

## L05 Canvas 恢复：遮挡、手势、焦点和输入表面分别处理

- 适用：退出全屏、长时间锁屏后便笺不可编辑、ToDesk 前台闪烁。
- 根因：DOM 命中正常不代表 Windows 已投递按下事件；反复 z-order 重组合、pointer capture 和穿透状态竞争也会截断输入。
- 当前约束：穿透由画布级指针门控制，手势完成前保持锁定；稳定遮挡转换后才恢复。已知长启动遮挡或真实点击无回执按条件重建 Canvas，保留组件数据；不要用每次 hover 抬升窗口代替修复。
- “未遮挡”不是“可以置顶”。仅 Windows Shell / 无前台窗口等已确认场景允许桌面返回层级恢复；普通应用、远控前台跳过。
- 代码：[canvas-pointer-gate.ts](../../src/shared/canvas-pointer-gate.ts)、[canvas-hit-test.ts](../../src/shared/canvas-hit-test.ts)、[canvasWindow.ts](../../src/main/windows/canvasWindow.ts)。测试：[shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs)。
- 验证：对照原生按键、renderer pointerdown/up、焦点与恢复事件；开发进程和安装进程的日志不可混用。
- 来源：2026-08-01/03 手势与恢复修复、08-29 锁屏重建、08-30 ToDesk 门禁；后两者收紧早期无条件置顶经验。

## L06 组件层级显式持久化；便利贴已移出画布

- 适用：组件拖动、碰撞、缩放、置顶。
- 根因：仅用数组顺序表示层级会在异步保存中覆盖新操作。
- 当前约束：组件采用持久化 `stackOrder`，位置/配置写入不能覆盖更晚的置顶操作；浮动组件尺寸在字体就绪后实测，不只按缩放系数推算。
- 替代关系：2026-10-07 起内置便利贴（`todo-board`）整体移除，改由独立软件 [LavaNotes](https://github.com/chengcczzjj/LavaNotes) 以“每张便签一个透明窗口”实现。全屏透明 Canvas 为便利贴做的自由拖动、临时键盘焦点（`setCanvasTextInputActive`）和点击置顶 IPC 一并删除；旧数据处理见 L18。
- 代码：[widget-order.ts](../../src/shared/widget-order.ts)、[widgetIpc.ts](../../src/main/ipc/widgetIpc.ts)。测试：[shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs)。
- 来源：2026-04-26 视觉尺寸、08-16 便利贴重做、08-30 显式层级、10-07 便签拆分。

## L07 毛玻璃优化：不以降画质掩盖管线开销

- 适用：壁纸抽帧、模糊、常驻 CPU 和 React 重渲染。
- 根因：透明窗口 `backdrop-filter` 不能代替另一个壁纸窗口的像素采样；将每帧图像作为 React 状态广播会扩大渲染开销。复用 Canvas 时不清理会残留透明边缘。
- 当前约束：逐显示器传输帧和边界，失活 watchdog 与主进程 capture 兜底保留；复用离屏 Canvas 前清理，帧更新避免带动无关组件提交。
- 代码：[wallpaperFrameStore.ts](../../src/renderer/canvas/wallpaperFrameStore.ts)、[FrostedGlassBackground.tsx](../../src/renderer/widgets/FrostedGlassBackground.tsx)、[Wallpaper.tsx](../../src/renderer/wallpaper/Wallpaper.tsx)。测试：[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)、[wallpaper-display.test.mjs](../../tests/wallpaper-display.test.mjs)。
- 验证：用户要求视觉不变时保留分辨率、频率、质量、模糊和裁切，做等价图像对比；轮询优化同时检查手势期响应。只报告实际测得的性能，不沿用旧数字。
- 来源：2026-08-01 跨窗口采样、08-16 帧管线等价验证、08-30 自适应轮询、09-04 逐屏帧。

## L08 桌面图标：文件安全、Shell 语义与动画连续性

- 适用：导入/恢复快捷方式、单实例应用唤醒、Dock 点击反馈。
- 根因：Shell 虚拟项没有真实路径；copy/delete 兜底可能丢源文件。直接启动快捷方式 target 不等于双击原快捷方式；启动器或 1px 内部窗不等于应用主窗口。
- 当前约束：跳过无路径虚拟项，导入用安全 rename；2026-09-05 改为移动前先校验并持久化恢复记录（见 L13），避免先移动后发现写入超限。优先 Windows Shell 打开原快捷方式。窗口唤醒验证可见性、尺寸和应用家族，不仅匹配进程名。
- 动画层分离但悬停缩放保持连续，扩散副本从点击瞬间的实际尺寸开始；“回到桌面”不播放启动动画。
- 代码：[desktopIconIpc.ts](../../src/main/ipc/desktopIconIpc.ts)、[foregroundAppWindow.ts](../../src/main/windows/foregroundAppWindow.ts)、[DesktopIcons.tsx](../../src/renderer/widgets/DesktopIcons/DesktopIcons.tsx)。测试：[shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs)、[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)。
- 验证：同名目标冲突、导入失败回滚、Shell 虚拟项、已运行应用唤醒；文件操作还需真实环境验证。
- 替代关系：2026-05-05/06 的安全导入经验仍有效；08-16 18:23 的点击归一基础倍率被 18:37 连续缩放修复替代，更早的等待弹跳不再是当前方案。

## L09 AI 过程与记忆：真实结果、权限和产品定位分开

- 适用：上下文、人设、工具过程、长期记忆、审批和任务终态。
- 根因：文本与工具事件粗略合并会乱序/丢记录；兼容适配会丢 DeepSeek thinking 续聊所需字段；旧失败兜底可能覆盖已交付结果。
- 当前约束：文本与工具按 `textOffset` 还原时间线；DeepSeek 专用链路保留 `reasoning_content`。等待审批、取消、失败不能归一为完成，工具结果成功也不等于产物已经验收。
- 上下文有预算，普通召回遵守 scene/scope/sensitivity 过滤；应用用户记忆与工程日志不互相灌入。不能因为“轻量体验、减少确认”就删除文件/命令的权限、审批或 checkpoint 校验。
- 代码：[contextPacker.ts](../../src/main/memory/routing/contextPacker.ts)、[retrievalRouter.ts](../../src/main/memory/routing/retrievalRouter.ts)、[privacyGate.ts](../../src/main/memory/security/privacyGate.ts)、[deepseekToolChat.ts](../../src/main/memory/models/deepseekToolChat.ts)、[chatService.ts](../../src/main/memory/chat/chatService.ts)。测试：[shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs) 覆盖审批作用域、终态及模型别名等契约，并非完整记忆/流式对话 E2E。
- 验证：失败后成功交付、审批等待/取消、空召回、跨项目/私密场景隔离与长会话预算；不要把提示词声明当成后端强制保证。
- 来源：2026-05-04/15 Agent 过程、05-25/26 伴侣优先方向及 08-01 架构升级。

## L10 下载与发布：UI 门禁不是授权，ZIP 不是可信目录

- 适用：在线壁纸、解压、所有者发布、更新错误展示。
- 根因：远程 ZIP 可能损坏、越界或被替换；隐藏发布按钮不能限制后端写权限；原始更新错误可能包含响应头/Cookie。
- 当前约束：检查 HTTPS、声明大小、SHA-256、路径及符号链接；临时 staging 校验后原子替换，失败回滚旧版本。更新/删除检查全部保存的显示器分配（含断开屏幕）及进行中的应用，并与应用互斥；不能只查 current。所有者入口同时校验身份与仓库写权限，凭据不传渲染层。
- 代码：[wallpaper-resource-service.ts](../../src/main/services/wallpaper-resource-service.ts)、[safe-zip.ts](../../src/main/services/safe-zip.ts)、[wallpaper-owner-service.ts](../../src/main/services/wallpaper-owner-service.ts)、[update-service.ts](../../src/main/services/update-service.ts)。测试：[wallpaper-resource.test.mjs](../../tests/wallpaper-resource.test.mjs)、[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)。
- 验证：损坏包、路径越界、符号链接、旧版本保留与脱敏错误；工程记录只留脱敏结论，不粘贴凭据/原始网络响应。
- 来源：2026-08-01 更新错误、08-18 独立资源库安全安装与所有者发布。

## L11 验证与交付：代码、构建、本机安装、远端发布四种事实

- 适用：收尾、版本状态、Windows 原生问题和发布说明。
- 根因：源码契约能通过但原生 ABI 调用失败；代码版本不等于实际运行版本，本机包不等于 GitHub Release，单屏不等于多屏验收。09-05 本机已装新版而公司电脑拿不到更新，说明本地提交、git push 与更新渠道资产发布不能互相替代。
- 当前约束：分别记录测试、构建、安装/进程版本、远端资产验证；缺哪个就明确写未做。先读已脱敏的持久日志缩小问题，不把“UI 能保存设置”当完整链路证据。
- 代码：[diagnosticLog.ts](../../src/main/runtime/diagnosticLog.ts)、[electron-builder.yml](../../electron-builder.yml)、[release-windows.yml](../../.github/workflows/release-windows.yml)、[verify-windows-release.mjs](../../scripts/verify-windows-release.mjs)。测试：[release-contracts.test.mjs](../../tests/release-contracts.test.mjs)；它只约束配置和源码，不能证明安装/发布成功。
- 2026-09-25 起无 Windows 本机时由 Actions 构建发布：流程通过只说明 CI 构建、清单核验和公开资产可下载，仍不等于实机安装与客户端更新验收。
- 隔离 Electron 测试显式控制退出：清理窗口时不能由自动退出掩盖断言失败，启动器必须同时检查退出码和成功标记。09-05 的静态壁纸回归已验证“先失败、修复后通过”。
- 验证：运行时主要诊断文件为 `dock-diagnostics.jsonl`、`display-diagnostics.jsonl`、`update-diagnostics.jsonl`（userData/logs）；核对 pid、时间、版本及真实场景。网络/设备无法验证时不推测通过。
- 来源：2026-08-29 安装版不一致、09-04 Koffi 原生实测与 1.1.11 仅本地安装、09-05 跨电脑更新缺失。用户已在根规则明确“提交/打包”的交付约定，替代旧的独立推送/发布确认要求；历史记录的本地交付结论仍保留，不能据此假定旧版已远端发布。

## L12 工程记忆：去重复内容，不抹掉纠错过程

- 适用：Agent 规则、交接、日志整理与自动提交。
- 根因：多入口复制命令与 Git 策略会漂移；提交后回填日志制造新的脏工作树；主观完成率与旧设计快照容易冒充当前事实。
- 当前做法：根规则单点维护、适配仅引用；状态/事件/经验分层，旧方案在知识索引标有效性。日志先写“提交意图”再一起提交，实际提交哈希在最终回复只读核验。
- 检查：[agent-docs.test.mjs](../../tests/agent-docs.test.mjs) 检查导航链接、已声明脚本和事件重复等机械约束；提交权限、历史方案有效性仍需语义复核。
- 来源：2026-09-05 工程知识审计；后续修改规则按同一入口同步，避免再次分叉。

## L13 组件和托管文件：读取不修复，限制增长不丢历史

- 适用：组件数量/配置限额、旧版大记录、损坏存储、Dock 导入与删除。
- 根因：用新增输入限额校验已有数据，再把失败转为 [] 回写，会清空组件和文件恢复线索；先移动文件再保存记录会在超限/异常时产生孤儿文件。
- 当前做法：读取只校验结构且不回写，损坏明确报错；新增/增长执行数量与配置字节限制，已有大记录可读和缩减。运行时组件和全局图标通过一次 store 写入同步，加载完整校验前不做半次全局迁移。
- 文件移动前先保存 originalPath/managedPath，导入/删除按组件串行；恢复部分失败仅移除成功项，保留当前组件的新修改及未恢复记录。迟到更新不能重新创建已删除组件。
- 代码：[widget-data.ts](../../src/shared/widget-data.ts)、[widget-persistence.ts](../../src/main/services/widget-persistence.ts)、[desktop-icon-operations.ts](../../src/main/services/desktop-icon-operations.ts)。测试：[desktop-ipc-regressions.test.mjs](../../tests/desktop-ipc-regressions.test.mjs) 使用独立临时目录与生产 IPC，未操作真实桌面。
- 来源：2026-09-05 壁纸/组件/显示器高优先级修复；不宣称跨多个文件或异常断电的完整事务保证。

## L14 网页壁纸：选文件不等于授权父目录

- 适用：本地 HTML/ZIP 导入、自定义协议、网页 iframe 与本地资源访问。
- 根因：选择一个 HTML 却授权/复制整个父目录会带入无关私人文件；所有网页共享来源会扩大跨包读取与执行能力。
- 当前做法：单 HTML 仅复制/授权选中文件，完整相对依赖必须显式选择 ZIP；每个包使用独立随机来源，以 realpath 限定包根目录，拒绝穿越/junction。共享 lyasset local 来源只提供被授权的被动媒体，不提供 HTML/脚本/配置。
- CSP 与 iframe 沙箱保留包内脚本/样式/fetch，隔离父页面和 bridge，禁止子框架/对象/表单及顶层逃逸；网络 HTTPS 能力仍允许，不应把网页内容当可信应用代码。
- 代码：[protocols.ts](../../src/main/protocols.ts)。测试：[wallpaper-security.test.mjs](../../tests/wallpaper-security.test.mjs)、[wallpaper-sandbox.cjs](../../tests/electron/wallpaper-sandbox.cjs)；后者在实际 Electron/Chromium 中验证隔离，不仅匹配 CSP 字符串。
- 来源：2026-09-05 网页壁纸安全修复；第三方壁纸若依赖被禁能力应报告兼容性问题，不回退整目录授权或关闭沙箱。

## L15 伴侣桌面控制：能力可见、确认和撤回都写在代码里

- 适用：聊天智能体的工具暴露、桌面写操作、需要用户同意的动作、回执与撤回、系统提示结构。
- 根因：按中文正则逐轮裁剪工具，换个说法模型就“看不到”该用的工具，只能口头答应；工具结果只回放文字，下一轮不知道刚改了什么；删除 Dock 的 `confirmed=true` 由模型自己填；旧工具返回 `success:false` 而判定只认 `ok:false`，失败被显示成“已处理”；同一轮里写操作之后仍命中缓存的只读结果；天气工具描述在提交时被编码成问号，模型读到的是乱码。
- 当前做法：桌面类工具常驻并按清单顺序发送，重工具（文件/命令/编排草案/附件）仍按工作区、意图或附件门控；系统提示固定前缀在前，时间、记忆、【桌面现状】、【最近的桌面操作】在尾部。确认由策略在工具包装层挂起并由界面回答，模型参数不能绕过；后台运行没有确认通道即视为未同意。带 `journal` 的工具串行快照前后状态，按组件 id 差异撤回；删除图标类组件不可自动撤回。写操作清空本轮只读缓存；结果口径统一由 `tool-result.ts` 判断。
- 边界：日志只在内存保存；撤回在壁纸被换过或组件属于另一张壁纸时拒绝，而不是覆盖用户之后的改动。`SendInput`、开始菜单索引和热键只能在 Windows 实机验收。
- 代码：[toolRouter.ts](../../src/main/memory/tools/toolRouter.ts)、[toolExecution.ts](../../src/main/memory/chat/toolExecution.ts)、[actionPolicy.ts](../../src/main/memory/desktop/actionPolicy.ts)、[desktopState.ts](../../src/main/memory/desktop/desktopState.ts)、[agent-actions.ts](../../src/shared/agent-actions.ts)。测试：[companion-agent.test.mjs](../../tests/companion-agent.test.mjs)（含 87 句中文指令可达性评测）、[quick-chat.cjs](../../tests/electron/quick-chat.cjs)；真实模型正确率用 `npm.cmd run eval:companion` 测量。
- 来源：2026-09-26 伴侣智能体桌面控制迭代；设计见 [伴侣智能体桌面控制设计](../../doc/伴侣智能体桌面控制设计.md)。L09 的“工具调用不回放为消息”约束不变，改为注入确定性的操作摘要。
- 补充（2026-09-27）：粘贴/拖入的附件只以字节交给主进程另存副本（图片校验文件头），渲染层不传、也拿不到路径；按路径授权只来自原生选择器。回执状态以操作日志为准（`ActionJournal.status`），重启后显示过期而不是给出必然失败的撤回按钮。测试：[companion-ux.test.mjs](../../tests/companion-ux.test.mjs)。

## L16 可点击的桌面组件不能留在“被动组件”名单

- 适用：给画布组件新增点击、按钮或悬停交互（桌宠、快捷工具等），或调整 `PASSIVE_WIDGET_TYPES`。
- 根因：被动名单决定 Windows 下光标经过组件时画布是否取消鼠标穿透。名单内的组件在实机上点击会直接落到桌面/后方窗口；Linux 容器和 Playwright 不走原生命中，点击照常生效，所以测试全绿也发现不了。
- 当前约束：只有纯展示组件（时钟、天气、新闻、日历、系统监控等）留在名单；有点击动作的组件必须移出，并在 [shared-contracts.test.mjs](../../tests/shared-contracts.test.mjs) 断言。交互组件在非编辑态不走长按拖动（交互优先），移动用编辑模式。
- 代码：[canvas-hit-test.ts](../../src/shared/canvas-hit-test.ts)、[Canvas.tsx](../../src/renderer/canvas/Canvas.tsx)（`data-widget-interactive`）、[canvasWindow.ts](../../src/main/windows/canvasWindow.ts)。
- 验证：Windows 实机点击桌宠/快捷工具并确认未触发桌面；与 L04/L05 的遮挡与前台归属判断一起观察，不以提升窗口层级代替。
- 来源：2026-08-24 快捷工具与桌宠因当时只是占位被列为被动；2026-09-26 桌宠加入“点我聊天”时遗漏，09-27 快捷工具接入真实动作时发现并修正。

## L17 内嵌第三方站点与下载：隔离分区、按内容信任、等判重答案

- 适用：FlowWall 等在线壁纸站点的内嵌浏览、捕获站点下载、`lingyue://` 协议请求。
- 根因：站点页面与下载内容都不受应用控制；需登录/会员时下载链接可能返回 HTML 登录页却仍叫 `.mp4`；CDN 签名让同一文件每次 URL 不同；小文件往往在异步判重（读壁纸库）返回前就已下载完成，只在“仍在下载”时取消会漏掉重复，库里出现两份。
- 当前约束：独立持久分区、sandbox、无 preload/Node，权限默认拒绝，`file:`/`javascript:` 导航拦截，站外链接交给系统浏览器；只接管壁纸类型下载，按文件头签名信任并按真实类型改名；判重键为去掉查询串的来源地址且壁纸仍在库中，下载完成后等待判重结果再导入；协议导入一律弹窗确认并写明域名。不绕过站点登录/付费，不抓私有接口。
- 代码：[flowwall.ts](../../src/shared/flowwall.ts)、[media-signature.ts](../../src/shared/media-signature.ts)、[flowwall-library.ts](../../src/main/services/flowwall-library.ts)。测试：[flowwall.test.mjs](../../tests/flowwall.test.mjs)（含判重竞态回归，旧逻辑下失败）、[flowwall.cjs](../../tests/electron/flowwall.cjs)。
- 验证：真实站点的下载形态（直链/blob/需登录）与 Windows DPI 下的视图贴合仍待实测；开发构建可用 `LINGYUE_FLOWWALL_HOME` 指向本地替身站点。
- 来源：2026-09-27 FlowWall 在线壁纸库接入；设计见 [FlowWall 在线壁纸库接入设计](../../doc/FlowWall在线壁纸库接入设计.md)。与 L10 一致：UI 门禁不是授权，下载文件不是可信内容。

## L18 改名与退役：先保证旧数据能读，再迁移

- 适用：改产品名/appId/数据目录、删除组件类型、更换数据文件名。
- 根因：Electron 的 userData 目录取自 `productName`（无则 `name`），改名即换目录；`storedWidgetSchema` 用组件类型枚举校验，直接从枚举删掉 `todo-board` 会让所有含旧便利贴的配置被判为“格式异常”而拒绝加载。electron-store、记忆库和 Chromium 一旦打开新目录就会写入默认文件，迁移必须在它们之前完成。
- 当前做法：退役类型列在 `RETIRED_WIDGET_TYPES`，读取仍接受，加载时先按命名空间备份到 `legacy-sticky-notes/` 再过滤，新增时拒绝。迁移模块是主进程第一个 import：仅安装版运行，先关闭旧进程，再整目录复制到暂存目录（跳过 Chromium 缓存与锁文件）、按映射改文件名、改写 JSON 中指向旧目录的绝对路径，最后逐项移入新目录并写 `.lavadesk-migration.json`。新目录已有 LavaDesk 自己的数据时不覆盖；旧目录原样保留。
- 代码：[widget-data.ts](../../src/shared/widget-data.ts)、[legacyUserDataCore.ts](../../src/main/runtime/legacyUserDataCore.ts)、[legacyDataMigration.ts](../../src/main/runtime/legacyDataMigration.ts)。测试：[legacy-migration.test.mjs](../../tests/legacy-migration.test.mjs)、[desktop-ipc-regressions.test.mjs](../../tests/desktop-ipc-regressions.test.mjs)。
- 验证：2026-10-07 容器内用 Linux 打包版对伪造旧目录实测复制、改名、路径改写和标记；Windows 下关闭旧进程、取消旧开机启动、卸载旧版需实机验收。SQLite 内若存有旧目录绝对路径不会被改写，旧目录保留期间仍可访问。
- 来源：2026-10-07 LingyueDesk → LavaDesk 改名与便签拆分。
