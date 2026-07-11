---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "2"
feature: "2.4"
wave: "2.4.1"
agents: []
tags: [coriven, memory, ui, memory-page, entities, supersession, wcag]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 2.4.1: /memory Management Page

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.4.1 |
| Feature | 2.4 — /memory Management Page |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Build the `/memory` page with Entities and Memories tabs; list, edit, and delete flows; supersession history display; Server Actions for writes; WCAG 2.1 AA accessibility |

**Wave Philosophy:** Scope-based — this wave is complete when a user can view, correct, and understand everything Coriven knows about them through the `/memory` page, regardless of calendar time.

## Wave Goals

1. **Memory transparency delivered.** The `/memory` page shows all entity profiles and memories in tabbed lists — satisfying the UX principle "visible, correctable memory" and UC-12/UC-13 — making Coriven trustworthy for daily use.
2. **Corrections are non-destructive.** Editing an entity or memory creates a new version via supersession (`superseded_by`) rather than silently overwriting data; supersession history is visible in the UI — satisfying Business Requirements Feature 4 "superseded excluded from default retrieval, still queryable."
3. **UI is accessible and reuses existing shell patterns.** The page integrates into the existing two-pane layout (content + docked chat) and meets WCAG 2.1 AA for contrast, keyboard navigation, and ARIA labeling — consistent with UX Foundation Pass 6 hard constraint 7.

## User Stories

### Story 2.4.1.1 — User can view all entity profiles in a searchable list

**As the** primary user,
**I want** to open `/memory` and see all the entities (people, places, projects) Coriven knows about,
**So that** I can verify it has correct information and understand what it uses when I chat.

**Acceptance Criteria:**
- `/memory` page loads with an "Entities" tab as the default view.
- Each entity displays: name, type badge, description, aliases list, `last_mentioned` date (human-readable), and `mention_count`.
- Empty state: "I haven't learned about any people, places, or projects yet. Tell me about them in chat." (per UX Pass 5 empty state design).
- Loading state: skeleton rows while data fetches.
- Tab is keyboard-navigable; entity rows have appropriate ARIA roles.
- Page renders as a server component; entity data fetched server-side.
- Page accessible at `/memory` within the existing Next.js App Router layout.
- UI follows the existing two-pane layout (entities list on the left/content pane; chat docked).
- >80% test coverage on the server-side data fetch function.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements UC-12; UX §"Memory" screen wireframe; UX Foundations Pass 5 states; Pass 6 constraint 3

#### Task 2.4.1.1.1 — Server component: fetch and render entity list

| Field | Value |
|---|---|
| Parent Story | 2.4.1.1 |
| Agent | Frontend Engineer |
| Estimation | 4h |
| Dependencies | Wave 2.1.1 (`entity_profiles` table); Wave 2.3.1 (`upsert_entity` available for testing fixture data) |
| Deliverables | `apps/web/src/app/memory/page.tsx` (server component); `apps/web/src/app/memory/entities-list.tsx` (server component) |

**Acceptance Criteria:**
- `page.tsx` is an async server component; uses the SSR-aware Supabase auth client to get the authenticated user; redirects unauthenticated requests to `/login`.
- Fetches `entity_profiles` for `user_id = auth.uid()` ordered by `last_mentioned DESC NULLS LAST`.
- Renders two tabs: "Entities" (default) and "Memories"; tabs implemented with accessible tab pattern (ARIA `role="tablist"`, `role="tab"`, `role="tabpanel"`).
- Entity list renders `MemoryEntityRow` components (see Task 2.4.1.2.1).
- Empty-state and loading skeleton handled.
- WCAG AA: visible focus on all interactive elements; tab/arrow key navigation between tabs.

#### Task 2.4.1.1.2 — Unit-test entity data fetch

| Field | Value |
|---|---|
| Parent Story | 2.4.1.1 |
| Agent | Frontend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.4.1.1.1 |
| Deliverables | `apps/web/src/app/memory/__tests__/entities-list.test.tsx` |

**Acceptance Criteria:**
- Supabase client mocked; test verifies: authenticated user gets their entities; unauthenticated → redirect; empty state renders correctly.
- Coverage >80% on the fetch function and conditional rendering paths.

---

### Story 2.4.1.2 — User can edit and delete entity profiles with supersession history visible

**As the** primary user,
**I want** to click "Edit" on an entity and update it (triggering supersession), and see the history of what it used to say,
**So that** I can trust that corrections are saved and understand the provenance of current information.

