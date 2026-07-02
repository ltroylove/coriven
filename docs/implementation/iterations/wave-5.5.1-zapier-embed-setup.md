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
wave: "5.5.1"
agents: []
tags: [coriven, zapier, zapier-embed, integrations, long-tail, connect-ui, settings]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 5.5.1: Zapier Embed Setup + Connect UI

## Wave Overview
- **Wave ID:** Wave-5.5.1
- **Feature:** Feature 5.5 - Zapier Embed — Long-Tail Connectors
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Zapier Embed SDK integration, the `integration_type` distinction on stored integrations, and the connect/disconnect experience for long-tail apps inside the existing integrations settings page. Coriven stores connection metadata only — Zapier owns all long-tail credentials.
- **Wave Goal:** A user can connect and disconnect any long-tail app through Zapier Embed inside Coriven's settings, and Coriven records which apps are connected without ever holding credentials.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Users connect long-tail apps (any of Zapier's 6,000+ connectors) from within Coriven's integrations settings via the Zapier Embed white-label UI — no separate Zapier account visible to the user.
2. Coriven distinguishes Nango-managed deep integrations from Zapier-managed long-tail connections in its integrations records, and never stores long-tail credentials.
3. Users can see their connected long-tail apps alongside deep integrations and disconnect any of them, with Coriven's metadata staying consistent with Zapier's connection state.

## User Stories

### User Story 1: Connect a Long-Tail App via Zapier Embed

**As a** Coriven user
**I want** to connect apps like Slack, Notion, or my fitness tracker from inside Coriven's integrations settings
**So that** Coriven can act on those apps for me without me managing a separate Zapier account

**Acceptance Criteria:**
- [ ] The integrations settings page presents a Zapier Embed section where the user can browse and connect long-tail apps
- [ ] The connect flow completes entirely within Coriven's UI (white-label embed) and the user's credentials are handled by Zapier, never by Coriven
- [ ] After a successful connection, the newly connected app appears in the user's integrations list

**Priority:** High

---

### User Story 2: See Connected Apps Distinguished by Integration Type

**As a** Coriven user
**I want** my integrations page to show which connections are deep integrations and which are long-tail apps
**So that** I understand what Coriven can query directly versus what it can only trigger actions against

**Acceptance Criteria:**
- [ ] Every stored integration is typed as either a Nango connection or a Zapier connection
- [ ] Existing deep-integration records are classified correctly with no manual cleanup required
- [ ] The integrations page visually groups or labels long-tail connections separately from deep integrations
- [ ] Long-tail integration records contain display metadata only — no tokens, secrets, or credentials of any kind

**Priority:** High

---

### User Story 3: Disconnect a Long-Tail App

**As a** Coriven user
**I want** to disconnect a long-tail app I previously connected
**So that** Coriven stops offering or firing actions against that app

**Acceptance Criteria:**
- [ ] Each connected long-tail app offers a disconnect action in the integrations settings
- [ ] After disconnect, the app no longer appears as connected and Coriven's stored metadata for it is removed
- [ ] A disconnected app is no longer available as a target for future long-tail actions

**Priority:** Medium

---

### User Story 4: Operator Configuration for the Zapier Layer

**As the** Coriven operator
**I want** the Zapier Embed integration and its webhook shared secret configured through environment settings
**So that** the long-tail layer is deployable per environment without secrets in code

**Acceptance Criteria:**
- [ ] The Zapier webhook shared secret is supplied via environment configuration and documented in the environment template
- [ ] The application starts and the integrations page degrades gracefully when Zapier configuration is absent (e.g., local dev without Zapier)
- [ ] No Zapier secret or account credential is committed to the repository

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Persist Zapier Connection Metadata
- **Endpoint:** Integrations connection persistence (server action)
- **Method:** POST
- **Test Data:** Authenticated user; Zapier connection event for a long-tail app (app name, connection identifier)
- **Expected Result:** Integration record created with type `zapier` and display metadata only
- **Verification:** Record belongs to the acting user, contains no credential fields, and is typed `zapier`

### Test Case 2: List Integrations by Type
- **Endpoint:** Integrations listing for the settings page
- **Method:** GET
- **Test Data:** User with one Nango connection and one Zapier connection
- **Expected Result:** Both records returned with correct `integration_type` values
- **Verification:** Deep and long-tail connections are distinguishable in the response; RLS restricts results to the requesting user

### Test Case 3: Disconnect a Zapier Connection
- **Endpoint:** Integrations disconnect (server action)
- **Method:** POST/DELETE
- **Test Data:** Authenticated user; existing Zapier-typed integration record
- **Expected Result:** Record removed; subsequent listing omits the app
- **Verification:** Metadata deleted for the acting user only; another user's connections are unaffected

## Technical Tasks

