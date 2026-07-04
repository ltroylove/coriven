import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/integrations/nango before importing the module under test.
// vi.mock is hoisted — the factory must not reference variables declared above.
// ---------------------------------------------------------------------------

vi.mock('@/lib/integrations/nango', () => ({
  getProviderToken: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

vi.stubGlobal('fetch', vi.fn())

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up.
// Import the mocked nango module to capture the mock fn reference.
// ---------------------------------------------------------------------------

import {
  normalizeGoogleEvent,
  normalizeOutlookEvent,
  fetchUpcomingEvents,
} from '../providers'
import { getProviderToken } from '@/lib/integrations/nango'

const mockGetProviderToken = vi.mocked(getProviderToken)
const mockFetch = vi.mocked(globalThis.fetch)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoogleTimedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'google-event-1',
    summary: 'Team Standup',
    start: { dateTime: '2026-07-10T09:00:00-05:00' },
    end: { dateTime: '2026-07-10T09:30:00-05:00' },
    attendees: [
      { email: 'alice@example.com', displayName: 'Alice', responseStatus: 'accepted' },
      { email: 'bob@example.com', responseStatus: 'tentative' },
    ],
    location: '123 Main St',
    description: 'Daily sync',
    ...overrides,
  }
}

function makeGoogleAllDayEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'google-allday-1',
    summary: 'Company Holiday',
    start: { date: '2026-07-04' },
    end: { date: '2026-07-05' },
    ...overrides,
  }
}

function makeOutlookTimedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outlook-event-1',
    subject: 'Project Review',
    start: { dateTime: '2026-07-11T14:00:00', timeZone: 'UTC' },
    end: { dateTime: '2026-07-11T15:00:00', timeZone: 'UTC' },
    attendees: [
      {
        emailAddress: { address: 'carol@example.com', name: 'Carol' },
        status: { response: 'accepted' },
      },
    ],
    location: { displayName: 'Conference Room B' },
    bodyPreview: 'Quarterly review agenda...',
    isAllDay: false,
    ...overrides,
  }
}

function makeOutlookAllDayEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outlook-allday-1',
    subject: 'Offsite',
    start: { dateTime: '2026-07-15T00:00:00', timeZone: 'UTC' },
    end: { dateTime: '2026-07-16T00:00:00', timeZone: 'UTC' },
    attendees: [],
    isAllDay: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// normalizeGoogleEvent
// ---------------------------------------------------------------------------

describe('normalizeGoogleEvent — timed events', () => {
  it('maps id, summary, and timed start/end correctly', () => {
    const raw = makeGoogleTimedEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.eventId).toBe('google-event-1')
    expect(result.title).toBe('Team Standup')
    expect(result.isAllDay).toBe(false)
    expect(result.startAt).toBeInstanceOf(Date)
    expect(result.endAt).toBeInstanceOf(Date)
  })

  it('maps attendees with email, name, and response', () => {
    const raw = makeGoogleTimedEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.attendees).toHaveLength(2)
    expect(result.attendees[0]).toEqual({
      email: 'alice@example.com',
      name: 'Alice',
      response: 'accepted',
    })
    // Bob has no displayName
    expect(result.attendees[1]).toEqual({
      email: 'bob@example.com',
      response: 'tentative',
    })
    expect('name' in result.attendees[1]).toBe(false)
  })

  it('maps location and description', () => {
    const raw = makeGoogleTimedEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.location).toBe('123 Main St')
    expect(result.description).toBe('Daily sync')
  })

  it('returns null title for event with no summary', () => {
    const raw = makeGoogleTimedEvent({ summary: undefined })
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])
    expect(result.title).toBeNull()
  })

  it('returns null location and description when absent', () => {
    const raw = makeGoogleTimedEvent({ location: undefined, description: undefined })
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])
    expect(result.location).toBeNull()
    expect(result.description).toBeNull()
  })

  it('returns empty attendees array when none provided', () => {
    const raw = makeGoogleTimedEvent({ attendees: undefined })
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])
    expect(result.attendees).toEqual([])
  })
})

