import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, generateText, stepCountIs } from 'ai'
import { streamDeepSeekToolChat, type DeepSeekToolChatResult } from './deepseekToolChat'
import type { FinishReason, ModelMessage, ToolSet } from 'ai'
import type { ModelCapabilities, ModelProfile } from './config'
import {
  DEEPSEEK_CONTEXT_TOKENS,
  DEEPSEEK_MAX_OUTPUT_TOKENS,
  isDeepSeekV4Model,
  normalizeDeepSeekBaseURL,
} from '@shared/model-defaults'

function getOpenAICompatibleBaseURL(profile: ModelProfile): string {
  const baseURL = profile.baseURL?.trim()
  if (profile.provider === 'deepseek') return normalizeDeepSeekBaseURL(baseURL)
  return baseURL
}

function validateProfileApiKey(profile: ModelProfile): string | null {
  const apiKey = profile.apiKey.trim()
  if (!apiKey) return '请填写 API Key'
  return null
}

export interface ResolvedModelCapabilities {
  toolCalling: boolean
  reasoning: boolean
  vision: boolean
  maxContextTokens: number
  maxOutputTokens: number
}

export function getModelCapabilities(profile: Pick<ModelProfile, 'provider' | 'model' | 'capabilities'>): ResolvedModelCapabilities {
  const configured: ModelCapabilities = profile.capabilities ?? {}
  const deepSeekV4 = profile.provider === 'deepseek' && isDeepSeekV4Model(profile.model)
  const reasoningModel = deepSeekV4 || /(^|[-_.])(reasoner|reasoning|r1|o1|o3|o4)([-_.]|$)/i.test(profile.model)
  return {
    toolCalling: configured.toolCalling !== 'disabled',
    reasoning: configured.reasoning ?? reasoningModel,
    vision: configured.vision ?? (profile.provider === 'deepseek' ? false : detectVisionModel(profile.provider, profile.model)),
    maxContextTokens: Math.max(
      4_096,
      configured.maxContextTokens
        ?? (profile.provider === 'google' || deepSeekV4 ? DEEPSEEK_CONTEXT_TOKENS : 64_000),
    ),
    maxOutputTokens: Math.max(
      256,
      configured.maxOutputTokens ?? (deepSeekV4 ? DEEPSEEK_MAX_OUTPUT_TOKENS : 16_384),
    ),
  }
}

/** Model families that accept images through the chat API; unknown names default to text-only. */
export function detectVisionModel(provider: string, model: string): boolean {
  if (provider === 'google') return !/embedding|aqa|tts/i.test(model)
  return /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o|\bo[34](-mini)?\b|claude|gemini|vision|[-_.]vl\b|[-_.]vl[-_.]|qwen.*vl|qvq|glm-4v|glm-4\.[15]v|pixtral|llava|grok-(2-)?vision|grok-4|doubao.*(vision|seed-1\.6)|kimi.*(vision|vl)|moonshot.*vision|step-1v|internvl|minicpm-v|yi-vision/i.test(model)
}

export function supportsToolCalling(profile: Pick<ModelProfile, 'provider' | 'model' | 'capabilities'>): boolean {
  return getModelCapabilities(profile).toolCalling
}

export interface StreamChatResult {
  textStream: AsyncIterable<string>
  text: PromiseLike<string>
  finishReason: PromiseLike<FinishReason>
  rawFinishReason: PromiseLike<string | undefined>
}

export function createModel(profile: ModelProfile) {
  const apiKey = profile.apiKey.trim()
  if (profile.provider === 'google') {
    const google = createGoogleGenerativeAI({
      apiKey,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
      headers: profile.headers,
    })
    return google(profile.model)
  }
  // Chat Completions remains supported by DeepSeek V4 and third-party gateways.
  const baseURL = getOpenAICompatibleBaseURL(profile)
  const openai = createOpenAI({
    baseURL,
    apiKey,
    headers: profile.headers,
  })
  return openai.chat(profile.model)
}

/** Tool 调用生命周期回调 */
export interface ToolCallbacks {
  onTextDelta?: (delta: string) => void
  onToolCallStart?: (info: { toolName: string; toolCallId: string; input: unknown }) => void
  onToolCallFinish?: (info: { toolName: string; toolCallId: string; output: unknown; error?: unknown; durationMs: number }) => void
  onStepFinish?: (info: { stepNumber: number; text: string; toolCalls: unknown[]; finishReason: string }) => void
}

