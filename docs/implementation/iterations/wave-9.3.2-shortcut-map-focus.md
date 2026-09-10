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
wave: "9.3.2"
agents:
  - frontend-specialist
  - quality-control
tags:
  - keyboard
  - shortcuts
  - focus-management
  - epic-9
relateddocuments:
  - docs/planning/bl-002-ui-ux-overhaul-design.md
  - docs/planning/epic-9-shared-contracts.md
  - docs/implementation/_main/epic-9-experience-redesign.md
  - docs/architecture/_main/05a-UX-Foundations.md
---

# Wave 9.3.2: Shortcut Map, Focus Management & Palette v3 (Ask)

## Wave Overview
- **Wave ID:** Wave-9.3.2
- **Feature:** Feature 9.3 - Command Palette & Keyboard Layer
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope:** The global keyboard layer: a single shortcut registry implementing the fixed C9 shortcut map (`⌘K` palette · `⌘/` focus composer · `Esc` close panel · `[` toggle panel · `g t / g g / g e` go-to surfaces), app-wide focus management (rail, panel, composer all keyboard-reachable; correct focus return; no focus traps outside modals), and palette **v3 "ask"** — unrecognized palette input falls through to chat as a message to the active conversation.
- **Wave Goal:** The whole app is operable and *fast* from the keyboard — every fixed shortcut works globally, focus always lands somewhere sensible, and anything the palette doesn't recognize becomes a message to Coriven.

**Wave Philosophy:** This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Shared Contracts

| Contract | Role in this wave |
|---|---|
| **C9 — Command registry** | **Consumed (owned by 9.3.1); this wave OWNS the shortcut map half of C9:** `⌘K` palette · `⌘/` composer · `Esc` close panel · `[` toggle panel · `g t/g g/g e` go-to. This map is fixed — additions/changes require updating `epic-9-shared-contracts.md`. Also populates the C9 `'ask'` command group. |
| C2 — Panel controller | **Consumed.** `Esc` → `closePanel()`, `[` → `togglePanel()`, `g t/g g/g e` → `openPanel('tasks'|'goals'|'email')`. Do not redefine. |
| C1 — Conversation model | **Consumed.** Ask fall-through posts to the **active conversation** from the single active-conversation store. Do not redefine. |
| C8 — Component library | **Consumed.** Focus-trap behavior inside `Modal`/`Sheet` belongs to C8; this wave verifies and integrates, it does not reimplement trapping. |
| C4 — Design tokens | **Consumed.** Visible focus rings use token-backed styles. |

## Wave Goals

1. One global shortcut registry (single keydown listener + chord state machine) implementing the fixed C9 map, with correct input-context guards, and retiring 9.3.1's provisional ⌘K hook.
2. Deterministic focus management: rail, panel, and composer reachable by keyboard; focus returns on palette/panel close; focus traps only inside C8 modals; visible focus rings everywhere (design doc §5.3).
3. Palette v3: unmatched input offers "Ask Coriven: '{input}'" and posts it to the active conversation, closing the palette and focusing chat.
4. Shortcut discoverability without noise: hints in tooltips/palette footer/composer (UX Foundations Pass 3 affordances) while keeping ≤3 primary decisions per screen (Pass 4).

## User Stories

### User Story 1: Global shortcuts that always work

**As a** power user
**I want** the fixed shortcut map to work from anywhere in the app
**So that** panel and navigation depth cost me zero pointer trips (design doc §4.5, Linear-style chords)

**Acceptance Criteria:**
- [ ] `⌘K`/`Ctrl+K` opens the palette from any route and any focus location (including inside text inputs).
- [ ] `⌘/` focuses the chat composer; `Esc` closes the panel via C2 `closePanel()` (when no modal is open — modal Esc wins); `[` toggles the panel via C2 `togglePanel()`.
- [ ] `g t` / `g g` / `g e` chords open Tasks / Goals / Email via C2 `openPanel()`; chord state times out (~1s) and never fires while typing in an input/textarea/contenteditable.
- [ ] Exactly one document-level keydown listener owns all of this; 9.3.1's provisional ⌘K hook is deleted.
- [ ] Shortcut map matches C9 exactly — no extra global bindings added in this wave without a contracts-doc update.

