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
epic: "6"
feature: "6.3"
wave: "6.3.1"
agents: []
tags: [coriven, proactive, weekly-review, daily-briefings, cron, tray, deterministic-assembly]
relateddocuments:
  - "docs/implementation/_main/epic-6-proactive-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 6.3.1: Weekly Review

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 6.3.1 |
| Feature | 6.3 — Weekly Review |
| Epic | 6 — Proactive Intelligence |
| Status | Planning |
| Scope | Implement a Friday 5pm Vercel Cron job that assembles a structured week-in-review (wins, blockers, next-week focus) from task and goal history; store the result as a `daily_briefings` row with `type = 'weekly'`; deliver it via the existing tray poll; expose it via the `generate_weekly_review` tool |

**Wave Philosophy:** Scope-based — this wave is complete when the Friday 5pm cron fires, assembles an accurate review from real task and goal data, persists it to `daily_briefings`, the tray delivers it, and the `generate_weekly_review` tool exposes the content to chat — all following the deterministic-assembly ethos (ADR-008) with optional light LLM phrasing, regardless of calendar time.

## Wave Goals

1. **Deterministic weekly review assembled.** The Friday cron assembles wins (tasks completed this week), blockers (tasks overdue or stalled), and next-week focus (upcoming high-priority tasks linked to active goals) from structured Postgres queries — no LLM required for the core content; an optional Haiku pass can add light narrative phrasing without changing the facts.
2. **Review stored and delivered.** The assembled review is persisted as a `daily_briefings` row with `type = 'weekly'` and `was_delivered = false`; the tray's existing briefing poll detects it and fires a native notification; `was_delivered` is set after firing.
3. **`generate_weekly_review` tool available in chat.** Users can ask Coriven to generate or retrieve the weekly review in chat at any time, not only on Fridays; the tool returns the most recent weekly briefing or assembles a fresh one on demand.

## User Stories

### Story 6.3.1.1 — Friday cron assembles and stores an accurate weekly review

**As the** Briefing Cron actor,
**I want** to assemble a structured week-in-review from task and goal history every Friday at 5pm and persist it to `daily_briefings`,
**So that** the user receives an accurate summary of the week's wins, blockers, and next-week priorities without requiring a manual request.

