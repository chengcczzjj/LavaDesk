# LavaDesk

Windows 桌面 AI 伴侣应用：动态壁纸、桌面组件、AI 对话与像素桌宠。原名灵月桌面（LingyueDesk），1.2.0 起改名 LavaDesk，与 [LavaTranslate](https://github.com/chengcczzjj/LavaTranslate)、[LavaNotes](https://github.com/chengcczzjj/LavaNotes) 同属 Lava 系列；AI 伴侣的名字仍是“灵月”。

## 便签：LavaNotes

桌面便签已拆分为独立开源软件 [LavaNotes](https://github.com/chengcczzjj/LavaNotes)：每张便签是一个透明纸张窗口，可插入图片和表格、右下角缩放，还能钉在桌面上（显示桌面、最小化全部窗口都不会收起）。LavaDesk 的“小组件 > 便签”页面会检测 LavaNotes：已安装就直接新建/打开，未安装则提示下载。AI 伴侣通过 `lavanotes://` 协议唤起它。旧版内置便利贴不再显示，升级时其数据会在本机备份到数据目录的 `legacy-sticky-notes/`。

## 从灵月桌面升级

LavaDesk 的安装标识、可执行文件和数据目录都已改名（`com.lavadesk.app`、`LavaDesk.exe`、`%APPDATA%\LavaDesk`），因此是一个新安装的应用，不会覆盖旧版。安装后首次启动时：

1. 如果旧版 `LingyueDesk.exe` 正在运行，LavaDesk 会先关闭它（数据库文件需要释放）。
2. 把 `%APPDATA%\lingyue-desk` 复制到 `%APPDATA%\LavaDesk`（跳过 Chromium 缓存），`lingyue-config.json`、`lingyue-memory.db` 等改为 `lavadesk-*` 文件名，并改写 JSON 里指向旧目录的绝对路径（例如图标收纳中的桌面快捷方式）。
3. 取消旧版的开机启动，并询问是否卸载旧版。旧数据目录保持原样作为备份，确认无误后可手动删除。

迁移结果记录在 `%APPDATA%\LavaDesk\.lavadesk-migration.json`；迁移逻辑见 [legacyUserDataCore.ts](src/main/runtime/legacyUserDataCore.ts)。

## 技术栈

Electron + React 19 + TypeScript + Vite (electron-vite) + Tailwind CSS v4 + Zustand + electron-store + electron-builder。

## 开发

```powershell
npm install
npm run dev
```

`npm install` 会顺便执行 `electron-builder install-app-deps` 重建原生模块。

> `electron-as-wallpaper` 是可选依赖，仅 Windows 可用。若安装失败，应用仍可启动，只是壁纸窗口不会嵌入桌面。
> 在 PowerShell 或 Codex 终端中，如果 `npm` 被执行策略拦截，可以改用 `npm.cmd`，例如 `npm.cmd run dev`。

## 验证

```powershell
npm run typecheck      # TypeScript 类型检查
npm run lint:check     # 只检查 ESLint，不自动改文件
npm run test:unit      # Node 单元与契约测试
npm test               # 标准验证：typecheck + lint:check + test:unit
npm run build:check    # electron-vite 生产构建检查
```

`npm test` 还会运行 `tests/` 中的共享契约、发布配置、IPC、安全 preload、Agent 与生成组件回归测试。当前尚未接入完整 E2E 套件。

## Agent / Codex 开发

README 面向开发者快速启动项目；开发智能体先读 [AGENTS.md](AGENTS.md)。当前能力见 [项目状态](TempFile/文档资料/project-status.md)，故障约束见 [开发经验](TempFile/文档资料/dev-lessons.md)，旧方案与月度日志入口见 [知识索引](TempFile/文档资料/knowledge-index.md)。这些是工程记忆，与应用内用户记忆分开维护。

## 构建

```powershell
npm run build:win        # 生成 NSIS 安装包
npm run build:win:signed # 使用已配置证书生成签名安装包
npm run build:dir        # 仅生成未打包目录，便于本地调试
```

`build:win` 默认保留图标和版本资源但不做代码签名，适合本机验证；面向外部分发应配置 Windows 代码签名证书并使用 `build:win:signed`。

## 版本与自动更新

正式版启动 15 秒后自动检查更新，之后每 6 小时以及电脑唤醒后（距上次检查超过 1 小时）检查一次；检查或下载失败按 2、10、30、60 分钟退避重试。发现新版本后自动在后台下载，完成后弹出系统通知，托盘菜单和左侧活动栏的更新按钮都会变为“重启并更新”，安装由用户确认。

发布必须有明确授权，区分本地构建、本机安装和远端发布：

1. 确认本次目标版本，同步 `package.json`、`package-lock.json` 和发布说明/契约，不照抄旧版本号。
2. 运行 `npm test`；按授权执行 `npm run build:win:signed`，未配置证书时仅用 `build:win` 做相应验证。
3. 本地安装不等于远端发布。仅在获准发布后，为相同版本创建标签和 GitHub Release，并上传匹配的 `dist/latest.yml`、安装包和 `.blockmap`，验证大小与哈希。推送 `v<版本>` 标签，或在工作流已合入 main 后于 Actions 中手动运行 [Windows 发布流程](.github/workflows/release-windows.yml) 并填写标签（构建所选分支的最新提交，发布时在该提交上创建标签）：在 windows-latest 上运行 `npm test`、Electron 冒烟和 `build:win -- --publish never`，由 [scripts/verify-windows-release.mjs](scripts/verify-windows-release.mjs) 核对清单、哈希与 asar 版本，先上传到草稿 Release、核对资产后再发布并复核公开更新源；同版本已发布时直接失败。
4. 更新源配置见 [electron-builder.yml](electron-builder.yml)；远端可访问性和客户端更新需要另行实测。Git push 与发布权限见根规则。

## 在线壁纸资源

“壁纸资源 > 壁纸库”通过独立的 `chengcczzjj/LavaDesk-Wallpapers` 公开仓库读取资源清单，支持按壁纸下载、SHA-256 校验、版本更新、应用和删除，不需要为新增壁纸发布整个应用版本。

正式安装版默认隐藏发布入口。仓库所有者可完全退出应用后，以所有者模式启动：

```powershell
& "$env:LOCALAPPDATA\Programs\LavaDesk\LavaDesk.exe" --lingyue-wallpaper-owner
```

进入“壁纸资源 > 壁纸库 > 资源发布管理”，配置属于官方仓库所有者的 GitHub Token 后，即可在 UI 中选择本地壁纸、打包独立 ZIP、上传 GitHub Release 并更新 `manifest.json`。Token 使用 Windows DPAPI 加密且不会暴露给渲染层。详细格式和发布规则见 [壁纸资源托管与下载方案](doc/壁纸资源托管与下载方案.md)。

## 目录结构

```
assets/                 # 内置 / 用户自带的资源（壁纸、图标 …）
  wallpaper/            # 内置壁纸（按文件夹组织，含 FlowWallDeskInfo.json）
doc/                    # 正式项目文档
  小组件/              # 小组件模块通用设计与各组件说明
TempFile/               # 临时资料、草稿、原型和历史参考
  demo/                 # 主界面 UI 设计原型（HTML/CSS/JS）
  文档资料/             # 开发日志、项目状态和草稿文档
resources/build/        # 应用图标、安装包元数据
src/
├── main/               # 主进程
│   ├── index.ts        # 入口：appReady、窗口、托盘、IPC 注册
│   ├── store.ts        # electron-store 持久化封装
│   ├── tray.ts         # 系统托盘
│   ├── windows/        # 三类窗口：主界面 / 逐屏壁纸 / 单组件画布
│   └── ipc/            # 各模块 IPC handlers
├── preload/            # 单文件 role-gated contextBridge：main-ui / wallpaper / canvas
├── renderer/
│   ├── main-ui/        # 主界面（按 TempFile/demo/ 设计原型实现）
│   ├── wallpaper/      # 壁纸窗口渲染（video/image/web）
│   ├── canvas/         # 桌面组件画布（鼠标穿透）
│   ├── widgets/        # 各桌面组件（Clock、Weather、News、DesktopIcons…）
│   └── shared/         # 渲染层共享：样式、工具、UI 组件
└── shared/             # 主/渲染共享：IPC 通道常量、类型
```

## 路径别名

| 别名 | 指向 |
|------|------|
| `@main/*` | `src/main/*` |
| `@preload/*` | `src/preload/*` |
| `@renderer/*` | `src/renderer/*` |
| `@shared/*` | `src/shared/*` |
| `@resources/*` | `resources/*` |

## 架构与维护

详见 [TempFile/文档资料/other/灵月项目开发指南 .md](TempFile/%E6%96%87%E6%A1%A3%E8%B5%84%E6%96%99/other/%E7%81%B5%E6%9C%88%E9%A1%B9%E7%9B%AE%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97%20.md)。
