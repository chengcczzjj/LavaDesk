/**
 * 网络搜索工具
 *
 * 推荐生产配置：TAVILY_API_KEY（Agent 友好）、BRAVE_SEARCH_API_KEY（通用 SERP）、EXA_API_KEY（语义/研究型）。
 * 未配置 API Key 时，使用 DuckDuckGo HTML 结果页作为无需 Key 的真实网页搜索兜底。
 */
import { net } from 'electron'
import { tool } from 'ai'
import { z } from 'zod'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source?: string
  publishedDate?: string
}

type SearchTimeRange = 'day' | 'week' | 'month' | 'year'

interface SearchProviderResult {
  provider: string
  providerLabel: string
  abstract: string
  results: SearchResult[]
}

const DEFAULT_MAX_RESULTS = 8
const REQUEST_TIMEOUT_MS = 12_000

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function clampMaxResults(maxResults?: number): number {
  if (!Number.isFinite(maxResults)) return DEFAULT_MAX_RESULTS
  return Math.max(1, Math.min(10, Math.floor(maxResults!)))
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await net.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  let url = decodeHtmlEntities(rawUrl.trim())
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('/')) url = `https://duckduckgo.com${url}`

  try {
    const parsed = new URL(url)
    const redirected = parsed.searchParams.get('uddg')
    if (redirected) return decodeURIComponent(redirected)
  } catch {
    return url
  }

  return url
}

function isUsefulResultUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  if (/duckduckgo\.com\/y\.js/i.test(url)) return false
  return true
}

function dedupeResults(results: SearchResult[], maxResults: number): SearchResult[] {
  const seen = new Set<string>()
  const deduped: SearchResult[] = []

  for (const result of results) {
    const key = result.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase()
    if (!result.title || !isUsefulResultUrl(result.url) || seen.has(key)) continue
    seen.add(key)
    deduped.push(result)
    if (deduped.length >= maxResults) break
  }

  return deduped
}

async function tavilySearch(query: string, maxResults: number, timeRange?: SearchTimeRange): Promise<SearchProviderResult | null> {
  const apiKey = envValue('TAVILY_API_KEY') || envValue('TAVILY_SEARCH_API_KEY')
  if (!apiKey) return null

  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic',
    topic: 'general',
    max_results: maxResults,
    include_answer: 'basic',
    include_raw_content: false,
    include_images: false,
    include_favicon: true,
  }
  if (timeRange) body.time_range = timeRange

  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status}`)

  const data = await res.json() as {
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>
  }

  const results = dedupeResults((data.results ?? []).map((item) => ({
    title: item.title?.trim() ?? '',
    url: item.url?.trim() ?? '',
    snippet: item.content?.trim() ?? '',
    source: 'tavily',
    publishedDate: item.published_date,
  })), maxResults)

  return {
    provider: 'tavily',
    providerLabel: 'Tavily Search',
    abstract: data.answer?.trim() || '以下是搜索到的相关网页结果：',
    results,
  }
}

async function braveSearch(query: string, maxResults: number, timeRange?: SearchTimeRange): Promise<SearchProviderResult | null> {
  const apiKey = envValue('BRAVE_SEARCH_API_KEY') || envValue('BRAVE_API_KEY')
  if (!apiKey) return null

  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    safesearch: 'moderate',
    extra_snippets: 'true',
  })

  const freshnessMap: Record<SearchTimeRange, string> = {
    day: 'pd',
    week: 'pw',
    month: 'pm',
    year: 'py',
  }
  if (timeRange) params.set('freshness', freshnessMap[timeRange])

  const res = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!res.ok) throw new Error(`Brave 搜索失败: HTTP ${res.status}`)

  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[]; age?: string }> }
  }

  const results = dedupeResults((data.web?.results ?? []).map((item) => ({
    title: stripHtml(item.title ?? ''),
    url: item.url?.trim() ?? '',
    snippet: stripHtml([item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(' ')),
    source: 'brave',
    publishedDate: item.age,
  })), maxResults)

  return {
    provider: 'brave',
    providerLabel: 'Brave Search',
    abstract: '以下是搜索到的相关网页结果：',
    results,
  }
}

async function exaSearch(query: string, maxResults: number, timeRange?: SearchTimeRange): Promise<SearchProviderResult | null> {
  const apiKey = envValue('EXA_API_KEY')
  if (!apiKey) return null

  const date = new Date()
  if (timeRange === 'day') date.setDate(date.getDate() - 1)
  if (timeRange === 'week') date.setDate(date.getDate() - 7)
  if (timeRange === 'month') date.setMonth(date.getMonth() - 1)
  if (timeRange === 'year') date.setFullYear(date.getFullYear() - 1)

  const body: Record<string, unknown> = {
    query,
    type: 'auto',
    numResults: maxResults,
    contents: { highlights: true },
  }
  if (timeRange) body.startPublishedDate = date.toISOString()

  const res = await fetchWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Exa 搜索失败: HTTP ${res.status}`)

  const data = await res.json() as {
    results?: Array<{ title?: string; url?: string; text?: string; highlights?: string[]; summary?: string; publishedDate?: string }>
  }

  const results = dedupeResults((data.results ?? []).map((item) => ({
    title: item.title?.trim() ?? '',
    url: item.url?.trim() ?? '',
    snippet: (item.summary || item.highlights?.join(' ') || item.text || '').trim(),
    source: 'exa',
    publishedDate: item.publishedDate,
  })), maxResults)

  return {
    provider: 'exa',
    providerLabel: 'Exa Search',
    abstract: '以下是语义搜索到的相关网页结果：',
    results,
  }
}

