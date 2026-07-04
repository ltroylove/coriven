-- =============================================================================
-- Calendar Events Schema
-- Adds: calendar_events table
-- Depends on: 20260705000000_add_integrations.sql (integration_provider enum)
-- References: ADR-013 (Integration Token Authority), Wave 5.4.1
--
-- SECURITY NOTE — description column:
--   calendar event descriptions are UNTRUSTED external content (prompt-injection surface).
--   Consumers (meeting prep, briefing, AI summarization) must treat this column as
--   opaque data only — never pass its contents to Claude as instructions.
--   See ADR-013 §Prompt Injection and blueprint §9.3.
--
-- RLS summary:
--   calendar_events: authenticated users SELECT own rows only (auth.uid() = user_id);
--                    INSERT/UPDATE/DELETE reserved for service role (cron sync).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- calendar_events — per-user upcoming calendar events from connected providers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which calendar provider this event came from.
  -- Stored as text (not the enum) for forward-compat with future providers
  -- (mirrors the pattern used in approval_queue.provider — ADR-013 §Layer 3).
  -- Known values: 'google_calendar', 'outlook_calendar'
  provider    text        NOT NULL,

  -- Provider-native event identifier (opaque string; do not parse).
  event_id    text        NOT NULL,

  title       text,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz,

  -- Attendee list as JSON array of {email, name?, response?} objects.
  -- Shape is normalized from both Google Calendar and Microsoft Graph formats
  -- by the provider client layer (apps/web/src/lib/calendar/providers.ts).
  attendees   jsonb       NOT NULL DEFAULT '[]',

  location    text,

  -- UNTRUSTED CONTENT — see header note. Treat as data, never as instructions.
  description text,

  is_all_day  boolean     NOT NULL DEFAULT false,

  -- Timestamp of last successful sync that wrote this row.
  -- Rows whose synced_at is older than the sync window after a fresh run
  -- indicate events that were cancelled/removed from the provider.
  synced_at   timestamptz NOT NULL DEFAULT now(),

  -- One row per user × provider × event — upserts on this key update in place.
  UNIQUE (user_id, provider, event_id)
);

-- Efficient time-window queries (primary access pattern for meeting prep)
CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx
  ON calendar_events (user_id, start_at);

-- Optional: provider-scoped lookups used during sync reconciliation
CREATE INDEX IF NOT EXISTS calendar_events_user_provider_idx
  ON calendar_events (user_id, provider);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read only their own events.
DO $$ BEGIN
  CREATE POLICY "users can read own calendar events"
    ON calendar_events FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role (cron sync) handles all writes.
-- No INSERT / UPDATE / DELETE policy for authenticated users — the sync job
-- runs under service_role which bypasses RLS.

GRANT SELECT ON TABLE calendar_events TO authenticated;
GRANT ALL    ON TABLE calendar_events TO service_role;
