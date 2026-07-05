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
epic: "7"
feature: "8.4"
wave: "8.4.1"
agents: []
tags: [coriven, onboarding, wizard, first-run, goals, tasks, ux-pass-6]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 8.4.1: Onboarding Wizard

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.4.1 |
| Feature | 7.4 — Onboarding Wizard |
| Epic | 7 — Productization |
| Status | Planning |
| Scope | A 4-step wizard for first-time users that ends with the creation of a first goal and a first task — reusing existing goal/task forms, introducing no new data models, and landing the user on Today/Chat. |
| Wave Goal | A new Coriven user completes the onboarding wizard without reading any documentation, exits with one goal and one task in their account, and lands on Today/Chat ready to use the product. |

**Wave Philosophy:** Scope-based — this wave closes when the wizard end-to-end flow is tested and a new account exits with a persisted goal and task; no schedule.

## Wave Goals

1. A first-time user completing sign-in is automatically routed to the onboarding wizard (not the Tasks page) and can complete all 4 steps in under 5 minutes with zero documentation — satisfying the "zero-doc first-run" requirement from UX Foundations Pass 6 and Business Requirements UC-19.
2. Step 4 of the wizard calls the existing goal-creation and task-creation Server Actions (or API routes), so the wizard produces real data and no parallel creation path is introduced — keeping the codebase coherent.
3. The wizard can be skipped at any step (with a confirming "Skip setup" link) and resumed only on the next login if not completed; once completed it never shows again — the detection uses a `onboarding_completed_at` column on `profiles`.

## User Stories

---

### Story 7.4.1.1 — Onboarding State Detection and Routing

**As the** application,
**I want** to detect whether a newly authenticated user has completed onboarding,
**So that** first-time users are routed to the wizard and returning users are routed to Today/Chat without any extra redirect for existing accounts.

**Reference:** Business Requirements UC-19; UX §User Journey Mapping — First-time user flow; UX Pass 6 §First-time user path.

**Priority:** Critical
**Estimated hours:** 6

**Acceptance Criteria:**
- `profiles` carries an `onboarding_completed_at` nullable timestamptz column; it is NULL for new users and set on wizard completion.
- After sign-in, middleware (or the root layout) checks `onboarding_completed_at`; if NULL, it redirects to `/onboarding`.
- If the user skips the wizard, `onboarding_completed_at` is set immediately (skip is treated as completion).
- Returning users (non-NULL `onboarding_completed_at`) are never redirected to `/onboarding`.
- Existing accounts (pre-onboarding feature) have `onboarding_completed_at` backfilled to `now()` by the migration so they are never redirected.
- Unit test: NULL value → redirect; non-NULL value → no redirect.

---

#### Task 7.4.1.1.1 — Migration: Add onboarding_completed_at to Profiles

| Field | Value |
|---|---|
| Parent Story | 7.4.1.1 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | None — profiles table exists |
| Deliverables | `supabase/migrations/<timestamp>_add_onboarding_completed_at.sql`; regenerated TypeScript types |

**Acceptance Criteria:**
- Column `onboarding_completed_at timestamptz` added to `profiles` with `DEFAULT NULL`.
- Existing rows backfilled: `UPDATE profiles SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL`.
- Migration applies cleanly with `npx supabase db push`.
- TypeScript types regenerated and include the new column.

---

#### Task 7.4.1.1.2 — Post-Sign-In Onboarding Redirect Logic

| Field | Value |
|---|---|
| Parent Story | 7.4.1.1 |
| Agent | backend-specialist |
| Estimation | 4h |
| Dependencies | Task 7.4.1.1.1 |
| Deliverables | Updated `apps/web/src/middleware.ts` or root layout server component; unit tests |

**Acceptance Criteria:**
- After the existing session check in middleware, if the user is authenticated AND `onboarding_completed_at IS NULL` AND the current path is not already `/onboarding`, redirect to `/onboarding`.
- The redirect does not apply to API routes, auth routes, or `/onboarding` itself (prevent redirect loops).
- Logic is in one place (middleware or a shared server utility); not duplicated in individual page components.
- Unit test: mocked profile with NULL → redirect; mocked profile with timestamp → no redirect.

---

### Story 7.4.1.2 — Four-Step Wizard UI

**As a** new user,
**I want** to be guided through 4 short steps that explain what Coriven does, let me set my first life goal, create my first task, and land me on Today/Chat,
**So that** I have immediate value in my account and understand how to use the product — with zero documentation needed.

**Reference:** Business Requirements UC-19; Vision §Customer Success — Onboarding; UX §First-time user flow; UX Pass 4 (≤3 decisions per screen); UX Pass 6 (zero documentation, 4-step wizard ending in first goal + task).

