-- Add sentinel_mode to profiles
-- Allows per-user toggle between async (default) and sync context-build modes.
-- async: Sentinel fires in background; LLM reads previous-turn Upstash cache.
-- sync:  Sentinel awaits completion before LLM call; context is always current.

ALTER TABLE profiles
  ADD COLUMN sentinel_mode text NOT NULL DEFAULT 'async'
  CONSTRAINT profiles_sentinel_mode_check CHECK (sentinel_mode IN ('async', 'sync'));

COMMENT ON COLUMN profiles.sentinel_mode IS 'Context build mode: async (default, low latency) or sync (always current, slight delay)';
