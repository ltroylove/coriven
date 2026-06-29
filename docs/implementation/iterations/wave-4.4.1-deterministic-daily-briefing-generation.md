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
feature: "4.4"
wave: "4.4.1"
agents: []
tags: [coriven, briefing, daily-briefing, cron, timezone, deterministic, generation]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-008-deterministic-daily-briefing.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
---

# Wave 4.4.1: Deterministic Daily Briefing — Generation

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 4.4.1 |
| Feature | 4.4 — Deterministic Daily Briefing |
| Epic | 4 — Goal-Driven Organization |
| Status | Planning |
| Scope | Deterministic briefing-assembly service (`lib/jobs/briefing.ts`), `POST /api/cron/daily-briefing` (CRON_SECRET-protected, timezone-windowed, upserts `daily_briefings`), timezone and briefing-time columns on `profiles` with Settings UI, `isInBriefingWindow` helper with unit tests |
| Wave Goal | Produce one correct, deterministic `daily_briefings` row per user per day at the user's configured local briefing time, with no LLM call at any step — establishing the data contract consumed by Wave 4.4.2 delivery |

**Wave Philosophy.** Determinism over prose — per ADR-008, a stable, testable template assembled from database queries is faster, cheaper, and more reliable than a model-generated summary; the user can always ask for elaboration in chat. Generation and delivery are separated so the assembly pipeline can be tested and verified before the tray and UI are wired up.

---

## Wave Goals

1. **No LLM in the briefing pipeline** — assembly reads from `goals`, `tasks`, `task_reminders`, and `daily_briefings` only; zero model calls (ADR-008); on-demand elaboration remains a chat query.
2. **Timezone correctness** — the UTC cron skips users whose local time is outside a ±30-minute window of their configured briefing time; briefings are never generated at the wrong hour.
3. **Idempotent storage** — `daily_briefings` uses `ON CONFLICT (user_id, briefing_date) DO NOTHING`; a user receives at most one briefing row per day regardless of how many times the cron fires.

---

## User Stories

### Story 4.4.1.1 — Briefing Assembly Service

**As** the system,
**I want** a function that assembles a structured daily briefing from database queries with no LLM call,
**so that** the briefing is fast, free, testable, and reflects the database exactly.

**Acceptance Criteria:**

- The assembly function produces a `BriefingContent` JSON object with four sections: `goalsInMotion`, `upcoming`, `stalled`, `approvalsPending`.
- `goalsInMotion` — active goals with `momentum IN ('improving', 'stable')`; each entry: `{ goalId, title, momentum, linkedTaskCount }`.
- `upcoming` — tasks (with reminders) due in the next 7 days for the user; sorted ascending by due/remind date; each entry: `{ taskId, title, dueAt }`.
- `stalled` — active goals where `last_nudge_at` was updated in the last 7 days (the nightly job detected stale activity); each entry: `{ goalId, title, daysSinceActivity }`.
- `approvalsPending` — count of rows in `approval_queue` with `status = 'pending'` for the user (returns `0` if the `approval_queue` table does not yet exist — defensive query).
- No section is ever `undefined`; missing data yields an empty array or `0`.
- The function does not call any Anthropic or OpenAI API (ADR-008).
- Assembly completes in under 500ms for a user with up to 200 tasks and 20 active goals.

**Priority:** High
**Estimated Hours:** 7h
**References:** Business Requirements Feature 5; UC-8; ADR-008; UX §Today/Briefing screen wireframe.

#### Task 4.4.1.1.1 — Implement `assembleBriefing(userId)` in `lib/jobs/briefing.ts`

**Parent Story:** 4.4.1.1
**Agent:** Backend
**Estimation:** 7h
**Dependencies:** Wave 4.1.1 (`goals`, `tasks`, `daily_briefings` tables exist); Wave 4.3.1 (`goals.momentum` and `goals.last_nudge_at` populated by nightly job); `createServiceClient` available.
**Deliverables:** `apps/web/src/lib/jobs/briefing.ts` exporting `assembleBriefing(userId: string): Promise<BriefingContent>` and the `BriefingContent` type.
**Acceptance Criteria:**
- `BriefingContent` type is exported from `briefing.ts` and imported by both the cron route and (in Wave 4.4.2) the `GET /api/briefing/today` route.
- `approvalsPending` query is wrapped in a `try/catch`; returns `0` if `approval_queue` does not exist; no unhandled promise rejection.
- All DB queries use `createServiceClient`; no user-session dependency (called from cron context).
- The `generate_daily_briefing` tool handler stub (Wave 4.1.1) is updated to call `assembleBriefing` for the requesting user's ID and return the briefing JSON.
- `npm run typecheck` passes; `BriefingContent` is not typed as `any`.

