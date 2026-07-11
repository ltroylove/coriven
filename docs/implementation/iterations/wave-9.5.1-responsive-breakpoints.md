---
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven-web"
epic: "9"
feature: "9.5"
wave: "9.5.1"
agents:
  - frontend-specialist
  - quality-control
tags:
  - responsive
  - breakpoints
  - mobile
  - tablet
  - panel-sheet
relateddocuments:
  - docs/planning/bl-002-ui-ux-overhaul-design.md
  - docs/planning/epic-9-shared-contracts.md
  - docs/implementation/_main/epic-9-experience-redesign.md
  - docs/architecture/_main/05a-UX-Foundations.md
  - docs/implementation/iterations/wave-9.5.2-wcag-audit-motion.md
---

# Wave 9.5.1: Responsive Breakpoints

## Wave Overview
- **Wave ID:** Wave-9.5.1
- **Feature:** Feature 9.5 - Responsive & Accessibility
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope**: Implement the three-breakpoint responsive model from design doc §4.6 on top of the completed Epic 9 UI: **<768px** chat-first full screen (rail → menu button, surfaces as full-screen slide-overs, bottom-anchored composer); **768–1100px** rail + chat with the panel rendering as an overlay sheet over chat; **>1100px** the existing full three-zone layout, unchanged.
- **Wave Goal:** Coriven works from phone to wide desktop with one layout system — the panel↔sheet switch is purely a rendering concern per breakpoint, with zero changes to any consumed contract API (C2, C3, C8).

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

**Contract posture (critical):** This wave OWNS no cross-cutting contract. It CONSUMES:
- **C2 (panel controller & surface registry):** `usePanel()` / `openPanel` / `closePanel` / `togglePanel` / `setWidth` and the surface registry are used **exactly as published**. This wave changes only *how the open surface renders per breakpoint* (side-by-side panel vs. overlay sheet vs. full-screen slide-over). No new controller methods, no state-shape changes, no registry edits.
- **C3 (rail):** the rail's `{ surface, icon, label }` item shape is untouched. C3 explicitly delegates the <768px collapse (rail → menu button) to this wave — collapse is a presentational wrapper around the same items.
- **C4 (design tokens):** all responsive transition timing uses `--duration-fast/base/slow` + standard ease; all animation behind `motion-safe:` (existing codebase habit — see `apps/web/src/components/chat/chat-pane.tsx`).
- **C8 (component library):** the tablet overlay sheet and mobile slide-overs are built on the existing `Modal`/`Sheet` primitive from `apps/web/src/components/ui/` — no parallel hand-rolled sheet.

## Wave Goals

1. Deliver the <768px chat-first experience: chat full-screen, rail collapsed to a top-left menu button, composer bottom-anchored, surfaces opening as full-screen slide-overs (design doc §4.6).
2. Deliver the 768–1100px experience: rail + chat, panel content rendered as an overlay sheet (C8 `Sheet`) over chat instead of the side-by-side split.
3. Preserve the >1100px three-zone layout exactly as shipped by 9.1–9.4, and make breakpoint transitions (e.g., window resize, device rotation) state-preserving — the open surface and `focusId` survive a breakpoint change.
4. Prove all of the above with viewport-parameterized component/integration tests plus an axe-core smoke pass per breakpoint (the full audit is 9.5.2).

## User Stories

### User Story 1: Mobile chat-first shell (<768px)

**As a** Coriven user on my phone
**I want** chat to be the whole app, with navigation tucked behind a menu button and the composer anchored to the bottom
**So that** I can use the assistant one-handed like a messaging app instead of a shrunken desktop layout

**Acceptance Criteria:**
- [ ] At viewports <768px, chat renders full-screen; the three-zone grid is not present in the DOM layout
- [ ] The rail collapses to a top-left menu button that opens the same C3 nav items (same `{ surface, icon, label }` data, same order, `aria-current` preserved) in a drawer/menu
- [ ] Composer is bottom-anchored and remains visible above the on-screen keyboard (uses viewport-safe units / `dvh`)
- [ ] Existing chat a11y habits preserved: `aria-live="polite"` message region, `aria-busy` on history load, `motion-safe:` guards (per `chat-pane.tsx`)
- [ ] No change to `usePanel()` API or C3 item shape

