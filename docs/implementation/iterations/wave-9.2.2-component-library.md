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
wave: "9.2.2"
agents: [frontend-specialist, quality-control]
tags: [coriven, design-system, component-library, ui-primitives, states, refactor]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.2.2: Component Library Extraction

## Wave Overview
- **Wave ID:** Wave-9.2.2
- **Feature:** Feature 9.2 - Design System & Overview Board
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope:** Build `apps/web/src/components/ui/` — the token-backed primitive library (**contract C8 — this wave OWNS it**): Button, Input/Select/Textarea, Card, Badge/Chip, Toast, Modal/Sheet, EmptyState, Skeleton, PanelHeader. Then refactor existing surfaces onto the primitives **incrementally, surface by surface — no big-bang rewrite** (epic risk register), driving the raw-palette count from the 9.2.1 baseline to zero. Every surface gets designed empty/loading/error states, with empty states teaching the chat-first model.
- **Wave Goal:** One reusable, accessible primitive set that every later wave (board, palette, sheets) builds on — and no raw palette values left in components.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. All C8 primitives exist in `components/ui/`, token-backed (C4 only — zero raw palette values inside `ui/`), keyboard-accessible, with visible focus rings.
2. Existing surfaces (Tasks, Goals, Email, Settings/Memory/Constraints, chat informal components, briefing components) are refactored onto the primitives incrementally; the raw-palette guard goes from advisory to **enforced (exit 1)** at zero.
3. Every working surface has designed empty, loading, and error states (UX Foundations Pass 5); empty states nudge toward chat ("Ask Coriven to create your first task") — that's the onboarding (design doc §5.2).
4. Affordance rules codified in the primitives (UX Foundations Pass 3): clickable looks clickable; destructive styling + confirm for deletes/external sends; primary action visually dominant, one per screen.

## Shared Contracts

- **OWNS C8 (component library).** The primitive list is the contract; consumers (9.2.3 board cards, 9.3.1 palette, 9.4.x, 9.5.1 responsive sheets) build on `Modal`/`Sheet` and `Card` and **must not hand-roll parallel primitives**. Prop shapes finalized here become part of C8 — record them in `epic-9-shared-contracts.md` §C8 on completion.
- **Consumes C4 (design tokens, Wave 9.2.1)** — unchanged. Primitives reference token utilities exclusively.
- **Consumes C2 (panel controller/surface registry, Wave 9.1.1)** — `PanelHeader` renders within the panel slot and wires its close affordance to `usePanel().closePanel()`. Do not redefine C2.

## User Stories

### Story 9.2.2.1 — Core interactive primitives

**As a** developer building any surface
**I want** Button, Input, Select, Textarea, Card, and Badge/Chip primitives
**So that** every form and list in the app shares one accessible, token-backed implementation instead of today's per-file class soup (e.g. the ad-hoc buttons in `task-card.tsx`).

