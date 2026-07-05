import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server before importing the module under test.
// vi.mock is hoisted; factory must not reference top-level variables.
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { assembleMeetingBrief, generateDueBriefs } from '../meeting-prep'
import { createServiceClient } from '@/lib/supabase/server'

const mockCreateServiceClient = vi.mocked(createServiceClient)

// ---------------------------------------------------------------------------
// Mock chain factory
//
// Each query in the source code follows the pattern:
//   await supabase.from(table).select(...).eq(...).limit(...)
//
// We need the final await to resolve to `result`. We do this by making
// `from()` return a Proxy where every property access (for chaining methods)
// returns the same proxy, and `then` makes it thenable (Promise-like).
// ---------------------------------------------------------------------------

function makeResolvingChain(result: { data?: unknown; count?: number | null; error?: unknown }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        // Make the chain awaitable — resolve with result immediately
        return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
      }
      if (prop === 'catch' || prop === 'finally') {
        return undefined
      }
      // All chaining methods (select, eq, in, not, or, is, order, limit, upsert) return the proxy
      return () => proxy
    },
  }
  const proxy = new Proxy({}, handler)
  return proxy
}

/**
 * Build a mock Supabase client where each table maps to a fixed result.
 * Tables not in `tableResults` resolve to `{ data: [], error: null }`.
 */
function makeMockClient(
  tableResults: Record<string, { data?: unknown; count?: number | null; error?: unknown }>,
) {
  return {
    from: vi.fn((table: string) => {
      const result = tableResults[table] ?? { data: [], error: null }
      return makeResolvingChain(result)
    }),
  }
}

// ---------------------------------------------------------------------------
// Sample event fixture
// ---------------------------------------------------------------------------

const sampleEvent = {
  id: 'uuid-cal-event-1',
  user_id: 'uuid-user-1',
  event_id: 'provider-event-abc',
  provider: 'google_calendar',
  title: 'Sync with Alice and Bob',
  start_at: '2026-07-05T14:00:00Z',
  end_at: '2026-07-05T15:00:00Z',
  location: 'Zoom',
  attendees: [
    { email: 'alice@example.com', name: 'Alice Smith' },
    { email: 'bob@example.com', name: 'Bob Jones' },
  ],
}

// ---------------------------------------------------------------------------
// assembleMeetingBrief — all-empty context
// ---------------------------------------------------------------------------

