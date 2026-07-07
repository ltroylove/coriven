# Epic 6 (Tauri Tray) — Brainstorming Notes

**Date:** 2026-07-05
**Scope decision:** Epic (new **Epic 6**), inserted before Proactive Intelligence.
**Consequence:** Proactive Intelligence → Epic 7; Productization → Epic 8.

## Why an epic, and why now (before Proactive)

- The desktop tray is the only surface that reaches the user **without a browser open**. It is how Coriven is proactive on the desktop (blueprint §13.1).
- Proactive Intelligence (now Epic 7) generates desktop-notification-worthy events — stale-goal nudges, detected-pattern alerts, Friday weekly review (blueprint §12.x). Building those *before* a delivery surface means they land only in the web app / daily briefing. **Build the surface first** so the proactive features have somewhere to fire.
- The prior Node.js Windows daemon was **removed** (ADR-012 v2). There is currently **no desktop tray** — reminders are visible in the web app only. This epic closes that gap.

## Load-bearing decisions (this session)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | New Epic 6; renumber 6→7, 7→8 | Tray is epic-sized (new `apps/tray` codebase, Rust toolchain, cross-platform, CI/signing) and sequenced before Proactive |
| Sequencing | Tray first, then Proactive | Deliver the notification surface before the features that produce notifications |
| Platforms | **Windows-first, Mac later** | User is on Windows; defer Apple Developer Program ($99/yr) + notarization until Mac is actually needed. Tauri codebase stays cross-platform — only Mac CI/signing is deferred |
| Signing/distribution | **Unsigned local build now, signing + CI later** | Single-user validation phase; dismiss SmartScreen once. Code-signing cert + CI pipeline deferred to a later phase / Productization (Epic 8) |
| v1 surface | **All three at once**: reminders + daily briefing + approval alerts | Briefing endpoint (Epic 4) and approval data (Epic 5) already exist; deliver the full proactive-desktop value in v1 |

## Blueprint-derived constraints (not re-litigated)

- **Thin shell, no business logic** (§13.2): the tray only authenticates, polls API endpoints, renders native notifications, and calls endpoints on user action. No DB access, no recurrence math, no "what's due" rules — all of that stays server-side in the API + `@personal-assistant/types`. (The prior daemon violated this; the Tauri app must not.)
- **Architecture** (§13.3): Tauri (Rust core + system webview); native tray API (Open App / Snooze All / Quit); Tauri notification plugin with action buttons (Snooze 15m / Snooze 1h / Dismiss); Tauri autostart plugin; poll/fire loop ~every 5 min with offline fallback to last cached payload.
- **Auth** (§13.3): reuse the Supabase session pattern — sign in, persist the refresh token to disk via Tauri secure storage. PKCE OAuth (localhost callback) is deferred to Productization (Epic 8), consistent with the blueprint.
- **Mobile** (§13.5): out of scope — mobile delivery is Web Push via the PWA in Productization, not a native tray.

## Endpoint inventory (verified 2026-07-05)

| Endpoint | Status | Used for |
|----------|--------|----------|
| `GET /api/tasks/due` | ✅ built (Epic 1) | reminder poll |
| `POST /api/tasks/[id]/snooze` | ✅ built (Epic 1) | snooze action |
| `GET /api/briefing/today` | ✅ built (Epic 4) | daily briefing delivery |
| `GET /api/approvals/pending` | ❌ **missing** — `/approvals` is server-component-only | approval-alert poll |

→ The "all three surfaces" choice requires building **one new polling endpoint** (`/api/approvals/pending`) as part of this epic. Everything else the tray consumes already exists.

## Open items carried into the epic / ADR

- ADR needed to (a) elevate the tray to Epic 6 now and (b) record the Windows-first + unsigned-local decisions — this revises ADR-012's "defer to Epic 7 / Productization" default. ADR-003 (Tauri is the tray) still stands.
- Signing cert + Mac notarization + dual-artifact CI are explicitly **deferred** — track as debt for Epic 8.
- Auth token storage on disk (Tauri secure storage) is a security surface — the epic must treat the persisted refresh token with the same care as any secret; documented in the epic's security section.
