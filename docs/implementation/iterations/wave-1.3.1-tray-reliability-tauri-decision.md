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
epic: "1"
feature: "1.3"
wave: "1.3.1"
agents: []
tags: [coriven, tray, tauri, node-daemon, reliability, spike, adr-003]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/02-Product-Plan.md"
---

# Wave 1.3.1: Tray Reliability & Tauri Decision

> ⛔ **SUPERSEDED (2026-06-29).** The Node.js Windows tray (`apps/tray`) was **removed** — see **ADR-012**. This wave's tray-reliability smoke and Tauri spike no longer apply. Tauri remains the only tray (ADR-003), to be built as a dedicated effort when prioritized. Kept for historical record only.

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 1.3.1 |
| Feature | 1.3 — Tray Reliability & Tauri Decision |
| Epic | 1 — Foundation Closeout |
| Status | Planning |
| Scope | Verify the Node.js tray is reliable with the corrected API; confirm `packages/types` is the single recurrence source; spike the Tauri thin-shell approach; produce a written go/defer decision on Tauri migration timing. |
| Wave Goal | The tray reliably fires reminders via the corrected `/api/tasks/due` endpoint; the Tauri migration is either begun (if the spike proves low-cost) or formally deferred to Productization with a documented rationale — either outcome satisfies ADR-003. |

**Wave Philosophy:** Scope-based — this wave closes when the tray is verified reliable and the Tauri decision is documented, not on a schedule.

## Wave Goals

1. Confirm end-to-end reminder delivery: tray polls production `/api/tasks/due`, a reminder fires as a native Windows notification, and Snooze/Dismiss update `task_reminders` correctly — satisfying the Epic-1 success metric ("reminder set 2 min out fires within 5 min, browser closed").
2. Confirm the thin-shell rule is enforced: no business logic or direct DB access in `apps/tray/src/`; all recurrence math delegated to `@personal-assistant/types` (ADR-003, ADR-004).
3. Produce a written Tauri migration decision: spike Tauri thin-shell (poll `/api/tasks/due`, native notification) and decide whether full migration lands in Epic 1 or is deferred to Productization, with rationale captured as a decision record (Architecture §13.4).

## User Stories

---

### Story 1.3.1.1 — Tray End-to-End Reminder Delivery

**As the** owner,  
**I want** the tray daemon to fire a native notification for a due reminder within 5 minutes with the browser closed,  
**So that** I receive timely reminders without keeping the web app open.

**Reference:** Business Requirements UC-2, UC-4; Epic-1 success metric; Architecture NFR reliability.

**Priority:** Critical  
**Estimated hours:** 4

**Acceptance Criteria:**
- With the web browser closed, a reminder whose `remind_at` is in the past fires a native Windows notification within one poll cycle (≤5 minutes by default).
- Choosing "Snooze 15m" updates `task_reminders.snoozed_until` to now + 15 minutes; the reminder does not re-fire until that time.
- Choosing "Snooze 1h" updates `snoozed_until` to now + 60 minutes.
- Dismissing a non-recurring reminder sets `last_fired_at` and does not re-fire.
- Dismissing a recurring reminder advances `remind_at` to the next occurrence via `getNextOccurrence` from `@personal-assistant/types`.
- `task_reminders.last_fired_at` is updated on every dismiss.
- Tasks with status `done` or `cancelled` do not produce notifications.

---

#### Task 1.3.1.1.1 — Tray Smoke Test Against Production API

| Field | Value |
|---|---|
| Parent Story | 1.3.1.1 |
| Agent | backend-specialist |
| Estimation | 2h |
| Dependencies | Wave 1.1.1 DoD met; Wave 1.2.1 production deploy live |
| Deliverables | Executed smoke-test checklist for tray end-to-end flow |

**Acceptance Criteria:**
- Tray `.env` points to the production `APP_URL` (Vercel production URL).
- All five scenarios from Story 1.3.1.1 acceptance criteria are manually verified and recorded as pass/fail.
- Any failures are filed as issues and resolved before this wave closes.

---

#### Task 1.3.1.1.2 — Verify Thin-Shell Rule: No Business Logic in Tray

| Field | Value |
|---|---|
| Parent Story | 1.3.1.1 |
| Agent | backend-specialist |
| Estimation | 2h |
| Dependencies | None (can run in parallel with 1.3.1.1.1) |
| Deliverables | Verification note; any violations fixed |

