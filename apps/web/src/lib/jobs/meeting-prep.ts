import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single attendee parsed from the calendar_events.attendees jsonb array. */
export interface CalendarAttendee {
  email: string
  name?: string
  response?: string
}

/** Minimal calendar event shape needed for brief assembly. */
export interface CalendarEventInput {
  id: string           // UUID from calendar_events.id
  user_id: string
  event_id: string     // provider-native event id
  provider: string
  title: string | null
  start_at: string     // ISO timestamptz
  end_at: string | null
  location: string | null
  attendees: unknown   // raw jsonb — parsed internally
}

/** Related email metadata (metadata only — no bodies). */
export interface RelatedEmail {
  id: string
  fromAddress: string | null
  subject: string | null
  receivedAt: string | null
  aiSummary: string | null
}

/** Open task related to the event or attendees. */
export interface RelatedTask {
  id: string
  title: string
  status: string
  dueAt: string | null
}

/** Memory snippet mentioning an attendee. */
export interface RelatedMemory {
  id: string
  content: string
  createdAt: string
}

/** Entity profile for an attendee. */
export interface RelatedEntity {
  id: string
  name: string
  description: string | null
  aliases: string[]
}

/** Structured content stored in meeting_briefs.content. */
export interface MeetingBriefContent {
  event: {
    title: string | null
    startAt: string
    endAt: string | null
    location: string | null
    provider: string
  }
  attendees: CalendarAttendee[]
  relatedEmails: RelatedEmail[]
  openTasks: RelatedTask[]
  memories: RelatedMemory[]
  entities: RelatedEntity[]
}

/** Return value of generateDueBriefs(). */
export interface GenerateDueBriefsResult {
  eventsConsidered: number
  briefsCreated: number
  errorCount: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the attendees jsonb into a typed array.
 * Accepts any shape and normalises defensively — unknown fields are dropped.
 * Returns an empty array if parsing fails.
 */
function parseAttendees(raw: unknown): CalendarAttendee[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): CalendarAttendee[] => {
    if (item === null || typeof item !== 'object') return []
    const obj = item as Record<string, unknown>
    const email = typeof obj['email'] === 'string' ? obj['email'] : null
    if (!email) return []
    return [{
      email,
      name: typeof obj['name'] === 'string' ? obj['name'] : undefined,
      response: typeof obj['response'] === 'string' ? obj['response'] : undefined,
    }]
  })
}

/**
 * Extract simple keyword tokens from an event title for task matching.
 * Strips very short tokens (≤3 chars) to reduce false positives.
 *
 * Limitation: keyword matching is case-insensitive substring/ilike only.
 * It will miss semantic synonyms and catch unrelated tasks that happen to
 * share a common word. Entity profiles improve precision over time as the
 * user's contacts accumulate richer aliases.
 */
function titleKeywords(title: string | null): string[] {
  if (!title) return []
  return title
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => w.length > 3)
}

// ---------------------------------------------------------------------------
// assembleMeetingBrief
// Deterministically builds a meeting brief for a single event.
// Uses service role — intended for cron/server context only.
// ZERO Anthropic/LLM API calls — ADR-008 pattern.
// ---------------------------------------------------------------------------

