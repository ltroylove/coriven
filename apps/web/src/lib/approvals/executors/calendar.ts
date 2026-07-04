/**
 * Calendar executor — creates or updates calendar events via the connected provider.
 *
 * Google Calendar: POST /calendar/v3/calendars/primary/events (create)
 *                  PATCH /calendar/v3/calendars/primary/events/{eventId} (update)
 * Outlook Calendar (Microsoft Graph): POST /me/events (create)
 *                                     PATCH /me/events/{eventId} (update)
 *
 * Token is fetched from Nango per-call (ADR-013). Tokens are never logged.
 * Outlook Calendar piggybacks on the 'outlook' Nango connection key (same as
 * email), mirroring the pattern in lib/calendar/providers.ts.
 *
 * All provider errors map to stable ExecutionErrorCode values.
 */

import { getProviderToken } from '@/lib/integrations/nango'
import type {
  CreateCalendarEventPayload,
  UpdateCalendarEventPayload,
  ExecutionErrorCode,
} from '@personal-assistant/types'

const FETCH_TIMEOUT_MS = 15_000

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

interface GoogleEventBody {
  summary?: string
  start?: { dateTime: string }
  end?: { dateTime: string }
  description?: string
  attendees?: { email: string }[]
}

async function createGoogleCalendarEvent(
  token: string,
  payload: CreateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  const body: GoogleEventBody = {
    summary: payload.title,
    start: { dateTime: payload.start },
    end: { dateTime: payload.end },
  }
  if (payload.description) body.description = payload.description
  if (payload.attendees?.length) {
    body.attendees = payload.attendees.map((email) => ({ email }))
  }

  let response: Response
  try {
    response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    console.error(JSON.stringify({ event: 'executor.calendar.google.create.network_error' }))
    return { ok: false, errorCode: 'network_error' }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.calendar.google.create.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  const data = (await response.json()) as { id?: string }
  return { ok: true, providerRef: data.id }
}

async function updateGoogleCalendarEvent(
  token: string,
  payload: UpdateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  const body: GoogleEventBody = {}
  if (payload.title !== undefined) body.summary = payload.title
  if (payload.start !== undefined) body.start = { dateTime: payload.start }
  if (payload.end !== undefined) body.end = { dateTime: payload.end }
  if (payload.description !== undefined) body.description = payload.description

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(payload.event_id)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    console.error(JSON.stringify({ event: 'executor.calendar.google.update.network_error' }))
    return { ok: false, errorCode: 'network_error' }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.calendar.google.update.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  const data = (await response.json()) as { id?: string }
  return { ok: true, providerRef: data.id }
}

// ---------------------------------------------------------------------------
// Outlook Calendar (Microsoft Graph)
// ---------------------------------------------------------------------------

interface GraphEventBody {
  subject?: string
  start?: { dateTime: string; timeZone: string }
  end?: { dateTime: string; timeZone: string }
  body?: { contentType: string; content: string }
  attendees?: { emailAddress: { address: string }; type: string }[]
}

async function createOutlookCalendarEvent(
  token: string,
  payload: CreateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  const body: GraphEventBody = {
    subject: payload.title,
    start: { dateTime: payload.start, timeZone: 'UTC' },
    end: { dateTime: payload.end, timeZone: 'UTC' },
  }
  if (payload.description) {
    body.body = { contentType: 'Text', content: payload.description }
  }
  if (payload.attendees?.length) {
    body.attendees = payload.attendees.map((email) => ({
      emailAddress: { address: email },
      type: 'required',
    }))
  }

  let response: Response
  try {
    response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    console.error(JSON.stringify({ event: 'executor.calendar.outlook.create.network_error' }))
    return { ok: false, errorCode: 'network_error' }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.calendar.outlook.create.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  const data = (await response.json()) as { id?: string }
  return { ok: true, providerRef: data.id }
}

async function updateOutlookCalendarEvent(
  token: string,
  payload: UpdateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  const body: GraphEventBody = {}
  if (payload.title !== undefined) body.subject = payload.title
  if (payload.start !== undefined) body.start = { dateTime: payload.start, timeZone: 'UTC' }
  if (payload.end !== undefined) body.end = { dateTime: payload.end, timeZone: 'UTC' }
  if (payload.description !== undefined) {
    body.body = { contentType: 'Text', content: payload.description }
  }

  const url = `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(payload.event_id)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    console.error(JSON.stringify({ event: 'executor.calendar.outlook.update.network_error' }))
    return { ok: false, errorCode: 'network_error' }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.calendar.outlook.update.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  const data = (await response.json()) as { id?: string }
  return { ok: true, providerRef: data.id }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a calendar event via the specified provider using an approved payload.
 * Token is fetched per-call from Nango.
 *
 * For 'outlook_calendar': uses the 'outlook' Nango connection key (same
 * connection used for email, per the Outlook integration design).
 *
 * Returns { ok: true, providerRef } on success.
 * Returns { ok: false, errorCode } on any failure — never throws.
 */
export async function createCalendarEvent(
  userId: string,
  provider: 'google_calendar' | 'outlook_calendar',
  payload: CreateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  // Outlook Calendar uses the 'outlook' Nango connection (see module header)
  const nangoProvider = provider === 'outlook_calendar' ? 'outlook' : 'google_calendar'
  const token = await getProviderToken(userId, nangoProvider)
  if (!token) {
    console.error(
      JSON.stringify({ event: 'executor.calendar.token_unavailable', userId, provider }),
    )
    return { ok: false, errorCode: 'token_unavailable' }
  }

  try {
    if (provider === 'google_calendar') {
      return await createGoogleCalendarEvent(token, payload)
    }
    return await createOutlookCalendarEvent(token, payload)
  } catch {
    console.error(
      JSON.stringify({ event: 'executor.calendar.unexpected_error', userId, provider }),
    )
    return { ok: false, errorCode: 'executor_error' }
  }
}

/**
 * Updates a calendar event via the specified provider using an approved payload.
 * Token is fetched per-call from Nango.
 *
 * Returns { ok: true, providerRef } on success.
 * Returns { ok: false, errorCode } on any failure — never throws.
 */
export async function updateCalendarEvent(
  userId: string,
  provider: 'google_calendar' | 'outlook_calendar',
  payload: UpdateCalendarEventPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode; providerRef?: string }> {
  const nangoProvider = provider === 'outlook_calendar' ? 'outlook' : 'google_calendar'
  const token = await getProviderToken(userId, nangoProvider)
  if (!token) {
    console.error(
      JSON.stringify({ event: 'executor.calendar.update.token_unavailable', userId, provider }),
    )
    return { ok: false, errorCode: 'token_unavailable' }
  }

  try {
    if (provider === 'google_calendar') {
      return await updateGoogleCalendarEvent(token, payload)
    }
    return await updateOutlookCalendarEvent(token, payload)
  } catch {
    console.error(
      JSON.stringify({ event: 'executor.calendar.update.unexpected_error', userId, provider }),
    )
    return { ok: false, errorCode: 'executor_error' }
  }
}