**Estimated Hours:** 10
**Priority:** High

---

### User Story 2: Mobile surfaces as full-screen slide-overs (<768px)

**As a** mobile user
**I want** opening Tasks/Goals/Email/Settings (or an assistant-opened surface via C6) to slide over the chat full-screen with an obvious way back
**So that** I can work a surface and return to the conversation without losing my place

**Acceptance Criteria:**
- [ ] `openPanel(surface, { focusId })` at <768px renders the surface as a full-screen slide-over built on the C8 `Sheet` primitive; `focusId` scroll/highlight still honored
- [ ] `closePanel()` / `Esc` / back button dismisses the slide-over and returns to chat with scroll position intact (C2 URL↔panel behavior preserved; deep links to `/tasks` etc. open the slide-over)
- [ ] Bottom sheet for quick actions (design §4.6) reuses the same C8 primitive
- [ ] Slide-over transition uses C4 `--duration-base` + standard ease, behind `motion-safe:`
- [ ] Assistant-opened surfaces (`open_surface` events from C6) behave identically to user-opened ones at this breakpoint

**Estimated Hours:** 8
**Priority:** High

---

### User Story 3: Tablet overlay sheet (768–1100px)

**As a** tablet / narrow-window user
**I want** the panel to open as an overlay sheet over chat rather than squeezing into a side-by-side split
**So that** both chat and surfaces stay readable at medium widths

**Acceptance Criteria:**
- [ ] At 768–1100px, rail + chat render side by side; `openPanel()` renders the surface as an overlay sheet (C8 `Sheet`) over the chat column
- [ ] `setWidth(pct)` is a no-op *visually* at this breakpoint (sheet has its own width) but the C2 state shape `{ openSurface, widthPct }` is stored unchanged, so returning to >1100px restores the user's panel width
- [ ] `Esc`/✕ closes the sheet to chat; `[` still toggles; keyboard shortcut map (C9-adjacent, owned by 9.3.2) works unmodified
- [ ] Sheet open/close uses C4 duration tokens behind `motion-safe:`

**Estimated Hours:** 6
**Priority:** High

---

### User Story 4: Breakpoint integrity on desktop and across transitions

**As a** desktop user who resizes windows (or rotates a tablet)
**I want** the full three-zone layout above 1100px and seamless state carry-over when crossing breakpoints
**So that** the redesigned desktop experience from 9.1–9.4 is untouched and resizing never loses my open surface

**Acceptance Criteria:**
- [ ] At >1100px, the three-zone layout (rail | chat | panel) renders exactly as delivered by Features 9.1–9.4 — visual regression against the pre-9.5.1 baseline shows no diff at 1280px/1440px
- [ ] Crossing a breakpoint while a surface is open re-renders it in the correct mode (panel ↔ sheet ↔ slide-over) with `openSurface` and `focusId` preserved
- [ ] A single breakpoint definition (e.g., token-backed CSS custom media / Tailwind screens) is used everywhere — no scattered magic numbers
- [ ] Viewport-parameterized test suite covers all three breakpoints plus the two transition boundaries

**Estimated Hours:** 6
**Priority:** High

**Wave total estimated hours: 30**

## Infrastructure Specifications

### Testing (always — primary infrastructure for this wave)
- **Framework:** existing Vitest + React Testing Library setup (`apps/web/src/components/**/__tests__/`); Playwright (or existing e2e runner) for viewport-driven integration checks.
- **Accessibility testing:** `axe-core` (via `vitest-axe`/`jest-axe` for components and `@axe-core/playwright` for pages) run at **each of the three breakpoints** as a smoke gate — zero new serious/critical violations. Full formal audit is Wave 9.5.2's scope.
- **Keyboard navigation tests:** at each breakpoint — menu button reachable and operable by keyboard; slide-over/sheet gets focus on open and returns focus on close (deep focus-trap verification lands in 9.5.2, but open/close focus handoff is asserted here since this wave introduces the sheet renderings).
- **Viewport matrix:** 375×812 (mobile), 900×1200 (tablet), 1440×900 (desktop), plus boundary widths 767/768 and 1100/1101.
- **Visual regression:** screenshot baseline at 1280px/1440px before this wave starts; assert no desktop diff after.
- **Unit coverage:** breakpoint hook/utility (`useBreakpoint` or CSS-only equivalent) fully unit-tested.

