-- =============================================================================
-- Meeting Briefs Schema
-- Adds: meeting_briefs table
-- Depends on: 20260705030000_add_calendar_events.sql
-- References: ADR-008 (Deterministic Assembly), Wave 5.4.2
--
-- SECURITY NOTE — content column:
--   The `content` jsonb stores data assembled from external sources (email
--   subjects, calendar titles, attendee names). Consumers must render this as
--   plain text data only — never pass to Claude as instructions.
--   See ADR-013 §Prompt Injection and ADR-008.
--
-- Design decisions:
--   - UNIQUE(user_id, provider, event_id) — idempotency at the storage layer;
--     a second insert for the same event conflicts harmlessly (ignoreDuplicates).
--   - event_id + provider are TEXT (not FK to calendar_events.id) so briefs
--     survive a calendar re-sync that replaces the calendar_events row.
--   - delivered_at tracks in-app delivery; null = not yet delivered.
--
-- RLS summary:
--   meeting_briefs: authenticated users SELECT own rows only;
--                   INSERT/UPDATE reserved for service role (cron job).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- meeting_briefs — one brief per calendar event per user
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meeting_briefs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider-native event identifiers (mirror calendar_events columns so
  -- briefs survive calendar re-sync without a FK dependency).
  event_id    text        NOT NULL,
  provider    text        NOT NULL,

  -- Denormalised display fields — copied from calendar_events at assembly time.
  event_title text,
  event_start timestamptz NOT NULL,

  -- Structured brief: { event, attendees, relatedEmails, openTasks,
  --                     memories, entities }  — all arrays, never undefined.
  -- UNTRUSTED CONTENT — render as plain text data only.
  content     jsonb       NOT NULL,

  -- In-app delivery tracking.
  delivered_at timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),

  -- One brief per user × provider × event — idempotency guard.
  UNIQUE (user_id, provider, event_id)
);

-- Primary access pattern: briefs for a user in a time window (e.g. next 2h).
CREATE INDEX IF NOT EXISTS meeting_briefs_user_event_start_idx
  ON meeting_briefs (user_id, event_start DESC);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE meeting_briefs ENABLE ROW LEVEL SECURITY;

-- Authenticated users read only their own briefs.
DO $$ BEGIN
  CREATE POLICY "users can read own meeting briefs"
    ON meeting_briefs FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role (cron) handles all writes — no INSERT/UPDATE policy for
-- authenticated users; service_role bypasses RLS.

GRANT SELECT ON TABLE meeting_briefs TO authenticated;
GRANT ALL    ON TABLE meeting_briefs TO service_role;
