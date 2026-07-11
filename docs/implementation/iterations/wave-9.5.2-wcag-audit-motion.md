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
wave: "9.5.2"
agents:
  - frontend-specialist
  - quality-control
tags:
  - accessibility
  - wcag-2.1-aa
  - keyboard
  - focus-management
  - reduced-motion
  - release-gate
relateddocuments:
  - docs/planning/bl-002-ui-ux-overhaul-design.md
  - docs/planning/epic-9-shared-contracts.md
  - docs/implementation/_main/epic-9-experience-redesign.md
  - docs/architecture/_main/05a-UX-Foundations.md
  - docs/implementation/iterations/wave-9.5.1-responsive-breakpoints.md
---

# Wave 9.5.2: WCAG 2.1 AA Audit + Motion Pass

## Wave Overview
- **Wave ID:** Wave-9.5.2
- **Feature:** Feature 9.5 - Responsive & Accessibility
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope**: Clear a formal WCAG 2.1 AA bar across the entire Epic 9 UI at all three breakpoints (design doc §5.3): full keyboard reachability for rail/panel/palette, focus traps in every flyout/sheet, visible focus rings on the token system, end-to-end 4.5:1 contrast verification (as-rendered — 9.2.1 fixed the token pairs; this wave verifies the composed UI), `prefers-reduced-motion` coverage on all panel/sheet transitions, and a motion-timing polish pass on C4 duration tokens. Closed by an axe-core sweep + screen-reader verification + evidence-backed audit sign-off.
- **Wave Goal:** WCAG 2.1 AA verified end-to-end with recorded evidence — the epic's release gate — while carrying forward the codebase's existing a11y habits (aria-live chat region, `motion-safe:`, labeled tool cards) rather than replacing them.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

**Contract posture (critical):** This wave OWNS no cross-cutting contract. It CONSUMES:
- **C2 (panel controller):** keyboard/focus behavior is layered *around* `openPanel`/`closePanel` (focus on open, restore on close) — no controller API change.
- **C3 (rail):** keyboard reachability + `aria-current` verified; item shape untouched.
- **C4 (design tokens):** focus rings, contrast checks, and all motion timing reference C4 tokens (`--duration-fast/base/slow`, standard ease, color tokens). Any *value* fix found by the audit is routed to the token layer, keeping the "no raw palette values in components" rule.
- **C8 (Modal/Sheet):** focus-trap behavior is verified/hardened in the primitive so every consumer (palette, flyouts, 9.5.1 sheets) inherits it — behavior hardening inside the primitive, no API change.
- **C9 shortcut map (9.3.2):** audited for AT/browser conflicts, not redefined.

**Existing habits to preserve and extend (baseline, from code inspection):**
- `apps/web/src/components/chat/chat-pane.tsx`: `aria-live="polite"` + `aria-busy` + `aria-label` on the message region; `role="status"` loaders; `motion-safe:` on pulse/cursor animations; a11y assertions already in `chat-pane.test.tsx`.
- `apps/web/src/components/chat/message.tsx`: labeled tool cards (`aria-label="Tool used: …"`, labeled tool results), `aria-hidden` decorative cursors.
- These patterns are the house style — the audit generalizes them to every surface, and no fix may regress them.

## Wave Goals

1. Full keyboard reachability: every interactive element in rail, panel surfaces, palette, composer, history flyout, and all 9.5.1 sheets is reachable and operable by keyboard alone, at all three breakpoints.
2. Correct focus management: traps in all flyouts/modals/sheets; focus moves in on open, restores to trigger on close; visible token-backed focus rings everywhere.
3. Verified 4.5:1 contrast on every rendered text/background pair (end-to-end verification of the 9.2.1 token pass, catching composed/stateful cases the token pass could not see).
4. Complete `prefers-reduced-motion` coverage and a motion polish pass: every transition uses C4 duration tokens with the standard ease and is guarded by `motion-safe:` (or equivalent media query).
5. Formal audit sign-off with evidence: zero serious/critical axe-core violations across the page × breakpoint matrix, screen-reader spot verification, documented WCAG 2.1 AA checklist — the epic's release gate.