---

### Story 4.4.1.2 — Briefing Cron Endpoint with Timezone Windowing

**As** the system,
**I want** a `POST /api/cron/daily-briefing` endpoint that iterates over all users, checks whether their local time is within a ±30-minute window of their briefing time (default 7:00 AM), assembles the briefing, and upserts a `daily_briefings` row,
**so that** each user receives their briefing at the right local time regardless of when the UTC cron fires.

**Acceptance Criteria:**

- Endpoint is protected by `Authorization: Bearer <CRON_SECRET>`; returns HTTP 401 on mismatch.
- `CRON_SECRET` is read only from `process.env.CRON_SECRET`; never hard-coded.
- For each user, the endpoint reads `profiles.timezone` (IANA timezone string, e.g., `"America/Chicago"`) and `profiles.briefing_time` (time string, e.g., `"07:00"`); both default to `"America/Chicago"` / `"07:00"` if null.
- A user is "in window" if their current local time (derived from `profiles.timezone`) is within ±30 minutes of `profiles.briefing_time`.
- Only in-window users receive briefing generation in a given run.
- `daily_briefings` is upserted via `INSERT ... ON CONFLICT (user_id, briefing_date) DO NOTHING` — a user gets at most one briefing row per day.
- The endpoint returns HTTP 200 with `{ usersProcessed, briefingsGenerated, briefingsSkipped, errors }`.
- The Vercel Cron schedule in `vercel.json` fires every 30 minutes: `"*/30 * * * *"` — ensuring every user's window is covered regardless of timezone offset.
- The endpoint does not call any LLM; it delegates all content assembly to `assembleBriefing(userId)`.
- If `assembleBriefing` throws for one user, the error is logged and the batch continues with the next user.

**Priority:** High
**Estimated Hours:** 8h
**References:** Business Requirements Feature 5; UC-8; UC-18; ADR-008; ADR-010; Architecture §Cron Jobs.

#### Task 4.4.1.2.1 — `POST /api/cron/daily-briefing` Route

**Parent Story:** 4.4.1.2
**Agent:** Backend
**Estimation:** 8h
**Dependencies:** Task 4.4.1.1.1 (assembly function); Wave 4.1.1 (`daily_briefings` table with unique constraint on `(user_id, briefing_date)`); Story 4.4.1.3 (timezone columns on `profiles` must exist before this route reads them).
**Deliverables:** `apps/web/src/app/api/cron/daily-briefing/route.ts`; `vercel.json` updated with the cron entry.
**Acceptance Criteria:**
- Auth check is the first statement in the handler; fails closed (default deny).
- Timezone window check uses a pure helper `isInBriefingWindow(timezone: string, briefingTime: string, now: Date, windowMinutes: number): boolean` extracted to `apps/web/src/lib/utils/timezone.ts` — testable without DB access.
- Users fetched with `createServiceClient` via `profiles.select('id, timezone, briefing_time')`; no passwords or tokens in scope.
- `assembleBriefing(userId)` called only for in-window users.
- `daily_briefings` insert: `{ user_id, briefing_date: today_in_user_tz, content: briefingJson, was_delivered: false }` with `ON CONFLICT (user_id, briefing_date) DO NOTHING`.
- Structured log per run: `{ event: 'cron.briefing.complete', usersProcessed, briefingsGenerated, durationMs }`.
- `vercel.json` cron entry: `{ "path": "/api/cron/daily-briefing", "schedule": "*/30 * * * *" }`.
- `npm run typecheck` passes.

---

### Story 4.4.1.3 — Timezone and Briefing Time Settings

**As** the owner,
**I want** to configure my timezone and briefing time in Settings,
**so that** the cron generates my briefing at the right local hour.

**Acceptance Criteria:**

