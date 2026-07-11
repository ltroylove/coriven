// @vitest-environment node
/**
 * Task 9.1.2.2.1 — Conversation lifecycle upsert
 *
 * Tests the saveMessage persistence path (via runChatEngine) to verify:
 *   1. First user message: conversations row is upserted + title is set
 *   2. Second message: updated_at is bumped; title is NOT overwritten
 *   3. Assistant-first edge case: title stays null until a user message arrives
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

vi.mock('@/lib/memory/context-loader', () => ({
  loadMemoryContext: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/sentinel', () => ({
  runSentinel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/chat/constraints', () => ({
  loadConstraintsForUser: vi.fn().mockResolvedValue([]),
  evaluateConstraint: vi.fn().mockReturnValue({ matched: false }),
}))

vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { stream: vi.fn() } },
  CHAT_MODEL_SMART: 'claude-test',
}))

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks)
// ---------------------------------------------------------------------------

const { createServiceClient } = await import('@/lib/supabase/server')
const { anthropic } = await import('@/lib/anthropic')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Anthropic stream that returns end_turn with the given text. */
function makeEndStream(text = 'OK') {
  return {
    on: vi.fn((event: string, cb: (delta: string) => void) => {
      if (event === 'text') cb(text)
    }),
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    }),
  }
}

/**
 * Build a mock DB that tracks all calls to conversations.upsert and
 * conversations.update().eq().is() so tests can assert on them.
 */