## User Stories

### User Story 1: Keyboard-only operation

**As a** keyboard-only user (or power user)
**I want** every part of Coriven — rail, panel surfaces, palette, composer, flyouts, sheets — reachable and operable without a mouse
**So that** I can run my whole workflow from the keyboard and assistive technology can drive the app

**Acceptance Criteria:**
- [ ] Tab order is logical at all three breakpoints (incl. 9.5.1 menu drawer/slide-overs); no keyboard dead-ends or unreachable controls
- [ ] Rail: arrow/Tab navigation, `Enter`/`Space` activate, `aria-current="page"` on active (C3)
- [ ] Panel surfaces (tasks/goals/email/settings/activity), history flyout, and ⌘K palette fully keyboard-operable; 9.3.2 shortcut map (`⌘K`, `⌘/`, `Esc`, `[`, `g` chords) verified against native `Tab`/`Esc` and screen-reader shortcuts (epic risk register item)
- [ ] Skip-to-composer/skip-to-content link present for keyboard users

**Estimated Hours:** 9
**Priority:** High

---

### User Story 2: Focus traps and visible focus

**As a** screen-reader or keyboard user
**I want** dialogs/sheets/flyouts to trap focus while open, return it when closed, and always show me where focus is
**So that** I never lose my place or tab into content hidden behind an overlay

**Acceptance Criteria:**
- [ ] C8 `Modal`/`Sheet` primitive traps focus (cycle within, `Esc` closes, focus restored to trigger) — verified for every consumer: palette, history flyout, settings sub-nav overlays, 9.5.1 menu drawer / slide-overs / tablet sheet / bottom sheet
- [ ] Overlays carry correct roles/labels (`role="dialog"`, `aria-modal="true"`, accessible name); background content `inert`/`aria-hidden` while open
- [ ] Visible focus ring on every interactive element, built on C4 tokens (assistant/attention-consistent, ≥3:1 against adjacent colors), never `outline: none` without replacement
- [ ] Automated focus-trap tests per overlay in the test suite

**Estimated Hours:** 8
**Priority:** High

---

### User Story 3: Contrast verified end-to-end

**As a** low-vision user
**I want** all text to meet 4.5:1 contrast (3:1 for large text / UI components) as actually rendered
**So that** muted grays, badges, and stateful text are readable, not just the token spec sheet

**Acceptance Criteria:**
- [ ] Automated contrast checks (axe-core color-contrast rule) pass on every route in the C5 map × 3 breakpoints, including hover/active/disabled and empty/loading/error states
- [ ] Residual raw-palette stragglers (e.g., legacy `text-gray-600`, `text-gray-500` in chat components) found by the sweep are migrated to C4 token utilities — fixes go through tokens, never hardcoded hex in components
- [ ] Non-text essentials (focus rings, borders on inputs, status dots) meet 3:1 where WCAG 1.4.11 applies
- [ ] Evidence: contrast report per page×breakpoint attached to the PR

**Estimated Hours:** 6
**Priority:** High

---

### User Story 4: Reduced motion and motion polish

**As a** motion-sensitive user
**I want** panel/sheet transitions and all animation disabled or minimized when I set `prefers-reduced-motion`
**So that** the app never triggers discomfort — while other users get consistent, token-timed motion

**Acceptance Criteria:**
- [ ] Every animation/transition in the app (panel open/close, 9.5.1 sheet/slide-over/drawer, palette, toasts, skeletons, streaming cursor) is behind `motion-safe:` or an equivalent reduced-motion media query — audited exhaustively, not sampled
- [ ] All durations/easings use C4 tokens (`--duration-fast` 120ms / `--duration-base` 200ms / `--duration-slow` 300ms + standard ease); no ad-hoc timing values remain
- [ ] With reduced motion: transitions become instant or opacity-only; nothing breaks functionally (sheets still open/close)
- [ ] Motion polish: overlay enter/exit, panel resize, and focus transitions feel consistent (UX Foundations Pass 5: immediate <100ms feedback for clicks, streaming for chat)

**Estimated Hours:** 6
**Priority:** High

