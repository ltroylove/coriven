---
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "apps/web"
epic: "9"
feature: "9.3"
wave: "9.3.1"
agents:
  - frontend-specialist
  - quality-control
tags:
  - command-palette
  - keyboard
  - epic-9
relateddocuments:
  - docs/planning/bl-002-ui-ux-overhaul-design.md
  - docs/planning/epic-9-shared-contracts.md
  - docs/implementation/_main/epic-9-experience-redesign.md
  - docs/architecture/_main/05a-UX-Foundations.md
---

# Wave 9.3.1: Command Palette (v1 Navigate + v2 Act)

## Wave Overview
- **Wave ID:** Wave-9.3.1
- **Feature:** Feature 9.3 - Command Palette & Keyboard Layer
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope:** Build the ⌘K command palette on the C8 `Modal` primitive and **own contract C9 (command registry)**: the command type/registry/context, navigate commands (surfaces from the C2 registry, conversations from C1, entity search over tasks/goals by name), and act commands that are thin wrappers over existing server actions (`createTask`, `addReminder`, `snoozeReminder`). Palette v3 (ask fall-through) is **out of scope** — it ships in Wave 9.3.2.
- **Wave Goal:** A user can press ⌘K anywhere in the app and jump to any surface, conversation, task, or goal, or create a task / set a reminder / snooze a reminder — without touching the mouse.

**Wave Philosophy:** This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Shared Contracts

| Contract | Role in this wave |
|---|---|
| **C9 — Command registry** | **OWNED here.** Command shape is fixed: `{ id, title, group: 'navigate' \| 'act' \| 'ask', run(ctx) }`. This wave builds the registry and the `'navigate'` + `'act'` groups; the `'ask'` group slot exists in the type from day one but is populated by Wave 9.3.2. |
| C2 — Panel controller & surface registry | **Consumed.** Navigate commands are *generated from* the C2 surface registry (rail-visible and `null`-rail surfaces alike, e.g. `activity`). `run(ctx)` calls `usePanel().openPanel(surface, { focusId })`. Do not redefine. |
| C1 — Conversation model | **Consumed.** Conversation navigate commands read `listConversations()` and switch the single active-conversation store. Do not redefine. |
| C8 — Component library | **Consumed.** The palette is built on the `Modal`/`Sheet` primitive from `apps/web/src/components/ui/` — do NOT hand-roll a parallel overlay/portal/scrim. |
| C5 — Route map | **Consumed.** Navigate commands keep the URL in sync per C5 (`/tasks`, `/goals`, `/goals/[id]`, `/email`, `/settings`, `/activity`, `/` home). |

## Wave Goals

1. Ship contract C9: command types, registry module, `CommandContext`, and provider — the interface Waves 9.3.2 and 9.4.1 consume unchanged.
2. Ship the palette UI on the C8 `Modal` primitive with full keyboard interaction (WCAG 2.1 AA combobox pattern).
3. Palette v1 (navigate): every C2 surface, every C1 conversation, and any task/goal by name is reachable from ⌘K.
4. Palette v2 (act): "New task…", "Remind me…", "Snooze…" execute through **existing** server actions — no new backend logic (one read-only `listGoals()` wrapper is the sole new server action, and it wraps the existing goals page query).

## User Stories

### User Story 1: Command registry (contract C9)

**As a** developer on Waves 9.3.2 / 9.4.1
**I want** a single typed command registry with a stable command shape and execution context
**So that** the shortcut layer and the tool→panel bridge can register/consume commands without redefining the contract

**Acceptance Criteria:**
- [ ] `Command` type is exactly `{ id: string; title: string; group: 'navigate' | 'act' | 'ask'; run(ctx: CommandContext): void | Promise<void> }` (plus optional presentation fields such as `icon`, `keywords`, `hint` that do not alter the C9 contract).
- [ ] `CommandContext` provides the C2 panel controller (`openPanel`/`closePanel`/`togglePanel`), the Next.js router, the C1 active-conversation store, and a `closePalette()` callback.
- [ ] Registry supports static commands and async command sources (for conversations/entities) behind one `useCommands(query)` hook with ranked, grouped results (order: navigate → act → ask).
- [ ] Unit tests cover shape conformance, ranking, and group ordering.

**Estimated:** 10 hours · **Priority:** High

---

### User Story 2: Palette surface (⌘K)

**As a** Coriven user
**I want** a fast, keyboard-first palette that opens instantly on ⌘K
**So that** navigation depth becomes irrelevant (design doc §4.5, Linear ethos)

