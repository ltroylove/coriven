// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/memory/writer', () => ({
  classifyAndWriteMemory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/embedding', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

describe('handleSaveMemory', () => {
  it('saves non-empty content and returns confirmation', async () => {
    const { handleSaveMemory } = await import('../tools')
    const result = await handleSaveMemory('user-1', { content: 'I prefer dark roast coffee' })
    expect(result).toContain('Memory saved')
  })

  it('returns early for empty content', async () => {
    const { handleSaveMemory } = await import('../tools')
    const result = await handleSaveMemory('user-1', { content: '   ' })
    expect(result).toContain('empty')
  })
})

describe('handleRecallMemories', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns formatted memories on success', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        { id: 'a', content: 'likes coffee', similarity: 0.95 },
        { id: 'b', content: 'lives in Denver', similarity: 0.88 },
      ],
    })
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({
      rpc: mockRpc,
    } as unknown as ReturnType<typeof createServiceClient>)

    const { handleRecallMemories } = await import('../tools')
    const result = await handleRecallMemories('user-1', { query: 'coffee preference' })
    expect(result).toContain('likes coffee')
  })

  it('returns fallback message when embedding fails', async () => {
    const { generateEmbedding } = await import('@/lib/memory/embedding')
    vi.mocked(generateEmbedding).mockRejectedValue(new Error('down'))

    const { handleRecallMemories } = await import('../tools')
    const result = await handleRecallMemories('user-1', { query: 'anything' })
    expect(result).toContain('temporarily unavailable')
  })
})