- `profiles` table gains two nullable columns: `timezone text` (IANA timezone, default `'America/Chicago'`) and `briefing_time text` (HH:MM format, default `'07:00'`).
- A migration adds these columns with `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS`.
- The Settings page includes a "Briefing" section with a timezone dropdown (populated from a curated list of common IANA timezones, not all 500+) and a time picker (HH:MM).
- Saving updates `profiles.timezone` and `profiles.briefing_time` via a Server Action; revalidates the settings page.
- If not set by the user, the defaults are used by the cron endpoint without error.
- The timezone selector is accessible: keyboard-navigable `<select>` element with a `<label>`; WCAG AA compliant.

**Priority:** Medium
**Estimated Hours:** 5h
**References:** Business Requirements UC-18; Architecture §Cron Jobs (timezone-aware); UX §Settings (Briefing time/timezone).

#### Task 4.4.1.3.1 — Timezone Columns Migration and Settings UI

**Parent Story:** 4.4.1.3
**Agent:** Backend/Frontend
**Estimation:** 5h
**Dependencies:** Wave 4.1.1 (`profiles` table exists; migration naming must be later than existing migrations).
**Deliverables:** Migration `YYYYMMDDHHMMSS_add_profile_timezone_briefing_time.sql`; updated settings page section; `updateBriefingSettings` Server Action in `apps/web/src/app/actions/profile.ts`.
**Acceptance Criteria:**
- Migration: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Chicago'`; `ADD COLUMN IF NOT EXISTS briefing_time text DEFAULT '07:00'`.
- Migration is idempotent; applies cleanly alongside existing `profiles` RLS policies — no new RLS policy is needed.
- Settings page renders a "Briefing Time" section with `<select>` for timezone and `<input type="time">` for briefing time.
- Curated timezone list includes at minimum all US timezones, UTC, and common European/Asian zones (minimum 20 entries).
- `updateBriefingSettings(timezone, briefingTime)` Server Action: validates `timezone` against the allowed list; validates `briefingTime` matches `/^\d{2}:\d{2}$/`; updates `profiles`; revalidates the settings path.
- `npm run typecheck` passes; types regenerated after migration.

---

### Story 4.4.1.4 — Timezone Windowing Unit Tests

**As** a developer,
**I want** the `isInBriefingWindow` helper covered by unit tests including DST boundary cases,
**so that** I can verify that users are correctly included or excluded from a given cron run without deploying to production.

**Acceptance Criteria:**

- `isInBriefingWindow(timezone, briefingTime, now, windowMinutes)` is tested for:
  - User in `America/Chicago` with `briefingTime = '07:00'`; `now` is 7:15 local → in window.
  - Same user; `now` is 9:00 local → out of window.
  - User in `Europe/London` (UTC+1 in summer); `briefingTime = '07:00'`; `now` is 06:00 UTC → in window.
  - User with `null` timezone (defaults to `America/Chicago`); `now` is 7:00 local → in window.
  - Window boundary: `now` is exactly 30 minutes before briefing time → in window; 31 minutes before → out.
  - DST boundary: `America/Chicago` spring-forward date; verify the IANA calculation does not shift by one hour relative to wall-clock briefing time.
- Tests use fixed `Date` objects (not `new Date()`) to avoid test-machine timezone side effects.
- Tests run with `npm test`; no external services required.
- All cases pass; zero failures.

**Priority:** High
**Estimated Hours:** 3h
**References:** ADR-010; Business Requirements UC-18.

#### Task 4.4.1.4.1 — Write `isInBriefingWindow` Unit Tests

**Parent Story:** 4.4.1.4
**Agent:** Backend
**Estimation:** 3h
**Dependencies:** Task 4.4.1.2.1 (`isInBriefingWindow` must be extracted to `apps/web/src/lib/utils/timezone.ts` and exported).
**Deliverables:** Test file `apps/web/src/lib/utils/timezone.test.ts`.
**Acceptance Criteria:**
- `isInBriefingWindow` is imported from `apps/web/src/lib/utils/timezone.ts`.
- DST boundary test uses a known spring-forward date for `America/Chicago` (e.g., 2025-03-09) with a fixed UTC timestamp.
- All boundary cases covered; descriptive test names reference the timezone and direction (e.g., `"America/Chicago — 31 min before briefing time — out of window"`).
- `npm test` exits 0.

---

## Task Dependencies

