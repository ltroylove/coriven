---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-02T00:00:00"
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
tags: [coriven, execution, nango, zapier, gmail, outlook, calendar, adr-013]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/implementation/iterations/wave-5.3.1-approval-queue-audit.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 5.3.2: Execution Routing

## Wave Overview
- **Wave ID:** Wave-5.3.2
- **Feature:** Feature 5.3 - Approval Queue, Audit & Execution
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: The execution layer behind an approval: on approve, route by provider — deep providers (Gmail, Outlook, Google Calendar) execute via direct provider API with a Nango-fetched token; long-tail providers execute via an authenticated typed webhook to Zapier — and both paths record the outcome in the append-only audit log and drive the queue item to `executed` or `failed`.
- **Wave Goal:** An approved action actually happens — through the correct provider path, with the result fully audited and visible to the user.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Approving a queued action triggers execution routed by its provider: deep integrations call the provider API directly with a token fetched server-side from Nango; long-tail actions fire a typed, secret-authenticated webhook to Zapier.
2. Every execution — success or failure — appends an audit entry via the service-role writer and moves the queue item to `executed` or `failed`, with no silent outcomes.
3. Failed executions are visible on the approvals page with the failure reason and a retry option, so nothing approved is ever lost.

## User Stories

### User Story 1: Approved email actually sends

**As a** Coriven user
**I want** an approved email draft to be sent through my connected Gmail or Outlook account immediately after I approve it
**So that** the approve step is the last thing I need to do

**Acceptance Criteria:**
- [ ] On approve, the email is sent through the connected provider matching the queue item, using exactly the approved (possibly modified) payload — never regenerated content.
- [ ] The provider token is obtained server-side from Nango at execution time; no token is ever stored or logged by Coriven.
- [ ] The queue item moves to `executed` with an execution timestamp, and the approvals page reflects the sent state.
- [ ] If the send fails, the item moves to `failed` with a human-readable reason.

**Priority:** High

---

### User Story 2: Approved calendar event is created

**As a** Coriven user
**I want** an approved calendar action to create the event on my connected calendar
**So that** scheduling proposals become real events only after my sign-off

**Acceptance Criteria:**
- [ ] On approve, the event is created on the target calendar with the approved title, time, and attendees from the validated payload.
- [ ] Execution uses the same Nango token path and status/audit behavior as email sends.
- [ ] The created event's provider reference is recorded so the user can confirm it landed.

**Priority:** High

---

### User Story 3: Approved long-tail action fires via Zapier

**As a** Coriven user
**I want** approved actions targeting long-tail apps (e.g. Slack) to execute through my Zapier-connected apps
**So that** the same approval gate covers everything my life runs on, not just email and calendar

**Acceptance Criteria:**
- [ ] When the provider is long-tail, execution posts a typed payload to the Zapier endpoint authenticated with a shared secret header; unauthenticated or malformed requests are impossible to emit.
- [ ] The webhook payload contains only the action parameters — never tokens, credentials, or unrelated PII.
- [ ] Zapier's response confirms execution and drives the item to `executed`; a non-confirming or failed response drives it to `failed`.
- [ ] The routing decision is data-driven from the queue item's provider — no long-tail action can reach the direct-API path and vice versa.

**Priority:** High

---

### User Story 4: No execution without a trace, no failure without a retry

**As a** Coriven user
**I want** every execution outcome recorded in the audit log and every failure surfaced with a retry
**So that** I can always answer "did that actually happen?" and recover when it didn't

**Acceptance Criteria:**
- [ ] Every execution attempt (both paths, success and failure) appends an audit entry with action type, provider, resulting status, error code when applicable, and timestamp — written only by the service-role path.
- [ ] Failed items appear on the approvals page with the failure reason and a retry control; retry re-executes the already-approved payload without a new approval.
- [ ] An item can never reach `executed` without a corresponding audit entry, and duplicate execution of the same approval is prevented.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Deep-provider execution on approve
- **Endpoint:** Approve Server Action → execution router
- **Method:** POST (Server Action)
- **Test Data:** Approved `send_email` item for Gmail (provider API mocked)
- **Expected Result:** Token fetched from Nango, provider send called with approved payload, status → `executed`
- **Verification:** Provider mock received exact payload; audit entry appended; `executed_at` stamped