**Priority:** Critical
**Estimated hours:** 8

**Acceptance Criteria:**
- The wizard has exactly 4 steps:
  1. **Welcome** — greeting, 2-sentence explanation of what Coriven does, "Let's get started" CTA.
  2. **Your first goal** — short form: goal title, `why_it_matters` (optional), suggested prompts ("Lose weight," "Launch my product," "Read 12 books"). Creates a `goals` row on submit.
  3. **Your first task** — short form: task title, optional due date, auto-linked to the goal from Step 2. Creates a `tasks` row on submit.
  4. **You're set** — confirms what was created, explains that the daily briefing arrives tomorrow morning, and provides a "Go to Coriven" CTA landing on `/today` or `/chat`.
- Step indicator (e.g., "Step 2 of 4") is visible at all times.
- Each step has a "Back" button (steps 2–4) and a "Skip setup" text link that completes onboarding immediately and navigates to `/today`.
- The "Skip setup" link uses a `POST /api/onboarding/complete` call (not a client-side state change) to ensure `onboarding_completed_at` is persisted.
- Steps 2 and 3 reuse the existing goal-creation and task-creation API routes/Server Actions — no parallel creation logic.
- WCAG AA: step indicator uses `aria-current="step"`; "Back" and next buttons have descriptive labels; required fields are labeled with `<label>`; error messages reference the field by name.

---

#### Task 7.4.1.2.1 — Wizard Shell and Step Navigation

| Field | Value |
|---|---|
| Parent Story | 7.4.1.2 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.4.1.1.2 (onboarding route exists) |
| Deliverables | `apps/web/src/app/onboarding/page.tsx`; `apps/web/src/components/onboarding/WizardShell.tsx`; `apps/web/src/components/onboarding/StepIndicator.tsx` |

**Acceptance Criteria:**
- `WizardShell` manages current step state (React `useState`); no URL-based step routing (step state is ephemeral — a page refresh returns to Step 1, which is acceptable per UX spec).
- `StepIndicator` renders "Step N of 4" with `aria-current="step"` on the active step item.
- Back/next navigation via `WizardShell` props; child step components are not aware of their step number.
- "Skip setup" link calls `POST /api/onboarding/complete` then uses `router.push('/today')`.
- On mobile (<768px), the wizard renders single-column with the step indicator at the top; no docked chat panel (wizard is a focused flow).
- Keyboard: Tab cycles through visible form fields and buttons; Enter submits the primary action; Escape does not close the wizard (it is a full-page flow).

---

#### Task 7.4.1.2.2 — Step 2: First Goal Form

| Field | Value |
|---|---|
| Parent Story | 7.4.1.2 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.4.1.2.1; Epic 4 (goal-creation API route or Server Action exists) |
| Deliverables | `apps/web/src/components/onboarding/steps/StepGoal.tsx` |

**Acceptance Criteria:**
- Fields: `title` (required, text), `why_it_matters` (optional, textarea).
- 3 suggested-prompt buttons prefill the `title` field ("Lose weight," "Launch my product," "Read 12 books") — clicking one is not a submit, it populates the input for editing.
- On submit, calls the existing goal-creation API route (`POST /api/goals`) with `{ title, why_it_matters }` and the user's session.
- On success, stores the created `goal_id` in parent `WizardShell` state and advances to Step 3.
- On error (API failure), displays an inline error message with a "Try again" path; the user is not dropped from the wizard.
- All form inputs have associated `<label>` elements; `aria-required="true"` on title; error messages linked via `aria-describedby`.

---

#### Task 7.4.1.2.3 — Step 3: First Task Form

| Field | Value |
|---|---|
| Parent Story | 7.4.1.2 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.4.1.2.2; Epic 1 (task-creation API route or Server Action exists) |
| Deliverables | `apps/web/src/components/onboarding/steps/StepTask.tsx` |

**Acceptance Criteria:**
- Fields: `title` (required, text), `due_at` (optional, date-time picker or text input), auto-linked `goal_id` from Step 2 (not shown to user — handled transparently).
- If the user skipped goal creation (went back and skipped Step 2), `goal_id` is null and the task is created unlinked.
- On submit, calls the existing task-creation API route (`POST /api/tasks`) with `{ title, due_at, goal_id }`.
- On success, advances to Step 4.
- On error, inline error with retry; no wizard abandonment.
- Accessible: date input uses `<input type="datetime-local">` with a visible label and a helper text "Optional — when should this be done?".

---

#### Task 7.4.1.2.4 — Step 4: Completion Screen and Onboarding Finalization

