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
epic: "4"
feature: "4.3"
wave: "4.3.1"
agents: []
tags: [coriven, momentum, stale-goal, nudge, cron, jobs, scheduled]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
---

# Wave 4.3.1: Momentum & Stale-Goal Nudge

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 4.3.1 |
| Feature | 4.3 — Momentum & Stale-Goal Nudge |
| Epic | 4 — Goal-Driven Organization |
| Status | Planning |
| Scope | Nightly momentum-recompute job (`lib/jobs/`), stale-goal nudge logic (14-day threshold, once per 7-day period), `POST /api/cron/nightly` endpoint protected by `CRON_SECRET`, Vercel Cron schedule |
| Wave Goal | Nightly compute the momentum score for every active goal and write it to `goals.momentum`; fire a single nudge entry into `daily_briefings.content` for goals that have had no task activity in 14 days |

**Wave Philosophy.** Scheduled, stored, never real-time — per ADR-010, momentum is computed on a nightly cadence and written to the database; the request path never re-derives it.

---

## Wave Goals

1. **Nightly correctness** — `goals.momentum` is updated for every `status = 'active'` goal belonging to every user each night, using the blueprint §7.3 formula, with the correct `improving / stable / declining` classification.
2. **Stale-goal nudge reliability** — a goal with zero task activity for 14 consecutive days receives exactly one nudge per 7-day period; the nudge is stored in a way that the daily briefing (Wave 4.4.1) can surface it.
3. **Security and idempotency** — the cron endpoint is gated by `CRON_SECRET`; double-fires in the same night produce no duplicate state changes (idempotent writes; timestamp guards).

---

## User Stories

### Story 4.3.1.1 — Nightly Momentum Recompute Job

**As** the system,
**I want** a nightly job that recalculates `goals.momentum` for every active goal using the formula `(tasks_completed_7d - tasks_created_7d) / max(tasks_created_7d, 1)`,
**so that** the Goals dashboard always shows a momentum state that reflects the last 7 days of task activity.

**Acceptance Criteria:**

- The job queries all goals with `status = 'active'` across all users.
- For each goal, it counts tasks completed in the last 7 days (`completed_at >= now() - 7 days`) and tasks created in the last 7 days (`created_at >= now() - 7 days`) that are linked to the goal (via `goal_id` or via a project whose `goal_id` matches).
- The momentum score is computed as `(completed_7d - created_7d) / max(created_7d, 1)`.
- Score `> 0.2` → `'improving'`; score `< -0.2` → `'declining'`; otherwise `'stable'`.
- `goals.momentum` is updated to the computed value; `goals.last_activity_at` is updated to `now()` if any task was completed or created in the window.
- A goal with zero tasks created and zero tasks completed in the window receives `'stable'` (denominator is `max(0, 1) = 1`; score is `0`).
- The job writes a structured log entry per batch: `{ run_at, goals_processed, goals_updated, errors }`.
- The job does not call any LLM (ADR-010: scheduled, not real-time; ADR-008: no LLM in jobs).
- Job execution time ≤ 30 seconds for up to 1,000 active goals (acceptable at personal scale).

**Priority:** High
**Estimated Hours:** 7h
**References:** Business Requirements Feature 1; UC-5; Architecture §Cron Jobs; ADR-010; blueprint §7.3.

#### Task 4.3.1.1.1 — Momentum Job Implementation

