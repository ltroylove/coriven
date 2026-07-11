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
  - "coriven"
epic: "6"
feature: "6.2"
wave: "6.2.2"
agents: []
tags: [coriven, tray, tauri, reminders, snooze, dismiss, offline, windows-toast, thin-shell]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Wave 6.2.2: Snooze / Dismiss Actions + Offline Fallback

## Wave Overview
- **Wave ID:** Wave-6.2.2
- **Feature:** Feature 6.2 - Reminder Poll & Native Notifications
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: Action buttons on reminder notifications (Snooze 15m / Snooze 1h / Dismiss) with snooze persisted via the existing backend snooze endpoint, a "Snooze All" entry in the tray menu, and an offline fallback that fires from the last cached due payload and reconciles on reconnect.
- **Wave Goal:** A reminder toast can be snoozed or dismissed in one click — reflected in the backend so every surface agrees — and reminder delivery keeps working through an offline stretch.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Each reminder notification offers Snooze 15m, Snooze 1h, and Dismiss; snooze is persisted through the existing backend snooze endpoint so the web app and future surfaces see the same state.
2. Dismiss suppresses the current occurrence locally without touching the backend — the reminder simply does not re-fire for that occurrence.
3. "Snooze All" in the tray menu snoozes every currently due reminder in one action.
4. When the API is unreachable, the tray fires due reminders from the last cached payload; on reconnect it reconciles against a fresh response and replays any snoozes that could not be delivered.
5. The shell stays thin: snooze semantics (what a snooze means, when it re-fires) remain entirely backend-owned; the tray only calls the endpoint and renders results.

## User Stories

### User Story 1: Snooze a reminder straight from the toast

**As a** Coriven user interrupted by a reminder at a bad moment
**I want** Snooze 15m and Snooze 1h buttons on the notification itself
**So that** I can defer it in one click without opening the web app.

**Acceptance Criteria:**
- [ ] Clicking Snooze 15m or Snooze 1h persists the snooze to the backend, and the snoozed-until time is visible in the web app.
- [ ] The snoozed reminder does not re-fire until its snooze window elapses; once it elapses, it fires again (this proves de-dup keys on the effective fire time, not just the reminder id).
- [ ] A failed snooze call (network, 5xx) is surfaced unobtrusively and queued for retry rather than silently lost.

**Priority:** High

---

### User Story 2: Dismiss a reminder for this occurrence

**As a** Coriven user who has already handled a reminder
**I want** a Dismiss button on the notification
**So that** this occurrence stops nagging me while future occurrences of a recurring reminder still fire.

**Acceptance Criteria:**
- [ ] Dismiss prevents any re-fire of that occurrence across later polls and tray restarts.
- [ ] Dismiss is local-only — it does not change backend state, and a later occurrence of the same recurring reminder fires normally.
- [ ] Ignoring a toast entirely (no button clicked) behaves like the Wave 6.2.1 baseline: fired once, not repeated.

**Priority:** High

---

### User Story 3: Snooze everything at once from the tray

**As a** Coriven user heading into a meeting
**I want** a "Snooze All" action in the tray menu
**So that** every currently due reminder is deferred in one gesture.

**Acceptance Criteria:**
- [ ] Snooze All snoozes every currently due, un-dismissed reminder via the backend, using a single default duration (1 hour).
- [ ] Partial failure is tolerated: reminders that fail to snooze are retried and reported; successes are not rolled back.
- [ ] After Snooze All, no reminder toast fires until a snooze window elapses or a new reminder falls due.

**Priority:** High

---

### User Story 4: Reminders survive going offline

**As a** Coriven user on flaky wifi
**I want** the tray to keep firing reminders from what it last knew, then true itself up when the connection returns
**So that** a network blip never means a silently missed reminder.

**Acceptance Criteria:**
- [ ] While the API is unreachable, reminders from the last successfully fetched payload still fire at their due times.
- [ ] Snoozes performed offline are queued and delivered to the backend on reconnect; dismissals hold locally as usual.
- [ ] On reconnect, the next successful poll replaces the cached payload — reminders cancelled or completed while offline do not fire afterward.
- [ ] The tray gives a subtle indication (tray menu state) that it is operating from cached data.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Snooze action persists to the backend
- **Endpoint:** `/api/tasks/[id]/snooze` (consumed; mocked in unit tests, real in integration — not modified)
- **Method:** POST
- **Test Data:** Fired reminder's id with `{ "minutes": 15 }` and `{ "minutes": 60 }`
- **Expected Result:** 200 with the updated reminder; subsequent due responses exclude it until the window elapses
- **Verification:** Snoozed-until value on the returned record; no re-fire during the window; re-fire after it elapses

### Test Case 2: Dismiss suppresses one occurrence only
- **Endpoint:** `/api/tasks/due` (mocked)
- **Method:** GET
- **Test Data:** Dismiss a fired occurrence; then serve the same reminder id with a later occurrence time
- **Expected Result:** No re-fire of the dismissed occurrence; the later occurrence fires
- **Verification:** Suppression state across cycles and a simulated restart; no snooze call made for dismiss

