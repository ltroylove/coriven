-- behavioral_constraints: durable, user-owned rules for the pre-action engine gate.
-- Stored separately from memories (no vector pipeline) — per ADR-007.
CREATE TABLE IF NOT EXISTS behavioral_constraints (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule        text        NOT NULL,
  rationale   text        NOT NULL CHECK (length(trim(rationale)) > 0),
  scope       text        NOT NULL DEFAULT 'all',
  is_locked   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Gate query: locked constraints first, then by creation order
CREATE INDEX IF NOT EXISTS behavioral_constraints_user_locked_idx
  ON behavioral_constraints (user_id, is_locked);

-- Scoped listing
CREATE INDEX IF NOT EXISTS behavioral_constraints_user_scope_idx
  ON behavioral_constraints (user_id, scope);

-- Grant API roles access (consistent with other tables in this repo)
GRANT SELECT, INSERT, UPDATE, DELETE ON behavioral_constraints TO anon, authenticated, service_role;

-- RLS
ALTER TABLE behavioral_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_constraints"
  ON behavioral_constraints
  FOR ALL
  USING (user_id = auth.uid());

-- Keep updated_at current on any update
CREATE OR REPLACE FUNCTION update_behavioral_constraints_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER behavioral_constraints_updated_at
  BEFORE UPDATE ON behavioral_constraints
  FOR EACH ROW EXECUTE FUNCTION update_behavioral_constraints_updated_at();
