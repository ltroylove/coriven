---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.3"
wave: "5.3.1"
agents: []
tags: [coriven, approvals, audit, zero-trust, adr-009]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 5.3.1: Approval Queue + Audit Foundation

## Wave Overview
- **Wave ID:** Wave-5.3.1
- **Feature:** Feature 5.3 - Approval Queue, Audit & Execution
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: The approval and audit data layer, the `submit_for_approval` assistant tool, and the `/approvals` review UI — every proposed external-world action lands as a pending queue item that the user can Approve, Modify, or Cancel, with each decision recorded in an append-only audit log. Execution of approved actions is out of scope (Wave 5.3.2).
- **Wave Goal:** Deliver the trust gate itself — a validated approval queue, an append-only audit trail, and a review surface — so no external action can ever bypass human review.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Every external-world action the assistant proposes is captured as a validated, typed pending item in the approval queue — never executed directly.
2. The user can review, modify, cancel, or approve any pending item from a single approvals surface, with enough context (what + why) to decide quickly.
3. Every state change on an approval is recorded in an append-only audit log that user-facing code can read but never write, modify, or delete.

## User Stories

### User Story 1: Assistant proposes actions instead of acting

**As a** Coriven user
**I want** the assistant to submit any external-world action (send email, create event, post to an app) as a proposal for my approval
**So that** nothing changes the outside world without my explicit consent

**Acceptance Criteria:**
- [ ] When the assistant decides an external action is needed, it submits a proposal with a typed action type, target provider, human-readable description, and structured payload — the action itself does not execute.
- [ ] Proposals with an unknown action type or a payload that fails validation for that action type are rejected at submission and never enter the queue.
- [ ] A submitted proposal appears in the queue with status `pending` and is visible only to its owning user.
- [ ] The assistant's reply confirms the proposal was queued and tells the user where to review it.

**Priority:** High

---

### User Story 2: Review pending approvals in one place

**As a** Coriven user
**I want** an approvals page listing everything waiting on my decision
**So that** I can see exactly what the assistant wants to do and why before anything happens

**Acceptance Criteria:**
- [ ] The approvals page lists all of my pending items, newest first. Each item displays the **raw action payload** — exact recipient, subject, full body, and URLs — not a summary. An LLM-generated plain-language description may accompany the raw payload but never replaces it: the summary is model output and can be injection-influenced, so approval must be based on what will actually be sent (approval-context integrity; ADR-013 §Security).
- [ ] Items in terminal states (cancelled, executed, failed) are viewable in a history section, separated from pending items.
- [ ] I can never see another user's approvals, and unauthenticated visitors are redirected to sign in.
- [ ] An empty queue shows a clear empty state rather than a blank page.

**Priority:** High

---

### User Story 3: Approve, Modify, or Cancel a proposal

**As a** Coriven user
**I want** a single three-way decision on each pending item — approve it, edit the payload then approve, or cancel it
**So that** the review step is fast and I stay in control of the final content

**Acceptance Criteria:**
- [ ] Approving a pending item moves it to `approved` and stamps the review time; in this wave the item stops at `approved` (execution arrives in Wave 5.3.2).
- [ ] Modifying lets me edit the user-editable payload fields inline; the edited payload is re-validated before the item can be approved.
- [ ] Cancelling moves the item to `cancelled`; cancelled items can never be executed later.
- [ ] Decisions are only accepted on items in `pending` status — acting on an already-decided item is rejected with a clear message.
- [ ] Only the owning user can decide their own items.

**Priority:** High

---

### User Story 4: Every decision leaves an immutable trace

**As a** Coriven user (and future compliance reviewer)
**I want** every approval decision written to an append-only audit log
**So that** there is a complete, tamper-proof record of what was proposed, decided, and by whom

**Acceptance Criteria:**
- [ ] Each approval decision (approve, modify-then-approve, cancel) produces an audit entry linked to the approval item, recording user, action type, provider, resulting status, and timestamp.
- [ ] Each audit entry records the delegation chain — user → Coriven → provider connection — per action, consistent with ADR-013 §Audit Trail and emerging IETF agent-auth conventions.
- [ ] Audit entries contain no secrets, tokens, or raw external content bodies.
- [ ] Attempts by user-facing code paths to insert, update, or delete audit entries are refused at the database level; only the privileged server role can append.
- [ ] The user can read their own audit entries; no one can read another user's.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Proposal submission creates a pending queue item
- **Endpoint:** Chat engine tool invocation (`submit_for_approval`)
- **Method:** POST (chat API)
- **Test Data:** Valid `send_email` proposal with recipient, subject, body for the authenticated user
- **Expected Result:** New approval row with status `pending`, typed action type, validated payload
- **Verification:** Row exists for the user; payload matches submission; no provider API was called

