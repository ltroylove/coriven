---
preparedby: "Roy Love"
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "9"
feature: "9.1"
wave: "9.1.1"
agents: [frontend-specialist]
tags: [coriven, ux, layout-inversion, rail, panel-controller, surface-registry, chat-anchored, epic-9]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.1.1: Rail + Persistent Chat Shell

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 9.1.1 |
| Feature | 9.1 — Layout Inversion & Conversation Unification |
| Epic | 9 — Experience Redesign |
| Status | Planning |
| Scope | Invert the app shell: a ~56px icon rail replaces the nine-tab top bar; chat becomes the permanent left-anchored column; route children render into a resizable right workspace panel driven by a panel controller (contract **C2**) and surface registry; existing pages serve as panel content **unchanged** |

**Wave Philosophy:** Scope-based — this wave is complete when the app shell renders rail + persistent chat + contextual panel on every authenticated route, the panel controller and surface registry exist exactly as pinned in contract C2, the rail conforms to contract C3, and every existing page still works as panel content — regardless of calendar time.

**Wave Goal:** Ship the chat-anchored shell (design doc §4.1–4.2): chat never moves again, navigation is the rail, and all existing surfaces render inside the panel with zero content changes.

## Wave Goals

1. **Contract C2 built and canonical.** A single client panel controller (`usePanel()` context, `{ openSurface, widthPct }` state, `openPanel/closePanel/togglePanel/setWidth` API) plus the canonical surface registry (`overview`, `tasks`, `goals`, `email`, `settings`, `activity`) exist exactly as specified in `epic-9-shared-contracts.md` §C2 — every later Epic 9 wave consumes this unchanged.
2. **Contract C3 built.** The icon rail renders the registry's rail-visible surfaces (Overview/Today, Tasks, Goals, Email) + Settings at the bottom, with Coriven mark, New chat, and History-flyout trigger at top. No Approvals, Memory, or Constraints icons — frequency earns navigation (design doc §3, §4.1b).
3. **Layout inverted, pages untouched.** `(app)/layout.tsx` + `resizable-panels.tsx` are inverted: persistent `ChatPane` on the left, route `children` render as panel content on the right. Existing pages (`/today`, `/tasks`, `/goals`, `/email`, `/settings`, `/approvals`, `/memory`, `/constraints`) are **not modified** — this is an additive shell change (Epic 9 risk mitigation).
4. **URL ↔ panel sync works.** Deep links open the matching surface; browser back switches panel content; `Esc`/✕ closes the panel to full-width chat (readable max-width ~52rem); panel width is resizable 25–60% and persists.

## User Stories

### Story 9.1.1.1 — Panel controller and surface registry exist as the canonical navigation model

**As a** Coriven user (and as every later Epic 9 wave),
**I want** one client-side controller that owns which workspace surface is open and how wide the panel is,
**So that** the panel behaves identically no matter what opens it (rail click, deep link, future `open_surface` tool event or ⌘K command) and later waves can build on a stable contract.

