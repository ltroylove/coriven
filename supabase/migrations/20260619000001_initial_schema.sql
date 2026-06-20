-- =============================================================================
-- Personal Assistant Database Schema
-- Supabase (PostgreSQL) — Full DDL: Enums, Tables, Indexes, RLS Policies
-- =============================================================================
-- Run in Supabase SQL Editor or via: supabase db push
-- Requires: pgcrypto extension (enabled by default in Supabase)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE recurrence_type AS ENUM ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly');
CREATE TYPE message_role AS ENUM ('user', 'assistant');


-- =============================================================================
-- TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users (Supabase Auth manages the auth row)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS 'Public-facing user profile data, extending Supabase auth.users.';


-- ---------------------------------------------------------------------------
-- tasks — core task entity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text          NOT NULL,
  description  text,
  status       task_status   NOT NULL DEFAULT 'pending',
  priority     task_priority NOT NULL DEFAULT 'medium',
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE tasks IS 'User tasks with status, priority, and optional due dates.';

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx  ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx  ON tasks (user_id, due_at) WHERE due_at IS NOT NULL;


-- ---------------------------------------------------------------------------
-- reminders — independent of tasks, supports recurrence + snooze
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reminders (
  id                uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id           uuid            REFERENCES tasks(id) ON DELETE SET NULL,
  message           text            NOT NULL,
  remind_at         timestamptz     NOT NULL,
  fired             boolean         NOT NULL DEFAULT false,
  snoozed_until     timestamptz,
  recurrence_type   recurrence_type NOT NULL DEFAULT 'none',
  recurrence_end_at timestamptz,
  last_fired_at     timestamptz,
  created_at        timestamptz     NOT NULL DEFAULT now()
);

COMMENT ON TABLE reminders IS 'Reminders with optional task link, recurrence, and snooze support.';

CREATE INDEX IF NOT EXISTS reminders_user_id_idx   ON reminders (user_id);
CREATE INDEX IF NOT EXISTS reminders_remind_at_idx ON reminders (user_id, remind_at) WHERE fired = false;


-- ---------------------------------------------------------------------------
-- tool_permissions — per-user opt-in for each Claude tool
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tool_permissions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name  text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool_name)
);

COMMENT ON TABLE tool_permissions IS 'Per-user opt-in for each Claude AI tool. Claude only sees enabled tools.';

CREATE INDEX IF NOT EXISTS tool_permissions_user_id_idx ON tool_permissions (user_id);


-- ---------------------------------------------------------------------------
-- conversation_messages — chat history including tool call records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_messages (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       message_role NOT NULL,
  content    text         NOT NULL,
  tool_calls jsonb,
  created_at timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversation_messages IS 'Chat history between user and Claude, including tool call records.';

CREATE INDEX IF NOT EXISTS conversation_messages_user_id_idx ON conversation_messages (user_id, created_at DESC);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own reminders"
  ON reminders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reminders"
  ON reminders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reminders"
  ON reminders FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reminders"
  ON reminders FOR DELETE
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- tool_permissions
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own tool permissions"
  ON tool_permissions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own tool permissions"
  ON tool_permissions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- conversation_messages
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own messages"
  ON conversation_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
  ON conversation_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages"
  ON conversation_messages FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Auto-update updated_at on tasks
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
