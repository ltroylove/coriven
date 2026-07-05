---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-04"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "6"
feature: "6.3"
wave: "6.3.1"
agents: []
tags: [coriven, approvals, api, notifications, adr-013, thin-shell]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 6.3.1: Approvals Pending Endpoint

## Wave Overview
- **Wave ID:** Wave-6.3.1
- **Feature:** Feature 6.3 - Briefing & Approval Delivery
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: The one backend artifact Epic 6 adds: a new authenticated `GET /api/approvals/pending` endpoint in `apps/web` that returns only the notification metadata a client needs to alert the user about pending approvals — a count plus minimal per-item identifiers — never the raw action payload. Includes unit tests. Tray consumption is out of scope (Wave 6.3.2).
- **Wave Goal:** Any authenticated client can ask "does this user have approvals waiting?" and get a safe, minimal, RLS-scoped answer suitable for driving a notification.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A pending-approvals summary is available over the API to any authenticated client, scoped strictly to the requesting user's own queue.
2. The response carries only what a notification needs — count and minimal item metadata — and can never leak the raw action payload (recipient, subject, body, URLs), whose review surface remains the web `/approvals` page (ADR-013).
3. The endpoint's contract is covered by unit tests so the tray (Wave 6.3.2) can build against it with confidence.

## User Stories

### User Story 1: A client can learn that approvals are waiting

**As a** Coriven user with a desktop client
**I want** the backend to report how many approvals are pending for me, and what kind they are
**So that** a notification can alert me the moment the assistant is waiting on my decision

**Acceptance Criteria:**
- [ ] An authenticated request returns the number of my pending approval items along with, for each item, its identifier, action type, provider, and creation time.
- [ ] Only items still awaiting a decision are included — approved, cancelled, executed, and failed items never appear.
- [ ] When nothing is pending, the response is a successful empty summary (count of zero), not an error.
- [ ] Items are ordered newest first so a client can surface the most recent proposal.

**Priority:** High

---

### User Story 2: Notification metadata never exposes the payload

**As a** Coriven user
**I want** the pending-approvals summary to exclude the raw action content
**So that** sensitive draft content (recipients, subjects, bodies, links) is never exposed to a polling client or an OS notification surface, and payload review stays in the web approvals page where I decide

**Acceptance Criteria:**
- [ ] The response contains no payload fields, no AI-generated summary text, and no fragment of recipient, subject, body, or URL content — under any input.
- [ ] The exclusion is structural (the sensitive columns are never selected or serialized), not a post-hoc filter, and a test proves the serialized response contains only the whitelisted fields.
- [ ] Reviewing the actual action content remains possible only in the web approvals UI, consistent with the raw-payload-in-web-UI principle (ADR-013 §Security).

**Priority:** High

---

### User Story 3: The summary is private to its owner

**As a** Coriven user
**I want** the pending-approvals summary to be authenticated and scoped to me alone
**So that** no other user — and no anonymous caller — can learn anything about my approval queue

**Acceptance Criteria:**
- [ ] Unauthenticated requests are rejected with an authentication error and reveal nothing (no counts, no ids).
- [ ] An authenticated user's response reflects only their own queue items; another user's pending items never appear, enforced by row-level security rather than application filtering alone.
- [ ] Failures (database errors) return a generic error without leaking queue contents or internals.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Pending items return as metadata-only summary
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** Authenticated user with two `pending` items (one `send_email`/`gmail`, one `create_calendar_event`/`google_calendar`) and one `approved` item
- **Expected Result:** 200 with `count: 2` and two items (id, action_type, provider, created_at), newest first; the approved item absent
- **Verification:** Response matches the contract exactly; serialized body contains no `payload`, `ai_summary`, recipient, subject, or body content

### Test Case 2: Empty queue returns zero, not an error
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** Authenticated user with no pending items (any mix of terminal-state items allowed)
- **Expected Result:** 200 with `count: 0` and an empty items array
- **Verification:** Status is 200 (a poller must distinguish "nothing pending" from "call failed")

### Test Case 3: Unauthenticated request is rejected
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** Request with no session
- **Expected Result:** 401 with a generic error
- **Verification:** No count, ids, or queue information in the body

### Test Case 4: Cross-user isolation
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** User A authenticated; User B has pending items; User A has none
- **Expected Result:** 200 with `count: 0` for User A
- **Verification:** User B's item ids never appear in User A's response (RLS-scoped client)

## Technical Tasks

### Task 1: `GET /api/approvals/pending` route
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (Epic 5 `approval_queue` table live)
- **Priority:** High

**Deliverables:**
- New API route in `apps/web` implementing the contract in Infrastructure Specifications, using the RLS-scoped auth server client and selecting only the whitelisted columns
- Structured error logging consistent with existing API routes (e.g. the briefing route)

**Acceptance Criteria:**
- [ ] Returns the documented response shape for pending items, empty queue, unauthenticated, and error cases
- [ ] Queries only `pending` status, ordered newest first, selecting only id, action type, provider, and created time
- [ ] No payload or AI-summary column is ever selected or returned