```
Task 4.4.1.3.1  (timezone migration + settings UI)
    └──► Task 4.4.1.2.1  (cron route reads timezone/briefing_time from profiles)

Task 4.4.1.1.1  (assembleBriefing function)
    └──► Task 4.4.1.2.1  (cron route calls assembleBriefing)

Task 4.4.1.2.1  (cron route — exports isInBriefingWindow via timezone.ts)
    └──► Task 4.4.1.4.1  (unit tests — helper must be exported)
```

**Critical path:** timezone migration → cron route (which requires both the assembly function and the profiles columns) → timezone unit tests.
**Parallelizable:** Task 4.4.1.1.1 (assembly function) and Task 4.4.1.3.1 (migration + settings) can proceed concurrently; they converge at Task 4.4.1.2.1.
**Prerequisite waves:** Wave 4.1.1 (`daily_briefings` table with unique constraint; `profiles` table) and Wave 4.3.1 (`goals.momentum`, `goals.last_nudge_at` populated) must be complete before the first useful briefing is generated.
**Downstream:** Wave 4.4.2 depends on this wave being complete. The `GET /api/briefing/today` endpoint, tray polling, and the `/today` page (all in Wave 4.4.2) require the `daily_briefings` rows produced here and the `BriefingContent` type defined in Task 4.4.1.1.1.

---

## Definition of Done

- [ ] `POST /api/cron/daily-briefing` with an invalid or missing token returns HTTP 401.
- [ ] Firing `POST /api/cron/daily-briefing` with a valid token for a user whose local time is within the ±30-minute window inserts a `daily_briefings` row with `was_delivered = false` and non-null `content`.
- [ ] Firing the same endpoint a second time the same day inserts no additional row (`DO NOTHING` conflict resolution confirmed via query).
- [ ] A user whose local time is outside the ±30-minute window at cron time receives no `daily_briefings` row for that run.
- [ ] `assembleBriefing` returns a `BriefingContent` object with all four sections present and non-null (empty arrays/0 for missing data — never `undefined`).
- [ ] No LLM call appears anywhere in the briefing pipeline (code review: no `anthropic.messages.create` in `lib/jobs/briefing.ts` or the cron route).
- [ ] `CRON_SECRET` does not appear in any source file or test file.
- [ ] Settings page saves timezone and briefing time; next cron run reads the updated values from `profiles`.
- [ ] `isInBriefingWindow` unit tests all pass with `npm test`, including the DST boundary case.
- [ ] `npm run typecheck` passes across the monorepo.
- [ ] `vercel.json` includes the `*/30 * * * *` cron entry for `/api/cron/daily-briefing`.

---

## Infrastructure Specifications

### Database

**Migration for profiles columns:**
```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS briefing_time text NOT NULL DEFAULT '07:00';
```
No new RLS policy needed; the existing `profiles` RLS already covers these columns.

**`daily_briefings` table (created in Wave 4.1.1):**
```
id uuid PK, user_id uuid, briefing_date date, content jsonb NOT NULL,
was_delivered boolean NOT NULL DEFAULT false, delivered_at timestamptz, created_at timestamptz
UNIQUE (user_id, briefing_date)
```

**Key queries (generation side):**
- Fetch all users for cron: `profiles.select('id, timezone, briefing_time')` via service client.
- Assembly — `goals.select('id, title, momentum, status, last_nudge_at, last_activity_at')` + tasks and reminders queries scoped to the user.
- Upsert briefing — `INSERT INTO daily_briefings ... ON CONFLICT (user_id, briefing_date) DO NOTHING`.

### API

**`POST /api/cron/daily-briefing`**
- Method: POST
- Path: `/api/cron/daily-briefing`
- Auth: `Authorization: Bearer <CRON_SECRET>` — no user session.
- Request body: empty.
- Response (200): `{ usersProcessed: number; briefingsGenerated: number; briefingsSkipped: number; errors: string[] }`.
- Response (401): `{ error: 'Unauthorized' }`.
- Vercel Cron schedule: `"*/30 * * * *"` (every 30 minutes) in `vercel.json`.

**Environment variables:**
- `CRON_SECRET` — required; set in Vercel project settings and documented in `.env.example`.

### UI