### Test Case 2: Long-tail execution routes to Zapier
- **Endpoint:** Approve Server Action → execution router
- **Method:** POST (Server Action)
- **Test Data:** Approved `zapier_action` item (webhook endpoint mocked)
- **Expected Result:** POST fired with secret header and typed payload; on confirmation, status → `executed`
- **Verification:** Request carried the secret header; payload contained action parameters only; audit entry appended

### Test Case 3: Execution failure produces `failed` + audit + retry
- **Endpoint:** Approve Server Action → execution router; retry action
- **Method:** POST (Server Action)
- **Test Data:** Provider mock returns an error; then retry with mock succeeding
- **Expected Result:** Status → `failed` with error code and audit entry; retry drives it to `executed`
- **Verification:** Failure reason visible in queue row; second audit entry on retry; no duplicate provider calls on success

### Test Case 4: Only approved items execute, exactly once
- **Endpoint:** Execution router invoked against non-approved and already-executed items
- **Method:** POST (Server Action)
- **Test Data:** Items in `pending`, `cancelled`, and `executed` states; concurrent double-approve attempt
- **Expected Result:** All refused; no provider or webhook call occurs
- **Verification:** Provider/webhook mocks never invoked; statuses unchanged; refusal logged

## Technical Tasks

### Task 1: Execution router (provider-based dispatch)
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Wave 5.3.1 complete
- **Priority:** High

**Deliverables:**
- Server-side router invoked by the approve/retry actions that selects the deep-API or Zapier path from the queue item's provider, with single-execution guards

**Acceptance Criteria:**
- [ ] Routing is data-driven from provider type; unknown providers fail closed with a `failed` status and audit entry
- [ ] Executes only items in `approved` (or `failed` via retry) status; guards against concurrent double execution
- [ ] Router owns the status transition and delegates audit writes to the Wave 5.3.1 audit service

---

### Task 2: Gmail and Outlook send executors
- **Agent:** backend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 1; Feature 5.1 Nango token wrapper
- **Priority:** High

**Deliverables:**
- Executors that fetch a token from Nango and send email via the Gmail API and Microsoft Graph using the approved payload

**Acceptance Criteria:**
- [ ] Sends use exactly the approved payload; minimum write scopes assumed from Feature 5.1
- [ ] Tokens are fetched per call, never persisted or logged
- [ ] Provider errors are mapped to structured error codes for audit and UI display

---

### Task 3: Google Calendar / Outlook Calendar event executor
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1; Feature 5.1 Nango token wrapper
- **Priority:** High

**Deliverables:**
- Executor creating calendar events from the approved payload via the connected calendar provider, returning the provider event reference

**Acceptance Criteria:**
- [ ] Event fields map from the validated payload only
- [ ] Provider event reference recorded on the queue item for user confirmation
- [ ] Same token, error-code, and audit behavior as the email executors

---

### Task 4: Zapier webhook executor
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Executor that POSTs the typed action payload to the configured Zapier endpoint with the `X-Webhook-Secret` header and interprets the confirmation response

**Acceptance Criteria:**
- [ ] Secret sourced from environment configuration; never logged; request fails closed if unset
- [ ] Payload restricted to action parameters — a payload-shape test proves no token or credential fields can be included
- [ ] Non-2xx or non-confirming responses produce `failed` with a retryable error code

---

### Task 5: Failure surfacing and retry on the approvals page
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Tasks 1-4
- **Priority:** Medium

**Deliverables:**
- Approvals page updates: executed/failed states with outcome detail, failure reason display, and a retry control on failed items

**Acceptance Criteria:**
- [ ] Failed items show the human-readable reason and a one-click retry
- [ ] Executed items show execution time and (where available) the provider reference
- [ ] Retry is only offered on `failed` items

---

### Task 6: Execution-path verification suite
- **Agent:** quality-control
- **Estimation:** 6 hours
- **Dependencies:** Tasks 1-5
- **Priority:** High

**Deliverables:**
- Automated coverage of the four logical test cases with mocked providers and webhook endpoint; regression pass on Wave 5.3.1 behavior

