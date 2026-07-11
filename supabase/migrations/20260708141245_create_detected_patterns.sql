-- Migration: create detected_patterns table
-- Wave 7.1.1 — Pattern Detection
-- Stores per-user detected behavioral patterns with frequency-cap support.
-- Idempotent: safe to apply multiple times.

CREATE TABLE IF NOT EXISTS public.detected_patterns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type     text        NOT NULL,
  description      text        NOT NULL,
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient per-user active-pattern queries (used by cron and API)
CREATE INDEX IF NOT EXISTS detected_patterns_user_type_active_idx
  ON public.detected_patterns (user_id, pattern_type, is_active);

-- Unique constraint for idempotent upsert on (user_id, pattern_type)
ALTER TABLE public.detected_patterns
  DROP CONSTRAINT IF EXISTS detected_patterns_user_id_pattern_type_key;

ALTER TABLE public.detected_patterns
  ADD CONSTRAINT detected_patterns_user_id_pattern_type_key
  UNIQUE (user_id, pattern_type);

-- Enable RLS
ALTER TABLE public.detected_patterns ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies for idempotency
DROP POLICY IF EXISTS "detected_patterns: user owns rows" ON public.detected_patterns;

CREATE POLICY "detected_patterns: user owns rows"
  ON public.detected_patterns
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Grant table access to authenticated users (RLS enforces row isolation)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.detected_patterns
  TO authenticated;

-- Service role has unrestricted access (bypasses RLS) — used by cron
GRANT ALL
  ON public.detected_patterns
  TO service_role;

-- Seed detect_patterns into tool_permissions for all existing users
-- Uses ON CONFLICT DO NOTHING for idempotency
INSERT INTO public.tool_permissions (user_id, tool_name, enabled)
SELECT id, 'detect_patterns', true
FROM auth.users
ON CONFLICT (user_id, tool_name) DO NOTHING;
