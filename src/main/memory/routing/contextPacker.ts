import type { StoredEvent } from '../events/types'
import type { SceneDecision } from './sceneRouter'
import type { ModelMessage } from 'ai'
import { DEFAULT_CHAT_PERSONA } from '@shared/persona'
import { RetrievalRouter } from './retrievalRouter'

const COMPANION_CORE_PROMPT = `【灵月伴侣对话基调】
你是桌面 AI 伴侣，不是严肃的开发 Agent。你的首要目标是自然、有温度地陪用户说话，并在需要时顺手帮用户完成轻量电脑操作。

说话方式：
- 保持当前人设，不要切换成机械客服、命令行助手或项目经理口吻。
- 回复要像正常对话一样，有简短的承接、判断和收束；不要堆流程说明。
- 请求明确且风险低时，直接采用合理默认值行动，不要为了形式反复确认。
- 只有缺失信息会实质改变结果、范围、保存位置或不可逆操作时，才先问一个简短问题；有帮助时给出 2～3 个具体选项。
- 不要重复询问用户已经回答、能从上下文判断或能通过工具安全查明的信息。
- 如果需要使用工具，先用一句自然短句告诉用户你要做什么。不要暴露内部工具名。
- 多步操作之间可以补一句过渡，但不要把每个技术细节都讲给用户。
- 工具结果回来后，用人设语气整理成用户能直接理解的结果。
- 如果工具失败，直接承认“这次没做成/没查到”，可以带一点当前人设的撒娇、吐槽或小情绪，但不要编造成功结果，也不要把技术错误堆给用户。
- 用户要求“看看为什么失败/帮我修一下”时，再进入检查问题、定位原因、尝试修复的流程；不要在普通失败回复里自动展开长篇排查。

能力边界：
- 默认优先处理陪聊、实时信息、搜索、剪贴板、打开网页、记忆、桌面组件等轻量能力。
- 只有用户明确要求查看、生成、修改或运行本地文件/命令时，才进入本地文件操作语境。
- 不要把桌面组件操作说成项目任务、工作区任务、checkpoint 或 artifact。`

function buildSystemPersona(persona?: string): string {
  const rawPersona = persona?.trim() || DEFAULT_CHAT_PERSONA.prompt
  const personaPrompt = rawPersona.length > 12_000
    ? `${rawPersona.slice(0, 12_000)}\n[人设内容已按上下文预算截断]`
    : rawPersona
  // The time used to live here; it now goes into the dynamic tail so this
  // persona prefix stays byte-identical between turns (provider prompt caching).
  return personaPrompt.includes('【灵月伴侣对话基调】')
    ? personaPrompt.replace(/\n*当前时间：\{time\}\s*$/, '')
    : `${personaPrompt}\n\n${COMPANION_CORE_PROMPT}`
}

function formatNow(now = new Date()): string {
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  return `${now.toLocaleString('zh-CN', { hour12: false })}（星期${weekday}）`
}

function describeAttachments(content: Record<string, unknown>): string {
  const attachments = Array.isArray(content.attachments) ? content.attachments : []
  const lines = attachments
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.id === 'string'))
    .map((item) => `- ${String(item.name ?? '附件')}（${String(item.kind ?? 'file')}，id: ${String(item.id)}）`)
  return lines.length > 0 ? `\n\n【附件】\n${lines.join('\n')}` : ''
}

export interface ContextResult {
  /** Persona and companion rules: identical across turns. */
  system: string
  /** Time, recalled memories and state: changes every turn, goes last. */
  dynamicSystem: string
  messages: ModelMessage[]
}

export function buildInitialContext(params: {
  scene: SceneDecision
  recentEvents: StoredEvent[]
  persona?: string
  projectId?: string | null
  maxContextTokens?: number
}): ContextResult {
  const { scene, recentEvents, persona, projectId } = params
  const maxContextTokens = Math.max(4096, params.maxContextTokens ?? 64_000)
  const totalCharBudget = Math.min(120_000, Math.max(12_000, Math.floor(maxContextTokens * 1.8)))
  const recentCharBudget = Math.floor(totalCharBudget * 0.58)
  const memoryCharBudget = Math.min(8000, Math.floor(totalCharBudget * 0.1))
  let fullSystemPrompt = buildSystemPersona(persona)
  const dynamicBlocks: string[] = [`【当前时间】\n${formatNow()}`]

  try {
    const lastUserMsg = [...recentEvents]
      .reverse()
      .find((event) => event.eventType === 'user_message')
    const userText = lastUserMsg
      ? (lastUserMsg.content as { text: string }).text
      : ''

    if (userText) {
      const retrieval = RetrievalRouter.retrieve(scene, userText, { projectId, maxContextChars: memoryCharBudget })

      if (retrieval.memories.length > 0) {
        const memoryText = retrieval.memories
          .map((memory) => `- [${memory.key}] ${memory.content}`)
          .join('\n')
        dynamicBlocks.push(`【关于用户的已知记忆】\n${memoryText}`)
      }

      if (retrieval.stateText) {
        dynamicBlocks.push(`【当前状态信息】\n${retrieval.stateText}`)
      }
    }
  } catch {
    // Retrieval is helpful context, not a hard dependency for conversation.
  }

  const messages: ModelMessage[] = []
  let usedRecentChars = 0

  // Newest messages win. This prevents a long conversation from crowding out the current request.
  for (const event of [...recentEvents].reverse()) {
    let role: 'user' | 'assistant' | null = null
    if (event.eventType === 'user_message') role = 'user'
    if (event.eventType === 'assistant_message') role = 'assistant'
    if (!role) continue
    const text = (event.content as { text?: string }).text
    const raw = role === 'user' && typeof text === 'string' ? `${text}${describeAttachments(event.content)}` : text
    if (typeof raw !== 'string' || !raw.trim()) continue
    const remaining = recentCharBudget - usedRecentChars
    if (remaining <= 0) break
    const content = raw.length > remaining
      ? `${raw.slice(0, Math.max(0, remaining - 28))}\n[消息已按上下文预算截断]`
      : raw
    messages.unshift({ role, content })
    usedRecentChars += content.length
  }

  if (fullSystemPrompt.length > totalCharBudget - recentCharBudget) {
    fullSystemPrompt = `${fullSystemPrompt.slice(0, totalCharBudget - recentCharBudget - 24)}\n[系统上下文已截断]`
  }

  // Tool calls/results are not replayed as plain messages because that loses provider pairing;
  // the chat service adds a digest of recent desktop actions to the dynamic tail instead.
  return { system: fullSystemPrompt, dynamicSystem: dynamicBlocks.join('\n\n'), messages }
}
