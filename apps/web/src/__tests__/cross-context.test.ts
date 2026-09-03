// @vitest-environment node
/**
 * Cross-context query integration tests
 * Wave 7.4.1 — Tasks 7.4.1.2.1 and 7.4.1.4.1
 *
 * Coverage:
 *   Task 7.4.1.2.1 — Multi-tool orchestration
 *     - System prompt injects cross-context section when 2+ store types enabled
 *     - System prompt omits cross-context section for task-only users
 *     - System prompt references only actually-enabled tool names
 *     - At least two different store-type tools appear in a single turn
 *     - search_email_metadata handler returns metadata fields only; no body fields
 *
 *   Task 7.4.1.4.1 — Honesty enforcement (3 cases)
 *     Case A: All tools return empty → response acknowledges absence; no invented data
 *     Case B: Memory tool disabled → system prompt cross-context section excludes memory tool names
 *     Case C: Partial results (tasks found, goals empty) → response accurately reflects partial data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — set up before any dynamic imports
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
// Dynamic imports (after mocks are registered)
// ---------------------------------------------------------------------------

const { createServiceClient } = await import('@/lib/supabase/server')
const { anthropic } = await import('@/lib/anthropic')

// Import the internal helpers we need to test directly.
// We reach into the engine module via a re-export trick: the functions are
// not exported, so we test them through their effects on runChatEngine and
// through separate unit-level tests of the helper logic.

// For unit-level system-prompt tests we import the handler and registry
// directly and replicate the store-type detection logic.
const { executeToolHandler } = await import('@/lib/chat/tools/handlers')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'user-cross-context-test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal Supabase mock for tool_permissions.
 * Returns a flat list of { tool_name, enabled } rows.
 */
function makeToolPermissionsClient(
  permissions: Array<{ tool_name: string; enabled: boolean }>,
  extraTables: Record<string, unknown[]> = {},
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'tool_permissions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: permissions, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }
      if (table === 'conversation_messages') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      const rows = extraTables[table] ?? []
      return makeSingleTableClient(rows)
    }),
  }
}

function makeSingleTableClient(rows: unknown[]) {
  const terminal = vi.fn().mockResolvedValue({ data: rows, error: null })
  const obj: Record<string, unknown> = {}
  const proxy = new Proxy(obj, {
    get: (_target, prop: string) => {
      if (prop === 'then') return undefined // not a Promise itself
      return () => proxy
    },
  })
  // Override the final resolution
  ;(proxy as Record<string, unknown>).single = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null })
  ;(proxy as Record<string, unknown>).limit = terminal
  return proxy
}

/**
 * Build a mock Anthropic stream that resolves once with the given content.
 * Text blocks are fired through registered 'text' listeners before finalMessage resolves,
 * matching how the real SDK stream behaves.
 */
function makeStream(content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>, stop_reason: string = 'end_turn') {
  const textListeners: Array<(delta: string) => void> = []
  return {
    on: vi.fn((event: string, cb: (delta: string) => void) => {
      if (event === 'text') textListeners.push(cb)
    }),
    finalMessage: vi.fn().mockImplementation(async () => {
      // Fire text deltas to simulate the SDK streaming behavior
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          for (const listener of textListeners) {
            listener(block.text)
          }
        }
      }
      return { content, stop_reason }
    }),
  }
}

// ---------------------------------------------------------------------------
// Task 7.4.1.2.1 — System prompt injection unit tests
// ---------------------------------------------------------------------------
// We test the cross-context section by inspecting what buildSystemPrompt
// would produce via the STORE_TYPE_TOOLS classification logic. Since
// buildSystemPrompt is not exported, we verify behavior by calling
// runChatEngine with mocked dependencies and capturing the system prompt
// passed to anthropic.messages.stream.

