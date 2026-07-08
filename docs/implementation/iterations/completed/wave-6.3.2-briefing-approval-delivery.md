---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-04"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "6"
feature: "6.3"
wave: "6.3.2"
agents: []
tags: [coriven, tray, tauri, briefing, approvals, notifications, thin-shell]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/implementation/iterations/wave-6.3.1-approvals-pending-endpoint.md"
---

# Wave 6.3.2: Briefing & Approval Delivery in the Tray

## Wave Overview
- **Wave ID:** Wave-6.3.2
- **Feature:** Feature 6.3 - Briefing & Approval Delivery
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: The tray's delivery of the two remaining proactive channels: the daily briefing (poll `GET /api/briefing/today` at startup and at the configured briefing time; notify when one is present and undelivered) and approval alerts (poll `GET /api/approvals/pending`; notify when items are pending). Both notifications deep-link to the relevant web page. Reuses the poll/notify/de-duplicate pattern established in Feature 6.2. Thin shell throughout: the tray decides nothing — the API's delivered flag and pending list are the only sources of truth.
- **Wave Goal:** With the browser closed, the user is natively notified when their daily briefing is ready and when the assistant is waiting on an approval — one click lands them on the right web page.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. The daily briefing fires exactly one native notification per briefing — at tray startup or at the configured briefing time, whichever finds it first — and only when the server says it exists and has not been delivered.
2. Pending approvals fire a native notification that tells the user something is waiting (count and kind only — never the action content) and deep-links to the web approvals page.
3. Both channels follow the Feature 6.2 shell discipline: poll, render, de-duplicate locally, recover from offline — no business logic, no direct database access.

## User Stories

### User Story 1: The daily briefing reaches the desktop

**As a** Coriven user
**I want** a native notification when my daily briefing is ready — when the tray starts up or when my configured briefing time arrives
**So that** I get my day's plan without having a browser open

**Acceptance Criteria:**
- [ ] On tray startup, if today's briefing exists and is undelivered, a native notification fires announcing it.
- [ ] At the configured briefing time, if today's briefing exists and is undelivered, the same notification fires.
- [ ] The delivered flag is respected end to end: once the briefing has been delivered (by the tray or any other surface), no further briefing notification fires that day, including after a tray restart.
- [ ] When no briefing exists for today, nothing fires and nothing errors — silence is the correct behavior.

**Priority:** High

---

### User Story 2: One briefing, one notification

**As a** Coriven user
**I want** the briefing notification to fire exactly once per briefing
**So that** the tray feels trustworthy rather than nagging

**Acceptance Criteria:**
- [ ] After the tray notifies, it reports delivery back to the server so the delivered state is durable and shared across surfaces — the server flag, not tray memory, is the source of truth.
- [ ] If both triggers occur (startup and the configured time), only the first one that finds an undelivered briefing notifies; the second finds it delivered and stays silent.
- [ ] If reporting delivery fails (offline mid-cycle), the tray does not spam retries into repeat notifications — at most one notification per briefing per tray session, reconciling with the server flag on the next successful poll.

**Priority:** High

---

### User Story 3: Pending approvals raise a desktop alert

**As a** Coriven user
**I want** a native notification when the assistant has actions waiting for my approval
**So that** proposed emails and calendar changes don't sit unnoticed until I happen to open the web app

**Acceptance Criteria:**
- [ ] The tray periodically polls the pending-approvals summary; when pending items exist, a native notification fires stating how many actions await review and their kinds (e.g. action type / provider).
- [ ] The notification content is built only from the metadata the summary provides — no recipient, subject, body, or link content ever appears in a toast.
- [ ] The same pending items do not re-notify on every poll cycle; a new notification fires only when new items appear since the last alert.
- [ ] When the queue empties (user decided everything in the web app), notifications stop and the tray's local de-duplication state resets so future proposals alert again.

**Priority:** High

---

### User Story 4: Notifications deep-link to the right page

