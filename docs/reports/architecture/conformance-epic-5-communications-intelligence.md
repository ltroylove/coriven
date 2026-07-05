# Architecture Conformance Review — Epic 5: Communications Intelligence

**Date:** 2026-07-04
**Branch:** `epic/5-communications-intelligence`
**Scope:** All 10 waves (5.1.1–5.4.3), post security-audit remediation (`20260705060000`)
**Reviewer:** Architecture conformance review (advisory, non-blocking)
**Governing ADRs:** ADR-013 (Integration Token Authority), ADR-009 (Approval Queue + Audit Gate), ADR-008 (Deterministic Assembly)

---

## Summary Verdict

| Area | Status |
|------|--------|
| ADR-013 — Nango token authority + direct provider APIs | **Conformant** (2 tracked-debt notes) |
| ADR-009 — Approval queue + append-only audit gate | **Conformant** (1 Warning on audit-write ordering) |
| ADR-008 — Deterministic meeting prep (zero LLM) | **Conformant** |
| Pattern conformance (clients, actions, types, RLS, cron) | **Conformant** |
| Epic completeness (Features 5.1–5.4; 5.5 absent) | **Complete** |
| Cross-wave coherence (migrations, types, nav, registry) | **Coherent** |

**Overall readiness: READY for PR to `development`.** No Critical deviations. Three Warnings and several Info items, all suitable as tracked debt or PR-description notes — none gate the merge.

---

## 1. ADR-013 Conformance — Nango + Direct Provider APIs

### 1.1 Nango is the sole token authority — CONFORMANT

- `apps/web/src/lib/integrations/nango.ts:103-166` — `getProviderToken(userId, provider)` is the single sanctioned token path; module header (lines 1-8) states the contract explicitly. Token values are never logged (`nango.ts:100-101`).
- Every provider call site obtains tokens exclusively through it:
  - Email read: `apps/web/src/lib/email/providers.ts:313, 355`
  - Follow-up detection: `apps/web/src/lib/email/followup.ts:367`
  - Calendar sync: `apps/web/src/lib/calendar/providers.ts:111, 236`
  - Email executor: `apps/web/src/lib/approvals/executors/email.ts:193`
  - Calendar executor: `apps/web/src/lib/approvals/executors/calendar.ts:253, 287`
- No raw tokens in the DB: `supabase/migrations/20260705000000_add_integrations.sql:28-37` stores only `nango_connection_id`, `provider`, `scopes` — no token columns; grep for `access_token|refresh_token` across all migrations returns zero matches. Header comment (line 5): "No raw token columns — connection references only (ADR-013)."
- Connect/disconnect flows go through Nango server-side (`apps/web/src/app/actions/integrations.ts` — connect-session token creation keeps `NANGO_SECRET_KEY` server-side; disconnect deletes the Nango connection **before** the DB row, with 404-tolerant compensation ordering, lines ~218-277).
- Thin-wrapper requirement honored: `getToken()` is isolated in one module, swappable per ADR-013 §Consequences.
- Setup constraints documented: `docs/implementation/runbooks/nango-setup.md` covers key-vaulting before first deploy (Step 1, line 27-29), the compromise runbook (line 43), and the ELv2 confirmation step (Step 3, line 97).

### 1.2 Direct provider APIs for Gmail/Outlook/Calendar — CONFORMANT

- Read path: Vercel Cron → `getProviderToken()` → Gmail API / Microsoft Graph → metadata only (`email-poll` route header, `apps/web/src/app/api/cron/email-poll/route.ts:1-20`; `email_metadata` has **no body column** — `20260705020000_add_email_metadata.sql:8-9` "NO body column is present or will ever be added"). Bodies fetched on demand only via `fetchEmailBody` (`providers.ts:350-384`) from the `get_email_thread` tool.
- Write path: approval queue → `getProviderToken()` → provider API → `audit_log` (router + executors, §2 below).

### 1.3 Long-tail correctly ABSENT — CONFORMANT