**Acceptance Criteria:**
- [ ] Palette renders on the C8 `Modal` primitive; token-backed styling (C4 utilities, no raw palette values).
- [ ] ⌘K / Ctrl+K opens, Esc closes, ↑/↓ move selection, Enter runs the selected command, typing filters live.
- [ ] ARIA combobox/listbox pattern: `role="combobox"` input, `aria-activedescendant`, options announced; focus returns to the previously focused element on close (UX Foundations Pass 3 — clickable things look clickable; keyboard affordances are explicit).
- [ ] Results grouped with visible group headers (Navigate / Act); empty state says what the palette can do (per C8 `EmptyState` teaching pattern).
- [ ] ≤ 3 primary decisions on screen: one input, one ranked list, one selection (UX Foundations Pass 4 — cognitive-load budget).

**Estimated:** 14 hours · **Priority:** High

---

### User Story 3: Navigate anywhere (palette v1)

**As a** Coriven user
**I want** to type a surface name, a conversation title, or a task/goal name and jump straight to it
**So that** I never hunt through the rail or lists (design doc §4.5 v1)

**Acceptance Criteria:**
- [ ] All C2 registry surfaces appear as navigate commands — including `null`-rail surfaces (`activity`) and the Settings sections findable by keyword ("memory", "rules"/"constraints" per design doc §6).
- [ ] Conversations from `listConversations()` (C1) appear by title, ordered pinned-then-recent; selecting one switches the active-conversation store.
- [ ] Typing a task or goal name surfaces it (tasks via existing `getTasks`; goals via a new read-only `listGoals()` server action); selecting opens the surface with `openPanel(surface, { focusId })` and the row is scrolled/highlighted (C2 `focusId`).
- [ ] Entity search is debounced and cached per palette session; URL stays in sync with the opened surface (C5).

**Estimated:** 12 hours · **Priority:** High

---

### User Story 4: Act from the keyboard (palette v2)

**As a** Coriven user
**I want** "new task…", "remind me…", and "snooze…" as palette commands
**So that** the common actions take seconds, with sensible defaults so I decide as little as possible (UX Foundations Pass 4 — default priority `medium`, `recurrence_type = none`, sensible reminder times)

**Acceptance Criteria:**
- [ ] "New task: {title}" calls existing `createTask` with Pass 4 defaults; success toast (C8 `Toast`) + opens Tasks panel focused on the new task.
- [ ] "Remind me…" flows: pick/confirm task + time via a lightweight parameter step *inside the palette*, then calls existing `addReminder`.
- [ ] "Snooze…" offers the standard 15m/1h presets (UX Foundations Pass 3 snooze affordances) and calls existing `snoozeReminder`.
- [ ] Zero new mutation endpoints — act commands are thin client wrappers over `apps/web/src/app/actions/tasks.ts`; errors surface inline in the palette with retry.

**Estimated:** 12 hours · **Priority:** High

---

### User Story 5: Verified quality gate

**As a** maintainer
**I want** the palette covered by unit + interaction tests and an accessibility check
**So that** Wave 9.3.2 can build the shortcut layer on a stable base

**Acceptance Criteria:**
- [ ] Registry, ranking, navigate generation, and act wrappers unit-tested; palette keyboard interaction covered by component tests.
- [ ] `listGoals()` action tested (auth scoping — RLS/user_id — and shape).
- [ ] axe/manual keyboard pass on the palette; no TypeScript or lint errors.

**Estimated:** 6 hours · **Priority:** Medium

