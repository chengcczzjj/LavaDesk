/**
 * Transient commands from the main process to live widgets on the canvas.
 * They drive behaviour (a pet reaction, starting a sound) without writing
 * anything into the stored widget configuration.
 */

/** Pixel pet states the companion may show (see renderer/shared/pixel-pet.ts). */
export const PET_EXPRESSION_STATES = [
  'joy', 'anger', 'sorrow', 'delight', 'surprise',
  'speaking', 'thinking', 'inspiration', 'confused', 'error',
  'idle', 'sit', 'sleepy', 'walk', 'jump',
  'reading', 'music', 'surfing', 'coding', 'searching', 'organizing', 'charging',
] as const

export type PetExpressionState = (typeof PET_EXPRESSION_STATES)[number]

export const WHITE_NOISE_SOUNDS = [
  'rain', 'ocean', 'waterfall', 'forest', 'fire', 'wind', 'coffee', 'street', 'fan', 'white_noise', 'brown_noise',
] as const

export type WhiteNoiseSound = (typeof WHITE_NOISE_SOUNDS)[number]

export const WHITE_NOISE_SOUND_LABELS: Record<WhiteNoiseSound, string> = {
  rain: '雨声',
  ocean: '海浪',
  waterfall: '瀑布',
  forest: '森林鸟鸣',
  fire: '壁炉',
  wind: '风声',
  coffee: '咖啡馆',
  street: '街道',
  fan: '风扇',
  white_noise: '白噪音',
  brown_noise: '棕噪音',
}

export type WidgetCommand =
  | { target: 'pet'; command: 'express'; state?: PetExpressionState; message?: string; durationMs: number }
  /** Follows the chat agent: thinking, searching, organizing... null returns to the configured state. */
  | { target: 'pet'; command: 'phase'; state: PetExpressionState | null }
  /** minutes: stop by itself after this long (fades out); 0 clears an earlier timer. */
  | { target: 'whitenoise'; command: 'play'; sound?: WhiteNoiseSound; volumeLevel?: number; minutes?: number }
  | { target: 'whitenoise'; command: 'pause' }

export type WidgetCommandEnvelope = WidgetCommand & { issuedAt: number }

/** Sleep-timer presets offered in the white-noise menu (minutes). */
export const WHITE_NOISE_TIMER_PRESETS = [15, 30, 60, 90] as const
export const WHITE_NOISE_MAX_TIMER_MINUTES = 240

/** Map a chat tool to the pet state that reads as "working on it". */
export function petStateForTool(toolName: string): PetExpressionState {
  if (/search|news|weather|location/.test(toolName)) return 'surfing'
  if (/widget|scene|desktop_mode|wallpaper|todo/.test(toolName)) return 'organizing'
  if (/memory/.test(toolName)) return 'reading'
  if (/ambient_sound/.test(toolName)) return 'music'
  if (/file|directory|command|document|docx|xlsx|pdf|artifact|attachment/.test(toolName)) return 'coding'
  if (/reminder/.test(toolName)) return 'inspiration'
  return 'thinking'
}