**Acceptance Criteria:**
- `apps/tray/src/` contains no recurrence logic other than the import of `getNextOccurrence` from `@personal-assistant/types`.
- `apps/tray/src/db.ts` does not contain any SQL or ORM queries beyond the Supabase client calls that are intentional (snooze + fire via anon key + RLS). Note: the current Node.js tray contacts Supabase directly with the user's access token — this is acceptable for the Node.js phase and will be removed when Tauri replaces it (all DB calls move to the API).
- No hardcoded user data, task IDs, or other business constants appear in `apps/tray/src/`.
- `npm run typecheck` exits 0 after any changes.

---

### Story 1.3.1.2 — Tauri Thin-Shell Spike

**As the** developer,  
**I want** to evaluate the effort of replacing the Node.js tray daemon with a Tauri thin shell,  
**So that** I can make an informed decision on whether full Tauri migration lands in Epic 1 or in Productization.

**Reference:** Architecture ADR-003; Product Plan §13.4; Business Requirements §"Tray" constraints.

**Priority:** High  
**Estimated hours:** 8

**Acceptance Criteria:**
- A working Tauri prototype (proof of concept, not production-ready) polls `/api/tasks/due` using an HTTP GET and displays the response in a log or console — demonstrating the API-poll pattern.
- The prototype fires a native notification using the Tauri notification plugin for at least one polled reminder.
- Rust toolchain setup steps (for Windows) are documented.
- Spike produces a written estimate of remaining work to reach parity with the Node.js daemon (auth, snooze endpoint call, autostart, icon).
- The spike output feeds directly into Story 1.3.1.3 (decision record).

---

#### Task 1.3.1.2.1 — Bootstrap Tauri Workspace Entry

| Field | Value |
|---|---|
| Parent Story | 1.3.1.2 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Wave 1.2.1 production deploy live (need a real API URL to poll) |
| Deliverables | `apps/tray-tauri/` skeleton with `tauri.conf.json`, `Cargo.toml`, and a minimal Rust main that polls `/api/tasks/due` and logs the response |

**Acceptance Criteria:**
- `apps/tray-tauri/` exists in the monorepo with the minimal Tauri app scaffold.
- `cargo tauri dev` (or equivalent) launches without errors on Windows.
- The app makes an authenticated HTTP GET to `/api/tasks/due` and logs the JSON response to the console.
- No business logic is present in the Rust layer — polling and notification only.
- The spike directory is clearly marked as a prototype (README comment or file header).

---

#### Task 1.3.1.2.2 — Native Notification Proof of Concept

| Field | Value |
|---|---|
| Parent Story | 1.3.1.2 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Task 1.3.1.2.1 |
| Deliverables | Tauri prototype that fires a native notification for a polled due reminder; spike notes with effort estimate |

**Acceptance Criteria:**
- At least one polled due reminder triggers a native Windows notification via the Tauri notification plugin.
- Action buttons (Snooze 15m / Dismiss) are present in the notification (even if not yet wired to API calls).
- Written spike notes estimate remaining effort (hours) to: implement auth/session persistence, wire snooze to `/api/tasks/[id]/snooze`, implement autostart, handle the tray icon.
- Notes are committed alongside the prototype code.

---

### Story 1.3.1.3 — Tauri Migration Decision Record

**As the** developer,  
**I want** a written go/defer decision on full Tauri migration,  
**So that** the architecture record is unambiguous and future contributors know what to build next.

**Reference:** Architecture ADR-003; Product Plan §13.4; Epic-1 out-of-scope note ("full Tauri Mac build/signing may defer to Productization").

**Priority:** High  
**Estimated hours:** 2

**Acceptance Criteria:**
- A decision record is committed to `docs/implementation/` or updated in `docs/architecture/_main/04-Architecture.md` under ADR-003.
- The record states: Go (begin full Tauri migration now) OR Defer (keep Node.js daemon through Epic 1; full Tauri in Productization).
- The record cites the spike findings (effort estimate, signing cost, CI complexity) as evidence.
- If Go: the remaining Tauri tasks are added to a follow-on wave or the current wave backlog.
- If Defer: the Node.js daemon's thin-shell status is reaffirmed and a stub for Tauri migration is noted in the Productization epic.
- Decision is consistent with ADR-003 (Tauri accepted; timing is what is being decided).

---

#### Task 1.3.1.3.1 — Write and Commit Tauri Decision Record

| Field | Value |
|---|---|
| Parent Story | 1.3.1.3 |
| Agent | backend-specialist |
| Estimation | 2h |
| Dependencies | Task 1.3.1.2.2 (spike findings needed as input) |
| Deliverables | Decision record document committed to repo |