**Parent Story:** 4.3.1.1
**Agent:** Backend
**Estimation:** 7h
**Dependencies:** Wave 4.1.1 complete (`goals`, `tasks` tables with `goal_id` column exist); `createServiceClient` available for server-side DB access.
**Deliverables:** `apps/web/src/lib/jobs/momentum.ts` (the job function); unit tests for the formula.
**Acceptance Criteria:**
- Exported function `recomputeMomentum(): Promise<{ goalsProcessed: number; goalsUpdated: number; errors: string[] }>`.
- Uses `createServiceClient` (service role) — RLS is bypassed intentionally for this system job; the function is never called from a user-facing route.
- Counts tasks by joining through both `tasks.goal_id = goal.id` and `tasks.project_id IN (projects where goal_id = goal.id)` to catch tasks linked via projects.
- Performs batch updates using `supabase.from('goals').upsert(rows)` or individual updates; does not issue more than one round-trip per goal.
- If an individual goal update fails (e.g., constraint violation), the error is logged and the job continues with the next goal — partial success is acceptable.
- The momentum formula is extracted into a pure function `computeMomentum(completed: number, created: number): 'improving' | 'stable' | 'declining'` that is unit-testable without any DB dependency.
- `npm run typecheck` passes; no `any` casts.

---

### Story 4.3.1.2 — Stale-Goal Nudge Logic

**As** the system,
**I want** a nudge to be stored for any active goal that has had zero task activity for 14 consecutive days, firing at most once per 7-day period,
**so that** the daily briefing can surface the stale goal without repeating the nudge every single day.

**Acceptance Criteria:**

- A goal is "stale" if: `status = 'active'` AND no task with `goal_id = goal.id` (or linked via a project) has been created or completed in the last 14 days.
- A nudge fires only if `goals.last_nudge_at IS NULL OR goals.last_nudge_at < now() - 7 days`.
- When a nudge fires, `goals.last_nudge_at` is updated to `now()`.
- The nudge is stored as a structured entry in `goals.last_nudge_at` (timestamp) so the briefing assembler (Wave 4.4.1) can detect recently-nudged goals and include them in the "Stalled" section.
- A single nudge run does not fire more than one entry per goal per 7-day period, even if the job runs multiple times (idempotent via the `last_nudge_at` timestamp guard).
- The nudge logic runs within the same nightly job as the momentum recompute (not a separate cron trigger).
- The job logs `{ stale_goals_detected: number, nudges_fired: number }` alongside the momentum log.

**Priority:** High
**Estimated Hours:** 4h
**References:** Business Requirements Feature 1; UC-40; Architecture §Cron Jobs; ADR-010; blueprint §7.3, §12.2.

#### Task 4.3.1.2.1 — Stale-Goal Detection and Nudge in the Nightly Job

**Parent Story:** 4.3.1.2
**Agent:** Backend
**Estimation:** 4h
**Dependencies:** Task 4.3.1.1.1 (momentum job function exists; task-count query pattern reused).
**Deliverables:** Stale-goal logic added to `apps/web/src/lib/jobs/momentum.ts` (or extracted to `apps/web/src/lib/jobs/nudge.ts` if it improves readability); exported alongside `recomputeMomentum`.
**Acceptance Criteria:**
- Pure function `isStale(lastActivityAt: Date | null, thresholdDays: number): boolean` — testable without DB.
- Pure function `shouldNudge(lastNudgeAt: Date | null, cooldownDays: number): boolean` — testable without DB.
- DB write uses `createServiceClient`; updates `goals.last_nudge_at = now()` for stale goals that pass the cooldown check.
- `npm run typecheck` passes; unit tests cover: stale+cooldown passed (nudge fires), stale+cooldown not passed (no nudge), not stale (no nudge), first run with null `last_nudge_at` (nudge fires after 14 days).

---

### Story 4.3.1.3 — Nightly Cron Endpoint

**As** the system,
**I want** a `POST /api/cron/nightly` endpoint protected by `CRON_SECRET` that runs the momentum and nudge jobs,
**so that** Vercel Cron can invoke the logic on a schedule without exposing it to unauthenticated callers.

**Acceptance Criteria:**