**Wave total estimate: ~54 hours** (estimate carries uncertainty in Story 4's in-palette parameter step — flagged in Risks).

## Infrastructure Specifications

### Testing (always)
- **Framework:** existing Vitest + React Testing Library setup in `apps/web`.
- **Unit:** command registry (shape, ranking, grouping), navigate command generation from a mocked C2 registry, act wrappers calling mocked server actions, `listGoals()` action with mocked Supabase client (user scoping).
- **Component/interaction:** palette open/close/filter/select via keyboard events; focus-return behavior; `aria-activedescendant` correctness.
- **Location:** `apps/web/src/lib/commands/__tests__/`, `apps/web/src/components/palette/__tests__/`, `apps/web/src/app/actions/__tests__/goals.test.ts`.

### UI (heavy)
- Built exclusively on C8 primitives (`Modal`, `Input`, `EmptyState`, `Toast`, `Skeleton` for async result loading) and C4 token utilities — no raw palette values, all motion behind `motion-safe:`.
- States: empty (teaches capabilities), loading (skeleton rows while async sources resolve), error (inline retry on act failure) per design doc §5.2 "states everywhere".
- Desktop-first in this wave; 9.5.1 owns responsive `Sheet` behavior — do not pre-build it, but do not block it (palette takes its container from C8).

### API (minimal — one read-only wrapper)
- **`listGoals(): Promise<{ id, title, status }[]>`** in `apps/web/src/app/actions/goals.ts` — read-only, wraps the same query `app/(app)/goals/page.tsx` already runs, RLS-scoped. No other new endpoints; all mutations reuse `createTask`, `addReminder`, `snoozeReminder`.

### Monitoring (light)
- Console-level dev warnings for duplicate command ids at registration.
- No new telemetry/log pipelines; act-command failures surface via the existing server-action error returns + C8 Toast.

## Logical Unit Test Cases

### Test Case 1: listGoals returns only the caller's goals
- **Endpoint:** server action `listGoals()`
- **Method:** server action (POST under the hood)
- **Test Data:** seeded goals for user A and user B; call as user A
- **Expected Result:** only user A's goals, `{ id, title, status }` shape
- **Verification:** RLS/user_id scoping; no extra columns leaked

### Test Case 2: Act command "new task" wraps createTask
- **Endpoint:** existing server action `createTask`
- **Method:** server action
- **Test Data:** palette input "new task Renew passport"
- **Expected Result:** `createTask` called once with `{ title: 'Renew passport', priority: 'medium', status: 'pending' }` defaults
- **Verification:** spy call args; palette closes; `openPanel('tasks', { focusId })` invoked with the returned task id

### Test Case 3: Navigate command honors focusId
- **Endpoint:** n/a (client)
- **Method:** n/a
- **Test Data:** select entity result for task `t-123`
- **Expected Result:** `openPanel('tasks', { focusId: 't-123' })` called; URL becomes `/tasks` (C5)
- **Verification:** mocked panel controller + router assertions

### Test Case 4: Ranking and group order
- **Endpoint:** n/a (client)
- **Method:** n/a
- **Test Data:** query "go" against surfaces + conversations + entities
- **Expected Result:** navigate group before act group; title-prefix matches rank above keyword matches
- **Verification:** `useCommands('go')` snapshot

## Technical Tasks

### Task 9.3.1.1.1: C9 command types, registry module, and CommandContext
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Wave 9.1.1 (C2 controller exists), Wave 9.1.2 (C1 store exists)
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/commands/types.ts` — `Command`, `CommandGroup`, `CommandContext` (C9 shape verbatim)
- `apps/web/src/lib/commands/registry.ts` — register/unregister, duplicate-id dev warning
- Unit tests for shape + registration

**Acceptance Criteria:**
- [ ] Types compile under strict mode; C9 shape matches the shared-contracts doc exactly
- [ ] `'ask'` group exists in the union (populated in 9.3.2)

---

### Task 9.3.1.1.2: Command provider, matching, and ranking
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 9.3.1.1.1
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/commands/provider.tsx` — `CommandProvider` + `useCommands(query)` (mirrors the `TimezoneProvider` context pattern per C2)
- Fuzzy/prefix matcher with keyword support; group-ordered results (navigate → act → ask)
- Async command-source interface (debounce + per-session cache) for Stories 3's dynamic sources

**Acceptance Criteria:**
- [ ] Ranking unit tests pass (Test Case 4)
- [ ] Async sources resolve without blocking static results

---

### Task 9.3.1.2.1: Palette component on the C8 Modal primitive
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 9.3.1.1.2, Wave 9.2.2 (C8 `Modal` exists)
- **Priority:** High

**Deliverables:**
- `apps/web/src/components/palette/command-palette.tsx` — input + grouped result list on `Modal`
- Empty, loading (skeleton rows), and inline-error states

**Acceptance Criteria:**
- [ ] No hand-rolled overlay/portal/scrim — C8 `Modal` only
- [ ] Token-backed styles; `motion-safe:` on all animation

---

### Task 9.3.1.2.2: Keyboard interaction + ARIA + provisional ⌘K binding
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.1.2.1
- **Priority:** High

**Deliverables:**
- ↑/↓/Enter/Esc handling; combobox ARIA (`aria-activedescendant`, live option count); focus return on close
- A **provisional, palette-local** ⌘K/Ctrl+K listener clearly marked `// migrated to global shortcut registry in Wave 9.3.2`

**Acceptance Criteria:**
- [ ] Full keyboard operation with no pointer; axe clean
- [ ] Provisional binding is isolated in one hook so 9.3.2 can delete it in one place

---

### Task 9.3.1.2.3: Mount palette in the app shell + interaction tests
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.3.1.2.2
- **Priority:** High

**Deliverables:**
- Palette + `CommandProvider` mounted once in the `(app)` layout (available on every route)
- Component tests for open/filter/select/close/focus-return

**Acceptance Criteria:**
- [ ] Palette opens on any C5 route
- [ ] Tests green in CI

---

### Task 9.3.1.3.1: Surface navigate commands from the C2 registry
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.3.1.1.2
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/commands/navigate-surfaces.ts` — generated from the C2 surface registry (single source; no duplicated surface list), incl. `activity` and Settings-section keywords ("memory", "rules")
- `run(ctx)` → `openPanel(surface)` + router sync per C5

**Acceptance Criteria:**
- [ ] Adding a surface to the C2 registry automatically yields a palette command (no palette edit needed)

---

### Task 9.3.1.3.2: Conversation navigate commands (C1)
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.3.1.1.2, Wave 9.1.2 (`listConversations()`)
- **Priority:** High

**Deliverables:**
- Async command source over `listConversations()`; selecting sets the C1 active-conversation store
- Pinned-then-recent ordering preserved from the C1 action

**Acceptance Criteria:**
- [ ] Switching conversation from the palette updates chat without reload
- [ ] Untitled conversations render a sensible fallback label

---

### Task 9.3.1.3.3: Entity search (tasks + goals) with focusId open
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.1.3.1
- **Priority:** High

**Deliverables:**
- New read-only `listGoals()` server action in `apps/web/src/app/actions/goals.ts` (wraps the goals page query) + test
- Async entity source: tasks via existing `getTasks`, goals via `listGoals`; name filtering client-side, debounced
- Selection → `openPanel('tasks'|'goals', { focusId })`; goal detail routes to `/goals/[id]` per C5

**Acceptance Criteria:**
- [ ] Test Cases 1 and 3 pass
- [ ] Surfaces honor `focusId` (coordinate with C2 owner if a surface doesn't yet — see Risks)

---

### Task 9.3.1.4.1: Act command framework (in-palette parameter step)
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.1.2.2
- **Priority:** High

**Deliverables:**
- A minimal parameter-step mechanism inside the palette (act command may request one follow-up input/preset choice before `run` completes) — still one modal, no nested dialogs

**Acceptance Criteria:**
- [ ] Esc from a parameter step returns to the command list, not app
- [ ] Pattern documented in the palette component for 9.4.x reuse

---

### Task 9.3.1.4.2: Act commands — new task, remind, snooze
- **Agent:** frontend-specialist
- **Estimation:** 7 hours
- **Dependencies:** Task 9.3.1.4.1, Task 9.3.1.3.3 (task picker reuses entity source)
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/commands/act-tasks.ts` — wrappers over existing `createTask`, `addReminder`, `snoozeReminder` (Pass 4 defaults; 15m/1h snooze presets)
- Success toast + `openPanel('tasks', { focusId })`; inline error + retry on failure

**Acceptance Criteria:**
- [ ] Test Case 2 passes; zero new mutation endpoints
- [ ] Defaults match UX Foundations Pass 4 (priority `medium`, `recurrence_type = none`)

---

### Task 9.3.1.5.1: Quality gate — tests, a11y, type/lint
- **Agent:** quality-control
- **Estimation:** 6 hours
- **Dependencies:** Tasks 9.3.1.2.3, 9.3.1.3.3, 9.3.1.4.2
- **Priority:** Medium

**Deliverables:**
- Full test-suite pass, axe report on the palette, `npm run typecheck` clean
- Verified evidence list (test output, not status claims) attached to the wave PR

**Acceptance Criteria:**
- [ ] All wave acceptance criteria demonstrated with concrete evidence

## Task Dependencies

```
9.3.1.1.1 (C9 types/registry)
  ↓
9.3.1.1.2 (provider + ranking)
  ├─> 9.3.1.2.1 (palette UI, needs C8 Modal)
  │       ↓
  │   9.3.1.2.2 (keyboard + ARIA + provisional ⌘K)
  │       ↓
  │   9.3.1.2.3 (shell mount + tests)
  ├─> 9.3.1.3.1 (surface commands)  ── parallel with 9.3.1.3.2 (conversations)
  │       ↓
  │   9.3.1.3.3 (entity search + listGoals)
  └─> 9.3.1.4.1 (param step; after 9.3.1.2.2)
          ↓
      9.3.1.4.2 (act wrappers)
          ↓
      9.3.1.5.1 (quality gate)
```

**Critical path:** 9.3.1.1.1 → 9.3.1.1.2 → 9.3.1.2.1 → 9.3.1.2.2 → 9.3.1.4.1 → 9.3.1.4.2 → 9.3.1.5.1.
**Parallel streams:** navigate sources (9.3.1.3.x) proceed alongside the palette UI once the provider exists.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope |
|---|---|---|---|
| frontend-specialist | 9.3.1.1.1–9.3.1.4.2 | 48 | `apps/web/src/lib/commands/**`, `apps/web/src/components/palette/**`, `apps/web/src/app/(app)/layout.tsx` (mount only), `apps/web/src/app/actions/goals.ts` (add `listGoals` only) |
| quality-control | 9.3.1.5.1 | 6 | test files + audit reports only; no production-code changes without a named defect |

**Out of scope (do not touch):** the C2 controller internals (`usePanel` implementation), C8 primitive internals, C1 store internals, global keyboard handling beyond the marked provisional ⌘K hook (owned by 9.3.2), chat send path (9.3.2's v3).

## Dependencies

**Depends on:**
- **Wave 9.1.1 (hard)** — C2 panel controller + surface registry; navigate commands are generated from it. Blocked until merged.
- **Wave 9.2.2 (hard)** — C8 `Modal` primitive; the palette must not hand-roll one. Blocked until merged.
- Wave 9.1.2 — C1 `conversations` table, `listConversations()`, single active-conversation store (conversation navigation + 9.3.2's ask hand-off).
- Wave 9.1.3 — C5 route map (URL sync targets) and 9.2.1 — C4 tokens (via C8).

**Blocks:**
- **Wave 9.3.2** — consumes the C9 registry (shortcut → palette open; `'ask'` group population; migrates the provisional ⌘K binding).
- **Wave 9.4.1** — consumes C9 per the shared-contracts consumer list.

## Definition of Done

- [ ] All 5 user stories' acceptance criteria met with evidence (test output, screenshots of states)
- [ ] C9 contract implemented exactly as specified in `epic-9-shared-contracts.md` (any deviation requires updating that doc + flagging 9.3.2/9.4.1)
- [ ] Unit + component tests written and passing; `listGoals` action test passing
- [ ] No TypeScript/lint errors; no raw palette values in new components
- [ ] axe pass on the palette; full keyboard operability verified
- [ ] Docs updated: this wave doc status + epic doc wave summary
- [ ] PR from `development` per repo workflow (never merge without instruction)

## Handoff Requirements

**For Wave 9.3.2:**
- `Command`/`CommandContext` types and `registry.ts` registration API (stable)
- The single provisional ⌘K hook location (to delete/migrate)
- Palette `open()/close()` control surface exposed via context for the global shortcut registry
- Entity/param-step patterns documented for the ask fall-through's "no match" detection point

**For other Features/Epics:**
- Wave 9.4.1: C9 registry available for tool→palette integrations
- 9.2.3 board / surfaces: `focusId` handling expectations (scroll + highlight) exercised by palette navigation

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|---|---|---|
| Surfaces don't yet honor C2 `focusId` (scroll/highlight) | Med | C2 obliges surfaces to accept `focusId`; verify per surface early in 9.3.1.3.3 and file targeted fixes with the surface owner rather than working around in the palette |
| C8 `Modal` lands late or lacks a needed slot (e.g., no-padding content area) | High | Hard dependency — start 9.3.1.1.x (headless registry) which needs no UI; escalate C8 gaps to 9.2.2 owner instead of forking |
| In-palette parameter step scope creep (natural-language time parsing for "remind me") | Med | v2 stays preset/simple-input based; free-form natural language belongs to v3 ask (chat) in 9.3.2 |
| Entity search volume (large task lists) | Low | Client-side filter over existing list actions with debounce/cache; revisit server-side search only if measured slow |

## Notes and Assumptions

- The `'ask'` group is declared in the type union now but has zero commands in this wave — 9.3.2 populates it. This avoids a breaking type change later.
- `listGoals()` is the only new server action, read-only, wrapping an existing query — consistent with "act commands wrap existing server actions; no new backend."
- Effort figures are scope-based estimates, not commitments; Story 4 carries the most uncertainty.
- Wave numbering `9.3.{story}.{task}` maps to the template's Task N with explicit hierarchy.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§4.5 command palette, §5.3 accessibility, §6 surface notes)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C9 owned; C1, C2, C5, C8 consumed)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.3)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 3 affordances, Pass 4 decision minimization)

## Wave Retrospective

{To be filled in after wave completion}

### What Went Well
- {Item}

### What Could Be Improved
- {Item}

### Action Items
- [ ] {Item}
