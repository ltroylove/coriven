-- =============================================================================
-- Goal Hierarchy Schema
-- Adds: life_areas, goals, projects, daily_briefings tables
-- Extends: tasks (project_id, goal_id columns)
-- Depends on: update_updated_at_column() from 20260629230000_memory_schema.sql
-- =============================================================================


-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE goal_status AS ENUM ('active', 'achieved', 'paused', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE goal_confidence AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE goal_momentum AS ENUM ('improving', 'stable', 'declining');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- life_areas — user-defined groupings for goals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS life_areas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text,
  icon        text,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- goals — top-level aspirations with momentum and confidence tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS goals (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  life_area_id     uuid             REFERENCES life_areas(id) ON DELETE SET NULL,
  title            text             NOT NULL,
  why_it_matters   text,
  success_metrics  text,
  status           goal_status      NOT NULL DEFAULT 'active',
  confidence       goal_confidence  NOT NULL DEFAULT 'medium',
  momentum         goal_momentum    NOT NULL DEFAULT 'stable',
  last_activity_at timestamptz,
  last_nudge_at    timestamptz,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goals_user_status_idx ON goals (user_id, status);


-- ---------------------------------------------------------------------------
-- projects — mid-level work items linked to goals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id     uuid        REFERENCES goals(id) ON DELETE SET NULL,
  title       text        NOT NULL,
  description text,
  status      task_status NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- daily_briefings — assembled context packages for morning review
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_briefings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  briefing_date date        NOT NULL,
  content       jsonb       NOT NULL,
  was_delivered boolean     NOT NULL DEFAULT false,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS daily_briefings_user_date_idx ON daily_briefings (user_id, briefing_date);


-- ---------------------------------------------------------------------------
-- Extend tasks with project and goal links
-- ---------------------------------------------------------------------------

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse function from 20260629230000_memory_schema.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER update_goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- RLS — life_areas
-- ---------------------------------------------------------------------------

ALTER TABLE life_areas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can manage own life_areas"
    ON life_areas FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON TABLE life_areas TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- RLS — goals
-- ---------------------------------------------------------------------------

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can manage own goals"
    ON goals FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON TABLE goals TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- RLS — projects
-- ---------------------------------------------------------------------------

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can manage own projects"
    ON projects FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON TABLE projects TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- RLS — daily_briefings
-- ---------------------------------------------------------------------------

ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users can manage own daily_briefings"
    ON daily_briefings FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON TABLE daily_briefings TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Default tool_permissions for existing users
-- ---------------------------------------------------------------------------

INSERT INTO tool_permissions (user_id, tool_name, enabled)
SELECT id, tool_name, true
FROM auth.users
CROSS JOIN (VALUES
  ('create_goal'),
  ('update_goal'),
  ('list_goals'),
  ('set_goal_momentum'),
  ('create_project'),
  ('generate_daily_briefing')
) AS tools(tool_name)
ON CONFLICT (user_id, tool_name) DO NOTHING;