**Estimated:** 12 hours · **Priority:** High

---

### User Story 2: Focus that never gets lost

**As a** keyboard user (including assistive-tech users)
**I want** every zone reachable by Tab and focus returned predictably after overlays close
**So that** the app meets WCAG 2.1 AA keyboard requirements and never traps or drops my focus

**Acceptance Criteria:**
- [ ] Logical tab order across the three zones: rail → chat/composer → panel; no unreachable interactive elements; no focus traps outside C8 `Modal`/`Sheet`.
- [ ] Closing the palette or a panel returns focus to the element that had it (or to the composer as documented fallback when that element is gone).
- [ ] Opening a surface via `g`-chord or palette moves focus into the panel's `PanelHeader` region (announced to screen readers); `Esc` from the panel returns focus to the composer.
- [ ] Visible token-backed focus rings on rail items, panel controls, composer, and palette rows (`:focus-visible`, C4 tokens).

**Estimated:** 10 hours · **Priority:** High

---

### User Story 3: Ask fall-through (palette v3)

**As a** Coriven user
**I want** anything the palette doesn't recognize to become a chat message
**So that** ⌘K is a safe universal entry point — I can't "fail" at it (design doc §4.5 v3; Pass 4 decision minimization)

**Acceptance Criteria:**
- [ ] When a query matches no navigate/act command, the palette shows a final `'ask'`-group command: `Ask Coriven: "{input}"` (also shown as a last-row option under partial matches so ask is always reachable).
- [ ] Selecting it posts the raw input as a user message to the **active conversation** (C1 store) through the existing chat send path — no parallel send implementation, no new backend.
- [ ] Palette closes, focus lands in the composer, and the streamed reply appears in the conversation exactly as if typed there.
- [ ] The ask command is registered in the C9 `'ask'` group via the 9.3.1 registry API (no registry changes).

**Estimated:** 8 hours · **Priority:** High

---

### User Story 4: Discoverable, verified keyboard layer

**As a** new user
**I want** to learn the shortcuts where I already look
**So that** the keyboard layer is discoverable without a manual (Pass 3: affordances are explicit; Pass 4: no added decisions)

**Acceptance Criteria:**
- [ ] Rail tooltips show go-to chords (`g t`, `g g`, `g e`); composer hint line includes `⌘/`; palette footer shows `⌘K · Esc · ↑↓ · Enter`; panel close affordance shows `Esc`.
- [ ] Hints are quiet (muted token text), add no new primary decisions to any screen, and respect the existing "Enter to send · Shift+Enter" hint pattern.
- [ ] Full WCAG 2.1 AA keyboard audit passes: reachability, focus visibility, no traps, `prefers-reduced-motion` respected on any focus-related transitions.

**Estimated:** 6 hours · **Priority:** Medium

**Wave total estimate: ~36 hours.**

## Infrastructure Specifications

### Testing (always)
- **Framework:** existing Vitest + React Testing Library in `apps/web`.
- **Unit:** shortcut registry — key matching, chord state machine + timeout, input-context guards (`⌘K`/`⌘/` fire inside inputs; `[` and `g`-chords do not), modal-Esc precedence over panel-Esc.
- **Component/integration:** focus-return scenarios (palette close, panel close, g-chord open), ask fall-through posting through a mocked chat send controller, composer focus on `⌘/`.
- **Location:** `apps/web/src/lib/keyboard/__tests__/`, `apps/web/src/components/palette/__tests__/ask-fallthrough.test.tsx`, `apps/web/src/components/chat/__tests__/`.

### UI (heavy)
- Focus rings and hint text are token-backed (C4); no raw palette values.
- Hints rendered with existing quiet-text patterns; no new visual primitives — reuse C8 `Badge`/tooltip styles where a kbd-style chip is needed (if a `Kbd` micro-component is added it lives in `components/ui/` and is flagged to the C8 owner, not forked).
- All focus transitions behind `motion-safe:`.

