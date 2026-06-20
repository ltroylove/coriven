import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const CHAT_MODEL_FAST = 'claude-haiku-4-5-20251001' as const
export const CHAT_MODEL_SMART = 'claude-sonnet-4-6' as const
