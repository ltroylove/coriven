---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "2.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-012"
deciders: "Roy Love"
product:
  - "coriven"
tags: [tray, tauri, node-daemon, removal]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/architecture/decisions/ADR-003 (in 04-Architecture.md)"
---

# ADR-012: Remove the Node.js Tray; Tauri Is the Only Tray

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: ADR-003 (Tauri tray replaces the Node.js daemon); Wave 1.3.1; blueprint §13

> **v2 (2026-06-29):** Supersedes this ADR's own v1 "defer Tauri, keep the Node daemon through Epics 1–6." The Node daemon is being **removed now**, not maintained.

---

## Context

ADR-003 accepted **Tauri** as the eventual cross-platform tray, with the Node.js Windows daemon (`apps/tray`) as a disposable interim shell. In practice the Node daemon kept generating drag: it surfaced in waves (1.3.1), bug fixes, and a "defer vs build" decision, and pulled attention toward a Windows-only artifact the user does not want to invest in or manually test. The reusable logic already lives in the API + `@personal-assistant/types`, so the Node shell carries little value.

## Considered Options

- **Option 1: Keep the Node daemon** (maintain/test it until Tauri) — the original ADR-012 v1 stance.
- **Option 2: Remove the Node daemon now**; build the Tauri tray when tray work is prioritized; no desktop tray in the interim.
- **Option 3: Build Tauri immediately** (Rust scaffold + native notifications now).

## Decision

**Remove the Node.js Windows daemon (`apps/tray`) now.** Tauri is the only tray going forward (per ADR-003), to be built as a dedicated effort when tray work is prioritized. Until then there is **no desktop tray**; the web app is the surface, and reminder/briefing delivery via a desktop tray is pending the Tauri build (Web Push via PWA remains the mobile path — Epic 7).

### Why This Choice

1. **Stops the interference.** The Node daemon repeatedly diverted focus; removing it keeps work on the actual product (web app, memory, goals).
2. **No real loss.** It was a thin Windows-only shell; all durable logic is in the API/shared types. Nothing of value is deleted.
3. **Tauri is still the plan.** ADR-003 stands — when tray work is scheduled, it's built as a clean Tauri thin shell (auth, poll `/api/tasks/due`, native notifications, tray menu, autostart), cross-platform from the start.

## Consequences

### Positive
- No Windows-only daemon to maintain, test, or reason about.
- Monorepo simplifies to `apps/web` + `packages/types`.
- Clean slate for Tauri when it's time.

### Negative
- **No desktop notifications until the Tauri tray is built.** Reminders are visible in the web app only in the interim.

### Mitigation
- `getNextOccurrence` and other shared logic remain in `@personal-assistant/types`; `/api/tasks/due` remains, so the future Tauri shell stays thin.
- Schedule the Tauri build as its own effort (candidate: Epic 7 / Productization, or sooner if desktop reminders are needed).

## What was removed
- `apps/tray/` (Node.js daemon: systray2 + node-notifier).
- Root `tray:dev` / `tray:build` scripts and the tray entry in the `typecheck` script.
- Tray-related `.gitignore` entries and the local `apps/tray/.env` config.

---

## References
- ADR-003 (Tauri tray replaces the Node.js daemon) — `docs/architecture/_main/04-Architecture.md`
- Master blueprint §13 (Tray App)
- Wave 1.3.1 (superseded) — `docs/implementation/iterations/wave-1.3.1-tray-reliability-tauri-decision.md`

---

**Last Updated**: 2026-06-29
