# Epic 4 Security Audit — Goal-Driven Organization & Daily Briefing

**Date:** 2026-07-02  
**Auditor:** Security review (read-only, non-destructive)  
**Scope:** Epic 4 net-new code only (migrations, cron routes, briefing API, goal/profile Server Actions, momentum/briefing jobs, goals/projects/today UI).
**Method:** Manual source review against OWASP Top 10 (A01 Broken Access Control, A03 Injection, A05 Security Misconfiguration, A09 Logging/Info Leakage) plus the six focus areas in the brief. No code executed; no data modified.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning  | 3 |
| Info     | 5 |

Overall the Epic 4 implementation follows the project security conventions well: every user-facing route verifies the session before DB access, all Server Actions apply explicit user_id filters on top of RLS, RLS is enabled with correct owner policies on all four new tables, CRON_SECRET is checked first and read only from process.env, and the service-role client is confined to cron/job contexts. The findings below are all information-leakage and input-validation hardening items — no broken access control or injection was found.

---

## Findings

### WARNING-1 — Internal DB/error details leaked to clients in cron and Server Action responses

**Locations:**
- apps/web/src/app/api/cron/nightly/route.ts:50 — returns { error: 'Internal error', details: String(err) } with status 500
- apps/web/src/app/api/cron/daily-briefing/route.ts:27 — returns { error: 'Failed to fetch profiles', details: profilesError.message } with status 500
- apps/web/src/app/api/cron/daily-briefing/route.ts:82 — response body includes the errors array, whose entries embed raw upsertError.message / String(err) strings (constructed at lines 66 and 73), each prefixed with the user_id UUID.
- apps/web/src/app/actions/goals.ts:20,32,45 — throw new Error(error.message) propagates the raw Postgres/PostgREST error message to the caller.
- apps/web/src/app/actions/profile.ts:77 — returns { success: false, error: error.message }, the raw DB error string, to the client.

**Description (CWE-209: Error Message Containing Sensitive Information; OWASP A09):**
Raw database/runtime error strings are returned in HTTP response bodies. These can disclose table/column names, constraint names, SQL fragments, and driver internals that aid an attacker in mapping the schema.

For the two cron routes the exposure is partially mitigated because the endpoints are gated by CRON_SECRET, so only a caller who already holds the secret reaches the leak. It remains a defense-in-depth issue, and in the daily-briefing per-user errors array the leak also embeds profile.id (a user_id UUID) alongside DB error text.

For the Server Actions (goals.ts, profile.ts) the exposure is directly reachable by any authenticated user and surfaces to the browser.

**Evidence:** See lines cited above. Example — goals.ts:20: if (error) throw new Error(error.message).

**Remediation:**
- Log the full error server-side (already done via console.error) but return a generic, opaque message to the client. Remove the details field from the cron 500 responses; return { error: 'Internal error' } only.
- In daily-briefing/route.ts, return counts only (usersProcessed, briefingsGenerated, briefingsSkipped, errorCount) instead of the errors string array; keep detailed per-user messages in server logs.
- In goals.ts / profile.ts, replace error.message with a fixed message (e.g. 'Could not update goal') and console.error the underlying error server-side.

---

### WARNING-2 — briefing_time validation accepts semantically invalid times

**Location:** apps/web/src/app/actions/profile.ts:60 — regex /^\d{2}:\d{2}$/ used to validate briefingTime.

**Description (CWE-20: Improper Input Validation):**
The regex ^\d{2}:\d{2}$ matches any two-digit:two-digit string, including 99:99, 29:61, 00:99, etc. The value is written to profiles.briefing_time and later consumed by isInBriefingWindow in apps/web/src/lib/utils/timezone.ts:22, which does briefingTime.split(':').map(Number) with no range check. An out-of-range value silently corrupts the briefing-window computation (e.g. bHour=99 gives briefingTotalMinutes=5941, which can never fall within a 30-minute window), causing that user's daily briefing to never fire.

Impact is limited to the user's own account (self-inflicted denial of a feature), not a cross-tenant issue, hence Warning rather than Critical. There is no injection vector because the value is passed as a parameterized column value, not interpolated into SQL.

**Evidence:** profile.ts:60 regex; timezone.ts:22-23 parses without bounds.

**Remediation:** Tighten the regex to a valid 24-hour clock, e.g. ^([01][0-9]|2[0-3]):[0-5][0-9]$, and/or bounds-check bHour (0-23) and bMinute (0-59) in isInBriefingWindow before use. Reject otherwise with the existing 'Invalid briefing time format' error.

---

### WARNING-3 — Non-constant-time secret comparison + no explicit empty-secret guard on cron endpoints

**Locations:**
- apps/web/src/app/api/cron/nightly/route.ts:9 — if (!token || token !== process.env.CRON_SECRET)
- apps/web/src/app/api/cron/daily-briefing/route.ts:11 — same pattern

**Description (CWE-208: Observable Timing Discrepancy):**
The secret is compared with the JS !== operator, which short-circuits on the first differing byte and is not constant-time. Over many requests this is a theoretical timing side-channel for recovering the token. The practical risk against a 32-hex-char (openssl rand -hex 32) secret over the public internet with network jitter is low, so this is Warning-level, not Critical.

