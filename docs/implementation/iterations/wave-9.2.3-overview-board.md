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
wave: "9.2.3"
agents: [frontend-specialist, quality-control]
tags: [coriven, overview-board, today, cards, attention, inline-actions, curation]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.2.3: Overview Board

## Wave Overview
- **Wave ID:** Wave-9.2.3
- **Feature:** Feature 9.2 - Design System & Overview Board
- **Epic:** Epic 9 - Experience Redesign
- **Status:** Planning
- **Scope:** Rebuild Today as the assistant-curated **overview board** — the panel's home state (design doc §4.1a). Need-based cards (Needs attention / Briefing / Due today / Inbox / Goals momentum), each a *working summary* with a hard cap of **≤5 interactive rows** (§8.4 guardrail) and inline actions (check off task, snooze, archive email, approve) wrapping **existing Server Actions only** — no new tables, no new backend capabilities. The amber attention card appears only when something is pending and always sorts first. This wave **OWNS the board card contract** (`BoardCard` props + row model), which 9.4.x and 9.5.1 consume.
- **Wave Goal:** Opening the app shows the day's state with zero interactions — chat on the left, the assistant's status board on the right — and every card row is directly actionable.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. The board replaces the interim Today page as the panel's home (`overview` surface at `/`, per C2/C5 — consumed, not redefined); the standalone Today page retires.
2. Five need-based card types render from **existing tables** (`daily_briefings`, `tasks` + `task_reminders`, `email_metadata`, `goals`, `approval_queue`, `meeting_briefs`) via existing query patterns — read-only assembly, RLS-scoped.
3. Every card is a working summary: inline complete/snooze/archive/approve via existing Server Actions, optimistic (<100ms) feedback, ≤5 interactive rows enforced *in the component*, card header opens the full surface via `usePanel().openPanel()` (C2).
4. The attention card (amber, `--color-attention`) appears **only** when something is pending — approvals, failed executions — sorts to the top, and disappears when empty (no dead placeholder).
5. Card ordering is assistant-curated deterministically: attention > briefing > due > inbox > goals by default, re-weighted by time of day and pending state; irrelevant cards compact or drop.

## Shared Contracts

- **OWNS: the overview board card contract** (`BoardCard` props, row model, ≤5-row cap, curated-ordering input shape). Consumers: 9.4.1 (focusId targets on board rows), 9.4.2 (compact in-chat card parity with the briefing card), 9.5.1 (board on mobile sheets). Record the final shape in `epic-9-shared-contracts.md` (new §C-board under Feature 9.2) at wave end.
- **Consumes C2 (panel controller & surface registry, Wave 9.1.1):** the board is the `overview` surface — panel home. Card headers call `usePanel().openPanel(surface)`; rows honor `focusId` when the board is opened with one. **Do not redefine C2.**
- **Consumes C8 (component library, Wave 9.2.2):** cards compose `Card`, `Button`, `Badge`, `Skeleton`, `EmptyState`, `Toast` — no hand-rolled parallel primitives (C8 clause).
- **Consumes C4 (tokens, Wave 9.2.1):** amber = `--color-attention` for the attention card; no raw palette values (guard is enforcing by now).
- **Consumes C5 (route map, Wave 9.1.3):** `/` renders chat + board; `/today` already 301-redirects to `/` (owned by 9.1.3 — this wave only deletes the retired page internals).

## User Stories

### Story 9.2.3.1 — Board shell, card contract, and data assembly

**As a** Coriven user opening the app
**I want** the panel's home state to be a board of my day assembled server-side
**So that** I know where I stand with zero interactions (design doc §9 success criterion).

