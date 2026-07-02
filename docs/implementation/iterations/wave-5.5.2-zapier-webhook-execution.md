---
datecreated: "2026-07-02"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "5"
feature: "5.5"
wave: "5.5.2"
agents: []
tags: [coriven, zapier, webhook, long-tail, approval-queue, audit-log, execution, tool-catalog]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.5.2: Zapier Webhook Execution Path

## Wave Overview
- **Wave ID:** Wave-5.5.2
- **Feature:** Feature 5.5 - Zapier Embed — Long-Tail Connectors
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: The execution path for approved long-tail actions — routing from the approval queue to an authenticated, typed Zapier webhook; audit logging of the outcome; failure surfacing with retry; and exposing Zapier-connected app actions to Claude as available tool targets.
- **Wave Goal:** An approved long-tail action executes via Zapier with a typed, credential-free payload, its result is recorded in the audit trail, and Claude knows which long-tail actions are available to propose.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Approved actions targeting long-tail providers execute exclusively via an authenticated Zapier webhook — never before approval, never bypassing the approval queue (the ADR-009 invariant: untrusted input → propose → approve → execute).
2. Webhook payloads are typed and minimal: action parameters only, never tokens, and no PII beyond what the action itself requires.
3. Every Zapier execution outcome — success or failure — is written to the append-only audit trail, and failures are surfaced to the user with a retry path.
4. Claude's tool catalog reflects the user's actually-connected Zapier apps, so proposed long-tail actions target only apps the user has connected.

## User Stories

### User Story 1: Approved Long-Tail Action Executes via Zapier

**As a** Coriven user
**I want** an action I approve against a long-tail app (e.g., post to Slack, add a Notion row) to execute through my Zapier-connected apps
**So that** Coriven can act across everything my life runs on, not just email and calendar

**Acceptance Criteria:**
- [ ] When an approved action's provider is a long-tail app, execution routes to Zapier rather than a direct provider API
- [ ] Zapier is contacted only after explicit user approval — a pending or cancelled action never triggers a webhook
- [ ] Zapier's execution confirmation transitions the approval record to executed
- [ ] Deep-integration execution (direct API path from Feature 5.3) is unchanged

**Priority:** High

---

### User Story 2: Credential-Free, Authenticated Webhook Payloads

**As the** Coriven operator
**I want** every webhook to Zapier authenticated with a shared secret and to carry only typed action parameters
**So that** the long-tail path cannot leak tokens or PII and cannot be spoofed

**Acceptance Criteria:**
- [ ] Outbound webhooks carry the shared-secret authentication header on every request
- [ ] Any inbound webhook confirmation is verified against the shared secret using a constant-time comparison; unauthenticated requests are rejected
- [ ] Payloads conform to a typed schema (action type, parameters, minimal user context) and are validated before send
- [ ] Payloads never contain OAuth tokens, credentials, or PII beyond what the specific action requires

**Priority:** High

---

### User Story 3: Audited Execution Outcomes

**As a** Coriven user
**I want** every long-tail execution recorded in my audit trail with its outcome
**So that** I can always see what Coriven did on my behalf and whether it succeeded

**Acceptance Criteria:**
- [ ] Every Zapier execution attempt writes an audit record with provider, action type, timestamps, and success/failure status
- [ ] Audit records contain no token values and no raw response bodies
- [ ] The audit trail remains append-only; the Zapier path introduces no update or delete of audit records

**Priority:** High

---

### User Story 4: Failed Executions Surfaced with Retry

**As a** Coriven user
**I want** to see when an approved long-tail action failed to execute and be able to retry it
**So that** a Zapier outage or transient error never silently swallows something I approved

**Acceptance Criteria:**
- [ ] A failed Zapier execution marks the approval record as failed and is visible in the approvals view
- [ ] The user can retry a failed action; retry re-fires the webhook without requiring re-approval
- [ ] Failures are audited alongside successes

**Priority:** Medium

---

### User Story 5: Claude Sees Zapier-Connected Actions as Tool Targets

**As a** Coriven user
**I want** Claude to know which long-tail apps I've connected and what actions they support
**So that** Claude proposes actions against my actual apps instead of guessing or proposing impossible actions

