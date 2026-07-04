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
feature: "5.1"
wave: "5.1.2"
agents: []
tags: [coriven, nango, oauth, integrations, settings, ui]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/implementation/iterations/wave-5.1.1-nango-infrastructure.md"
---

# Wave 5.1.2: Provider Connect/Disconnect UI

## Wave Overview
- **Wave ID:** Wave-5.1.2
- **Feature:** Feature 5.1 - Nango Integration & Provider Connect UI
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Integrations settings page showing connection status for Gmail, Outlook, and Google Calendar; user-initiated OAuth connect flow through Nango with the resulting connection recorded in the integrations registry; disconnect flow that revokes the Nango connection and removes the record.
- **Wave Goal:** A user can connect and disconnect Gmail, Outlook, and Google Calendar from Coriven's settings, with granted scopes visible and every connection isolated to its owner — completing Feature 5.1.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. An authenticated user can see at a glance which of the three providers are connected, when each was connected, and with what scopes.
2. Connecting a provider runs the full OAuth flow through Nango and ends with a durable connection record owned by that user — Coriven never handles a raw token at any point in the flow.
3. Disconnecting a provider revokes the connection in Nango and removes Coriven's record, leaving no orphaned state on either side.
4. All connect/disconnect state changes happen through authenticated server-side actions with clear success and failure feedback in the UI.

## User Stories

### User Story 1: See my connection status

**As a** Coriven user
**I want** a settings page listing Gmail, Outlook, and Google Calendar with their current connection state
**So that** I always know which accounts Coriven can access and what permissions I granted

**Acceptance Criteria:**
- [ ] The integrations settings page lists all three providers, each clearly marked connected or not connected.
- [ ] A connected provider shows when it was connected and the scopes that were granted, in user-readable form.
- [ ] I only ever see my own connections — never another user's.
- [ ] The page is reachable from the app's main settings navigation.

**Priority:** High

---

### User Story 2: Connect a provider

**As a** Coriven user
**I want** to click Connect on a provider and complete its OAuth consent flow
**So that** Coriven can read and act on that account in later features, with only the minimum permissions requested

**Acceptance Criteria:**
- [ ] Clicking Connect launches the provider's OAuth consent flow via Nango, requesting only the minimum scopes defined for that provider (ADR-013).
- [ ] On successful consent, the provider shows as connected without a manual refresh, and a connection record exists for my account.
- [ ] If I cancel or the flow fails, I see a clear message and no partial connection record is left behind.
- [ ] Attempting to connect an already-connected provider does not create a duplicate connection.

**Priority:** High

---

### User Story 3: Disconnect a provider

**As a** Coriven user
**I want** to disconnect a provider at any time
**So that** Coriven immediately loses access to that account and no stale credentials linger anywhere

**Acceptance Criteria:**
- [ ] Clicking Disconnect asks for confirmation before doing anything destructive.
- [ ] On confirmation, the connection is revoked in Nango and my connection record is removed; the provider shows as not connected.
- [ ] After disconnecting, server-side token retrieval for that provider fails with a "not connected" result.
- [ ] If revocation fails transiently, I see an error and can retry; the UI never claims a disconnect succeeded when it did not.

**Priority:** High

---

### User Story 4: Connection changes are secure by construction

**As the** owner accountable for the security spine
**I want** every connect and disconnect to execute server-side under my authenticated session
**So that** no client can forge, hijack, or enumerate connections and no Nango secret is ever exposed to the browser

**Acceptance Criteria:**
- [ ] Connect and disconnect state changes are performed by authenticated server-side actions; unauthenticated requests are rejected.
- [ ] A user cannot connect, view, or disconnect on behalf of another user, verified by test.
- [ ] No Nango secret key or provider token appears in any client-delivered code, network response, or log.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Record connection after OAuth success
- **Endpoint:** Connect Server Action
- **Method:** POST (Server Action)
- **Test Data:** Authenticated user, provider `gmail`, successful Nango connect result
- **Expected Result:** Connection record created for the user with provider, connection ID, and scopes
- **Verification:** Settings page reflects connected state; duplicate connect attempt does not create a second record

### Test Case 2: Reject unauthenticated connect
- **Endpoint:** Connect Server Action
- **Method:** POST (Server Action)
- **Test Data:** No authenticated session
- **Expected Result:** Request rejected; no record created
- **Verification:** Integrations table unchanged

### Test Case 3: Disconnect revokes and removes
- **Endpoint:** Disconnect Server Action
- **Method:** POST (Server Action)
- **Test Data:** Authenticated user with a connected `outlook` provider
- **Expected Result:** Nango connection deleted; integrations row removed
- **Verification:** Token wrapper returns "not connected" for that user/provider afterwards

### Test Case 4: Cross-user isolation
- **Endpoint:** Disconnect Server Action
- **Method:** POST (Server Action)
- **Test Data:** User B attempts to disconnect user A's connection
- **Expected Result:** Rejected; user A's connection untouched
- **Verification:** User A's record and Nango connection still present