**Acceptance Criteria:**
- A Vercel Cron job fires on a Friday schedule at approximately 5pm (UTC offset matched to the user's timezone stored in `profiles.timezone`; users without a timezone setting default to UTC); the endpoint is `POST /api/cron/weekly-review`.
- The endpoint validates `Authorization: Bearer <CRON_SECRET>` and returns HTTP 401 on mismatch.
- For each active user, the job assembles three sections from Postgres queries:
  - **Wins:** tasks with `status = 'done'` and `completed_at` within the past 7 days, optionally grouped by linked goal.
  - **Blockers:** tasks with `status IN ('pending', 'in_progress')` and `due_at` in the past (overdue), plus goals with `momentum = 'declining'` from Epic 4's momentum model.
  - **Next-week focus:** top 3–5 high-priority tasks (`priority IN ('high', 'urgent')`) due within the next 7 days, preferring tasks linked to active goals.
- The assembled content is stored as a new `daily_briefings` row: `user_id`, `type = 'weekly'`, `content` (structured JSON or markdown), `was_delivered = false`, `briefing_date = CURRENT_DATE`.
- Only one weekly review is stored per user per ISO week (unique constraint on `(user_id, type, iso_week)`); a second run in the same week upserts rather than duplicates.
- Optional Haiku pass: if `ANTHROPIC_API_KEY` is available and the assembled content is non-empty, a light narrative phrasing step runs using Claude Haiku to produce a single readable paragraph summary; this is additive — the structured sections are always present regardless of the LLM step's success.
- The job logs a structured summary per user; per-user errors are logged and skipped without aborting the rest.
- The job is idempotent: running it twice in the same week produces the same database state.

**Priority:** Critical
**Estimated hours:** 8h
**Business Requirements:** Feature 8, UC-38 (Weekly review Fri 5pm)

#### Task 6.3.1.1.1 — Implement weekly review assembly library

- **Parent Story:** 6.3.1.1
- **Agent:** Backend Engineer
- **Estimation:** 6h
- **Dependencies:** Epic 4 `goals`, `tasks`, `profiles` (timezone), `daily_briefings` tables; `profiles.timezone` field
- **Deliverables:** `apps/web/src/lib/jobs/weekly-review.ts` — exported `assembleWeeklyReview(userId: string): Promise<WeeklyReviewContent>` and `storeWeeklyReview(userId: string, content: WeeklyReviewContent): Promise<void>`; type definition `WeeklyReviewContent` in `@personal-assistant/types`
- **Acceptance Criteria:** Wins query counts tasks completed in the past 7 days correctly (boundary-tested at 6 days 23 hours vs. 7 days 1 hour); blockers query returns overdue tasks; next-week focus returns at most 5 tasks ordered by priority then due date; optional Haiku phrasing is wrapped in a try/catch and failures do not prevent the review from being stored; idempotent upsert on `(user_id, type, briefing_date-week)`; no hardcoded model IDs — sourced from the model-routing constants already in `lib/anthropic.ts`.

#### Task 6.3.1.1.2 — Implement weekly review cron endpoint and Vercel Cron config

- **Parent Story:** 6.3.1.1
- **Agent:** Backend Engineer
- **Estimation:** 2h
- **Dependencies:** Task 6.3.1.1.1
- **Deliverables:** `apps/web/src/app/api/cron/weekly-review/route.ts`; updated `vercel.json` cron schedule; updated `.env.example` if any new env vars added
- **Acceptance Criteria:** `POST /api/cron/weekly-review` validates `CRON_SECRET`; returns HTTP 200 with `{ usersProcessed, reviewsStored }` on success; returns HTTP 401 on bad secret; returns HTTP 500 with logged error on failure; Vercel Cron schedule entry for Friday 5pm UTC (or adjusted per user timezone offset strategy).

---

### Story 6.3.1.2 — Tray delivers the weekly review notification on Friday

**As the** Primary User,
**I want** to receive a tray notification on Friday evening when my weekly review is ready,
**So that** I can close out the week with a clear picture of wins and what carries forward, without opening a browser.

**Acceptance Criteria:**
- The tray's existing `/api/briefing/today` poll (or a new `/api/briefing/weekly` poll) detects a `daily_briefings` row with `type = 'weekly'` and `was_delivered = false` for the current user.
- The tray fires a native notification with a concise message (e.g., "Your weekly review is ready — 4 wins this week") and a summary of wins count.
- `was_delivered` is set to `true` after the notification is fired; re-polling does not re-fire.
- The notification is informational (no action buttons required beyond OS dismiss).
- If the user opens the web app after receiving the notification, the Today/Briefing screen displays the weekly review content in a dedicated weekly-review section.
- Only one weekly review notification fires per week per user.

**Priority:** High
**Estimated hours:** 4h
**Business Requirements:** Feature 8, UC-38; UX Today/Briefing screen

#### Task 6.3.1.2.1 — Extend briefing poll endpoint to include weekly review

- **Parent Story:** 6.3.1.2
- **Agent:** Backend Engineer
- **Estimation:** 2h
- **Dependencies:** Task 6.3.1.1.1 (weekly review stored in `daily_briefings`); existing `/api/briefing/today` endpoint
- **Deliverables:** Updated `apps/web/src/app/api/briefing/today/route.ts` (or equivalent) to also return undelivered `type = 'weekly'` rows; a `POST /api/briefing/[id]/deliver` endpoint (or equivalent) to mark `was_delivered = true`
- **Acceptance Criteria:** Endpoint returns both daily and weekly briefing rows; `was_delivered` transition works correctly; RLS enforced; duplicate delivery prevented by checking `was_delivered` before returning.

#### Task 6.3.1.2.2 — Tray handles weekly review notification type

- **Parent Story:** 6.3.1.2
- **Agent:** Backend / Tray Engineer
- **Estimation:** 2h
- **Dependencies:** Task 6.3.1.2.1
- **Deliverables:** Updated `apps/tray/src/notifier.ts` (or Tauri equivalent) with a `notifyWeeklyReview` function; updated poll loop to handle weekly briefing type
- **Acceptance Criteria:** Tray detects `type = 'weekly'` briefing with `was_delivered = false`; fires notification with wins count; calls the deliver endpoint; subsequent polls do not re-fire; errors logged without crashing the reminder poll.

---

### Story 6.3.1.3 — Weekly review section appears in the Today/Briefing UI on Fridays

**As the** Primary User,
**I want** to see my weekly review in the Today/Briefing screen when I open the web app on Friday,
**So that** I can read the full structured review (wins, blockers, next week) beyond the tray notification summary.

**Acceptance Criteria:**
- The Today/Briefing page queries for an undelivered or delivered `type = 'weekly'` briefing for the current ISO week.
- A "Weekly Review" section renders below the standard daily sections on Fridays when a review exists.
- The section displays: Wins (list of completed task titles, grouped by goal if linked), Blockers (list of overdue tasks and declining goals), Next Week (list of top upcoming tasks).
- If no weekly review exists yet (cron has not run), the section is absent; no empty-state placeholder required at this wave.
- The section is read-only; no actions required.
- The weekly review content is accessible by keyboard and screen reader (WCAG 2.1 AA: headings, lists with appropriate ARIA labels).
- The UI does not display the optional LLM narrative paragraph as primary content — it may be shown as a "summary" sub-item but the structured lists are always the primary display.

**Priority:** Medium
**Estimated hours:** 5h
**Business Requirements:** Feature 8, UC-38; UX Today/Briefing screen

#### Task 6.3.1.3.1 — Add weekly review section to Today/Briefing page

- **Parent Story:** 6.3.1.3
- **Agent:** Frontend Engineer
- **Estimation:** 5h
- **Dependencies:** Task 6.3.1.2.1 (briefing endpoint returns weekly type); existing briefing page component
- **Deliverables:** Updated `apps/web/src/app/today/page.tsx` (or equivalent briefing page) with a `WeeklyReviewSection` component; `WeeklyReviewSection` component file
- **Acceptance Criteria:** Component renders wins, blockers, and next-week sections from the JSON content; component is absent when no weekly review exists; keyboard navigation works (tab through list items); screen reader reads section heading and list items; component uses Tailwind CSS 4; no hardcoded data.

---

### Story 6.3.1.4 — `generate_weekly_review` tool surfaces the weekly review in chat

**As the** Primary User,
**I want** to ask Coriven in chat to give me my weekly review at any time,
**So that** I can access the structured summary conversationally, not only by checking the briefing screen.

**Acceptance Criteria:**
- A `generate_weekly_review` tool is registered in `TOOL_REGISTRY` with an optional `force_regenerate: boolean` input (default `false`).
- When `force_regenerate = false`, the handler returns the most recent stored `type = 'weekly'` briefing for the current ISO week.
- When `force_regenerate = true`, the handler runs the assembly logic on demand and stores the result before returning it.
- The handler returns a structured summary suitable for chat display, not the raw JSON blob.
- The tool is included in `ALL_TOOL_NAMES` and gated by `tool_permissions`.
- When called on a non-Friday, the tool returns the most recent available weekly review with a note on when it was generated; it does not fabricate a review if none exists.

**Priority:** Medium
**Estimated hours:** 4h
**Business Requirements:** Feature 8

#### Task 6.3.1.4.1 — Add `generate_weekly_review` to tool registry and handler

- **Parent Story:** 6.3.1.4
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Task 6.3.1.1.1 (assembly library); existing tool registry pattern
- **Deliverables:** Updated `apps/web/src/lib/chat/tools/registry.ts`; updated `handlers.ts`; updated `ToolName` type
- **Acceptance Criteria:** Tool appears in registry with valid JSON Schema; handler queries `daily_briefings` for `type = 'weekly'` with correct `user_id` filter; `force_regenerate = true` invokes assembly library; no-review-found case returns a clear, non-fabricated message; tool seeded into `tool_permissions` for existing users.

---

## Task Dependencies

```
Epic 4 (goals, tasks, profiles.timezone, daily_briefings) — prerequisite

6.3.1.1.1  (assembly library)
    └─► 6.3.1.1.2  (cron endpoint + Vercel config)
    └─► 6.3.1.2.1  (extend briefing poll endpoint)
           └─► 6.3.1.2.2  (tray handles weekly type)
    └─► 6.3.1.3.1  (Today/Briefing UI section)   [needs endpoint from 6.3.1.2.1]
    └─► 6.3.1.4.1  (generate_weekly_review tool)
```

**Critical path:** Assembly library (6.3.1.1.1) → cron endpoint (6.3.1.1.2) + briefing poll extension (6.3.1.2.1). UI, tray, and tool tasks parallelize after the assembly library is done.

## Definition of Done

- Friday 5pm Vercel Cron fires successfully in a non-production environment; a `daily_briefings` row with `type = 'weekly'` and accurate wins/blockers/next-week content is written.
- Idempotency verified: running the cron twice in the same ISO week produces one row (upsert confirmed).
- Tray fires exactly one notification per week with the correct wins count; re-polling does not re-fire (`was_delivered` set correctly).
- Today/Briefing page renders the weekly review section with all three subsections when data exists; section is absent when no review is stored.
- `generate_weekly_review` tool returns the stored review; `force_regenerate = true` assembles and returns a fresh review.
- Unit tests cover: wins query (boundary at exactly 7 days), blockers query (overdue and declining-momentum goals), next-week-focus ranking, idempotent upsert, optional Haiku phrasing failure does not block storage.
- Integration test: cron endpoint HTTP 401 on bad secret; HTTP 200 with valid secret produces a `daily_briefings` row.
- Accessibility: weekly review section passes keyboard nav and has correct heading hierarchy.
- TypeScript strict-mode passes with no new errors.
- `CRON_SECRET` not hardcoded; model IDs sourced from existing constants.

## Infrastructure Specifications

### Database

**Reuses `daily_briefings` from Epic 4.** No new tables required.

**Key schema extension:**
```sql
-- daily_briefings must support type = 'weekly'
-- Assumed existing columns: id, user_id, type, content, was_delivered, briefing_date, created_at
-- New unique constraint to enforce one-per-week:
ALTER TABLE daily_briefings
  ADD CONSTRAINT uq_daily_briefings_user_type_week
  UNIQUE (user_id, type, date_trunc('week', briefing_date)::date);
```

If `daily_briefings` does not yet have the `type` column or was not built in Epic 4, this wave adds it via migration. Migration name: `<timestamp>_add_weekly_type_to_daily_briefings`.

**`content` format (JSON):**
```json
{
  "wins": [{ "task_id": "...", "title": "...", "goal_title": "..." }],
  "blockers": [{ "type": "overdue_task|declining_goal", "title": "...", "detail": "..." }],
  "next_week": [{ "task_id": "...", "title": "...", "due_at": "...", "priority": "..." }],
  "narrative": "Optional Haiku-generated paragraph (may be absent)"
}
```

**RLS:** All queries user-scoped; cron writes via service-role client.

### API

**Cron endpoint:**

| Attribute | Value |
|---|---|
| Method | `POST` |
| Path | `/api/cron/weekly-review` |
| Auth | `Authorization: Bearer ${CRON_SECRET}` |
| Request body | none |
| Response 200 | `{ usersProcessed: number, reviewsStored: number }` |
| Response 401 | `{ error: "Unauthorized" }` |
| Response 500 | `{ error: string }` |
| Idempotency | Upsert on `(user_id, type, week)`; safe to retry |
| Error handling | Per-user errors logged; job continues |

**Briefing poll extension (`/api/briefing/today`):**

Returns both `type = 'daily'` and `type = 'weekly'` rows for the current user; `type` field distinguishes them. Existing tray and web consumers must handle the new type gracefully (additive change).

**Deliver endpoint:**

| Attribute | Value |
|---|---|
| Method | `POST` |
| Path | `/api/briefing/[id]/deliver` |
| Auth | Supabase SSR session; RLS enforced |
| Response 200 | `{ delivered: true }` |
| Response 404 | not found or not owned by user |

**`generate_weekly_review` tool handler:**

| Attribute | Value |
|---|---|
| Input | `{ force_regenerate?: boolean }` |
| Returns | Structured summary string for chat display, or no-review-found message |
| Auth | `userId` from chat engine session; service-role for DB queries |
| LLM | Optional Haiku phrasing only when `force_regenerate = true` and data is non-empty |

### UI

**`WeeklyReviewSection` component:**

```typescript
interface WeeklyReviewSectionProps {
  wins: Array<{ title: string; goalTitle?: string }>
  blockers: Array<{ type: string; title: string; detail: string }>
  nextWeek: Array<{ title: string; dueAt: string; priority: string }>
  narrative?: string
  generatedAt: string
}
```

- Rendered below standard daily sections in the Today/Briefing page on Fridays when data exists.
- Uses standard heading hierarchy (`h2` for "Weekly Review", `h3` for each subsection).
- Lists are `<ul>` with appropriate ARIA labels.
- `narrative` displayed as a blockquote or secondary paragraph if present; not the primary heading.
- `prefers-reduced-motion` respected for any animation.

### Testing

- **Unit — wins query:** Task completed exactly 7 days ago → included; task completed 7 days 1 hour ago → excluded.
- **Unit — blockers query:** Task with `due_at` yesterday → included; task due tomorrow → excluded. Goal with `momentum = 'declining'` → included.
- **Unit — next-week focus:** Returns at most 5 tasks; ordered by priority (urgent > high) then `due_at`.
- **Unit — idempotent upsert:** Calling assembly twice in the same ISO week produces one DB row.
- **Unit — Haiku failure:** Assembly completes without narrative if Anthropic API is unavailable; no exception propagates to the cron response.
- **Integration — cron endpoint:** HTTP 401 on missing/wrong secret; HTTP 200 with valid secret; row created in `daily_briefings`.
- **Integration — deliver endpoint:** `was_delivered` transitions from false to true; second call is a no-op.
- **Accessibility:** Weekly review section passes automated a11y scan; heading hierarchy correct.
- **Coverage target:** 80% line coverage on `lib/jobs/weekly-review.ts`.

### Deployment

**Vercel Cron entry:**
```json
{ "path": "/api/cron/weekly-review", "schedule": "0 17 * * 5" }
```
(Friday at 17:00 UTC. For timezone-aware delivery, the job runs once and applies per-user timezone offset logic to determine if it is currently "5pm" for a given user — or, simpler at v1, fire at 17:00 UTC and accept ± a few hours offset for non-UTC users.)

**Environment variables:** `CRON_SECRET` (existing); `ANTHROPIC_API_KEY` (existing, needed for optional Haiku phrasing).

**Migration:** Applied via `npx supabase db push` before the cron is activated; unique constraint migration is additive and safe.

### Monitoring

- **Weekly review delivery rate:** Count of `daily_briefings` rows with `type = 'weekly'` and `was_delivered = true` per week; alert if zero on any Friday with active users.
- **Review accuracy:** Spot-check wins count against `tasks.completed_at` for the past 7 days; verified manually at first run.
- **Haiku phrasing success rate:** Count of reviews with a non-null `narrative`; alert on consistent failures (suggests API key issue).
- **Cron health:** Vercel dashboard execution status for `/api/cron/weekly-review`.

## Handoff Requirements

- Epic 4 `daily_briefings` table must exist with `user_id`, `type`, `content`, `was_delivered`, `briefing_date` columns before this wave starts.
- `profiles.timezone` must be populated for the user (or a UTC default must be acceptable for v1 delivery).
- `CRON_SECRET` must be set in the Vercel production environment.
- The `generate_weekly_review` tool must be seeded into `tool_permissions` for existing users after deployment.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Epic 4 `daily_briefings` not built | High | Med | Wave is blocked on Epic 4; explicit prerequisite; migration covers the `type = 'weekly'` extension |
| Haiku phrasing makes incorrect claims | Med | Low | Structured sections are always persisted and displayed; Haiku output is additive only; can be disabled |
| Timezone-aware delivery complexity | Low | Med | V1 ships at UTC 17:00 with documented offset behavior; per-user scheduling deferred to a future wave |
| Empty week (no task completions) | Low | High (early weeks) | Empty wins section is valid; blockers and next-week sections still render; review is not suppressed |
| `daily_briefings` unique constraint conflicts with Epic 4 daily rows | Low | Low | Unique constraint is on `(user_id, type, date_trunc('week', briefing_date))`; daily rows are `type = 'daily'` and unaffected |

## Related Documentation

- Epic: `docs/implementation/_main/epic-6-proactive-intelligence.md` — Feature 6.3
- Architecture: `docs/architecture/_main/04-Architecture.md` — §14.4 (`daily_briefings`), jobs/cron, ADR-008 (deterministic-assembly ethos)
- ADR-010: `docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md`
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` — Feature 8, UC-38
- UX: `docs/architecture/_main/05-User-Experience.md` — Today/Briefing screen, calm proactivity
- Blueprint: `docs/planning/2026-06-24-coriven-master-blueprint.md` — §12.3
