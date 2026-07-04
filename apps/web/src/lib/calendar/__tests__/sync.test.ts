import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CalendarEvent } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Mock Supabase service client — vi.mock factory is hoisted,
// so we declare mocks inside the factory and expose them via the module.
// ---------------------------------------------------------------------------

const mockLt = vi.fn()
const mockEqProviderDelete = vi.fn(() => ({ lt: mockLt }))
const mockEqUserDelete = vi.fn(() => ({ eq: mockEqProviderDelete }))
const mockDelete = vi.fn(() => ({ eq: mockEqUserDelete }))

const mockUpsert = vi.fn()

const mockInProviders = vi.fn()
const mockSelectIntegrations = vi.fn(() => ({ in: mockInProviders }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'integrations') {
    return { select: mockSelectIntegrations }
  }
  if (table === 'calendar_events') {
    return { upsert: mockUpsert, delete: mockDelete }
  }
  return {}
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ---------------------------------------------------------------------------
// Mock fetchUpcomingEvents
// ---------------------------------------------------------------------------

vi.mock('../providers', () => ({
  fetchUpcomingEvents: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { syncCalendars } from '../sync'
import { fetchUpcomingEvents } from '../providers'

const mockFetchUpcomingEvents = vi.mocked(fetchUpcomingEvents)

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    eventId: 'evt-1',
    title: 'Test Event',
    startAt: new Date('2026-07-10T09:00:00Z'),
    endAt: new Date('2026-07-10T10:00:00Z'),
    attendees: [{ email: 'alice@example.com', name: 'Alice' }],
    location: 'Room A',
    description: 'Test description',
    isAllDay: false,
    ...overrides,
  }
}

function makeConnection(userId: string, provider: string) {
  return { user_id: userId, provider }
}

// ---------------------------------------------------------------------------
// Helper: configure integrations query chain
// ---------------------------------------------------------------------------

function setupIntegrationsQuery(
  connections: ReturnType<typeof makeConnection>[],
  error: { message: string } | null = null,
) {
  mockInProviders.mockResolvedValueOnce({ data: connections, error })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Reset mock chain stubs
  mockSelectIntegrations.mockReturnValue({ in: mockInProviders })
  mockEqUserDelete.mockReturnValue({ eq: mockEqProviderDelete })
  mockEqProviderDelete.mockReturnValue({ lt: mockLt })
  mockDelete.mockReturnValue({ eq: mockEqUserDelete })
  // Default: upsert and delete succeed
  mockUpsert.mockResolvedValue({ error: null })
  mockLt.mockResolvedValue({ error: null })
})

describe('syncCalendars — no connections', () => {
  it('returns zero counts when no calendar integrations exist', async () => {
    setupIntegrationsQuery([])
    const result = await syncCalendars()
    expect(result.usersProcessed).toBe(0)
    expect(result.eventsUpserted).toBe(0)
    expect(result.errorCount).toBe(0)
  })
})

describe('syncCalendars — DB fetch error', () => {
  it('returns errorCount=1 and stops when integrations fetch fails', async () => {
    setupIntegrationsQuery([], { message: 'connection refused' })

    const result = await syncCalendars()
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]).toContain('Failed to fetch integrations')
    expect(mockFetchUpcomingEvents).not.toHaveBeenCalled()
  })
})

describe('syncCalendars — successful single user google_calendar', () => {
  it('upserts events returned by fetchUpcomingEvents', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'google_calendar')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([
      makeCalendarEvent(),
      makeCalendarEvent({ eventId: 'evt-2' }),
    ])

    const result = await syncCalendars()

    expect(result.usersProcessed).toBe(1)
    expect(result.eventsUpserted).toBe(2)
    expect(result.errorCount).toBe(0)
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('maps outlook integration provider to outlook_calendar CalendarProvider', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'outlook')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([makeCalendarEvent()])

    await syncCalendars()

    expect(mockFetchUpcomingEvents).toHaveBeenCalledWith('user-1', 'outlook_calendar')
  })

  it('stores events with provider="outlook_calendar" when outlook integration is used', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'outlook')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([makeCalendarEvent()])

    await syncCalendars()

    const upsertRows = mockUpsert.mock.calls[0][0] as Array<{ provider: string }>
    expect(upsertRows[0].provider).toBe('outlook_calendar')
  })

  it('does not call upsert when fetchUpcomingEvents returns []', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'google_calendar')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([])

    const result = await syncCalendars()

    expect(result.eventsUpserted).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('syncCalendars — fault isolation', () => {
  it('continues processing other users when one user upsert fails', async () => {
    setupIntegrationsQuery([
      makeConnection('user-bad', 'google_calendar'),
      makeConnection('user-good', 'google_calendar'),
    ])

    // user-bad: fetch succeeds, upsert fails
    mockFetchUpcomingEvents
      .mockResolvedValueOnce([makeCalendarEvent()])
      .mockResolvedValueOnce([makeCalendarEvent({ eventId: 'evt-good' })])

    mockUpsert
      .mockResolvedValueOnce({ error: { message: 'constraint violation' } })
      .mockResolvedValueOnce({ error: null })

    const result = await syncCalendars()

    expect(result.usersProcessed).toBe(2)
    expect(result.eventsUpserted).toBe(1) // only user-good's event counted
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]).toContain('user-bad')
  })

  it('continues processing other users when one user fetch throws unexpectedly', async () => {
    setupIntegrationsQuery([
      makeConnection('user-throws', 'google_calendar'),
      makeConnection('user-ok', 'google_calendar'),
    ])

    mockFetchUpcomingEvents
      .mockRejectedValueOnce(new Error('Unexpected provider error'))
      .mockResolvedValueOnce([makeCalendarEvent()])

    const result = await syncCalendars()

    expect(result.usersProcessed).toBe(2)
    expect(result.eventsUpserted).toBe(1)
    expect(result.errorCount).toBe(1)
  })

  it('processes multiple connections for different providers independently', async () => {
    setupIntegrationsQuery([
      makeConnection('user-1', 'google_calendar'),
      makeConnection('user-1', 'outlook'),
    ])

    mockFetchUpcomingEvents
      .mockResolvedValueOnce([makeCalendarEvent()])
      .mockResolvedValueOnce([makeCalendarEvent({ eventId: 'outlook-evt-1' })])

    const result = await syncCalendars()

    expect(result.usersProcessed).toBe(2)
    expect(result.eventsUpserted).toBe(2)
    expect(result.errorCount).toBe(0)
  })
})

describe('syncCalendars — cancelled event deletion', () => {
  it('deletes stale rows after upserting (cancelled event cleanup)', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'google_calendar')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([makeCalendarEvent()])

    await syncCalendars()

    // delete().eq(user_id).eq(provider).lt(synced_at) chain should have been called
    expect(mockDelete).toHaveBeenCalledOnce()
    expect(mockEqUserDelete).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mockEqProviderDelete).toHaveBeenCalledWith('provider', 'google_calendar')
  })

  it('still runs deletion even when provider returns 0 events (all cancelled)', async () => {
    setupIntegrationsQuery([makeConnection('user-1', 'google_calendar')])
    mockFetchUpcomingEvents.mockResolvedValueOnce([])

    await syncCalendars()

    // No upsert, but deletion should still fire to clean up any previously synced rows
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledOnce()
  })
})