---

### User Story 5: Formal AA audit sign-off (release gate)

**As the** product owner preparing Coriven for productization
**I want** an evidence-backed WCAG 2.1 AA audit verdict covering the whole epic UI
**So that** accessibility is a verified release gate, not a claim

**Acceptance Criteria:**
- [ ] axe-core sweep: zero serious/critical violations across the full page (C5 routes) × breakpoint (3) matrix; moderate/minor triaged with disposition recorded
- [ ] Screen-reader spot verification (NVDA on Windows minimum): chat send/receive announced via existing aria-live region, tool cards announced, overlay open/close announced, rail navigation announced
- [ ] Keyboard-only walkthrough of the six core flows (chat, create task via chat, approve an action, open/close each surface, palette navigate+act, settings) recorded as pass/fail evidence
- [ ] WCAG 2.1 AA checklist (per success criterion, Level A + AA) completed with pass/N-A/fixed status; failures fixed within this wave or explicitly accepted by the owner with rationale
- [ ] Regression guard: axe checks wired into the CI test run so the gate holds after this wave

**Estimated Hours:** 8
**Priority:** High

**Wave total estimated hours: 37**

## Infrastructure Specifications

### Testing (always — this wave *is* testing infrastructure)
- **Accessibility framework:** `axe-core` — `vitest-axe`/`jest-axe` at component level, `@axe-core/playwright` for full-page sweeps; runs across the C5 route map at 375px / 900px / 1440px viewports. Serious/critical = build-fail severity; wired into CI as a permanent regression guard.
- **Keyboard navigation tests:** automated Tab-order and operability tests (Testing Library `userEvent.tab()` / Playwright keyboard API) for rail, palette, composer, each overlay; focus-trap cycle tests per C8 consumer; shortcut-conflict checks for the 9.3.2 map.
- **Reduced motion:** tests run with `prefers-reduced-motion: reduce` emulation asserting no animated transitions fire and functionality is preserved.
- **Contrast:** axe color-contrast rule + targeted checks for stateful variants (hover/disabled/error) that static sweeps miss.
- **Screen reader:** manual NVDA verification (scripted checklist, evidence recorded) — automated tools cannot certify announcement behavior.
- **Existing suite:** `chat-pane.test.tsx` a11y assertions and all prior tests must remain green — fixes may not regress the preserved habits.

### UI (heavy)
- Remediation work is presentation-layer only: aria attributes, focus management, `motion-safe:` guards, token-utility substitutions, skip links, `inert` handling. Fix surface spans `apps/web/src/components/**` and `apps/web/src/app/**`; token-level fixes go to `globals.css` `@theme` **via a flagged coordination with the C4 contract** (value tuning is allowed post-9.2.1 only through the shared-contracts doc process).

### Database (none)
- No schema, migration, RLS, or server-action changes. Purely client/presentation.

### Deployment (light)
- Normal PR flow from `development`; no env or infra changes. The audit runs against a Vercel preview build (production-mode rendering) — not just dev mode.

### Monitoring (light)
- CI axe gate is the ongoing monitor. Optionally note Lighthouse accessibility score on the preview as a tracked-but-not-gating metric.

## Technical Tasks

### Task 9.5.2.1.1: Keyboard reachability sweep + remediation (rail, panel, composer)
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Wave 9.5.1 complete (external)
- **Priority:** High

**Deliverables:**
- Keyboard audit matrix (element × breakpoint) for rail, panel surfaces, composer, history flyout; remediation of every dead-end/unreachable control
- Skip-to-content/composer link; logical Tab order at all breakpoints
- Automated keyboard-operability tests added per area

**Acceptance Criteria:**
- [ ] Every interactive element operable via keyboard at 375/900/1440px
- [ ] C2/C3 APIs untouched — fixes are markup/handler-level

---

### Task 9.5.2.1.2: Shortcut-map conflict audit (palette + chords)
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.5.2.1.1
- **Priority:** High

