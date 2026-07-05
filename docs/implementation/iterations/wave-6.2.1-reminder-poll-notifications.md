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
  - "coriven"
epic: "6"
feature: "6.2"
wave: "6.2.1"
agents: []
tags: [coriven, tray, tauri, reminders, notifications, poll, windows-toast, thin-shell]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Wave 6.2.1: Reminder Poll + Native Notifications

## Wave Overview
- **Wave ID:** Wave-6.2.1
- **Feature:** Feature 6.2 - Reminder Poll & Native Notifications
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: A recurring poll loop in the Tauri tray over the existing due-reminders endpoint (~every 5 minutes plus on startup), firing one native Windows toast per due reminder, with a locally persisted "already-notified" set so the same reminder occurrence never re-fires on subsequent polls.
- **Wave Goal:** With the browser closed, a due reminder produces a native Windows toast within ~5 minutes of falling due — exactly once per occurrence.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. The tray polls the backend due-reminders endpoint on startup and roughly every 5 minutes, authenticated as the signed-in user from the Feature 6.1 session.
2. Each reminder that is due right now fires a native Windows toast showing the task title and reminder time — even with no browser open.
3. A locally cached already-notified set (keyed by reminder id + occurrence) guarantees the same occurrence never re-fires on later polls, and the cache is pruned against each fresh API response.
4. The shell stays thin: no database access, no recurrence math, no "what's due" rules beyond comparing the API-provided fire time to the clock — every reminder in scope comes from the API response.

## User Stories

### User Story 1: Due reminders reach me with the browser closed

**As a** Coriven user at my desk
**I want** a native Windows notification when a task reminder falls due, even when no browser is open
**So that** I never miss a reminder just because I closed the web app.

**Acceptance Criteria:**
- [ ] Creating a task with a reminder 2 minutes out produces a native Windows toast within ~5 minutes, with every browser window closed.
- [ ] The toast shows the task title and the reminder's due time so it is actionable at a glance.
- [ ] Reminders belonging to completed or cancelled tasks never fire (the backend already excludes them; the tray fires only what the API returns).
- [ ] The poll runs once immediately at tray startup so reminders that fell due while the tray was off are delivered on launch.

**Priority:** High

---

### User Story 2: The same reminder never nags me every poll

**As a** Coriven user
**I want** each reminder occurrence to notify me exactly once
**So that** the tray doesn't re-fire the same toast every 5 minutes and train me to ignore it.

**Acceptance Criteria:**
- [ ] A reminder that fired on one poll cycle does not fire again on subsequent cycles while it remains in the API's due list.
- [ ] The already-notified record is keyed by reminder id plus its occurrence (the effective fire time from the API payload), so a recurring reminder's next occurrence still fires.
- [ ] The already-notified set survives a tray restart, so relaunching the app does not replay old toasts.
- [ ] Entries no longer present in the API response are pruned from the local set, so the cache cannot grow without bound or block legitimate re-fires (e.g., after a snooze elapses the reminder fires again).

**Priority:** High

---

### User Story 3: The poll loop is resilient and honest about failures

**As a** Coriven user running the tray all day
**I want** the poll loop to survive transient API or auth failures
**So that** one bad cycle never kills reminder delivery for the rest of the day.

**Acceptance Criteria:**
- [ ] A failed poll (network error, 5xx, expired session) is logged and skipped; the next cycle proceeds normally.
- [ ] An expired access token triggers the Feature 6.1 refresh path before the poll is abandoned; only an unrecoverable auth failure surfaces a re-sign-in prompt.
- [ ] No reminder content or tokens appear in logs.
- [ ] The loop never fires notifications from a partially parsed or malformed response.

**Priority:** High

---

### User Story 4: The tray remains a thin shell

**As the** project owner
**I want** the tray verifiably free of business logic
**So that** the shell stays disposable and web/tray/mobile never diverge on reminder behavior.

**Acceptance Criteria:**
- [ ] The tray contains no database client, no recurrence computation, and no reimplementation of the shared next-occurrence logic.
- [ ] The only "due" decision the tray makes is comparing the API-provided fire time against the current clock; everything else (snooze windows, task status, recurrence) is decided by the backend.
- [ ] Code review checklist item asserting the above passes before merge.

**Priority:** High

## Logical Unit Test Cases