**Acceptance Criteria:**
- [ ] Claude's available action targets include the long-tail apps the user has connected via Zapier (from Wave 5.5.1 metadata)
- [ ] Claude does not offer long-tail actions for apps the user has not connected
- [ ] Long-tail actions proposed by Claude flow through the standard approval submission — no new direct-execution capability is granted to Claude

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: Long-Tail Routing on Approval
- **Endpoint:** Approval execution (server action)
- **Method:** POST
- **Test Data:** Approved queue item with a long-tail provider; Zapier endpoint mocked
- **Expected Result:** Webhook POST fired with typed payload and secret header; item transitions to executed on confirmed response
- **Verification:** No direct provider API called; payload matches schema; audit record written with success status

### Test Case 2: No Execution Without Approval
- **Endpoint:** Approval execution (server action)
- **Method:** POST
- **Test Data:** Queue item in pending and in cancelled states, long-tail provider
- **Expected Result:** Execution refused; no webhook fired
- **Verification:** Zapier mock receives zero calls; item status unchanged; no audit execution record

### Test Case 3: Inbound Confirmation Authentication
- **Endpoint:** Zapier confirmation webhook receiver
- **Method:** POST
- **Test Data:** Valid payload with missing, wrong, and correct secret header
- **Expected Result:** Missing/wrong secret rejected with an authentication error; correct secret accepted
- **Verification:** Rejection occurs before any processing; comparison is constant-time; no state change on rejected requests

### Test Case 4: Payload Contains No Credentials
- **Endpoint:** Webhook payload builder (unit level)
- **Method:** N/A (unit)
- **Test Data:** Approved action whose stored context includes connection identifiers
- **Expected Result:** Serialized payload contains only action type, parameters, and minimal user context
- **Verification:** Payload asserted free of token-like fields, connection secrets, and unrelated PII

### Test Case 5: Failure Path and Retry
- **Endpoint:** Approval execution + retry (server action)
- **Method:** POST
- **Test Data:** Zapier mock returning an error, then success on retry
- **Expected Result:** First attempt marks the item failed with a failure audit record; retry succeeds and marks executed
- **Verification:** Both attempts audited; item visible as failed in the approvals view between attempts

## Technical Tasks

### Task 1: Typed Webhook Payload Schema
- **Agent:** backend-specialist
- **Estimation:** 3-5 hours
- **Dependencies:** None (Wave 5.5.1 complete)
- **Priority:** High

**Deliverables:**
- Shared typed schema for Zapier webhook payloads (action type, parameters, minimal user context) with runtime validation
- Explicit exclusion of credential and token fields by construction

**Acceptance Criteria:**
- [ ] Payloads failing validation are never sent
- [ ] Schema is shared between the execution router and tests

---

### Task 2: Execution Router — Long-Tail Branch
- **Agent:** backend-specialist
- **Estimation:** 6-8 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Approval-queue execution routing extended: long-tail provider → authenticated POST to Zapier
- Shared-secret header on outbound requests; constant-time verification on inbound confirmations
- Approval status transitions (executed / failed) driven by Zapier's response

**Acceptance Criteria:**
- [ ] Only approved items can reach the Zapier branch
- [ ] Deep-provider routing behavior from Feature 5.3 is regression-free

---

### Task 3: Audit Logging + Failure Surfacing with Retry
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- Audit record written for every Zapier execution attempt (success and failure), service-role only, append-only
- Failed items surfaced in the approvals view with a retry action that re-fires the webhook without re-approval

**Acceptance Criteria:**
- [ ] Audit records exclude token values and raw response bodies
- [ ] Retry is idempotent with respect to approval state (no duplicate approval required)

---

### Task 4: Claude Tool Catalog — Zapier Action Targets
- **Agent:** backend-specialist
- **Estimation:** 4-8 hours
- **Dependencies:** Task 2
- **Priority:** Medium

**Deliverables:**
- Claude's tool/action catalog extended with long-tail targets derived from the user's Zapier-typed integration records
- Proposed long-tail actions routed through the standard approval submission tool

**Acceptance Criteria:**
- [ ] Catalog reflects only apps the user has actually connected
- [ ] No new direct-execution path is exposed to Claude

---

