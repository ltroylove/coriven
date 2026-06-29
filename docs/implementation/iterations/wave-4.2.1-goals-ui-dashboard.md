---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "4"
feature: "4.2"
wave: "4.2.1"
agents: []
tags: [coriven, goals, ui, dashboard, goal-card, life-areas, momentum, projects]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Wave 4.2.1: Goals UI — Life-OS Dashboard

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 4.2.1 |
| Feature | 4.2 — Goals UI (Life-OS Dashboard) |
| Epic | 4 — Goal-Driven Organization |
| Status | Planning |
| Scope | `/goals` dashboard (life areas as columns, `GoalCard` with momentum badge), `/goals/[id]` goal detail, `/projects/[id]` project detail; server components + accessible layout; ≤3 decisions/screen |
| Wave Goal | Deliver the "organize by why" view — a glanceable dashboard where momentum state, linked task counts, and goal intent are visible at a glance, matching the UX wireframes and Pass 4 cognitive-load budget |

**Wave Philosophy.** Visible before interactive — the dashboard renders useful data for a read-only visitor before a single button is clicked; interactivity layers on top without adding cognitive overhead.

---

## Wave Goals

1. **Goal-first navigation** — `/goals` is accessible from the primary nav alongside Tasks and Chat, satisfying the UX Pass 2 IA requirement that Goals is a top-level, always-reachable destination.
2. **Momentum at a glance** — each `GoalCard` surfaces `improving / stable / declining` with a visual badge; a user can assess goal health within 3 seconds of landing on the page (UX §Goals screen wireframe).
3. **Progressive detail** — clicking a GoalCard opens `/goals/[id]` (why, metrics, linked tasks/projects, confidence, status controls); clicking a project opens `/projects/[id]`; neither screen exceeds 3 primary decisions (UX Foundations Pass 4).

---

## User Stories

### Story 4.2.1.1 — Goals Dashboard (`/goals`)

**As** the owner,
**I want** a `/goals` page that organizes my goals by life area in a column layout with momentum badges,
**so that** I can see whether my goals are progressing at a glance without navigating into each one.

**Acceptance Criteria:**

- `/goals` renders life areas as columns (horizontal scroll on narrow viewports); goals appear as `GoalCard` components within their life area column.
- Goals without a life area appear in an "Uncategorized" column.
- Each `GoalCard` displays: title, momentum badge (`improving / stable / declining`), linked task count, and a truncated `why_it_matters` snippet (max 2 lines).
- If `momentum` has not yet been computed (first run before nightly job), the badge shows "calculating" — never blank, never errors.
- An empty life area column shows an "Add a goal" affordance.
- The page uses a Next.js server component; data is fetched server-side via the Supabase auth-server client.
- Page load is skeleton-first; hydration completes before the user can interact (no layout shift).
- The page is keyboard-navigable: each GoalCard is focusable; Enter/Space opens the detail page.
- WCAG AA: momentum badge color contrast passes; focus ring visible.
- Pass 4 cognitive-load constraint: no required decisions on the dashboard itself (read-first; "Add goal" is optional).

**Priority:** High
**Estimated Hours:** 8h
**References:** Business Requirements Feature 1; UX §Goals screen; UX Foundations Pass 2 (IA), Pass 4 (cognitive load); UC-6.

#### Task 4.2.1.1.1 — Goals Dashboard Page and Data Fetching

**Parent Story:** 4.2.1.1
**Agent:** Frontend
**Estimation:** 6h
**Dependencies:** Wave 4.1.1 complete (tables and tools exist); Supabase auth-server client available (built, Phase 1).
**Deliverables:** `apps/web/src/app/goals/page.tsx`; `apps/web/src/app/goals/loading.tsx`; server-side data-fetch logic.
**Acceptance Criteria:**
- Uses `createServerClient` (the auth-aware server variant) to query `life_areas`, `goals` (with `project_count`), and authenticated user's session.
- Redirect unauthenticated users to `/` (consistent with existing middleware behavior).
- Data shape is typed against `apps/web/src/types/supabase.ts` (generated from the Wave 4.1.1 migration).
- `loading.tsx` renders a skeleton layout matching the column structure.
- No `"use client"` directive on the page component itself; only child interactive components are client-side.

#### Task 4.2.1.1.2 — `GoalCard` Component