| Field | Value |
|---|---|
| Parent Story | 7.4.1.2 |
| Agent | frontend-specialist |
| Estimation | 4h |
| Dependencies | Task 7.4.1.2.3; `POST /api/onboarding/complete` endpoint |
| Deliverables | `apps/web/src/components/onboarding/steps/StepComplete.tsx`; `POST /api/onboarding/complete` route |

**Acceptance Criteria:**
- Step 4 displays a confirmation: the goal title created in Step 2 and the task title from Step 3.
- Text: "Your first briefing arrives tomorrow morning. Coriven will help you stay on track."
- "Go to Coriven" CTA calls `POST /api/onboarding/complete` (sets `onboarding_completed_at`) and navigates to `/today`.
- `POST /api/onboarding/complete` requires authentication; uses service-role client to update `onboarding_completed_at = now()`; returns 200 on success.
- If `onboarding_completed_at` is already set (re-entrant call), the endpoint returns 200 without error (idempotent).
- After completing, the user is never redirected to `/onboarding` again.

---

### Story 7.4.1.3 — Suggested Actions in Today/Chat for New Users

**As a** user who just completed onboarding,
**I want** the Today/Chat screen to greet me and suggest my next 2–3 actions,
**So that** the transition from the wizard to the main app feels continuous and I know what to do next.

**Reference:** UX §First-time user flow (sign in → Today/Chat greeting + 2–3 suggested actions); UX Pass 4 (≤3 primary decisions); UX Pass 6.

**Priority:** Medium
**Estimated hours:** 6

**Acceptance Criteria:**
- For a user whose account age is less than 48 hours AND who has just completed onboarding (redirected from `/onboarding`), the Chat area displays a greeting message and 3 suggested action chips.
- Suggested actions: "Add a task," "Ask me about your goal," "Tell me something to remember."
- Each chip is a button that pre-fills the chat composer with the suggested text (does not auto-send; the user edits and sends).
- Suggested chips disappear once the user sends their first message or after 48 hours, whichever comes first.
- Chips are `<button>` elements with visible focus and descriptive labels; they render only when the chat history is empty.

---

#### Task 7.4.1.3.1 — Suggested Action Chips in Chat Composer Area

| Field | Value |
|---|---|
| Parent Story | 7.4.1.3 |
| Agent | frontend-specialist |
| Estimation | 6h |
| Dependencies | Task 7.4.1.2.4 (onboarding complete); existing chat Composer component |
| Deliverables | `apps/web/src/components/onboarding/SuggestedActions.tsx`; updated chat layout |

**Acceptance Criteria:**
- `SuggestedActions` is rendered between the message list and the Composer when `messages.length === 0` AND `profile.created_at` is within the last 48 hours.
- Clicking a chip sets the Composer's input value to the chip text and focuses the Composer.
- Component is hidden (not just visually hidden) after any message is sent (controlled by the parent).
- Accessible: each chip is a `<button>` with `aria-label` describing the action; the chip group has a heading "Try asking Coriven:" for context.

---

## Task Dependencies

```
Task 7.4.1.1.1 (migration: onboarding_completed_at)
  └── Task 7.4.1.1.2 (redirect logic)
       └── Task 7.4.1.2.1 (wizard shell)
            └── Task 7.4.1.2.2 (Step 2: goal form)
                 └── Task 7.4.1.2.3 (Step 3: task form)
                      └── Task 7.4.1.2.4 (Step 4: complete)
                           └── Task 7.4.1.3.1 (suggested action chips)
```

**Critical path:** migration → redirect logic → wizard shell → steps in sequence → completion → suggested chips.
**No parallelizable paths** — steps are sequentially dependent; the wizard shell must exist before any step component.

## Definition of Done

- `onboarding_completed_at` column exists; existing accounts backfilled; new accounts start NULL.
- First-time user (NULL `onboarding_completed_at`) is redirected to `/onboarding` after sign-in.
- Wizard completes all 4 steps; Step 2 creates a real `goals` row; Step 3 creates a real `tasks` row linked to the goal.
- "Skip setup" and completion both set `onboarding_completed_at`; subsequent logins do not re-show the wizard.
- Step 4 lands user on `/today`; suggested action chips appear in an empty chat.
- Accessibility verified: keyboard navigation end-to-end through the wizard; ARIA step indicator; labeled form fields; no color-only indicators.
- Integration test: complete all 4 steps → assert `onboarding_completed_at` is set, one `goals` row, one `tasks` row linked to the goal; next navigation to `/` does not redirect to `/onboarding`.
- CI test suite passes.

## Infrastructure Specifications

### Database