### Task 5: Approvals UI — Failed/Retry States for Long-Tail Actions
- **Agent:** frontend-specialist
- **Estimation:** 3-5 hours
- **Dependencies:** Task 3
- **Priority:** Medium

**Deliverables:**
- Approvals view rendering failed long-tail executions with error context and a retry control
- Executed long-tail actions displayed consistently with deep-integration executions

**Acceptance Criteria:**
- [ ] A failed long-tail action is visually distinct and retryable from the approvals view
- [ ] Retry feedback (success/failure) is reflected without page reload confusion

---

### Task 6: Wave Verification (Including Security Tests)
- **Agent:** quality-control
- **Estimation:** 5-8 hours
- **Dependencies:** Task 3, Task 4, Task 5
- **Priority:** High

**Deliverables:**
- Automated tests covering all logical unit test cases, including the no-execution-without-approval invariant and payload credential-freedom
- End-to-end verification against a live or sandboxed Zapier Zap

**Acceptance Criteria:**
- [ ] All logical unit test cases pass
- [ ] Zero-trust invariant test (approval gate) passes explicitly for the Zapier path

## Task Dependencies

```
Task 1 (payload schema)
  ↓
Task 2 (execution router — long-tail branch)
  ├─> Task 3 (audit + failure/retry) ──> Task 5 (approvals UI states)
  └─> Task 4 (Claude tool catalog)          │
              │                             │
              └────────────┬────────────────┘
                           ▼
                Task 6 (wave verification)
```

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3, Task 4 | 17-27 |
| frontend-specialist | Task 5 | 3-5 |
| quality-control | Task 6 | 5-8 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Code coverage ≥ 90%
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security scan passed (no high/critical issues)
- [ ] Documentation updated
- [ ] Wave demo completed
- [ ] Deployed to staging environment

## Handoff Requirements

**For next wave (n/a — Feature 5.5 completes with this wave):**
- Feature 5.5 is complete; both integration layers (Nango deep, Zapier long-tail) execute through the single approval-queue gate

**For other Features/Epics:**
- Epic 6 (proactive intelligence) can propose long-tail actions through the same catalog and approval path with no new execution plumbing
- Security review (epic-level requirement) should include the Zapier webhook path: secret handling, payload minimization, and the approval-gate invariant
- User-deletion cascade must cover long-tail audit and approval records per epic compliance requirements

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Zapier outage blocks approved long-tail actions | Med | Approved-but-unexecuted items remain queued, surface as failed with retry; short-backoff retry per epic risk table |
| Zapier webhook response is asynchronous or less confirmatory than assumed | Med | Design status transitions around the actual response contract during Task 2; treat unconfirmed sends as pending-failure until confirmed |
| Long-tail execution less observable than direct APIs (logs live in Zapier) | Med | Audit both attempt and confirmed outcome in Coriven; rely on Zapier's webhook response as the execution receipt (ADR-013 consequence) |
| Action catalog mismatch — Claude proposes an action a connected app cannot perform | Med | Catalog derived from a curated action list per connected app, not free-form; failures still gated and audited, never silent |
| Per-task Zapier consumption cost at scale | Low | Monitor task counts during validation; pricing question tracked from ADR-013 open questions |

## Notes and Assumptions

- Feature 5.3 (approval queue, audit, execution routing skeleton) and Wave 5.5.1 (Zapier connections + `integration_type` + webhook secret provisioning) are complete before this wave starts.
- The approval queue is the only gate: Zapier is contacted strictly post-approval; Claude gains proposal capability only, never execution capability.
- Coriven treats the Zapier webhook response as the execution receipt; deeper execution logs live in Zapier and are out of Coriven's audit scope by design.
- External content remains untrusted end-to-end; nothing returned by Zapier is passed to Claude as instructions.
- The precise Zapier trigger/response contract (synchronous confirmation vs. callback) is confirmed at the start of Task 2; the wave scope covers either shape.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture Decision: docs/architecture/decisions/ADR-013-integration-token-authority.md (Layer 3, Security Constraints)
- Architecture Decision: ADR-009 — Approval queue + append-only audit as the external-action gate
- Prior Wave: docs/implementation/iterations/wave-5.5.1-zapier-embed-setup.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9, §11, §17.4)

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