**Acceptance Criteria:**
- [ ] A `BoardCard` component defines the card contract: header (icon + title + count), **≤5 interactive rows (hard cap enforced in the component — rendering row 6+ is impossible by construction, §8.4)**, optional compact mode, optional footer link. Header click/Enter opens the full surface via `usePanel().openPanel(surface)` (C2).
- [ ] A single server-side assembly function gathers board data for the signed-in user from existing tables only — `daily_briefings` (type `daily`/`weekly`, timezone-correct date logic ported from the current `today/page.tsx`), `tasks` + `task_reminders` (due today/overdue), `email_metadata` (needs-reply/unread), `goals` (momentum, stalled), `approval_queue` (pending/failed), `meeting_briefs` (next 2h) — all RLS-scoped, no new tables, no schema changes.
- [ ] The board renders in the panel slot as the `overview` surface; loading = per-card `Skeleton`; a card whose query errors shows an inline error + retry without breaking sibling cards; a genuinely empty day shows a designed board-level `EmptyState` with a chat nudge.
- [ ] Board follows Pass 4's cognitive-load budget: read-first, ≤3 primary decisions visible; counts and one-line rows, never dense tables.

**Priority:** Critical
**Estimated hours:** 8h

#### Task 9.2.3.1.1 — `BoardCard` primitive-composed card + row model

- **Parent Story:** 9.2.3.1
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Wave 9.2.2 complete (C8)
- **Deliverables:** `apps/web/src/components/board/board-card.tsx` (+ `types.ts` with `BoardCardProps`/`BoardRow`); tests including the row-cap and header-opens-surface behavior.
- **Acceptance Criteria:** Composes `Card`/`Badge`/`Button` only; `rows` prop typed as max-5 (runtime slice + dev-mode warning); header keyboard-activatable with `aria-label` ("Open Tasks"); `focusId` prop scrolls/highlights the matching row (C2 clause).

#### Task 9.2.3.1.2 — Server-side board data assembly

- **Parent Story:** 9.2.3.1
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** None (parallel with 9.2.3.1.1)
- **Deliverables:** `apps/web/src/lib/board/queries.ts` — `assembleBoardData(userId, timezone): Promise<BoardData>` reading the six existing tables; unit tests with seeded fixtures.
- **Acceptance Criteria:** Reuses the auth-server Supabase client pattern; timezone-correct "today" via `profiles.timezone` (port the `en-CA` trick from `today/page.tsx`); per-section errors isolated (one failed query nulls that card's data, doesn't throw the page); no writes.

---

### Story 9.2.3.2 — Attention card (amber interrupt surface)

**As a** user with something waiting on my judgment
**I want** an amber card at the top of the board the moment anything is pending
**So that** approvals and failures are impossible to miss without owning permanent navigation (design doc §4.1b; §9: pending approvals visible within 1s of open).

**Acceptance Criteria:**
- [ ] Renders **only** when `approval_queue` has pending items or failed executions exist; disappears entirely when empty — no placeholder (need-based rule, §4.1a).
- [ ] Always sorts to position 1 regardless of curation weights.
- [ ] Amber identity via `--color-attention` (C4); rows show what + why (Pass 3: AI-proposed content labeled), with inline **Approve** (primary) and **Cancel** (destructive) wrapping existing `approveAction`/`cancelAction`; failed executions get **Retry** wrapping `retryAction`. Approve/Cancel follow the Pass 3 three-way approval affordance (Modify stays on the full surface — a card row that needs payload editing has outgrown the board, §8.4).
- [ ] Footer link "History" opens `/activity` (C5 audit route) — the only page-like approvals destination.
- [ ] Action feedback: server-confirmed for approvals (external effects — Pass 5: approval → executing → executed), with pending state on the row's buttons and a `Toast` on completion/failure.
- [ ] ≤5 rows; overflow shows "+N more" in the footer linking to `/activity`.

**Priority:** Critical
**Estimated hours:** 6h

#### Task 9.2.3.2.1 — Attention card with inline approve/cancel/retry

- **Parent Story:** 9.2.3.2
- **Agent:** frontend-specialist
- **Estimation:** 6h
- **Dependencies:** Tasks 9.2.3.1.1, 9.2.3.1.2
- **Deliverables:** `apps/web/src/components/board/attention-card.tsx` + tests (appears/disappears on pending state; action wiring; server-confirmed flow).
- **Acceptance Criteria:** Uses existing `approveAction`/`cancelAction`/`retryAction` unchanged; no re-summarization of payloads (ADR-013 raw-payload-primary preserved — row shows action type + target, click-through for full payload); card absent from DOM when queue empty.