**Deliverables:**
- Verification that `⌘K`/`⌘/`/`Esc`/`[`/`g`-chords don't shadow browser/AT shortcuts (epic risk register); chords scoped to app focus, suppressed while typing in inputs where appropriate
- Palette (C9 consumer) full keyboard operability test incl. v3 ask fall-through

**Acceptance Criteria:**
- [ ] No conflict with NVDA browse-mode keys or native `Tab`/`Esc`
- [ ] Documented shortcut behavior notes for the audit record

---

### Task 9.5.2.2.1: Focus-trap hardening in C8 primitive + all overlays
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.5.2.1.1
- **Priority:** High

**Deliverables:**
- Focus trap verified/hardened once in the C8 `Modal`/`Sheet` primitive (cycle, `Esc`, restore-to-trigger, `role="dialog"`, `aria-modal`, accessible names, background `inert`) — inherited by palette, flyouts, and all 9.5.1 sheets (behavior fix, no API change)
- Per-consumer automated trap tests (palette, history flyout, menu drawer, mobile slide-over, tablet sheet, bottom sheet)

**Acceptance Criteria:**
- [ ] Focus never escapes an open overlay; always restored on close
- [ ] C8 public API unchanged (interface diff in QC)

---

### Task 9.5.2.2.2: Token-backed visible focus rings
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.5.2.2.1
- **Priority:** High

**Deliverables:**
- Global focus-visible treatment on C4 tokens applied across buttons, inputs, rail items, cards, links; ≥3:1 against adjacent colors; no unreplaced `outline: none`
- Ring style documented as the house pattern (extends the preserved habits list)

**Acceptance Criteria:**
- [ ] Every interactive element shows a visible ring on `:focus-visible` at all breakpoints
- [ ] axe/manual check confirms ring contrast

---

### Task 9.5.2.3.1: End-to-end contrast sweep + token-routed fixes
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** None within wave (parallel with keyboard stream)
- **Priority:** High

**Deliverables:**
- axe color-contrast sweep across C5 routes × 3 breakpoints × key states (hover/disabled/empty/loading/error)
- Migration of residual raw-palette text (e.g., `text-gray-600`/`text-gray-500` remnants in `chat-pane.tsx` et al.) to C4 token utilities; any token-value adjustment flagged per the shared-contracts change process
- Contrast evidence report (page × breakpoint) for the audit record

**Acceptance Criteria:**
- [ ] All rendered text ≥4.5:1 (≥3:1 large text / UI components per 1.4.11)
- [ ] Zero raw palette values reintroduced; fixes reference tokens only

---

### Task 9.5.2.4.1: Reduced-motion coverage + motion timing pass
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 9.5.2.2.1 (overlay transitions final)
- **Priority:** High

**Deliverables:**
- Exhaustive animation inventory (grep + visual pass) with every entry `motion-safe:`-guarded or media-query-guarded; reduced-motion emulation tests proving overlays still function
- All durations/easings normalized to C4 tokens (120/200/300ms + standard ease); ad-hoc values removed
- Motion polish on overlay enter/exit and panel interactions per UX Foundations Pass 5 feedback timing (<100ms click feedback, streaming for chat)

**Acceptance Criteria:**
- [ ] `prefers-reduced-motion: reduce` yields no non-essential animation anywhere
- [ ] No hardcoded duration/easing values remain in components

---

### Task 9.5.2.5.1: Full axe sweep + screen-reader verification + WCAG checklist (audit execution)
- **Agent:** quality-control
- **Estimation:** 6 hours
- **Dependencies:** Tasks 9.5.2.1.2, 9.5.2.2.2, 9.5.2.3.1, 9.5.2.4.1
- **Priority:** High

**Deliverables:**
- Full axe-core matrix run (C5 routes × 3 breakpoints) on a Vercel preview build; violation register with severity + disposition
- NVDA scripted walkthrough: chat streaming announcements (existing aria-live region), tool-card labels, overlay open/close, rail navigation — pass/fail evidence
- Keyboard-only walkthrough of the six core flows, recorded
- Completed WCAG 2.1 AA success-criterion checklist (A + AA) with per-criterion status
- Interface-diff confirmation that C2/C3/C4-names/C8 public APIs are unchanged by this wave