async function duckDuckGoInstantAnswer(query: string): Promise<string> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  })

  const res = await fetchWithTimeout(`https://api.duckduckgo.com/?${params.toString()}`, {
    headers: { 'User-Agent': 'LavaDesk/1.0' },
  })
  if (!res.ok) return ''

  const data = await res.json() as { Abstract?: string; Heading?: string }
  return data.Abstract?.trim() || data.Heading?.trim() || ''
}

function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const linkRegex = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null && results.length < maxResults * 2) {
    const [, rawUrl, rawTitle] = match
    const nearby = html.slice(match.index, Math.min(html.length, match.index + 2200))
    const snippetMatch = nearby.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? nearby.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const url = normalizeDuckDuckGoUrl(rawUrl)
    const title = stripHtml(rawTitle)
    const snippet = stripHtml(snippetMatch?.[1] ?? '')

    if (title && url) {
      results.push({ title, url, snippet, source: 'duckduckgo' })
    }
  }

  return dedupeResults(results, maxResults)
}

async function duckDuckGoHtmlSearch(query: string, maxResults: number): Promise<SearchProviderResult> {
  const params = new URLSearchParams({ q: query, kl: 'cn-zh' })
  const [htmlResponse, instantResult] = await Promise.allSettled([
    fetchWithTimeout(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }),
    duckDuckGoInstantAnswer(query),
  ])

  if (htmlResponse.status === 'rejected') throw htmlResponse.reason
  if (!htmlResponse.value.ok) throw new Error(`DuckDuckGo 搜索失败: HTTP ${htmlResponse.value.status}`)

  const html = await htmlResponse.value.text()
  const results = parseDuckDuckGoHtml(html, maxResults)
  const instantAnswer = instantResult.status === 'fulfilled' ? instantResult.value : ''

  return {
    provider: 'duckduckgo',
    providerLabel: 'DuckDuckGo',
    abstract: instantAnswer || '以下是搜索到的相关网页结果：',
    results,
  }
}

