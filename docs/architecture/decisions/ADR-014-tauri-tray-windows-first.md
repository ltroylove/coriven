---
datecreated: "2026-07-05"
lastupdated: "2026-07-05T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-014"
deciders: "Roy Love"
product:
  - "coriven"
tags: [tray, tauri, desktop, scheduling, windows, signing]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-003 (in 04-Architecture.md)"
  - "docs/architecture/decisions/ADR-012-tauri-migration-timing.md"
---

# ADR-014: Tauri Tray as Epic 6 — Windows-First, Unsigned Local Build Now

**Status**: Accepted **Date**: 2026-07-05 **Deciders**: Roy Love **Related**: ADR-003 (Tauri tray replaces the Node.js daemon), ADR-012 (removed the Node.js daemon; deferred Tauri), Epic 6 (Tauri Tray), blueprint §13, §17.5

---

## Context

ADR-003 established Tauri as Coriven's cross-platform tray. ADR-012 removed the interim Node.js Windows daemon and left the Tauri build as an unscheduled effort with a stated default of "when tray work is prioritized — candidate Epic 7 / Productization." Meanwhile the roadmap language was contradictory: blueprint §13 said "Tauri now," while §17.6 (Productization) claimed the tray "already shipped in Phase 1." Neither was true — there is currently **no desktop tray**, and reminders surface only in the web app.

Three forces now converge to require a decision:

1. **Proactive Intelligence needs a delivery surface.** The next planned epic (Proactive Intelligence) generates desktop-notification-worthy events — stale-goal nudges, detected-pattern alerts, the Friday weekly review. Building those before a tray means they land only in the web app / daily briefing.
2. **The backend is ready.** `/api/tasks/due`, `/api/tasks/[id]/snooze`, and `/api/briefing/today` already exist; only `/api/approvals/pending` is missing. The tray can be a genuinely thin shell.
3. **The full cross-platform + signed path carries real one-time cost** (Apple Developer Program $99/yr + notarization, a Windows code-signing certificate, dual-artifact CI) that is disproportionate for a single-user validation phase.

## Considered Options

- **Option 1: Defer the tray to Productization** (ADR-012's default). Proactive Intelligence ships with no desktop delivery.
- **Option 2: Build the tray as a new Epic 6 before Proactive, Windows-first, unsigned local build now; defer Mac + signing + CI to Productization.**
- **Option 3: Build the tray now with the full blueprint §13.4 scope** — Windows + Mac, code-signing, notarization, release CI — as a single effort.
- **Option 4: Do nothing** — leave reminders web-only indefinitely.

## Decision

**We have decided on Option 2: build the Tauri tray as a new Epic 6, sequenced before Proactive Intelligence, targeting Windows-first with an unsigned local build now; Mac packaging, code-signing/notarization, and release CI are deferred to Productization (Epic 8).**

This renumbers the downstream roadmap: Proactive Intelligence becomes Epic 7, Productization becomes Epic 8. It revises ADR-012's "defer to Epic 7 / Productization" default (ADR-012's removal of the Node daemon and its "Tauri is the only tray" stance both stand). ADR-003 is unchanged.

### Why This Choice

**Key factors:**

1. **Deliver the surface before the features that need it.** Proactive Intelligence is materially less valuable without a desktop notification channel; building the tray first means nudges/patterns/weekly-review fire natively when Epic 7 ships.
2. **The shell is cheap because the logic is server-side.** Per ADR-003/§13.2 the tray only authenticates, polls, renders notifications, and calls endpoints. With the backend already built, Epic 6 adds just one endpoint (`/api/approvals/pending`) plus the Tauri shell — a small, well-bounded effort.
3. **Match cost to phase.** Windows-first + unsigned local is right-sized for single-user validation: the user dismisses SmartScreen once and gets working desktop reminders immediately. The Apple Developer Program, code-signing certificate, notarization, and release CI are productization concerns — paying them now would front-load cost for a distribution audience that doesn't exist yet. The Tauri source stays cross-platform, so the Mac build is later a CI/signing effort, not a rewrite.

## Consequences

### Positive

- Coriven gains desktop reminder/briefing/approval delivery with the browser closed — the long-standing gap since the Node daemon's removal.
- Proactive Intelligence (Epic 7) has a real delivery surface on day one.
- Small, bounded epic: one new endpoint + a thin Tauri shell; no new cloud services.
- Cross-platform-ready source without paying cross-platform packaging cost prematurely.

### Negative

- **No Mac build and no signed/distributable artifact** until Productization (Epic 8). The validation build shows a SmartScreen warning (dismiss once).
- Adds a Rust toolchain to the local dev environment.
- The disk-persisted Supabase refresh token is a credential-at-rest surface (interim; PKCE OAuth is the Epic 8 hardening).
- Roadmap renumber (6→7, 7→8) touches several planning docs.

### Mitigation Strategies

- **Signing/CI + Mac + PKCE are explicitly tracked as deferred scope in Epic 8** (Productization), not dropped.
- The persisted refresh token must use Tauri secure storage (OS-keychain-backed), never a plaintext file, and must never be logged — enforced in the Epic 6 security section.
- The "thin shell, no business logic" rule (ADR-003) is a review gate for Epic 6 so the tray stays disposable and the Mac build stays a packaging-only effort.

---

## References

- Epic 6: `docs/implementation/_main/epic-6-tauri-tray.md`
- Brainstorming: `docs/planning/epic-6-brainstorming.md`
- Blueprint §13 (Tray App), §17.5 (roadmap)
- ADR-003 (Tauri tray replaces the Node.js daemon), ADR-012 (Node daemon removed)

---

**Last Updated**: 2026-07-05
