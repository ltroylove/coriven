-- =============================================================================
-- Security Hardening — Epic 5 Remediation
-- Findings addressed: M-1 (audit_log append-only), M-2/M-3 (executing status),
--                     L-2 (anon grant on integrations)
-- References: ADR-013 §Audit Trail; epic-5-security-audit.md
-- =============================================================================


-- ---------------------------------------------------------------------------
-- M-1: audit_log — enforce DB-level append-only (ADR-013 §Audit Trail)
--
-- The original migration (20260705010000) granted ALL to service_role, which
-- includes UPDATE and DELETE. Audit entries are intended to be immutable by
-- design — they are a tamper-evident record of every approval decision and
-- execution outcome. Revoking UPDATE and DELETE from every role closes the gap
-- between the documented intent ("append-only") and the actual DB privileges.
--
-- service_role retains INSERT + SELECT (needed by audit.ts to write entries
-- and by the service layer to read them cross-user).
-- authenticated retains SELECT only (read own rows via RLS policy).
-- anon has no grants on audit_log (was never granted — confirmed in 20260705010000).
-- ---------------------------------------------------------------------------

-- Revoke mutating privileges from service_role (preserves INSERT + SELECT).
REVOKE UPDATE, DELETE ON audit_log FROM service_role;

-- Explicitly ensure authenticated cannot mutate audit entries.
-- (No UPDATE/DELETE was granted in 20260705010000, but belt-and-suspenders.)
REVOKE UPDATE, DELETE ON audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON audit_log FROM anon;

COMMENT ON TABLE audit_log IS
  'Append-only audit trail for every approval decision and execution. '
  'INSERT is restricted to service_role (via audit.ts). '
  'UPDATE and DELETE are revoked from all roles — entries are immutable by design '
  '(ADR-013 §Audit Trail). See epic-5-security-audit.md finding M-1.';


-- ---------------------------------------------------------------------------
-- M-2 / M-3: approval_queue — add 'executing' status value
--
-- The router needs an atomic claim step: before calling any provider it must
-- transition the row to a claimed intermediate state so that concurrent
-- requests cannot both proceed to the provider (race condition).
--
-- We add 'executing' to the CHECK constraint, which allows the router to do:
--   UPDATE approval_queue SET status = 'executing'
--   WHERE id = ? AND status IN ('approved', 'failed')
-- and check that exactly one row was affected. If 0 rows affected, another
-- request already claimed the row → bail with invalid_state.
--
-- Status lifecycle after this migration:
--   pending   → approved | cancelled      (user decision)
--   approved  → executing                 (atomic claim)
--   executing → executed | failed         (terminal write after provider call)
--   failed    → executing                 (retry path — conditional claim)
-- ---------------------------------------------------------------------------

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_status_check;

ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_status_check
    CHECK (status IN ('pending', 'approved', 'cancelled', 'executing', 'executed', 'failed'));


-- ---------------------------------------------------------------------------
-- L-2: integrations — revoke anon grant
--
-- The original migration (20260705000000) granted ALL to anon, authenticated,
-- and service_role. The 'anon' role should have no access to the integrations
-- table — it stores per-user provider connection references and is always
-- accessed in an authenticated context.
--
-- Pattern applied: same least-privilege model as the other 5 tables that have
-- been corrected (approval_queue, audit_log, etc. grant authenticated/service
-- but not anon).
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE integrations FROM anon;

COMMENT ON TABLE integrations IS
  'Per-user provider connection references (no raw tokens — ADR-013). '
  'anon has no access; authenticated can manage own rows via RLS; '
  'service_role has full access for backend operations.';