### Test Case 1: Poll fetches and fires due reminders
- **Endpoint:** `/api/tasks/due` (consumed; mocked in tests — not modified)
- **Method:** GET
- **Test Data:** Mocked response with 2 reminders due now and 1 due in 3 hours
- **Expected Result:** Exactly 2 notifications dispatched; the future reminder is held
- **Verification:** Notification dispatch calls, already-notified set contains the 2 fired keys

### Test Case 2: Re-poll does not re-fire
- **Endpoint:** `/api/tasks/due` (mocked, same payload as Test Case 1)
- **Method:** GET
- **Expected Result:** Zero new notifications on the second cycle
- **Verification:** Dispatch count unchanged; set unchanged

### Test Case 3: New occurrence of a recurring reminder fires
- **Endpoint:** `/api/tasks/due` (mocked)
- **Method:** GET
- **Test Data:** Same reminder id as a previously fired entry but with a later occurrence time from the API
- **Expected Result:** One new notification
- **Verification:** Set contains both occurrence keys; stale key pruned once absent from the response

### Test Case 4: Failed poll is non-fatal
- **Endpoint:** `/api/tasks/due` (mocked 500, then 200)
- **Method:** GET
- **Expected Result:** First cycle logs and skips; second cycle fires normally
- **Verification:** No crash, no notification from the failed cycle, normal delivery afterward

## Technical Tasks

### Task 1: Notification plugin integration
- **Agent:** desktop-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (Feature 6.1 shell complete)
- **Priority:** High

**Deliverables:**
- Tauri notification plugin wired into `apps/tray` with Windows toast capability and permission request handled at startup
- A single internal `notify(title, body, meta)` seam the poll loop calls (isolates the plugin so Wave 6.2.2 can attach actions)

**Acceptance Criteria:**
- [ ] A test notification renders as a native Windows toast from the packaged local build
- [ ] Notification permission denial is handled gracefully with a visible tray-menu hint

---

### Task 2: Authenticated poll loop
- **Agent:** desktop-specialist
- **Estimation:** 6 hours
- **Dependencies:** None (parallel to Task 1)
- **Priority:** High

**Deliverables:**
- Poll scheduler in `apps/tray`: fires on startup and every ~5 minutes; calls `GET /api/tasks/due` with the bearer token from the Feature 6.1 session, invoking the refresh path on 401
- Response parsing into a typed reminder shape shared with the fire logic; malformed responses rejected wholesale

**Acceptance Criteria:**
- [ ] Poll runs on startup + interval; failures are logged and skipped without stopping the loop
- [ ] No tokens or reminder content in logs

---

### Task 3: Due-filter + already-notified cache
- **Agent:** desktop-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- Fire-decision module: from the API payload, select reminders whose effective fire time (snoozed-until if set, else remind-at) is at or before now — no other logic
- Persisted already-notified set keyed `reminderId + effectiveFireTime`, written to the tray's local app-data store; pruned each cycle against the current API list

**Acceptance Criteria:**
- [ ] Same occurrence never dispatches twice across cycles and restarts; new occurrences of the same reminder do
- [ ] Cache prunes entries absent from the latest response

---

### Task 4: Notification rendering + dispatch
- **Agent:** desktop-specialist
- **Estimation:** 4 hours
- **Dependencies:** Tasks 1, 3
- **Priority:** High

**Deliverables:**
- Per-due-reminder toast via the Task 1 seam: task title as headline, reminder time in the body; reminder id + occurrence carried as metadata for Wave 6.2.2 actions

**Acceptance Criteria:**
- [ ] One toast per newly due reminder per cycle; content matches the API payload

---

### Task 5: Wave test suite + acceptance run
- **Agent:** quality-control
- **Estimation:** 6 hours
- **Dependencies:** Task 4
- **Priority:** High

**Deliverables:**
- Unit tests for the fire-decision module and de-dup cache (Test Cases 1–4) against a mocked API
- Documented manual acceptance run: reminder 2 minutes out → toast within ~5 minutes with the browser closed, on the unsigned local Windows build

**Acceptance Criteria:**
- [ ] All test cases pass; the manual acceptance run is recorded with evidence (screenshot + timestamps)

## Task Dependencies

```
Task 1 (notification plugin) ──────────────┐
Task 2 (poll loop) ──> Task 3 (de-dup) ──> Task 4 (render + dispatch)
                                                    ↓
                                           Task 5 (tests + acceptance)
```