**Acceptance Criteria:**
- [ ] `Button` has exactly 3 variants — `primary` (visually dominant, one per screen), `secondary` (quiet), `destructive` (separated + used with confirmation flows) — plus disabled and pending states (pending replaces today's scattered `opacity-50` + `useTransition` styling).
- [ ] `Input`, `Select`, `Textarea` share focus-ring, error, and disabled treatments; labels/`aria-describedby` wiring built in.
- [ ] `Card` implements the 2-step elevation model (`surface` default, `raised` variant), `--radius-container`, single border tone.
- [ ] `Badge`/`Chip` cover the existing semantic uses (priority, status, recurrence, provider) via a `tone` prop mapped to C4 semantic tokens — amber = attention, emerald = assistant/success, red = danger, neutral otherwise; text accompanies color (never color-alone, WCAG 1.4.1).
- [ ] Zero raw palette utilities inside `components/ui/`; all interactive elements keyboard-reachable with visible focus rings (design doc §5.3).
- [ ] Unit tests per primitive (render, variants, keyboard interaction, aria attributes).

**Priority:** Critical
**Estimated hours:** 10h

#### Task 9.2.2.1.1 — Button, Card, Badge/Chip

- **Parent Story:** 9.2.2.1
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Wave 9.2.1 complete (C4 tokens)
- **Deliverables:** `apps/web/src/components/ui/button.tsx`, `card.tsx`, `badge.tsx`; `apps/web/src/components/ui/index.ts` barrel; tests in `apps/web/src/components/ui/__tests__/`.
- **Acceptance Criteria:** 3 Button variants + pending/disabled; Card surface/raised; Badge tone map covers priority/status/recurrence semantics currently in `task-card.tsx`; all token-backed; tests pass under existing vitest config.

#### Task 9.2.2.1.2 — Input, Select, Textarea

- **Parent Story:** 9.2.2.1
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.2.2.1.1 (shared focus/error treatment established)
- **Deliverables:** `apps/web/src/components/ui/input.tsx`, `select.tsx`, `textarea.tsx` + tests.
- **Acceptance Criteria:** Shared focus ring/error/disabled treatment; label + `aria-describedby` (error text) wiring; controlled and uncontrolled usage both supported (Server Action `FormData` forms in goals/settings still work).

---

### Story 9.2.2.2 — Overlay, feedback, and structure primitives

**As a** developer building the board, palette, and responsive sheets
**I want** Toast, Modal/Sheet, EmptyState, Skeleton, and PanelHeader primitives
**So that** feedback and layout chrome are consistent — and 9.2.3/9.3.1/9.5.1 have the exact building blocks C8 promises them.

**Acceptance Criteria:**
- [ ] `Modal`/`Sheet` share one implementation (a `Sheet` is the side/bottom presentation of the same primitive): focus trap, `Esc` to close, scroll lock, `aria-modal`, motion via `--duration-base` behind `motion-safe:`, `prefers-reduced-motion` honored. **`Esc` handling must not clash with C2's "Esc closes panel"** — overlay `Esc` stops propagation (innermost layer wins).
- [ ] `Toast` renders in an `aria-live="polite"` region; auto-dismiss with pause-on-hover; used for background completions (UX Foundations Pass 5 feedback timing).
- [ ] `EmptyState` takes icon, message, and an optional **chat nudge action** (e.g. "Ask Coriven to create your first task") — the chat-first onboarding pattern, standard across all surfaces.
- [ ] `Skeleton` covers text-line, card, and list-row shapes; loading states use skeletons, not spinners (design doc §5.2).
- [ ] `PanelHeader` renders surface title, optional breadcrumb-back (goal detail per design doc §6), and the ✕ close wired to `usePanel().closePanel()` (C2 — consumed, not redefined).
- [ ] Unit tests per primitive including focus-trap and `Esc`-layering behavior.

**Priority:** Critical
**Estimated hours:** 10h

#### Task 9.2.2.2.1 — Modal/Sheet with focus management

- **Parent Story:** 9.2.2.2
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.2.2.1.1
- **Deliverables:** `apps/web/src/components/ui/modal.tsx` (exports `Modal` and `Sheet` presentations) + tests.
- **Acceptance Criteria:** Focus trapped while open, returned to trigger on close; `Esc` closes innermost overlay only (propagation stopped — verified by test); scroll lock; `motion-safe:` transitions at `--duration-base`; no portal z-index conflicts with the panel.

#### Task 9.2.2.2.2 — Toast, EmptyState, Skeleton, PanelHeader

- **Parent Story:** 9.2.2.2
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.2.2.1.1; Wave 9.1.1 (`usePanel` exists) for PanelHeader wiring
- **Deliverables:** `apps/web/src/components/ui/toast.tsx` (+ provider), `empty-state.tsx`, `skeleton.tsx`, `panel-header.tsx` + tests.
- **Acceptance Criteria:** Toast `aria-live` region singleton; EmptyState chat-nudge slot renders a secondary Button; Skeleton shapes match list/card/text uses; PanelHeader close calls `closePanel()` and carries `aria-label="Close panel"`.

---

### Story 9.2.2.3 — Incremental surface refactor onto primitives

**As a** maintainer
**I want** existing surfaces migrated to `components/ui/` one surface per PR
**So that** the app converges on the design system without a big-bang rewrite that churns every component at once (epic risk register mitigation).

**Acceptance Criteria:**
- [ ] Migration order (one PR each, independently shippable): (1) Tasks (`components/tasks/`), (2) Goals (`components/goals/`), (3) Email (`components/email/`), (4) Settings + Memory + Constraints (`components/settings/`, `memory/`, `constraints/`, `integrations/`), (5) Chat informal components (`components/chat/` — ToolCallCard keeps its amber identity via tokens; user messages move to `font-user`; assistant cursor to `--color-assistant`), (6) Briefing components (`components/briefing/` — refactor only; the board *replaces* their Today usage in 9.2.3).
- [ ] Behavior-preserving: no functional changes, no Server Action signature changes, no route changes — class/markup migration only (plus swapping ad-hoc buttons/inputs/cards for primitives).
- [ ] After the final PR, `check-raw-palette.mjs` reports **zero** and flips to enforcing (exit 1) in the `test` script — this is the C4 "no raw palette values after 9.2.2" clause landing.
- [ ] Existing tests still pass after each migration PR; snapshot updates reviewed intentionally.

**Priority:** High
**Estimated hours:** 12h

#### Task 9.2.2.3.1 — Migrate Tasks + Goals surfaces

- **Parent Story:** 9.2.2.3
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Stories 9.2.2.1, 9.2.2.2 complete
- **Deliverables:** Refactored `components/tasks/*` (TaskCard onto Card/Button/Badge; snooze chips onto Chip), `components/goals/*`; palette-guard count drops accordingly.
- **Acceptance Criteria:** Pixel-close to current rendering (tokens may shift shades slightly); optimistic `useTransition` pending states now use Button's pending treatment; all task/goal tests pass.

#### Task 9.2.2.3.2 — Migrate Email + Settings/Memory/Constraints/Integrations

- **Parent Story:** 9.2.2.3
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Task 9.2.2.3.1 (patterns established)
- **Deliverables:** Refactored `components/email/*`, `components/settings/*`, `components/memory/*`, `components/constraints/*`, `components/integrations/*`.
- **Acceptance Criteria:** Urgency indicators map to Badge tones with text labels; destructive actions (delete memory, disconnect provider) use `Button variant="destructive"` + confirm; guard count continues dropping.

#### Task 9.2.2.3.3 — Migrate Chat + Briefing; flip guard to enforcing

- **Parent Story:** 9.2.2.3
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.2.2.3.2
- **Deliverables:** Refactored `components/chat/*` (ToolCallCard on Card + attention tokens; `font-user` on user messages; assistant cursor/dot on `--color-assistant`), `components/briefing/*`; `check-raw-palette.mjs` switched to exit-1 and added to the CI `test` path.
- **Acceptance Criteria:** Mono-user / prose-assistant signature preserved via tokens; amber tool-card identity preserved via `--color-attention`; guard reports zero and enforces; chat streaming behavior unchanged.

---

### Story 9.2.2.4 — Designed empty/loading/error states on all surfaces

**As a** new or returning user
**I want** every surface to look intentional when it's empty, loading, or broken
**So that** first-run teaches me the chat-first model and failures always offer a way forward (UX Foundations Pass 5).

**Acceptance Criteria:**
- [ ] Every working surface (Tasks, Goals, Email, Settings sections, chat history flyout if present) renders: **empty** = `EmptyState` with a chat nudge per the Pass 5 table ("No tasks yet — add one or ask in chat", "Set your first goal — what matters?", "I haven't learned anything yet", …); **loading** = `Skeleton` shapes matching final layout (no spinners, no layout shift); **error** = inline message + retry affordance, never a full-page crash.
- [ ] Feedback timing per Pass 5: optimistic (<100ms) for internal actions; toast confirmations for background completions.
- [ ] State copy reviewed against the Pass 5 table in `05a-UX-Foundations.md`; deviations documented.
- [ ] Each state is reachable and verified (tests or storybook-style fixtures — see Testing).

**Priority:** High
**Estimated hours:** 8h

#### Task 9.2.2.4.1 — Empty/loading/error states: Tasks, Goals, Email

- **Parent Story:** 9.2.2.4
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.2.2.3.2
- **Deliverables:** EmptyState/Skeleton/error integration in the three primary surfaces; `loading.tsx` files where App Router streaming applies.
- **Acceptance Criteria:** Pass 5 copy used; error states include retry; skeletons match final layout dimensions.

#### Task 9.2.2.4.2 — States on remaining surfaces + state verification pass

- **Parent Story:** 9.2.2.4
- **Agent:** quality-control
- **Estimation:** 3h
- **Dependencies:** Task 9.2.2.4.1
- **Deliverables:** States on Settings/Memory/Constraints sections; a state-coverage checklist (surface × state matrix) appended to this wave plan; axe audit results.
- **Acceptance Criteria:** Matrix fully green; axe: zero critical violations on all refactored surfaces.

## Infrastructure Specifications

### Database

None. No schema changes; refactored surfaces keep their existing queries and Server Actions untouched. (RLS-scoped reads continue via the existing Supabase client variants.)

### API

None. No new routes or Server Actions; existing action signatures (`updateTask`, `snoozeReminder`, `approveAction`, `markEmailRead`, …) are consumed unchanged.

### UI

**C8 primitive prop contracts (canonical — record in shared contracts §C8 on completion):**

```typescript
// Button
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'secondary' | 'destructive'
  pending?: boolean        // replaces ad-hoc opacity-50 + disabled
  size?: 'sm' | 'md'
}

// Card
interface CardProps { elevation?: 'surface' | 'raised'; interactive?: boolean; children: React.ReactNode }

// Badge / Chip
interface BadgeProps { tone: 'neutral' | 'assistant' | 'attention' | 'danger'; children: React.ReactNode }

// Modal / Sheet
interface ModalProps { open: boolean; onClose(): void; title: string; presentation?: 'center' | 'side' | 'bottom' }

// EmptyState
interface EmptyStateProps { icon?: React.ReactNode; message: string; chatNudge?: { label: string; onSelect(): void } }

// PanelHeader (consumes C2 usePanel)
interface PanelHeaderProps { title: string; onBack?: () => void /* breadcrumb-back, e.g. goal detail */ }
```

**Affordance rules baked in (UX Foundations Pass 3):** clickable looks clickable; destructive = distinct styling + confirmation; primary visually dominant, one per screen; AI-touched content labeled (Badge `tone="attention"` + text).

**Accessibility:** visible focus rings from the token system on every interactive primitive; focus traps in Modal/Sheet; text accompanies every color signal; `motion-safe:` on all transitions.

### Testing

- **Unit (vitest + @testing-library/react, existing config):** every primitive — variants, keyboard interaction (Enter/Space/Esc/Tab order), aria attributes, focus trap and return-focus behavior, Toast aria-live.
- **Regression:** existing surface tests pass after each migration PR; snapshots updated deliberately, not blindly.
- **Static:** `check-raw-palette.mjs` count decreases monotonically per PR; zero + enforcing at wave end (merge gate).
- **Accessibility:** axe audit on all refactored surfaces — zero critical violations (merge gate).
- **Coverage:** `components/ui/` ≥ 90% line coverage (primitives are the foundation; hold them to the top bar).

### Deployment

Standard Vercel auto-deploy via PRs into `development`. Six migration PRs ship independently (Story 9.2.2.3 order); each is revertible in isolation. No env vars, no migrations.

### Monitoring

- No new runtime monitoring. Watch Vercel build output for CSS bundle-size drift across the migration PRs (expected: net reduction as duplicate class strings collapse into primitives).
- The enforced palette guard in CI is the permanent regression monitor for C4/C8 integrity.

## Task Dependencies

```
Wave 9.2.1 (C4 tokens) ──> Task 9.2.2.1.1 (Button/Card/Badge)
                              ├─> Task 9.2.2.1.2 (Input/Select/Textarea)   [parallel]
                              ├─> Task 9.2.2.2.1 (Modal/Sheet)             [parallel]
                              └─> Task 9.2.2.2.2 (Toast/EmptyState/Skeleton/PanelHeader) [parallel; PanelHeader also needs Wave 9.1.1]
                                    ↓  (all primitives done)
                              Task 9.2.2.3.1 (Tasks+Goals migration)
                                    ↓
                              Task 9.2.2.3.2 (Email+Settings migration) ──> Task 9.2.2.4.1 (states: primary surfaces)
                                    ↓                                              ↓
                              Task 9.2.2.3.3 (Chat+Briefing; guard enforced)  Task 9.2.2.4.2 (states: rest + QC verification)
```

Critical path: 9.2.2.1.1 → 9.2.2.3.1 → 9.2.2.3.2 → 9.2.2.3.3. Parallel streams: the three primitive tasks after 9.2.2.1.1; the states stream (9.2.2.4.x) overlaps the tail of the migration stream.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| frontend-specialist | 9.2.2.1.1, 9.2.2.1.2, 9.2.2.2.1, 9.2.2.2.2, 9.2.2.3.1, 9.2.2.3.2, 9.2.2.3.3, 9.2.2.4.1 | 32h |
| quality-control | 9.2.2.4.2 | 3h |
| **Total** | | **40h** *(includes 5h QC/state-verification overlap)* |

**File scope:**
- **New:** `apps/web/src/components/ui/` — `button.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `card.tsx`, `badge.tsx`, `toast.tsx`, `modal.tsx`, `empty-state.tsx`, `skeleton.tsx`, `panel-header.tsx`, `index.ts`, `__tests__/*`
- **Refactor (behavior-preserving):** `apps/web/src/components/tasks/`, `goals/`, `email/`, `settings/`, `memory/`, `constraints/`, `integrations/`, `chat/`, `briefing/`; `loading.tsx` additions under `apps/web/src/app/(app)/*`
- **Modified:** `apps/web/scripts/check-raw-palette.mjs` (flip to enforcing), `apps/web/package.json` (wire guard into `test`)
- **Docs:** `docs/planning/epic-9-shared-contracts.md` §C8 — record final prop contracts (owner's obligation)
- **Out of scope:** `apps/web/src/app/actions/*` (no signature changes), any new backend, the Today page/board (Wave 9.2.3), rail/panel internals (owned by 9.1.1)

## Dependencies

- **Depends on:** Wave 9.2.1 (C4 tokens — hard dependency); Wave 9.1.1 (C2 `usePanel` for PanelHeader wiring — only Task 9.2.2.2.2's PanelHeader portion).
- **Blocks:** Wave 9.2.3 (board cards build on Card/Button/Badge/Skeleton/EmptyState), Wave 9.3.1 (palette builds on Modal), Waves 9.4.x (tool-card/chip polish), Wave 9.5.1 (responsive sheets build on Sheet).

## Definition of Done

- [ ] All 4 stories' acceptance criteria met; all C8 primitives shipped with tests
- [ ] All listed surfaces migrated; raw-palette guard at **zero and enforcing** in CI
- [ ] Empty/loading/error state matrix green for every surface; empty states carry the chat nudge
- [ ] axe: zero critical violations on refactored surfaces; keyboard reachability verified
- [ ] `components/ui/` coverage ≥ 90%; `npm run typecheck` and `npm run test` pass
- [ ] C8 prop contracts recorded in `epic-9-shared-contracts.md`
- [ ] All PRs reviewed and merged to `development`

## Handoff Requirements

**For Wave 9.2.3:**
- `Card`, `Button`, `Badge`, `Skeleton`, `EmptyState`, `Toast`, `PanelHeader` — the board card component composes these; it must not hand-roll parallels (C8 clause).
- The state-design pattern (skeleton shapes, error+retry, chat-nudge empty states) — board cards follow it per-card.

**For other Features:**
- 9.3.1: `Modal` is the palette's container primitive.
- 9.5.1: `Sheet` presentation is the responsive panel-as-overlay building block; 9.5.1 may extend presentation behavior but not fork the primitive.
- 9.4.x: Badge/Chip tones for tool cards and context chips.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Refactor churns every component at once | Med | Epic-mandated mitigation: incremental surface-by-surface PRs; tokens already landed additively in 9.2.1 |
| Modal `Esc` conflicts with C2 panel `Esc` | Med | Innermost-layer-wins with stopped propagation; explicit test; documented for 9.3.2's shortcut registry |
| Behavior drift during migration (optimistic states, confirms) | Med | Behavior-preserving rule + existing tests as regression net; QC state-verification pass |
| Primitive API churn after 9.2.3/9.3.1 start consuming | Med | Prop contracts recorded in C8 at wave end; changes after that require a contracts-doc update + dependent-wave flag |
| PanelHeader blocked if Wave 9.1.1 slips | Low | Only one sub-deliverable depends on `usePanel`; ship PanelHeader last or stub the close handler behind the C2 interface |

## Notes and Assumptions

- No new backend capabilities; no Server Action or route changes anywhere in this wave.
- `ToolCallCard` remains in `components/chat/` (domain component) but is rebuilt *on* the primitives; it is listed in the design doc's component inventory but is not a `ui/` primitive itself.
- Briefing components are refactored for token/primitive compliance only — Wave 9.2.3 replaces their Today-page usage with the board; they remain available for any residual weekly-review rendering until 9.4.2 delivers in-chat.
- Storybook is **not** introduced; vitest + fixtures cover state verification (keep tooling footprint flat).

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` §5.2 (component inventory, states), §5.3 (accessibility)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` — **C8 (owned here)**, C4 (consumed), C2 (consumed)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.2, risk register)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — **Pass 3 (affordances — action→signal mapping, destructive rules), Pass 5 (state design — the five-states table and feedback timing)**, Pass 4 (≤3 primary decisions per screen)

## Wave Retrospective

{Filled in after wave completion}

---

**Template Version:** 2.0 (Scope-based Wave)
