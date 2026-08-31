---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "3"
feature: "3.3"
wave: "3.3.1"
agents: []
tags: [coriven, constraints, ui, ux, registry, accessibility, wcag]
relateddocuments:
  - "docs/implementation/_main/epic-3-behavioral-constraint-layer.md"
  - "docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md"
  - "docs/implementation/iterations/wave-3.2.1-pre-action-engine-gate.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 3.3.1: Constraint Registry UI

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 3.3.1 |
| Feature | 3.3 — Constraint Registry UI |
| Epic | 3 — Behavioral-Constraint Layer |
| Status | Planning |
| Scope | A `/constraints` page where the owner can author, view, and lock behavioral constraints; includes a required rationale field, a lock indicator, scope tagging, and removal; follows existing two-pane shell and WCAG AA accessibility target |
| Wave Goal | Give the owner a transparent, direct-manipulation surface to manage their constraint registry — making the constraint system visible and correctable in the same spirit as the `/memory` page for factual memories |

**Wave Philosophy.** Visible constraints build trust: the owner must be able to see every rule in effect, understand why it exists (rationale), know whether it is locked, and remove it — with the same progressive-disclosure and accessibility standards as the rest of Coriven's UI.

---

## Wave Goals

1. The `/constraints` page is reachable from the primary navigation and renders the full list of the user's behavioral constraints, each displaying rule, rationale, scope, and locked status — matching the UX principle of "visible, correctable memory."
2. A user can author a new constraint from the UI form (rule + required rationale + optional scope + lock toggle) and the constraint is stored immediately, confirmed inline, and visible in the list without a full page reload.
3. The page is keyboard-navigable and screen-reader-accessible to WCAG 2.1 AA: focus-visible on all interactive elements, ARIA labels on form controls and status indicators, and no motion that violates `prefers-reduced-motion`.

---

## User Stories

### Story 3.3.1.1 — View the constraint registry

**As the owner, I want to see all my behavioral constraints on a dedicated page, so that I have full visibility into the rules Coriven is enforcing and can verify that "never modify MealPrepForge code" is actually stored and locked.**

**Acceptance Criteria:**
- A `/constraints` page exists and is linked from the primary navigation (under "Settings" or as a first-class navigation item, consistent with `05-UX-Foundations.md` §Pass 2 grouping under "What it knows").
- Each constraint row displays: the rule text, rationale, scope, and a locked/unlocked indicator.
- The locked indicator is visually distinct (e.g., a lock icon with an `aria-label`) so the user knows at a glance which constraints are hard stops.
- An empty state renders when the user has no constraints: text such as "No constraints yet — add one below or ask in chat" with an action affordance.
- The page renders only the authenticated user's constraints; unauthenticated requests redirect to `/login`.
- The page is a React Server Component (or uses a Server Action to fetch) — no client-side fetch call that could expose another user's data.
- Loading state uses a skeleton list consistent with other list pages (Tasks, Memory).

**Priority:** High
**Estimated Hours:** 8h
**Requirements Reference:** Business Requirements UC-15; transparency principle; UX §Information Architecture (Constraints page)

#### Task 3.3.1.1.1 — Constraint list Server Component and data fetch

| Field | Value |
|---|---|
| Parent Story | 3.3.1.1 |
| Agent | frontend |
| Estimation | 4h |
| Dependencies | Wave 3.1.1 complete (table + types exist) |
| Deliverables | `apps/web/src/app/constraints/page.tsx`; Server Action or direct Supabase read via `auth-server.ts` client |

**Acceptance Criteria:**
- `page.tsx` is a React Server Component that reads `behavioral_constraints` for the authenticated user using the `auth-server.ts` Supabase client (not the service-role client — RLS enforces user isolation at the query level for UI reads).
- Unauthenticated users are redirected to `/login` (consistent with existing middleware behavior).
- Data is typed against the generated Supabase types; no `any`.
- The page exports default and renders `<ConstraintList constraints={data} />` plus `<ConstraintForm />`.
- Skeleton loading state displayed while data loads (Suspense boundary).
- Empty-state message rendered when `data.length === 0`.