### UI (heavy)
- All work is presentation-layer: responsive rendering of the C2 panel slot, C3 rail collapse wrapper, composer anchoring, C8 `Sheet` composition. Tailwind 4 CSS-first breakpoints; no raw palette values (C4 rule); `motion-safe:` on every transition.
- File surface: `apps/web/src/app/layout.tsx` (or the shell component owning the three-zone grid), `apps/web/src/components/` shell/rail/panel/chat files, `apps/web/src/components/ui/` **consumption only** (no primitive API changes).

### Database (none)
- No schema, migration, RLS, or server-action changes. Any task that appears to need one is out of scope and must be flagged.

### Deployment (light)
- Ships through the normal PR flow (`development` → PR; never direct to `main`). No env vars, no infra changes. Vercel preview deploys are the review surface for real-device checks.

### Monitoring (light)
- No new monitoring. Manually verify on a Vercel preview from one real phone and one tablet-width window before wave close (noted in DoD).

## Technical Tasks

### Task 9.5.1.1.1: Breakpoint system + shell layout switching
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (within wave); Features 9.1–9.4 complete (external)
- **Priority:** High

**Deliverables:**
- Single source-of-truth breakpoint definitions (<768 / 768–1100 / >1100) as Tailwind screens / CSS custom media in `apps/web/src/app/globals.css`, plus a `useBreakpoint()` client hook for render-mode branching
- Shell (`layout.tsx` / shell component) switches between mobile / tablet / desktop composition using those definitions only
- Unit tests for the hook incl. boundary values (767/768, 1100/1101)

**Acceptance Criteria:**
- [ ] One definition site; no magic-number media queries in components
- [ ] Desktop (>1100px) DOM/visuals unchanged vs. baseline

---

### Task 9.5.1.1.2: Rail → menu button collapse (<768px)
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.5.1.1.1
- **Priority:** High

**Deliverables:**
- Top-left menu button at <768px opening a drawer that renders the **same C3 nav items** (registry-driven order, active state from `usePanel().openSurface`, `aria-current="page"`)
- Drawer built on C8 `Sheet`; keyboard-operable; labeled (`aria-label="Navigation"`); closes on selection and `Esc`

**Acceptance Criteria:**
- [ ] C3 item shape `{ surface, icon, label }` unmodified — collapse is a wrapper, not a fork
- [ ] Menu button + drawer pass axe smoke and keyboard-operability test

---

### Task 9.5.1.1.3: Bottom-anchored composer + mobile chat layout
- **Agent:** frontend-specialist
- **Estimation:** 2 hours
- **Dependencies:** Task 9.5.1.1.1
- **Priority:** High

**Deliverables:**
- Composer pinned to viewport bottom at <768px using dynamic-viewport-safe sizing (`dvh`/safe-area insets); message scroll region fills remaining height
- Chat a11y attributes from `chat-pane.tsx` (`aria-live`, `aria-busy`, `aria-label`, `motion-safe:`) verified intact in the mobile composition

**Acceptance Criteria:**
- [ ] Composer visible with on-screen keyboard open (manual device check on Vercel preview)
- [ ] Existing `chat-pane` tests still pass; new mobile-viewport test added

---

### Task 9.5.1.2.1: Full-screen slide-over rendering of surfaces (<768px)
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Tasks 9.5.1.1.1, 9.5.1.1.2
- **Priority:** High

**Deliverables:**
- Panel slot renders `openSurface` as a full-screen C8 `Sheet` slide-over at <768px; header with back/✕ affordance; `focusId` honored (C2)
- Deep links (`/tasks`, `/goals`, `/email`, `/settings`, `/activity` — C5 map) open the slide-over; back button and `Esc` close to chat
- C6 `open_surface` events verified to open the slide-over identically (no C6 code changes)
- Transition on C4 `--duration-base`, `motion-safe:` guarded

**Acceptance Criteria:**
- [ ] Zero changes to `usePanel()` API or panel state shape
- [ ] Focus moves into the slide-over on open and returns to trigger/composer on close

---

### Task 9.5.1.2.2: Mobile bottom sheet for quick actions
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.5.1.2.1
- **Priority:** Medium

