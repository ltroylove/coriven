---
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
feature: "6.1"
wave: "6.1.1"
agents: [backend-specialist, devops-specialist, quality-control]
tags: [coriven, tray, tauri, desktop, rust, windows, monorepo]
relateddocuments:
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 6.1.1: Tauri Shell Scaffold & Native Tray

## Wave Overview
- **Wave ID:** Wave-6.1.1
- **Feature:** Feature 6.1 - Tauri Shell, Auth & Autostart
- **Epic:** Epic 6 - Tauri Tray — Desktop Delivery
- **Status:** Planning
- **Scope**: A new `apps/tray/` Tauri v2 application (Rust core + system webview) integrated into the monorepo; a native Windows tray icon with an Open App / Snooze All / Quit menu; no primary window; an unsigned local Windows build with documented run instructions; thin-shell compliance verified.
- **Wave Goal:** Establish a running, always-on Coriven desktop tray application — start it, see the tray icon, use the menu, quit it — as the foundation every later Epic 6 wave (auth, polling, notifications) builds on.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A Tauri v2 app lives at `apps/tray/` in the monorepo with working dev-run and build workflows alongside `apps/web` and `packages/types`.
2. Launching the app produces a native Windows tray icon and no primary window; the app stays resident until explicitly quit.
3. The tray menu offers Open App (opens the Coriven web app in the default browser), Snooze All (present as a placeholder — wired to the backend in Feature 6.2), and Quit.
4. An unsigned local Windows build exists with run instructions covering the one-time SmartScreen dismissal (ADR-014).
5. The shell is verifiably thin: no database client, no Supabase data access, no business logic anywhere in `apps/tray/` (ADR-003, blueprint §13.2).

## User Stories

### User Story 1: Always-on tray presence

**As a** Coriven user
**I want** the tray app to run as a background tray icon with no window
**So that** Coriven has a persistent desktop presence that can later reach me without a browser open

**Acceptance Criteria:**
- [ ] Launching the app shows a recognizable Coriven icon in the Windows system tray within a few seconds.
- [ ] No primary window opens on launch and none appears in the taskbar or Alt-Tab list.
- [ ] The app remains resident (icon present, process alive) until the user quits it; it does not exit when idle.

**Priority:** High

---

### User Story 2: Tray menu actions

**As a** Coriven user
**I want** a right-click tray menu with Open App, Snooze All, and Quit
**So that** I can reach the web app or shut the tray down without hunting for a window

**Acceptance Criteria:**
- [ ] Right-clicking the tray icon shows a native menu with exactly: Open App, Snooze All, Quit.
- [ ] Open App opens the Coriven web app in the user's default browser.
- [ ] Quit exits the app cleanly — the icon disappears and no process is left running.
- [ ] Snooze All is visible but inert this wave (clearly a placeholder — it performs no action and causes no error); Feature 6.2 wires it to the backend.

**Priority:** High

---

### User Story 3: Monorepo developer workflow

**As the** owner/developer
**I want** the tray app integrated into the existing monorepo tooling
**So that** I can develop, type-check, and build it with the same workflow as the rest of Coriven

**Acceptance Criteria:**
- [ ] A single documented command starts the tray app in development mode from the repo root.
- [ ] A single documented command produces the unsigned Windows executable.
- [ ] Rust toolchain prerequisites and first-run setup are documented in the repo.
- [ ] The repo-wide type check still passes with the new app in place.

**Priority:** High

---

### User Story 4: Verified thin shell

**As the** owner/architect
**I want** the scaffolded shell to contain no business logic and no data access
**So that** the tray stays disposable and all durable logic remains server-side (ADR-003)

**Acceptance Criteria:**
- [ ] The tray app has no database client dependency and no direct Supabase data access.
- [ ] No recurrence math, due-date calculation, or "what's due" rules exist anywhere in the tray codebase.
- [ ] The Tauri source contains no Windows-only code paths that would block a future Mac build (packaging is Windows-first; source stays cross-platform per ADR-014).

**Priority:** High

## Logical Unit Test Cases