#### Task 3.3.1.1.2 — `ConstraintCard` component

| Field | Value |
|---|---|
| Parent Story | 3.3.1.1 |
| Agent | frontend |
| Estimation | 4h |
| Dependencies | Task 3.3.1.1.1 |
| Deliverables | `apps/web/src/components/constraints/constraint-card.tsx` |

**Acceptance Criteria:**
- `ConstraintCard` accepts a `BehavioralConstraint` prop and renders: rule (bold), rationale (muted), scope badge, locked indicator (lock icon when `is_locked = true`; `aria-label="Locked constraint"` / `aria-label="Unlocked constraint"`).
- A "Remove" action button is present on each card; it opens a confirmation before calling the delete Server Action.
- A "Lock / Unlock" toggle button is present when the constraint is not yet locked; once locked, the toggle is hidden (locking is one-way from the UI, consistent with `is_locked` semantics).
- All interactive elements are keyboard-focusable with visible focus rings.
- Component is typed against `BehavioralConstraint` from `@personal-assistant/types`; no `any`.
- Tailwind CSS 4 styling; no component library import required.

---

### Story 3.3.1.2 — Author a constraint from the UI

**As the owner, I want an "Add Constraint" form on the constraints page with a required rationale field, so that I can author rules directly without going through chat — and so the system enforces that I always state why.**

**Acceptance Criteria:**
- A form on the `/constraints` page includes: a "Rule" text input (required), a "Rationale" text area (required — the form prevents submission when empty and shows an inline error), an optional "Scope" text input (defaults to `all`), and a "Lock this constraint" checkbox (defaults to unchecked).
- Submitting the form calls a Server Action that inserts a row into `behavioral_constraints` using the `auth-server.ts` client (user_id from session, not from form input).
- On success, the new constraint appears in the list without a full page reload (optimistic insert or revalidation via `revalidatePath`).
- On failure, an inline error message is shown (e.g., "Failed to save constraint — try again").
- The form is keyboard-navigable: Tab cycles through fields; Enter submits; Escape closes a modal variant if used.
- The "Rationale" label includes helper text explaining its purpose: "Explain why this rule exists — this helps Coriven understand the constraint more deeply."
- All form controls have accessible labels (`htmlFor` / `aria-labelledby`); required fields are marked with `aria-required="true"`.
- WCAG AA contrast on all form elements and labels.

**Priority:** High
**Estimated Hours:** 10h
**Requirements Reference:** Business Requirements UC-15; UX §Pass 3 affordances ("Add constraint" affordance with required rationale)

#### Task 3.3.1.2.1 — `ConstraintForm` component

| Field | Value |
|---|---|
| Parent Story | 3.3.1.2 |
| Agent | frontend |
| Estimation | 5h |
| Dependencies | Task 3.3.1.1.1 (page exists; Server Action target confirmed) |
| Deliverables | `apps/web/src/components/constraints/constraint-form.tsx` |

**Acceptance Criteria:**
- Client component (`"use client"`) with controlled inputs for `rule`, `rationale`, `scope`, and `is_locked`.
- `rationale` empty → submission blocked; inline error "Rationale is required" displayed adjacent to the field; `aria-describedby` wired to the error element.
- Form calls `addConstraintAction` Server Action on submit; shows a loading indicator while pending; disables the submit button during submission.
- On success, calls a prop callback (`onAdded`) to trigger list refresh / optimistic update; resets all fields.
- `prefers-reduced-motion` respected: any transition/animation on the success state is gated on the media query.
- No `any` types; TypeScript strict mode.

#### Task 3.3.1.2.2 — `addConstraintAction` and `removeConstraintAction` Server Actions