**Settings — Briefing section:**
- `<select>` for timezone; curated label → IANA value mapping (minimum 20 entries).
- `<input type="time">` for briefing time (HH:MM).
- Save button triggers `updateBriefingSettings` Server Action.
- Confirmation: "Briefing settings saved" toast (aria-live polite).
- Accessible: `<label for>` on both inputs; keyboard-navigable; WCAG AA.

### Testing

- **Unit:** `assembleBriefing` — mock Supabase service client returning known data; assert correct `BriefingContent` structure; assert no Anthropic SDK import in the call graph.
- **Unit:** `isInBriefingWindow` — 6 cases including DST boundary (Story 4.4.1.4).
- **Integration:** cron endpoint with valid token against test DB; assert `daily_briefings` row inserted for an in-window user and skipped for an out-of-window user.
- **Security:** cron endpoint without token → 401; with wrong token → 401.
- **Idempotency:** cron fired twice same day → only one `daily_briefings` row exists.
- **No LLM regression:** assert Anthropic SDK is not imported or called in `lib/jobs/briefing.ts`.
- **Coverage target:** `assembleBriefing` and assembly helpers ≥ 80% line coverage; `isInBriefingWindow` 100%.

### Deployment

- `vercel.json` updated with `daily-briefing` cron entry (alongside nightly from Wave 4.3.1).
- `CRON_SECRET` must be set in Vercel before promoting Wave 4.4.1 code.
- Profiles migration must be applied (`npx supabase db push`) before the cron route reads `profiles.timezone`.
- Supabase TypeScript types regenerated after the profiles migration and committed.
- Wave 4.1.1 and Wave 4.3.1 must be in production before the first useful briefing generates.
- `.env.example` updated to document `CRON_SECRET`.

### Monitoring

- Structured log per cron run: `{ event: 'cron.briefing.complete', usersProcessed, briefingsGenerated, durationMs }`.
- Alert on HTTP 500 from `/api/cron/daily-briefing` (Vercel function log monitoring).
- Track `briefingsGenerated = 0` across multiple consecutive runs — may indicate a timezone windowing bug.

---

## Handoff Requirements

- Wave 4.4.2 (Briefing Delivery) requires this wave to be complete before starting. It consumes: (1) `daily_briefings` rows produced by the cron endpoint, (2) the `BriefingContent` type exported from `lib/jobs/briefing.ts`, and (3) the `GET /api/briefing/today` data contract defined in this wave's Infrastructure Specifications.
- Epic 5 (Communications) will populate `approval_queue`; the `assembleBriefing` defensive query (`try/catch` on the approval count) means Epic 5 can add that table without changing briefing assembly code.
- The `generate_daily_briefing` tool handler (stubbed in Wave 4.1.1) is fully implemented by Task 4.4.1.1.1; chat can return a real briefing JSON after this wave.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| DST transitions cause `isInBriefingWindow` to fire at the wrong hour | Medium | Medium | Use `Intl.DateTimeFormat` (Node 18+ built-in IANA support); cover a DST-boundary date in the unit tests (Story 4.4.1.4) |
| Vercel Pro plan required for sub-hourly cron (`*/30 * * * *`) | High | Medium | Verify plan before deploying; fallback to hourly (`0 * * * *`) if needed, accepting a ±1h window instead of ±30 min |
| `assembleBriefing` slow for users with many tasks (> 500) | Low | Low | Add `.limit(50)` to the upcoming tasks query; acceptable at personal scale |
| Wave 4.3.1 not yet run — `last_nudge_at` null — stalled section always empty | Low | Medium | Empty stalled section is valid; briefing is still useful; document in acceptance criteria that stalled data appears after Wave 4.3.1 runs at least once |

---

## Related Documentation

- ADR-008: deterministic briefing (no LLM); on-demand elaboration via chat.
- ADR-010: scheduled jobs; momentum and briefing on cron, not request path.
- UX §Today/Briefing wireframe: four-section layout; zero required decisions.
- Business Requirements Feature 5 (deterministic briefing); UC-8 (receive daily briefing); UC-18 (configure briefing time/timezone).
- Architecture §Cron Jobs: `CRON_SECRET`; `lib/jobs/`; `vercel.json` schedule config.
- Wave 4.4.2 (dependent): Briefing Delivery — tray polling, toast, `GET /api/briefing/today`, `/today` page.
