/**
 * 记忆工具 — 允许 AI 主动存取用户相关信息
 *
 * memory_store: AI 主动记住重要信息（用户偏好、事实等）
 * memory_recall: AI 回忆之前存储的信息
 *
 * 当前实现使用 SQLite 的 memories 表（简单 key-value + 全文搜索）
 * 后续 Phase 4-5 将升级为向量检索
 */
import { tool } from 'ai'
import { z } from 'zod'
import { MemoryStore } from '../../../memory/memories/memoryStore'

export const memoryStoreTool = tool({
  description:
    '将重要信息存入长期记忆。当你发现用户透露了偏好、习惯、重要事实（如生日、名字、喜好、工作）时主动使用，下次对话可以回忆起来。',
  inputSchema: z.object({
    key: z.string().trim().min(1).max(80).describe('记忆的简短标签/分类，如 "用户生日"、"喜欢的颜色"、"工作信息"'),
    content: z.string().trim().min(1).max(1000).describe('要记住的具体内容'),
    importance: z.enum(['low', 'medium', 'high']).optional().describe('重要程度'),
    kind: z.enum(['fact', 'preference']).optional().describe('fact 关于用户的事实；preference 用户的偏好（喜欢的桌面风格、配色、摆放、壁纸类型、称呼和说话方式等）。'),
  }),
  execute: async ({ key, content, importance = 'medium', kind = 'fact' }) => {
    try {
      const action = MemoryStore.upsert({
        key,
        content,
        importance,
        scope: kind === 'preference' ? 'preference' : 'user',
        ...(kind === 'preference' ? { memoryType: 'preference' } : {}),
        sensitivity: 'normal',
      })
      return { ok: true, action, key, kind }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const memoryRecallTool = tool({
  description:
    '回忆之前存储的用户信息。当你需要查找用户之前说过的偏好、事实等信息时使用。可以用关键词模糊搜索。如果返回 found=false 或 memories=[]，表示本轮没有相关记忆，不要再次调用本工具，直接基于空结果回复。',
  inputSchema: z.object({
    query: z.string().trim().min(1).max(500).describe('搜索关键词，会在标签和内容中模糊匹配'),
    limit: z.number().int().min(1).max(10).optional().describe('返回结果数量上限，默认 5'),
  }),
  execute: async ({ query, limit = 5 }) => {
    try {
      const merged = MemoryStore.query({
        scopes: ['general', 'user', 'preference', 'companion'],
        queryText: query,
        keywords: [query],
        limit,
      })

      if (merged.length === 0) {
        return { query, found: false, memories: [] }
      }

      return {
        query,
        found: true,
        memories: merged.map((m) => ({
          key: m.key,
          content: m.content,
          importance: m.importance,
          updatedAt: m.updatedAt,
        })),
      }
    } catch (e) {
      return { query, found: false, error: (e as Error).message, memories: [] }
    }
  },
})