/**
 * 流式聊天 — 支持 tool calling 和多步推理
 *
 * 参考: Vercel AI SDK v6 streamText + stopWhen + tool lifecycle callbacks
 * - tools: 传入完整的工具集
 * - maxSteps: 最大步数（每次 tool call + result 算一步）
 * - 支持 onToolCallStart/Finish 回调用于 UI 反馈
 */
export async function streamChat(
  profile: ModelProfile,
  messages: ModelMessage[],
  options?: {
    system?: string
    tools?: ToolSet
    maxSteps?: number
    abortSignal?: AbortSignal
    toolCallbacks?: ToolCallbacks
  }
): Promise<StreamChatResult | DeepSeekToolChatResult> {
  const { system, tools, maxSteps = 8, abortSignal, toolCallbacks } = options ?? {}
  const capabilities = getModelCapabilities(profile)
  const availableTools = capabilities.toolCalling ? tools : undefined

  if (profile.provider === 'deepseek' && availableTools) {
    return streamDeepSeekToolChat({
      profile,
      baseURL: getOpenAICompatibleBaseURL(profile),
      system,
      messages,
      tools: availableTools,
      maxSteps,
      thinkingEnabled: capabilities.reasoning,
      maxOutputTokens: capabilities.maxOutputTokens,
      abortSignal,
      toolCallbacks,
    })
  }

  const model = createModel(profile)

  const result = streamText({
    model,
    system,
    messages,
    temperature: profile.temperature,
    maxOutputTokens: Math.min(profile.maxTokens ?? capabilities.maxOutputTokens, capabilities.maxOutputTokens),
    abortSignal,
    // Tool calling 配置
    ...(availableTools ? { tools: availableTools, stopWhen: stepCountIs(maxSteps) } : {}),
    // 生命周期回调
    ...(toolCallbacks?.onToolCallStart
      ? {
          experimental_onToolCallStart: (event) => {
            toolCallbacks.onToolCallStart!({
              toolName: event.toolCall.toolName,
              toolCallId: event.toolCall.toolCallId,
              input: event.toolCall.input,
            })
          },
        }
      : {}),
    ...(toolCallbacks?.onToolCallFinish
      ? {
          experimental_onToolCallFinish: (event) => {
            toolCallbacks.onToolCallFinish!({
              toolName: event.toolCall.toolName,
              toolCallId: event.toolCall.toolCallId,
              output: event.success ? event.output : undefined,
              error: event.success ? undefined : event.error,
              durationMs: event.durationMs,
            })
          },
        }
      : {}),
    ...(toolCallbacks?.onStepFinish
      ? {
          onStepFinish: ({ stepNumber, text, toolCalls, finishReason }) => {
            toolCallbacks.onStepFinish!({ stepNumber, text, toolCalls, finishReason })
          },
        }
      : {}),
  })

  return result
}

/** 非流式测试连接 */
export async function testConnection(profile: ModelProfile): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKeyError = validateProfileApiKey(profile)
    if (apiKeyError) return { ok: false, error: apiKeyError }

    const model = createModel(profile)
    await generateText({
      model,
      messages: [{ role: 'user', content: 'Hi' }],
      maxOutputTokens: 10,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 列出 profile 对应服务的可用模型列表 */
export async function listModels(profile: ModelProfile): Promise<{ models: string[]; error?: string }> {
  try {
    const apiKeyError = validateProfileApiKey(profile)
    if (apiKeyError) return { models: [], error: apiKeyError }

    if (profile.provider === 'google') {
      const baseURL = profile.baseURL || 'https://generativelanguage.googleapis.com/v1beta'
      const url = `${baseURL}/models?key=${profile.apiKey}`
      const res = await fetch(url)
      if (!res.ok) return { models: [], error: `HTTP ${res.status}` }
      const data = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
      const models = (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace('models/', ''))
        .sort()
      return { models }
    }
    // OpenAI-compatible / DeepSeek
    const baseURL = getOpenAICompatibleBaseURL(profile).replace(/\/$/, '')
    const modelListURLs = profile.provider === 'deepseek'
      ? Array.from(new Set([
          `${baseURL}/models`,
          `${baseURL.replace(/\/v1$/, '')}/v1/models`,
        ]))
      : [`${baseURL}/models`]

    let lastError = ''
    for (const url of modelListURLs) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${profile.apiKey.trim()}`,
          ...profile.headers,
        },
      })
      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        continue
      }
      const data = await res.json() as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id).sort()
      return { models }
    }
    return { models: [], error: lastError || '获取模型列表失败' }
  } catch (e) {
    return { models: [], error: (e as Error).message }
  }
}
