---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.3"
wave: "5.3.2"
agents: []
tags: [coriven, execution, zero-trust, gmail-send, calendar-write, audit, comms-tools]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/decisions/ADR-005-n8n-replaceable-worker.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.3.2: Execution Path & Zero-Trust Enforcement

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 5.3.2 |
| Feature | 5.3 — Approval Queue, Audit & Execution |
| Epic | 5 — Communications Intelligence |
| Status | Planning |
| Scope | Approved-action executor (direct Gmail send + Google Calendar writes via validated descriptor; n8n hookup point defined but not wired); comms chat tools (`list_emails`, `get_email_thread`, `create_email_draft`, `submit_for_approval` already in registry, `list_calendar_events`, `get_meeting_prep`); zero-trust enforcement test suite; end-to-end "draft → approve → sent" acceptance path. |
| Wave Goal | An approved `send_email` action results in a real email sent via Gmail; an approved `create_calendar_event` results in a real event created; every execution writes an audit log entry; the executor never fires for any row not in status `approved` or `modified` — verified by a mandatory zero-trust test. |

**Wave Philosophy:** The executor is the narrowest possible surface — it reads one validated descriptor from a pre-approved queue row and calls one external API. All trust decisions are upstream.

## Wave Goals

1. The executor reads only `approved` or `modified` rows from `approval_queue`, calls the appropriate direct Gmail/Calendar API, sets `status = 'executed'`, and writes an `audit_log` entry; no row in any other status is ever acted upon (ADR-009, ADR-005).
2. The six comms chat tools (`list_emails`, `get_email_thread`, `create_email_draft`, `submit_for_approval`, `list_calendar_events`, `get_meeting_prep`) are registered, handled, and gated by `tool_permissions` (Business Requirements Feature 6, UC-31/32/33/34).
3. A mandatory zero-trust enforcement test suite runs in CI and passes: untrusted content (email body saying "schedule a meeting") cannot cause an execution without a visible `approval_queue` row in `approved` status; the executor rejects any `pending` row.

## User Stories

---

### Story 5.3.2.1 — Approved-Action Executor (Direct API)

**As the** Approval Executor actor,
**I want** to execute approved actions by calling Gmail or Google Calendar APIs directly,
**So that** the user's approved intent is fulfilled without any intermediate workflow tool required at launch.

**Reference:** Business Requirements Feature 7, UC-16, UC-34, UC-37; ADR-005 (n8n swappable); ADR-009.

**Priority:** Critical
**Estimated hours:** 16

**Acceptance Criteria:**
- An `executeApproval(approvalId)` function reads the `approval_queue` row; if `status` is not `approved` or `modified`, it throws a typed `ExecutionBlockedError` and makes no external call.
- For `action_type = 'send_email'`: calls Gmail `users.messages.send` with the validated payload fields only; never passes raw AI text directly as the email body without the user having reviewed it on the ApprovalCard.
- For `action_type = 'create_calendar_event'`: calls Google Calendar `events.insert` with validated payload fields.
- For `action_type = 'cancel_calendar_event'`: calls Google Calendar `events.delete` with the validated `event_id`.
- On success: sets `approval_queue.status = 'executed'`, `reviewed_at = now()`; writes `audit_log` row `{ event_type: 'action_executed', entity_id: approvalId, actor: 'executor', payload: { action_type, outcome: 'success' } }`.
- On failure: sets `approval_queue.status = 'failed'`; writes `audit_log` row `{ event_type: 'action_failed', payload: { action_type, error: <sanitized message> } }`; error message must not contain token values or raw email content.
- The executor is called from the `approveAction` Server Action (Wave 5.3.1) after the queue row is set to `approved`; it is NOT called from any other path.
- n8n hookup point: `executeApproval` contains a documented extension comment showing where `N8N_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET` would be used to delegate execution — but the direct API path is the default.

#### Task 5.3.2.1.1 — Executor Service

| Field | Value |
|---|---|
| Parent Story | 5.3.2.1 |
| Agent | Backend Engineer |
| Estimation | 10h |
| Dependencies | Wave 5.3.1 (approval_queue, audit_log, audit-service); Wave 5.1.1 (ensureFreshToken, gmail-client) |
| Deliverables | `apps/web/src/lib/approvals/executor.ts`; updates to `apps/web/src/lib/integrations/gmail-client.ts` (add `sendEmail`); `apps/web/src/lib/integrations/calendar-client.ts` (new: `createEvent`, `cancelEvent`) |