### API (none)
- No new endpoints or server actions. Ask fall-through reuses the existing chat send path (SSE flow in `apps/web/src/lib/chat/engine.ts` via the chat pane's send handler); shortcuts call the existing C2 controller.

### Monitoring (light)
- Dev-mode console warning if two handlers register the same key combo in the shortcut registry.
- No telemetry additions.

## Logical Unit Test Cases

### Test Case 1: Chord state machine
- **Endpoint:** n/a (client, `useShortcuts`)
- **Method:** n/a
- **Test Data:** keydown `g` then `t` within 1s; then `g` followed by 1.2s pause then `t`
- **Expected Result:** first sequence calls `openPanel('tasks')`; second does nothing (chord expired)
- **Verification:** mocked C2 controller call counts

### Test Case 2: Input-context guards
- **Endpoint:** n/a (client)
- **Method:** n/a
- **Test Data:** focus in composer textarea; press `[`, then `⌘K`
- **Expected Result:** `[` inserts a literal bracket (no toggle); `⌘K` opens the palette
- **Verification:** `togglePanel` not called; palette open state true

### Test Case 3: Ask fall-through posts to active conversation
- **Endpoint:** existing chat send path (client controller → `/api` SSE)
- **Method:** POST (existing chat route)
- **Test Data:** palette input "what should I focus on today" with no command match; active conversation `c-42` in the C1 store
- **Expected Result:** send controller invoked once with the raw text for conversation `c-42`; palette closed; composer focused
- **Verification:** mocked send controller args; `document.activeElement` is the composer textarea

### Test Case 4: Focus return on close
- **Endpoint:** n/a (client)
- **Method:** n/a
- **Test Data:** focus a rail item → `⌘K` → `Esc`
- **Expected Result:** focus returns to the rail item
- **Verification:** `document.activeElement` assertion

## Technical Tasks

### Task 9.3.2.1.1: Global shortcut registry + chord state machine
- **Agent:** frontend-specialist
- **Estimation:** 7 hours
- **Dependencies:** Wave 9.3.1 complete (C9 registry + palette control surface)
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/keyboard/shortcuts.ts` + `use-shortcuts.ts` — single document-level keydown listener, declarative binding table, chord support with timeout, input-context guards, modal-precedence rule, duplicate-binding dev warning
- Unit tests (Test Cases 1–2)

**Acceptance Criteria:**
- [ ] Exactly one global listener; bindings declared as data, not scattered handlers
- [ ] Mac/Windows parity (`⌘` / `Ctrl`)

---

### Task 9.3.2.1.2: Bind the fixed C9 map and retire the provisional ⌘K
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.2.1.1
- **Priority:** High

**Deliverables:**
- Bindings: `⌘K` → palette open; `⌘/` → composer focus; `Esc` → C2 `closePanel()` (modal-aware); `[` → C2 `togglePanel()`; `g t/g g/g e` → C2 `openPanel('tasks'|'goals'|'email')`
- Deletion of 9.3.1's provisional palette-local ⌘K hook
- Integration tests over mocked C2 controller

**Acceptance Criteria:**
- [ ] Map matches C9 verbatim; nothing extra bound globally
- [ ] Provisional hook removed; palette opens only via the registry

---

### Task 9.3.2.2.1: Composer focus handle + focus-return plumbing
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.2.1.1
- **Priority:** High

**Deliverables:**
- A small focus controller (context or ref registry) exposing `focusComposer()` from `apps/web/src/components/chat/composer.tsx` without prop-drilling
- Focus-return on palette close and panel close (documented fallback: composer)
- Focus moves into `PanelHeader` on shortcut/palette-driven surface open

**Acceptance Criteria:**
- [ ] Test Case 4 passes; `⌘/` works from any route
- [ ] Behavior documented in the keyboard lib README block for 9.4.x/9.5.x consumers

---

### Task 9.3.2.2.2: Tab-order, trap audit, and focus-ring pass
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.3.2.2.1
- **Priority:** High

**Deliverables:**
- Tab-order fixes across rail/chat/panel zones; removal of any accidental traps outside C8 modals; verification that C8 `Modal`/`Sheet` trapping works with the global registry (Esc precedence)
- `:focus-visible` token-backed rings on rail items, panel controls, palette rows, composer

**Acceptance Criteria:**
- [ ] Every interactive element reachable and escapable by keyboard alone
- [ ] Rings visible on all C4 canvas/surface backgrounds (≥ 3:1 against adjacent colors)

---

### Task 9.3.2.3.1: Expose the chat send controller (ask hand-off point)
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Wave 9.3.1 complete; Wave 9.1.2 (C1 active-conversation store)
- **Priority:** High

**Deliverables:**
- `sendChatMessage(text)` exposed via a chat controller context wrapping the existing send path in `apps/web/src/components/chat/chat-pane.tsx` (targets the C1 active conversation; optimistic message + SSE stream identical to composer-typed sends)
- No duplication of the SSE handling; the composer and the palette call the same function

**Acceptance Criteria:**
- [ ] One send implementation; composer refactored to call it with zero behavior change (existing chat tests still pass)
- [ ] Works with the C1 single active-conversation store (not the legacy localStorage keys)

---

### Task 9.3.2.3.2: Palette v3 ask command
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.3.2.3.1
- **Priority:** High

**Deliverables:**
- `'ask'`-group command registered via the 9.3.1 C9 registry: shown when no match (primary) and as the last row otherwise; `run(ctx)` → `sendChatMessage(input)`, `closePalette()`, `focusComposer()`
- Component test (Test Case 3)

**Acceptance Criteria:**
- [ ] Command shape conforms to C9 (`group: 'ask'`); no registry API changes
- [ ] Empty-input Enter does nothing (no accidental blank messages)

---

### Task 9.3.2.4.1: Shortcut discoverability hints
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.3.2.1.2
- **Priority:** Medium

**Deliverables:**
- Chord hints in rail tooltips; `⌘/` in the composer hint line; `⌘K · Esc · ↑↓ · Enter` palette footer; `Esc` on the panel close affordance — muted token text, single source of hint strings derived from the binding table (no hardcoded duplicates)

**Acceptance Criteria:**
- [ ] Changing a binding updates its hints automatically
- [ ] No screen gains a new primary decision (Pass 4 budget preserved)

---

### Task 9.3.2.4.2: WCAG 2.1 AA keyboard audit + quality gate
- **Agent:** quality-control
- **Estimation:** 3 hours
- **Dependencies:** Tasks 9.3.2.2.2, 9.3.2.3.2, 9.3.2.4.1
- **Priority:** Medium

**Deliverables:**
- Keyboard-only walkthrough evidence (all shortcuts, all zones, focus return), axe pass, screen-reader spot check on palette + panel-open announcements, `npm run typecheck` clean
- Concrete evidence attached to the wave PR (recordings/output, not status claims)

**Acceptance Criteria:**
- [ ] No open AA keyboard findings; all wave acceptance criteria evidenced

## Task Dependencies

```
9.3.2.1.1 (shortcut registry)
  ├─> 9.3.2.1.2 (bind C9 map, retire provisional ⌘K)
  │       └─> 9.3.2.4.1 (hints)
  └─> 9.3.2.2.1 (composer focus + focus return)
          └─> 9.3.2.2.2 (tab order / traps / rings)

9.3.2.3.1 (chat send controller)  ── parallel with 9.3.2.1.x
  └─> 9.3.2.3.2 (ask command)

9.3.2.4.2 (audit) ← after 9.3.2.2.2, 9.3.2.3.2, 9.3.2.4.1
```

**Critical path:** 9.3.2.1.1 → 9.3.2.2.1 → 9.3.2.2.2 → 9.3.2.4.2.
**Parallel streams:** the ask stream (9.3.2.3.x) is independent of the shortcut stream until the final audit; hints (9.3.2.4.1) follow the binding table.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope |
|---|---|---|---|
| frontend-specialist | 9.3.2.1.1–9.3.2.4.1 | 33 | `apps/web/src/lib/keyboard/**`, `apps/web/src/components/chat/chat-pane.tsx` + `composer.tsx` (send-controller extraction + focus handle only), `apps/web/src/components/palette/**` (ask row + footer + delete provisional hook), rail/panel components (tooltips, focus rings, tab order only) |
| quality-control | 9.3.2.4.2 | 3 | audit evidence + test files; no production-code changes without a named defect |

**Out of scope (do not touch):** C9 registry API and 9.3.1 command internals (consume only), C2 controller internals, C8 `Modal` trap implementation (verify, escalate gaps to 9.2.2 owner), C1 store internals, chat SSE engine (`lib/chat/engine.ts`), any new global shortcuts beyond the fixed C9 map.

## Dependencies

**Depends on:**
- **Wave 9.3.1 (hard)** — C9 command registry, palette component + control surface, provisional ⌘K hook to retire.
- **Wave 9.1.1 (hard, transitive and direct)** — C2 `closePanel`/`togglePanel`/`openPanel` are the targets of `Esc`, `[`, and the `g`-chords.
- **Wave 9.2.2 (hard)** — C8 `Modal`/`Sheet` focus-trap behavior that the global Esc handling must defer to.
- Wave 9.1.2 — C1 single active-conversation store (ask fall-through target).

**Blocks:**
- Wave 9.5.1 — responsive work must preserve the shortcut map and focus rules (rail collapse keeps `g`-chords; sheets keep Esc semantics).
- Wave 9.4.x — assistant-opened panels (C6) should reuse this wave's panel-focus behavior for parity between user- and assistant-initiated opens.

## Definition of Done

- [ ] All 4 user stories' acceptance criteria met with evidence
- [ ] Shortcut map matches C9 verbatim; contracts doc untouched (or updated + dependents flagged if a change proved necessary)
- [ ] 9.3.1's provisional ⌘K hook deleted; exactly one global keydown listener
- [ ] Unit + integration tests passing, incl. existing chat tests after the send-controller extraction
- [ ] WCAG 2.1 AA keyboard audit passed (reachability, focus visibility, no traps)
- [ ] No TypeScript/lint errors; token-backed styles only
- [ ] Docs updated: this wave doc status + epic doc wave summary
- [ ] PR from `development` per repo workflow (never merge without instruction)

## Handoff Requirements

**For Wave 9.4.x:**
- `sendChatMessage(text)` chat controller — the same entry point proactive/integration features can reuse for programmatic sends
- Panel-focus-on-open behavior to mirror in C6 `open_surface` handling

**For Wave 9.5.x:**
- Binding table + hint derivation (responsive variants must not fork the map)
- Focus rules doc (zones, return targets, trap policy) to preserve in sheet/overlay modes

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|---|---|---|
| Esc ambiguity (modal vs panel vs palette parameter step) | Med | Explicit precedence in the registry: open C8 modal/palette consumes Esc first; C2 `closePanel()` only when nothing overlays. Unit-tested precedence table. |
| Send-controller extraction regresses chat streaming | High | Pure refactor with existing chat tests as the guard; composer behavior must be bit-identical before the palette calls it |
| `[` conflicts with typing in inputs | Low | Input-context guard: printable single-key and chord bindings never fire inside input/textarea/contenteditable (only `⌘K`, `⌘/`, Esc do) |
| Browser/OS reserved combos (`Ctrl+K` in some browsers focuses URL bar variants) | Low | `preventDefault` on handled combos; verify on Chrome/Edge/Firefox, document any platform caveat |

## Notes and Assumptions

- The C1 active-conversation store (Wave 9.1.2) has replaced the legacy `chat-panel-conversation-id` localStorage key by the time this wave starts; the send controller targets the store, not the key.
- No help-overlay ("?" cheatsheet) in this wave — the design doc specifies a *small fixed* map with inline hints; a cheatsheet would be new scope and a new global binding (contracts change).
- Effort figures are scope-based estimates; the send-controller extraction (9.3.2.3.1) is the main uncertainty and is deliberately isolated as its own task.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§4.5 palette v3 + shortcut map, §5.3 accessibility)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C9 shortcut map owned here; C1, C2, C4, C8 consumed)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.3)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 3 affordances, Pass 4 decision minimization)
- Prior wave: `docs/implementation/iterations/wave-9.3.1-command-palette.md`

## Wave Retrospective

{To be filled in after wave completion}

### What Went Well
- {Item}

### What Could Be Improved
- {Item}

### Action Items
- [ ] {Item}