| Field | Value |
|---|---|
| Parent Story | 3.3.1.2 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Wave 3.1.1 (table live); Task 3.3.1.2.1 (form calls the action) |
| Deliverables | `apps/web/src/app/actions/constraints.ts` |

**Acceptance Criteria:**
- `addConstraintAction(formData: FormData): Promise<{ success: boolean; error?: string }>` — extracts `rule`, `rationale`, `scope`, `is_locked` from `formData`; validates that `rule` and `rationale` are non-empty strings; inserts into `behavioral_constraints` using the `auth-server.ts` client (session-derived `user_id`); calls `revalidatePath('/constraints')`.
- `removeConstraintAction(id: string): Promise<{ success: boolean; error?: string }>` — deletes the row where `id = $id AND user_id = session.user.id`; calls `revalidatePath('/constraints')`.
- `lockConstraintAction(id: string): Promise<{ success: boolean; error?: string }>` — updates `is_locked = true` for the row; once locked, cannot be unlocked via this action (one-way).
- All actions verify the session before any DB operation; unauthenticated calls return `{ success: false, error: "Unauthorized" }`.
- All actions log structured events on success and failure: `{ event: "constraint_ui_add" | "constraint_ui_remove" | "constraint_ui_lock", userId, constraintId? }`.
- No `user_id` or `id` accepted from client input — always derived from session or provided as a verifiable UUID.

---

### Story 3.3.1.3 — Constraint page navigation and accessibility

**As any user navigating Coriven with a keyboard only, I want the constraints page to be fully keyboard-accessible and ARIA-labeled so I can author, view, and remove constraints without a mouse.**

**Acceptance Criteria:**
- All interactive elements (form fields, submit button, remove button, lock button, navigation links) are reachable via Tab in logical order.
- Visible focus rings on all focusable elements (consistent with the rest of the UI).
- Constraint list uses a semantic list element (`<ul>` / `<li>`); form uses a `<form>` element.
- Lock indicator uses an icon with `aria-label` (not image-only).
- Success and error feedback regions use `aria-live="polite"` so screen readers announce changes without interrupting.
- Page title (`<h1>`) is "Constraints"; navigation landmark is `<main>`.
- Passes a manual keyboard-navigation check and a screen-reader announcement check before wave sign-off.