**Acceptance Criteria:**
- `executor.ts` imports `validateApprovalPayload` and re-validates the payload at execution time (defense in depth); throws `ExecutionBlockedError` if validation fails at this stage.
- `gmail-client.ts` `sendEmail(userId, { to, subject, body })` encodes the email as RFC 2822, calls `users.messages.send`; the `body` field comes from the approved payload only.
- `calendar-client.ts` exports `createEvent` and `cancelEvent`; both call `ensureFreshToken` before API calls.
- All three external calls have retry logic (1 retry on 5xx, no retry on 4xx) with exponential backoff.
- Unit tests: executor rejects `pending` row (zero-trust test); executor calls `sendEmail` on `approved send_email` row; executor writes `executed` audit log on success; executor writes `failed` audit log on external API error.

#### Task 5.3.2.1.2 — Wire Executor into `approveAction` Server Action

| Field | Value |
|---|---|
| Parent Story | 5.3.2.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Tasks 5.3.2.1.1; Wave 5.3.1 `approveAction` Server Action |
| Deliverables | Updated `apps/web/src/app/actions/approvals.ts` |

**Acceptance Criteria:**
- `approveAction` and `modifyAndApproveAction` call `executeApproval(approvalId)` after setting `status = 'approved'`/`'modified'`.
- Execution runs server-side within the Server Action; the client receives `{ status: 'executed' }` or `{ status: 'failed', message: '<user-safe message>' }`.
- On `ExecutionBlockedError` from the executor, the Server Action returns a user-facing error without changing the queue row's status (the row remains `approved` for retry).
- ApprovalCard receives the execution outcome and shows "Sent" or "Failed — Retry" feedback.

#### Task 5.3.2.1.3 — n8n Hookup Documentation

| Field | Value |
|---|---|
| Parent Story | 5.3.2.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 5.3.2.1.1 |
| Deliverables | Comment block in `executor.ts`; `.env.example` entries for n8n vars |

**Acceptance Criteria:**
- `executor.ts` contains a clearly marked `// n8n swap point` comment block showing the alternative call: `POST ${N8N_WEBHOOK_URL}` with `Authorization: Bearer ${N8N_WEBHOOK_SECRET}` and the pre-validated descriptor as the body.
- `.env.example` documents `N8N_WEBHOOK_URL` and `N8N_WEBHOOK_SECRET` as optional future vars (commented out by default).
- Swapping from direct API to n8n requires only changing the executor implementation, not the queue schema, approval UI, or audit logic.

---

### Story 5.3.2.2 — Comms Chat Tools

**As the** owner,
**I want** to interact with my email and calendar through the Coriven chat interface,
**So that** I can list emails, read threads, draft replies, and view calendar events through natural conversation.

**Reference:** Business Requirements Feature 6, UC-31, UC-32, UC-33, UC-34; Architecture §"Tool Registry & Handlers."

**Priority:** High
**Estimated hours:** 16

**Acceptance Criteria:**
- The following tools are registered in `ALL_TOOL_NAMES` and `TOOL_REGISTRY` and handled in `handlers.ts`:
  - `list_emails` — lists `email_metadata` rows for the user, filterable by urgency and action_item; returns metadata only (no body).
  - `get_email_thread` — fetches a thread body from Gmail on demand via the existing thread-fetch route; returns `{ subject, from, received_at, body_text }`.
  - `create_email_draft` — assembles a draft payload and calls `submit_for_approval` with `action_type = 'send_email'`; never sends directly.
  - `list_calendar_events` — lists `calendar_events` rows for the user (from the hourly sync; see Wave 5.4.1).
  - `get_meeting_prep` — retrieves the pre-computed meeting prep brief for a given event (from `calendar_events.prep_brief` or a related table; see Wave 5.4.1).
