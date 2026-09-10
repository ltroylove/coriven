---
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven"
epic: "9"
feature: "9.2"
wave: "9.2.1"
agents: [frontend-specialist, quality-control]
tags: [coriven, design-system, tokens, tailwind-4, contrast, wcag, motion]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.2.1: Design Tokens + Tailwind Theme

## Wave Overview
- **Wave ID:** Wave-9.2.1
- **Feature:** Feature 9.2 - Design System & Overview Board
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope:** Define the committed design-token system (**contract C4 — this wave OWNS it**) as Tailwind 4 CSS-first `@theme` tokens in `apps/web/src/app/globals.css`: color, space, radius, motion, and type scales in the "mission control at midnight" direction (design doc §5.1–5.2). Run the WCAG contrast audit and fix the failing muted-gray pairings. Codify the `motion-safe:` convention and an advisory no-raw-palette guard. **Additive wave** — no component refactor here (that is Wave 9.2.2).
- **Wave Goal:** The visual language exists as committed, documented tokens that every later UI wave references — with all text/canvas pairings verified ≥ 4.5:1.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. C4 token namespaces exist verbatim in `globals.css` via `@theme` — names exactly as pinned in `epic-9-shared-contracts.md` §C4; values tuned in this wave and recorded back into C4.
2. Every text/canvas color pairing in the app passes WCAG 2.1 AA (≥ 4.5:1); the known `text-gray-600`-on-`gray-950` failures are fixed (design doc §5.3).
3. Motion tokens (120/200/300ms + standard ease) and the `motion-safe:` convention are codified; the mono-for-user-messages signature becomes a deliberate token (`--font-user`), not an accident.
4. An advisory guard exists that flags raw palette utilities (`gray-900`, `emerald-500`, …) in components — advisory in this wave, enforced after Wave 9.2.2 completes the refactor.

## Shared Contracts

- **OWNS C4 (design tokens).** Token *names* below are the contract; other waves consume them unchanged. If a name must change, update `docs/planning/epic-9-shared-contracts.md` and flag all UI waves.
- **Consumes:** none. This wave is additive CSS — it does not depend on C2/C3 behavior, only on the files existing where they do.

## User Stories

### Story 9.2.1.1 — Token foundation in `@theme`

**As a** developer building any Epic 9 surface
**I want** a single committed token set (color, space, radius, motion, type) in `globals.css`
**So that** every component references meaning-bearing tokens instead of ad-hoc Tailwind palette values, and light mode / tray parity become follow-ups instead of rewrites (ADR-017).