**Acceptance Criteria:**
- Each entity row has an "Edit" button that opens an inline edit form (or a slide-out panel) with fields for name, type, description, and aliases.
- Saving the form calls a Server Action that creates a new entity row and sets `superseded_by` on the old row — no in-place overwrite.
- Supersession history is shown as a collapsible "History" section on the entity row: each prior version with its description and the date it was superseded.
- A "Delete" button triggers a confirmation dialog; on confirm calls a Server Action that marks the entity `deleted` (soft delete via a `deleted_at timestamptz` column — or `superseded_by` pointing to a tombstone row); entity is no longer returned in default queries but is preserved.
- Edit form is keyboard-accessible; submit on Enter; Escape closes without saving.
- Error state: inline error message if the Server Action fails.
- >80% test coverage on Server Actions.

**Priority:** Critical
**Estimated hours:** 8h
**References:** Business Requirements UC-12, UC-13; UX wireframe (Entities tab with history); UX Foundations Pass 3 (edit affordance); Pass 5 states; Pass 6 constraint 3

#### Task 2.4.1.2.1 — Build `MemoryEntityRow` component

| Field | Value |
|---|---|
| Parent Story | 2.4.1.2 |
| Agent | Frontend Engineer |
| Estimation | 4h |
| Dependencies | Task 2.4.1.1.1 |
| Deliverables | `apps/web/src/components/memory/memory-entity-row.tsx` (client component) |

**Acceptance Criteria:**
- Props: `entity: EntityProfile`, `history: EntityProfile[]` (superseded ancestors), `onEdit: () => void`, `onDelete: () => void`.
- Renders name, type badge (colored by type), description, aliases as chips, `last_mentioned` as a relative date.
- "History" accordion: each ancestor shown with description and superseded-on date.
- "Edit" and "Delete" buttons; Delete shows `window.confirm` or a modal (consistent with existing patterns in the codebase).
- ARIA: `role="article"` on each row; buttons labeled; history accordion uses `aria-expanded`.
- `prefers-reduced-motion`: no transition animation if motion is reduced.

#### Task 2.4.1.2.2 — Server Actions for entity edit and delete

| Field | Value |
|---|---|
| Parent Story | 2.4.1.2 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.4.1.2.1; Wave 2.1.1 schema |
| Deliverables | `apps/web/src/app/actions/memory.ts` — `editEntity`, `deleteEntity` |

