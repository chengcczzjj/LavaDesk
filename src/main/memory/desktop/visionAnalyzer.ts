import { generateText } from 'ai'
import { ModelConfig } from '../models/config'
import { createModel, getModelCapabilities } from '../models/chatModel'

export interface ImageAnalysis {
  ok: boolean
  method: 'vision' | 'ocr'
  text: string
  error?: string
}

/** Whether the active model profile can look at images directly. */
export function activeModelSupportsVision(): boolean {
  const profile = ModelConfig.getActive()
  return Boolean(profile && getModelCapabilities(profile).vision)
}

async function recognizeText(image: Buffer): Promise<string> {
  const tesseract = await import('tesseract.js')
  const result = await tesseract.recognize(image, 'chi_sim+eng')
  return result.data.text.trim()
}

/**
 * Describe an image for the companion. Vision-capable models look at it
 * directly; others fall back to OCR so a screenshot of text is still useful.
 */
export async function analyzeImage(image: Buffer, mediaType: string, question?: string): Promise<ImageAnalysis> {
  const profile = ModelConfig.getActive()
  if (profile && getModelCapabilities(profile).vision) {
    try {
      const result = await generateText({
        model: createModel(profile),
        maxOutputTokens: 900,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: question?.trim()
                ? `请看这张图并回答：${question.trim()}\n只描述图中真实可见的内容，看不清就直说。`
                : '请用中文简要描述这张图里的主要内容；如果有文字，摘出关键文字。只描述真实可见的内容。',
            },
            { type: 'image', image, mediaType },
          ],
        }],
      })
      const text = result.text.trim()
      if (text) return { ok: true, method: 'vision', text }
    } catch (error) {
      // Fall through to OCR: the profile may be mislabelled as vision-capable.
      console.warn('[vision] image analysis failed, trying OCR:', (error as Error).message)
    }
  }
  try {
    const text = await recognizeText(image)
    return text
      ? { ok: true, method: 'ocr', text: text.slice(0, 8000) }
      : { ok: false, method: 'ocr', text: '', error: '当前模型看不了图片，图里也没识别出文字。' }
  } catch (error) {
    return { ok: false, method: 'ocr', text: '', error: `文字识别失败：${(error as Error).message}` }
  }
}