### Test Case 3: Snooze All covers all due reminders with partial failure
- **Endpoint:** `/api/tasks/[id]/snooze` (mocked: one id returns 500, rest 200)
- **Method:** POST
- **Test Data:** Three currently due reminders; Snooze All invoked from the tray menu
- **Expected Result:** Two snoozed immediately; the failed one queued and retried
- **Verification:** One snooze call per reminder; retry queue contains only the failure

### Test Case 4: Offline fire + reconcile on reconnect
- **Endpoint:** `/api/tasks/due` (mocked: 200 payload, then network errors, then 200 with one reminder removed)
- **Method:** GET
- **Test Data:** Cached payload contains a reminder falling due during the outage; a snooze performed while offline
- **Expected Result:** The reminder fires from cache during the outage; on reconnect the queued snooze is delivered and the removed reminder never fires again
- **Verification:** Fire during outage, queued snooze POST on reconnect, cache replaced by the fresh response

## Technical Tasks

### Task 1: Notification action buttons
- **Agent:** desktop-specialist
- **Estimation:** 8 hours
- **Dependencies:** None (Wave 6.2.1 `notify(...)` seam complete)
- **Priority:** High

**Deliverables:**
- Snooze 15m / Snooze 1h / Dismiss buttons on reminder toasts via the Tauri notification plugin's action API, with the button-click event routed back to a tray-side handler carrying reminder id + occurrence
- **Fallback (pre-scoped):** if Windows toast action buttons prove unreliable through the plugin, notification click opens a minimal snooze/dismiss picker window — same three actions, same handlers; the handler layer is button-source-agnostic

**Acceptance Criteria:**
- [ ] All three actions reach the handler with the correct reminder identity on a packaged Windows build
- [ ] Fallback decision documented if taken

---

### Task 2: Snooze + dismiss handlers
- **Agent:** desktop-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Snooze handler: `POST /api/tasks/[id]/snooze` with `{ minutes: 15 | 60 }` using the reminder id and the Feature 6.1 auth session; failure enqueues into the retry queue (Task 4)
- Dismiss handler: marks the occurrence in the local suppression store (extends the Wave 6.2.1 already-notified cache with an explicit dismissed flag); no backend call

**Acceptance Criteria:**
- [ ] Snooze reflected in the backend and web app; post-snooze re-fire works after the window elapses
- [ ] Dismiss survives restart and never blocks a later occurrence

---

### Task 3: Snooze All tray-menu action
- **Agent:** desktop-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- The Feature 6.1 tray-menu "Snooze All" item wired to snooze every currently due, un-dismissed reminder (default 60 minutes), iterating the Task 2 snooze handler with per-reminder failure isolation

**Acceptance Criteria:**
- [ ] All due reminders snoozed in one action; failures queued, successes kept

---

### Task 4: Offline cache, retry queue + reconciliation
- **Agent:** desktop-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- Last-known due payload persisted to the tray app-data store on every successful poll; on poll failure, the fire-decision module runs against the cached payload instead
- Durable retry queue for snoozes that failed or were performed offline; drained on the next successful API contact
- Reconciliation: a successful poll atomically replaces the cache and prunes suppression/queue entries for reminders no longer returned
- Tray-menu indicator for cached-data mode

**Acceptance Criteria:**
- [ ] Reminders fire from cache during an outage; stale/cancelled reminders never fire after reconnect
- [ ] Queued snoozes are delivered exactly once on reconnect

---

### Task 5: Wave test suite + end-to-end acceptance
- **Agent:** quality-control
- **Estimation:** 8 hours
- **Dependencies:** Tasks 3, 4
- **Priority:** High

**Deliverables:**
- Unit/integration tests covering the four Logical Unit Test Cases (mocked API for unit; real backend for the snooze round-trip)
- Documented manual acceptance run of the epic's anchor scenario end-to-end: reminder 2 minutes out → browser-closed toast within ~5 minutes → Snooze and Dismiss both work and the snooze is visible in the backend; plus an unplug-the-network offline pass

**Acceptance Criteria:**
- [ ] All test cases pass; both manual runs recorded with evidence (screenshots, backend state, timestamps)

## Task Dependencies

```
Task 1 (action buttons)
  ↓
Task 2 (snooze/dismiss handlers)
  ├─> Task 3 (Snooze All) ─────────────┐
  └─> Task 4 (offline + retry queue) ──┤
                                       ↓
                          Task 5 (tests + acceptance)
```

