/**
 * Calendar sync job — fetches upcoming events from all connected calendar
 * providers for all users and upserts them into calendar_events.
 *
 * OUTLOOK vs OUTLOOK_CALENDAR:
 *   The Integrations UI creates a single Nango connection under provider='outlook'
 *   that covers both Outlook email and Outlook Calendar (piggybacked scopes).
 *   This sync job queries the integrations table for provider IN ('google_calendar',
 *   'outlook') and maps:
 *     - 'google_calendar' → CalendarProvider 'google_calendar'
 *     - 'outlook'        → CalendarProvider 'outlook_calendar'
 *
 *   This mapping means Outlook Calendar events are stored with provider='outlook_calendar'
 *   in calendar_events, keeping them distinct from Google Calendar events (per the
 *   UNIQUE(user_id, provider, event_id) constraint) even though the Nango token is
 *   fetched via the 'outlook' integration row.
 *
 * CANCELLED EVENT HANDLING:
 *   After upserting the events returned by the provider, any calendar_events row
 *   for this user + provider whose synced_at is older than the run's timestamp
 *   is deleted. Because the provider only returns events in the sync window
 *   (now → +14 days), this correctly removes events that were cancelled/deleted
 *   in the provider calendar between sync cycles. Events outside the window are
 *   not touched (they age out naturally as future syncs advance the window).
 */

import { createServiceClient } from '@/lib/supabase/server'
import { fetchUpcomingEvents } from './providers'
import type { CalendarProvider } from '@personal-assistant/types'
import type { Json } from '@/types/supabase'

// ---------------------------------------------------------------------------
// Provider mapping
// ---------------------------------------------------------------------------

/**
 * Maps the integration_provider value stored in the integrations table to
 * the CalendarProvider used by the provider clients.
 * Only calendar-relevant integration providers are included.
 */
const INTEGRATION_TO_CALENDAR_PROVIDER: Record<string, CalendarProvider> = {
  google_calendar: 'google_calendar',
  // 'outlook' Nango connection covers Outlook Calendar via piggybacked OAuth scopes
  outlook: 'outlook_calendar',
}

// ---------------------------------------------------------------------------
// Sync job
// ---------------------------------------------------------------------------

export interface SyncResult {
  usersProcessed: number
  eventsUpserted: number
  errorCount: number
  errors: string[]
}

/**
 * Syncs calendar events for all users with a connected Google Calendar
 * or Outlook (calendar-piggybacked) integration.
 *
 * Per-user try/catch ensures one user's failure does not block the batch.
 */
export async function syncCalendars(): Promise<SyncResult> {
  const supabase = createServiceClient()
  const result: SyncResult = {
    usersProcessed: 0,
    eventsUpserted: 0,
    errorCount: 0,
    errors: [],
  }

  console.log(JSON.stringify({ event: 'calendar.sync.start', runAt: new Date().toISOString() }))

  // Fetch all calendar-relevant integration rows (service role — bypasses RLS)
  // Cast to the enum union that Supabase's .in() expects
  const calendarProviders = Object.keys(INTEGRATION_TO_CALENDAR_PROVIDER) as (
    | 'google_calendar'
    | 'outlook'
  )[]
  const { data: connections, error: fetchError } = await supabase
    .from('integrations')
    .select('user_id, provider')
    .in('provider', calendarProviders)

  if (fetchError) {
    const msg = `Failed to fetch integrations: ${fetchError.message}`
    result.errors.push(msg)
    result.errorCount++
    console.error(JSON.stringify({ event: 'calendar.sync.db_error', error: fetchError.message }))
    return result
  }

  if (!connections || connections.length === 0) {
    console.log(JSON.stringify({ event: 'calendar.sync.complete', ...result, skipped: 'no_connections' }))
    return result
  }

  // Process each user × provider connection independently
  for (const connection of connections) {
    const { user_id: userId, provider: integrationProvider } = connection
    const calendarProvider = INTEGRATION_TO_CALENDAR_PROVIDER[integrationProvider]

    if (!calendarProvider) {
      // Should never happen given our .in() filter, but guard it
      continue
    }

    result.usersProcessed++
    // Mark the run timestamp BEFORE fetching; rows with synced_at < runAt after
    // upsert will be cancelled events that no longer appear in the provider window.
    const runAt = new Date().toISOString()

    try {
      const events = await fetchUpcomingEvents(userId, calendarProvider)

      if (events.length > 0) {
        const rows = events.map((e) => ({
          user_id: userId,
          provider: calendarProvider,
          event_id: e.eventId,
          title: e.title,
          start_at: e.startAt.toISOString(),
          end_at: e.endAt?.toISOString() ?? null,
          // Cast attendees to Json: CalendarAttendee[] is structurally Json-compatible
          // but TypeScript can't verify the index signature without an explicit cast.
          attendees: e.attendees as unknown as Json,
          location: e.location,
          description: e.description,
          is_all_day: e.isAllDay,
          synced_at: runAt,
        }))

        const { error: upsertError } = await supabase
          .from('calendar_events')
          .upsert(rows, {
            onConflict: 'user_id,provider,event_id',
            ignoreDuplicates: false,
          })

        if (upsertError) {
          const msg = `Upsert failed for user ${userId} / ${calendarProvider}: ${upsertError.message}`
          result.errors.push(msg)
          result.errorCount++
          console.error(JSON.stringify({ event: 'calendar.sync.upsert_error', userId, calendarProvider, error: upsertError.message }))
          continue
        }

        result.eventsUpserted += rows.length
      }

      // Remove cancelled events: delete rows in this user+provider scope
      // whose synced_at was not updated in this run (i.e., provider no longer
      // returns them within the sync window).
      const { error: deleteError } = await supabase
        .from('calendar_events')
        .delete()
        .eq('user_id', userId)
        .eq('provider', calendarProvider)
        .lt('synced_at', runAt)

      if (deleteError) {
        // Non-fatal: stale rows left behind are a monitoring concern, not a data-integrity failure
        console.error(
          JSON.stringify({
            event: 'calendar.sync.delete_stale_error',
            userId,
            calendarProvider,
            error: deleteError.message,
          }),
        )
      }

      console.log(
        JSON.stringify({
          event: 'calendar.sync.user_done',
          userId,
          calendarProvider,
          eventsFetched: events.length,
        }),
      )
    } catch (err) {
      const msg = `Unexpected error for user ${userId} / ${calendarProvider}: ${String(err)}`
      result.errors.push(msg)
      result.errorCount++
      console.error(
        JSON.stringify({
          event: 'calendar.sync.unexpected_error',
          userId,
          calendarProvider,
          error: String(err),
        }),
      )
    }
  }

  console.log(JSON.stringify({ event: 'calendar.sync.complete', ...result }))
  return result
}