- `submit_for_approval` is already registered from Wave 5.3.1; it is not re-registered here.
- All comms tools require corresponding `tool_permissions` entries; they default to `enabled = true` for the owner.
- `create_email_draft` explicitly does NOT call Gmail send; it calls `submit_for_approval`, demonstrating the zero-trust path in a tool that the model would naively call "send."

#### Task 5.3.2.2.1 — Comms Tool Definitions

| Field | Value |
|---|---|
| Parent Story | 5.3.2.2 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Wave 5.2.1 (email_metadata); Wave 5.3.1 (submit_for_approval tool); Wave 5.4.1 (calendar_events — list_calendar_events/get_meeting_prep may be stubbed if 5.4.1 not yet complete) |
| Deliverables | Updated `apps/web/src/lib/chat/tools/registry.ts` |

**Acceptance Criteria:**
- Each tool has a well-typed JSON-Schema `input_schema` in the registry; required fields are minimal and clearly named.
- `create_email_draft` schema: `{ to: string, subject: string, body: string, in_reply_to?: string }`.
- `list_emails` schema: `{ urgency?: email_urgency, has_action_item?: boolean, limit?: number }`.
- `get_email_thread` schema: `{ thread_id: string }`.
- `list_calendar_events` schema: `{ from_date?: string, to_date?: string, limit?: number }`.
- `get_meeting_prep` schema: `{ event_id: string }`.

#### Task 5.3.2.2.2 — Comms Tool Handlers

| Field | Value |
|---|---|
| Parent Story | 5.3.2.2 |
| Agent | Backend Engineer |
| Estimation | 10h |
| Dependencies | Task 5.3.2.2.1; Wave 5.2.1 Gmail client and email_metadata; Wave 5.3.1 approval-service |
| Deliverables | Updated `apps/web/src/lib/chat/tools/handlers.ts` |

**Acceptance Criteria:**
- `handleListEmails`: queries `email_metadata` via service client filtered by `user_id`; returns JSON array of metadata (no body).
- `handleGetEmailThread`: calls the Gmail thread-fetch service (`getThread`); returns decoded body to Claude; never writes body to DB.
- `handleCreateEmailDraft`: calls `submitApproval(userId, { action_type: 'send_email', description, rationale, payload: { to, subject, body, in_reply_to } })`; returns confirmation message to Claude.
- `handleListCalendarEvents`: queries `calendar_events` table; returns event list. If Wave 5.4.1 is not yet complete, returns a stub "Calendar sync not yet active."
- `handleGetMeetingPrep`: queries meeting prep data for the event; stub if Wave 5.4.1 incomplete.
- All handlers follow the existing `HandlerResult` pattern; errors are caught and returned as `is_error: true`.
- Integration test: `create_email_draft` handler → `approval_queue` row created with `status = 'pending'`; no Gmail send is made.

---

### Story 5.3.2.3 — Zero-Trust Enforcement Test Suite

**As the** developer,
**I want** a mandatory zero-trust enforcement test suite that runs in CI,
**So that** any code change that breaks the invariant "untrusted content cannot trigger an execution" is caught before shipping.

**Reference:** Business Requirements UC-27; Epic 5 Goals ("Untrusted email saying 'schedule a meeting' never auto-acts"); ADR-009 §"Zero-trust spine."

**Priority:** Critical
**Estimated hours:** 10

**Acceptance Criteria:**
- Test 1 — "Pending row never executes": call `executeApproval` with an `approval_queue` row in `status = 'pending'`; assert `ExecutionBlockedError` is thrown; assert no external API call is made; assert no `audit_log` row with `event_type = 'action_executed'` is written.
- Test 2 — "Untrusted content in email body cannot auto-schedule": simulate a Gmail poll that returns an email with body text "Please schedule a meeting with me tomorrow at 3pm"; assert that after the poll and triage cycle, no `approval_queue` row exists and no calendar API call is made.
- Test 3 — "Unknown action_type is rejected": call `submit_for_approval` tool handler with `action_type = 'delete_all_emails'`; assert the handler returns `is_error: true`; assert no `approval_queue` row is created.
- Test 4 — "Cancelled action never executes": set `approval_queue.status = 'cancelled'`; call `executeApproval`; assert `ExecutionBlockedError`; assert no external API call.
- Test 5 — "Executor only fires from the approved Server Action path": assert there is no code path reachable from a client request (non-Server-Action route) that calls `executeApproval`.
- All five tests run as part of the standard `npm test` suite; a CI failure on any of them blocks the Wave 5.3.2 merge.