**Acceptance Criteria:**
- [ ] All logical test cases pass deterministically without live provider calls
- [ ] Single-execution guard verified under a simulated concurrent approve
- [ ] Wave 5.3.1 decision flow unaffected

## Task Dependencies

```
Wave 5.3.1 (complete)
  ↓
Task 1 (execution router)
  ├─> Task 2 (Gmail/Outlook executors)   ─┐  (parallel)
  ├─> Task 3 (calendar executor)          ├─> Task 5 (failure UI + retry)
  └─> Task 4 (Zapier webhook executor)   ─┘        ↓
                                             Task 6 (verification)
```

**Critical path:** Task 1 → Task 2 → Task 5 → Task 6.
**Parallel streams:** Tasks 2, 3, and 4 are independent once the router lands.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3, Task 4 | 26 |
| frontend-specialist | Task 5 | 5 |
| quality-control | Task 6 | 6 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (mocked providers + webhook)
- [ ] Code coverage ≥ 90% on router and executors
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security scan passed (no high/critical issues; no tokens in logs verified)
- [ ] Documentation updated
- [ ] Wave demo completed (approve → real send on a test account → `executed` + audit entry)
- [ ] Deployed to staging environment

## Handoff Requirements

**For next wave (5.3.3):**
- Complete propose → approve → execute pipeline as the test target for zero-trust enforcement
- Execution router as the single insertion point for the Epic 3 constraint pre-check
- Error-code taxonomy for audit assertions in security tests

**For other Features/Epics:**
- Feature 5.4: calendar write path ready for meeting/follow-up actions
- Feature 5.5: Zapier executor is the long-tail execution path; only connect UI and catalog remain
- Epic 6: audited execution outcomes available to proactive summaries

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Duplicate execution (double-approve, retry race) | High | Single-execution guard on status transition; execution only from `approved`/`failed`; concurrency test in CI |
| Token leakage into logs or audit entries | High | Tokens fetched per call and scoped to the executor; log-content assertions in tests; audit writer strips unknown fields |
| Zapier outage strands approved long-tail actions | Medium | Items stay `failed` with retryable code; retry control on the approvals page; short-backoff retry per Epic risk plan |
| Provider API drift (Gmail/Graph/Calendar) | Medium | Executors isolated per provider behind the router; error-code mapping localizes breakage |
| Webhook secret misconfiguration silently disables long-tail path | Medium | Executor fails closed with explicit error code when secret unset; startup/env validation |

## Notes and Assumptions

- Feature 5.1 (Nango + connect UI) is live; write scopes (`gmail.send`, `calendar.events`, Graph equivalents) were requested at connect time.
- The Zapier Embed connect UI ships in Feature 5.5 — this wave delivers the execution path and can be verified against a manually configured Zapier webhook.
- Execution runs synchronously within the approve action for now; a queued/background executor is a future optimization, not in scope.
- The Epic 3 constraint pre-check at execution time is deliberately deferred to Wave 5.3.3 so it lands with its test coverage.

## Infrastructure Specifications

### Execution routing contract

```
approve(item) [Server Action]
  1. guard: item.status == 'approved' (or 'failed' via retry); claim execution atomically
  2. route on item.provider:
       deep (gmail | outlook | google-calendar):
         token = nango.getToken(providerConfigKey, connectionId)  [server-side only]
         call provider API with item.payload
       long-tail (zapier:*):
         POST typed payload → Zapier Embed endpoint
         headers: { X-Webhook-Secret: <env secret> }  [constant-time comparison server-side]
  3. on success: status → 'executed'; stamp executed_at
     on failure: status → 'failed'; store error_code
  4. append audit_log entry via service-role writer (both outcomes)
```

**Webhook payload shape (long-tail):** `{ approval_id, action_type, params: { ...action parameters only } }` — never tokens, connection IDs beyond what Zapier requires, or raw external content.

**Environment:** Zapier webhook URL + `X-Webhook-Secret` value via environment configuration (documented in `.env.example`); Nango server credentials already established by Feature 5.1.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.3)
- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture: docs/architecture/decisions/ADR-013-integration-token-authority.md; docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md
- Prior wave: docs/implementation/iterations/wave-5.3.1-approval-queue-audit.md

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
**Last Updated:** 2026-07-02
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