> This wave delivers a native shell, not API endpoints; test cases are launch/behavior verifications.

### Test Case 1: Launch produces tray icon, no window
- **Endpoint:** Internal — app launch
- **Method:** Manual/automated launch
- **Test Data:** Fresh start on Windows 10/11
- **Expected Result:** Tray icon visible; zero application windows
- **Verification:** Icon present in system tray; no taskbar entry; process resident

### Test Case 2: Open App opens the web app
- **Endpoint:** Internal — tray menu action
- **Method:** Menu click
- **Test Data:** Configured Coriven web app URL
- **Expected Result:** Default browser opens at the configured URL
- **Verification:** Browser navigates to the web app; tray app keeps running

### Test Case 3: Quit terminates cleanly
- **Endpoint:** Internal — tray menu action
- **Method:** Menu click
- **Test Data:** Running tray app
- **Expected Result:** Icon removed, process exits with code 0
- **Verification:** No orphan process in Task Manager after quit

### Test Case 4: Thin-shell dependency audit
- **Endpoint:** Internal — dependency/code inspection
- **Method:** Audit
- **Test Data:** `apps/tray/` manifests and source
- **Expected Result:** No DB/Supabase-data client, no business-logic modules
- **Verification:** Dependency list and source review recorded against the thin-shell checklist

## Technical Tasks

### Task 1: Scaffold Tauri v2 app and integrate into the monorepo
- **Agent:** devops-specialist
- **Estimation:** 4-6 hours (uncertainty: first Rust/Tauri toolchain setup on this machine)
- **Dependencies:** None
- **Priority:** High

**Deliverables:**
- New `apps/tray/` Tauri v2 project (Rust core + system webview) building on Windows
- Root-level npm scripts for tray dev-run and build; workspace wiring so `npm install` and `npm run typecheck` cover the new app
- Rust toolchain prerequisites documented in the repo (setup + versions)

**Acceptance Criteria:**
- [ ] Dev-run and build commands work from the repo root as documented
- [ ] Repo-wide typecheck passes with the new app present
- [ ] The scaffold pins Tauri v2 and builds a Windows executable

---

### Task 2: Tray icon, menu, and windowless background behavior
- **Agent:** backend-specialist
- **Estimation:** 4-6 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Native tray icon with Coriven branding asset
- Tray menu: Open App (opens the configured web app URL in the default browser), Snooze All (inert placeholder with a marked hook point for Feature 6.2), Quit (clean shutdown)
- App configured with no primary window; stays resident until Quit

**Acceptance Criteria:**
- [ ] Behaves per User Stories 1 and 2 acceptance criteria
- [ ] The web app URL is configurable (not hardcoded to one environment)
- [ ] No platform-specific (Windows-only) source paths introduced

---

### Task 3: Unsigned Windows build and run instructions
- **Agent:** devops-specialist
- **Estimation:** 2-3 hours
- **Dependencies:** Task 2
- **Priority:** Medium

**Deliverables:**
- Reproducible unsigned Windows build (`.exe`) via the documented build command
- Run/install notes in the repo covering the one-time SmartScreen "More info → Run anyway" dismissal (ADR-014) and how to start/stop the app

**Acceptance Criteria:**
- [ ] The built executable runs on a Windows machine outside the dev environment context
- [ ] SmartScreen behavior and dismissal are documented; no signing infrastructure introduced (deferred to Epic 8)

---

### Task 4: Thin-shell compliance check and smoke verification
- **Agent:** quality-control
- **Estimation:** 2 hours
- **Dependencies:** Task 3
- **Priority:** High

**Deliverables:**
- Executed thin-shell checklist (no DB client, no Supabase data access, no recurrence/due logic) with findings recorded
- Smoke verification of Test Cases 1-4

**Acceptance Criteria:**
- [ ] All four test cases pass and are recorded
- [ ] Zero thin-shell violations, or each violation remediated before wave close

## Task Dependencies

```
Task 1 (scaffold + monorepo wiring)
  ↓
Task 2 (tray icon + menu + windowless)
  ↓
Task 3 (unsigned build + run docs)
  ↓
Task 4 (thin-shell check + smoke verification)
```