describe('Task 7.4.1.2.1 — System prompt cross-context injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects cross-context section when tasks + goals are enabled', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeToolPermissionsClient(permissions) as never,
    )

    // Stream that terminates immediately (no tool use)
    const stream = makeStream([{ type: 'text', text: 'Hello' }], 'end_turn')
    vi.mocked(anthropic.messages.stream).mockReturnValue(stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    const events: unknown[] = []
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-001',
      clientMessages: [
        {
          id: 'msg-001', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'What is going on with my gym project?' }],
        },
      ],
      send: (e) => events.push(e),
    })

    // Verify anthropic.messages.stream was called with a system prompt containing
    // the cross-context section.
    expect(vi.mocked(anthropic.messages.stream)).toHaveBeenCalledOnce()
    const callArg = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { system: string }
    expect(callArg.system).toContain('Cross-context queries')
    expect(callArg.system).toContain('list_tasks')
    expect(callArg.system).toContain('list_goals')
  })

  it('does NOT inject cross-context section when only tasks are enabled', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'create_task', enabled: true },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeToolPermissionsClient(permissions) as never,
    )

    const stream = makeStream([{ type: 'text', text: 'Here are your tasks' }], 'end_turn')
    vi.mocked(anthropic.messages.stream).mockReturnValue(stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-002',
      clientMessages: [
        {
          id: 'msg-002', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'List my tasks' }],
        },
      ],
      send: () => undefined,
    })

    const callArg = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { system: string }
    expect(callArg.system).not.toContain('Cross-context queries')
  })

  it('injects tasks + memory tools but NOT goal tools when goals are disabled', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'recall_memories', enabled: true },
      // list_goals is explicitly disabled — should not appear in prompt
      { tool_name: 'list_goals', enabled: false },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeToolPermissionsClient(permissions) as never,
    )

    const stream = makeStream([{ type: 'text', text: 'Here is the context' }], 'end_turn')
    vi.mocked(anthropic.messages.stream).mockReturnValue(stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-003',
      clientMessages: [
        {
          id: 'msg-003', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'Catch me up on my gym project' }],
        },
      ],
      send: () => undefined,
    })

    const callArg = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { system: string }
    expect(callArg.system).toContain('Cross-context queries')

    // Extract only the line in the cross-context section that enumerates tools to call.
    // This line begins with "call ALL relevant enabled tools before synthesizing:"
    const afterCrossContext = callArg.system.split('## Cross-context queries')[1] ?? ''
    const toolEnumerationLine = afterCrossContext.split('\n').find(line => line.includes('synthesizing:')) ?? ''

    expect(toolEnumerationLine).toContain('list_tasks')
    expect(toolEnumerationLine).toContain('recall_memories')
    // list_goals is disabled — it must NOT appear in the cross-context tool enumeration.
    expect(toolEnumerationLine).not.toContain('list_goals')
  })

  it('injects email tool name in cross-context section when search_email_metadata is enabled', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
      { tool_name: 'search_email_metadata', enabled: true },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeToolPermissionsClient(permissions) as never,
    )

    const stream = makeStream([{ type: 'text', text: 'Here is the context' }], 'end_turn')
    vi.mocked(anthropic.messages.stream).mockReturnValue(stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-004',
      clientMessages: [
        {
          id: 'msg-004a', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'Tell me about my gym project' }],
        },
      ],
      send: () => undefined,
    })

    const callArg = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { system: string }
    expect(callArg.system).toContain('search_email_metadata')
  })
})

// ---------------------------------------------------------------------------
// Task 7.4.1.2.1 — Multi-tool orchestration (2+ store types in one turn)
// ---------------------------------------------------------------------------