**Deliverables:**
- Bottom-sheet variant (C8 `Sheet`, bottom edge) for quick actions at <768px (design §4.6); wired to existing actions only — no new server actions
- Keyboard + axe smoke tests

**Acceptance Criteria:**
- [ ] Reuses C8 primitive — no parallel sheet implementation
- [ ] Dismissible via `Esc`, ✕, and scrim tap

---

### Task 9.5.1.3.1: Tablet overlay-sheet panel rendering (768–1100px)
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.5.1.1.1
- **Priority:** High

**Deliverables:**
- At 768–1100px, `openPanel()` renders the surface as a C8 `Sheet` overlaying the chat column (rail stays visible); `Esc`/✕/`[` behavior unchanged
- `widthPct` stored but not visually applied at this breakpoint; restored on return to >1100px
- Transition on C4 tokens, `motion-safe:` guarded

**Acceptance Criteria:**
- [ ] C2 state shape and controller API untouched
- [ ] Test: open panel at desktop width, shrink to tablet → same surface now a sheet; widen → panel restored at prior `widthPct`

---

### Task 9.5.1.4.1: Cross-breakpoint state-preservation + viewport test matrix
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Tasks 9.5.1.2.1, 9.5.1.3.1
- **Priority:** High

**Deliverables:**
- Resize/rotation handling: `openSurface` + `focusId` survive breakpoint crossings; no unmount/remount data loss in surface content where avoidable
- Playwright (or equivalent) viewport matrix suite: 3 breakpoints + 2 boundaries; per-breakpoint axe-core smoke run wired into CI test script

**Acceptance Criteria:**
- [ ] All matrix tests green; axe smoke reports zero new serious/critical violations per breakpoint
- [ ] Boundary widths (767/768, 1100/1101) render the correct mode

---

### Task 9.5.1.4.2: Desktop regression verification + wave QC
- **Agent:** quality-control
- **Estimation:** 3 hours
- **Dependencies:** Task 9.5.1.4.1
- **Priority:** High

**Deliverables:**
- Visual-regression comparison at 1280px/1440px vs. pre-wave baseline (no desktop diff)
- Manual pass on Vercel preview: one real phone, one tablet-width window — checklist of Stories 1–3 acceptance criteria
- Evidence log (screenshots + test output) attached to the PR

**Acceptance Criteria:**
- [ ] Desktop unchanged; mobile/tablet checklists pass with evidence
- [ ] Confirms no consumed-contract API drift (diff review of C2/C3/C8 public interfaces)

## Task Dependencies

```
Task 9.5.1.1.1 (breakpoint system — no deps)
  ├─> Task 9.5.1.1.2 (rail collapse)      ─┐
  ├─> Task 9.5.1.1.3 (mobile composer)     │ parallel
  └─> Task 9.5.1.3.1 (tablet sheet)       ─┘
Task 9.5.1.1.2 ─> Task 9.5.1.2.1 (mobile slide-overs) ─> Task 9.5.1.2.2 (bottom sheet)
Task 9.5.1.2.1 + Task 9.5.1.3.1 ─> Task 9.5.1.4.1 (state preservation + test matrix)
Task 9.5.1.4.1 ─> Task 9.5.1.4.2 (QC + desktop regression)
```

**Critical path:** 9.5.1.1.1 → 9.5.1.1.2 → 9.5.1.2.1 → 9.5.1.4.1 → 9.5.1.4.2 (~20h).
**Parallel streams:** 9.5.1.1.3 and 9.5.1.3.1 can run alongside the mobile stream once 9.5.1.1.1 lands; 9.5.1.2.2 is off the critical path.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope |
|-------|-------|-------|------------|
| frontend-specialist | 9.5.1.1.1–.1.3, 9.5.1.2.1–.2.2, 9.5.1.3.1, 9.5.1.4.1 | 27 | `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css` (screens/custom-media only — **not** C4 token values), shell/rail/panel components under `apps/web/src/components/`, chat composer/pane responsive classes, new `useBreakpoint` hook under `apps/web/src/lib/` or `apps/web/src/hooks/`, tests under `apps/web/src/**/__tests__/` + e2e specs |
| quality-control | 9.5.1.4.2 | 3 | Read-only review of the above + evidence artifacts on the PR; interface-diff check on `apps/web/src/components/ui/` (C8), panel controller (C2), rail (C3) |