### Test Case 2: Invalid payload is rejected at submission
- **Endpoint:** Chat engine tool invocation (`submit_for_approval`)
- **Method:** POST (chat API)
- **Test Data:** `send_email` proposal missing recipient; proposal with unrecognized action type
- **Expected Result:** Tool returns a validation error; nothing is inserted
- **Verification:** Queue row count unchanged; error message names the failed validation

### Test Case 3: Three-way decision transitions
- **Endpoint:** Approval decision Server Actions
- **Method:** POST (Server Action)
- **Test Data:** One pending item approved; one modified then approved; one cancelled; one cancel attempt on an already-cancelled item
- **Expected Result:** Statuses become `approved`/`approved`/`cancelled`; the repeat decision is rejected
- **Verification:** Status and reviewed-at fields correct; modified payload persisted and re-validated; audit entry exists per decision

### Test Case 4: Audit log is append-only and service-role only
- **Endpoint:** Database policies (audit log table)
- **Method:** INSERT/UPDATE/DELETE via user-context client vs. service client
- **Test Data:** Authenticated user client attempts insert, update, delete; service client appends
- **Expected Result:** All user-client writes fail; service-client append succeeds; user-client SELECT returns only own rows
- **Verification:** RLS/policy errors on user-client writes; appended row readable by owning user only

## Technical Tasks

### Task 1: Approval queue and audit log schema migration
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** None (Feature 5.1 `integrations` table live)
- **Priority:** High

**Deliverables:**
- Migration creating `approval_queue` and `audit_log` tables with RLS policies and indexes (see Infrastructure Specifications)
- Regenerated Supabase TypeScript types
- Shared types for action types, providers, and status lifecycle

**Acceptance Criteria:**
- [ ] Migration applies cleanly to a fresh database and to the current schema
- [ ] RLS verified: users read/write only their own queue rows; audit writes restricted to service role; audit update/delete denied to all
- [ ] Status lifecycle enforced by a check constraint (pending → approved/cancelled → executed/failed)

---

### Task 2: Payload validation module for typed action types
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Validation schemas per action type (`send_email`, `create_event` at minimum), shared by tool submission and the approve/modify path. Schema is extensible — future long-tail action types (ADR-013 Layer 3) add new schemas without modifying existing ones.

**Acceptance Criteria:**
- [ ] Unknown action types and malformed payloads are rejected with structured errors
- [ ] The same validator runs at submit time and again after any user modification
- [ ] Validators are pure functions with full unit coverage

---

### Task 3: `submit_for_approval` assistant tool
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- New chat-engine tool that validates and inserts a pending approval, returning a confirmation the model can relay

**Acceptance Criteria:**
- [ ] Tool is registered in the engine's tool set with a schema that requires action type, provider, description, and payload
- [ ] Passes through the Epic 3 constraint gate like every other tool
- [ ] On success returns the queue item reference; on validation failure returns an error result the model surfaces honestly

---

### Task 4: Audit append service (service-role writer)
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Single server-side module through which all audit entries are appended, using the service-role client exclusively

**Acceptance Criteria:**
- [ ] The module is the only code path that writes audit entries
- [ ] Each entry records the delegation chain (user → Coriven → provider connection) per action (ADR-013 §Audit Trail)
- [ ] Entries never include tokens, secrets, or raw response bodies
- [ ] Structured log emitted per append for observability

---

### Task 5: Approval decision Server Actions (Approve / Modify / Cancel)
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Tasks 2, 4
- **Priority:** High

**Deliverables:**
- Server Actions implementing the three-way decision with status-transition guards, re-validation on modify, and audit append per decision

**Acceptance Criteria:**
- [ ] Only `pending` items accept decisions; stale/duplicate decisions rejected
- [ ] Ownership enforced — a user cannot decide another user's item
- [ ] Every decision appends an audit entry atomically with the status change

---

### Task 6: `/approvals` page UI
- **Agent:** frontend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 5
- **Priority:** High

**Deliverables:**
- Approvals page with pending list, inline Modify editing, Approve/Cancel actions, history section, empty state, and nav link

**Acceptance Criteria:**
- [ ] Pending cards show action type, provider, and the **raw action payload** — exact recipient, subject, full body, and URLs. An LLM-generated description may accompany this display but the raw payload is the primary decision surface (approval-context integrity: the summary is injectable model output)
- [ ] Modify edits are re-validated with inline error display before approval is allowed
- [ ] Page is authenticated and matches existing app styling and navigation patterns