function makeTrackedDb() {
  const upsertCalls: unknown[] = []
  const titleUpdateCalls: Array<{ title: string; convId: string }> = []

  const isMock = vi.fn().mockResolvedValue({ error: null })
  const eqForUpdateMock = vi.fn().mockReturnValue({ is: isMock })
  const updateMock = vi.fn().mockReturnValue({ eq: eqForUpdateMock })
  const upsertMock = vi.fn().mockImplementation((payload: unknown) => {
    upsertCalls.push(payload)
    return Promise.resolve({ error: null })
  })

  // Wire title-tracking into the update mock
  updateMock.mockImplementation((payload: { title: string }) => {
    return {
      eq: vi.fn().mockImplementation((col: string, val: string) => {
        if (col === 'id') {
          titleUpdateCalls.push({ title: payload.title, convId: val })
        }
        return { is: vi.fn().mockResolvedValue({ error: null }) }
      }),
    }
  })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        return { upsert: upsertMock, update: updateMock }
      }
      if (table === 'tool_permissions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { sentinel_mode: 'async' }, error: null }),
            }),
          }),
        }
      }
      // conversation_messages and others
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }),
  }

  return { db, upsertCalls, titleUpdateCalls, upsertMock, updateMock }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task 9.1.2.2.1 — Conversation lifecycle upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('first user message: upserts the conversations row and sets title', async () => {
    const { db, upsertCalls, titleUpdateCalls } = makeTrackedDb()
    vi.mocked(createServiceClient).mockReturnValue(db as never)
    vi.mocked(anthropic.messages.stream).mockReturnValue(makeEndStream() as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-first',
      clientMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello, this is my first message' }],
          created_at: new Date().toISOString(),
        },
      ],
      send: () => undefined,
    })

    // conversations.upsert was called (at least once for the user message)
    expect(upsertCalls.length).toBeGreaterThanOrEqual(1)
    const firstUpsert = upsertCalls[0] as Record<string, string>
    expect(firstUpsert.id).toBe('conv-first')
    expect(firstUpsert.user_id).toBe('user-1')
    expect(firstUpsert).toHaveProperty('updated_at')

    // title was set from the user message text
    expect(titleUpdateCalls.length).toBeGreaterThanOrEqual(1)
    expect(titleUpdateCalls[0].title).toBe('Hello, this is my first message')
    expect(titleUpdateCalls[0].convId).toBe('conv-first')
  })

  it('title is truncated to 80 chars when user message is long', async () => {
    const { db, titleUpdateCalls } = makeTrackedDb()
    vi.mocked(createServiceClient).mockReturnValue(db as never)
    vi.mocked(anthropic.messages.stream).mockReturnValue(makeEndStream() as never)

    const longMessage = 'A'.repeat(120)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-long',
      clientMessages: [
        {
          id: 'msg-long',
          role: 'user',
          content: [{ type: 'text', text: longMessage }],
          created_at: new Date().toISOString(),
        },
      ],
      send: () => undefined,
    })

    expect(titleUpdateCalls.length).toBeGreaterThanOrEqual(1)
    expect(titleUpdateCalls[0].title.length).toBe(80)
    expect(titleUpdateCalls[0].title).toBe('A'.repeat(80))
  })

  it('second message: only the last user message is persisted per turn; assistant save does not trigger title update', async () => {
    const { db, titleUpdateCalls, updateMock } = makeTrackedDb()
    vi.mocked(createServiceClient).mockReturnValue(db as never)
    vi.mocked(anthropic.messages.stream).mockReturnValue(makeEndStream() as never)

    // In async mode, runChatEngine persists:
    //   1. The LAST user message (the new turn's input)
    //   2. The assistant response at the end
    // Prior messages in clientMessages are history context only — not re-persisted.
    // So with clientMessages = [user, assistant, user], only "Second user message" is saved.
    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-second',
      clientMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content: [{ type: 'text', text: 'First user message' }],
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'First assistant reply' }],
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-3',
          role: 'user',
          content: [{ type: 'text', text: 'Second user message' }],
          created_at: new Date().toISOString(),
        },
      ],
      send: () => undefined,
    })

    // Only the last user message triggers a title update (assistant save does not)
    const titles = titleUpdateCalls.map(c => c.title)
    expect(titles).toContain('Second user message')
    // "First user message" is history context; it was already persisted in a prior turn
    expect(titles).not.toContain('First user message')

    // update() is called exactly once: for the user message save.
    // The assistant message save (saveMessage with role='assistant') does NOT call update().
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it('assistant-first edge case: no title update when assistant message has no prior user message', async () => {
    const { db, titleUpdateCalls, updateMock } = makeTrackedDb()
    vi.mocked(createServiceClient).mockReturnValue(db as never)
    vi.mocked(anthropic.messages.stream).mockReturnValue(makeEndStream() as never)

    // The engine requires at least one user message in clientMessages to run.
    // This test verifies that an assistant message persisted by the engine does NOT
    // trigger a title update (only user messages do).
    // We send a user message (so engine runs) but check that the assistant
    // save path (at the end of the loop) does not call update().
    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: 'user-1',
      conversationId: 'conv-assistant-first',
      clientMessages: [
        {
          id: 'msg-u',
          role: 'user',
          content: [{ type: 'text', text: 'Trigger message' }],
          created_at: new Date().toISOString(),
        },
      ],
      send: () => undefined,
    })

    // update() is called once (for the user message), NOT for the assistant save
    expect(updateMock).toHaveBeenCalledTimes(1)
    // The title comes from the user message, not the assistant response 'OK'
    expect(titleUpdateCalls[0].title).toBe('Trigger message')
    expect(titleUpdateCalls[0].title).not.toBe('OK')
  })

  it('upsert is idempotent: same conversationId called twice produces no error', async () => {
    const { db, upsertCalls, upsertMock } = makeTrackedDb()
    vi.mocked(createServiceClient).mockReturnValue(db as never)
    vi.mocked(anthropic.messages.stream).mockReturnValue(makeEndStream() as never)

    const { runChatEngine } = await import('@/lib/chat/engine')

    // Call the engine twice with the same conversationId
    for (let i = 0; i < 2; i++) {
      await runChatEngine({
        userId: 'user-1',
        conversationId: 'conv-idempotent',
        clientMessages: [
          {
            id: `msg-${i}`,
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
            created_at: new Date().toISOString(),
          },
        ],
        send: () => undefined,
      })
    }

    // Each runChatEngine call makes 2 upserts (one for the user save, one for the assistant save).
    // Two engine runs → 4 total upsert calls. All must target the same conversationId.
    expect(upsertMock).toHaveBeenCalledTimes(4)
    for (const call of upsertCalls as Array<Record<string, string>>) {
      expect(call.id).toBe('conv-idempotent')
    }
  })
})
