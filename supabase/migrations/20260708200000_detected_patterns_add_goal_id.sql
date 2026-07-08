-- Migration: add goal_id to detected_patterns; update unique constraint for per-goal rows
-- Wave 7.2.1 — Stale-Goal Nudges
--
-- The original unique constraint (user_id, pattern_type) allowed only one row per pattern
-- type per user. Stale-goal nudges require one row per stale goal so that each goal can
-- have its own description ("No activity on 'Read 12 books' for 18 days"), frequency cap,
-- and activation state.
--
-- Strategy:
--   • Add nullable goal_id column (NULL for pattern types that are not goal-specific)
--   • Drop the old unique constraint on (user_id, pattern_type)
--   • Add a new partial unique constraint:
--       - For goal-specific rows:   UNIQUE (user_id, pattern_type, goal_id)   WHERE goal_id IS NOT NULL
--       - For non-goal rows:        UNIQUE (user_id, pattern_type)             WHERE goal_id IS NULL
--   This preserves idempotent upsert semantics for both cases.
-- Idempotent: safe to apply multiple times (IF NOT EXISTS / IF EXISTS guards throughout).

-- 1. Add goal_id column (nullable, FK to goals)
ALTER TABLE public.detected_patterns
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE;

-- 2. Drop the old single-column-pair unique constraint (both possible names for safety)
ALTER TABLE public.detected_patterns
  DROP CONSTRAINT IF EXISTS detected_patterns_user_id_pattern_type_key;

-- 3. Partial unique constraint for goal-specific rows (one per goal per pattern type)
DROP INDEX IF EXISTS detected_patterns_user_type_goal_uniq;
CREATE UNIQUE INDEX detected_patterns_user_type_goal_uniq
  ON public.detected_patterns (user_id, pattern_type, goal_id)
  WHERE goal_id IS NOT NULL;

-- 4. Partial unique constraint for non-goal rows (one per pattern type per user)
DROP INDEX IF EXISTS detected_patterns_user_type_null_goal_uniq;
CREATE UNIQUE INDEX detected_patterns_user_type_null_goal_uniq
  ON public.detected_patterns (user_id, pattern_type)
  WHERE goal_id IS NULL;

-- 5. Index for goal_id lookups (used by resumption query in detect-patterns job)
CREATE INDEX IF NOT EXISTS detected_patterns_goal_id_idx
  ON public.detected_patterns (goal_id)
  WHERE goal_id IS NOT NULL;