- `POST /api/cron/nightly` returns HTTP 401 if the `Authorization: Bearer <token>` header does not match the `CRON_SECRET` environment variable.
- `CRON_SECRET` is read exclusively from `process.env.CRON_SECRET`; it is never hard-coded.
- On successful auth, the endpoint calls `recomputeMomentum()` and the nudge logic sequentially; returns HTTP 200 with a JSON summary `{ goalsProcessed, goalsUpdated, nudgesFired, errors }`.
- If the momentum job throws an unhandled error, the endpoint returns HTTP 500 and logs the error; it does not crash the serverless function.
- The endpoint is listed in `vercel.json` cron config to run at `0 12 * * *` UTC (midnight UTC = approximately 7am US Central, close enough for nightly; timezone-specific briefing cron is in Wave 4.4.1).
- The endpoint is never exposed without the `CRON_SECRET` check; the check runs before any DB access.
- An idempotency guard: if the job has already run in the current UTC day (check by querying a simple timestamp or using a DB flag), the endpoint returns HTTP 200 with `{ skipped: true }` rather than re-running.

**Priority:** High
**Estimated Hours:** 5h
**References:** Architecture §Cron Jobs; Business Requirements NFR (CRON_SECRET); ADR-010; UC-5; UC-40.

#### Task 4.3.1.3.1 — `POST /api/cron/nightly` Route

**Parent Story:** 4.3.1.3
**Agent:** Backend
**Estimation:** 5h
**Dependencies:** Task 4.3.1.1.1 and Task 4.3.1.2.1 (job functions must exist and be importable).
**Deliverables:** `apps/web/src/app/api/cron/nightly/route.ts`; updated `vercel.json` cron config.
**Acceptance Criteria:**
- `Authorization: Bearer ${CRON_SECRET}` check is the first statement in the handler; returns `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` on mismatch.
- `CRON_SECRET` sourced only from `process.env.CRON_SECRET`; a missing env var causes the check to always fail (safe default).
- Cron entry in `vercel.json`: `{ "path": "/api/cron/nightly", "schedule": "0 12 * * *" }`.
- Response body typed: `{ goalsProcessed: number; goalsUpdated: number; nudgesFired: number; errors: string[]; skipped?: boolean }`.
- Structured log at the start and end of the handler: `console.log(JSON.stringify({ event: 'cron.nightly.start', runAt: new Date().toISOString() }))`.
- `npm run typecheck` passes.

---

### Story 4.3.1.4 — Momentum Formula Unit Tests

**As** a developer,
**I want** the momentum formula and nudge logic covered by unit tests,
**so that** I can refactor the job with confidence and verify threshold behavior without running the full cron pipeline.

**Acceptance Criteria:**

- `computeMomentum(completed, created)` is tested for: `(5, 3)` → `'improving'`; `(1, 5)` → `'declining'`; `(2, 3)` → `'stable'`; `(0, 0)` → `'stable'`; `(1, 0)` → `'improving'` (created denominator = max(0,1) = 1).
- `isStale(null, 14)` with a `lastActivityAt` of 15 days ago → `true`; 13 days ago → `false`.
- `shouldNudge(null, 7)` → `true` (first run); `shouldNudge(date 3 days ago, 7)` → `false`; `shouldNudge(date 8 days ago, 7)` → `true`.
- Tests run with `npm test` (or equivalent configured test runner); no external services required.
- All four momentum formula tests and all six nudge tests pass; zero failures.

**Priority:** High
**Estimated Hours:** 3h
**References:** Blueprint §7.3; ADR-010.

#### Task 4.3.1.4.1 — Write Formula and Nudge Unit Tests

**Parent Story:** 4.3.1.4
**Agent:** Backend
**Estimation:** 3h
**Dependencies:** Task 4.3.1.1.1 and Task 4.3.1.2.1 (pure functions must be exported).
**Deliverables:** Test file(s) covering `computeMomentum`, `isStale`, `shouldNudge`; placed alongside the job file or in a `__tests__/` sibling directory.
**Acceptance Criteria:**
- No mocking of Supabase required (pure functions under test have no DB dependency).
- Tests are discoverable by the project's configured test runner (e.g., Vitest or Jest).
- All assertions use descriptive test names that reference the formula thresholds.