**Critical path:** Task 2 → Task 3 → Task 4 → Task 5. Task 1 runs parallel to Tasks 2–3.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| desktop-specialist | Task 1, Task 2, Task 3, Task 4 | 20 |
| quality-control | Task 5 | 6 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing (fire decision, de-dup, failure resilience)
- [ ] Manual acceptance run passed: browser-closed toast within ~5 minutes, evidence recorded
- [ ] Code reviewed and approved, including the thin-shell checklist (no DB client, no recurrence math in `apps/tray`)
- [ ] No TypeScript/linter errors (strict mode); Rust build clean
- [ ] No tokens or reminder content in logs
- [ ] Documentation updated (epic doc wave status, tray run instructions)
- [ ] Unsigned local Windows build produced and exercised

## Infrastructure Specifications

### Consumed API (not modified)

- `GET /api/tasks/due` — existing; returns the user's `task_reminders` rows due within the next 24 hours (excluding actively snoozed reminders and done/cancelled tasks), each with the joined task title. Auth: Supabase bearer token. **The tray consumes this endpoint as-is; no backend changes in this wave.**
- The reminder id in each row is the identifier later used by the snooze endpoint (Wave 6.2.2).

### Tray (Tauri)

- Plugin: Tauri v2 notification plugin (native Windows toast). Registered in the Tauri capabilities/permissions config.
- Poll interval: ~5 minutes, plus an immediate poll at startup. Interval constant lives in tray config, not scattered.
- Local state: already-notified set persisted to the Tauri app-data directory (small JSON/store file — no secrets; the refresh token stays in Feature 6.1 secure storage).
- De-dup key: `reminderId + effectiveFireTime` where effective fire time = `snoozed_until` if set and later than `remind_at`, else `remind_at` — both values taken verbatim from the API payload.

### Testing

- Unit: fire-decision selection, de-dup persistence/pruning, malformed-response rejection, 401→refresh path (mocked API).
- Manual: end-to-end acceptance on Windows with the browser closed.

### Deployment

- Local unsigned Windows build only (ADR-014). No CI artifacts, no signing. SmartScreen dismiss-once documented in run instructions.

### Monitoring

- Local structured log per cycle: reminders returned, fired, suppressed-by-cache, poll duration, error class on failure. No titles, no tokens.

## Handoff Requirements

**For next wave (6.2.2):**
- The `notify(...)` seam carrying reminder id + occurrence metadata, ready for action buttons
- The already-notified cache module (6.2.2 extends its semantics for dismiss and post-snooze re-fire)
- The poll loop and typed reminder shape (6.2.2 adds payload caching for offline)

**For other Features/Epics:**
- Feature 6.3 reuses the poll/notify pattern for briefing and approval delivery
- Epic 7 nudges/pattern alerts inherit the same notification dispatch seam

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Duplicate toasts every poll (the epic's named risk) | Med | Persisted de-dup set keyed id + occurrence; reconciled against each API response; proven by test, not inspection |
| Recurring reminders' occurrence time not advanced server-side after firing | Med | Backend concern, out of tray scope — flag to the epic if observed during acceptance; the tray keys on whatever fire time the API supplies |
| Windows notification permission blocked (Focus Assist / settings) | Med | Detect and surface via tray menu hint; document in run instructions |
| Poll timer drift when the machine sleeps | Low | Startup poll + interval re-arm on wake covers gaps; 24h due window in the API tolerates late polls |

## Notes and Assumptions

- Feature 6.1 is complete: `apps/tray` exists with tray icon/menu, Supabase sign-in, refresh token in Tauri secure storage, and a token-refresh helper the poll loop can call.
- Notification plugin assumption: the Tauri v2 notification plugin renders plain Windows toasts reliably; **action buttons are not required in this wave** (they are Wave 6.2.2's problem, with a fallback strategy there).
- The API's 24-hour due window means the tray receives not-yet-due reminders; comparing the payload's fire time to the clock is presentation timing, not business logic — the backend still owns snooze, status, and recurrence rules.
- Occurrence identity: the effective fire time from the payload is the occurrence key. If two occurrences ever share a timestamp, they are the same occurrence by definition.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.2)
- ADR-014: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§13.2, §13.3, §7.4)

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