- **Migration:** `<timestamp>_add_onboarding_completed_at.sql`
  - `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz DEFAULT NULL;`
  - Backfill: `UPDATE profiles SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;`
- **No new tables.** The wizard creates rows via existing `goals` and `tasks` tables.
- **RLS:** The existing `profiles` UPDATE policy allows the user to set `onboarding_completed_at` (this column is non-sensitive); or the `POST /api/onboarding/complete` route uses the service-role client — preferred for clarity.

### API

#### `POST /api/onboarding/complete`
- **Auth:** Supabase session cookie required (401 if absent).
- **Request body:** none.
- **Response:** `{ onboarding_completed_at: string }` (ISO timestamp) on 200.
- **Validation:** idempotent — if already set, returns 200 with existing value.
- **Implementation:** service-role client UPDATE `profiles SET onboarding_completed_at = now() WHERE id = $uid AND onboarding_completed_at IS NULL`.
- **Error codes:** 401, 500 (DB error).

#### `POST /api/goals` (existing — Epic 4)
- Used as-is by Step 2; no modification required.

#### `POST /api/tasks` (existing — Epic 1)
- Used as-is by Step 3; `goal_id` is passed if set in wizard state.

### UI

- **`WizardShell`:** manages `currentStep` (1–4) and `wizardData: { goalId?: string }` state; renders the active step component.
- **`StepIndicator`:** `{ currentStep: number; totalSteps: number }` props; `aria-current="step"` on active step; visually numbered.
- **`StepGoal`:** `{ onSuccess: (goalId: string) => void; onSkip: () => void }` props.
- **`StepTask`:** `{ goalId?: string; onSuccess: () => void; onSkip: () => void }` props.
- **`StepComplete`:** `{ goalTitle?: string; taskTitle?: string; onFinish: () => void }` props.
- **`SuggestedActions`:** `{ onSelectAction: (text: string) => void }` props.

### Testing

- **Unit tests:** `WizardShell` — step navigation; back/next; skip.
- **Unit tests:** `StepGoal` — submit calls goal API; error state renders; suggested prompt chip fills input.
- **Unit tests:** `StepTask` — submit calls task API with goal_id; error state; no goal_id case.
- **Unit tests:** `POST /api/onboarding/complete` — idempotency; unauthorized.
- **Unit tests:** redirect logic — NULL → redirect; non-NULL → no redirect; API routes excluded from redirect.
- **Integration test:** full wizard flow end-to-end — assert `goals` row, `tasks` row, `onboarding_completed_at` set; re-navigation to `/` does not redirect.
- **Accessibility test:** axe-core or equivalent on wizard pages; keyboard nav verified.
- **Coverage target:** >80% branch coverage on wizard components and onboarding API routes.

### Deployment

- No new env vars required.
- The `/onboarding` route must be excluded from the middleware redirect loop (already handled by the redirect guard in Task 7.4.1.1.2).

### Monitoring

- Log `onboarding/complete` events (user_id, step reached before completion, completed vs skipped) — structured.
- Track: onboarding completion rate (completions / sign-ups); skip rate; step abandonment by step number.
- Alert if `onboarding/complete` error rate rises above 0 (a failure here leaves the user stuck).

## Handoff Requirements

- Epic 4 (goals) must be in place before Task 7.4.1.2.2: the `POST /api/goals` route must exist.
- Epic 1 (tasks) is already built; `POST /api/tasks` must accept a `goal_id` optional parameter.
- The `/today` route (Epic 3 briefing) must exist; if not yet built, landing on `/chat` is an acceptable fallback — document the decision.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Epic 4 goals not yet available when this wave runs | High — Step 2 blocked | Medium | Skip goal step in wizard if goals table does not exist; document as a known limitation; re-enable at Epic 4 |
| Wizard redirect loop if `/onboarding` is itself gated | Medium | Low | Middleware excludes `/onboarding` from the auth redirect and the onboarding redirect checks |
| Users skipping wizard miss the first-value moment | Low-Medium | Medium | Suggested chips on Today/Chat provide the second-chance first-value moment (Story 7.4.1.3) |
| Wizard data lost on page refresh (state in React) | Low | Medium | Acceptable per UX spec; user restarts from Step 1; wizard creates data only on step submit, so partial data from completed steps persists |

## Related Documentation

- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` UC-19
- Product Vision: `docs/architecture/_main/01-Product-Vision.md` §Customer Success — Onboarding
- UX: `docs/architecture/_main/05-User-Experience.md` §First-time user flow, §User Journey
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` Pass 4 (cognitive load), Pass 6 (first-run, zero-doc, 4-step wizard)
- Epic 8: `docs/implementation/_main/epic-7-productization.md`
