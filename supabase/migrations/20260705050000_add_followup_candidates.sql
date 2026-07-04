-- =============================================================================
-- Follow-Up Candidates Schema
-- Adds: followup_candidates table
-- Depends on: 20260705020000_add_email_metadata.sql (email_metadata table)
-- References: Wave 5.4.3 spec
--
-- DESIGN NOTES:
--   - One row per (user, provider, thread_id) — the unique key enforces idempotent
--     upserts from the nightly detection job.
--   - dismissed / cleared_at are orthogonal: a user dismisses manually, the job
--     sets cleared_at when a reply arrives. Both suppress display.
--   - RLS: authenticated users can SELECT and UPDATE (dismiss) their own rows;
--     the service-role client (cron) performs INSERT/UPDATE without RLS.
--   - No message bodies are stored here — zero-trust spine.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- followup_candidates — one row per (user, provider, thread)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS followup_candidates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider that owns this thread; mirrors email_metadata.provider values
  provider              text        NOT NULL,

  -- Provider-native thread/conversation identifier
  thread_id             text        NOT NULL,

  -- Message ID of the last message the user sent on this thread
  last_sent_message_id  text,

  -- Thread subject (denormalised from email_metadata for cheap display)
  subject               text,

  -- Recipient address of the last outbound message (display only)
  to_address            text,

  -- When the user last sent on this thread (used for "days waiting" display)
  last_sent_at          timestamptz NOT NULL,

  -- When this candidate was first detected
  detected_at           timestamptz NOT NULL DEFAULT now(),

  -- User-initiated dismissal — dismissed threads are never re-flagged on
  -- subsequent runs (the unique key prevents re-insert; upsert does nothing)
  dismissed             boolean     NOT NULL DEFAULT false,

  -- Set by the detection job when a reply arrives after last_sent_at.
  -- Cleared candidates are hidden from the UI but not deleted (audit trail).
  cleared_at            timestamptz,

  -- Idempotency: same thread from same provider for same user → one row.
  -- On re-detection of an already-flagged thread the upsert is a no-op.
  CONSTRAINT followup_candidates_user_provider_thread_unique
    UNIQUE (user_id, provider, thread_id)
);

-- Primary display query: undismissed, uncleared candidates, oldest first
CREATE INDEX IF NOT EXISTS followup_candidates_user_active_idx
  ON followup_candidates (user_id, dismissed, last_sent_at)
  WHERE cleared_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS — users may read and update (dismiss) their own rows.
-- The nightly cron writes via the service-role client (bypasses RLS).
-- ---------------------------------------------------------------------------

ALTER TABLE followup_candidates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "followup_candidates: users select own rows"
    ON followup_candidates FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "followup_candidates: users update own rows"
    ON followup_candidates FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, UPDATE ON TABLE followup_candidates TO authenticated;
GRANT ALL ON TABLE followup_candidates TO service_role;
