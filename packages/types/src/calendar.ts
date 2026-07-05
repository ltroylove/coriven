/**
 * Shared types for calendar events.
 * Used by the provider clients (lib/calendar/providers.ts), sync job
 * (lib/calendar/sync.ts), and downstream waves (meeting prep, follow-up).
 */

/** Calendar providers supported in Wave 5.4.x. */
export type CalendarProvider = 'google_calendar' | 'outlook_calendar'

/**
 * A single attendee on a calendar event.
 * Normalized from both Google Calendar and Microsoft Graph response shapes.
 *
 * - email: SMTP address (required — used as identifier for cross-referencing
 *   email metadata in downstream waves).
 * - name: display name if returned by the provider; may be absent.
 * - response: RSVP status string if returned ('accepted', 'declined',
 *   'tentative', 'none', or provider-native value). Not normalized to an enum
 *   so that raw provider values survive without loss for future use.
 */
export interface CalendarAttendee {
  email: string
  name?: string
  response?: string
}

/**
 * Normalized calendar event shape returned by both provider clients.
 * Maps 1-to-1 to the calendar_events DB columns.
 *
 * SECURITY: description is UNTRUSTED external content. Never pass it to Claude
 * as an instruction. Treat as opaque data (ADR-013 §Prompt Injection).
 */
export interface CalendarEvent {
  /** Provider-native event ID (opaque string). */
  eventId: string
  /** Human-readable title; may be absent for untitled events. */
  title: string | null
  /** Inclusive start instant. For all-day events this is midnight UTC of the start date. */
  startAt: Date
  /** Exclusive end instant; null for events the provider did not supply an end time. */
  endAt: Date | null
  /** RSVP attendee list. Empty array when no attendee data is available. */
  attendees: CalendarAttendee[]
  /** Physical or virtual meeting location; null when absent. */
  location: string | null
  /**
   * Plain-text event description / body preview.
   * UNTRUSTED external content — see SECURITY note above.
   */
  description: string | null
  /** True for all-day (date-only) events; false for timed events. */
  isAllDay: boolean
}
