/**
 * Calendar provider clients for Google Calendar and Outlook Calendar.
 *
 * Both clients follow the same contract:
 *   fetchUpcomingEvents(userId, provider) → CalendarEvent[]
 *
 * Token retrieval goes exclusively through getProviderToken() (ADR-013).
 * Provider errors are caught and logged; the caller receives [] on any failure
 * to ensure fault isolation across users in the sync batch.
 *
 * Sync window: now → +14 days (covers the immediate scheduling horizon that
 * meeting-prep and follow-up detection waves need).
 *
 * OUTLOOK vs OUTLOOK_CALENDAR:
 *   The Integrations UI (settings/integrations/page.tsx) exposes "Outlook" as
 *   a single user-facing connection that includes Outlook Calendar. The
 *   `integrations` table records this as provider='outlook'. The calendar
 *   sync job queries for provider='outlook' and passes CalendarProvider
 *   'outlook_calendar' to this module. This function therefore accepts
 *   'outlook_calendar' as the logical provider but calls getProviderToken with
 *   'outlook' so it retrieves the Nango connection that was created when the
 *   user connected Outlook email+calendar together. The Microsoft Graph
 *   Calendar API is the actual endpoint called.
 */

import { getProviderToken } from '@/lib/integrations/nango'
import type { CalendarEvent, CalendarAttendee, CalendarProvider } from '@personal-assistant/types'

/**
 * Result of a calendar fetch. `ok` distinguishes a genuine "no events in window"
 * (ok: true, events: []) from a failure (ok: false) — token missing, provider
 * API error, network error, or parse error. Callers MUST NOT treat an ok:false
 * empty result as "the calendar is empty" (e.g. never reconcile-delete on it).
 */
export interface FetchEventsResult {
  ok: boolean
  events: CalendarEvent[]
}

// ---------------------------------------------------------------------------
// Sync window constant
// ---------------------------------------------------------------------------

/** Number of days ahead of now to include in the sync window. */
const SYNC_WINDOW_DAYS = 14

function getSyncWindow(): { timeMin: Date; timeMax: Date } {
  const timeMin = new Date()
  const timeMax = new Date(timeMin.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return { timeMin, timeMax }
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

/**
 * Raw Google Calendar event shape (partial — only fields we consume).
 * Full schema: https://developers.google.com/calendar/api/v3/reference/events
 */
interface GoogleCalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus?: string
  }>
  location?: string
  description?: string
  status?: string
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[]
  nextPageToken?: string
}

/**
 * Normalizes a Google Calendar event to the shared CalendarEvent shape.
 * Google all-day events use date-only ISO strings (YYYY-MM-DD) in start/end;
 * timed events use dateTime. All-day is detected when start.date is set.
 */
export function normalizeGoogleEvent(raw: GoogleCalendarEvent): CalendarEvent {
  const isAllDay = Boolean(raw.start?.date && !raw.start?.dateTime)

  // For all-day events, treat the date string as midnight UTC
  const startAt = isAllDay
    ? new Date(raw.start!.date! + 'T00:00:00Z')
    : new Date(raw.start?.dateTime ?? new Date().toISOString())

  let endAt: Date | null = null
  if (raw.end) {
    endAt = isAllDay && raw.end.date
      ? new Date(raw.end.date + 'T00:00:00Z')
      : raw.end.dateTime
        ? new Date(raw.end.dateTime)
        : null
  }

  const attendees: CalendarAttendee[] = (raw.attendees ?? []).map((a) => ({
    email: a.email,
    ...(a.displayName ? { name: a.displayName } : {}),
    ...(a.responseStatus ? { response: a.responseStatus } : {}),
  }))

  return {
    eventId: raw.id,
    title: raw.summary ?? null,
    startAt,
    endAt,
    attendees,
    location: raw.location ?? null,
    description: raw.description ?? null,
    isAllDay,
  }
}

async function fetchGoogleCalendarEvents(userId: string): Promise<FetchEventsResult> {
  const token = await getProviderToken(userId, 'google_calendar')
  if (!token) {
    // Not connected or token retrieval failed — skip silently (already logged in getProviderToken)
    return { ok: false, events: [] }
  }

  const { timeMin, timeMax } = getSyncWindow()
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  })

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'calendar.google.fetch_error',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { ok: false, events: [] }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'calendar.google.api_error',
        userId,
        status: response.status,
      }),
    )
    return { ok: false, events: [] }
  }

  let body: GoogleCalendarListResponse
  try {
    body = (await response.json()) as GoogleCalendarListResponse
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'calendar.google.parse_error',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { ok: false, events: [] }
  }

  return { ok: true, events: (body.items ?? []).map(normalizeGoogleEvent) }
}

