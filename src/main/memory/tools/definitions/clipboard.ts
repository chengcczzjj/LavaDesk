/**
 * 剪贴板工具 — 读取和写入系统剪贴板
 * 使用 Electron 的 clipboard API
 */
import { tool } from 'ai'
import { z } from 'zod'
import { clipboard } from 'electron'

export const readClipboardTool = tool({
  description:
    '读取系统剪贴板中的文本内容。当用户说"看看我剪贴板里有什么"、"帮我处理剪贴板内容"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const text = clipboard.readText()
    const hasImage = clipboard.readImage()?.isEmpty() === false
    return {
      text: text || '(剪贴板中无文本)',
      hasImage,
      length: text.length,
    }
  },
})

export const writeClipboardTool = tool({
  description:
    '将文本写入系统剪贴板。当用户让你"复制到剪贴板"、"帮我存到剪贴板"时使用。',
  inputSchema: z.object({
    text: z.string().describe('要写入剪贴板的文本内容'),
  }),
  execute: async ({ text }) => {
    clipboard.writeText(text)
    return {
      ok: true,
      length: text.length,
      preview: text.length > 100 ? text.slice(0, 100) + '…' : text,
    }
  },
})