---

### Story 9.2.3.3 — Briefing card + Due-today card

**As a** user starting my day
**I want** the briefing prominent until I've read it and my due tasks actionable in place
**So that** the morning routine is glance → act, not navigate → read (design doc §4.1a).

**Acceptance Criteria:**
- [ ] **Briefing card:** renders today's `daily_briefings` row (type `daily`); prominent (expanded summary sections) until read, then compacts to a one-line summary for the rest of the day; read state tracked client-side per `(user_id, briefing_date)` (localStorage — no schema change; `was_delivered` stays owned by the tray/Epic 7 flows). No briefing yet → compact "arrives after your briefing time" row (no dead card). Weekly review, when present for the current ISO week, appears as a footer row linking into the full overview surface content.
- [ ] **Due-today card:** top 3–5 tasks due today or overdue (overdue first, then by due time), each row with inline **check-off** (wraps `updateTask(id, { status: 'done' })`, optimistic <100ms, Pass 5) and **snooze** (wraps `snoozeReminder` with the existing 15m/1h/1d options when the task has a reminder; tasks without reminders show check-off only — no new backend invented for task-level snooze).
- [ ] Both card headers open the full surface (`overview` briefing content / `tasks`) via C2.
- [ ] ≤5 interactive rows each; due-today overflow shows "+N more due" footer opening `tasks`.
- [ ] Meeting prep (next 2h, from `meeting_briefs`) renders as a compact row inside the briefing card only when briefs exist — preserving the current Today behavior without its own card.

**Priority:** High
**Estimated hours:** 10h

#### Task 9.2.3.3.1 — Briefing card with read-compaction

- **Parent Story:** 9.2.3.3
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Tasks 9.2.3.1.1, 9.2.3.1.2
- **Deliverables:** `apps/web/src/components/board/briefing-card.tsx` + tests (expanded/compact/absent states; read-state persistence; meeting-prep row).
- **Acceptance Criteria:** Renders `BriefingContent` sections (goals in motion, upcoming, stalled) in card form; compaction is per-day (new briefing date resets it); timezone-correct throughout.

#### Task 9.2.3.3.2 — Due-today card with inline complete/snooze

- **Parent Story:** 9.2.3.3
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Tasks 9.2.3.1.1, 9.2.3.1.2
- **Deliverables:** `apps/web/src/components/board/tasks-card.tsx` + tests (ordering, optimistic check-off, snooze options, overflow footer).
- **Acceptance Criteria:** `updateTask`/`snoozeReminder` consumed unchanged; checked-off row animates out behind `motion-safe:` at `--duration-base`; row count never exceeds 5.

---

### Story 9.2.3.4 — Inbox card + Goals-momentum card

**As a** user triaging between meetings
**I want** needs-reply email and goal momentum visible and actionable at a glance
**So that** light triage happens on the board and deep work is one click away.