// ---------------------------------------------------------------------------
// Outlook Calendar (Microsoft Graph)
// ---------------------------------------------------------------------------

/**
 * Raw Microsoft Graph calendar event shape (partial — only fields we consume).
 * Full schema: https://learn.microsoft.com/en-us/graph/api/resources/event
 */
interface GraphCalendarEvent {
  id: string
  subject?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string }
    status?: { response?: string }
  }>
  location?: { displayName?: string }
  bodyPreview?: string
  isAllDay?: boolean
}

interface GraphCalendarListResponse {
  value?: GraphCalendarEvent[]
}

/**
 * Normalizes a Microsoft Graph calendar event to the shared CalendarEvent shape.
 * Graph always returns dateTime strings (UTC when isAllDay is true as well).
 * The isAllDay flag comes directly from Graph's own field.
 */
export function normalizeOutlookEvent(raw: GraphCalendarEvent): CalendarEvent {
  const isAllDay = raw.isAllDay ?? false

  const startAt = raw.start?.dateTime
    ? new Date(raw.start.dateTime + (raw.start.dateTime.endsWith('Z') ? '' : 'Z'))
    : new Date()

  const endAt = raw.end?.dateTime
    ? new Date(raw.end.dateTime + (raw.end.dateTime.endsWith('Z') ? '' : 'Z'))
    : null

  const attendees: CalendarAttendee[] = (raw.attendees ?? [])
    .filter((a) => a.emailAddress?.address)
    .map((a) => ({
      email: a.emailAddress!.address!,
      ...(a.emailAddress?.name ? { name: a.emailAddress.name } : {}),
      ...(a.status?.response ? { response: a.status.response } : {}),
    }))

  return {
    eventId: raw.id,
    title: raw.subject ?? null,
    startAt,
    endAt,
    attendees,
    location: raw.location?.displayName ?? null,
    description: raw.bodyPreview ?? null,
    isAllDay,
  }
}

async function fetchOutlookCalendarEvents(userId: string): Promise<FetchEventsResult> {
  // Outlook Calendar piggybacks on the 'outlook' Nango connection (see module header).
  const token = await getProviderToken(userId, 'outlook')
  if (!token) {
    return { ok: false, events: [] }
  }

  const { timeMin, timeMax } = getSyncWindow()
  const params = new URLSearchParams({
    startDateTime: timeMin.toISOString(),
    endDateTime: timeMax.toISOString(),
    $top: '100',
    $select: 'id,subject,start,end,attendees,location,bodyPreview,isAllDay',
  })

  const url = `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'calendar.outlook.fetch_error',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { ok: false, events: [] }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'calendar.outlook.api_error',
        userId,
        status: response.status,
      }),
    )
    return { ok: false, events: [] }
  }

  let body: GraphCalendarListResponse
  try {
    body = (await response.json()) as GraphCalendarListResponse
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'calendar.outlook.parse_error',
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { ok: false, events: [] }
  }

  return { ok: true, events: (body.value ?? []).map(normalizeOutlookEvent) }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches upcoming calendar events for a user from the given provider.
 * Window: now → +14 days.
 *
 * Returns { ok, events }. `ok` is false on any failure (token missing, provider
 * API failure, network error, parse failure) — the caller MUST check `ok` before
 * treating an empty `events` list as authoritative (e.g. before deleting cached
 * rows). Errors are logged server-side; this function never throws — fault
 * isolation is enforced here, not in the caller.
 */
export async function fetchUpcomingEvents(
  userId: string,
  provider: CalendarProvider,
): Promise<FetchEventsResult> {
  if (provider === 'google_calendar') {
    return fetchGoogleCalendarEvents(userId)
  }
  if (provider === 'outlook_calendar') {
    return fetchOutlookCalendarEvents(userId)
  }
  // Exhaustiveness guard — should never reach here with a valid CalendarProvider
  console.error(
    JSON.stringify({ event: 'calendar.unknown_provider', userId, provider }),
  )
  return { ok: false, events: [] }
}