**Acceptance Criteria:**
- [ ] Zero serious/critical axe violations; all A/AA criteria pass, N/A, or owner-accepted with rationale
- [ ] Evidence bundle attached to the PR

---

### Task 9.5.2.5.2: Remediation loop + CI regression gate
- **Agent:** frontend-specialist
- **Estimation:** 2 hours
- **Dependencies:** Task 9.5.2.5.1
- **Priority:** High

**Deliverables:**
- Fixes for any findings from 9.5.2.5.1 (loop with QC until clean); axe checks wired into the CI test script as a permanent serious/critical gate
- "Preserved a11y habits" note updated in the epic doc (aria-live region, motion-safe, labeled tool cards, focus rings, traps) so future waves keep the bar

**Acceptance Criteria:**
- [ ] Re-run of the audit matrix is clean; CI gate active
- [ ] Release-gate verdict recorded: **WCAG 2.1 AA — PASS**

## Task Dependencies

```
Wave 9.5.1 (external — hard prerequisite)
  ↓
Task 9.5.2.1.1 (keyboard sweep)           Task 9.5.2.3.1 (contrast sweep — parallel stream)
  ├─> Task 9.5.2.1.2 (shortcut conflicts)
  └─> Task 9.5.2.2.1 (focus traps)
        ├─> Task 9.5.2.2.2 (focus rings)
        └─> Task 9.5.2.4.1 (reduced motion + timing)
Task 9.5.2.1.2 + 9.5.2.2.2 + 9.5.2.3.1 + 9.5.2.4.1
  ↓
Task 9.5.2.5.1 (QC audit execution)
  ↓
Task 9.5.2.5.2 (remediation loop + CI gate)
```

**Critical path:** 9.5.2.1.1 → 9.5.2.2.1 → 9.5.2.4.1 → 9.5.2.5.1 → 9.5.2.5.2 (~24h).
**Parallel streams:** contrast (9.5.2.3.1) runs independently from the start; shortcut audit (9.5.2.1.2) and focus rings (9.5.2.2.2) run alongside the motion pass.
**Bottleneck:** the QC audit (9.5.2.5.1) gates everything — schedule the remediation loop buffer immediately after it.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope |
|-------|-------|-------|------------|
| frontend-specialist | 9.5.2.1.1, 9.5.2.1.2, 9.5.2.2.1, 9.5.2.2.2, 9.5.2.3.1, 9.5.2.4.1, 9.5.2.5.2 | 31 | `apps/web/src/components/**` (aria/focus/motion/markup fixes incl. `components/ui/` **behavior hardening only, no API change**), `apps/web/src/app/**` (skip links, layout aria), `apps/web/src/app/globals.css` (focus-ring utilities; token-value changes only via C4 change process), test files + e2e a11y specs, CI test script |
| quality-control | 9.5.2.5.1 | 6 | Audit execution against Vercel preview; evidence artifacts; violation register; WCAG checklist; interface-diff review of C2/C3/C8 — read-only on source |

**Out of scope for all agents:** `supabase/migrations/`, `apps/web/src/app/actions/`, `apps/web/src/lib/chat/engine.ts` (C6 union), C2 controller API, C3 item shape, C9 command shape, tool schemas.

## Dependencies

- **Hard (sequencing):** Feature 9.5 is **last** in Epic 9. This wave additionally requires **Wave 9.5.1 complete** — the audit must cover all three breakpoints and every overlay 9.5.1 introduces. Full chain: 9.1 → 9.2 → (9.3 ∥ 9.4) → 9.5.1 → **9.5.2**.
- **Consumed contracts (unchanged APIs):** C2 panel controller; C3 rail; C4 tokens (contrast pairs from 9.2.1 verified end-to-end here; motion timing tokens applied here); C5 route map (defines the audit page matrix); C8 Modal/Sheet (trap hardening inside the primitive); C9/9.3.2 shortcut map (conflict-audited, not redefined).
- **Owned contracts:** none.
- **Enables / blocks:** WCAG 2.1 AA is the **release gate for Epic 9** (epic doc, Compliance section) — Epic 9 does not ship to `main` until Task 9.5.2.5.2's verdict is PASS. Also feeds Epic 8 productization launch-readiness.

