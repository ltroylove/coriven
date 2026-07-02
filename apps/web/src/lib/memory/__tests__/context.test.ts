// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/memory/embedding', () => ({
  generateEmbedding: vi.fn(),
}))

describe('assembleContext', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns structured context with all three layers', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: [{ id: 'mem1', content: 'likes coffee', similarity: 0.9 }] })
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
    })
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom, rpc: mockRpc } as unknown as ReturnType<typeof createServiceClient>)
    const { generateEmbedding } = await import('@/lib/memory/embedding')
    vi.mocked(generateEmbedding).mockResolvedValue(new Array(1536).fill(0.1))

    const { assembleContext } = await import('../context')
    const ctx = await assembleContext('user-123', 'I want coffee')

    expect(ctx).toHaveProperty('entityProfiles')
    expect(ctx).toHaveProperty('memories')
    expect(ctx).toHaveProperty('summaries')
    expect(ctx).toHaveProperty('userContext')
  })

  it('degrades gracefully when embedding fails', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
    })
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom, rpc: vi.fn() } as unknown as ReturnType<typeof createServiceClient>)
    const { generateEmbedding } = await import('@/lib/memory/embedding')
    vi.mocked(generateEmbedding).mockRejectedValue(new Error('OpenAI down'))

    const { assembleContext } = await import('../context')
    const ctx = await assembleContext('user-123', 'test message')

    expect(ctx.memories).toEqual([])
  })
})