---

### Task 2: Shared response types
- **Agent:** backend-specialist
- **Estimation:** 2 hours
- **Dependencies:** None
- **Priority:** Medium

**Deliverables:**
- Exported TypeScript types for the pending-approvals response (summary + item shape) in the shared types package so the tray (Wave 6.3.2) imports the same contract instead of redefining it

**Acceptance Criteria:**
- [ ] The route's response is typed against the shared types (compile-time drift protection)
- [ ] Types intentionally have no field capable of carrying payload content

---

### Task 3: Unit tests and verification pass
- **Agent:** quality-control
- **Estimation:** 4 hours
- **Dependencies:** Tasks 1, 2
- **Priority:** High

**Deliverables:**
- Unit tests covering all four logical test cases, including the serialized-response whitelist assertion from User Story 2

**Acceptance Criteria:**
- [ ] All four logical test cases pass
- [ ] A dedicated test asserts the response body's keys are exactly the whitelisted set (no payload leakage path)
- [ ] Existing `/approvals` page and approval Server Actions behave unchanged

## Task Dependencies

```
Task 1 (route)      Task 2 (shared types)
   └──────┬──────────────┘
          ↓
   Task 3 (tests + verification)
```

**Critical path:** Task 1 → Task 3.
**Parallel streams:** Task 2 can proceed alongside Task 1; the route adopts the shared types before Task 3.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2 | 6 |
| quality-control | Task 3 | 4 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing (including the no-payload whitelist test)
- [ ] Integration behavior verified against a real queue with mixed statuses
- [ ] Code coverage ≥ 90% on the route logic
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security scan passed (no high/critical issues)
- [ ] Documentation updated
- [ ] Wave demo completed (curl as an authenticated user → metadata-only summary)
- [ ] Deployed to staging environment

## Handoff Requirements

**For next wave (6.3.2):**
- Stable `GET /api/approvals/pending` contract (documented below) — the tray polls it and renders a notification from `count` + item metadata
- Shared response types importable by the tray codebase
- Guarantee the tray can rely on: a 200 with `count: 0` means "nothing pending" (no 404 special case to handle)

**For other Features/Epics:**
- Epic 7 (Proactive Intelligence): the same summary endpoint can drive proactive approval nudges without a new backend artifact
- Epic 8 (Productization / mobile Web Push): the metadata-only shape is already safe for push notification payloads

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Payload content leaks into the notification surface via a future "helpful" field addition | High | Whitelist-shaped select + shared types with no payload-capable field + a test asserting the exact key set |
| Endpoint semantics drift from the tray's polling assumptions (404 vs empty-200) | Med | Contract fixed here: empty queue is 200/count 0; documented in handoff and asserted in tests |
| Polling endpoint becomes a load hotspot | Low | Query is a covered index lookup (`approval_queue_user_status_idx`); single user in validation phase |

## Notes and Assumptions

- The `approval_queue` table, statuses, and RLS policies from Wave 5.3.1 are live and unchanged; this wave adds no migration.
- `count` is derived from the same query as the items (no separate count round-trip) — item lists are expected to be small.
- Unlike `/api/briefing/today` (404 when no row), an empty queue here is a normal 200 — a poller treats "no pending approvals" as data, not absence.
- No pagination: a single user's simultaneous pending approvals are expected to be few; revisit only if evidence says otherwise.

## Infrastructure Specifications

### API Contract: `GET /api/approvals/pending`

**Auth:** Session-authenticated via the RLS-scoped auth server client (`createAuthServerClient` pattern, same as `/api/briefing/today`). RLS on `approval_queue` guarantees user scoping even if application filtering regressed.

**Query:** `approval_queue` where `user_id = auth.uid()` (RLS) and `status = 'pending'`, ordered `created_at DESC`, selecting only `id, action_type, provider, created_at`.

**Responses:**

```jsonc
// 200 OK — pending items exist
{
  "count": 2,
  "items": [
    {
      "id": "7f3c9a2e-...",                  // approval_queue.id (uuid)
      "action_type": "send_email",           // e.g. 'send_email' | 'create_calendar_event' | ...
      "provider": "gmail",                   // e.g. 'gmail' | 'outlook' | 'google_calendar' | ...
      "created_at": "2026-07-04T14:02:11Z"   // ISO 8601
    },
    { "id": "...", "action_type": "create_calendar_event", "provider": "google_calendar", "created_at": "..." }
  ]
}

// 200 OK — nothing pending
{ "count": 0, "items": [] }

// 401 — no authenticated user
{ "error": "Unauthorized" }

// 500 — database/internal failure (generic; details go to structured logs only)
{ "error": "Internal error" }
```

**Never present (ADR-013 §Security):** `payload`, `ai_summary`, or any recipient/subject/body/URL content. This endpoint answers "is something waiting?" — reviewing *what* is waiting happens only on the web `/approvals` page.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.3)
- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md
- Architecture: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md; ADR-009; ADR-013 (§Security — raw payload review is web-UI only)

## Wave Retrospective

{This section will be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Last Updated:** 2026-07-04
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