---

## Task Dependencies

```
Task 4.3.1.1.1  (momentum job — pure functions + DB logic)
    └──► Task 4.3.1.2.1  (nudge logic — reuses task-count queries)
              └──► Task 4.3.1.3.1  (cron route — imports both job functions)

Task 4.3.1.1.1  ──► Task 4.3.1.4.1  (unit tests — require exported pure functions)
Task 4.3.1.2.1  ──► Task 4.3.1.4.1  (nudge tests — require exported pure functions)
```

**Critical path:** momentum job → nudge logic → cron endpoint.
**Parallelizable:** unit tests (Task 4.3.1.4.1) can begin once the pure functions are defined (after Task 4.3.1.1.1 is drafted, even before DB integration is complete).
**Prerequisite:** Wave 4.1.1 must be fully applied (tables, `goal_id` on `tasks`, `last_nudge_at` on `goals`).

---

## Definition of Done

- [ ] `POST /api/cron/nightly` with an invalid token returns HTTP 401.
- [ ] `POST /api/cron/nightly` with the correct `CRON_SECRET` returns HTTP 200 and a summary JSON body.
- [ ] After the endpoint fires, `goals.momentum` for an active goal with 5 completed tasks and 2 created tasks in the last 7 days is `'improving'`.
- [ ] A goal with zero task activity for 15 days and `last_nudge_at IS NULL` has `last_nudge_at` updated to within 1 second of the job run time.
- [ ] Firing the endpoint twice in the same UTC day returns `{ skipped: true }` on the second call; `goals.momentum` is unchanged.
- [ ] `computeMomentum`, `isStale`, `shouldNudge` unit tests all pass with `npm test`.
- [ ] `npm run typecheck` passes across the monorepo.
- [ ] `vercel.json` cron entry for `/api/cron/nightly` at `0 12 * * *` is present and syntactically valid.
- [ ] No `CRON_SECRET` value appears anywhere in source code or test files.
- [ ] Structured log entry visible in Vercel function logs after a manual trigger.

---

## Infrastructure Specifications

### Database

No new tables. Writes to columns added in Wave 4.1.1:
- `goals.momentum` — updated nightly.
- `goals.last_activity_at` — updated when task activity detected in the 7-day window.
- `goals.last_nudge_at` — updated when a stale-goal nudge fires.

Key query pattern for task counts (per goal):
```sql
SELECT
  COUNT(*) FILTER (WHERE completed_at >= now() - interval '7 days') AS completed_7d,
  COUNT(*) FILTER (WHERE created_at  >= now() - interval '7 days') AS created_7d
FROM tasks
WHERE goal_id = $1
   OR project_id IN (SELECT id FROM projects WHERE goal_id = $1)
```
Executed via the Supabase RPC or inline JS query; service-role client bypasses RLS.

Idempotency guard: the cron endpoint checks if any goal was updated in the current UTC day by querying `SELECT max(updated_at) FROM goals WHERE updated_at::date = current_date`; if results exist, returns `{ skipped: true }`. Alternatively, maintain a `cron_runs` table — deferred to Epic 6; for now, the `updated_at` timestamp check is sufficient.

### API

**`POST /api/cron/nightly`**
- Method: POST
- Auth: `Authorization: Bearer <CRON_SECRET>` header; no user session required.
- Request body: empty.
- Response (200): `{ goalsProcessed: number; goalsUpdated: number; nudgesFired: number; errors: string[]; skipped?: boolean }`.
- Response (401): `{ error: 'Unauthorized' }`.
- Response (500): `{ error: 'Internal error'; details: string }`.
- Validation: no input to validate beyond the auth token.
- Vercel Cron config: `{ "path": "/api/cron/nightly", "schedule": "0 12 * * *" }` in `vercel.json`.

**Environment variable required:** `CRON_SECRET` — must be set in Vercel project settings and `.env.local` (not committed; present in `.env.example`).

