ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS briefing_time text NOT NULL DEFAULT '07:00';