**Acceptance Criteria:**
- `editEntity(entityId, updates)`: Server Action (marked `'use server'`); authenticates via SSR Supabase client; inserts a new `entity_profiles` row with updated fields; sets `superseded_by` on the original row to the new row's `id`; revalidates the `/memory` page.
- `deleteEntity(entityId)`: sets `superseded_by` to a tombstone pattern (or `deleted_at = NOW()` if a `deleted_at` column is added in this wave's migration); revalidates.
- Both actions validate inputs (non-empty name for edit; valid UUID for both).
- RLS enforced via the user-scoped SSR client — service client not used for user-initiated edits.
- Error returned as a typed result `{ error: string }` rather than thrown (consistent with Next.js Server Action error patterns).

#### Task 2.4.1.2.3 — Test Server Actions and edit flow

| Field | Value |
|---|---|
| Parent Story | 2.4.1.2 |
| Agent | Frontend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.4.1.2.2 |
| Deliverables | `apps/web/src/app/actions/__tests__/memory.test.ts` |

**Acceptance Criteria:**
- Supabase client mocked; `editEntity` test verifies: new row inserted with correct fields; old row `superseded_by` set to new id; unauthenticated call rejected.
- `deleteEntity` test: soft-delete mechanism applied; row not returned in subsequent default queries.
- Coverage >80% on `memory.ts` actions.

---

### Story 2.4.1.3 — User can view, search, and manage memories in the Memories tab

**As the** primary user,
**I want** to see the raw memories Coriven has saved and search them by keyword,
**So that** I can review and remove incorrect memories I don't want influencing future conversations.

**Acceptance Criteria:**
- "Memories" tab shows a list of non-superseded `memories` rows ordered by `created_at DESC`.
- Each row shows: `content` text, `source` (if set), creation date.
- A search input filters the visible list client-side by `content` text (no additional API call for the search).
- Each memory has a "Delete" button; deletion calls a Server Action that sets `superseded_by` to a tombstone (non-destructive); the row disappears from the default list immediately (optimistic update).
- Superseded memories are not shown in the default list but a "Show history" toggle reveals them with a visual "superseded" label.
- Empty state: "No memories saved yet. Chat with Coriven to build up your memory."
- Loading skeleton while fetching.
- WCAG AA: search input has a visible label; list items have appropriate ARIA roles.
- >80% test coverage on the memories fetch and delete action.

**Priority:** High
**Estimated hours:** 6h
**References:** Business Requirements UC-12, UC-13; UX §"Memory" wireframe (Memories tab); UX Foundations Pass 5

#### Task 2.4.1.3.1 — Server component: fetch and render memories list

| Field | Value |
|---|---|
| Parent Story | 2.4.1.3 |
| Agent | Frontend Engineer |
| Estimation | 3h |
| Dependencies | Wave 2.1.1 (memories table); Task 2.4.1.1.1 (page structure) |
| Deliverables | `apps/web/src/app/memory/memories-list.tsx` (client component for search interactivity) |

**Acceptance Criteria:**
- Memories fetched server-side (in page); passed as props to the client component.
- Client component holds search state locally; filters `memories` array by `content.toLowerCase().includes(query)`.
- "Show history" toggle shows superseded rows with a distinct visual treatment (muted text + "superseded" badge).
- Accessible: search input `<label>` for screen readers; list items have `role="listitem"`.

#### Task 2.4.1.3.2 — Server Action for memory deletion

| Field | Value |
|---|---|
| Parent Story | 2.4.1.3 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.4.1.3.1 |
| Deliverables | `deleteMemory(memoryId)` Server Action in `apps/web/src/app/actions/memory.ts` |

**Acceptance Criteria:**
- Sets `superseded_by` on the target memory row to a tombstone sentinel value (e.g., a static UUID representing user-deletion, or `updated_at = NOW()` marker); row remains in the DB.
- Authenticated user can only delete their own memories (RLS enforced via SSR client).
- Revalidates `/memory` page.
- Returns `{ success: true }` or `{ error: string }`.

#### Task 2.4.1.3.3 — Test memories tab and delete action

| Field | Value |
|---|---|
| Parent Story | 2.4.1.3 |
| Agent | Frontend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.4.1.3.2 |
| Deliverables | Tests for `memories-list.tsx` search filtering and `deleteMemory` action |

**Acceptance Criteria:**
- Search filter: test that filtering by keyword correctly shows/hides rows.
- Delete action: mocked Supabase; asserts `superseded_by` set; unauthenticated call rejected.
- Coverage >80% on new files.

## Task Dependencies

```
Wave 2.3.1 (complete)
  └─► 2.4.1.1.1 (page + entity list server component)
        ├─► 2.4.1.1.2 (entity fetch test)
        └─► 2.4.1.2.1 (MemoryEntityRow component)
              ├─► 2.4.1.2.2 (Server Actions: edit + delete entity) ──► 2.4.1.2.3 (tests)
              └─► [page assembles entity list + row + actions]

Wave 2.1.1 (memories table)
  └─► 2.4.1.3.1 (memories list component) ──► 2.4.1.3.2 (delete action) ──► 2.4.1.3.3 (tests)

[2.4.1.1.x] and [2.4.1.3.x] can run in parallel once the page structure (2.4.1.1.1) is in place.
```

**Critical path:** page structure → entity row → Server Actions → end-to-end acceptance.

## Definition of Done

- [ ] `/memory` page loads and displays entity profiles for the authenticated user.
- [ ] Empty, loading, and error states rendered per UX Pass 5 design.
- [ ] Entity edit creates a superseding row; old row has `superseded_by` set; history visible in UI.
- [ ] Entity delete is soft (non-destructive); entity disappears from default list.
- [ ] Memories tab shows non-superseded memories; search filters client-side.
- [ ] Memory delete is soft; row removed from default view; "Show history" toggle reveals superseded rows.
- [ ] Page integrates into the existing two-pane layout (content + docked chat).
- [ ] WCAG 2.1 AA: keyboard navigation, visible focus, ARIA labels, AA contrast, `prefers-reduced-motion` respected.
- [ ] Coverage >80% on Server Actions and key components.
- [ ] `npm run typecheck` clean; lint passes.
- [ ] Unauthenticated requests to `/memory` redirect to `/login`.

## Infrastructure Specifications

### Database

No new tables required unless soft-delete via `deleted_at` column is chosen (migration adds `deleted_at timestamptz` to `entity_profiles` and `memories`). The `superseded_by` mechanism from Wave 2.1.1 is the primary soft-delete path; if `deleted_at` is added, a separate migration is needed.

Reads: `entity_profiles` (with join for supersession history), `memories`.
Writes: Server Actions update `superseded_by` on existing rows and insert new rows.

### API

**Server Actions** (in `apps/web/src/app/actions/memory.ts`):

| Action | Method | Auth | Input | Response |
|---|---|---|---|---|
| `editEntity` | Server Action | SSR session | `entityId: string, updates: Partial<EntityProfile>` | `{ success: true } \| { error: string }` |
| `deleteEntity` | Server Action | SSR session | `entityId: string` | `{ success: true } \| { error: string }` |
| `deleteMemory` | Server Action | SSR session | `memoryId: string` | `{ success: true } \| { error: string }` |

All Server Actions use `revalidatePath('/memory')` after writes. All validate input shapes before calling the DB.

### UI

**New pages/components:**

| Component | Type | Location |
|---|---|---|
| `memory/page.tsx` | Server Component (async) | `apps/web/src/app/memory/` |
| `memory/entities-list.tsx` | Server Component | `apps/web/src/app/memory/` |
| `memory/memories-list.tsx` | Client Component | `apps/web/src/app/memory/` |
| `components/memory/memory-entity-row.tsx` | Client Component | `apps/web/src/components/memory/` |

**Accessibility requirements (WCAG 2.1 AA):**
- Tab panel pattern: `role="tablist"`, `role="tab"` (`aria-selected`), `role="tabpanel"` (`aria-labelledby`).
- Edit/Delete buttons: descriptive `aria-label` including the entity name (e.g., "Edit Sarah").
- Search input: `<label htmlFor="memory-search">Search memories</label>`.
- History accordion: `aria-expanded` on the toggle button.
- Visible focus: `focus-visible` ring on all interactive elements.
- Reduced motion: no CSS transitions on the history accordion if `prefers-reduced-motion: reduce`.
- AA contrast ratios enforced in Tailwind color choices.

**State design (per UX Pass 5):**

| State | Entities | Memories |
|---|---|---|
| Empty | "I haven't learned about any people..." | "No memories saved yet..." |
| Loading | Skeleton rows | Skeleton rows |
| Success | Entity cards | Memory list |
| Error | Error banner + retry | Error banner + retry |

### Testing

- Unit/integration: Server Actions (`editEntity`, `deleteEntity`, `deleteMemory`) — Supabase mocked; auth, happy path, unauthenticated rejection.
- Component: `MemoryEntityRow` — renders fields; edit form submit; delete confirmation; history toggle.
- Component: `memories-list.tsx` — search filtering; show/hide superseded rows toggle.
- Accessibility: keyboard navigation through tabs and rows; ARIA attribute presence; verified manually or via `@testing-library/user-event`.
- Coverage: >80% on all new files.
- Typecheck: `npm run typecheck` exits 0.

### Deployment

No new environment variables. The `/memory` route is automatically included in the Next.js build; no Vercel configuration changes needed.

### Monitoring

- No new metrics for this wave. The page is read-heavy; any Server Action errors are surfaced inline and logged at `error` level.
- Optional: log `{ event: 'memory_page_view', entity_count, memory_count, user_id }` on page load for usage analytics.

## Handoff Requirements

Wave 2.5.1 (Sentinel — cache and extraction) may begin as soon as Waves 2.1.1–2.3.1 are complete; it does not depend on the UI wave. The UI wave (2.4.1) is the final MVP gate — when it is done, Epic 2a (Memory MVP) is complete.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Supersession history join causes slow page load with many entities | Low | Low | Limit history fetch to last 5 ancestors per entity; add index on `superseded_by` if needed |
| Edit form UX diverges from existing task form patterns | Low | Low | Reuse form structure from `task-form.tsx`; validate with UX review before merge |
| WCAG tab pattern keyboard behavior is complex | Medium | Low | Use a well-tested headless tab primitive (Radix Tabs or manual ARIA implementation per pattern) |
| Soft-delete via `superseded_by` doesn't have a clean "user deleted" signal | Low | Medium | Add a boolean `user_deleted` column or use a reserved tombstone UUID constant; documented in code |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.4 scope
- `docs/architecture/_main/05-User-Experience.md` — §"Memory" screen wireframe and Pass 5 states
- `docs/architecture/_main/05a-UX-Foundations.md` — Pass 3 (affordances), Pass 5 (states), Pass 6 (hard constraints)
- `docs/architecture/_main/03-Business-Requirements.md` — UC-12, UC-13
- `apps/web/src/components/tasks/task-form.tsx` — existing form pattern to follow
- `apps/web/src/app/actions/` — existing Server Action pattern