**Acceptance Criteria:**
- [ ] **Inbox card:** needs-reply count headline + top 2–3 triage rows (sender, subject, urgency Badge) from `email_metadata`; inline **archive** action wraps the existing `markEmailRead` (and `dismissFollowUp` for follow-up rows) — "archive" on the board means "cleared from triage" via existing actions; **no new email capabilities**. Header opens `email` surface (C2).
- [ ] **Goals-momentum card:** compact momentum strip (per-goal momentum Badge with text label — never color-alone); stalled goals get a nudge row ("Stalled 12d — ask Coriven about it") whose action drops focus into the chat composer with the goal referenced (a plain composer-focus + prefill; the full "Ask Coriven" chip system is 9.4.2's — do not build it here). Header opens `goals` (C2).
- [ ] Both cards are need-based: inbox card compacts to a single count row when nothing needs reply; goals card drops when no active goals exist (first-run) in favor of the board-level empty state's chat nudge.
- [ ] ≤5 interactive rows each; optimistic feedback on archive; Toast on failure with retry.

**Priority:** High
**Estimated hours:** 8h

#### Task 9.2.3.4.1 — Inbox triage card

- **Parent Story:** 9.2.3.4
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Tasks 9.2.3.1.1, 9.2.3.1.2
- **Deliverables:** `apps/web/src/components/board/inbox-card.tsx` + tests (rows, archive wiring, compact mode, disconnected-provider empty variant pointing at Settings → Connections).
- **Acceptance Criteria:** `markEmailRead`/`dismissFollowUp` consumed unchanged; urgency Badge tones per C8 map; no body content on the board (metadata + summary only — consistent with the zero-persistence email model).

#### Task 9.2.3.4.2 — Goals-momentum card

- **Parent Story:** 9.2.3.4
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Tasks 9.2.3.1.1, 9.2.3.1.2
- **Deliverables:** `apps/web/src/components/board/goals-card.tsx` + tests (momentum strip, stalled nudge row, drop-when-empty behavior).
- **Acceptance Criteria:** Momentum states (improving/stable/declining/null-"calculating") map to Badge tones with text (Pass 5 partial state); nudge row focuses the composer with goal title prefilled; no goal mutation from the board.

---

### Story 9.2.3.5 — Assistant-curated ordering + Today retirement

**As a** user at different times of day
**I want** the board ordered by what matters now, and the old Today page gone
**So that** the right side of the screen is the assistant's status board for me, not a static menu (§4.1a: the chief-of-staff move).

**Acceptance Criteria:**
- [ ] A pure, deterministic ordering function ranks cards: default `attention > briefing > due > inbox > goals`; re-weighted by time of day (briefing weight decays after read/midday; due-today rises through the afternoon) and pending state (any pending approval pins attention first). Deterministic given (data, time) — **no LLM call, no new backend**; "assistant-curated" = rule-based curation logic, unit-testable.
- [ ] Irrelevant cards compact or drop per their need-based rules; the board never renders an empty placeholder card.
- [ ] The board is wired in as the `overview` surface's content (panel home at `/`); the interim Today page content (`apps/web/src/app/(app)/today/page.tsx`) is retired — its timezone/briefing logic lives on in `lib/board/queries.ts`, and the `/today` → `/` redirect (owned by 9.1.3/C5) remains untouched.
- [ ] `components/briefing/` components no longer referenced by any route (kept only if 9.4.2 needs them; otherwise deleted in this wave with a note in the PR).
- [ ] Full-board accessibility pass: cards are landmarks/regions with labels, rows keyboard-actionable, axe zero critical violations, all motion `motion-safe:`.

**Priority:** High
**Estimated hours:** 6h

#### Task 9.2.3.5.1 — Curated ordering engine

- **Parent Story:** 9.2.3.5
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Stories 9.2.3.2–9.2.3.4 (all cards exist)
- **Deliverables:** `apps/web/src/lib/board/ordering.ts` — `orderCards(data: BoardData, now: Date, briefingRead: boolean): OrderedCard[]` + exhaustive unit tests (morning/afternoon/pending/empty scenarios).
- **Acceptance Criteria:** Pure function; attention always first when present; snapshot tests over a scenario matrix; documented weights table in the file header.

#### Task 9.2.3.5.2 — Wire board as panel home; retire Today; QC pass

- **Parent Story:** 9.2.3.5
- **Agent:** frontend-specialist (wiring) + quality-control (audit)
- **Estimation:** 3h
- **Dependencies:** Task 9.2.3.5.1
- **Deliverables:** `apps/web/src/components/board/board.tsx` (composition root) rendered as the `overview` surface content; `today/page.tsx` removed/retired; axe + keyboard audit results; board card contract recorded in `epic-9-shared-contracts.md`.
- **Acceptance Criteria:** `/` shows chat + board with zero interactions; deep link `/tasks` etc. still swap the panel per C2/C5; no orphaned imports; typecheck/tests/palette-guard all pass; success criteria §9 items (zero-interaction day view, 1s attention visibility) manually verified.

## Infrastructure Specifications

### Database

**No new tables, no migrations, no schema changes.** Read-only assembly against existing tables (all RLS-scoped by `user_id`, auth-server Supabase client pattern):

| Card | Table(s) | Read shape |
|---|---|---|
| Attention | `approval_queue` | pending + failed rows, newest first, limit 5 + count |
| Briefing | `daily_briefings` (`type='daily'`/`'weekly'`), `meeting_briefs` | today's row (timezone-correct date), current-ISO-week weekly row, briefs starting within 2h |
| Due today | `tasks` + nested `task_reminders` | due ≤ end-of-today (user tz) or overdue, not done/cancelled, overdue-first, limit 5 + count |
| Inbox | `email_metadata`, `followup_candidates` | needs-reply/unread metadata, urgency ordered, limit 3 + count |
| Goals | `goals` | active goals w/ momentum; stalled = momentum declining / no recent activity |

Writes happen **only** through existing Server Actions (`updateTask`, `snoozeReminder`, `approveAction`, `cancelAction`, `retryAction`, `markEmailRead`, `dismissFollowUp`) — zero new mutation paths.

### API

No new API routes. No new Server Actions. No tool or SSE changes (the C6 `open_surface` bridge is Wave 9.4.1's — the board only *receives* focus via C2's `focusId`).

### UI

**Board card contract (owned here — canonical):**

```typescript
type BoardCardTone = 'default' | 'attention'

interface BoardRow {
  id: string                       // entity id — doubles as C2 focusId target
  primary: string                  // one-line label
  meta?: string                    // time/count/momentum text
  badge?: { tone: BadgeTone; label: string }
  actions?: BoardRowAction[]       // inline verbs, max 2 visible
}

interface BoardCardProps {
  surface: SurfaceId               // C2 — header opens this surface
  title: string
  icon: React.ReactNode
  tone?: BoardCardTone             // 'attention' = amber identity
  count?: number                   // headline count
  rows: BoardRow[]                 // HARD CAP 5 — enforced in component (§8.4)
  compact?: boolean                // one-line form (read briefing, quiet inbox)
  footer?: { label: string; href?: string; onSelect?: () => void }  // "+N more", "History"
  focusId?: string                 // scroll/highlight row (C2 clause)
}
```

**Hard rules (component-enforced, not guidelines):** ≤5 interactive rows per card (§8.4 — a card that wants more has outgrown the board; the full surface is one rail click away); need-based rendering (empty ⇒ compact or absent, never a placeholder); every row actionable in place (working summary, not link tile).

**States (Pass 5):** per-card Skeleton on load; per-card inline error + retry (sibling cards unaffected); board-level EmptyState with chat nudge on a genuinely empty day; optimistic (<100ms) for internal actions (check-off, archive, snooze), server-confirmed with pending → Toast for approvals.

**Affordances (Pass 3):** check-off = checkbox with immediate optimistic change; snooze = 15m/1h/1d buttons (existing verbs); Approve primary / Cancel destructive, separated; AI-proposed rows labeled.

**Cognitive load (Pass 4):** board is read-first; ≤3 primary decisions visible at once; curation drops irrelevant cards rather than stacking everything.

**Accessibility:** cards as labeled `region`s; rows keyboard-actionable; amber/emerald signals always paired with text; `motion-safe:` on card enter/exit/compaction; axe zero critical.

### Testing

- **Unit:** `BoardCard` row-cap enforcement (6 rows in → 5 rendered + dev warning); ordering engine scenario matrix (morning/afternoon/read-briefing/pending-approval/empty); each card's states (populated/compact/absent/error); read-compaction persistence and per-day reset.
- **Integration:** `assembleBoardData` against seeded fixtures — timezone boundary cases (briefing date at day rollover in a non-UTC timezone), RLS scoping (user A never sees user B rows), per-section error isolation.
- **Action wiring:** each inline action calls the correct existing Server Action with correct args and handles the error branch (mocked actions).
- **Accessibility:** axe on the assembled board — zero critical; keyboard-only walkthrough: reach and act on every row.
- **Manual E2E:** §9 success criteria — open app → day visible with zero interactions; seed a pending approval → attention card first and visible ≤1s; complete a task on the card → task list reflects it.
- **Coverage:** `components/board/` + `lib/board/` ≥ 90%.

### Deployment

Standard Vercel auto-deploy via PR into `development`. Waves 9.1.1–9.1.3, 9.2.1, 9.2.2 must be merged first (shell, routes, tokens, primitives). No env vars, no migrations, no cron changes.

### Monitoring

- Log server-side per-section assembly failures (`[board] <section> fetch failed`, user id, no PII) — a rising rate on one section flags an upstream data problem without a broken board masking it.
- Track (log-based) attention-card render rate vs. `approval_queue` pending rows as a sanity signal that the interrupt path works — this replaces the visibility the retired Approvals tab provided.

## Task Dependencies

```
Wave 9.2.2 (C8) ─┬─> Task 9.2.3.1.1 (BoardCard contract)      [parallel]
                 └─> Task 9.2.3.1.2 (data assembly)            [parallel]
                        │        │
        ┌───────────────┼────────┼──────────────┐   (both 1.1 & 1.2 required)
        ↓               ↓        ↓              ↓
  Task 9.2.3.2.1   Task 9.2.3.3.1  Task 9.2.3.3.2   Task 9.2.3.4.1 / 9.2.3.4.2
  (attention)      (briefing)      (due today)       (inbox / goals)   [all parallel]
        └───────────────┴────────┴──────────────┘
                        ↓
              Task 9.2.3.5.1 (ordering engine)
                        ↓
              Task 9.2.3.5.2 (wire home + retire Today + QC)
```

Critical path: 9.2.3.1.x → any card → 9.2.3.5.1 → 9.2.3.5.2. Bottleneck: the five card tasks are fully parallelizable once the contract + assembly land — staff accordingly.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| frontend-specialist | 9.2.3.1.1, 9.2.3.1.2, 9.2.3.2.1, 9.2.3.3.1, 9.2.3.3.2, 9.2.3.4.1, 9.2.3.4.2, 9.2.3.5.1, 9.2.3.5.2 (wiring) | 36h |
| quality-control | 9.2.3.5.2 (axe/keyboard/§9 audit share) | 2h |
| **Total** | | **38h** |

**File scope:**
- **New:** `apps/web/src/components/board/` — `board.tsx`, `board-card.tsx`, `attention-card.tsx`, `briefing-card.tsx`, `tasks-card.tsx`, `inbox-card.tsx`, `goals-card.tsx`, `types.ts`, `__tests__/*`; `apps/web/src/lib/board/` — `queries.ts`, `ordering.ts`, `__tests__/*`
- **Modified:** the `overview` surface registration point created by Wave 9.1.1 (render `<Board/>` as panel home — exact file per 9.1.1's implementation, expected under `apps/web/src/components/layout/` or `apps/web/src/app/(app)/`)
- **Removed/retired:** `apps/web/src/app/(app)/today/page.tsx` (logic ported to `lib/board/queries.ts`); `apps/web/src/components/briefing/*` if unreferenced after retirement (coordinate with 9.4.2)
- **Consumed unchanged (read-only — do NOT modify):** `apps/web/src/app/actions/tasks.ts`, `approvals.ts`, `email.ts`, `goals.ts`; `apps/web/src/components/ui/*` (C8); panel controller/`usePanel` (C2); route redirects (C5)
- **Docs:** `docs/planning/epic-9-shared-contracts.md` — add the board card contract section (owner's obligation)

## Dependencies

- **Depends on:** Wave 9.2.2 (C8 primitives — hard), Wave 9.2.1 (C4 tokens — transitive), Wave 9.1.1 (C2 panel controller + `overview` surface slot — hard), Wave 9.1.3 (C5 `/` home + `/today` redirect + `/activity` audit route — hard for attention-card footer and home wiring).
- **Blocks:** Wave 9.4.1 (board rows are `focusId` targets for tool deep links), Wave 9.4.2 (compact in-chat briefing card mirrors the board briefing card; may reuse/retire `components/briefing/`), Wave 9.5.1 (board rendering inside responsive sheets).

## Definition of Done

- [ ] All 5 stories' acceptance criteria met; all card types shipped with tests
- [ ] `/` shows chat + curated board with zero interactions; Today page retired; no orphaned code
- [ ] ≤5-row cap component-enforced; attention card need-based and always first when present
- [ ] All inline actions wrap existing Server Actions only — verified no new mutation paths in the diff
- [ ] §9 success criteria verified: zero-interaction day view; pending approvals visible ≤1s; board states designed (empty/loading/error)
- [ ] axe zero critical; keyboard-only operable; palette guard passing (zero raw values)
- [ ] Coverage ≥ 90% on `components/board/` + `lib/board/`; typecheck/tests green
- [ ] Board card contract recorded in `epic-9-shared-contracts.md`
- [ ] PR reviewed and merged to `development`

## Handoff Requirements

**For Wave 9.4.1 (tool→panel bridge):**
- `BoardRow.id` doubles as the C2 `focusId` target; the board honors `focusId` by scrolling/highlighting — 9.4.1 needs no board changes to deep-link.

**For Wave 9.4.2 (proactive-in-chat):**
- The briefing card's compact form is the visual template for the in-chat briefing message; the read-compaction key `(user_id, briefing_date)` aligns with 9.4.2's dedupe key. Decide `components/briefing/` final deletion there.

**For Wave 9.5.1 (responsive):**
- Board renders inside a `Sheet` at <1100px without card changes — the card contract is width-agnostic by construction; 9.5.1 owns the container behavior only.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Card scope creep — cards grow toward mini-apps | High | ≤5-row cap is component-enforced (§8.4 hard constraint), not a review guideline; Modify-payload stays off the board by design |
| "Assistant-curated" read as requiring an LLM call | Med | Explicitly rule-based/deterministic in this plan; pure function, unit-tested; revisit LLM curation only post-epic |
| "Archive email" implies a provider write that doesn't exist | Med | Board "archive" = existing `markEmailRead`/`dismissFollowUp` (triage-clear); real provider archive is out of scope and flagged as such |
| 9.1.x slippage blocks home wiring | Med | Cards + assembly + ordering build against the C2 interface and fixtures; only Task 9.2.3.5.2 needs the live shell |
| Briefing read-state in localStorage diverges across devices | Low | Accepted: worst case a read briefing shows expanded on a second device; per-day reset bounds the annoyance; server-side read tracking deferred (would need schema — out of scope) |
| Board assembly slows `/` first paint | Med | Per-card streaming with Skeletons (App Router); queries limited (5-row caps mean `limit 5` reads); measure in PR |

## Notes and Assumptions

- **No new backend capabilities anywhere in this wave** — the board is a read-and-reuse layer over Epics 3–7 output. Any card idea requiring a new table/action is rejected or deferred by definition.
- "Assistant-curated ordering" v1 is deterministic rules (time-of-day + pending-state weights). The design doc's language is satisfied by curation *logic*, not model inference.
- The `/today` → `/` 301 redirect is owned by Wave 9.1.3 (C5); this wave only removes the retired page's internals.
- Snooze on the due-today card operates on task *reminders* (the existing `snoozeReminder` action); tasks without reminders show check-off only — consistent with the existing TaskCard verbs.
- Weekly-review full rendering stays reachable through the overview surface until 9.4.2 delivers it in-chat; the board shows it as a footer row, not a sixth card.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` — **§4.1a (the board), §4.1b (approvals as interrupt), §8.4 (≤5-row hard cap)**, §9 (success criteria)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` — **board card contract (owned here)**, C2/C4/C5/C8 (consumed)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.2, Wave 9.2.3 summary)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — **Pass 3 (affordances: checkbox/snooze/approve verbs), Pass 4 (cognitive-load budget: ≤3 primary decisions, read-first board), Pass 5 (five-states table, optimistic vs server-confirmed feedback)**

## Wave Retrospective

{Filled in after wave completion}

---

**Template Version:** 2.0 (Scope-based Wave)