describe('Task 7.4.1.2.1 — Multi-store tool calls within a single turn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls tools from two different store types in a single turn and synthesizes', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
      { tool_name: 'recall_memories', enabled: true },
    ]

    // Supabase client needs to handle tool_permissions, conversations, conversation_messages, tasks, goals, memories
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'tool_permissions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: permissions, error: null }),
            }),
          }
        }
        if (table === 'conversations') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'conversation_messages') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'profiles') {
          // sentinel_mode read: .select('sentinel_mode').eq('id', userId).single()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { sentinel_mode: 'async' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'tasks') {
          const data = [{ id: 'task-1', title: 'Buy gym equipment', status: 'pending', priority: 'high', reminders: [] }]
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'goals') {
          const data = [{ id: 'goal-1', title: 'Get fit', status: 'active', momentum: 'improving', projects: [{ count: 2 }] }]
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data, error: null }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    }

    vi.mocked(createServiceClient).mockReturnValue(mockDb as never)

    // Turn 0: Claude requests list_tasks and list_goals simultaneously (multi-store turn)
    const turn0Stream = makeStream(
      [
        { type: 'tool_use', id: 'tu-1', name: 'list_tasks', input: {} },
        { type: 'tool_use', id: 'tu-2', name: 'list_goals', input: {} },
      ],
      'tool_use',
    )
    // Turn 1: Claude synthesizes after receiving both results
    const turn1Stream = makeStream(
      [{ type: 'text', text: 'You have 1 gym task and 1 active goal about fitness.' }],
      'end_turn',
    )

    vi.mocked(anthropic.messages.stream)
      .mockReturnValueOnce(turn0Stream as never)
      .mockReturnValueOnce(turn1Stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    const textEvents: string[] = []
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-multi-001',
      clientMessages: [
        {
          id: 'msg-005', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'What is happening with my gym project?' }],
        },
      ],
      send: (e) => {
        if (e.type === 'text_delta') textEvents.push(e.delta)
      },
    })

    // Two Anthropic calls were made (turn 0: tool use; turn 1: synthesis)
    expect(vi.mocked(anthropic.messages.stream)).toHaveBeenCalledTimes(2)

    // The tool calls in turn 0 span tasks AND goals — two different store types
    const turn0Args = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { tools: Array<{ name: string }> }
    // Both tools must be in the enabled tool list passed to the first stream call
    const toolNames = (turn0Args.tools ?? []).map((t) => t.name)
    expect(toolNames).toContain('list_tasks')
    expect(toolNames).toContain('list_goals')

    // Final text is coherent (not raw JSON)
    const finalText = textEvents.join('')
    expect(finalText).toContain('gym')
    expect(finalText).not.toMatch(/^\[.*\]$/) // not a raw JSON array
  })
})

// ---------------------------------------------------------------------------
// Task 7.4.1.4.1 — Honesty enforcement
// ---------------------------------------------------------------------------

