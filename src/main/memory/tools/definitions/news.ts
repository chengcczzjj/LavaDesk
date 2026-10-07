/**
 * 新闻热搜工具
 * 复用已有的 news-service（codelife.cc + weibo）
 */
import { tool } from 'ai'
import { z } from 'zod'
import { net } from 'electron'

export const newsTool = tool({
  description: '获取国内各平台最新热搜/热门新闻，包括头条、微博、百度、知乎、B站。返回标题、热度和链接。',
  inputSchema: z.object({
    source: z
      .enum(['toutiao', 'weibo', 'baidu', 'zhihu', 'bilibili'])
      .default('toutiao')
      .describe('新闻来源：toutiao(头条) / weibo(微博) / baidu(百度) / zhihu(知乎) / bilibili(B站)'),
    count: z.number().min(1).max(20).default(10).describe('返回条数，1-20'),
  }),
  execute: async ({ source, count }) => {
    try {
      if (source === 'weibo') {
        return await fetchWeibo(count)
      }
      return await fetchCodelife(source, count)
    } catch (e) {
      return { error: `获取${source}热搜失败: ${(e as Error).message}` }
    }
  },
})

async function fetchWeibo(maxItems: number) {
  const res = await net.fetch('https://weibo.com/ajax/side/hotSearch', {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    data?: { realtime?: { word: string; num?: number }[] }
  }
  const list = json.data?.realtime
  if (!Array.isArray(list)) throw new Error('Unexpected response')
  return {
    source: '微博热搜',
    items: list.slice(0, maxItems).map((item, i) => ({
      rank: i + 1,
      title: item.word,
      hot: item.num ?? 0,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word)}`,
    })),
  }
}

async function fetchCodelife(source: string, maxItems: number) {
  const sourceMap: Record<string, string> = {
    toutiao: 'toutiao',
    baidu: 'baidu',
    zhihu: 'zhihu',
    bilibili: 'bilibili',
  }
  const apiSource = sourceMap[source] ?? 'toutiao'
  const res = await net.fetch(`https://api.codelife.cc/api/top/list?lang=cn&id=${apiSource}`, {
    method: 'GET',
    headers: { 'User-Agent': 'LavaDesk/1.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { title: string; hot?: string; url?: string }[] }
  const list = json.data
  if (!Array.isArray(list)) throw new Error('Unexpected response')

  const sourceNames: Record<string, string> = {
    toutiao: '头条热搜',
    baidu: '百度热搜',
    zhihu: '知乎热搜',
    bilibili: 'B站热搜',
  }

  return {
    source: sourceNames[source] ?? source,
    items: list.slice(0, maxItems).map((item, i) => ({
      rank: i + 1,
      title: item.title,
      hot: item.hot ?? '',
      url: item.url ?? '',
    })),
  }
}