**Critical path:** Task 1 → Task 2 → Task 3 → Task 4 (strictly sequential; the wave is small by design).
**Parallel streams:** None — Task 3's docs can be drafted alongside Task 2, but verification needs the build.
**Bottleneck:** Task 1 toolchain setup (first Rust install); start it first.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| devops-specialist | Task 1, Task 3 | 6-9 |
| backend-specialist | Task 2 | 4-6 |
| quality-control | Task 4 | 2 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Test cases 1-4 verified and recorded
- [ ] Repo-wide typecheck passes; no linter errors
- [ ] Thin-shell checklist passed (no DB client, no business logic in `apps/tray/`)
- [ ] Code reviewed and approved
- [ ] Documentation updated (toolchain setup, dev/build commands, SmartScreen run notes)
- [ ] Unsigned Windows build produced and launched successfully on the target machine

## Infrastructure Specifications

### Tauri Application

- **Framework:** Tauri v2 (Rust core + system webview — WebView2 on Windows). Tray icon and menu use Tauri v2's built-in tray API (`tray-icon` capability); no separate plugin required for this wave.
- **Location:** `apps/tray/` in the monorepo, sibling to `apps/web`; shares nothing at runtime with the web app besides (later) the API and `@personal-assistant/types`.
- **Windowing:** No primary window declared; the app runs tray-only. (Wave 6.1.2 adds an on-demand auth window.)
- **Configuration:** The Coriven web app base URL is supplied via build-time config/env — production URL by default, overridable for local dev. No secrets are involved this wave.
- **Cross-platform rule:** Source must compile-cleanly cross-platform; only packaging/CI is Windows-first (ADR-014). Mac packaging, signing, and release CI are Epic 8.
- **Build:** Local unsigned build only. No CI pipeline for the tray this epic.

### Explicitly absent (thin-shell guarantees)

- No Supabase client for data access, no direct DB connection, no `supabase/` coupling.
- No recurrence math, due-time calculation, or notification-decision logic — those arrive in later waves strictly as API-response rendering.

## Handoff Requirements

**For next wave (6.1.2):**
- A running Tauri v2 shell that 6.1.2 extends with an auth window, secure-storage bridge, and autostart — no re-scaffolding.
- Configurable web app base URL mechanism (6.1.2 reuses it for the Supabase/API endpoints configuration).
- Documented dev-run/build workflow so auth work iterates quickly.

**For other Features/Epics:**
- Feature 6.2: the Snooze All menu item's marked hook point (to be wired to the snooze endpoint) and the resident app skeleton that will host the poll loop.
- Feature 6.3: same resident shell for briefing/approval polling.
- Epic 8: cross-platform-clean source so the Mac build is a packaging/signing effort only.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Rust toolchain setup friction on the dev machine | Med | Task 1 first; document exact versions; local-only build this epic (no CI) |
| Business logic creeps in during scaffolding | High | Task 4 thin-shell checklist is a hard gate; epic risk register rule enforced at review |
| SmartScreen warning mistaken for a broken build | Low | Expected for unsigned builds; dismissal documented in run notes (ADR-014) |
| Tauri v2 tray/menu API differs from v1 assumptions in older docs | Low | Verify against current Tauri v2 docs during Task 2; adjust wave 6.1.2 plugin notes if needed |

## Notes and Assumptions

- Tauri v2 (not v1) is assumed; its tray + menu support is core (no plugin), and its plugin ecosystem (autostart, notifications) is what later waves rely on.
- "Open App" opens the web app in the default browser — the tray deliberately has no primary window; management stays in the web app (epic scope).
- Snooze All ships as a visible placeholder because the tray menu contract (Open App / Snooze All / Quit) is fixed by the epic; its backend wiring belongs to Feature 6.2 with the snooze flow.
- Effort figures are scope-based solo-developer estimates; Task 1 carries the most uncertainty (first Rust/Tauri setup) and is flagged.

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-6-tauri-tray.md (Feature 6.1)
- Architecture Decision: docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md (plus ADR-003, ADR-012)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§13)

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