#### Task 5.3.2.3.1 — Zero-Trust Test Suite

| Field | Value |
|---|---|
| Parent Story | 5.3.2.3 |
| Agent | Backend Engineer |
| Estimation | 8h |
| Dependencies | Tasks 5.3.2.1.1, 5.3.2.2.2; Wave 5.2.1 poll job; Wave 5.3.1 tool handler |
| Deliverables | `apps/web/src/__tests__/zero-trust-enforcement.test.ts` |

**Acceptance Criteria:**
- Tests are isolated (mocked Supabase, mocked Gmail/Calendar API clients); no real network calls.
- Test file is named with a `zero-trust` prefix so it is easy to identify in CI output.
- Test 5 is implemented as a static analysis check or architecture test (e.g., asserting `executeApproval` is not imported by any file in `app/api/` other than Server Actions or the executor itself).

#### Task 5.3.2.3.2 — CI Gate Configuration

| Field | Value |
|---|---|
| Parent Story | 5.3.2.3 |
| Agent | DevOps / Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 5.3.2.3.1 |
| Deliverables | CI workflow update (GitHub Actions or equivalent) to block merge if zero-trust tests fail |

**Acceptance Criteria:**
- The zero-trust test suite is included in the required CI checks for the `epic/5-communications-intelligence` branch and any PR targeting `main`.
- Failure of zero-trust tests produces a clearly labeled CI step failure ("Zero-Trust Enforcement Tests FAILED").

---

## Task Dependencies

```
Wave 5.3.1 (approval_queue, audit_log, audit-service, approveAction Server Action)
Wave 5.1.1 (ensureFreshToken, gmail-client)
  │
  ├─> 5.3.2.1.1 (executor service)
  │     ├─> 5.3.2.1.2 (wire into approveAction)
  │     └─> 5.3.2.1.3 (n8n hookup docs)
  │
  ├─> 5.3.2.2.1 (comms tool definitions)
  │     └─> 5.3.2.2.2 (comms tool handlers)
  │
  └─> [5.3.2.1.1 + 5.3.2.2.2] → 5.3.2.3.1 (zero-trust test suite)
                                      └─> 5.3.2.3.2 (CI gate)
```

Critical path: executor service → wire into Server Action → zero-trust tests → CI gate.
Parallel: comms tool definitions/handlers can be built alongside the executor.

## Definition of Done

- Approved `send_email` action results in a real email sent from the user's Gmail account; `audit_log` records `action_executed`.
- Approved `create_calendar_event` results in a real Google Calendar event; `audit_log` records `action_executed`.
- Failed execution sets `status = 'failed'` and writes an audit entry; the ApprovalCard shows "Failed — Retry."
- All five zero-trust enforcement tests pass in CI; merge to `main` is blocked if any fail.
- Comms tools (`list_emails`, `get_email_thread`, `create_email_draft`, `list_calendar_events`, `get_meeting_prep`) are all callable from chat and return correct responses.
- `create_email_draft` demonstrably calls `submit_for_approval` and not Gmail send — verified by integration test.
- n8n hookup point is documented in `executor.ts` and `.env.example`; the swap requires no schema or UI changes.
- Security review sign-off: a human review of `executor.ts` and `approvals.ts` is completed before this wave merges to `main`.

## Infrastructure Specifications

### Database

No new tables in this wave. `approval_queue` and `audit_log` from Wave 5.3.1 are used:

- Executor reads `approval_queue` by `id`; updates `status` to `executed` or `failed`.
- Executor writes to `audit_log` via `audit-service.ts` (service-role).

### API

| Method | Path | Auth | Purpose | Key Validation |
|---|---|---|---|---|
| Server Action | `approveAction(id)` (updated) | Session (auth-server) | Approve + execute | Status guard; calls executor after status update |
| Server Action | `modifyAndApproveAction(id, payload)` (updated) | Session (auth-server) | Modify + approve + execute | Payload re-validation; status guard; calls executor |

**Direct API calls made by the executor (not exposed as HTTP endpoints):**