**Parent Story:** 4.2.1.1
**Agent:** Frontend
**Estimation:** 4h
**Dependencies:** Task 4.2.1.1.1 (data shape defined).
**Deliverables:** `apps/web/src/components/goals/goal-card.tsx`.
**Acceptance Criteria:**
- Accepts `GoalCardProps` interface: `{ id: string; title: string; whyItMatters?: string; momentum: 'improving' | 'stable' | 'declining' | null; linkedTaskCount: number; onOpen: () => void }`.
- Momentum badge uses a visually distinct color per state; each state passes WCAG AA contrast against the card background.
- When `momentum` is `null`, displays "calculating" in place of a badge.
- `linkedTaskCount` displays as "N tasks" with a tasks icon.
- `whyItMatters` is clamped to 2 lines via CSS (`line-clamp-2`); full text visible on detail page.
- Card is an accessible button or anchor: `role="button"` or wrapping `<a>`; `aria-label` includes title and momentum state.
- `prefers-reduced-motion`: transition animations are skipped when the media query matches.
- Receives `onOpen` for navigation to keep the component pure; routing handled in the parent page.

---

### Story 4.2.1.2 — Goal Detail Page (`/goals/[id]`)

**As** the owner,
**I want** a goal detail page showing why I set this goal, its success metrics, linked projects, linked tasks, confidence, and status,
**so that** I can understand and manage a goal without relying on the chat interface.

**Acceptance Criteria:**

- `/goals/[id]` renders: goal title, `why_it_matters`, `success_metrics`, `status` (as a select or badge), `confidence` (as a badge), momentum badge, `last_activity_at`, linked projects list, and linked tasks list.
- Linked tasks show title, status, and priority.
- "Edit" inline controls allow updating `status` and `confidence` via a Server Action (no full-page reload).
- The page shows a 404-style error if the goal does not exist or belongs to a different user (RLS blocks the query; the page handles the null case gracefully).
- The docked chat pane is co-present (inherits from the shell layout), consistent with UX Pass 2 (chat always one message away).
- ≤3 primary decisions on the page: Edit status, Edit confidence, and navigate to a project (Pass 4 constraint).
- Keyboard-navigable; all controls labeled; focus returns to the trigger after a modal or inline edit closes.

**Priority:** High
**Estimated Hours:** 7h
**References:** Business Requirements Feature 1; UX §Goals screen; UX Foundations Pass 4; UC-6, UC-7.

#### Task 4.2.1.2.1 — Goal Detail Page, Data, and Inline Edit

**Parent Story:** 4.2.1.2
**Agent:** Frontend/Backend
**Estimation:** 7h
**Dependencies:** Task 4.2.1.1.1 (auth-server client pattern); Wave 4.1.1 (goals and projects tables).
**Deliverables:** `apps/web/src/app/goals/[id]/page.tsx`; `apps/web/src/app/actions/goals.ts` (Server Actions for `updateGoalStatus`, `updateGoalConfidence`).
**Acceptance Criteria:**
- Page fetches goal by `id` with `eq('user_id', userId)` — RLS is defence-in-depth; the explicit filter is the first line of defence.
- Server Action `updateGoalStatus(id, status)` updates `goals.status`; `updateGoalConfidence(id, confidence)` updates `goals.confidence`; both revalidate the page path on success.
- Status and confidence controls are `<select>` elements or segmented controls; accessible with keyboard.
- Linked projects are rendered as links to `/projects/[id]`.
- Loading state uses `Suspense` boundaries around the task and project lists.
- `npm run typecheck` passes; no `any` casts.

---

### Story 4.2.1.3 — Project Detail Page (`/projects/[id]`)

**As** the owner,
**I want** a project detail page showing the project's parent goal, tasks, description, and status,
**so that** I can see execution-level work in context of the goal it serves.

**Acceptance Criteria:**

- `/projects/[id]` renders: project title, description, status badge, link to parent goal, linked tasks list (title, status, priority).
- An "Edit" control allows updating `status` inline via a Server Action.
- Returns a graceful 404 if the project does not exist or belongs to a different user.
- ≤3 primary decisions: Edit status, open a task, navigate to parent goal (Pass 4 constraint).
- Keyboard-navigable; WCAG AA.

**Priority:** Medium
**Estimated Hours:** 5h
**References:** Business Requirements Feature 1; UX §Goals screen; UC-7.

#### Task 4.2.1.3.1 — Project Detail Page and Server Action