## Definition of Done

- [ ] All 5 user stories' acceptance criteria met with recorded evidence
- [ ] Zero serious/critical axe-core violations across C5 routes × 3 breakpoints on a preview build
- [ ] WCAG 2.1 AA checklist complete (A + AA); failures fixed or owner-accepted with rationale
- [ ] NVDA spot verification and keyboard-only core-flow walkthroughs pass
- [ ] `prefers-reduced-motion` coverage exhaustive; all motion on C4 tokens
- [ ] Preserved habits regression-free: `chat-pane.tsx` aria-live/aria-busy, `message.tsx` labeled tool cards, existing `motion-safe:` guards — existing tests green
- [ ] Interface diff confirms no consumed contract API changed (C2/C3/C8; C4 names)
- [ ] axe gate wired into CI; `npm run typecheck` clean
- [ ] PR opened from `development` per workflow (never merged directly); release-gate verdict recorded in the PR
- [ ] UX Foundations conformance noted: Pass 5 (state design & feedback — feedback timing verified, all five states announced to AT) and Pass 6 (flow integrity — keyboard/SR users complete every core flow without dead ends)

## Handoff Requirements

**For Epic 9 close-out / release:**
- WCAG 2.1 AA PASS verdict + evidence bundle (the epic release gate)
- CI axe gate active on `development` so the bar holds post-epic

**For other Features/Epics:**
- Epic 8 (productization): launch-readiness accessibility evidence for the public product
- Future Tauri tray (blueprint §13): the focus/motion/token patterns as the parity baseline
- House a11y pattern list (aria-live, motion-safe, labeled tool cards, focus rings, C8 traps) documented for all future UI work

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Audit uncovers structural issues (e.g., overlay stacking/inert unsupported pattern) too big for this wave | High | Trap hardening lives in the single C8 primitive — one fix propagates; anything beyond that is escalated to the owner with a scoped follow-up rather than silently absorbed |
| Shortcut chords conflict with NVDA/browser keys | Med | Task 9.5.2.1.2 dedicated audit; chords scoped to app focus; fallback: make chords opt-in/remappable (flag to owner before changing 9.3.2's map) |
| Contrast fixes require C4 token-value changes (contract owned by 9.2.1) | Med | Route value changes through the shared-contracts change process (update doc, flag dependent waves); never hardcode component-level colors |
| Remediation loop (9.5.2.5.2) balloons past estimate | Med | Estimates flagged as audit-dependent — findings volume is inherently uncertain; per-breakpoint smoke baselines from 9.5.1 reduce surprise |
| Screen-reader verification is manual and environment-dependent | Low-Med | Scripted NVDA checklist with recorded evidence; Windows environment already available (dev machine) |

## Notes and Assumptions

- Contrast: 9.2.1 (C4) fixed the token *pairs*; this wave verifies the *composed, rendered* UI end-to-end — states, overlays, and any straggler raw-palette classes (several remain in chat components per code inspection, e.g. `text-gray-600`/`text-gray-500` in `chat-pane.tsx`).
- Motion timing uses C4 tokens exclusively; this wave normalizes usage, it does not redefine token values.
- NVDA is the minimum screen-reader bar (Windows dev environment); VoiceOver verification is a stretch goal, not a gate.
- Hour estimates are scope-based; the remediation loop is the flagged-uncertainty item — completion is defined by a clean audit, not by hours.
- WCAG 2.1 AA is the epic's release gate: no Epic 9 → `main` PR until this wave's verdict is PASS.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§5.3 accessibility, §4.6 responsive)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C2, C3, C4, C5, C8, C9)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.5; Compliance — AA as release gate)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 5 — State Design & Feedback; Pass 6 — Flow Integrity)
- Sibling wave: `docs/implementation/iterations/wave-9.5.1-responsive-breakpoints.md`
- Preserved-habit reference code: `apps/web/src/components/chat/chat-pane.tsx`, `apps/web/src/components/chat/message.tsx`

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