function normalizeBingUrl(rawUrl: string): string {
  const url = decodeHtmlEntities(rawUrl.trim())
  try {
    const parsed = new URL(url)
    const encodedTarget = parsed.hostname.endsWith('bing.com') ? parsed.searchParams.get('u') : null
    if (!encodedTarget) return url

    const base64Target = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
    const decodedTarget = Buffer.from(base64Target.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return decodedTarget.startsWith('http') ? decodedTarget : url
  } catch {
    return url
  }
}

function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const blockRegex = /<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults * 2) {
    const block = match[0]
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i)
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    if (!titleMatch) continue

    const url = normalizeBingUrl(titleMatch[1])
    const title = stripHtml(titleMatch[2])
    const snippet = stripHtml(snippetMatch?.[1] ?? '')
    results.push({ title, url, snippet, source: 'bing' })
  }

  return dedupeResults(results, maxResults)
}

async function bingHtmlSearch(query: string, maxResults: number): Promise<SearchProviderResult> {
  const params = new URLSearchParams({ q: query, setlang: 'zh-CN', cc: 'CN' })
  const res = await fetchWithTimeout(`https://www.bing.com/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!res.ok) throw new Error(`Bing 搜索失败: HTTP ${res.status}`)

  const html = await res.text()
  return {
    provider: 'bing',
    providerLabel: 'Bing Search',
    abstract: '以下是搜索到的相关网页结果：',
    results: parseBingHtml(html, maxResults),
  }
}

async function searchWeb(query: string, maxResults: number, timeRange?: SearchTimeRange): Promise<SearchProviderResult & { errors?: string[] }> {
  const errors: string[] = []
  const providers = [tavilySearch, braveSearch, exaSearch]

  for (const provider of providers) {
    try {
      const result = await provider(query, maxResults, timeRange)
      if (!result) continue
      if (result.results.length > 0) return { ...result, errors }
      errors.push(`${result.providerLabel} 没有返回结果`)
    } catch (error) {
      errors.push((error as Error).message)
    }
  }

  try {
    const fallback = await duckDuckGoHtmlSearch(query, maxResults)
    if (fallback.results.length > 0) return { ...fallback, errors }
    errors.push('DuckDuckGo 没有返回结果')
  } catch (error) {
    errors.push((error as Error).message)
  }

  try {
    const fallback = await bingHtmlSearch(query, maxResults)
    return { ...fallback, errors }
  } catch (error) {
    errors.push((error as Error).message)
    return {
      provider: 'none',
      providerLabel: '未完成搜索',
      abstract: '没有搜索到可用结果。',
      results: [],
      errors,
    }
  }
}

export const webSearchTool = tool({
  description:
    '在互联网上搜索真实网页信息。当用户询问不确定事实、最新动态、具体资料或需要网页来源时使用。返回摘要、搜索结果标题、链接和片段。',
  inputSchema: z.object({
    query: z.string().min(1).describe('搜索关键词，尽量简洁明确'),
    maxResults: z.number().min(1).max(10).default(DEFAULT_MAX_RESULTS).describe('返回结果数量，1-10'),
    timeRange: z.enum(['day', 'week', 'month', 'year']).optional().describe('可选时间范围，用于查找近期信息'),
  }),
  execute: async ({ query, maxResults, timeRange }) => {
    const cleanQuery = query.trim()
    if (!cleanQuery) {
      return { ok: false, query, error: '搜索关键词不能为空', results: [] }
    }

    const resultLimit = clampMaxResults(maxResults)
    const searchResult = await searchWeb(cleanQuery, resultLimit, timeRange)
    const ok = searchResult.results.length > 0

    return {
      ok,
      query: cleanQuery,
      abstract: searchResult.abstract,
      results: searchResult.results,
      source: searchResult.provider,
      provider: searchResult.provider,
      providerLabel: searchResult.providerLabel,
      resultCount: searchResult.results.length,
      ...(searchResult.errors?.length ? { warnings: searchResult.errors } : {}),
      ...(!ok ? { error: '没有搜索到可用结果，请换一个关键词或稍后重试。' } : {}),
    }
  },
})