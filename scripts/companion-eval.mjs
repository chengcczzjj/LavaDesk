#!/usr/bin/env node
/**
 * Companion tool-choice eval against a real model.
 *
 * Loads the production tool schemas and routing prompt (Electron and main-
 * process services are stubbed; no tool is executed), sends each utterance in
 * tests/fixtures/companion-eval.json and checks the first tool the model calls.
 *
 *   EVAL_PROVIDER=openai-compatible|google|deepseek  (default openai-compatible)
 *   EVAL_BASE_URL=https://.../v1   EVAL_API_KEY=...   EVAL_MODEL=...
 *   node --experimental-strip-types scripts/companion-eval.mjs [--dry] [--only c001,c002]
 *
 * Without EVAL_API_KEY (or with --dry) it only verifies that every tool loads
 * and reports the size of what is sent each turn. Not part of `npm test`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTsLoader, projectRoot } from '../tests/helpers/load-ts.mjs'

const { process, console } = globalThis

const args = process.argv.slice(2)
const dry = args.includes('--dry') || !process.env.EVAL_API_KEY
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1]?.split(',')) : null

// Any main-process module a tool file imports becomes an inert stub; shared code and npm packages load for real.
const stubModule = new Proxy(function stub() {}, {
  get: (_target, key) => (key === '__esModule' ? true : key === 'default' ? stubModule : stubModule),
  apply: () => stubModule,
  construct: () => stubModule,
})
const mocks = new Proxy({}, {
  getOwnPropertyDescriptor: (_target, key) => (
    typeof key === 'string' && (key === 'electron' || key.startsWith('../'))
      ? { configurable: true, enumerable: true, writable: false, value: stubModule }
      : undefined
  ),
  get: (_target, key) => (typeof key === 'string' && (key === 'electron' || key.startsWith('../')) ? stubModule : undefined),
})

const load = createTsLoader({ mocks })
const { getToolSet } = load('src/main/memory/tools/registry.ts')
const { decideToolRoute, buildToolRouterPrompt } = load('src/main/memory/tools/toolRouter.ts')
const cases = JSON.parse(readFileSync(resolve(projectRoot, 'tests/fixtures/companion-eval.json'), 'utf8'))
  .filter((item) => !only || only.has(item.id))

const allTools = getToolSet({ threadId: 'eval' })
const baseRoute = decideToolRoute({ text: '' })
const promptChars = buildToolRouterPrompt({ route: baseRoute }).length
console.log(`tools loaded: ${Object.keys(allTools).length}; always-on per turn: ${baseRoute.toolNames.length}; routing prompt: ${promptChars} chars`)

if (dry) {
  console.log(`dry run: ${cases.length} cases validated. Set EVAL_API_KEY / EVAL_BASE_URL / EVAL_MODEL to query a model.`)
  process.exit(0)
}

const { generateText } = await import('ai')
const provider = process.env.EVAL_PROVIDER ?? 'openai-compatible'
const model = provider === 'google'
  ? (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: process.env.EVAL_API_KEY, ...(process.env.EVAL_BASE_URL ? { baseURL: process.env.EVAL_BASE_URL } : {}) })(process.env.EVAL_MODEL)
  : (await import('@ai-sdk/openai')).createOpenAI({ apiKey: process.env.EVAL_API_KEY, baseURL: process.env.EVAL_BASE_URL ?? (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : undefined) }).chat(process.env.EVAL_MODEL)

const persona = '你是灵月，一个桌面 AI 伴侣。回复简短自然。需要真实信息或真实操作时使用工具，不要只口头答应。'
const snapshot = '【当前时间】\n2026/9/26 14:00:00（星期六）\n\n【桌面现状】\n显示器：1 块；壁纸模式：仅主屏\n壁纸：「星空」（视频，音量 30）\n组件（3）：\n- weather-1：天气·右上\n- clock-1：时钟·左上\n- news-1：新闻热搜·右侧\n- 便利贴 1 张：交周报\n桌宠：晴蓝（idle）\n提醒：1 条待触发，最近一条 09-26 15:30「喝水」'

function argMatches(expected, actual) {
  if (!expected) return true
  return Object.entries(expected).every(([key, allowed]) => allowed.includes(actual?.[key]))
}

let toolHits = 0
let argHits = 0
const misses = []
for (const item of cases) {
  const route = decideToolRoute({ text: item.utterance, recentToolNames: item.tool === 'undo_last_action' ? ['add_widget'] : [] })
  // Without execute the model's tool call is returned instead of being run.
  const tools = Object.fromEntries(route.toolNames.map((name) => [
    name,
    Object.fromEntries(Object.entries(allTools[name]).filter(([key]) => key !== 'execute')),
  ]))
  const system = [persona, buildToolRouterPrompt({ route }), snapshot].join('\n\n')
  try {
    const result = await generateText({ model, system, tools, messages: [{ role: 'user', content: item.utterance }], maxOutputTokens: 800 })
    const call = result.toolCalls?.[0]
    const toolOk = call?.toolName === item.tool
    const argsOk = toolOk && argMatches(item.args, call.input)
    if (toolOk) toolHits += 1
    if (argsOk) argHits += 1
    if (!argsOk) misses.push({ id: item.id, utterance: item.utterance, expected: item.tool, got: call ? `${call.toolName} ${JSON.stringify(call.input)}` : `(no tool) ${result.text.slice(0, 60)}` })
    process.stdout.write(argsOk ? '.' : toolOk ? 'a' : 'x')
  } catch (error) {
    misses.push({ id: item.id, utterance: item.utterance, expected: item.tool, got: `error: ${error.message}` })
    process.stdout.write('E')
  }
}
console.log(`\n\ntool choice: ${toolHits}/${cases.length} (${Math.round(toolHits / cases.length * 100)}%)`)
console.log(`tool + key args: ${argHits}/${cases.length} (${Math.round(argHits / cases.length * 100)}%)`)
for (const miss of misses) console.log(`- ${miss.id} 「${miss.utterance}」 expected ${miss.expected}, got ${miss.got}`)
process.exit(toolHits / cases.length >= 0.9 ? 0 : 1)