**As a** Coriven user
**I want** clicking a briefing or approval notification to open the relevant web page
**So that** I go from alert to action in one click — reading the briefing on the today page, reviewing full payloads on the approvals page

**Acceptance Criteria:**
- [ ] Clicking the briefing notification opens the web app's today/briefing page in the default browser.
- [ ] Clicking the approval notification opens the web approvals page, where the raw payload review happens (per the raw-payload-in-web-UI principle).
- [ ] Deep links work whether or not a browser was already running.
- [ ] The tray itself renders no briefing content and no approval payloads — it notifies and links, nothing more.

**Priority:** High

---

### User Story 5: Offline behavior is graceful

**As a** Coriven user on a laptop that sleeps and roams
**I want** the briefing and approval channels to tolerate being offline
**So that** the tray neither crashes, spams, nor silently dies when the network drops

**Acceptance Criteria:**
- [ ] Failed polls (offline, server error) are logged and retried on the next cycle without user-visible errors or duplicate notifications.
- [ ] On reconnect, the next successful poll reconciles: an undelivered briefing still notifies; already-delivered briefings and already-alerted approvals stay quiet.
- [ ] Consistent with the Feature 6.2 offline pattern — the same recovery discipline, not a second bespoke mechanism.

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: Undelivered briefing notifies once and marks delivered
- **Endpoint:** `/api/briefing/today` (consumed by the tray poll loop)
- **Method:** GET (then delivery report)
- **Test Data:** Server returns today's briefing with the delivered flag false; tray starts up
- **Expected Result:** Exactly one briefing notification; server flag becomes delivered
- **Verification:** Subsequent startup-trigger and time-trigger polls fire nothing; server row shows delivered with a timestamp

### Test Case 2: Delivered or absent briefing stays silent
- **Endpoint:** `/api/briefing/today`
- **Method:** GET
- **Test Data:** (a) briefing with delivered flag true; (b) 404 no-briefing response
- **Expected Result:** No notification, no error surfaced, poll loop continues
- **Verification:** Notification layer never invoked; next cycle scheduled normally

### Test Case 3: Pending approvals notify without payload content
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** Summary with count 2 (a send_email/gmail item and a create_calendar_event/google_calendar item)
- **Expected Result:** One notification conveying two pending actions and their kinds; click target is the web approvals page
- **Verification:** Notification text contains no recipient/subject/body content (only metadata fields exist to render from); deep link URL is the approvals page

### Test Case 4: Approval de-duplication across polls
- **Endpoint:** `/api/approvals/pending`
- **Method:** GET
- **Test Data:** Poll 1 returns items {A, B} → notify; Poll 2 returns {A, B}; Poll 3 returns {A, B, C}; Poll 4 returns {} then Poll 5 returns {D}
- **Expected Result:** Notifications on Poll 1, Poll 3 (new item C), and Poll 5 (state reset after empty queue); silence on Polls 2 and 4
- **Verification:** Already-alerted set keyed by item id; cleared when the queue empties

### Test Case 5: Offline poll cycle recovers
- **Endpoint:** Both endpoints via the poll loop
- **Method:** GET
- **Test Data:** Network failure for two cycles, then restored with an undelivered briefing and one pending approval
- **Expected Result:** No notifications or user-visible errors while offline; on reconnect, one briefing notification and one approval notification
- **Verification:** Structured logs show failed/retried cycles; no duplicate notifications after recovery

## Technical Tasks

### Task 1: Briefing poll triggers (startup + configured time)
- **Agent:** desktop-specialist
- **Estimation:** 6 hours
- **Dependencies:** None (Feature 6.1 shell + Feature 6.2 poll loop in place)
- **Priority:** High

**Deliverables:**
- Briefing channel in the tray poll scheduler: a startup check plus a check at the user's configured briefing time, calling the existing briefing endpoint and evaluating only the presence + delivered flag from the response

**Acceptance Criteria:**
- [ ] Both triggers query the server and act solely on its response — no local "is it briefing time yet for content X" logic beyond scheduling the poll
- [ ] Absent briefing (404) and delivered briefing both result in silence
- [ ] Trigger scheduling survives sleep/resume (fires on the next opportunity rather than being lost)

