-- =============================================================================
-- Integrations Schema
-- Adds: integration_provider enum, integrations table
-- Depends on: update_updated_at_column() from 20260629230000_memory_schema.sql
-- NOTE: No raw token columns — connection references only (ADR-013).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE integration_provider AS ENUM (
    'gmail',
    'outlook',
    'google_calendar',
    'outlook_calendar'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- integrations — per-user/provider connection references (no raw tokens)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS integrations (
  id                   uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid                 NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider             integration_provider NOT NULL,
  nango_connection_id  text                 NOT NULL,
  scopes               text[]               NOT NULL DEFAULT '{}',
  connected_at         timestamptz          NOT NULL DEFAULT now(),
  updated_at           timestamptz          NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON integrations (user_id);


-- ---------------------------------------------------------------------------
-- updated_at trigger (reuse function from 20260629230000_memory_schema.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER update_integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can manage own integrations"
    ON integrations FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON TABLE integrations TO anon, authenticated, service_role;