- No Zapier/Composio/Pipedream/n8n code anywhere in `apps/web/src` (grep for `zapier` returns zero matches). Feature 5.5 was removed from the epic doc at v2.1 (change log, `epic-5-communications-intelligence.md:155`).
- Forward-compat is prepared, not implemented: `approval_queue.provider` and `calendar_events.provider` are `text` rather than the enum, explicitly "for forward-compat with future long-tail providers (ADR-013 Layer 3)" (`20260705010000:30-32`, `20260705030000:28-30`).

### 1.4 Provider-routing seam (verification requested) — PRESENT AND DOCUMENTED

`apps/web/src/lib/approvals/executors/router.ts`:
- Lines 29-33 (module header): "ADR-013 Layer 3 seam: The PROVIDER_ROUTER map below is the designated extension point for the future long-tail connector epic. Add a new key here; no other file changes."
- Lines 50-64: `EMAIL_PROVIDERS` / `CALENDAR_PROVIDERS` sets with the extension comment "To add a long-tail connector: add its provider key here pointing to a new executor module."
- Lines 357-368: unknown action_type/provider combinations **fail closed** (`unknown_provider`), with the seam comment repeated at the insertion point (line 359).
- The seam is real: executors are per-provider modules (`executors/email.ts`, `executors/calendar.ts`) behind a uniform `ExecutionResult` contract (`packages/types/src/approval.ts:117-122`), so a long-tail executor slots in without touching claim/constraint/audit logic.

### 1.5 §Security constraints — CONFORMANT

- **Raw-payload approval UI:** `apps/web/src/app/(app)/approvals/approval-card.tsx:3-14` (contract in header), 110-118 (AI summary rendered secondary and labeled "model-generated — review the raw payload below"), 120-132 (raw payload as `<pre>` literal text, "this is what will be sent — approve based on this"; no markdown, no anchors).
- **Egress allowlist:** `apps/web/src/lib/security/egress.ts` — default-deny allowlist, markdown images stripped unconditionally, protocol-less `www.` links neutralized, app origin allowlisted; applied at `apps/web/src/lib/chat/tools/handlers.ts:431` on `get_email_thread` results. Tested (`lib/security/__tests__/egress.test.ts`, 168 lines). *See Warning W-1 on placement scope.*
- **Untrusted-content framing:** hostile-content frame around email bodies (`handlers.ts:388-425` `UNTRUSTED EMAIL CONTENT` header/footer); triage system prompt frames headers as adversarial data (`lib/email/triage.ts:68-70`); calendar description flagged untrusted at the schema level (`20260705030000:7-11, 47-48`); meeting-brief content flagged untrusted (`20260705040000:7-11`).
- **Fail-closed constraint gate:** `router.ts:152-208` — Epic 3 constraint evaluation before any executor; locked match or evaluator error → blocked (`constraint_blocked` / `constraint_check_failed`), explicitly contrasted with the chat engine's fail-open (line 155-157).
- **Audit trail:** append-only enforced at DB privilege level after remediation (`20260705060000:24-30` — `REVOKE UPDATE, DELETE ON audit_log FROM service_role, authenticated, anon`); no tokens or response bodies in entries (`lib/approvals/audit.ts:37`); delegation chain recorded per action (`audit.ts:38-46`, `20260705010000:79-81`). *See Info I-2 on the connection-id value.*
- **Minimum scopes:** provider scope constants in `actions/integrations.ts` (per wave 5.1.x); enforcement is at Nango/provider config level as documented there (line 42).

---

## 2. ADR-009 Conformance — Approval Queue + Append-Only Audit Gate

**Status: CONFORMANT.** The `untrusted input → propose → approve → execute` invariant holds structurally and is verified by an explicit automated test suite.

