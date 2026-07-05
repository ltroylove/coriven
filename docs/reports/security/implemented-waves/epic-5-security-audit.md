# Epic 5 (Communications Intelligence) — Security Audit

**Scope:** Wave 5.x implementation — email execution, calendar execution, audit logging, zero-trust egress, constraint gate, integrations table, approval queue lifecycle.

**Overall posture: STRONG.** The positive controls listed below demonstrate a principled security architecture. Six findings were identified; all actionable items are resolved in this remediation commit.

---

## Findings

### H-1 — CRLF Header Injection in Gmail Email Construction [FIXED this remediation]

**Severity:** High

**Location:** `apps/web/src/lib/approvals/payload-validator.ts` (`validateSendEmail`), `apps/web/src/lib/approvals/executors/email.ts` (`buildRfc2822Base64url`)

**Description:** The `validateSendEmail` function did not reject `to` or `subject` values containing `\r` or `\n`. An attacker-controlled value could inject additional RFC 2822 header lines (e.g. `Bcc:`, `From:`) into the raw message assembled by `buildRfc2822Base64url`. The Gmail API accepts the raw base64url-encoded message verbatim; a CRLF in a header field creates a new header line.

**Remediation:** In `validateSendEmail`: added `hasCRLF()` guard rejecting `\r`/`\n` in `to` and `subject` (body is exempt — newlines are normal content). Added RFC-5322-ish email format regex for `to` (bundled with L-1). In `buildRfc2822Base64url`: added `sanitizeHeaderValue()` as defense-in-depth that strips `\r\n` from header fields before assembly, even though the validator now guards it. The comment is updated to reflect actual behavior (no RFC 2047 encoding — UTF-8 bytes in the base64url blob, which Gmail accepts).

**Both entry paths verified:** `approveAction` and `approveWithModifiedPayload` both call `validatePayload` → `validateSendEmail`, so both paths are protected.

---

### M-1 — Audit Log DB-Level Append-Only [FIXED this remediation]

**Severity:** Medium

**Location:** `supabase/migrations/20260705010000_add_approval_queue_audit.sql`, new migration `20260705060000_harden_audit_log_append_only.sql`

**Description:** The original migration granted `ALL` to `service_role`, which includes `UPDATE` and `DELETE`. The documented intent (comment: "append-only by design", ADR-013 §Audit Trail) was not enforced at the DB privilege level — the service role could mutate or delete audit entries.

**Remediation:** New migration `20260705060000` issues `REVOKE UPDATE, DELETE ON audit_log FROM service_role, authenticated, anon`. `service_role` retains `INSERT + SELECT`. `authenticated` retains `SELECT` (via existing RLS policy). The table comment is updated to document the append-only contract.

---

### M-2 — Retry-Path Race Condition [FIXED this remediation]

**Severity:** Medium

**Location:** `apps/web/src/lib/approvals/executors/router.ts` (`executeApprovedAction`), `apps/web/src/app/actions/approvals.ts` (`retryAction`)

**Description:** The original router performed a status check then called the provider as two separate steps. Two concurrent retry requests could both pass the status check and both proceed to call the provider (send two emails, create two calendar events, etc.).

**Remediation:** Added `claimForExecution()` — an atomic conditional UPDATE that transitions status → `'executing'` WHERE `id = ? AND status IN (allowedStatuses)` using `{ count: 'exact' }`. If 0 rows affected, another request already claimed the row; the function returns `{ ok: false, errorCode: 'invalid_state' }` without calling any provider. The `'executing'` status value was added to the DB `CHECK` constraint in migration `20260705060000`. `retryAction` is auth-scoped with `.eq('user_id', user.id)` on the ownership fetch (matching `approveAction`).

---

### M-3 — Ownership Re-Verification After Claim [FIXED this remediation]

**Severity:** Medium

**Location:** `apps/web/src/lib/approvals/executors/router.ts` (`executeApprovedAction`)

**Description:** The router trusted the mutable fields (user_id, payload) from the `ApprovalQueueRow` passed in by the caller. If a caller constructed a row with a different user_id or tampered payload, those values would be used for execution and audit without re-verification against the DB.

**Remediation:** After the atomic claim, the router re-fetches the row using the service-role client (`.select('id, user_id, action_type, provider, payload')`). All subsequent operations (constraint gate, executor dispatch, audit write) use the DB-authoritative values. The caller now passes only `{ id }` — the router does not trust any other fields from the caller. `executeApprovedAction`'s signature updated to `Pick<ApprovalQueueRow, 'id'> & Partial<ApprovalQueueRow>`.

---

### L-1 — Email Format Validation [FIXED this remediation, bundled with H-1]

**Severity:** Low

**Location:** `apps/web/src/lib/approvals/payload-validator.ts` (`validateSendEmail`)

