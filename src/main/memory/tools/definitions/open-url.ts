/**
 * 打开 URL 工具 — 在用户默认浏览器中打开链接
 */
import { tool } from 'ai'
import { z } from 'zod'
import { shell } from 'electron'

export const openUrlTool = tool({
  description:
    '在用户的默认浏览器中打开一个网页链接。当用户要求"打开某个网站"、"帮我查看这个链接"时使用。',
  inputSchema: z.object({
    url: z.string().describe('要打开的 URL 地址，必须以 http:// 或 https:// 开头'),
  }),
  execute: async ({ url }) => {
    // 安全检查：只允许 http/https 协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { ok: false, error: '仅支持 http:// 或 https:// 协议的链接' }
    }

    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (e) {
      return { ok: false, url, error: (e as Error).message }
    }
  },
})