- **Propose:** `submit_for_approval` handler (`apps/web/src/lib/chat/tools/handlers.ts:456-523`) validates the payload (`lib/approvals/payload-validator.ts` — typed shapes per action, CRLF rejection at lines 49-75, email-format regex line 38) and inserts with `status: 'pending'` unconditionally (line 482). It cannot insert any other status. A `proposed` audit entry is written (lines 493-504).
- **Approve:** only the authenticated owner via Server Actions (`apps/web/src/app/actions/approvals.ts`) — auth-scoped client, ownership `.eq('user_id', user.id)` on every fetch/update, `pending`-only guard with race-safe conditional update (`approveAction:53-58`), `approved` audit entry, Modify path re-validates through the same validator (`approveWithModifiedPayload:201-204`), Cancel is a status transition (no DELETE policy on `approval_queue` — `20260705010000:124`).
- **Execute:** router only (`executeApprovedAction`) — atomic claim `approved|failed → executing` (M-2, `router.ts:80-108`), DB-authoritative re-fetch (M-3, lines 252-273), constraint gate, provider dispatch, terminal status + execution audit entry.
- **Append-only audit:** single writer module (`lib/approvals/audit.ts:1-9` "the ONLY code path that writes to audit_log"), service-role only, UPDATE/DELETE revoked from **all** roles including service_role (`20260705060000:25-30`).
- **Zero-trust verified by test:** `apps/web/src/lib/approvals/__tests__/zero-trust.test.ts` (613 lines) proves: proposals always land `pending`; no executor path (`getProviderToken`) is ever invoked from proposal, cancellation, invalid-state, or constraint-blocked flows (e.g. lines 211-214, 313-341, 610-611); execution occurs only after an approved claim. This satisfies the epic success metric "zero-trust verified by explicit automated test."
- The three-tier action model holds: internal CRUD tools execute directly; only external-world actions (`send_email`, `create_calendar_event`, `update_calendar_event`) route through the queue.

*Deviation W-2 (audit-write ordering/fire-and-forget) noted below.*

---

## 3. ADR-008 Conformance — Deterministic Meeting Prep

**Status: CONFORMANT.**

- `apps/web/src/lib/jobs/meeting-prep.ts` contains **no Anthropic import** — its only imports are `createServiceClient` (line 1) and the Supabase `Json` type. Grep for `anthropic|Anthropic` in `lib/jobs/` matches only comments and the guard test.
- The zero-LLM invariant is self-enforced by a test: `lib/jobs/__tests__/meeting-prep.test.ts:125-134` asserts the module source contains no `@anthropic-ai/sdk`, `Anthropic(`, or `anthropic.messages`.
- Assembly is pure structured queries: related emails by attendee `from_address` (lines 145-171), open tasks by ilike keyword/name match (179-215), memories by attendee-name ilike (223-253), entity profiles (262-291). Semantic (embedding) search is *deliberately excluded* "to avoid any model call dependency (ADR-008)" (lines 220-222).
- Follows the Epic-4 `assembleBriefing` precedent: structured JSON content (`MeetingBriefContent`) stored in `meeting_briefs.content`, rendered UI-side on `/today` (`app/(app)/today/page.tsx:21-31, 132`).
- Idempotent + race-safe persistence: pre-check plus `UNIQUE(user_id, provider, event_id)` with `ignoreDuplicates` upsert (lines 354-399).
- Matching-heuristic limitations are honestly documented in-code (lines 110-114, 143-144, 176-177, 220-222, 258-260) — see tracked debt D-3.

---

## 4. Pattern Conformance