**Critical path:** Task 1 → Task 2 → Task 4 → Task 5. Task 3 runs parallel to Task 4 after Task 2.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| desktop-specialist | Task 1, Task 2, Task 3, Task 4 | 26 |
| quality-control | Task 5 | 8 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit/integration tests written and passing (actions, Snooze All partial failure, offline fire + reconcile)
- [ ] Epic acceptance anchor passed end-to-end with evidence: browser-closed toast within ~5 minutes, Snooze/Dismiss reflected in the backend
- [ ] Offline manual pass recorded (fire from cache, reconcile on reconnect)
- [ ] Code reviewed and approved, including the thin-shell checklist (no DB client, no recurrence math, no snooze semantics in `apps/tray`)
- [ ] No TypeScript/linter errors (strict mode); Rust build clean
- [ ] No tokens or reminder content in logs
- [ ] Documentation updated (epic doc wave status, tray run instructions incl. offline behavior)
- [ ] Feature 6.2 closed out in the epic doc

## Infrastructure Specifications

### Consumed API (not modified)

- `POST /api/tasks/[id]/snooze` — existing; `[id]` is the **reminder id** (a `task_reminders` row id, as returned by the due endpoint), body `{ "minutes": <positive number> }`; sets the reminder's snoozed-until time and returns the updated row. Auth: Supabase bearer token. 400 on non-positive minutes.
- `GET /api/tasks/due` — as consumed in Wave 6.2.1. Actively snoozed reminders drop out of the response, which is why post-snooze de-dup/pruning falls out naturally.
- **No backend changes in this wave.** Snooze meaning, re-fire timing, and recurrence stay server-owned.

### Tray (Tauri)

- Action buttons: Tauri v2 notification plugin action API on Windows toasts; button payload carries reminder id + occurrence. Fallback: click-through picker window (Task 1).
- Local state (tray app-data store, no secrets):
  - Suppression store — Wave 6.2.1 already-notified set extended with a `dismissed` flag per `reminderId + effectiveFireTime`
  - Cached due payload — last successful response + fetch timestamp
  - Snooze retry queue — `{ reminderId, minutes, requestedAt }`, drained FIFO on reconnect, deleted on 2xx
- Snooze durations: 15 and 60 minutes from the buttons; 60 for Snooze All. Constants in tray config.

### Testing

- Unit: action-event routing, dismiss suppression semantics, retry-queue drain (exactly-once), cache replace + prune on reconcile (mocked API).
- Integration: real snooze round-trip against the deployed backend as the signed-in user.
- Manual: epic anchor scenario + offline pass on the unsigned Windows build.

### Deployment

- Local unsigned Windows build only (ADR-014). No CI, no signing.

### Monitoring

- Local structured log: action clicks (action type + reminder id only), snooze POST outcomes, queue depth, cache-mode transitions. No titles, no tokens.

## Handoff Requirements

**For Feature 6.3 (Briefing & Approval Delivery):**
- The action-capable notification seam (briefing/approval notifications reuse dispatch + click handling, incl. deep-link-on-click)
- The poll/cache/reconcile pattern, reusable for the briefing and approvals polls
- Cached-data-mode tray indicator shared across all polls

**For Epic 7 (Proactive Intelligence):**
- A complete, proven desktop delivery pipeline: poll → de-dupe → notify → act → sync — nudges and pattern alerts plug into the same seams

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Tauri notification plugin action buttons unreliable on Windows toasts | High | Pre-scoped fallback in Task 1: click opens a minimal picker window; handler layer is button-source-agnostic so the swap is contained |
| Offline fires stale/cancelled reminders (epic's named risk) | Med | Cache is last-known payload only; reconcile-and-prune on every successful poll; snooze/dismiss best-effort with re-sync |
| Queued snooze delivered late loses meaning (window computed from delivery time, not click time) | Low | Accepted for v1 — the backend computes snoozed-until from receipt; noted in run instructions; revisit only if it bothers real use |
| Duplicate snooze delivery on retry | Med | Queue entries deleted only on confirmed 2xx; snooze is effectively idempotent for equal durations (later-of overwrite), verified in tests |
| Machine sleep during outage skews "due while offline" firing | Low | Fire-on-wake pass over the cached payload; same startup-poll pattern as 6.2.1 |

## Notes and Assumptions

- Wave 6.2.1 is complete: poll loop, typed reminder shape, `notify(...)` seam with reminder metadata, and the persisted already-notified cache all exist.
- Dismiss is intentionally local-only: the backend has no dismiss concept for an occurrence, and the thin-shell rule forbids inventing one in the tray. If a durable server-side dismiss is ever wanted, that is a backend feature request, not tray logic.
- The snooze endpoint's path parameter is the reminder id (not the task id) — matching how the due endpoint's rows are identified. The route name says "tasks" but operates on reminders; no rename is in scope.
- De-dup key strategy carries over from 6.2.1: `reminderId + effectiveFireTime` (snoozed-until if later, else remind-at) from the API payload; a snooze changes the effective fire time, which is exactly why the reminder correctly re-fires after the window.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.2)
- ADR-014: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§13.2, §13.3, §7.4)
- Prior wave: docs/implementation/iterations/wave-6.2.1-reminder-poll-notifications.md

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