---

### Task 2: Briefing notification + delivered-flag round trip
- **Agent:** desktop-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Native briefing notification with deep link to the today page; delivery report to the server (the endpoint's mark-delivered mechanism) after notifying, with the once-per-session guard for the offline edge

**Acceptance Criteria:**
- [ ] Exactly-once behavior per briefing as specified in User Story 2
- [ ] Delivery state persisted server-side; tray restart does not re-notify a delivered briefing
- [ ] Notification click opens the today page in the default browser

---

### Task 3: Approvals poll channel + notification
- **Agent:** desktop-specialist
- **Estimation:** 6 hours
- **Dependencies:** Wave 6.3.1 endpoint live
- **Priority:** High

**Deliverables:**
- Approvals channel on the recurring poll cadence, consuming the Wave 6.3.1 shared response types; native notification rendered from count + metadata with deep link to the approvals page; local already-alerted set keyed by item id, reset when the queue empties

**Acceptance Criteria:**
- [ ] Notification fires on new pending items only (Test Case 4 semantics)
- [ ] Notification text is constructed exclusively from summary metadata; no code path receives payload content
- [ ] Notification click opens the approvals page in the default browser

---

### Task 4: Offline resilience + shared poll-loop integration
- **Agent:** desktop-specialist
- **Estimation:** 4 hours
- **Dependencies:** Tasks 2, 3
- **Priority:** Medium

**Deliverables:**
- Both channels wired into the Feature 6.2 offline/retry discipline (failed-cycle logging, next-cycle retry, reconcile-on-reconnect); structured logs per cycle for observability

**Acceptance Criteria:**
- [ ] Test Case 5 behavior verified for both channels
- [ ] No bespoke second retry mechanism — the 6.2 pattern is extended, not duplicated

---

### Task 5: Wave verification and thin-shell audit
- **Agent:** quality-control
- **Estimation:** 5 hours
- **Dependencies:** Tasks 1–4
- **Priority:** High

**Deliverables:**
- Automated coverage for the five logical test cases (API responses mocked); manual end-to-end pass on Windows with the browser closed; thin-shell checklist assertion for the new code

**Acceptance Criteria:**
- [ ] All five logical test cases pass
- [ ] End-to-end demo: browser closed → briefing toast at startup → click opens today page; pending approval → toast → click opens approvals page
- [ ] Thin-shell audit confirms: no database client, no briefing assembly, no approval logic in the tray — every decision traces to an API response
- [ ] Feature 6.2 reminder notifications regress-tested (shared poll loop untouched in behavior)

## Task Dependencies

```
Task 1 (briefing triggers)          Task 3 (approvals channel)
        ↓                                   │
Task 2 (briefing notify + flag)             │
        └──────────────┬────────────────────┘
                       ↓
        Task 4 (offline resilience integration)
                       ↓
        Task 5 (verification + thin-shell audit)
```

**Critical path:** Task 1 → Task 2 → Task 4 → Task 5.
**Parallel streams:** Task 3 (approvals) proceeds independently of Tasks 1–2 (briefing) once the Wave 6.3.1 endpoint is live; they converge at Task 4.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| desktop-specialist | Task 1, Task 2, Task 3, Task 4 | 21 |
| quality-control | Task 5 | 5 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing (poll/notify logic against mocked API responses)
- [ ] Integration tests passing (both channels through the shared poll loop)
- [ ] Code coverage ≥ 90% on the channel/de-duplication logic
- [ ] Code reviewed and approved — including the thin-shell checklist (no DB client, no business logic in `apps/tray`)
- [ ] No TypeScript/linter errors; Rust build clean
- [ ] Security scan passed (no high/critical issues; no payload content reachable by notification code)
- [ ] Documentation updated (tray run instructions cover briefing + approval channels)
- [ ] Wave demo completed (browser-closed end-to-end on Windows)
- [ ] Local unsigned Windows build validated (per ADR-014; no staging deploy applies to the tray artifact)

## Handoff Requirements

**For next wave / Feature close-out:**
- Feature 6.3 complete — all three Epic 6 delivery channels (reminders, briefing, approvals) live in the tray; epic success metrics for briefing and approval delivery demonstrable

**For other Features/Epics:**
- Epic 7 (Proactive Intelligence): the generalized poll → notify → deep-link channel pattern (three instances now) is the template for nudge/pattern/weekly-review delivery; Epic 7 adds endpoints, not tray architecture
- Epic 8 (Productization): signing, Mac build, PKCE, and release CI apply to this code as-is (cross-platform source, packaging-only effort per ADR-014)

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Duplicate briefing notifications (startup + timed trigger race, or offline mark-delivered failure) | Med | Server delivered flag is authoritative; per-session once-guard covers the offline gap; both triggers re-check the flag before notifying |
| Approval notifications nag on every poll | Med | Already-alerted set keyed by item id; notify only on new ids; reset on empty queue |
| Payload content sneaks into a toast via future changes | High | The summary endpoint structurally cannot supply it (Wave 6.3.1 whitelist + shared types); notification builder consumes only the shared summary type |
| Configured briefing time unavailable to the tray | Med | Delivered-flag semantics make timing forgiving: any poll after the briefing exists delivers it once; see Notes for the resolution options |
| Sleep/resume swallows the timed trigger | Low | Trigger checks on resume/next cycle rather than relying on an exact-time alarm; the delivered flag prevents any double-fire |

## Notes and Assumptions

- **Wave 6.3.1 must be deployed first** — the approvals channel builds against its contract and shared types. Feature 6.1 (shell/auth/tray) and Feature 6.2 (poll loop, notification plumbing, offline pattern) are prerequisites in place.
- The user's configured briefing time lives server-side (profile). The tray needs it only to *schedule* a poll, not to make any content decision; if no clean way to read it exists at build time, an acceptable thin-shell fallback is checking the briefing endpoint on the regular poll cadence — the delivered flag guarantees exactly-once regardless of how often the tray asks. This choice is an implementation detail, not a contract change.
- "Deep link" means opening the deployed web app URL in the default browser — the tray hosts no briefing or approvals UI of its own (blueprint §13; epic Out of Scope).
- Approval notifications are informational only (no approve/deny actions on the toast): approving requires seeing the raw payload, which exists only in the web UI (ADR-013 §Security). This is deliberate, not a gap.
- Windows-first, unsigned local build (ADR-014): the SmartScreen prompt on first run is expected; Mac and signing are Epic 8.

## Infrastructure Specifications

### Consumed API Contracts (no new backend in this wave)

| Endpoint | Trigger | Tray reads | Tray writes back |
|----------|---------|-----------|------------------|
| `GET /api/briefing/today` | Startup + configured briefing time | Presence (200 vs 404) and the delivered flag/timestamp | Delivery report via the endpoint's mark-delivered mechanism after notifying |
| `GET /api/approvals/pending` | Recurring poll cadence (aligned with the 6.2 loop, ~5 min) | `count` + `items[] {id, action_type, provider, created_at}` (Wave 6.3.1 contract) | Nothing — decisions happen in the web UI |

### Deep-link targets

- Briefing notification → web app `/today` page
- Approval notification → web app `/approvals` page

### Local state (tray-side, non-authoritative)

- Approvals: in-memory already-alerted id set; reset on empty queue; rebuilt from the API on restart (a restart may re-alert still-pending items — acceptable, they still need attention).
- Briefing: per-session notified guard only; the server delivered flag is the durable record.
- No new persisted stores, no database access, no cached payload content beyond the last poll responses already established in Feature 6.2.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.3)
- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md
- Architecture: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md; ADR-013 (§Security); blueprint §11.2, §13.3
- Predecessor: docs/implementation/iterations/wave-6.3.1-approvals-pending-endpoint.md

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