- **Supabase client variants — CONFORMANT.** All user-facing page reads and Server Actions use the auth-scoped client with RLS: `/approvals` page (`approvals/page.tsx:7`), `/email` (`email/page.tsx:10`), `/email/[id]` (`email/[id]/page.tsx:18`), `/today` (`today/page.tsx:106`), `/settings/integrations`, and actions `approvals.ts:4`, `email.ts:11`, `integrations.ts:25` — all `createAuthServerClient` with belt-and-suspenders `user_id` filters. The service client appears only in sanctioned paths: cron routes, `audit.ts`, executor router/executors, `nango.ts` connection lookup, jobs, and the pre-existing chat tool-handler layer. **The Epic-4-style issue (service client in a user-facing read) does not recur.**
- **Server Actions in `app/actions/` — CONFORMANT.** New actions: `approvals.ts`, `email.ts`, `integrations.ts`, all `'use server'`, all with tests in `app/actions/__tests__/`.
- **Shared types in `packages/types` — CONFORMANT.** New modules `integration.ts`, `approval.ts`, `email.ts`, `calendar.ts`, exported from `index.ts:5-8`; imported app-side as `@personal-assistant/types` (e.g. `nango.ts:12`, `router.ts:42-48`).
- **`@/*` alias — CONFORMANT** throughout all new code.
- **RLS + user_id + cascade — CONFORMANT on all new tables.** Seven Epic-5 tables (not six — see I-4): `integrations`, `approval_queue`, `audit_log`, `email_metadata`, `calendar_events`, `meeting_briefs`, `followup_candidates`. Every one has `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`, and `auth.uid()`-scoped policies. Write policies follow least privilege: `calendar_events`/`meeting_briefs` are SELECT-only for users (cron writes via service role); `followup_candidates` allows SELECT + UPDATE (dismiss) only; `audit_log` is SELECT-only with all mutation revoked.
- **Cron routes — CONFORMANT.** All four new routes (`email-poll`, `calendar-sync`, `meeting-prep`, `followup-detection`) are GET handlers with `crypto.timingSafeEqual` Bearer-secret comparison including length pre-check (e.g. `email-poll/route.ts:35-46`), matching the epic-4 `daily-briefing`/`nightly` pattern; each has a 401-path test. All registered in `vercel.json:8-15` (email-poll */15, calendar-sync hourly, meeting-prep */5 with 15-min lookahead, followup nightly).
- **Conventional commits — CONFORMANT.** History shows `feat(wave-5.x.y): …`, `fix(epic-5): …`, `chore(epic-5): …`, `docs(epic-5): …` throughout (e.g. `feat(wave-5.1.1)`, `fix(wave-5.2.1)`, `fix(epic-5): security remediation`).

---

## 5. Epic Completeness (Features 5.1–5.4)

| Acceptance criterion (epic v2.1) | Shipped evidence |
|---|---|
| 5.1 Nango self-hosted, `integrations` table (connection ID only), `getToken()` wrapper, connect/disconnect UI for 3 providers at `/settings/integrations` | `lib/integrations/nango.ts`; `20260705000000`; `app/(app)/settings/integrations/page.tsx` + `components/integrations/provider-row.tsx` + `actions/integrations.ts`; runbook `docs/implementation/runbooks/nango-setup.md` (key vaulting, compromise runbook, ELv2 step, no-webhooks/poll guidance) |
| 5.1 setup constraints (non-rotatable key, ELv2 confirmation, graceful `getToken()` failure) | Runbook Steps 1/3; every `getProviderToken` caller handles `null` (skip/`token_unavailable`) |
| 5.2 15-min Gmail+Outlook poll, Haiku batch triage, no bodies stored, `/email` inbox with categories/urgency | `api/cron/email-poll/route.ts` + `vercel.json:11`; `lib/email/providers.ts` (Gmail + Graph); `lib/email/triage.ts` (Haiku batch, hostile framing, safe fallback); `20260705020000` (no body column, UNIQUE user/provider/message_id); `app/(app)/email/page.tsx` + `email-row.tsx` grouped by category (`lib/email/inbox.ts`) |
| 5.2 body on demand via `get_email_thread` with hostile framing | `handlers.ts:393-454` (frame + egress neutralization); tool registered `lib/chat/tools/registry.ts:26, 387` |
| 5.3 `submit_for_approval` → `/approvals` Approve/Modify/Cancel with raw payload → execute → `audit_log` | `handlers.ts:456-523`; `approval-card.tsx`; `actions/approvals.ts`; `executors/router.ts` + `email.ts` + `calendar.ts`; `audit.ts`; retry path for failed items (`retryAction`, `history-row.tsx`) |
| 5.3 zero-trust tested explicitly; egress allowlist | `lib/approvals/__tests__/zero-trust.test.ts` (613 lines); `lib/security/egress.ts` + tests |
| 5.4 hourly calendar sync; meeting-prep brief 15 min before event; nightly follow-up detection; calendar writes via approval queue | `api/cron/calendar-sync` + `lib/calendar/sync.ts`/`providers.ts`; `api/cron/meeting-prep` + `lib/jobs/meeting-prep.ts` + `/today` MeetingPrepSection; `api/cron/followup-detection` + `lib/email/followup.ts` (>3-day no-reply) + `/email` follow-up section + `dismissFollowUp`; calendar create/update exist **only** as approval-queue executors |
| 5.5 Zapier — must NOT exist | Correctly absent; zero references in `apps/web/src` |