**Priority:** High
**Estimated Hours:** 4h
**Requirements Reference:** Architecture §Quality Attributes (WCAG 2.1 AA); UX §Accessibility Design; UX §Pass 6 hard UX constraints (#7)

#### Task 3.3.1.3.1 — Accessibility audit and fixes

| Field | Value |
|---|---|
| Parent Story | 3.3.1.3 |
| Agent | frontend |
| Estimation | 4h |
| Dependencies | Tasks 3.3.1.1.2, 3.3.1.2.1 (components built) |
| Deliverables | Accessibility fixes applied across constraint components; accessibility checklist in PR description |

**Acceptance Criteria:**
- `aria-live="polite"` region wraps the constraint list or a status area for insert/remove confirmations.
- All icon-only elements have descriptive `aria-label` attributes.
- Tab order is logical: page title → add form (rule → rationale → scope → lock checkbox → submit) → constraint list items (rule/lock/remove per item).
- `prefers-reduced-motion` media query gates any CSS transitions on the list or form.
- No axe-core automated violations on the page (run as part of test suite or as a documented manual step).

---

### Story 3.3.1.4 — Navigation link for Constraints page

**As the owner, I want the Constraints page to appear in the sidebar navigation under "What it knows" (alongside Memory), so I can reach it without typing a URL.**

**Acceptance Criteria:**
- A "Constraints" link is added to the existing sidebar navigation component, grouped near "Memory" consistent with the `05a-UX-Foundations.md` §Pass 2 IA grouping.
- The link uses the `/constraints` route; active state is visually distinguished when on that page.
- The navigation link is keyboard-reachable and has a descriptive label.

**Priority:** Medium
**Estimated Hours:** 2h
**Requirements Reference:** UX §Information Architecture (Constraints in site map under "What it knows")

#### Task 3.3.1.4.1 — Add navigation entry

| Field | Value |
|---|---|
| Parent Story | 3.3.1.4 |
| Agent | frontend |
| Estimation | 2h |
| Dependencies | Task 3.3.1.1.1 (page exists at route) |
| Deliverables | Updated sidebar navigation component |

**Acceptance Criteria:**
- Navigation item added adjacent to Memory link; correct active-state highlight when route matches `/constraints`.
- No visual regression on other navigation items; existing routes unaffected.
- Keyboard-accessible; `aria-current="page"` applied when active.

---

## Task Dependencies

```
Wave 3.1.1 (table + types)
Wave 3.2.1 (gate operational — not a code dep but gate must work so UI changes are demonstrable)
      │
      ├── Task 3.3.1.1.1 (page + data fetch)
      │         │
      │         ├── Task 3.3.1.1.2 (ConstraintCard)
      │         │         │
      │         │         └── Task 3.3.1.3.1 (accessibility audit)
      │         │
      │         └── Task 3.3.1.2.1 (ConstraintForm)
      │                   │
      │                   └── Task 3.3.1.2.2 (Server Actions)
      │
      └── Task 3.3.1.4.1 (navigation entry — can run in parallel with components)
```

**Critical path:** Wave 3.1.1 → page + data fetch → components → accessibility.
**Parallelizable:** `ConstraintCard` and `ConstraintForm` can be built concurrently once the page scaffold exists; navigation entry is independent.

---

## Definition of Done

- [ ] `/constraints` page renders the authenticated user's constraint list; empty state shown when none exist.
- [ ] Each constraint card displays rule, rationale, scope, and locked indicator.
- [ ] "Add Constraint" form requires both rule and rationale; submission without rationale shows an inline error and blocks the insert.
- [ ] Submitting the form inserts a row and the list updates without a full page reload.
- [ ] "Remove" button on each card deletes the constraint after confirmation.
- [ ] "Lock" action on a card sets `is_locked = true`; locked cards cannot be unlocked from the UI.
- [ ] Unauthenticated requests redirect to `/login`.
- [ ] Server Actions extract `user_id` from session only — not from client input.
- [ ] Page is keyboard-navigable end-to-end; all interactive elements have visible focus rings.
- [ ] `aria-live` region announces insert/remove outcomes.
- [ ] `prefers-reduced-motion` respected.
- [ ] No axe-core automated violations.
- [ ] Constraints link in sidebar navigation; active state correct.
- [ ] `npm run typecheck` passes; no new `any` types.

---

## Infrastructure Specifications

### Database

No new tables. Reads and writes to `behavioral_constraints` (Wave 3.1.1). UI reads use the `auth-server.ts` client (RLS-enforced per user). Server Actions use the `auth-server.ts` client for the same reason — service-role is not needed for user-owned operations.

### API

Server Actions in `apps/web/src/app/actions/constraints.ts`:
- `addConstraintAction(formData: FormData)` — insert
- `removeConstraintAction(id: string)` — delete
- `lockConstraintAction(id: string)` — update `is_locked = true`

No new HTTP API routes required. The constraint page reads data in the Server Component render, consistent with the existing Tasks and Settings pages.

### UI

**Page route:** `apps/web/src/app/constraints/page.tsx`

**Components:**

| Component | Path | Type |
|---|---|---|
| `ConstraintList` | `components/constraints/constraint-list.tsx` | Server component (receives data as props) |
| `ConstraintCard` | `components/constraints/constraint-card.tsx` | Client component (interactive actions) |
| `ConstraintForm` | `components/constraints/constraint-form.tsx` | Client component (form state) |

**Props contract (illustrative):**

```typescript
interface ConstraintCardProps {
  constraint: BehavioralConstraint
  onRemove: (id: string) => void
  onLock: (id: string) => void
}

interface ConstraintFormProps {
  onAdded: () => void
}
```

**Accessibility requirements:**
- WCAG 2.1 AA contrast on all text and interactive elements.
- `aria-live="polite"` status region for insert/remove feedback.
- `aria-required="true"` on rule and rationale fields.
- Lock icon with `aria-label` (`"Locked"` / `"Unlocked"`).
- Keyboard: Tab → focus order as described; Enter submits form; Escape can clear form or dismiss confirmation.

**Empty state text:** "No constraints yet. Add one below or ask Coriven in chat to set a rule for you."

**Lock semantics (UX):** Once a constraint is locked, the lock icon is rendered in a visually distinct locked state and the "Lock" button is hidden. A tooltip or helper text explains "Locked constraints cannot be unlocked from here — remove and re-add to change." This is honest about the one-way semantics.

### Testing

- **Component tests:** `ConstraintCard` renders rule/rationale/scope/lock indicator; remove button triggers callback; lock button triggers callback and is hidden when already locked.
- **Form tests:** submitting without rationale shows error and does not call Server Action; submitting with valid data calls action and resets fields.
- **Server Action tests:** `addConstraintAction` with missing rationale returns `{ success: false }`; with valid data inserts and revalidates path; unauthenticated call returns `{ success: false, error: "Unauthorized" }`.
- **Accessibility test:** no axe-core violations on the rendered page.
- **Coverage target:** 80% on component files; 85% on Server Action handlers.

### Monitoring

- `{ event: "constraint_ui_add", userId }` — on successful add from UI.
- `{ event: "constraint_ui_remove", userId, constraintId }` — on successful remove.
- `{ event: "constraint_ui_lock", userId, constraintId }` — on successful lock.
- Page-level error events logged if Server Action throws unexpectedly.

---

## Handoff Requirements

This wave is self-contained for the UI. It hands off to:
- **End-to-end usage:** With Wave 3.1.1 (store), Wave 3.2.1 (gate), and Wave 3.3.1 (UI) all complete, the full behavioral-constraint feature is demonstrable: author a constraint via UI → gate blocks the matching tool call in chat → owner sees the block in the chat pane.
- **Wave 3.4.1** (optional post-generation detection): the UI surface exists; a future "Violation Flags" section could be added to the constraints page.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| One-way lock semantics surprise the user | Medium — user locks a constraint by accident | Medium | Tooltip explaining lock semantics; confirmation dialog before locking; remove-and-re-add as the documented escape hatch |
| Rationale field friction for users who want quick constraints | Low | Low | Helper text explains the value; the requirement is a feature, not a bug — enforced at both the DB and form levels |
| Server Action `user_id` extraction from session fails on edge cases | Medium — could reject valid inserts | Low | Consistent with existing Server Actions (tasks); tested with auth mocked |
| Tailwind CSS 4 token decisions not finalized | Low — visual polish deferred | Medium | ASCII wireframe is directional; functional components ship first; visual refinement follows with design skills |
| Accessibility gaps discovered late | Medium | Low | Axe-core check in test suite; accessibility task is a first-class story in this wave, not a post-launch afterthought |

---

## Related Documentation

- `docs/implementation/_main/epic-3-behavioral-constraint-layer.md` — Feature 3.3 definition
- `docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md` — data foundation
- `docs/implementation/iterations/wave-3.2.1-pre-action-engine-gate.md` — gate (the enforcement this UI makes visible)
- `docs/architecture/_main/05-User-Experience.md` — Constraints screen in site map; §Component Library; §Accessibility
- `docs/architecture/_main/05a-UX-Foundations.md` — §Pass 2 IA grouping; §Pass 3 "Add constraint" affordance; §Pass 6 hard UX constraints
- `docs/architecture/_main/03-Business-Requirements.md` — UC-15; transparency principle