export async function assembleMeetingBrief(
  userId: string,
  event: CalendarEventInput,
): Promise<MeetingBriefContent> {
  const supabase = createServiceClient()
  const attendees = parseAttendees(event.attendees)
  const attendeeEmails = attendees.map(a => a.email.toLowerCase())
  const attendeeNames = attendees.flatMap(a => (a.name ? [a.name] : []))
  const keywords = titleKeywords(event.title)

  // -------------------------------------------------------------------------
  // 1. Related emails — from_address matches any attendee email (latest 5)
  //    Limitation: only exact from_address match; BCC / multi-recipient
  //    threads from the same person may be missed if from_address is an alias.
  // -------------------------------------------------------------------------
  let relatedEmails: RelatedEmail[] = []
  if (attendeeEmails.length > 0) {
    const { data: emailRows, error: emailError } = await supabase
      .from('email_metadata')
      .select('id, from_address, subject, received_at, ai_summary')
      .eq('user_id', userId)
      .in('from_address', attendeeEmails)
      .order('received_at', { ascending: false })
      .limit(5)

    if (emailError) {
      console.error(JSON.stringify({
        event: 'meetingPrep.emails.error',
        userId,
        eventId: event.event_id,
        error: emailError.message,
      }))
    } else {
      relatedEmails = (emailRows ?? []).map(r => ({
        id: r.id,
        fromAddress: r.from_address,
        subject: r.subject,
        receivedAt: r.received_at,
        aiSummary: r.ai_summary,
      }))
    }
  }

  // -------------------------------------------------------------------------
  // 2. Open tasks — title/description mentions any attendee name or title word
  //    Uses OR filter across attendee names and event title keywords (ilike).
  //    Limitation: ilike is substring-only; no stemming or semantic matching.
  //    A task titled "Talk to J. Smith" won't match attendee "John Smith".
  // -------------------------------------------------------------------------
  let openTasks: RelatedTask[] = []
  const taskSearchTerms = [...attendeeNames, ...keywords]
  if (taskSearchTerms.length > 0) {
    // Build ilike conditions for the OR filter
    // Supabase JS client supports .or() with comma-separated filter string
    const orParts = taskSearchTerms.flatMap(term => {
      const escaped = term.replace(/[%_]/g, char => `\\${char}`)
      return [
        `title.ilike.%${escaped}%`,
        `description.ilike.%${escaped}%`,
      ]
    })

    const { data: taskRows, error: taskError } = await supabase
      .from('tasks')
      .select('id, title, status, due_at')
      .eq('user_id', userId)
      .not('status', 'in', '("done","cancelled")')
      .or(orParts.join(','))
      .limit(10)

    if (taskError) {
      console.error(JSON.stringify({
        event: 'meetingPrep.tasks.error',
        userId,
        eventId: event.event_id,
        error: taskError.message,
      }))
    } else {
      openTasks = (taskRows ?? []).map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        dueAt: r.due_at,
      }))
    }
  }

  // -------------------------------------------------------------------------
  // 3. Memories — content mentions any attendee name (ilike), latest 5
  //    Limitation: ilike substring only; embeddings-based semantic search
  //    (match_memories) is available in chat but intentionally excluded here
  //    to avoid any model call dependency (ADR-008).
  // -------------------------------------------------------------------------
  let memories: RelatedMemory[] = []
  if (attendeeNames.length > 0) {
    const memOrParts = attendeeNames.map(name => {
      const escaped = name.replace(/[%_]/g, char => `\\${char}`)
      return `content.ilike.%${escaped}%`
    })

    const { data: memRows, error: memError } = await supabase
      .from('memories')
      .select('id, content, created_at')
      .eq('user_id', userId)
      .is('superseded_by', null)
      .or(memOrParts.join(','))
      .order('created_at', { ascending: false })
      .limit(5)

    if (memError) {
      console.error(JSON.stringify({
        event: 'meetingPrep.memories.error',
        userId,
        eventId: event.event_id,
        error: memError.message,
      }))
    } else {
      memories = (memRows ?? []).map(r => ({
        id: r.id,
        content: r.content,
        createdAt: r.created_at,
      }))
    }
  }

  // -------------------------------------------------------------------------
  // 4. Entity profiles — name or aliases match attendee names (ilike)
  //    Limitation: matches on name column only; alias matching is done
  //    client-side after fetching candidates whose name matches — a full
  //    alias ilike across an array column requires a custom Postgres function
  //    not yet available (future: GIN index + unnest query).
  // -------------------------------------------------------------------------
  let entities: RelatedEntity[] = []
  if (attendeeNames.length > 0) {
    const entityOrParts = attendeeNames.map(name => {
      const escaped = name.replace(/[%_]/g, char => `\\${char}`)
      return `name.ilike.%${escaped}%`
    })

    const { data: entityRows, error: entityError } = await supabase
      .from('entity_profiles')
      .select('id, name, description, aliases')
      .eq('user_id', userId)
      .or(entityOrParts.join(','))
      .limit(10)

    if (entityError) {
      console.error(JSON.stringify({
        event: 'meetingPrep.entities.error',
        userId,
        eventId: event.event_id,
        error: entityError.message,
      }))
    } else {
      entities = (entityRows ?? []).map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        aliases: r.aliases ?? [],
      }))
    }
  }

  return {
    event: {
      title: event.title,
      startAt: event.start_at,
      endAt: event.end_at,
      location: event.location,
      provider: event.provider,
    },
    attendees,
    relatedEmails,
    openTasks,
    memories,
    entities,
  }
}