Success metrics from the epic doc all map to shipped code, including "no bodies stored" and "every recommendation/approval/execution recorded in audit_log" (`proposed`/`approved`/`cancelled`/`executed`/`failed` entries at each transition).

---

## 6. Cross-Wave Coherence

- **Migrations:** seven sequential Epic-5 migrations (`20260705000000` → `060000`) with correct declared dependencies (integrations → email_metadata/calendar_events → meeting_briefs; followup_candidates ← email_metadata; 060000 amends 000000/010000). All DDL is idempotent (`IF NOT EXISTS`, `DO $$ … duplicate_object` guards); no name or enum collisions; `060000` cleanly supersedes the earlier `approval_queue_status_check` and the `anon` grant.
- **Types/registry/nav:** `packages/types/src/index.ts` exports all four new modules once; `ApprovalStatus` in types matches the post-remediation DB CHECK (including `executing`, `approval.ts:20-26`); tool registry lists `submit_for_approval` and `get_email_thread` exactly once each with matching handler-map entries (`registry.ts:25-26`, `handlers.ts:546-547`); nav has single `Email` and `Approvals` entries (`components/layout/app-nav.tsx:15, 18`).
- **No duplication from parallel worktrees found:** exactly one egress module, one audit writer, one Nango wrapper, one router; the intentional duplication of `PROVIDER_CONFIG_KEYS`/`getNangoClient` between `lib/integrations/nango.ts` and `actions/integrations.ts` is documented as a mirror ("Mirrors PROVIDER_CONFIG_KEYS from …", `integrations.ts:31`) — see I-5.
- Cron scheduling coherent: meeting-prep every 5 min against a 15-min lookahead window with idempotency guard — briefs fire once, ≤15 min before start.

---

## 7. Deviations

### Critical
None.

### Warning

- **W-1 — Egress allowlist applied at the tool-result boundary, not on final assistant output.** ADR-013 §Security asks for neutralization of "model output rendered to users or sent externally." Implementation neutralizes the `get_email_thread` tool result before it re-enters model context (`handlers.ts:427-431`), with a written placement rationale (`egress.ts:29-39`: an echoed hostile URL is already neutralized; `/email` pages render metadata only). This covers the verbatim-echo vector but not a model that *reconstructs* a URL from untrusted fragments in its user-facing reply. Advisory: extend `neutralizeUntrustedOutput` to the chat response render path (or the message component) in a follow-up; candidate for a short ADR amendment documenting the accepted placement.
- **W-2 — Audit writes are fire-and-forget and post-execution.** `void writeAudit(...)` at `handlers.ts:493`, `actions/approvals.ts:73, 147, 229`, `router.ts:308, 387`. An audit-insert failure (or a crash between provider call and audit write) loses the entry while the external action stands; ADR-009's intent is "nothing external happens silently." Failures are logged (`audit.ts:64-75`) but not retried. Advisory: await the execution-outcome audit write (it is not latency-critical), or write a pre-execution `executing` entry; track as debt if deferred.
- **W-3 — ADR housekeeping out of date.** `docs/architecture/decisions/README.md` does not list ADR-013 and still says "Next ADR number: ADR-013" (lines 24-26). ADR-013 also carries an open in-ADR action: "Get written confirmation from Nango … record the answer in this ADR" (ADR-013:71) — the runbook has the step but the ADR has no recorded answer yet. Additionally, ADR-009 still references ADR-005 (n8n) as the execution worker, which ADR-013 superseded in practice; ADR-009/ADR-005 should be annotated. As ADR owner tasks, these belong in the PR or immediately after.