describe('normalizeGoogleEvent — all-day events', () => {
  it('detects all-day from date-only start field', () => {
    const raw = makeGoogleAllDayEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.isAllDay).toBe(true)
  })

  it('sets startAt to midnight UTC for the given date', () => {
    const raw = makeGoogleAllDayEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.startAt.toISOString()).toBe('2026-07-04T00:00:00.000Z')
  })

  it('sets endAt to midnight UTC of the end date', () => {
    const raw = makeGoogleAllDayEvent()
    const result = normalizeGoogleEvent(raw as Parameters<typeof normalizeGoogleEvent>[0])

    expect(result.endAt?.toISOString()).toBe('2026-07-05T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// normalizeOutlookEvent
// ---------------------------------------------------------------------------

describe('normalizeOutlookEvent — timed events', () => {
  it('maps id, subject, and timed start/end correctly', () => {
    const raw = makeOutlookTimedEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])

    expect(result.eventId).toBe('outlook-event-1')
    expect(result.title).toBe('Project Review')
    expect(result.isAllDay).toBe(false)
    expect(result.startAt).toBeInstanceOf(Date)
    expect(result.endAt).toBeInstanceOf(Date)
  })

  it('appends Z to dateTime strings that lack a timezone suffix', () => {
    // Graph returns '2026-07-11T14:00:00' (no Z) for UTC
    const raw = makeOutlookTimedEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.startAt.toISOString()).toBe('2026-07-11T14:00:00.000Z')
  })

  it('does not double-append Z to already-UTC strings', () => {
    const raw = makeOutlookTimedEvent({
      start: { dateTime: '2026-07-11T14:00:00Z' },
      end: { dateTime: '2026-07-11T15:00:00Z' },
    })
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.startAt.toISOString()).toBe('2026-07-11T14:00:00.000Z')
  })

  it('maps attendees with email, name, and response', () => {
    const raw = makeOutlookTimedEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])

    expect(result.attendees).toHaveLength(1)
    expect(result.attendees[0]).toEqual({
      email: 'carol@example.com',
      name: 'Carol',
      response: 'accepted',
    })
  })

  it('filters attendees with no email address', () => {
    const raw = makeOutlookTimedEvent({
      attendees: [
        { emailAddress: {}, status: { response: 'accepted' } },
        { emailAddress: { address: 'valid@example.com' }, status: { response: 'none' } },
      ],
    })
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.attendees).toHaveLength(1)
    expect(result.attendees[0].email).toBe('valid@example.com')
  })

  it('maps location from displayName', () => {
    const raw = makeOutlookTimedEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.location).toBe('Conference Room B')
  })

  it('maps bodyPreview as description', () => {
    const raw = makeOutlookTimedEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.description).toBe('Quarterly review agenda...')
  })
})

describe('normalizeOutlookEvent — all-day events', () => {
  it('detects all-day from isAllDay field', () => {
    const raw = makeOutlookAllDayEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.isAllDay).toBe(true)
  })

  it('parses start time as UTC', () => {
    const raw = makeOutlookAllDayEvent()
    const result = normalizeOutlookEvent(raw as Parameters<typeof normalizeOutlookEvent>[0])
    expect(result.startAt.toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// fetchUpcomingEvents — token-missing case (fault isolation)
// ---------------------------------------------------------------------------

describe('fetchUpcomingEvents — token-missing returns []', () => {
  beforeEach(() => {
    mockGetProviderToken.mockReset()
    mockFetch.mockReset()
  })

  it('returns [] for google_calendar when token is null (not connected)', async () => {
    mockGetProviderToken.mockResolvedValueOnce(null)
    const result = await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] for outlook_calendar when token is null (outlook not connected)', async () => {
    mockGetProviderToken.mockResolvedValueOnce(null)
    const result = await fetchUpcomingEvents('user-1', 'outlook_calendar')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] when Google API returns a non-200 status', async () => {
    mockGetProviderToken.mockResolvedValueOnce('fake-token')
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    const result = await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(result).toEqual([])
  })

  it('returns [] when Outlook API returns a non-200 status', async () => {
    mockGetProviderToken.mockResolvedValueOnce('fake-token')
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    const result = await fetchUpcomingEvents('user-1', 'outlook_calendar')
    expect(result).toEqual([])
  })

  it('returns [] when fetch itself throws (network error)', async () => {
    mockGetProviderToken.mockResolvedValueOnce('fake-token')
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))
    const result = await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// fetchUpcomingEvents — successful normalization paths
// ---------------------------------------------------------------------------

describe('fetchUpcomingEvents — successful fetch returns normalized events', () => {
  beforeEach(() => {
    mockGetProviderToken.mockReset()
    mockFetch.mockReset()
  })

  it('normalizes Google Calendar events from a successful API response', async () => {
    mockGetProviderToken.mockResolvedValueOnce('google-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [makeGoogleTimedEvent()],
      }),
    } as unknown as Response)

    const result = await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(result).toHaveLength(1)
    expect(result[0].eventId).toBe('google-event-1')
    expect(result[0].title).toBe('Team Standup')
  })

  it('normalizes Outlook Calendar events from a successful API response', async () => {
    mockGetProviderToken.mockResolvedValueOnce('outlook-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [makeOutlookTimedEvent()],
      }),
    } as unknown as Response)

    const result = await fetchUpcomingEvents('user-1', 'outlook_calendar')
    expect(result).toHaveLength(1)
    expect(result[0].eventId).toBe('outlook-event-1')
    expect(result[0].title).toBe('Project Review')
  })

  it('uses "outlook" provider key when fetching token for outlook_calendar', async () => {
    mockGetProviderToken.mockResolvedValueOnce('outlook-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: [] }),
    } as unknown as Response)

    await fetchUpcomingEvents('user-1', 'outlook_calendar')
    // The token should have been requested with 'outlook', not 'outlook_calendar',
    // because Outlook Calendar piggybacks on the Outlook OAuth connection
    expect(mockGetProviderToken).toHaveBeenCalledWith('user-1', 'outlook')
  })

  it('uses "google_calendar" provider key when fetching token for google_calendar', async () => {
    mockGetProviderToken.mockResolvedValueOnce('google-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    } as unknown as Response)

    await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(mockGetProviderToken).toHaveBeenCalledWith('user-1', 'google_calendar')
  })

  it('returns [] for empty items array', async () => {
    mockGetProviderToken.mockResolvedValueOnce('google-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    } as unknown as Response)
    const result = await fetchUpcomingEvents('user-1', 'google_calendar')
    expect(result).toEqual([])
  })
})