*Implements contract **C2** (panel controller + surface registry) — owner: this wave; consumers: ALL Epic 9 waves.*
*UX Foundations Pass 1 (mental model: the conversation is the primary object; surfaces are the assistant's workspace made visible) and Pass 2 (progressive disclosure: primary surfaces always reachable).*

**Acceptance Criteria:**
- [ ] Panel state is exactly `{ openSurface: SurfaceId | null, widthPct: number }` with `widthPct` clamped to 25–60; `openSurface: null` means the panel is closed and chat takes full width.
- [ ] A React context provider (mirroring the existing `TimezoneProvider` pattern) exposes `usePanel()` with `openPanel(surface, opts?: { focusId?: string })`, `closePanel()`, `togglePanel()`, and `setWidth(pct)` — the exact C2 API, no extras that other waves would come to depend on.
- [ ] The surface registry declares all six C2 surfaces in rail/declaration order — `overview` (rail, `/`), `tasks` (rail, `/tasks`), `goals` (rail, `/goals` + `/goals/[id]`), `email` (rail, `/email`), `settings` (rail bottom, `/settings`), `activity` (no rail icon, `/activity`) — including each surface's tool list from the C2 table (consumed later by 9.4.1; unused data in this wave is still declared).
- [ ] Navigating to a surface's route opens that surface in the panel; the browser back button switches panel content; `openPanel()` from code navigates the URL so URL and panel never disagree.
- [ ] `focusId` passed to `openPanel()` is delivered to the rendered surface (mechanism in place); surfaces honoring it (scroll/highlight) is a consumer obligation fulfilled in Wave 9.4.1 — this wave only guarantees delivery.
- [ ] `widthPct` persists across reloads (client-side persistence, single storage key).

**Priority:** Critical (blocks everything in Epic 9)
**Estimated hours:** 8h

#### Task 9.1.1.1.1 — Build the surface registry module
- **Parent Story:** 9.1.1.1
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** None
- **Deliverables:**
  - `apps/web/src/lib/surfaces/registry.ts` — `SurfaceId` union type, registry entries `{ surface, rail, route, matchPrefixes, icon, label, tools }` matching the C2 table exactly (including `activity` with `submit_for_approval`), plus `surfaceForPathname(pathname)` helper (handles `/goals/[id]`, `/projects/[id]` → `goals`; `/email/[id]` → `email`; interim: `/approvals` → `activity`, `/memory`/`/constraints` → `settings` until 9.1.3 consolidates routes).
- **Acceptance Criteria:**
  - [ ] Registry order = rail order per C3; `SurfaceId` exported for consumers (9.3.1 command registry, 9.4.1 bridge).
  - [ ] Unit tests cover `surfaceForPathname` for every existing route including dynamic segments.

#### Task 9.1.1.1.2 — Build the panel provider/controller
- **Parent Story:** 9.1.1.1
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.1.1.1.1
- **Deliverables:**
  - `apps/web/src/components/providers/panel-provider.tsx` — context + `usePanel()`; state derived from `usePathname()` (URL is the source of truth for `openSurface`); `openPanel` performs `router.push` to the surface's route (with `?focus=` when `focusId` provided); `closePanel` keeps the URL but renders panel closed (Esc/✕ semantics per C2); width clamp 25–60 and persistence.
- **Acceptance Criteria:**
  - [ ] `usePanel()` API surface matches C2 verbatim; TypeScript strict passes.
  - [ ] Unit tests: clamp behavior, open/close/toggle transitions, focusId plumbing.

---

### Story 9.1.1.2 — Chat is permanently anchored on the left and never moves

**As a** daily Coriven user,
**I want** the chat column to stay in the same place with the same conversation no matter where I navigate,
**So that** the most important surface in the product has a stable home — zero teleports (design doc §9, epic success metric).

*UX Foundations Pass 1: "the conversation is the command line and audit log of the relationship — it anchors left and never moves."*

**Acceptance Criteria:**
- [ ] The existing `ChatPane` renders from the layout (left column) on **every** authenticated route; navigating between surfaces never remounts it, reflows its history, or changes its conversation.
- [ ] With the panel open, chat keeps a usable minimum width (~480px floor per design §4.1); with the panel closed, chat takes the full width at a readable max-width (~52rem, centered).
- [ ] `ChatPane`'s internal conversation logic is **unchanged** in this wave (still `chat-panel-conversation-id` localStorage — unification is Wave 9.1.2 / contract C1).
- [ ] The old top tab bar is gone; sign-out and the signed-in identity (previously in the top bar) are relocated to the rail's bottom section and still work.
- [ ] Interim behavior: visiting `/chat` renders the shell with the panel **closed** (full-width chat) — the legacy `ChatClient` route child is not shown; the route itself is retired in Wave 9.1.3 (C5 redirect).

**Priority:** Critical
**Estimated hours:** 8h

#### Task 9.1.1.2.1 — Invert the app layout into an AppShell
- **Parent Story:** 9.1.1.2
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.1.1.1.2
- **Deliverables:**
  - `apps/web/src/components/layout/app-shell.tsx` (new) — client shell composing rail + `ChatPane` + workspace panel; accepts `children` (panel content) and user identity props. Extracted as a reusable component so Wave 9.1.3 can render it from the root `/` page without re-editing this wave's files.
  - `apps/web/src/app/(app)/layout.tsx` (rewritten) — keeps auth + timezone fetch + `TimezoneProvider`, drops the top `<nav>`, wraps `children` in `PanelProvider` + `AppShell`.
  - Removal of `apps/web/src/components/layout/app-nav.tsx` (top tab bar retired).
- **Acceptance Criteria:**
  - [ ] All existing routes render inside the new shell with no page-file changes.
  - [ ] Auth redirect to `/signin` and timezone provisioning behave exactly as before.

#### Task 9.1.1.2.2 — Rework resizable panels into the workspace panel container
- **Parent Story:** 9.1.1.2
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.1.1.1.2
- **Deliverables:**
  - `apps/web/src/components/layout/workspace-panel.tsx` (replaces `resizable-panels.tsx`) — chat left / panel right; drag-handle resize wired to `usePanel().setWidth` (25–60% of the chat+panel area, replacing the old 20–80 / 62% defaults); `HIDE_RIGHT_PANEL_ROUTES` logic deleted (panel visibility now comes from `openSurface`); `/chat` interim mapping to `openSurface: null`.
- **Acceptance Criteria:**
  - [ ] Dragging respects the 25–60% clamp and persists; keyboard users can operate the divider (arrow keys, `role="separator"` + `aria-valuenow`).
  - [ ] `resizable-panels.tsx` is removed with no remaining imports.

---

### Story 9.1.1.3 — The icon rail is the app's entire navigation

**As a** Coriven user,
**I want** a slim icon rail with only the four daily working surfaces plus Settings,
**So that** navigation stops burying the hierarchy under nine flat tabs and horizontal space stays with chat and the panel (design doc §4.1; frequency earns navigation).

*Implements contract **C3** (rail) — owner: this wave; consumers: 9.1.3, 9.5.1.*
*UX Foundations Pass 2 (IA: primary = Chat/Tasks/Goals/Briefing always reachable; secondary one level in; hidden = audit/admin).*

**Acceptance Criteria:**
- [ ] Rail (~56px fixed, left edge) renders top group: Coriven mark, **New chat**, **History** flyout trigger; middle group: Overview (Today), Tasks, Goals, Email in registry order; bottom group: Settings gear + sign-out/user affordance.
- [ ] Nav item shape is `{ surface: SurfaceId, icon, label }` per C3; items are generated from the C2 registry (rail-visible surfaces), not hand-listed.
- [ ] Active surface derives from `usePanel().openSurface`, shows a visible accent indicator, and sets `aria-current="page"`; every item has a hover tooltip = label and a visible focus ring; the rail is fully keyboard-reachable.
- [ ] **No** Approvals, Memory, or Constraints icons anywhere on the rail.
- [ ] **New chat** starts a fresh conversation (interim: writes a new UUID to the existing `chat-panel-conversation-id` key and remounts `ChatPane`; rewired to the unified store in 9.1.2).
- [ ] **History** trigger renders but opens a placeholder ("Conversation history arrives with server-side conversations") — the real flyout is Wave 9.1.2's (needs contract C1).

**Priority:** High
**Estimated hours:** 6h

#### Task 9.1.1.3.1 — Build the rail component
- **Parent Story:** 9.1.1.3
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Task 9.1.1.1.1, Task 9.1.1.1.2
- **Deliverables:**
  - `apps/web/src/components/layout/rail.tsx` — rail per C3, items from the registry; tooltips; active state; sign-out form action reuse from the old top nav.
- **Acceptance Criteria:**
  - [ ] Adding a rail surface to the registry adds it to the rail with no rail-component change.

#### Task 9.1.1.3.2 — Wire New chat and the History trigger stub
- **Parent Story:** 9.1.1.3
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.1.1.3.1
- **Deliverables:**
  - New-chat handler (new UUID → existing panel localStorage key → `ChatPane` remount via key); History trigger with placeholder flyout shell (focus-trapped, `Esc` closes) that 9.1.2 fills.
- **Acceptance Criteria:**
  - [ ] New chat clears the visible conversation without a full page reload; previous conversation remains retrievable once 9.1.2 lands (id was persisted server-side on messages already).

---

### Story 9.1.1.4 — The workspace panel opens, closes, and resizes predictably

**As a** Coriven user,
**I want** the panel to open on deep links, close with `Esc` or ✕, and resize within sane bounds,
**So that** I control how much of the screen my day's state occupies, and chat is always one keypress away from full focus.

*UX Foundations Pass 2 (navigation hierarchy) and Pass 5 habits carried forward (`motion-safe:` transitions, visible states).*

**Acceptance Criteria:**
- [ ] Visiting `/tasks`, `/goals`, `/goals/[id]`, `/email`, `/email/[id]`, `/settings`, `/today`, `/approvals`, `/memory`, `/constraints` opens the shell with the mapped surface's page rendered in the panel — every pre-existing page reachable and functional (forms, server actions, dynamic routes all work inside the panel scroll container).
- [ ] `Esc` (when focus is not inside a text input) and a ✕ affordance in the panel header close the panel to full-width chat; the URL is unchanged so refresh restores the panel (close is a view state, not navigation).
- [ ] Panel transitions run only under `motion-safe:` (existing codebase habit; `prefers-reduced-motion` respected).
- [ ] Interim panel home: `/today`'s existing page serves as the panel's overview content unchanged (the overview board replaces it in Wave 9.2.3).

**Priority:** High
**Estimated hours:** 6h

#### Task 9.1.1.4.1 — Panel chrome: header, close, Esc handling
- **Parent Story:** 9.1.1.4
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.1.1.2.2
- **Deliverables:**
  - Panel header strip (surface label + ✕) inside `workspace-panel.tsx`; global `Esc` listener scoped to app focus (ignores inputs/textareas/contenteditable — pre-clears the path for 9.3.2's shortcut registry).
- **Acceptance Criteria:**
  - [ ] `Esc` never steals from the composer or form fields; ✕ is keyboard/screen-reader accessible.

#### Task 9.1.1.4.2 — Shell regression pass across all existing routes
- **Parent Story:** 9.1.1.4
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Tasks 9.1.1.2.1, 9.1.1.2.2, 9.1.1.3.1, 9.1.1.4.1
- **Deliverables:**
  - Component tests for shell composition (rail + chat + panel per route); manual verification checklist covering every route listed in the story AC, chat streaming while navigating, and resize/close/reopen cycles; `npm run typecheck` clean.
- **Acceptance Criteria:**
  - [ ] A chat response streaming when the user switches surfaces continues streaming uninterrupted (persistence proof).

## Task Dependencies

```
9.1.1.1.1 (registry)
    └─► 9.1.1.1.2 (panel provider)
            ├─► 9.1.1.2.1 (AppShell + layout inversion)
            ├─► 9.1.1.2.2 (workspace panel container)
            └─► 9.1.1.3.1 (rail)
                    └─► 9.1.1.3.2 (new chat + history stub)
9.1.1.2.2 ─► 9.1.1.4.1 (panel chrome)
{9.1.1.2.1, 9.1.1.2.2, 9.1.1.3.1, 9.1.1.4.1} ─► 9.1.1.4.2 (regression pass)
```

**Critical path:** registry → provider → layout inversion → regression pass. Rail and panel chrome parallelize after the provider lands.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| frontend-specialist | all (9.1.1.1.1 – 9.1.1.4.2) | 28h |

**Files/directories this wave may touch (exclusive scope):**
- `apps/web/src/app/(app)/layout.tsx` (rewrite)
- `apps/web/src/components/layout/` — `app-shell.tsx` (new), `rail.tsx` (new), `workspace-panel.tsx` (new), `resizable-panels.tsx` (delete), `app-nav.tsx` (delete)
- `apps/web/src/components/providers/panel-provider.tsx` (new)
- `apps/web/src/lib/surfaces/registry.ts` (new) + `__tests__/`
- Tests colocated with the above

**Explicitly NOT touched:** any page under `apps/web/src/app/(app)/*/` (pages render as panel content unchanged), `apps/web/src/components/chat/*` (conversation logic is 9.1.2), `supabase/`, `apps/web/src/app/actions/`, `apps/web/src/app/api/`, `apps/web/src/app/page.tsx`.

## Dependencies

- **Depends on:** None (first wave of Epic 9; all prerequisite epics 1–7 complete).
- **Blocks:** Wave 9.1.2 (needs the shell + rail History trigger), Wave 9.1.3 (needs AppShell + registry + C5 interim mappings), and per the contracts doc, **everything** in Epic 9 consumes C2 (9.2.x, 9.3.x, 9.4.x, 9.5.x) and C3 (9.1.3, 9.5.1).

## Definition of Done

- Contract C2 controller + registry match `epic-9-shared-contracts.md` §C2 exactly (state shape, API names, six surfaces, tool mappings declared).
- Contract C3 rail matches §C3 (item shape, ordering, top/bottom groups, no Approvals/Memory/Constraints icons).
- Every pre-existing authenticated route renders and functions inside the panel with zero page-file diffs.
- Chat streams uninterrupted across surface switches; `Esc`/✕ close verified; 25–60% resize clamp verified; width persists.
- Unit tests for registry mapping and controller behavior pass; `npm run typecheck` clean; no linter errors.
- Rail and panel divider fully keyboard-operable; `aria-current`, tooltips, focus rings in place; `motion-safe:` on all transitions.
- PR from `development` per project workflow; wave demo of the inversion recorded in the PR description.

## Infrastructure Specifications

### UI

| Element | Spec |
|---|---|
| Rail | ~56px fixed left; top: mark / New chat / History; middle: Overview, Tasks, Goals, Email; bottom: Settings, sign-out. Icons + tooltips; active accent + `aria-current="page"` |
| Chat column | Persistent, left-anchored; min ~480px with panel open; max-w ~52rem centered when panel closed; `ChatPane` internals untouched |
| Workspace panel | One slot, renders route `children`; header (label + ✕); drag handle resize 25–60%; open by default on surface routes; closed state = full-width chat |
| Panel controller | `{ openSurface: SurfaceId \| null, widthPct }`; `usePanel()` = `openPanel/closePanel/togglePanel/setWidth`; URL is source of truth for `openSurface` |
| Interim mappings | `/chat` → panel closed; `/today` page = panel home content; `/approvals` → `activity` surface, `/memory`+`/constraints` → `settings` surface (no rail icons) until 9.1.3 |
| Styling | Current Tailwind idiom (gray-950 canvas, emerald accents) — token migration is Wave 9.2.1; do not introduce new ad-hoc colors beyond the existing palette |

### Testing

- **Unit:** `surfaceForPathname` for all routes incl. dynamic segments; width clamp 25–60; open/close/toggle state machine; focusId delivery.
- **Component:** shell renders rail + chat + panel per route; `Esc` scoping (input-focused vs not); rail active state per pathname; back-button surface switching (router mock).
- **Manual E2E checklist:** every existing route inside the panel; chat streaming across navigation; resize persistence across reload; keyboard-only rail navigation.
- **Coverage target:** ≥80% on `registry.ts` and `panel-provider.tsx`.

### Deployment

- No environment variables, migrations, or config changes. Ships as a normal Vercel preview → PR → `development`. Pure client/layout change; instantly revertable by reverting the PR.

### Monitoring

- None new. Watch Vercel preview for hydration warnings (server layout + client shell boundary) during review.

## Handoff Requirements

**For Wave 9.1.2:**
- `usePanel()` + registry stable; rail's New chat and History trigger are the mount points 9.1.2 rewires to the unified conversation store (C1) and real flyout.
- `ChatPane` still owns `chat-panel-conversation-id` — 9.1.2 replaces it; nothing else in this wave reads that key except the New-chat interim handler (single call site, flagged with a `TODO(9.1.2)`).

**For other Features:**
- 9.2.x styles the shell with tokens; 9.3.x binds `[`/`Esc`/`g` chords to `usePanel()`; 9.4.1 consumes the registry's tool→surface mappings and the focusId mechanism; 9.5.1 owns rail collapse <768px (must not change the C3 item shape).

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Existing pages assume full-width main column and look cramped in a 25–60% panel | Med | Med | Pages functionally unchanged is the bar, not pixel-perfect; visual pass lands with tokens/board (9.2.x); panel min 25% ≈ old 38% dock familiar territory |
| Layout inversion regresses a route silently | Med | Med | Task 9.1.1.4.2 regression checklist covers every route; pages themselves have zero diffs so breakage is confined to the shell |
| URL-as-source-of-truth fights `closePanel` (close without navigating) | Med | Low | Close is explicit view state layered over the URL-derived surface; refresh restores from URL — documented in provider contract tests |
| `Esc` handler conflicts with future shortcut layer (9.3.2) | Low | Med | Scoping rules (ignore editable elements) written once here; 9.3.2's registry absorbs the listener rather than duplicating it |

## Notes and Assumptions

- **Registry is declared in full (including `activity` and per-surface tool lists) even though `activity`'s route ships in 9.1.3 and the tool mappings are consumed in 9.4.1** — the registry is the single canonical list per C2; consumers must never re-declare it.
- Sign-out moves from the deleted top bar to the rail bottom — a scope necessity, not a design addition.
- `focusId` is *delivered* by this wave, *honored* by surfaces in 9.4.1.
- No design-token work here; the shell inherits the current palette until 9.2.1.

## Related Documentation

- Shared contracts (C2, C3 owned here): `docs/planning/epic-9-shared-contracts.md`
- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` §4.1, §4.2
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` — Feature 9.1
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — Pass 1, Pass 2