## Technical Tasks

### Task 1: Connect flow (Server Action + Nango session handshake)
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Wave 5.1.1 complete (live Nango, `integrations` table, token wrapper)
- **Priority:** High

**Deliverables:**
- Server Action that authorizes the user, initiates the Nango connect session for the requested provider, and records the resulting connection (provider, connection ID, scopes) on success
- Idempotency on the user/provider pair (no duplicates)
- Unit tests for success, cancel/failure, duplicate, and unauthenticated paths

**Acceptance Criteria:**
- [ ] Behaves per User Stories 2 and 4 acceptance criteria
- [ ] Failure paths leave no partial connection record

---

### Task 2: Disconnect flow (Server Action + Nango revocation)
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 1 (shared auth/ownership checks)
- **Priority:** High

**Deliverables:**
- Server Action that verifies ownership, deletes the connection in Nango, and removes the integrations record
- Defined ordering/compensation so a Nango failure does not leave Coriven claiming disconnection
- Unit tests for success, Nango-failure, cross-user, and unauthenticated paths

**Acceptance Criteria:**
- [ ] Behaves per User Stories 3 and 4 acceptance criteria
- [ ] Post-disconnect token retrieval returns "not connected"

---

### Task 3: Integrations settings page
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1 and Task 2 (actions to wire against)
- **Priority:** High

**Deliverables:**
- Settings page listing the three providers with status, connected-at, and readable scopes
- Connect button launching the Nango OAuth flow; Disconnect button with confirmation dialog
- Loading, success, and error feedback states; settings navigation entry

**Acceptance Criteria:**
- [ ] Behaves per User Story 1 acceptance criteria
- [ ] State updates without manual refresh after connect and disconnect

---

### Task 4: Feature verification pass
- **Agent:** quality-control
- **Estimation:** 4 hours
- **Dependencies:** Tasks 1-3
- **Priority:** Medium

**Deliverables:**
- Executed test cases 1-4 with evidence (test output)
- Manual end-to-end connect/disconnect against all three providers on dev accounts
- Security spot-check: no secrets or tokens in client bundles, responses, or logs

**Acceptance Criteria:**
- [ ] All four logical test cases pass
- [ ] All three providers complete a real connect and disconnect round-trip

## Task Dependencies

```
Wave 5.1.1 (complete)
      ↓
Task 1 (connect flow)
      ↓
Task 2 (disconnect flow)
      ↓
Task 3 (settings page)   ← consumes Tasks 1 & 2
      ↓
Task 4 (verification)
```

**Critical path:** Task 1 → Task 3 → Task 4.
**Parallel stream:** Task 3's static UI (layout, states) can start alongside Task 1/2 using stubbed data; final wiring waits on the actions. Task 2 can proceed in parallel with Task 3 wiring.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2 | 10 |
| frontend-specialist | Task 3 | 6 |
| quality-control | Task 4 | 4 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing (cross-user isolation, post-disconnect token denial)
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Security check passed: no secrets/tokens client-side; all state changes authenticated server-side
- [ ] Documentation updated
- [ ] Manual end-to-end connect/disconnect verified for Gmail, Outlook, and Google Calendar
- [ ] Deployed to the development environment

## Handoff Requirements

**For Feature 5.2 (Email Triage):**
- Users can hold live Gmail and Outlook connections; polling work can rely on the token wrapper plus real connections existing.

**For Feature 5.4 (Calendar Intelligence):**
- Google Calendar connections available through the same flow.

**For future long-tail epic (ADR-013 Layer 3):**
- The integrations settings page is the established home for all connect/disconnect UI; any future provider connect flows extend this page rather than creating a new surface.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Nango frontend connect-session pattern differs from assumed flow | Med | Prototype the connect handshake first in Task 1 before building the full page around it |
| Unverified Google OAuth app shows warning screens to users | Med | Acceptable during validation with test accounts; verification underway per epic risk register |
| Disconnect leaves inconsistent state on partial failure (Nango vs DB) | Med | Defined operation ordering with compensation in Task 2; UI reports failure honestly and supports retry |
| Popup/redirect handling varies across browsers | Low | Verify the OAuth flow in the major browsers during Task 4 |

## Notes and Assumptions

- Wave 5.1.1 must be fully complete before this wave starts — live Nango with all three provider configs is a hard prerequisite.
- Scope display is informational; users cannot pick scopes — minimum scopes per ADR-013 are fixed per provider.
- Reconnecting after a provider-side revocation is treated as a fresh connect (disconnect then connect); no dedicated repair flow in this wave.
- Effort figures are scope-based estimates for a solo developer wearing the listed agent hats.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.1)
- Architecture Decision: docs/architecture/decisions/ADR-013-integration-token-authority.md
- Prior Wave: docs/implementation/iterations/wave-5.1.1-nango-infrastructure.md

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
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