**Out of scope for all agents:** `supabase/migrations/`, `apps/web/src/app/actions/`, `apps/web/src/lib/chat/engine.ts` (C6), token *values* in `@theme` (C4, owned by 9.2.1), `components/ui/` primitive APIs (C8, owned by 9.2.2).

## Dependencies

- **Hard (sequencing):** Feature 9.5 is **last** in Epic 9 — this wave requires the complete UI from Features 9.1 (shell, C2/C3/C5), 9.2 (C4 tokens, C8 library), 9.3 (palette/shortcuts), and 9.4 (C6 bridge, proactive-in-chat) to exist before making it responsive. Global order: 9.1 → 9.2 → (9.3 ∥ 9.4) → **9.5**.
- **Consumed contracts (unchanged APIs):** C2 panel controller + surface registry; C3 rail item shape; C4 motion/duration tokens; C5 route map (deep links must open the correct responsive rendering); C6 `open_surface` (behavioral consumer only); C8 `Modal`/`Sheet`.
- **Owned contracts:** none.
- **Blocks:** Wave 9.5.2 (the WCAG audit must cover all three breakpoints, so it audits this wave's output).

## Definition of Done

- [ ] All 4 user stories' acceptance criteria met with evidence (test output, screenshots)
- [ ] Viewport matrix + boundary tests passing; per-breakpoint axe-core smoke clean (no new serious/critical)
- [ ] Keyboard open/close focus handoff verified for menu drawer, slide-overs, tablet sheet
- [ ] Desktop (>1100px) visual regression clean vs. baseline
- [ ] Interface diff confirms C2/C3/C8 public APIs unchanged
- [ ] `npm run typecheck` clean; existing test suite (incl. `chat-pane.test.tsx` a11y assertions) green
- [ ] Manual device check on Vercel preview logged
- [ ] PR opened from `development` per workflow (never merged directly)
- [ ] UX Foundations conformance noted: Pass 5 (state design & feedback — every responsive rendering keeps designed loading/empty/error states and <100ms interaction feedback) and Pass 6 (flow integrity — no breakpoint strands the user; chat is always one gesture away)

## Handoff Requirements

**For Wave 9.5.2:**
- Final breakpoint definitions + `useBreakpoint` hook (audit runs per breakpoint)
- Inventory of every overlay introduced here (menu drawer, slide-overs, tablet sheet, bottom sheet) — these are the focus-trap targets for 9.5.2
- Per-breakpoint axe smoke baselines to diff the full audit against

**For other Features/Epics:**
- Responsive shell pattern reusable by the future Tauri tray (blueprint §13 — "fourth breakpoint in spirit")

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| C8 `Sheet` primitive lacks a full-screen or bottom-edge variant | Med | Extend via composition/props **through 9.2.2's owner review** — contract change requires updating epic-9-shared-contracts.md, not forking the primitive |
| Mobile keyboard/viewport quirks (iOS Safari `dvh`, safe areas) | Med | Use `dvh` + safe-area insets; verify on real device via Vercel preview before wave close |
| Breakpoint switch remounts surface content and loses in-progress input | Med | Keep panel slot mounted where possible; state-preservation test in Task 9.5.1.4.1 is the gate |
| Desktop regression from shared shell edits | Med | Baseline screenshots before first commit; QC diff gate in Task 9.5.1.4.2 |

## Notes and Assumptions

- Assumes C8 `Sheet` supports side/bottom/full-screen presentation via props or composition; if not, the extension goes through the contract-change process (update shared-contracts doc, flag 9.2.2).
- `setWidth`/`widthPct` semantics at tablet: stored, not applied — this is a rendering decision, not an API change, per the C2 consumption rule.
- No fabricated velocity: hour estimates reflect scope of shell-level CSS/composition work with an existing component library; flagging that real-device composer/keyboard behavior (Task 9.5.1.1.3) is the highest-variance item.
- WCAG 2.1 AA is the epic's release gate — this wave only smoke-tests a11y; formal certification is 9.5.2.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§4.6 responsive, §5.3 accessibility)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C2, C3, C4, C5, C6, C8)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.5)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 5 — State Design & Feedback; Pass 6 — Flow Integrity)
- Sibling wave: `docs/implementation/iterations/wave-9.5.2-wcag-audit-motion.md`

## Wave Retrospective

{To be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