Separately, the check relies on the environment always being configured: if CRON_SECRET is ever unset, process.env.CRON_SECRET is undefined. The current code still fails safe (a request with no token hits !token and returns 401; a request with any token hits token !== undefined and returns 401), so there is no auth-bypass today. This is called out only so the safe-default behavior is not accidentally lost in a future refactor.

**Evidence:** Lines cited. Repo-wide search confirms CRON_SECRET appears in source only at these two comparison sites and in .env.example (as an empty placeholder) — never hard-coded with a value. Focus-area requirements 'CRON_SECRET is the first check before any DB access' and 'read only from process.env' are both satisfied.

**Remediation:**
- Use a constant-time comparison, e.g. crypto.timingSafeEqual over equal-length buffers, after an explicit length check.
- Add an explicit guard: if !process.env.CRON_SECRET, return 401 (or 500 with a server-only log) rather than relying on the emergent safe-default, so intent is documented and refactor-proof.

---

### INFO-1 — GRANT ALL ... TO anon on all four new tables

**Location:** supabase/migrations/20260702000000_add_goal_hierarchy.sql:139,156,173,190

Each new table grants ALL to anon, authenticated, service_role. RLS is enabled with user_id = auth.uid() policies, and for the anon role auth.uid() is null, so every row fails the policy and no rows are readable/writable without a session — the grant is effectively neutralized by RLS. This matches the existing project pattern. Noted for awareness: the anon grant is broader than necessary; scoping table grants to authenticated, service_role would remove reliance on RLS being the sole gate for the anonymous role (defense in depth). Not a live vulnerability.

### INFO-2 — RLS coverage confirmed complete and correct

life_areas, goals, projects, and daily_briefings each ENABLE ROW LEVEL SECURITY and define a FOR ALL policy with both USING (user_id = auth.uid()) and WITH CHECK (user_id = auth.uid()) (migration lines 129-190). The WITH CHECK clause prevents a user from inserting/updating rows owned by another user_id. This is correct and complete for the focus-area requirement. No action needed.

### INFO-3 — Service-role usage correctly confined

createServiceClient (RLS-bypassing, apps/web/src/lib/supabase/server.ts) is imported only by lib/jobs/momentum.ts, lib/jobs/briefing.ts, and the two api/cron/* routes — all system/cron contexts gated by CRON_SECRET. User-facing routes and Server Actions (goals.ts, profile.ts, all four pages, api/briefing/today/route.ts) use createAuthServerClient, which is session-scoped and enforces RLS. The jobs intentionally query across all users without a user_id filter, which is appropriate for a system job and is protected by the fact that they are only reachable through the secret-gated cron endpoints. No action needed.

### INFO-4 — Auth-before-DB verified on every user-facing surface

All four pages (goals/page.tsx:8-9, goals/[id]/page.tsx:56-57, projects/[id]/page.tsx:29-30, today/page.tsx:9-10) call supabase.auth.getUser() and redirect when unauthenticated before any query. api/briefing/today/route.ts:15-19 returns 401 before querying. Every Server Action routes through getAuthenticatedUser() (goals.ts:6-11) or an inline getUser() check (profile.ts:65-69) before writing. Every query additionally carries an explicit .eq('user_id', user.id) filter (belt-and-suspenders over RLS). This fully satisfies focus areas 1 and 6.

### INFO-5 — Stored data rendered without additional sanitization (React auto-escaping relied upon)

User-controlled fields (goal.title, why_it_matters, success_metrics, project.title/description, task titles, and briefing content) are rendered as JSX text children in the four pages and are auto-escaped by React, so no stored-XSS vector exists in the audited code. This is correct; the note is a reminder that if any of these values are ever passed to dangerouslySetInnerHTML or into a non-React sink (e.g. a future tray/notification renderer), explicit sanitization will be required. No action needed for the current code.

---

## Focus-Area Checklist

| # | Focus area | Result |
|---|-----------|--------|
| 1 | Auth/AuthZ — session before DB; explicit user_id filters | PASS (INFO-4) |
| 2 | Cron: CRON_SECRET first, from process.env, absent from source | PASS with hardening (WARNING-3) |
| 3 | RLS enabled + correct policies on all 4 new tables | PASS (INFO-2) |
| 4 | Input validation; timezone allowlist enforced | Timezone allowlist PASS; briefing_time weak (WARNING-2) |
| 5 | Information leakage in error responses | FAIL — internal errors leaked (WARNING-1) |
| 6 | Service role only in cron/job contexts | PASS (INFO-3) |

## Notes

- No hard-coded secrets, credentials, or CRON_SECRET values were found in any audited source file (repo-wide search shows only the .env.example placeholder and doc references).
- The profiles timezone/briefing_time migration (20260702000001_add_profile_timezone_briefing_time.sql) only adds two NOT NULL DEFAULT columns and does not alter RLS; profiles RLS is assumed pre-existing (outside Epic 4 scope) and was not re-audited.
- No injection (SQL/command) vectors found: all queries use the parameterized Supabase query builder; no string interpolation into SQL. The .or(...) filter in momentum.ts:160 interpolates only an ISO timestamp derived from Date, not user input.