---

### Task 7: Wave verification and regression pass
- **Agent:** quality-control
- **Estimation:** 5 hours
- **Dependencies:** Tasks 3, 6
- **Priority:** High

**Deliverables:**
- Automated coverage for the logical test cases above; regression check on the chat engine and existing tool suite

**Acceptance Criteria:**
- [ ] All four logical test cases pass, including the append-only/service-role database policy checks
- [ ] Existing chat and tool behavior unchanged for users with no approvals

## Task Dependencies

```
Task 1 (schema migration)
  ├─> Task 2 (payload validation)
  │     ├─> Task 3 (submit_for_approval tool)
  │     └─> Task 5 (decision Server Actions)  ←─ also depends on Task 4
  └─> Task 4 (audit append service)
              Task 5 ─> Task 6 (/approvals UI)
  Task 3 & Task 6 ─> Task 7 (verification)
```

**Critical path:** Task 1 → Task 2 → Task 5 → Task 6 → Task 7.
**Parallel streams:** Task 3 (tool) and Task 4 (audit service) can proceed alongside Task 5 once their prerequisites land.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3, Task 4, Task 5 | 26 |
| frontend-specialist | Task 6 | 8 |
| quality-control | Task 7 | 5 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (including RLS/append-only policy tests)
- [ ] Code coverage ≥ 90% on validation and decision logic
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security scan passed (no high/critical issues)
- [ ] Documentation updated
- [ ] Wave demo completed (propose → review → approve/modify/cancel → audit entry visible)
- [ ] Deployed to staging environment

## Handoff Requirements

**For next wave (5.3.2):**
- Stable `approval_queue` schema with `approved` items awaiting execution and the `executed`/`failed` terminal states reserved
- Audit append service as the single audit writer for execution results
- Payload validators reusable by executors (validated payload is the execution descriptor)

**For other Features/Epics:**
- Feature 5.4: calendar write actions submit through this queue
- Future long-tail epic (ADR-013 Layer 3): the action-type schema is extensible; new action types for long-tail providers slot in alongside `send_email` and `create_event` when that epic ships
- Epic 3: `submit_for_approval` already passes the constraint gate; execution-time constraint checks arrive in Wave 5.3.3

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Payload validation gaps let malformed descriptors into the queue | High | Typed schemas per action type; validate at submit AND after modify; unknown types hard-rejected |
| Audit table accidentally writable by user-facing code | High | Policy tests in CI proving user-client insert/update/delete fail; single service-role writer module |
| Approval friction makes the flow feel heavy | Medium | Inline Modify on the card; single three-way decision; description states what + why plainly |
| Status lifecycle race (double-approve, cancel-after-approve) | Medium | Transition guards accept decisions only from `pending`; DB check constraint on status values |

## Notes and Assumptions

- Approving an item in this wave stops at `approved` — the executor (Wave 5.3.2) picks it up; this keeps the trust gate shippable and testable independently.
- Audit entries are decision- and execution-events only; conversational content is not audited here.
- Action-type catalog starts minimal (email send, event create) and grows per feature — the schema is typed but extensible. Long-tail action types (ADR-013 Layer 3) are a future addition.

## Infrastructure Specifications

### Database

```sql
create table approval_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  action_type text not null,                      -- 'send_email' | 'create_event' | ... (extensible)
  provider    text not null,                      -- 'gmail' | 'outlook' | 'google-calendar' | ... (extensible)
  payload     jsonb not null,                     -- validated against the action_type schema
  status      text not null default 'pending'
              check (status in ('pending','approved','cancelled','executed','failed')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  executed_at timestamptz
);

create index approval_queue_user_status_idx on approval_queue (user_id, status, created_at desc);

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  approval_id uuid references approval_queue(id) on delete set null,
  action_type text not null,
  provider    text not null,
  status      text not null,                      -- resulting status at time of entry
  error_code  text,
  executed_at timestamptz not null default now()
);

create index audit_log_user_idx on audit_log (user_id, executed_at desc);
```

**RLS:**
- `approval_queue`: users `select`/`insert`/`update` own rows (`user_id = auth.uid()`); no user `delete`; status transitions guarded in Server Actions.
- `audit_log`: users `select` own rows only. **No** insert/update/delete policies for authenticated users — the service-role client (which bypasses RLS) is the only writer; no `update`/`delete` path exists in application code. Append-only is enforced by the absence of user policies plus the single service-role writer module.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.3)
- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture: docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md; docs/architecture/decisions/ADR-013-integration-token-authority.md

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
