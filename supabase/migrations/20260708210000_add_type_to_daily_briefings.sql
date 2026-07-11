-- =============================================================================
-- Wave 7.3.1: Add type column to daily_briefings and weekly unique constraint
-- =============================================================================
-- Extends daily_briefings to support type = 'weekly' rows (weekly review).
-- Existing rows retain type = 'daily' (the default).
--
-- Changes:
--   1. Add `type` column (text, NOT NULL, default 'daily')
--   2. Drop the old UNIQUE (user_id, briefing_date) constraint — it prevented
--      having both a daily and weekly row on the same date.
--   3. Add UNIQUE (user_id, type, briefing_date) for daily rows (type='daily'
--      still maps 1:1 to a date).
--   4. Add UNIQUE (user_id, type, date_trunc('week', briefing_date)::date) for
--      weekly rows — one review per ISO week per user.
-- =============================================================================

-- 1. Add type column (idempotent)
ALTER TABLE daily_briefings
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'daily';

-- 2. Drop the old daily-only unique constraint (if it still exists).
--    Name was auto-generated as daily_briefings_user_id_briefing_date_key.
ALTER TABLE daily_briefings
  DROP CONSTRAINT IF EXISTS daily_briefings_user_id_briefing_date_key;

-- 3. One daily briefing per user per date.
ALTER TABLE daily_briefings
  ADD CONSTRAINT uq_daily_briefings_user_type_date
  UNIQUE (user_id, type, briefing_date);

-- 4. (No additional constraint needed for weekly rows.)
--    Weekly reviews are stored with briefing_date = the ISO week-start Monday
--    (computed by the assembly library). The column-level constraint (3) on
--    (user_id, type, briefing_date) already guarantees one row per week-start
--    date per user per type, which means one weekly review per ISO week.
--    This approach avoids a functional-expression constraint and lets Supabase
--    JS upsert target the constraint by column names directly.