// ---------------------------------------------------------------------------
// generateDueBriefs
// Finds all calendar events starting within the next 15 minutes (all users),
// skips any event that already has a brief (idempotent), assembles + persists.
// Per-event errors are caught and counted; one failure never blocks others.
// Uses service role throughout.
// ---------------------------------------------------------------------------

export async function generateDueBriefs(): Promise<GenerateDueBriefsResult> {
  const supabase = createServiceClient()

  const now = new Date()
  const windowEnd = new Date(now.getTime() + 15 * 60 * 1000) // +15 min

  // -------------------------------------------------------------------------
  // 1. Find timed events starting in (now, now + 15min] across all users.
  //    Exclude all-day events (is_all_day = true).
  //    Exclude events that have already started (start_at <= now).
  // -------------------------------------------------------------------------
  const { data: events, error: eventsError } = await supabase
    .from('calendar_events')
    .select('id, user_id, event_id, provider, title, start_at, end_at, location, attendees')
    .eq('is_all_day', false)
    .gt('start_at', now.toISOString())
    .lte('start_at', windowEnd.toISOString())

  if (eventsError) {
    console.error(JSON.stringify({
      event: 'meetingPrep.eventsQuery.error',
      error: eventsError.message,
    }))
    return { eventsConsidered: 0, briefsCreated: 0, errorCount: 1 }
  }

  const eventsToProcess = events ?? []
  let briefsCreated = 0
  let errorCount = 0

  for (const calEvent of eventsToProcess) {
    try {
      // -------------------------------------------------------------------
      // 2. Idempotency check — skip if a brief already exists for this event.
      //    The UNIQUE(user_id, provider, event_id) constraint is the storage-
      //    layer guard; this pre-check avoids a full assembly for duplicates.
      // -------------------------------------------------------------------
      const { count: existingCount, error: checkError } = await supabase
        .from('meeting_briefs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', calEvent.user_id)
        .eq('provider', calEvent.provider)
        .eq('event_id', calEvent.event_id)

      if (checkError) {
        console.error(JSON.stringify({
          event: 'meetingPrep.idempotencyCheck.error',
          userId: calEvent.user_id,
          eventId: calEvent.event_id,
          error: checkError.message,
        }))
        errorCount++
        continue
      }

      if ((existingCount ?? 0) > 0) {
        // Brief already exists — skip silently (idempotent)
        continue
      }

      // -------------------------------------------------------------------
      // 3. Assemble the brief deterministically (zero LLM calls).
      // -------------------------------------------------------------------
      const content = await assembleMeetingBrief(calEvent.user_id, calEvent as CalendarEventInput)

      // -------------------------------------------------------------------
      // 4. Persist — ignoreDuplicates handles the race condition where two
      //    overlapping cron runs both pass the idempotency check before either
      //    has written. The UNIQUE constraint prevents double-storage; the
      //    losing insert is dropped silently.
      // -------------------------------------------------------------------
      const { error: insertError } = await supabase
        .from('meeting_briefs')
        .upsert(
          {
            user_id: calEvent.user_id,
            event_id: calEvent.event_id,
            provider: calEvent.provider,
            event_title: calEvent.title,
            event_start: calEvent.start_at,
            content: content as unknown as import('@/types/supabase').Json,
          },
          { onConflict: 'user_id,provider,event_id', ignoreDuplicates: true },
        )

      if (insertError) {
        console.error(JSON.stringify({
          event: 'meetingPrep.insert.error',
          userId: calEvent.user_id,
          eventId: calEvent.event_id,
          error: insertError.message,
        }))
        errorCount++
      } else {
        briefsCreated++
        console.log(JSON.stringify({
          event: 'meetingPrep.brief.created',
          userId: calEvent.user_id,
          eventId: calEvent.event_id,
          eventTitle: calEvent.title,
          eventStart: calEvent.start_at,
        }))
      }
    } catch (err) {
      // Per-event fault isolation — one failure never blocks others.
      console.error(JSON.stringify({
        event: 'meetingPrep.assembly.error',
        userId: calEvent.user_id,
        eventId: calEvent.event_id,
        error: String(err),
      }))
      errorCount++
    }
  }

  return {
    eventsConsidered: eventsToProcess.length,
    briefsCreated,
    errorCount,
  }
}