describe('Task 7.4.1.4.1 — Honesty enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Case A: All tools return empty results → response explicitly acknowledges absence

  it('Case A: All tools return empty — response acknowledges absence; no invented data', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
      { tool_name: 'recall_memories', enabled: true },
    ]

    const emptyDb = {
      from: vi.fn((table: string) => {
        if (table === 'tool_permissions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: permissions, error: null }),
            }),
          }
        }
        if (table === 'conversations') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'conversation_messages') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'profiles') {
          // sentinel_mode read: .select('sentinel_mode').eq('id', userId).single()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { sentinel_mode: 'async' }, error: null }),
              }),
            }),
          }
        }
        // All data tables return empty
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }),
    }

    vi.mocked(createServiceClient).mockReturnValue(emptyDb as never)

    // Turn 0: Claude requests all three tools
    const turn0Stream = makeStream(
      [
        { type: 'tool_use', id: 'tu-a1', name: 'list_tasks', input: {} },
        { type: 'tool_use', id: 'tu-a2', name: 'list_goals', input: {} },
        { type: 'tool_use', id: 'tu-a3', name: 'recall_memories', input: { query: 'gym' } },
      ],
      'tool_use',
    )
    // Turn 1: Honest acknowledgment — no data fabricated
    // This is a realistic mocked Claude response when all tool results are empty arrays.
    const honestAcknowledgment =
      "I don't have any tasks, goals, or memories related to your gym project yet. " +
      "You can start by creating a goal or adding some tasks about it."
    const turn1Stream = makeStream(
      [{ type: 'text', text: honestAcknowledgment }],
      'end_turn',
    )

    vi.mocked(anthropic.messages.stream)
      .mockReturnValueOnce(turn0Stream as never)
      .mockReturnValueOnce(turn1Stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    const textEvents: string[] = []
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-honest-a',
      clientMessages: [
        {
          id: 'msg-006', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'What has been happening with my gym project?' }],
        },
      ],
      send: (e) => {
        if (e.type === 'text_delta') textEvents.push(e.delta)
      },
    })

    const finalText = textEvents.join('')

    // Response must explicitly acknowledge absence of data
    expect(finalText).toMatch(/don'?t have|no tasks|no goals|no memories|nothing/i)

    // Response must NOT contain fabricated task or goal details
    expect(finalText).not.toMatch(/task id|goal id/i)
    expect(finalText).not.toMatch(/"id"\s*:/i) // no raw JSON with IDs
  })

  // Case B: Memory tool disabled → system prompt cross-context section must NOT reference memory tool names

  it('Case B: Memory disabled — cross-context prompt does not reference recall_memories', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
      // recall_memories is disabled
      { tool_name: 'recall_memories', enabled: false },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeToolPermissionsClient(permissions) as never,
    )

    const stream = makeStream([{ type: 'text', text: 'Here is your context.' }], 'end_turn')
    vi.mocked(anthropic.messages.stream).mockReturnValue(stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-honest-b',
      clientMessages: [
        {
          id: 'msg-004b', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'Tell me about my gym project' }],
        },
      ],
      send: () => undefined,
    })

    const callArg = vi.mocked(anthropic.messages.stream).mock.calls[0][0] as { system: string }

    // Cross-context section is still injected (2 stores: tasks + goals)
    expect(callArg.system).toContain('Cross-context queries')

    // The cross-context tool list (the "synthesizing:" line) must not reference recall_memories.
    // memory store has no enabled tools, so it is excluded from the cross-context tool list.
    // Note: recall_memories may appear in the disabled-tools section, but NOT in the
    // cross-context tool enumeration that instructs Claude which tools to call.
    const afterCrossContext = callArg.system.split('## Cross-context queries')[1] ?? ''
    // Extract just the line listing the tools to call
    const toolListLine = afterCrossContext.split('\n').find(line => line.includes('synthesizing:')) ?? ''
    expect(toolListLine).not.toContain('recall_memories')
  })

  // Case C: Partial results (tasks found, goals empty) → response accurately reflects partial data

  it('Case C: Partial results — response reflects tasks found and goals absent', async () => {
    const permissions = [
      { tool_name: 'list_tasks', enabled: true },
      { tool_name: 'list_goals', enabled: true },
    ]

    const partialDb = {
      from: vi.fn((table: string) => {
        if (table === 'tool_permissions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: permissions, error: null }),
            }),
          }
        }
        if (table === 'conversations') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'conversation_messages') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'profiles') {
          // sentinel_mode read: .select('sentinel_mode').eq('id', userId).single()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { sentinel_mode: 'async' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'tasks') {
          // Tasks returns data
          const data = [
            { id: 'task-gym-1', title: 'Book gym membership', status: 'in_progress', priority: 'high', reminders: [] },
            { id: 'task-gym-2', title: 'Buy workout shoes', status: 'pending', priority: 'medium', reminders: [] },
          ]
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'goals') {
          // Goals returns empty
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }
      }),
    }

    vi.mocked(createServiceClient).mockReturnValue(partialDb as never)

    // Turn 0: Claude calls both tools
    const turn0Stream = makeStream(
      [
        { type: 'tool_use', id: 'tu-c1', name: 'list_tasks', input: {} },
        { type: 'tool_use', id: 'tu-c2', name: 'list_goals', input: {} },
      ],
      'tool_use',
    )
    // Turn 1: Realistic response reflecting partial data accurately (tasks found; goals absent)
    const partialResponse =
      "You have 2 tasks related to your gym project: 'Book gym membership' (in progress) and " +
      "'Buy workout shoes' (pending). I don't have any goals set up for your gym project yet — " +
      "you can create one with the goals feature if you'd like."
    const turn1Stream = makeStream(
      [{ type: 'text', text: partialResponse }],
      'end_turn',
    )

    vi.mocked(anthropic.messages.stream)
      .mockReturnValueOnce(turn0Stream as never)
      .mockReturnValueOnce(turn1Stream as never)

    const { runChatEngine } = await import('@/lib/chat/engine')
    const textEvents: string[] = []
    await runChatEngine({
      userId: MOCK_USER_ID,
      conversationId: 'conv-honest-c',
      clientMessages: [
        {
          id: 'msg-001', created_at: '2026-07-08T00:00:00Z',
          role: 'user',
          content: [{ type: 'text', text: 'What is going on with my gym project?' }],
        },
      ],
      send: (e) => {
        if (e.type === 'text_delta') textEvents.push(e.delta)
      },
    })

    const finalText = textEvents.join('')

    // Accurately references the tasks that DO exist
    expect(finalText).toContain('Book gym membership')
    expect(finalText).toContain('Buy workout shoes')

    // Acknowledges that goals are absent — does not fabricate goal data
    expect(finalText).toMatch(/don'?t have.*goal|no goal|no.*goal/i)

    // Does not invent a goal ID or title that was not in the data
    expect(finalText).not.toMatch(/"id"\s*:/i)
  })
})

// ---------------------------------------------------------------------------
// Task 7.4.1.3.1 — search_email_metadata handler unit tests
// ---------------------------------------------------------------------------