### Info

- **I-1 — Delegation chain records `nango_connection_id: null` at every call site** (`router.ts:318, 397`; `approvals.ts:82, 156, 238`; `handlers.ts:502`). The ADR-013 §Audit Trail shape is present but the connection identifier is never populated, even though executors resolve it. Low effort to thread through; improves the delegation record's forensic value.
- **I-2 — `handleSubmitForApproval` inserts via the service client** (`handlers.ts:473`) rather than an auth-scoped client. This matches the pre-existing chat-handler pattern (all handlers are service-client with explicit `userId` scoping, and the chat route authenticates before dispatch), so it is pattern-conformant — noted because the queue insert is security-relevant; the M-3 re-fetch and pending-only lifecycle contain the risk.
- **I-3 — Epic 5 shipped `gmail.send` alongside `gmail.readonly`.** The epic and ADR-013 flagged readonly-before-send as an *option*, not a requirement — a deliberate, permitted choice; note it in the PR since it widens the pilot injection blast radius that the approval queue then mitigates.
- **I-4 — Table count drift:** the security audit's positive-controls section says "all 6 tables" (`epic-5-security-audit.md:132`), omitting `followup_candidates` (wave 5.4.3, migration `20260705050000`). This review verified the seventh table independently: RLS enabled, `user_id` + cascade, SELECT/UPDATE-only for users, service-role cron writes (`050000:22-89`). No action needed beyond awareness.
- **I-5 — Duplicated Nango config constants** between `lib/integrations/nango.ts:22-27` and `actions/integrations.ts` (documented mirror). Acceptable now; consolidate into one shared server-only module when the long-tail epic touches this code.

---

## 8. Follow-Ups / Tracked Debt (recommend recording before or with the PR)

| # | Item | Suggested vehicle |
|---|------|-------------------|
| D-1 | Security audit L-3 (provider error-body logging — log stable provider error codes only) and L-4 (calendar-description framing when `get_calendar_event` ships) | Already tracked in `docs/reports/security/implemented-waves/epic-5-security-audit.md:85-105`; carry into the long-tail/calendar-tool epic backlog |
| D-2 | W-1: extend egress neutralization to the user-facing chat render path; record the accepted tool-result placement | ADR-013 amendment or short ADR-014 |
| D-3 | Meeting-prep matching heuristics (ilike substring only; no semantic matching; alias matching name-column-only pending a GIN/unnest function) — documented at `meeting-prep.ts:110-114, 176-177, 220-222, 258-260` | Epic 6 (cross-context queries) backlog item |
| D-4 | W-2: await/pre-write execution audit entries | Small fix; could land in the PR itself |
| D-5 | W-3: ADR index update (add ADR-013, bump next number to ADR-014); record Nango ELv2 written confirmation in ADR-013; annotate ADR-005/ADR-009 re: n8n supersession | Docs commit on this branch or immediately after merge |
| D-6 | I-1: populate `nango_connection_id` in the audit delegation chain | Small fix, any time |
| D-7 | ADR-013 standing reviews: re-check Nango free-tier scope ~every 6 months; CASA budget + Microsoft publisher verification before productization | Productization epic checklist |

---

## 9. Readiness Assessment

**Ready for PR from `epic/5-communications-intelligence` to `development`.**

The three governing ADRs are implemented faithfully: Nango is verifiably the only token path with zero raw tokens at rest; the approval queue + append-only audit gate holds the zero-trust invariant with an explicit 613-line automated proof; meeting prep is deterministic with a self-enforcing no-LLM test. The security remediation (H-1, M-1–M-3, L-1, L-2) is confirmed in code and migrations. The provider-routing seam for the future long-tail epic is present, documented at the exact extension point, and fails closed for unknown providers. The deviations found are advisory-grade — audit-write ordering (W-2) and egress placement (W-1) are the two worth a decision comment in the PR; neither blocks merge. Per the project workflow, open the PR to `development` and hand off — do not merge.
