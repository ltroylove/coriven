// @vitest-environment node
/**
 * This is the Sentinel integration-contract test.
 * It exists to prevent the failure mode where the Sentinel writes a package
 * that the chat engine never reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/lib/memory/context-loader', () => ({
  loadMemoryContext: vi.fn(),
}))

vi.mock('@/lib/memory/sentinel', () => ({
  runSentinel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/chat/tools/registry', () => ({
  TOOL_REGISTRY: [],
  ALL_TOOL_NAMES: [],
  getEnabledTools: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/chat/tools/handlers', () => ({
  executeToolHandler: vi.fn(),
}))

vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { stream: vi.fn() } },
  CHAT_MODEL_SMART: 'claude-sonnet-4-6',
  EXTRACTION_MODEL: 'claude-haiku-4-5-20251001',
}))

const UPSTASH_MARKER = 'SENTINEL_MARKER_ENTITY_UNIQUE_STRING'
const SUPABASE_MARKER = 'SUPABASE_FALLBACK_MARKER_UNIQUE_STRING'

/**
 * Build a table-aware Supabase service-client mock.
 * The `conversations` table gets upsert + update(.eq(.is())) support
 * (needed by saveMessage after Task 9.1.2.2.1); all other tables fall back
 * to the generic chain used by the sentinel tests.
 */
function makeEngineServiceClientMock() {
  const conversationsMock = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }
  const genericTableMock = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    single: vi.fn().mockResolvedValue({ data: null }),
    limit: vi.fn().mockResolvedValue({ data: [] }),
  }
  return {
    from: vi.fn((table: string) => {
      if (table === 'conversations') return conversationsMock
      return genericTableMock
    }),
    rpc: vi.fn().mockResolvedValue({ data: [] }),
  }
}

describe('Sentinel Integration Contract', () => {
  beforeEach(() => vi.resetModules())

  it('chat engine reads Sentinel package before generating (Upstash hit)', async () => {
    let capturedSystem = ''

    const { loadMemoryContext } = await import('@/lib/memory/context-loader')
    vi.mocked(loadMemoryContext).mockResolvedValue({
      entityProfiles: [{ id: 'e1', name: UPSTASH_MARKER, type: 'person', aliases: [], mention_count: 0, recency_weight: 1, last_mentioned: null, description: null, user_id: 'u1', created_at: '', updated_at: '' }],
      memories: [],
      summaries: [],
      userContext: null,
      source: 'upstash',
    })

    const { anthropic } = await import('@/lib/anthropic')
    const mockStream = {
      on: vi.fn().mockReturnThis(),
      done: vi.fn().mockResolvedValue(undefined),
      finalMessage: vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' }),
      [Symbol.asyncIterator]: async function* () { yield { type: 'message_stop' } },
    }
    vi.mocked(anthropic.messages.stream).mockImplementation(((params: { system?: string }) => {
      capturedSystem = params.system ?? ''
      return mockStream as never
    }) as never)

    // Mock Supabase for message persistence (conversations + generic tables)
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeEngineServiceClientMock() as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    const events: unknown[] = []
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-1',
      clientMessages: [{ id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'Hello Coriven' }], created_at: new Date().toISOString() }],
      send: (event) => { events.push(event) },
    })

    expect(capturedSystem).toContain(UPSTASH_MARKER)
  })

  it('chat engine uses Supabase package when Upstash misses', async () => {
    let capturedSystem = ''

    const { loadMemoryContext } = await import('@/lib/memory/context-loader')
    vi.mocked(loadMemoryContext).mockResolvedValue({
      entityProfiles: [{ id: 'e2', name: SUPABASE_MARKER, type: 'person', aliases: [], mention_count: 0, recency_weight: 1, last_mentioned: null, description: null, user_id: 'u1', created_at: '', updated_at: '' }],
      memories: [],
      summaries: [],
      userContext: null,
      source: 'supabase',
    })

    const { anthropic } = await import('@/lib/anthropic')
    const mockStream = {
      on: vi.fn().mockReturnThis(),
      done: vi.fn().mockResolvedValue(undefined),
      finalMessage: vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' }),
      [Symbol.asyncIterator]: async function* () { yield { type: 'message_stop' } },
    }
    vi.mocked(anthropic.messages.stream).mockImplementation(((params: { system?: string }) => {
      capturedSystem = params.system ?? ''
      return mockStream as never
    }) as never)

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeEngineServiceClientMock() as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-1',
      clientMessages: [{ id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'Hello' }], created_at: new Date().toISOString() }],
      send: async () => {},
    })

    expect(capturedSystem).toContain(SUPABASE_MARKER)
  })

  it('chat still works when loadMemoryContext returns empty inline context', async () => {
    const { loadMemoryContext } = await import('@/lib/memory/context-loader')
    vi.mocked(loadMemoryContext).mockResolvedValue({
      entityProfiles: [], memories: [], summaries: [], userContext: null, source: 'inline',
    })

    const { anthropic } = await import('@/lib/anthropic')
    const mockStream = {
      on: vi.fn().mockReturnThis(),
      done: vi.fn().mockResolvedValue(undefined),
      finalMessage: vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' }),
      [Symbol.asyncIterator]: async function* () { yield { type: 'message_stop' } },
    }
    vi.mocked(anthropic.messages.stream).mockReturnValue(mockStream as never)

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeEngineServiceClientMock() as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await expect(
      runChatEngine({
        userId: 'user-1',
        conversationId: 'conv-1',
        clientMessages: [{ id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'Hi' }], created_at: new Date().toISOString() }],
        send: async () => {},
      })
    ).resolves.toBeUndefined()
  })
})
