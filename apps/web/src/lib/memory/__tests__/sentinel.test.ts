// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic', () => ({
  anthropic: {
    messages: {
      create: vi.fn(),
    },
  },
  CHAT_MODEL_FAST: 'claude-haiku-4-5-20251001',
  EXTRACTION_MODEL: 'claude-haiku-4-5-20251001',
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/memory/writer', () => ({
  classifyAndWriteMemory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/context', () => ({
  assembleContext: vi.fn().mockResolvedValue({
    entityProfiles: [],
    memories: [],
    summaries: [],
    userContext: null,
  }),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockResolvedValue('OK'),
  })),
}))

describe('extractFromMessage', () => {
  beforeEach(() => vi.resetModules())

  it('returns parsed entities and facts from valid JSON response', async () => {
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: '{"entities":[{"name":"Sarah","type":"person","description":"sister"}],"facts":["User has a sister named Sarah"]}' }],
    } as never)

    const { extractFromMessage } = await import('../sentinel')
    const result = await extractFromMessage('My sister Sarah lives in Denver', 'user')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].name).toBe('Sarah')
    expect(result.facts).toHaveLength(1)
  })

  it('returns empty extraction for malformed JSON', async () => {
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.create).mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    } as never)

    const { extractFromMessage } = await import('../sentinel')
    const result = await extractFromMessage('Some message here', 'user')
    expect(result).toEqual({ entities: [], facts: [] })
  })

  it('returns empty extraction on Haiku API error', async () => {
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.create).mockRejectedValue(new Error('API down'))

    const { extractFromMessage } = await import('../sentinel')
    const result = await extractFromMessage('Some message here', 'user')
    expect(result).toEqual({ entities: [], facts: [] })
  })

  it('skips extraction for short messages', async () => {
    const { extractFromMessage } = await import('../sentinel')
    const result = await extractFromMessage('Hi', 'user')
    expect(result).toEqual({ entities: [], facts: [] })
  })
})

describe('runSentinel', () => {
  beforeEach(() => vi.resetModules())

  it('completes without throwing even on full failure', async () => {
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.create).mockRejectedValue(new Error('catastrophic'))

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockRejectedValue(new Error('db down')),
      }),
    } as never)

    const { runSentinel } = await import('../sentinel')
    await expect(runSentinel('user-1', 'Hello world test message', 'user')).resolves.toBeUndefined()
  })
})