- Gmail `users.messages.send` — called only from `executeApproval`; never from a route handler directly.
- Google Calendar `events.insert` / `events.delete` — same constraint.

**n8n (future):** `POST ${N8N_WEBHOOK_URL}` with `Authorization: Bearer ${N8N_WEBHOOK_SECRET}` and a validated descriptor body. No route changes required to enable this swap.

### UI

- `ApprovalCard` updated to show execution outcome: "Executing..." during call, "Sent" on success, "Failed — Retry" on failure.
- Retry: clicking "Retry" calls `approveAction` again (the row stays in `approved` status on `ExecutionBlockedError`); executor is retried.
- No new pages in this wave.

### Testing

- **Unit:** `executor.ts` — all five zero-trust test cases (pending blocked, unknown type blocked, cancelled blocked, success path, failure path + audit); Gmail `sendEmail` mock; Calendar `createEvent` mock.
- **Integration:** Full path — `submit_for_approval` tool → `approval_queue pending` → `approveAction` → `executeApproval` → `audit_log executed`; assert Gmail mock called exactly once.
- **Zero-trust enforcement tests (mandatory CI gate):** `apps/web/src/__tests__/zero-trust-enforcement.test.ts` — all 5 tests as specified in Story 5.3.2.3.
- **Token-encryption test (regression):** assert `executor.ts` never logs or returns the raw access token from `ensureFreshToken`; only the encrypted form in the DB.
- **Coverage target:** >85% on `executor.ts`.

### Deployment

**Environment variables (add to `.env.example` as optional/future):**

- `N8N_WEBHOOK_URL` — n8n execution webhook; optional; executor uses direct API if unset.
- `N8N_WEBHOOK_SECRET` — shared secret for n8n webhook; optional.

**Security review gate:** A human code review of `executor.ts` and updated `approvals.ts` is a required deployment step before this wave ships to production. The review checklist includes: no token in logs, payload validated before execution, status guard present, audit write on every outcome.

### Monitoring

- Track: execution success rate per `action_type`; execution failure rate; avg execution latency.
- Alert: if `failed` rows in `approval_queue` exceed 5% of `executed` rows in a 24h window.
- AI cost: comms tools add Sonnet turns; monitor per-conversation tool-call count.
- Audit completeness: periodic check that every `executed` row in `approval_queue` has a corresponding `audit_log` row with `event_type = 'action_executed'`.

## Handoff Requirements

- Zero-trust test suite passing in CI before this wave's branch merges.
- Security review of executor and Server Actions completed.
- End-to-end acceptance test run: "Draft a reply to Sarah declining tomorrow" → `/approvals` → Approve → email lands in Sarah's inbox → `audit_log` row confirmed.
- `.env.example` updated with n8n vars (commented out).
- Wave 5.4.1 (Calendar Sync) may proceed in parallel; `list_calendar_events` and `get_meeting_prep` tool handlers are stubbed until Wave 5.4.1 completes.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Executor called from a non-Server-Action path (architectural regression) | Critical | Low | Zero-trust Test 5 (import path check) + code review gate |
| Gmail send scope not granted during OAuth (Wave 5.1.1 connected read-only) | High | Medium | Confirm `gmail.send` scope is included in Wave 5.1.1 OAuth scopes; reconnect required if scope was missed |
| Execution retry causes duplicate send | High | Low | Check Gmail idempotency key (`threadId` + timestamp); or mark `failed` rows as non-retryable in v1 |
| n8n never wired in, docs rot | Low | Medium | Document the swap point in executor and in the product plan; revisit at Phase 5 |

## Related Documentation

- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- ADR-005 (n8n as replaceable worker): referenced in Architecture ADR section.
- ADR-009 (approval queue + audit gate): `docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md`
- Wave 5.3.1 (prerequisite — queue, audit, Server Actions): `docs/implementation/iterations/wave-5.3.1-approval-queue-audit.md`
- Wave 5.1.1 (prerequisite — token refresh, Gmail client): `docs/implementation/iterations/wave-5.1.1-integrations-encrypted-tokens.md`
- Business Requirements Feature 7, UC-16, UC-27, UC-29, UC-34, UC-37: `docs/architecture/_main/03-Business-Requirements.md`