**Description:** No email address format validation on the `to` field — any non-empty string was accepted.

**Remediation:** Added `EMAIL_REGEX` (RFC-5322-ish) applied to `to` after the CRLF check. Rejects obviously invalid addresses while accepting the vast majority of real addresses. Provider ultimately validates deliverability.

---

### L-2 — Anon Grant on Integrations Table [FIXED this remediation]

**Severity:** Low

**Location:** `supabase/migrations/20260705000000_add_integrations.sql`, new migration `20260705060000_harden_audit_log_append_only.sql`

**Description:** `GRANT ALL ON TABLE integrations TO anon` was present in the original migration. The `anon` role should have no access to the integrations table — it stores per-user provider connection references and is always accessed in an authenticated context.

**Remediation:** New migration `20260705060000` issues `REVOKE ALL ON TABLE integrations FROM anon`. `authenticated` retains access via the existing RLS policy. `service_role` retains full access for backend operations. This matches the least-privilege pattern applied to the other tables in the project.

---

### L-3 — Provider Error Body Logging [DEFERRED — tracked]

**Severity:** Low

**Location:** `apps/web/src/lib/approvals/executors/email.ts`, `calendar.ts`

**Description:** Provider error responses are currently logged only by HTTP status code (`response.status`), not body content. This is the safer default (bodies may contain tokens or PII) but limits debuggability for provider rejection analysis.

**Status:** [DEFERRED — tracked] Deliberately conservative. If operational need arises, log only stable error codes from the response body (e.g. Gmail's `error.code`, Graph's `error.code`), never raw body strings. Track as operational improvement; not a security risk in current form.

---

### L-4 — Calendar Description Framing [DEFERRED — tracked]

**Severity:** Low

**Location:** Future `get_calendar_event` tool (not yet shipped)

**Description:** Latent risk: when `get_calendar_event` ships, event description fields read from the provider and rendered in the UI should be framed/escaped to prevent prompt injection into the assistant context.

**Status:** [DEFERRED — tracked] Not present in current implementation. Apply escaping/framing when `get_calendar_event` ships.

---

## Informational

### I-1 — Supabase Service Role Key Exposure Surface

The service role key is used server-side only (Server Actions, route handlers). No client-side exposure paths found. Key is loaded via `SUPABASE_SERVICE_ROLE_KEY` env var; not present in client bundles.

### I-2 — Nango Token Lifetime

Nango tokens are fetched per-call and never cached in memory or persisted. Token expiry and refresh are delegated to Nango. No local token store to audit.

---

## Positive Controls Verified

The following security controls were verified as correctly implemented during this audit:

- **Tokens sole-path via `getProviderToken`** — all provider API calls obtain tokens exclusively through `getProviderToken(userId, provider)` from Nango. No raw tokens are stored or passed through the approval payload.
- **Zero-trust framing + egress allowlist** — the egress allowlist (Wave 5.3.3) restricts outbound calls to a defined set of provider hostnames. `encodeURIComponent` is applied to all user-supplied path segments in calendar URLs (SSRF mitigation).
- **Raw-payload approval UI** — the UI renders the raw action payload as the primary decision surface (preformatted text, no link rendering, no markdown). The AI summary is clearly labeled and visually secondary (ADR-013 §Security / approval-context integrity).
- **Fail-closed constraint gate** — the behavioral constraint gate in the router throws → blocks execution (fail-closed). The chat engine is fail-open; external actions are irreversible, so conservatism is correct.
- **No email bodies persisted** — email body content is never written to the audit log or any other table. Audit entries record action type, provider, status, and error code only.
- **CRON `timingSafeEqual` on all routes** — CRON handler authorization uses `timingSafeEqual` to prevent timing-based secret comparison attacks.
- **SSRF `encodeURIComponent`** — calendar event IDs from user-supplied data are URL-encoded before being interpolated into provider API paths.
- **RLS + GDPR cascade on all 6 tables** — all tables introduced in Epic 5 (integrations, approval_queue, audit_log, email_metadata, calendar_events, meeting_briefs) have RLS enabled with `user_id = auth.uid()` policies and `ON DELETE CASCADE` from `auth.users`, ensuring data is removed when a user is deleted.
- **Dependencies clean** — no known CVEs in the direct dependency tree at time of audit.

---

## Verdict

**H-1 (CRLF header injection) and M-1 (audit log mutability) were the must-fix items** — both are fully resolved in this remediation commit. M-2 and M-3 close a concurrent-execution race window and an ownership-trust gap that were low-probability in synchronous execution but are now structurally eliminated. L-1 and L-2 complete the least-privilege hardening pass. L-3 and L-4 are deferred with tracking — neither represents an active vulnerability in the current implementation.
