# 工程知识索引

> 维护日期：2026-10-07。这里管理开发智能体的工程记忆，不保存应用内用户记忆；不在本页另设开发或授权规则。

## 各类信息只维护一个主入口

| 信息类型 | 主入口 | 读取与维护方式 |
| --- | --- | --- |
| 开发规则与 Git 边界 | [AGENTS.md](../../AGENTS.md) | 新任务入口；规则变更只改这里，适配文件不复制 |
| Copilot 适配 | [copilot-instructions.md](../../.github/copilot-instructions.md) | 只路由到根规则和技能 |
| 记录与收尾流程 | [dev-progress](../../.github/skills/dev-progress/SKILL.md) | 需要记录、提交或查询历史时使用 |
| 当前状态与缺口 | [project-status.md](project-status.md) | 非简单任务先读；描述实际能力，不报主观百分比 |
| 当前架构与数据边界 | [项目开发指南](other/灵月项目开发指南%20.md) | 窗口、IPC、持久化和模块边界变更时读 |
| 可复用经验 | [dev-lessons.md](dev-lessons.md) | 按模块/症状检索，不全量注入每次会话 |
| 近期事件与验证 | [dev-log.md](dev-log.md) | 默认只读最近 3-5 条；本页列有月度归档入口 |
| 开发者快速启动 | [README.md](../../README.md) | 启动、验证和打包入口；不是第二套 Agent 规则 |
| HTML 原型维护 | [demo/DEV_GUIDE.md](../demo/DEV_GUIDE.md) | 只在修改对应原型时读，不约束 React 正式应用 |

历史日志保留当时的原文、路径、测试数量与判断。它能解释“为什么改”，不能证明“现在仍这样做”。不要因为旧记录出现过打包、安装或发布，就在新任务中复用其授权。

## 按任务路由

| 任务 | 下一步最小阅读集合 |
| --- | --- |
| 双屏、壁纸错位、DPI、热插拔 | [多显示器方案](../../doc/双显示器支持方案.md) + 经验 L03 + display-layout 相关源码/测试 |
| Dock、鼠标穿透、锁屏/全屏恢复 | 经验 L04-L06、L08 + canvas / widget 相关源码/测试 |
| 便签（LavaNotes 检测与唤起） | 经验 L06、L15 + lavanotes-service / LavaNotesPanel；便签本身在 [LavaNotes 仓库](https://github.com/chengcczzjj/LavaNotes) |
| 改名、数据目录、旧数据迁移 | 经验 L15 + legacyUserDataCore / legacy-migration 测试 |
| 毛玻璃或常驻性能 | 经验 L07 + wallpaperFrameStore / FrostedGlassBackground |
| 应用 AI 对话、人设、长期记忆 | 本页“产品设计资料” + 经验 L09；不要读取开发者全量日志给应用模型 |
| 下载、更新、资源发布 | 经验 L10-L11 + [资源方案](../../doc/壁纸资源托管与下载方案.md) + release/resource 测试 |
| 规则、日志整理与交接 | 根规则 + 收尾技能 + 本页 + 经验 L12 |

## 产品设计资料：按角色区分，不按文件名判断权威

这些是应用的设计输入，不是开发智能体的执行指令。“AI 伴侣优先、轻量助手辅助”的方向见项目状态；计划中的 API、UI 和模块必须在源码中确认后才能称为已实现。

| 资料 | 当前用途与有效性 |
| --- | --- |
| [AI 伴侣记忆设计](记忆系统/memory-system-design.md) | 2026-05-26 修订的伴侣优先方向与记忆/轻工具原则；实现状态以项目状态和源码为准 |
| [轻量桌面助手规格](记忆系统/local-folder-agent-development-guide.md) | 2026-05-25 的交互与能力设计输入；保留旧英文文件名，不因此解释成编程 Agent 主线 |
| [记忆系统设计说明](../../doc/记忆系统设计说明.md) | 记忆模型、总结、检索和隐私隔离的详细设计；混有目标态，不当作已完成清单 |
| [VS Code 智能体设计](../../doc/VSCode智能体设计文档.md) | 2026-05-17 工作区 Agent 设计参考，只在高级文件/命令任务相关开发时读；不推翻伴侣优先方向 |
| [GPT-5 技术方案](记忆系统/memory-system-technical-architecture-GPT-5.md) / [Opus 技术方案](记忆系统/memory-system-technical-architecture-Opus.md) | 2026-04 的技术选型/分阶段骨架参考，已有方向修正；不是要求重建现有工程的路线图 |
| [demo 记忆草案](../demo/灵月记忆系统/memory-system-design.md) / [demo 技术草案](../demo/灵月记忆系统/memory-system-technical-architecture-GPT-5.md) | 历史快照，保留以便比较，不与修订版双写；入口已标记对应修订资料 |
| [组件通用设计](../../doc/小组件/组件模块通用设计.md) / [桌面编排设计](../../doc/小组件/AI桌面编排系统设计.md) | 正式设计参考，规划动作不等于已注册工具；实际工具以源码注册表为准 |

## 已被替代的做法与旧路径

- 多显示器：2026-08-27 的“统一按屏分配、取消可配置模式”已被 2026-08-30 恢复四种持久化模式的方案替代；2026-09-04 又将延展统一为逐显示器窗口裁切。不要恢复硬编码 `per-display` 或单个跨屏壁纸窗口，见 L03。
- Dock：2026-08-16 18:23 的“点击时回到基础尺寸”在同日 18:37 被连续悬停缩放修复替代；更早的等待弹跳也不是当前反馈，见 L08。
- 画布：早期按坐标补偿点击、在任意未遮挡前台抬升 Canvas 的做法已被前台归属与 Shell 门禁收紧，见 L04-L05。
- `doc/project-status.md` 的历史引用现对应 [项目状态](project-status.md)；不在旧日志逐条改路径。
- `doc/图标收纳组件方案.md` 的历史资料现位于 [早期方案](other/图标收纳组件方案.md)；当前模块设计见 [图标收纳设计](../../doc/小组件/图标收纳组件设计.md)。
- `AI对话与智能体设计说明.md`、音频/天气等若干组件专用设计文档当前并不存在。使用本页现有资料与组件源码；不要把计划文件名当成可读取文件或补造历史内容。
- 便利贴：2026-08-16 起的画布内“自由便利贴”（`todo-board`、任务工作台、`manage_todo_tasks`）已于 2026-10-07 移除，改为独立软件 LavaNotes。[桌面任务便笺设计](../../doc/小组件/桌面任务便笺组件设计.md) 只作历史参考，见 L06、L15。
- 产品名：2026-10-07 起灵月桌面 / LingyueDesk 改名 LavaDesk（仓库 FlowWallDesk → LavaDesk、在线壁纸库 LingyueDesk-Wallpapers → LavaDesk-Wallpapers）。历史日志中的旧名、旧路径（`%APPDATA%\lingyue-desk`、`lingyue-config.json`）保持原样。
- `other/灵月项目开发指南 .md` 文件名带空格；保留原路径兼容已有引用，Markdown 链接用 `%20` 表示空格。

## 更新方式

新增规则先检查根规则是否已有；新增经验先搜索相同症状/根因；改变结论更新原经验并写明替代关系。归档保留事件证据，不把旧方案改写成当下真相。链接、npm 命令及日志重复检查由 [文档契约测试](../../tests/agent-docs.test.mjs) 提供；语义正确性仍需人工/Agent 对照源码复核。