**Acceptance Criteria:**
- Decision (Go/Defer) is clearly stated.
- Rationale references spike effort estimate and signing/CI cost.
- If Defer: a note is added to the Productization epic backlog.
- Document is findable via the architecture doc's ADR-003 reference.

---

## Task Dependencies

```
Task 1.3.1.1.1 (tray smoke test)      ← requires Wave 1.1.1 DoD + Wave 1.2.1 deploy
Task 1.3.1.1.2 (thin-shell verify)    ← independent; parallel with 1.3.1.1.1

Task 1.3.1.2.1 (Tauri bootstrap)      ← requires Wave 1.2.1 deploy (real API URL)
    └── Task 1.3.1.2.2 (notification PoC + spike notes)
            └── Task 1.3.1.3.1 (decision record)
```

Tasks 1.3.1.1.x and 1.3.1.2.x can proceed in parallel once Wave 1.2.1 is done.

**Critical path:** 1.3.1.2.1 → 1.3.1.2.2 → 1.3.1.3.1 (14h serial; tray smoke test runs in parallel).

## Definition of Done

- [ ] End-to-end reminder delivery verified: tray fires notification within one poll cycle; Snooze/Dismiss update DB correctly.
- [ ] Thin-shell rule confirmed: no business logic or recurrence math in `apps/tray/src/` beyond the shared import.
- [ ] Tauri spike complete: prototype polls the API and fires a native notification on Windows.
- [ ] Decision record committed: Go or Defer clearly stated with evidence.
- [ ] `npm run typecheck` exits 0 across the monorepo (no regressions from spike scaffolding).
- [ ] If Go: follow-on Tauri tasks are planned. If Defer: Productization backlog updated.

## Infrastructure Specifications

### API

Endpoints consumed by the tray in this wave (no new routes introduced):

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/tasks/due` | GET | Supabase session cookie (web) or Bearer token (tray) | Poll for due reminders |
| `/api/tasks/[id]/snooze` | POST | Supabase session | Snooze a reminder |

No schema changes. No new env vars for the web app.

**Tray-specific env vars (Node.js daemon, `apps/tray/.env`):**

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anon key (RLS enforced via user access token) |
| `USER_EMAIL` | Owner email for auth |
| `USER_PASSWORD` | Owner password for auth |
| `APP_URL` | Production Vercel URL (for Tauri spike HTTP calls) |

**Tauri spike env vars (prototype only — not production):** Same `APP_URL`; auth mechanism TBD in spike (hardcoded token acceptable for PoC, not for production).

### Testing

| Level | Approach | Target |
|---|---|---|
| Manual smoke | Tray end-to-end: create reminder → wait → notification fires → snooze/dismiss | All scenarios pass |
| Manual spike | Tauri PoC polls API → notification appears | Demonstrated on Windows |
| Static | Confirm no local recurrence logic in `apps/tray/src/` | Zero violations |
| Typecheck | `npm run typecheck` across monorepo | Exit 0 |

No automated tests are introduced for the tray in this wave (deferred; tray is a disposable shell per ADR-003).

### Deployment

No changes to the Vercel deployment in this wave. The Tauri spike produces local prototype artifacts only — no CI pipeline or signing is configured until the Go decision is made.

## Handoff Requirements

Epic 2 (Memory) and subsequent epics require:
- Tray reliability confirmed (Story 1.3.1.1 DoD met) — reminders are a daily-driver baseline.
- Tauri decision record committed — so future feature work knows whether to extend the Node.js daemon or the Tauri shell.
- If Tauri Go: `apps/tray-tauri/` spike artifacts are the starting point for the migration wave.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Rust toolchain setup on Windows is time-consuming | Medium | Medium | Allocate up to 2h for toolchain install; if blocked, defer spike to a dedicated session |
| Tauri notification plugin incompatible with target Windows version | Medium | Low | Test on Windows 10 (the target per CLAUDE.md); fall back to webview-based notification if native plugin fails |
| Tray smoke test reveals a previously unknown bug in snooze/dismiss | High | Low | Fix the bug before closing this wave; do not defer known failures |
| Signing cost (Apple $99/yr, Windows cert) makes Go decision costly | Medium | Medium | Document cost in decision record; Defer is a valid and pre-approved outcome (§13.4) |

## Related Documentation

- Epic: `docs/implementation/_main/epic-1-foundation-closeout.md`
- Architecture: `docs/architecture/_main/04-Architecture.md` (ADR-003, ADR-004, §"Component: Tauri Tray", §13.4)
- Product Plan: `docs/architecture/_main/02-Product-Plan.md` (§"Tray" in Infrastructure Stack)
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` (UC-2, UC-4, §"Tray" constraints)