### UI

No new UI in this wave. The `GoalCard` momentum badge (Wave 4.2.1) will display updated values after the nightly job runs; no UI change required.

### Testing

- **Unit:** `computeMomentum` formula — all 5 boundary cases.
- **Unit:** `isStale` — 4 cases covering null, under threshold, over threshold.
- **Unit:** `shouldNudge` — 4 cases covering null, within cooldown, past cooldown.
- **Integration:** nightly endpoint called with correct token against a seeded test database; assert `goals.momentum` updated and `goals.last_nudge_at` set for a stale goal.
- **Security:** endpoint called without token → 401; endpoint called with wrong token → 401.
- **Idempotency:** endpoint called twice in sequence → second call returns `{ skipped: true }` and does not overwrite `momentum`.
- **Timezone:** tests do not depend on local machine timezone; all date arithmetic uses UTC.
- **Coverage target:** job logic ≥ 80% line coverage; pure functions 100%.

### Deployment

- `CRON_SECRET` must be added to Vercel project environment variables before deploying this wave.
- `.env.example` must include `CRON_SECRET=` as a required variable with a comment.
- `vercel.json` cron entry is version-controlled; Vercel reads it on deploy to configure the scheduler.
- Wave 4.1.1 migration must be applied before this wave is promoted to production (job will error if `goals.momentum` column is missing).

### Monitoring

- Structured log at start of cron handler: `{ event: 'cron.nightly.start', runAt }`.
- Structured log at end: `{ event: 'cron.nightly.complete', goalsProcessed, goalsUpdated, nudgesFired, errors, durationMs }`.
- Alert on HTTP 500 response from the cron endpoint (Vercel function log monitoring).
- Track `nudgesFired` over time; a value of 0 every night may indicate a logic bug if the user has stale goals.

---

## Handoff Requirements

- Wave 4.4.1 (Briefing) reads `goals.momentum` and `goals.last_nudge_at` to assemble the "Goals in Motion" and "Stalled" sections; those fields must be populated before the first briefing is useful.
- Epic 6 (Proactive) will extend the nightly job with pattern detection; the `recomputeMomentum` function is the template for future job functions in `lib/jobs/`.
- The cron endpoint may be extended in Wave 4.4.1 to also trigger briefing generation for all users, or a separate briefing cron endpoint can be added — this is resolved in Wave 4.4.1.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Task counts include tasks linked via projects whose `goal_id` differs | Medium | Low | Query uses both `tasks.goal_id = goal.id` and `tasks.project_id IN (SELECT id FROM projects WHERE goal_id = goal.id)` — test with tasks linked both ways |
| Cron double-fires in the same night (Vercel retries on transient failure) | Medium | Low | `skipped: true` idempotency guard on `updated_at::date` prevents momentum overwrites |
| `CRON_SECRET` not set in production — endpoint always returns 401 | High | Low | Add `CRON_SECRET` to the deploy checklist; `.env.example` documents it as required |
| Nightly job takes > 30s for large user bases (not a concern at personal scale) | Low | Low | Acceptable at per-user scale; revisit with pagination if user count grows |
| UTC cron at `0 12 * * *` fires at noon UTC — wrong time for personal use | Low | Medium | This endpoint updates momentum (any time is fine); briefing cron (timezone-aware) is Wave 4.4.1 |

---

## Related Documentation

- Blueprint §7.3: momentum formula (`(completed_7d - created_7d) / max(created_7d, 1)`); thresholds (>0.2 improving, <-0.2 declining).
- Blueprint §12.2: stale-goal nudge (14 days, once per 7 days).
- ADR-010: scheduled jobs over real-time computation.
- Business Requirements UC-5 (complete task → momentum updates), UC-40 (stale-goal nudge).
- Architecture §Cron Jobs: `CRON_SECRET` protection; `lib/jobs/` location.
- Existing migration style: `supabase/migrations/20260620140813_add_task_reminders_table.sql`.
