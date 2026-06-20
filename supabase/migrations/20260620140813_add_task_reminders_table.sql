-- task_reminders: replaces both the old reminders table and the reminder columns
-- that were added to tasks. Handles all three possible DB states cleanly.

CREATE TABLE task_reminders (
  id                uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid            NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id           uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remind_at         timestamptz     NOT NULL,
  recurrence_type   recurrence_type NOT NULL DEFAULT 'none',
  recurrence_end_at timestamptz,
  snoozed_until     timestamptz,
  last_fired_at     timestamptz,
  created_at        timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX task_reminders_task_id_idx ON task_reminders(task_id);
CREATE INDEX task_reminders_remind_at_idx ON task_reminders(remind_at)
  WHERE snoozed_until IS NULL;

ALTER TABLE task_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage own task_reminders"
  ON task_reminders FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT ALL ON TABLE task_reminders TO anon, authenticated, service_role;

-- Migrate data from old standalone reminders table (task-linked only)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reminders'
  ) THEN
    INSERT INTO task_reminders (task_id, user_id, remind_at, recurrence_type, recurrence_end_at, snoozed_until, last_fired_at)
    SELECT task_id, user_id, remind_at, recurrence_type, recurrence_end_at, snoozed_until, last_fired_at
    FROM reminders
    WHERE task_id IS NOT NULL;

    DROP TABLE reminders;
  END IF;
END $$;

-- Migrate from tasks.remind_at if those columns exist (from earlier merge migration)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'remind_at'
  ) THEN
    INSERT INTO task_reminders (task_id, user_id, remind_at, recurrence_type, recurrence_end_at, snoozed_until, last_fired_at)
    SELECT id, user_id, remind_at, recurrence_type, recurrence_end_at, snoozed_until, last_fired_at
    FROM tasks
    WHERE remind_at IS NOT NULL;

    DROP INDEX IF EXISTS tasks_remind_at_idx;

    ALTER TABLE tasks
      DROP COLUMN IF EXISTS remind_at,
      DROP COLUMN IF EXISTS recurrence_type,
      DROP COLUMN IF EXISTS recurrence_end_at,
      DROP COLUMN IF EXISTS snoozed_until,
      DROP COLUMN IF EXISTS last_fired_at;
  END IF;
END $$;