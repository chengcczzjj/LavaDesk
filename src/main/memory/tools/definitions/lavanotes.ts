import { tool } from 'ai'
import { z } from 'zod'
import { openLavaNotes } from '../../../services/lavanotes-service'

/** Sticky notes and to-dos live in the separate LavaNotes app. */
export const openLavaNotesTool = tool({
  description: '打开独立的 LavaNotes 便签软件：new 新建一张便签（可带上要写的文字），show 把已有便签都显示到最前，manager 打开便签管理（待办、周复盘、已撕下）。返回 installed=false 时说明用户还没安装 LavaNotes，请告诉用户并给出 downloadUrl，不要说已经记好。',
  inputSchema: z.object({
    action: z.enum(['new', 'show', 'manager']).describe('new=新建便签；show=显示全部便签；manager=打开便签管理。'),
    text: z.string().max(2000).optional().describe('仅 action=new：便签初始内容，例如用户要记下的事。'),
  }),
  execute: async ({ action, text }) => {
    const result = await openLavaNotes(action === 'show' ? 'open' : action, text)
    if (!result.installed) {
      return {
        ok: false,
        installed: false,
        downloadUrl: result.downloadUrl,
        message: '便签已经独立成 LavaNotes 软件，用户电脑上还没有安装。',
      }
    }
    return { ok: result.opened, installed: true, action }
  },
})