**Acceptance Criteria:**
- [ ] All C4 token names exist in an `@theme` block in `apps/web/src/app/globals.css` (Tailwind 4 CSS-first — **no** `tailwind.config.js`; the project has none and must not gain one).
- [ ] **Color tokens (exact names):** `--color-canvas`, `--color-surface`, `--color-raised`, `--color-border`, `--color-assistant` (emerald — the assistant's color), `--color-attention` (amber — "needs your judgment"), `--color-danger`, `--color-text`, `--color-text-secondary`, `--color-text-muted`. Canvas is near-black with a slight warm tint; surface/raised form the 2-step elevation scale; one border tone (design doc §5.1 table).
- [ ] **Space tokens:** `--space-1` (4px) through `--space-16` (64px) on the 4px grid (steps: 1, 2, 3, 4, 6, 8, 12, 16), with Tailwind 4 `--spacing` base set to `0.25rem` so numeric utilities stay grid-aligned.
- [ ] **Radius tokens:** `--radius-interactive` (buttons, inputs, chips) and `--radius-container` (cards, panels, modals) — exactly two radii.
- [ ] **Motion tokens:** `--duration-fast: 120ms`, `--duration-base: 200ms`, `--duration-slow: 300ms`, `--ease-standard` (one standard ease).
- [ ] **Type tokens:** exactly 5 sizes with fixed line-heights (`--text-xs` 12/16, `--text-sm` 14/20, `--text-base` 16/24, `--text-lg` 18/28, `--text-xl` 20/28) plus `--font-sans` (current sans or Geist — decide in-wave) and `--font-user` (mono — the user-message signature, design doc §8.5).
- [ ] Tailwind generates token-backed utilities from `@theme` (e.g. `bg-canvas`, `bg-surface`, `text-text-secondary`, `border-border`, `rounded-interactive`, `duration-base`, `font-user`) and they render correctly in a dev build.
- [ ] The legacy `:root { --background / --foreground }` block and its `prefers-color-scheme` media query in `globals.css` are replaced by the token set (app is dark-only for now; light mode explicitly deferred until after this wave — design doc §8.6).
- [ ] Existing pages render unchanged (tokens are additive; no component files modified by this story except `layout.tsx` if the font decision requires wiring).
- [ ] Final tuned values are recorded in `docs/planning/epic-9-shared-contracts.md` §C4.

**Priority:** Critical
**Estimated hours:** 6h

#### Task 9.2.1.1.1 — Define color + elevation tokens in `@theme`

- **Parent Story:** 9.2.1.1
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** None
- **Deliverables:** Updated `apps/web/src/app/globals.css` — `@theme` block with the 10 C4 color tokens; legacy `--background`/`--foreground` block removed; `body` styled from `--color-canvas`/`--color-text`.
- **Acceptance Criteria:** Token names match C4 verbatim; canvas has a warm near-black tint (not pure `#0a0a0a`); `bg-canvas`, `bg-surface`, `bg-raised`, `border-border`, `text-text`, `text-text-secondary`, `text-text-muted`, `text-assistant`, `text-attention`, `text-danger` utilities all compile and render; no visual regression on `/`, `/tasks`, `/goals`, `/email` at this stage (values chosen to sit close to the current grays).

#### Task 9.2.1.1.2 — Define space, radius, motion, and type tokens

- **Parent Story:** 9.2.1.1
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.2.1.1.1
- **Deliverables:** Same `@theme` block extended with `--space-*`, `--radius-interactive`, `--radius-container`, `--duration-fast/base/slow`, `--ease-standard`, the 5-size type scale with fixed line-heights, `--font-sans`, `--font-user`; `apps/web/src/app/layout.tsx` font wiring if Geist is adopted; existing `@keyframes blink` retained.
- **Acceptance Criteria:** `rounded-interactive`/`rounded-container`, `duration-fast/base/slow`, `ease-standard` (via `--ease-standard`), `font-user`, and the 5 text sizes compile as utilities; line-heights are fixed per size (no proportional drift); `--font-user` resolves to the mono stack currently used for user messages; C4 in `epic-9-shared-contracts.md` updated with the final values table.

---

### Story 9.2.1.2 — Contrast audit and AA fixes

**As a** user reading muted metadata (timestamps, counts, helper text)
**I want** every text color to meet 4.5:1 against its background
**So that** the quiet "mission control" aesthetic never trades away legibility (WCAG 2.1 AA; design doc §5.3).

**Acceptance Criteria:**
- [ ] A documented audit covers every text/background pairing currently in `apps/web/src/components/**` and `apps/web/src/app/**` (known failure classes: `text-gray-600` and `text-gray-700` on `gray-950`/`gray-900` — e.g. `today/page.tsx` section labels, `task-card.tsx` delete affordance, `message.tsx` timestamps).
- [ ] `--color-text-muted` is tuned so that muted-on-canvas AND muted-on-surface both pass ≥ 4.5:1.
- [ ] Failing raw-palette usages are fixed with minimal, mechanical class swaps to the nearest passing value (raw → token migration itself is Wave 9.2.2's job; this story only fixes *contrast failures*, swapping directly to token utilities where the swap is trivial).
- [ ] Non-text decorative uses (borders, hover ghosts, disabled states) are documented as exempt with rationale (WCAG 1.4.3 applies to text/images of text).
- [ ] Semantic-on-dark pairings pass: `--color-attention` amber text on canvas/surface, `--color-assistant` emerald text on canvas/surface, `--color-danger` on canvas/surface — all ≥ 4.5:1 at the sizes used.

**Priority:** High
**Estimated hours:** 6h

#### Task 9.2.1.2.1 — Contrast audit of all current pairings

- **Parent Story:** 9.2.1.2
- **Agent:** quality-control
- **Estimation:** 3h
- **Dependencies:** Task 9.2.1.1.1 (token values exist to audit against)
- **Deliverables:** Audit table (pairing → computed ratio → pass/fail → fix) committed as a section in this wave plan or as `docs/planning/epic-9-contrast-audit.md`; automated check script `apps/web/scripts/check-contrast.mjs` computing ratios for the token pairs.
- **Acceptance Criteria:** Every distinct text-color × background-color combination found by grep across `apps/web/src` appears in the table; the script exits non-zero if any C4 text token fails 4.5:1 against `--color-canvas` or `--color-surface`.

#### Task 9.2.1.2.2 — Apply contrast fixes

- **Parent Story:** 9.2.1.2
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.2.1.2.1
- **Deliverables:** Class-swap commits across the failing files (expected: `today/page.tsx`, `tasks/task-card.tsx`, `chat/message.tsx`, `briefing/*`, plus whatever the audit finds); updated audit table showing all-pass.
- **Acceptance Criteria:** Zero failing text pairings remain; swaps are visually conservative (a shade brighter, not a different hue); `npm run typecheck` and `npm run test` pass; no layout changes.

---

### Story 9.2.1.3 — Motion conventions + raw-palette guard

**As a** maintainer of the design system
**I want** motion rules codified and an automated nag against raw palette values
**So that** the token system stays authoritative instead of eroding one `text-gray-500` at a time (C4: "no raw palette values in components after 9.2.2").

**Acceptance Criteria:**
- [ ] All animation/transition usage conventions are codified in a short "Using the tokens" comment header inside `globals.css` (durations from tokens, standard ease, everything animated wrapped in `motion-safe:` — the codebase's existing habit, now a rule).
- [ ] A guard script (`apps/web/scripts/check-raw-palette.mjs`) greps `apps/web/src/components` and `apps/web/src/app` for raw palette utilities (`(text|bg|border|ring)-(gray|zinc|neutral|stone|emerald|amber|red|blue|orange|purple|green)-\d+`) and reports file/line counts.
- [ ] In this wave the guard runs in **advisory** mode (reports, exit 0) — it becomes CI-enforced (exit 1) as part of Wave 9.2.2's Definition of Done.
- [ ] The guard's baseline count is recorded so 9.2.2 can drive it to zero measurably.

**Priority:** Medium
**Estimated hours:** 4h

#### Task 9.2.1.3.1 — Codify motion conventions in globals.css

- **Parent Story:** 9.2.1.3
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.2.1.1.2
- **Deliverables:** Convention header comment in `globals.css` (token usage, motion-safe rule, the two-radius rule, the "color signals meaning, never decoration" rule from §5.1).
- **Acceptance Criteria:** Conventions match design doc §5.2 exactly; existing `motion-safe:` usages conform without change.

#### Task 9.2.1.3.2 — Raw-palette advisory guard

- **Parent Story:** 9.2.1.3
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.2.1.1.1
- **Deliverables:** `apps/web/scripts/check-raw-palette.mjs`; npm script `check:palette` in `apps/web/package.json`; baseline count recorded in the script output committed to this wave plan's retrospective notes.
- **Acceptance Criteria:** Script runs cross-platform via Node (no shell greps); reports per-file counts; exits 0 in advisory mode with a clearly labeled TODO for 9.2.2 enforcement.

## Infrastructure Specifications

### Database

None. This wave touches no tables, migrations, or queries.

### API

None. No routes, no Server Actions.

### UI

**Token table (values indicative — final values fixed by the contrast audit and recorded in C4):**

| Token | Value (proposed) | Meaning |
|---|---|---|
| `--color-canvas` | `#0d0c0a` | App background — near-black, slight warm tint, one shade everywhere |
| `--color-surface` | `#161511` | Elevation step 1 (cards, panels) |
| `--color-raised` | `#201e19` | Elevation step 2 (popovers, hover, modals) |
| `--color-border` | `#2c2a24` | The single border tone |
| `--color-assistant` | `#10b981` | Emerald — assistant presence dot, cursor, confirmations |
| `--color-attention` | `#f59e0b` | Amber — approvals, fallbacks, "needs your judgment" |
| `--color-danger` | `#ef4444` | Destructive + errors only |
| `--color-text` | `#e7e5e4` | Primary text |
| `--color-text-secondary` | `#a8a29e` | Secondary text |
| `--color-text-muted` | `#8a857e` | Muted — tuned to pass 4.5:1 on canvas AND surface |
| `--space-1…16` | 4/8/12/16/24/32/48/64px | 4px grid |
| `--radius-interactive` | `0.5rem` | Buttons, inputs, chips |
| `--radius-container` | `0.75rem` | Cards, panels, modals |
| `--duration-fast/base/slow` | 120/200/300ms | Motion scale |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | The one ease |
| `--text-xs…xl` | 12/14/16/18/20px, fixed line-heights | 5-size type scale |
| `--font-sans` | current sans or Geist | Assistant prose + UI |
| `--font-user` | mono stack | User messages — kept signature (§8.5) |

**Tailwind 4 note:** `@theme` in `globals.css` is the only theme mechanism — this project has no `tailwind.config.js` and this wave must not introduce one. `--color-*` tokens auto-generate `bg-*`/`text-*`/`border-*` utilities; `--color-text` yields `text-text` (accepted trade-off, name is contract-pinned).

**States (UX Foundations Pass 5):** not applicable — no screens change state behavior in this wave; the wave is the substrate Pass 5 states will be built on in 9.2.2.

### Testing

- **Unit:** `check-contrast.mjs` ratio math tested against known WCAG reference pairs (e.g. `#767676` on `#ffffff` = 4.54:1).
- **Static:** `check-raw-palette.mjs` produces a stable baseline count; snapshot of the count committed.
- **Build:** `npm run typecheck` and `next build` succeed; grep confirms all C4 token names present in the built CSS.
- **Visual smoke:** manual pass on `/`, `/tasks`, `/goals`, `/email`, `/settings`, chat — no layout shifts, contrast fixes visible only as slightly brighter muted text.
- **Accessibility:** contrast script all-pass is a merge gate for this wave.

### Deployment

Standard Vercel auto-deploy via PR into `development`. No env vars, no migrations, no ordering constraints beyond normal PR flow.

### Monitoring

Not applicable — pure CSS/static changes. (Optional: note bundle-size delta of `globals.css` in the PR description; expected negligible.)

## Task Dependencies

```
Task 9.2.1.1.1 (color tokens)
  ├─> Task 9.2.1.1.2 (space/radius/motion/type)
  │     └─> Task 9.2.1.3.1 (motion conventions)
  ├─> Task 9.2.1.2.1 (contrast audit)
  │     └─> Task 9.2.1.2.2 (contrast fixes)
  └─> Task 9.2.1.3.2 (raw-palette guard — parallel)
```

Critical path: 9.2.1.1.1 → 9.2.1.2.1 → 9.2.1.2.2. Parallel streams: 9.2.1.1.2/9.2.1.3.1 and 9.2.1.3.2.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| frontend-specialist | 9.2.1.1.1, 9.2.1.1.2, 9.2.1.2.2, 9.2.1.3.1, 9.2.1.3.2 | 13h |
| quality-control | 9.2.1.2.1 | 3h |
| **Total** | | **16h** |

**File scope (exhaustive — anything outside this list is out of scope for this wave):**
- `apps/web/src/app/globals.css` — primary deliverable (`@theme` block, conventions header)
- `apps/web/src/app/layout.tsx` — only if the font decision requires wiring
- `apps/web/scripts/check-contrast.mjs`, `apps/web/scripts/check-raw-palette.mjs` — new
- `apps/web/package.json` — `check:palette` / `check:contrast` npm scripts
- `docs/planning/epic-9-shared-contracts.md` — record final C4 values (owner's obligation)
- Contrast-fix class swaps only (no refactors) in: `apps/web/src/app/(app)/today/page.tsx`, `apps/web/src/components/tasks/task-card.tsx`, `apps/web/src/components/chat/message.tsx`, `apps/web/src/components/briefing/*.tsx`, plus files the audit flags

## Dependencies

- **Depends on:** None (hard) — the wave is additive CSS. Sequenced after Wave 9.1.3 per the epic build order (9.1.1 → 9.1.2 → 9.1.3 → **9.2.1**) so token utilities land in the final shell, but nothing here technically requires the shell.
- **Blocks:** Wave 9.2.2 (C8 primitives are token-backed), Wave 9.2.3, and all later UI waves (9.3.x, 9.4.x, 9.5.x) — every one consumes C4.

## Definition of Done

- [ ] All 3 stories' acceptance criteria met
- [ ] All C4 token names present verbatim; final values recorded in `epic-9-shared-contracts.md` §C4
- [ ] Contrast script all-pass (≥ 4.5:1 for every text token on canvas and surface); known `text-gray-600` failures fixed
- [ ] Raw-palette guard committed with baseline recorded (advisory mode)
- [ ] No visual regressions on existing surfaces (manual smoke pass)
- [ ] `npm run typecheck`, `npm run test`, `next build` pass; no linter errors
- [ ] PR reviewed and merged to `development` (never direct to `main`)

## Handoff Requirements

**For Wave 9.2.2:**
- The full token utility vocabulary (`bg-surface`, `text-text-muted`, `rounded-interactive`, `duration-base`, `font-user`, …) — 9.2.2 builds `components/ui/` exclusively on these.
- The raw-palette baseline count — 9.2.2 drives it to zero and flips the guard to enforcing.

**For other Features:**
- 9.3.x / 9.4.x / 9.5.x: consume tokens only; never reintroduce raw palette values.
- Light-mode decision (design doc §8.6) is now unblocked — re-decide after Feature 9.2.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|---|---|---|
| Token values shift the look enough to feel like a regression | Med | Choose values within a shade of current grays; the warm tint is subtle; visual smoke pass is a merge gate |
| `--color-text` → `text-text` utility reads awkwardly and invites workarounds | Low | Name is contract-pinned in C4; document it in the conventions header; guard catches workarounds |
| Contrast fixes touch files 9.2.2 will refactor anyway (churn) | Low | Fixes are mechanical class swaps; 9.2.2's refactor subsumes them cleanly |
| Someone adds a `tailwind.config.js` out of habit | Med | Explicitly prohibited in this plan and the conventions header; PR review checks |

## Notes and Assumptions

- Dark-only for this epic; the token pass makes light mode a follow-up (design doc §8.6, epic doc "Light mode — deferred").
- Mono-for-user-messages is kept as a deliberate signature per design guardrail §8.5 — `--font-user` encodes it.
- The existing `@keyframes blink` (assistant cursor) stays; its color moves to `--color-assistant` during 9.2.2's chat refactor, not here.
- No new backend, no schema, no routes in this wave.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` §5 (visual identity), §5.3 (accessibility), §8.5–8.6 (guardrails)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` — **C4 (owned here)**
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.2, ADR-017)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — Pass 5 (state design substrate), Pass 4 (calm density)

## Wave Retrospective

{Filled in after wave completion}

---

**Template Version:** 2.0 (Scope-based Wave)