**Parent Story:** 4.2.1.3
**Agent:** Frontend/Backend
**Estimation:** 5h
**Dependencies:** Task 4.2.1.2.1 (Server Action pattern established in `apps/web/src/app/actions/goals.ts`).
**Deliverables:** `apps/web/src/app/projects/[id]/page.tsx`; `updateProjectStatus` Server Action added to `apps/web/src/app/actions/goals.ts`.
**Acceptance Criteria:**
- Fetches project with `eq('user_id', userId)`; joins tasks with `goal_id = project.goal_id` or `project_id = project.id`.
- Parent goal link uses `goals.title` and routes to `/goals/[goal_id]`.
- `updateProjectStatus` revalidates `/projects/[id]` on success.
- Empty tasks list shows "No tasks yet — add one via chat or the Tasks page."
- `npm run typecheck` passes.

---

### Story 4.2.1.4 — Navigation Integration

**As** the owner,
**I want** Goals to appear in the primary left-nav alongside Tasks and Chat,
**so that** it is always one click away, consistent with the UX Pass 2 IA.

**Acceptance Criteria:**

- Primary nav includes a "Goals" link to `/goals`; it is visually active when the user is on any `/goals/*` or `/projects/*` route.
- Nav order follows the UX Pass 2 hierarchy: Today (future) · Chat · Tasks · Goals · Memory (future) · Settings.
- Goals link is keyboard-focusable with a visible focus ring; `aria-current="page"` is set when active.
- No existing nav link is removed or reordered.

**Priority:** Medium
**Estimated Hours:** 2h
**References:** UX §Site Map; UX Foundations Pass 2.

#### Task 4.2.1.4.1 — Add Goals to Primary Nav

**Parent Story:** 4.2.1.4
**Agent:** Frontend
**Estimation:** 2h
**Dependencies:** `apps/web/src/app/goals/page.tsx` must exist (Task 4.2.1.1.1).
**Deliverables:** Updated nav component (wherever the primary nav is defined, e.g., `apps/web/src/components/layout/nav.tsx` or equivalent).
**Acceptance Criteria:**
- Uses `usePathname()` to determine active state; matches `/goals` and `/goals/**` and `/projects/**`.
- `aria-current="page"` applied to the active link.
- No visual regression on existing nav items (Tasks, Chat, Settings).

---

## Task Dependencies

```
Task 4.2.1.1.1  (goals page + data fetching)
    ├──► Task 4.2.1.1.2  (GoalCard component)
    └──► Task 4.2.1.2.1  (goal detail page + Server Actions)
              └──► Task 4.2.1.3.1  (project detail page + Server Action)

Task 4.2.1.1.1  ──► Task 4.2.1.4.1  (nav — page must exist first)
```

**Critical path:** data fetching → GoalCard → goal detail → project detail.
**Parallelizable:** Task 4.2.1.1.2 (GoalCard) can begin as soon as the data shape from Task 4.2.1.1.1 is drafted; Task 4.2.1.4.1 can begin once the goals page route exists.
**Prerequisite:** Wave 4.1.1 must be fully deployed before any UI tasks start (tables must exist in the target environment).

---

## Definition of Done

- [ ] Navigating to `/goals` (authenticated) displays life area columns with `GoalCard` components; the dashboard is useful without any interaction.
- [ ] A goal created via chat (Wave 4.1.1 tools) appears on the dashboard after page refresh.
- [ ] A GoalCard with `momentum = 'improving'` shows the correct green badge; `'declining'` shows a warning badge; `null` shows "calculating".
- [ ] Clicking a GoalCard navigates to `/goals/[id]` and shows `why_it_matters` and linked tasks.
- [ ] Updating goal status on the detail page reflects immediately without a full reload.
- [ ] Navigating to `/projects/[id]` shows the parent goal link and task list.
- [ ] All pages pass axe or equivalent accessibility audit at WCAG AA (contrast, labels, focus).
- [ ] `npm run typecheck` passes; `npm run dev` starts without errors.
- [ ] Visiting `/goals/non-existent-id` returns a graceful 404 message, not an unhandled error.
- [ ] Goals nav link is active on all `/goals/*` and `/projects/*` routes.

---

## Infrastructure Specifications

### Database

No schema changes in this wave. Reads against tables created in Wave 4.1.1. Queries use the auth-server Supabase client pattern; RLS enforces isolation.

Key queries:
- `/goals` page: `supabase.from('life_areas').select('*, goals(*, projects(count))').eq('user_id', userId)`.
- `/goals/[id]` page: `supabase.from('goals').select('*, projects(*), tasks(id, title, status, priority)').eq('id', id).eq('user_id', userId).single()`.
- `/projects/[id]` page: `supabase.from('projects').select('*, goals(id, title), tasks(*)').eq('id', id).eq('user_id', userId).single()`.

### API

