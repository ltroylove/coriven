-- =============================================================================
-- Email Metadata Schema
-- Adds: email_urgency enum, email_category enum, email_metadata table
-- Depends on: 20260705000000_add_integrations.sql (integrations table + integration_provider enum)
-- References: ADR-013 (Integration Token Authority), Wave 5.2.1 spec
--
-- DESIGN NOTES:
--   - NO body column is present or will ever be added — email bodies are fetched
--     on demand only and never persisted (zero-trust, privacy-first).
--   - UNIQUE(user_id, provider, message_id) enforces idempotent upserts from the
--     cron poll route — re-polling the same message produces exactly one row.
--   - RLS allows users to read/manage their own rows only; the cron path uses the
--     service-role client to write across all users.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE email_urgency AS ENUM ('critical', 'high', 'normal', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE email_category AS ENUM (
    'important',
    'action_required',
    'informational',
    'promotional',
    'spam'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- email_metadata — one row per message per user per provider
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_metadata (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider that owns this message; mirrors integration_provider enum values
  -- Stored as text for forward-compat (ADR-013 §Layer 3)
  provider     text          NOT NULL,

  -- Provider-native message identifier (Gmail message ID or Graph message id)
  message_id   text          NOT NULL,

  -- Provider-native thread/conversation identifier (nullable — not all providers surface it)
  thread_id    text,

  from_address text,
  subject      text,
  received_at  timestamptz,

  urgency      email_urgency NOT NULL DEFAULT 'normal',
  category     email_category,

  -- One-line AI-generated summary from Haiku triage (headers only — no body content)
  ai_summary   text,

  is_read      boolean       NOT NULL DEFAULT false,
  created_at   timestamptz   NOT NULL DEFAULT now(),

  -- Idempotency constraint: same message from same provider for same user → one row
  CONSTRAINT email_metadata_user_provider_message_unique
    UNIQUE (user_id, provider, message_id)
);

-- Primary query pattern: user's messages ordered by receipt time
CREATE INDEX IF NOT EXISTS email_metadata_user_received_idx
  ON email_metadata (user_id, received_at DESC);

-- Secondary query pattern: filter by urgency for briefing and alerting
CREATE INDEX IF NOT EXISTS email_metadata_user_urgency_idx
  ON email_metadata (user_id, urgency);


-- ---------------------------------------------------------------------------
-- RLS — users may only see and manage their own email metadata rows.
-- The cron poll path writes via the service-role client and bypasses RLS.
-- ---------------------------------------------------------------------------

ALTER TABLE email_metadata ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "email_metadata: users select own rows"
    ON email_metadata FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "email_metadata: users insert own rows"
    ON email_metadata FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "email_metadata: users update own rows"
    ON email_metadata FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "email_metadata: users delete own rows"
    ON email_metadata FOR DELETE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_metadata TO authenticated;
GRANT ALL ON TABLE email_metadata TO service_role;


-- ---------------------------------------------------------------------------
-- Default tool_permissions for existing users (get_email_thread)
-- ---------------------------------------------------------------------------

INSERT INTO tool_permissions (user_id, tool_name, enabled)
SELECT id, 'get_email_thread', true
FROM auth.users
ON CONFLICT (user_id, tool_name) DO NOTHING;