### Task 1: `integration_type` Migration
- **Agent:** backend-specialist
- **Estimation:** 2-4 hours
- **Dependencies:** None
- **Priority:** High

**Deliverables:**
- Migration adding a typed `integration_type` column (`nango` | `zapier`) to the integrations table
- Backfill classifying all existing rows as `nango`
- Regenerated database types for the app

**Acceptance Criteria:**
- [ ] Column enforces the two allowed values and defaults sensibly for existing flows
- [ ] All pre-existing integration rows are typed `nango` after migration

---

### Task 2: Zapier Embed SDK Setup + Environment Configuration
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours
- **Dependencies:** None
- **Priority:** High

**Deliverables:**
- Zapier Embed SDK installed and initialized for the web app
- `ZAPIER_WEBHOOK_SECRET` added to environment configuration and the environment template
- Graceful degradation when Zapier configuration is absent

**Acceptance Criteria:**
- [ ] Embed SDK loads for authenticated users in the settings context
- [ ] Missing Zapier configuration does not break the app or the integrations page

---

### Task 3: Connect UI — Zapier Embed Section in Integrations Settings
- **Agent:** frontend-specialist
- **Estimation:** 6-8 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- Zapier Embed section rendered within the existing integrations settings page
- Connect flow via the embed component, styled consistently with the deep-integration section
- Long-tail connections labeled or grouped distinctly from deep integrations

**Acceptance Criteria:**
- [ ] A user can complete an end-to-end connect flow for a long-tail app without leaving Coriven
- [ ] Connected long-tail apps render in the integrations list with clear type labeling

---

### Task 4: Connection Metadata Persistence + Disconnect Flow
- **Agent:** backend-specialist
- **Estimation:** 4-8 hours
- **Dependencies:** Task 1, Task 3
- **Priority:** High

**Deliverables:**
- Server-side persistence of Zapier connection metadata (type `zapier`, display metadata only) on connect
- Disconnect flow removing Coriven's metadata and reflecting Zapier's connection state
- RLS-scoped access so users only ever see their own connections

**Acceptance Criteria:**
- [ ] Connect and disconnect keep Coriven's records consistent with Zapier's connection state
- [ ] No credential material is ever written to Coriven's database

---

### Task 5: Wave Verification
- **Agent:** quality-control
- **Estimation:** 4-6 hours
- **Dependencies:** Task 4
- **Priority:** Medium

**Deliverables:**
- Automated tests covering the logical unit test cases above
- Manual verification of the end-to-end connect/disconnect experience

**Acceptance Criteria:**
- [ ] All logical unit test cases pass
- [ ] A stored Zapier integration record is confirmed to contain metadata only (no credentials)

## Task Dependencies

```
Task 1 (migration)          Task 2 (Embed SDK + env)
      │                            │
      │                     Task 3 (connect UI)
      │                            │
      └────────────┬───────────────┘
                   ▼
        Task 4 (metadata persistence + disconnect)
                   ▼
        Task 5 (wave verification)
```

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 4 | 10-18 |
| frontend-specialist | Task 3 | 6-8 |
| quality-control | Task 5 | 4-6 |

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

**For next wave (5.5.2):**
- Zapier-typed integration records available to query which long-tail apps a user has connected
- Zapier Embed account/app configuration live, with `ZAPIER_WEBHOOK_SECRET` provisioned per environment
- `integration_type` distinction available to the execution router for provider routing

**For other Features/Epics:**
- Integrations settings page now covers both integration layers; Feature 5.1 UI conventions extended, not forked
- User-deletion cascade (Epic compliance requirement) must include Zapier connection metadata

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Zapier Embed account approval or partner onboarding delays | High | Start Zapier partner/Embed signup before implementation begins; keep the UI section feature-flagged until live |
| Embed SDK capabilities differ from assumptions (connect events, white-labeling limits) | Med | Time-boxed SDK spike at the start of Task 2; adjust the connect-event persistence design before Task 4 |
| Connection state drift between Zapier and Coriven metadata | Med | Treat Zapier as the source of truth; reconcile on integrations page load where the SDK exposes connection state |
| Zapier Embed pricing per connected user | Med | Validate pricing during this wave (ADR-013 open question 2) before productization commitments |

## Notes and Assumptions

- Coriven stores connection metadata only for display and routing; Zapier owns all long-tail credentials (ADR-013 Layer 3).
- Deep integrations (Gmail, Outlook, Calendar) remain on Nango and are untouched by this wave beyond the type column backfill.
- `ZAPIER_WEBHOOK_SECRET` is provisioned in this wave but only consumed by the execution path in Wave 5.5.2.
- The exact Zapier Embed package and event surface will be confirmed during Task 2; the wave scope does not change if the package name differs.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture Decision: docs/architecture/decisions/ADR-013-integration-token-authority.md (Layer 3)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§11, §17.4, §20)

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