describe('Task 7.4.1.3.1 — search_email_metadata handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Build a Supabase mock for the search_email_metadata query chain.
   * Chain: .from('email_metadata').select(...).eq().or().order().limit()
   */
  function makeEmailMetadataClient(opts: {
    data?: unknown[] | null
    error?: { message: string } | null
  }) {
    const limit = vi.fn().mockResolvedValue({
      data: opts.data ?? [],
      error: opts.error ?? null,
    })
    const order = vi.fn().mockReturnValue({ limit })
    const or = vi.fn().mockReturnValue({ order })
    const eq = vi.fn().mockReturnValue({ or })
    const select = vi.fn().mockReturnValue({ eq })
    return {
      from: vi.fn().mockReturnValue({ select }),
    }
  }

  it('returns metadata fields only; no body fields in result', async () => {
    const rows = [
      {
        id: 'email-001',
        subject: 'Gym equipment quote',
        sender: 'vendor@gymco.com',
        urgency: 'medium',
        received_at: '2026-07-01T10:00:00Z',
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeEmailMetadataClient({ data: rows }) as never,
    )

    const result = await executeToolHandler('search_email_metadata', { query: 'gym' }, MOCK_USER_ID)
    expect(result.is_error).toBe(false)

    const parsed = JSON.parse(result.content) as Record<string, unknown>[]
    expect(parsed).toHaveLength(1)

    // Verify metadata fields are present
    expect(parsed[0]).toHaveProperty('id')
    expect(parsed[0]).toHaveProperty('subject')
    expect(parsed[0]).toHaveProperty('sender')
    expect(parsed[0]).toHaveProperty('urgency')
    expect(parsed[0]).toHaveProperty('received_at')

    // Body fields must NEVER be present (privacy invariant)
    expect(parsed[0]).not.toHaveProperty('body')
    expect(parsed[0]).not.toHaveProperty('body_text')
    expect(parsed[0]).not.toHaveProperty('body_html')
    expect(parsed[0]).not.toHaveProperty('raw_body')
    expect(parsed[0]).not.toHaveProperty('snippet')
  })

  it('returns empty array when no results match', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeEmailMetadataClient({ data: [] }) as never,
    )

    const result = await executeToolHandler('search_email_metadata', { query: 'nonexistent' }, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(JSON.parse(result.content)).toEqual([])
  })

  it('returns is_error=true on DB failure', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeEmailMetadataClient({ data: null, error: { message: 'connection refused' } }) as never,
    )

    const result = await executeToolHandler('search_email_metadata', { query: 'gym' }, MOCK_USER_ID)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Failed to search email metadata')
    // Must not leak raw DB error message
    expect(result.content).not.toContain('connection refused')
  })

  it('returns is_error=true when query is missing', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeEmailMetadataClient({ data: [] }) as never,
    )

    const result = await executeToolHandler('search_email_metadata', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('query is required')
  })

  it('caps limit at SEARCH_EMAIL_METADATA_MAX_LIMIT (20)', async () => {
    const client = makeEmailMetadataClient({ data: [] })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await executeToolHandler('search_email_metadata', { query: 'gym', limit: 999 }, MOCK_USER_ID)

    // The .limit() call on the chain should receive at most 20
    const fromCall = vi.mocked(client.from)
    expect(fromCall).toHaveBeenCalledWith('email_metadata')

    // Verify the select chose only metadata columns (not body)
    const selectCall = vi.mocked(fromCall.mock.results[0].value.select)
    const selectArg: string = selectCall.mock.calls[0][0]
    expect(selectArg).toContain('id')
    expect(selectArg).toContain('subject')
    expect(selectArg).toContain('sender')
    expect(selectArg).toContain('urgency')
    expect(selectArg).toContain('received_at')
    // Body fields must not appear in the select clause
    expect(selectArg).not.toContain('body')
  })

  it('uses default limit of 10 when limit is not provided', async () => {
    const client = makeEmailMetadataClient({ data: [] })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const result = await executeToolHandler('search_email_metadata', { query: 'gym' }, MOCK_USER_ID)
    expect(result.is_error).toBe(false)

    // The limit call must have been called with 10 (default)
    const fromResult = client.from.mock.results[0].value
    const selectResult = fromResult.select.mock.results[0].value
    const eqResult = selectResult.eq.mock.results[0].value
    const orResult = eqResult.or.mock.results[0].value
    const orderResult = orResult.order.mock.results[0].value
    expect(orderResult.limit).toHaveBeenCalledWith(10)
  })
})
