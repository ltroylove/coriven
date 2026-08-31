---
preparedby: "Roy Love"
datecreated: "2026-07-05"
lastupdated: "2026-07-05T00:00:00"
version: "1.0"
type: epic
status: Completed
domain: implementation
product:
  - "coriven"
epic: "6"
priority: "High"
branch: "epic/6-tauri-tray"
architecture: ["ADR-003", "ADR-012", "ADR-014"]
tags: [coriven, tray, tauri, desktop, notifications, reminders]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/planning/epic-6-brainstorming.md"
---

# Epic 6: Tauri Tray — Desktop Delivery

## Epic Overview
- **Epic ID:** Epic-6
- **Status:** Planning
- **Duration:** Medium
- **Team:** Solo (owner/developer)
- **Priority:** High (unblocks proactive desktop delivery for Epic 7)

## Problem Statement

Coriven can decide *when* to reach the user — reminders are due, a briefing is ready, an action awaits approval — but today it has no way to reach them on the desktop **without a browser open**. The prior Node.js Windows daemon was removed (ADR-012), leaving reminders visible in the web app only. This epic builds the **Tauri tray app**: a lightweight, always-on desktop shell that authenticates, polls the existing API, and fires native OS notifications. It is the delivery surface that makes Coriven proactive on the desktop, and it is a hard prerequisite for Epic 7 (Proactive Intelligence), whose nudges, pattern alerts, and weekly review otherwise have nowhere to fire.

## Goals and Success Criteria

A native desktop tray app that surfaces reminders, the daily briefing, and approval alerts as OS notifications — with the browser closed — while containing zero business logic (a thin shell over the backend API, per ADR-003/§13).

**Success Metrics:**
- Create a task with a reminder 2 minutes out → within ~5 minutes a native Windows toast fires **with the browser closed** → Snooze 15m / Snooze 1h / Dismiss all work and reflect in the backend.
- The daily briefing fires a notification on app startup and at the configured briefing time when one is available and undelivered.
- A pending approval fires a notification; clicking it opens the web `/approvals` page.
- The app starts on login (autostart), runs as a tray icon with no primary window, and survives going offline (fires from the last cached payload; recovers on reconnect).
- The tray contains **no business logic** — verified: no direct Supabase/DB access, no recurrence math, no "what's due" rules; every decision comes from an API response.

## Scope

### In Scope
- New `apps/tray/` Tauri app (Rust core + system webview); monorepo integration alongside `apps/web` + `packages/types`.
- **Windows-first** (`.exe`); the Tauri codebase stays cross-platform but Mac packaging/signing is deferred (ADR-014).
- **Unsigned local build** for the single-user validation phase; code-signing cert + release CI deferred (ADR-014).
- Auth: Supabase sign-in in the webview; refresh token persisted via Tauri secure storage; token refresh against the existing Supabase pattern.
- Poll/fire loop: `/api/tasks/due` (~5 min) → native reminder notifications with Snooze 15m / Snooze 1h / Dismiss (→ `POST /api/tasks/[id]/snooze`).
- Daily briefing delivery: poll `/api/briefing/today` (startup + configured time); notify when present and undelivered.
- Approval alerts: **new** `GET /api/approvals/pending` endpoint (approvals is server-component-only today) + tray poll → notification that deep-links to web `/approvals`.
- Native tray icon + menu: Open App / Snooze All / Quit. Autostart on login (Tauri autostart plugin). Offline fallback to last cached payload.

### Out of Scope
- **Mac build, code-signing/notarization, and release CI** — deferred to Epic 8 / Productization (ADR-014); track there.
- **PKCE OAuth flow** — the disk-persisted Supabase session is used now; PKCE (localhost callback) is deferred to Productization (blueprint §13.3).
- **Mobile / Web Push** — mobile delivery is Web Push via the PWA in Epic 8; there is no native tray on mobile (blueprint §13.5).
- Any business logic in the shell — explicitly prohibited (ADR-003/§13.2). Recurrence, due-calculation, and briefing assembly stay server-side.
- In-tray task/goal editing UI — the tray notifies and deep-links; management stays in the web app.

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 6.1: Tauri Shell, Auth & Autostart
- **Scope:** Scaffold `apps/tray/` (Tauri Rust core + webview); Supabase sign-in in the webview with the refresh token persisted to Tauri secure storage; tray icon + menu (Open App / Snooze All / Quit); autostart on login; no primary window.
- **Key Technical Approach:** Tauri v2 (Rust core + system webview); Tauri tray + menu API; Tauri autostart plugin; Tauri secure-storage for the persisted refresh token; the webview reuses the Supabase auth session pattern from `apps/web`. Thin shell — no DB access. See blueprint §13.3, ADR-003.
- **Requirements:** Business Requirements (Notifications capability); security NFRs (credential-at-rest handling).
- **Dependencies:** Epic 1 (deployed API + auth).
- **Wave Planning:** Scaffold + tray/menu wave → auth + secure-storage + autostart wave.

