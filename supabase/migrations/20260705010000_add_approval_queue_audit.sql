-- =============================================================================
-- Approval Queue + Audit Log Schema
-- Adds: approval_queue, audit_log tables
-- Depends on: 20260701000000_add_behavioral_constraints.sql (tool_permissions table)
-- References: ADR-009 (Approval Queue Gate), ADR-013 (Integration Token Authority)
--
-- Status lifecycle (enforced in Server Action layer, documented here):
--   pending → approved | cancelled      (user decision)
--   approved → executed | failed        (Wave 5.3.2 executor)
--   cancelled, executed, failed         (terminal — no further transitions)
--
-- RLS summary:
--   approval_queue: users SELECT/INSERT/UPDATE own rows; no DELETE (cancel = status change)
--   audit_log:      users SELECT own rows only; INSERT/UPDATE/DELETE denied to all
--                   authenticated users — service role is the exclusive writer (ADR-013 §Audit Trail)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- approval_queue — pending external-world actions awaiting user review
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS approval_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Extensible action type string; known values: 'send_email', 'create_calendar_event', 'update_calendar_event'
  action_type text        NOT NULL,

  -- Provider string; mirrors integration_provider enum values ('gmail', 'outlook', 'google_calendar', 'outlook_calendar')
  -- Stored as text for forward-compat with future long-tail providers (ADR-013 Layer 3)
  provider    text        NOT NULL,

  -- Validated structured descriptor for the action; shape is action_type-dependent
  payload     jsonb       NOT NULL,

  -- Optional AI-generated plain-language description. MUST be treated as
  -- secondary/labeled; raw payload is the authoritative decision surface (ADR-013 §Security)
  ai_summary  text,

  -- Status lifecycle enforced by CHECK; transitions are guarded in Server Actions
  status      text        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'cancelled', 'executed', 'failed')),

  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  executed_at timestamptz,

  -- Non-null only after execution attempt (Wave 5.3.2+)
  error_code  text
);

-- Covering index for the primary query pattern: user's pending items, newest first
CREATE INDEX IF NOT EXISTS approval_queue_user_status_idx
  ON approval_queue (user_id, status, created_at DESC);


-- ---------------------------------------------------------------------------
-- audit_log — append-only record of every approval decision and execution
--
-- APPEND-ONLY CONTRACT:
--   No INSERT/UPDATE/DELETE policies for authenticated users.
--   All writes go through the service-role client exclusively (audit.ts).
--   The absence of user-facing write policies is the enforcement mechanism.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_id uuid        REFERENCES approval_queue(id) ON DELETE SET NULL,
  action_type text        NOT NULL,
  provider    text        NOT NULL,

  -- Resulting status at time of this audit entry (e.g. 'proposed', 'approved', 'cancelled', 'executed', 'failed')
  status      text        NOT NULL,

  error_code  text,

  -- Delegation chain: records user → Coriven → provider connection (ADR-013 §Audit Trail)
  -- Shape: { user: userId, actor: 'coriven', connection: { provider, nango_connection_id | null } }
  delegation  jsonb       NOT NULL,

  -- Audit entries use created_at as the canonical timestamp (covers both decisions and executions)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for user-scoped audit reads, newest first
CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON audit_log (user_id, created_at DESC);

-- Index for looking up all audit entries for a given approval item
CREATE INDEX IF NOT EXISTS audit_log_approval_idx
  ON audit_log (approval_id);


-- ---------------------------------------------------------------------------
-- RLS — approval_queue
-- ---------------------------------------------------------------------------

ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "approval_queue: users select own rows"
    ON approval_queue FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "approval_queue: users insert own rows"
    ON approval_queue FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "approval_queue: users update own rows"
    ON approval_queue FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No DELETE policy — cancellation is a status transition, not a row deletion.

GRANT SELECT, INSERT, UPDATE ON TABLE approval_queue TO authenticated;
GRANT ALL ON TABLE approval_queue TO service_role;


-- ---------------------------------------------------------------------------
-- RLS — audit_log (append-only; service role is the only writer)
-- ---------------------------------------------------------------------------

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "audit_log: users select own rows"
    ON audit_log FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No INSERT policy for authenticated role — service_role bypasses RLS.
-- No UPDATE policy — audit entries are immutable by design.
-- No DELETE policy — audit entries are immutable by design.

GRANT SELECT ON TABLE audit_log TO authenticated;
GRANT ALL ON TABLE audit_log TO service_role;


-- ---------------------------------------------------------------------------
-- Default tool_permissions for existing users (submit_for_approval)
-- ---------------------------------------------------------------------------

INSERT INTO tool_permissions (user_id, tool_name, enabled)
SELECT id, 'submit_for_approval', true
FROM auth.users
ON CONFLICT (user_id, tool_name) DO NOTHING;
