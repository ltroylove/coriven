// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/memory/sentinel', () => ({
  readSentinelPackage: vi.fn(),
  readSentinelPackageFromSupabase: vi.fn(),
}))

vi.mock('@/lib/memory/context', () => ({
  assembleContext: vi.fn(),
}))

const MOCK_PKG = {
  entity_profiles: [{ id: 'e1', name: 'Sarah', type: 'person' }],
  memories: [{ id: 'm1', content: 'likes coffee', similarity: 0.9 }],
  summaries: [],
  user_context: null,
  built_at: new Date().toISOString(),
}

describe('loadMemoryContext', () => {
  beforeEach(() => vi.resetModules())

  it('Tier 1: returns Upstash package when available', async () => {
    const { readSentinelPackage } = await import('@/lib/memory/sentinel')
    vi.mocked(readSentinelPackage).mockResolvedValue(MOCK_PKG as never)

    const { loadMemoryContext } = await import('../context-loader')
    const ctx = await loadMemoryContext('user-1', 'coffee')

    expect(ctx.source).toBe('upstash')
    expect(ctx.entityProfiles).toHaveLength(1)
  })

  it('Tier 2: falls back to Supabase when Upstash returns null', async () => {
    const { readSentinelPackage, readSentinelPackageFromSupabase } = await import('@/lib/memory/sentinel')
    vi.mocked(readSentinelPackage).mockResolvedValue(null)
    vi.mocked(readSentinelPackageFromSupabase).mockResolvedValue(MOCK_PKG as never)

    const { loadMemoryContext } = await import('../context-loader')
    const ctx = await loadMemoryContext('user-1', 'coffee')

    expect(ctx.source).toBe('supabase')
  })

  it('Tier 3: falls back to inline when both return null', async () => {
    const { readSentinelPackage, readSentinelPackageFromSupabase } = await import('@/lib/memory/sentinel')
    vi.mocked(readSentinelPackage).mockResolvedValue(null)
    vi.mocked(readSentinelPackageFromSupabase).mockResolvedValue(null)

    const { assembleContext } = await import('@/lib/memory/context')
    vi.mocked(assembleContext).mockResolvedValue({
      entityProfiles: [], memories: [], summaries: [], userContext: null,
    })

    const { loadMemoryContext } = await import('../context-loader')
    const ctx = await loadMemoryContext('user-1', 'anything')

    expect(ctx.source).toBe('inline')
  })

  it('Tier 3: returns empty context when inline assembly also fails', async () => {
    const { readSentinelPackage, readSentinelPackageFromSupabase } = await import('@/lib/memory/sentinel')
    vi.mocked(readSentinelPackage).mockResolvedValue(null)
    vi.mocked(readSentinelPackageFromSupabase).mockResolvedValue(null)

    const { assembleContext } = await import('@/lib/memory/context')
    vi.mocked(assembleContext).mockRejectedValue(new Error('DB down'))

    const { loadMemoryContext } = await import('../context-loader')
    const ctx = await loadMemoryContext('user-1', 'anything')

    expect(ctx.source).toBe('inline')
    expect(ctx.entityProfiles).toEqual([])
  })
})