### Feature 6.2: Reminder Poll & Native Notifications
- **Scope:** Poll `GET /api/tasks/due` (~every 5 min); fire a native notification per due reminder with action buttons Snooze 15m / Snooze 1h / Dismiss; Snooze calls `POST /api/tasks/[id]/snooze`; "Snooze All" from the tray menu; offline → fire from the last cached payload and reconcile on reconnect. De-duplicate so the same reminder does not re-fire every poll.
- **Key Technical Approach:** Tauri notification plugin (native Windows toast) with action buttons; a Rust/JS poll loop with a locally cached "already-notified" set keyed by reminder id + occurrence; all "what's due" logic comes from the API response (no recurrence math in the shell). See blueprint §13.3, §7.4.
- **Requirements:** Business Requirements (reminder delivery); acceptance: browser-closed toast within ~5 min.
- **Dependencies:** Feature 6.1.
- **Wave Planning:** Poll loop + notification wave → snooze/dismiss actions + offline fallback wave.

### Feature 6.3: Briefing & Approval Delivery
- **Scope:** Daily briefing — poll `GET /api/briefing/today` on startup + at the configured briefing time; notify when present and undelivered (respect the delivered flag). Approval alerts — build a new `GET /api/approvals/pending` endpoint (auth-scoped, RLS, returns count + minimal metadata — no payloads), poll it, and notify on pending items; the notification deep-links to the web `/approvals` page.
- **Key Technical Approach:** Reuse the poll/notify pattern from 6.2. The new `/api/approvals/pending` route uses `createAuthServerClient` (RLS) and returns only what a notification needs (count, ids, action_type/provider) — never the raw payload (payload review stays in the web `/approvals` UI, consistent with ADR-013's raw-payload-in-web-UI principle). See blueprint §11.2, §10.4.
- **Requirements:** Business Requirements (briefing + approval delivery); ADR-009/013 (approval review surface).
- **Dependencies:** Feature 6.1; briefing endpoint (Epic 4); approvals data (Epic 5).
- **Wave Planning:** `/api/approvals/pending` endpoint + poll wave → briefing + approval notification wave.

## Dependencies

**Prerequisites:** Epic 1 (deployed API, auth, `/api/tasks/due`, `/api/tasks/[id]/snooze`). Uses: Epic 4 (`/api/briefing/today`), Epic 5 (approvals data → new pending endpoint).
**Enables:** **Epic 7 (Proactive Intelligence)** — the desktop surface for stale-goal nudges, detected-pattern alerts, and the Friday weekly review. Without this epic those fire only into the web app / daily briefing.
**External Dependencies:** Rust toolchain (build-time); Tauri v2 + plugins (notification, autostart, secure-storage). No new runtime cloud services.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Business logic leaks into the shell (repeat of the Node daemon's sin) | High | Med | Hard rule: shell only polls/renders/calls endpoints; code review + a checklist item asserting no DB client and no recurrence math in `apps/tray` |
| Persisted refresh token on disk is exfiltrated | High | Low | Use Tauri secure storage (OS keychain-backed), not a plaintext file; never log the token; scope to the single user; PKCE migration tracked for Epic 8 |
| Duplicate/again-and-again notifications each poll | Med | Med | Local already-notified set keyed by reminder id + occurrence; reconcile against the API's due list each cycle |
| SmartScreen warning on the unsigned build confuses use | Low | High | Expected for unsigned validation builds — dismiss once; signing cert deferred to Epic 8 (ADR-014); documented in the run instructions |
| Rust toolchain adds CI/build friction | Med | Med | Local dev build only this epic; no release CI until signing is scheduled (Epic 8) |
| Offline poll fires stale/cancelled reminders | Med | Low | Cache is last-known payload; reconcile on reconnect; snooze/dismiss are best-effort and re-sync when the API is reachable |

## Technical Considerations

- **Thin shell is the load-bearing principle** (ADR-003, blueprint §13.2). The shell authenticates, polls (`/api/tasks/due`, `/api/tasks/[id]/snooze`, `/api/briefing/today`, `/api/approvals/pending`), renders native notifications, and calls endpoints on user action — nothing else. All durable logic stays in the API + `@personal-assistant/types`, so web, tray, and future mobile never rebuild it.
- Only **one new backend artifact** is required: `GET /api/approvals/pending`. Reminder, snooze, and briefing endpoints already exist.
- The tray is **disposable by design** — if Tauri were ever swapped, nothing of value is lost because the logic is server-side.
- Windows-first is a packaging/CI decision, not a code decision: the Tauri source stays cross-platform so the Mac build (Epic 8) is a CI/signing effort, not a rewrite.

## Compliance and Security

The tray handles one sensitive asset: the persisted Supabase refresh token. It must live in Tauri secure storage (OS-keychain-backed), never a plaintext file, and never be logged. All API calls are authenticated as the signed-in user and subject to the same RLS as the web app. The new `/api/approvals/pending` endpoint returns only notification metadata (never raw action payloads — payload review stays in the web UI per ADR-013). No new external services or data stores are introduced. PKCE OAuth is the productization-phase hardening (Epic 8).

## Related Documentation
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§13 Tray App, §17 Roadmap)
- Brainstorming: docs/planning/epic-6-brainstorming.md
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Notifications)
- Architecture: docs/architecture/_main/04-Architecture.md

## Architecture Decision Records (ADRs)
- ADR-003: Tauri tray replaces the Node.js daemon (stands)
- ADR-012: Remove the Node.js tray; Tauri is the only tray (stands; its "defer to Epic 7/Productization" default is revised by ADR-014)
- ADR-014: Tauri tray as Epic 6 — Windows-first, unsigned local build now

---
**Template Version:** 2.0 (3-layer, embedded features)