describe('assembleMeetingBrief — all-empty context', () => {
  beforeEach(() => {
    mockCreateServiceClient.mockReset()
  })

  it('returns explicitly empty arrays for all sections when DB has no matching rows', async () => {
    const client = makeMockClient({
      email_metadata: { data: [], error: null },
      tasks: { data: [], error: null },
      memories: { data: [], error: null },
      entity_profiles: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.relatedEmails).toEqual([])
    expect(result.openTasks).toEqual([])
    expect(result.memories).toEqual([])
    expect(result.entities).toEqual([])
    // Event header always populated from the input
    expect(result.event.title).toBe('Sync with Alice and Bob')
    expect(result.event.provider).toBe('google_calendar')
  })

  it('parsed attendees are included even when all context queries return empty', async () => {
    const client = makeMockClient({
      email_metadata: { data: [], error: null },
      tasks: { data: [], error: null },
      memories: { data: [], error: null },
      entity_profiles: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.attendees).toHaveLength(2)
    expect(result.attendees[0].email).toBe('alice@example.com')
    expect(result.attendees[1].email).toBe('bob@example.com')
  })

  it('no Anthropic/LLM import exists in meeting-prep module (ADR-008 assertion)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const srcPath = path.resolve(__dirname, '../meeting-prep.ts')
    const src = fs.readFileSync(srcPath, 'utf-8')

    expect(src).not.toContain('@anthropic-ai/sdk')
    expect(src).not.toContain('Anthropic(')
    expect(src).not.toContain('messages.create')
    expect(src).not.toContain('anthropic.messages')
  })
})

// ---------------------------------------------------------------------------
// assembleMeetingBrief — attendee email matching
// ---------------------------------------------------------------------------

describe('assembleMeetingBrief — attendee email matching', () => {
  beforeEach(() => {
    mockCreateServiceClient.mockReset()
  })

  it('returns relatedEmails when email_metadata matches an attendee email', async () => {
    const client = makeMockClient({
      email_metadata: {
        data: [
          {
            id: 'email-1',
            from_address: 'alice@example.com',
            subject: 'Project update',
            received_at: '2026-07-04T10:00:00Z',
            ai_summary: 'Alice sent an update on the project.',
          },
        ],
        error: null,
      },
      tasks: { data: [], error: null },
      memories: { data: [], error: null },
      entity_profiles: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.relatedEmails).toHaveLength(1)
    expect(result.relatedEmails[0].fromAddress).toBe('alice@example.com')
    expect(result.relatedEmails[0].subject).toBe('Project update')
  })

  it('returns openTasks when task title matches an attendee name', async () => {
    const client = makeMockClient({
      email_metadata: { data: [], error: null },
      tasks: {
        data: [
          {
            id: 'task-1',
            title: 'Follow up with Alice Smith on proposal',
            status: 'pending',
            due_at: '2026-07-10T00:00:00Z',
          },
        ],
        error: null,
      },
      memories: { data: [], error: null },
      entity_profiles: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.openTasks).toHaveLength(1)
    expect(result.openTasks[0].title).toBe('Follow up with Alice Smith on proposal')
    expect(result.openTasks[0].status).toBe('pending')
  })

  it('returns memories when content mentions an attendee name', async () => {
    const client = makeMockClient({
      email_metadata: { data: [], error: null },
      tasks: { data: [], error: null },
      memories: {
        data: [
          {
            id: 'mem-1',
            content: 'Alice Smith prefers morning meetings.',
            created_at: '2026-06-01T00:00:00Z',
          },
        ],
        error: null,
      },
      entity_profiles: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0].content).toBe('Alice Smith prefers morning meetings.')
  })

  it('returns entities when entity_profiles matches an attendee name', async () => {
    const client = makeMockClient({
      email_metadata: { data: [], error: null },
      tasks: { data: [], error: null },
      memories: { data: [], error: null },
      entity_profiles: {
        data: [
          {
            id: 'entity-1',
            name: 'Alice Smith',
            description: 'Engineering lead at Acme.',
            aliases: ['Alice', 'A. Smith'],
          },
        ],
        error: null,
      },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await assembleMeetingBrief('uuid-user-1', sampleEvent)

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].name).toBe('Alice Smith')
    expect(result.entities[0].description).toBe('Engineering lead at Acme.')
  })
})

// ---------------------------------------------------------------------------
// assembleMeetingBrief — events with no attendees
// ---------------------------------------------------------------------------

describe('assembleMeetingBrief — event with no attendees', () => {
  beforeEach(() => {
    mockCreateServiceClient.mockReset()
  })

  it('skips email/memory/entity queries when attendees array is empty', async () => {
    const client = makeMockClient({
      tasks: { data: [], error: null },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const eventNoAttendees = { ...sampleEvent, attendees: [], title: null }
    const result = await assembleMeetingBrief('uuid-user-1', eventNoAttendees)

    expect(result.attendees).toEqual([])
    expect(result.relatedEmails).toEqual([])
    expect(result.memories).toEqual([])
    expect(result.entities).toEqual([])
    // email_metadata should NOT be queried (no attendee emails)
    expect(client.from).not.toHaveBeenCalledWith('email_metadata')
    // memories should NOT be queried (no attendee names)
    expect(client.from).not.toHaveBeenCalledWith('memories')
    // entity_profiles should NOT be queried (no attendee names)
    expect(client.from).not.toHaveBeenCalledWith('entity_profiles')
  })

  it('also skips tasks query when no attendees AND no title keywords', async () => {
    const client = makeMockClient({})
    mockCreateServiceClient.mockReturnValue(client as never)

    const eventNoContext = { ...sampleEvent, attendees: [], title: null }
    const result = await assembleMeetingBrief('uuid-user-1', eventNoContext)

    expect(result.openTasks).toEqual([])
    // With no attendee names and no title keywords, tasks query is skipped
    expect(client.from).not.toHaveBeenCalledWith('tasks')
  })
})

// ---------------------------------------------------------------------------
// generateDueBriefs — idempotency skip
// ---------------------------------------------------------------------------

describe('generateDueBriefs — idempotency', () => {
  beforeEach(() => {
    mockCreateServiceClient.mockReset()
  })

  it('skips brief creation when a brief already exists for the event', async () => {
    const calEventRow = {
      id: 'uuid-cal-1',
      user_id: 'uuid-user-1',
      event_id: 'evt-001',
      provider: 'google_calendar',
      title: 'Team standup',
      start_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
      location: null,
      attendees: [],
      is_all_day: false,
    }

    // calendar_events query → event row
    // meeting_briefs idempotency check → count = 1 (already exists)
    // upsert should NOT be called
    let meetingBriefCallCount = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'calendar_events') {
          return makeResolvingChain({ data: [calEventRow], error: null })
        }
        if (table === 'meeting_briefs') {
          meetingBriefCallCount++
          // Always return count=1 (brief exists)
          return makeResolvingChain({ count: 1, data: null, error: null })
        }
        return makeResolvingChain({ data: [], error: null })
      }),
    }
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await generateDueBriefs()

    expect(result.eventsConsidered).toBe(1)
    expect(result.briefsCreated).toBe(0)
    expect(result.errorCount).toBe(0)
    // meeting_briefs was called once for the idempotency check, never for upsert
    expect(meetingBriefCallCount).toBe(1)
  })

  it('creates a brief when no existing brief is found', async () => {
    const calEventRow = {
      id: 'uuid-cal-2',
      user_id: 'uuid-user-2',
      event_id: 'evt-002',
      provider: 'google_calendar',
      title: 'Client call',
      start_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 38 * 60 * 1000).toISOString(),
      location: null,
      attendees: [],
      is_all_day: false,
    }

    let meetingBriefCallCount = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'calendar_events') {
          return makeResolvingChain({ data: [calEventRow], error: null })
        }
        if (table === 'meeting_briefs') {
          meetingBriefCallCount++
          if (meetingBriefCallCount === 1) {
            // First call = idempotency check — no existing brief
            return makeResolvingChain({ count: 0, data: null, error: null })
          }
          // Second call = upsert — success
          return makeResolvingChain({ data: null, error: null })
        }
        // Assembly queries (email, tasks, memories, entities) — all empty
        return makeResolvingChain({ data: [], error: null })
      }),
    }
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await generateDueBriefs()

    expect(result.eventsConsidered).toBe(1)
    expect(result.briefsCreated).toBe(1)
    expect(result.errorCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// generateDueBriefs — per-event fault isolation
// ---------------------------------------------------------------------------

describe('generateDueBriefs — per-event fault isolation', () => {
  beforeEach(() => {
    mockCreateServiceClient.mockReset()
  })

  it('counts error for event with DB error on idempotency check, still creates brief for other event', async () => {
    const goodEvent = {
      id: 'uuid-cal-good',
      user_id: 'uuid-user-1',
      event_id: 'evt-good',
      provider: 'google_calendar',
      title: 'Good meeting',
      start_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      end_at: null,
      location: null,
      attendees: [],
      is_all_day: false,
    }
    const badEvent = {
      id: 'uuid-cal-bad',
      user_id: 'uuid-user-2',
      event_id: 'evt-bad',
      provider: 'google_calendar',
      title: 'Bad meeting',
      start_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      end_at: null,
      location: null,
      attendees: [],
      is_all_day: false,
    }

    // Track which event_id is being processed based on call order
    // Events are processed sequentially: goodEvent first, then badEvent
    let meetingBriefCallCount = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'calendar_events') {
          return makeResolvingChain({ data: [goodEvent, badEvent], error: null })
        }
        if (table === 'meeting_briefs') {
          meetingBriefCallCount++
          if (meetingBriefCallCount === 1) {
            // Good event idempotency check — no existing brief
            return makeResolvingChain({ count: 0, data: null, error: null })
          }
          if (meetingBriefCallCount === 2) {
            // Good event upsert — success
            return makeResolvingChain({ data: null, error: null })
          }
          if (meetingBriefCallCount === 3) {
            // Bad event idempotency check — DB error
            return makeResolvingChain({ count: null, error: { message: 'simulated DB error' } })
          }
          return makeResolvingChain({ data: null, error: null })
        }
        // Assembly queries — all empty
        return makeResolvingChain({ data: [], error: null })
      }),
    }
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await generateDueBriefs()

    expect(result.eventsConsidered).toBe(2)
    expect(result.briefsCreated).toBe(1)
    expect(result.errorCount).toBe(1)
  })

  it('returns { eventsConsidered: 0, briefsCreated: 0, errorCount: 1 } when calendar_events query fails', async () => {
    const client = makeMockClient({
      calendar_events: { data: null, error: { message: 'connection refused' } },
    })
    mockCreateServiceClient.mockReturnValue(client as never)

    const result = await generateDueBriefs()

    expect(result.eventsConsidered).toBe(0)
    expect(result.briefsCreated).toBe(0)
    expect(result.errorCount).toBe(1)
  })
})