No new API routes. Server Actions in `apps/web/src/app/actions/goals.ts`:
- `updateGoalStatus(id: string, status: GoalStatus): Promise<void>` — updates `goals.status`, calls `revalidatePath('/goals/[id]')`.
- `updateGoalConfidence(id: string, confidence: GoalConfidence): Promise<void>` — updates `goals.confidence`, calls `revalidatePath('/goals/[id]')`.
- `updateProjectStatus(id: string, status: TaskStatus): Promise<void>` — updates `projects.status`, calls `revalidatePath('/projects/[id]')`.
- All Server Actions validate that the record's `user_id` matches the session user before mutating; return descriptive errors on failure.

### UI

**`GoalCardProps` (canonical interface for this wave):**
```typescript
interface GoalCardProps {
  id: string;
  title: string;
  whyItMatters?: string;
  momentum: 'improving' | 'stable' | 'declining' | null;
  linkedTaskCount: number;
  onOpen: () => void;
}
```

**Momentum badge color mapping (Tailwind 4 classes, subject to design token finalization):**
- `improving` — green background/text; passes AA contrast.
- `stable` — neutral/gray.
- `declining` — amber/warning.
- `null` — muted gray, text "calculating".

**Screen states (UX Pass 5):**
- Empty state (`life_areas` exists but no goals): "Set your first goal — what matters?" with a chat affordance.
- Loading: skeleton cards in each column.
- Error: "Couldn't load goals — Retry" inline banner; no full-page crash.

**Responsive layout:**
- Desktop (>1024px): columns side-by-side, max 4 visible, horizontal scroll for more.
- Mobile (<768px): vertical stack of life area sections; GoalCards full-width.

**Accessibility:**
- GoalCard: `role="button"`, `tabIndex={0}`, `onKeyDown` for Enter/Space.
- Momentum badge: includes text (not icon-only) so screen readers convey the state.
- All interactive controls: visible focus ring; WCAG AA contrast.
- `aria-live="polite"` on the inline edit confirmation message.

### Testing

- **Unit:** `GoalCard` renders all four momentum states correctly; snapshot tested.
- **Unit:** Server Actions `updateGoalStatus` and `updateGoalConfidence` called with valid and invalid IDs; assert correct Supabase calls and error returns.
- **Integration:** `/goals` page renders life areas and goals fetched from a seeded test database.
- **Accessibility:** axe automated audit on `/goals`, `/goals/[id]`, `/projects/[id]`; zero critical violations.
- **E2E (Playwright):** authenticated user visits `/goals` → clicks a GoalCard → lands on detail page → updates status → sees confirmation; no type errors during the flow.
- **Coverage:** component logic ≥ 80% line coverage.

### Deployment

Standard Vercel auto-deploy from `main`. No new environment variables. Wave 4.1.1 migration must be applied to the production Supabase project before this wave's code is promoted.

### Monitoring

- Log server-side data fetch errors with user ID (no PII in log content) for goals and project pages.
- Track 404 rate on `/goals/[id]` and `/projects/[id]` — high rate may indicate broken navigation links.

---

## Handoff Requirements

- Wave 4.3.1 (Momentum Job) writes `goals.momentum`; the `GoalCard` badge will automatically reflect updated values after the nightly job runs, with no UI change required.
- Wave 4.4.1 (Briefing) links to `/goals` from the Today/Briefing page; the routes must be stable.
- Epic 6 (Proactive) will add a "Stale goals" section to `/goals`; the column layout should accommodate an additional column without visual regression.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| `GoalCard` momentum badge color fails AA contrast with chosen Tailwind tokens | Medium | Medium | Require contrast ratio check (axe) in the acceptance test before merge |
| `/goals` page slow on first load if life areas have many goals | Low | Low | Limit initial fetch to 50 goals across all areas; add a "show more" affordance |
| Inline edit Server Actions cause stale UI if `revalidatePath` is not configured correctly | Medium | Low | Include `revalidatePath` call in both the success and error branches; add an E2E test |
| Wave 4.1.1 not deployed before Wave 4.2.1 — tables missing at runtime | High | Low | Gate the Wave 4.2.1 deployment on confirmed Wave 4.1.1 migration status |

---

## Related Documentation

- UX §Goals screen wireframe (ASCII): column layout with GoalCard momentum badges.
- UX Foundations Pass 2 (IA): Goals is a primary nav item.
- UX Foundations Pass 4 (cognitive load): ≤3 decisions/screen; dashboard is read-first.
- UX Foundations Pass 5 (state design): Goals empty/loading/error states.
- Business Requirements Feature 1: goal hierarchy and momentum acceptance criteria.
- Architecture §Frontend: Next.js 15 App Router; server components; 4 Supabase client variants.
