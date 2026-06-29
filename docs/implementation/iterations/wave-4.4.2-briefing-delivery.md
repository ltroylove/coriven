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
wave: "4.4.2"
agents: []
tags: [coriven, briefing, daily-briefing, tray, delivery, toast, today-page, ui]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-008-deterministic-daily-briefing.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
---

# Wave 4.4.2: Briefing Delivery

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 4.4.2 |
| Feature | 4.4 — Deterministic Daily Briefing |
| Epic | 4 — Goal-Driven Organization |
| Status | Planning |
| Scope | `GET /api/briefing/today` (with `X-Mark-Delivered` / `was_delivered` behavior), tray briefing polling on startup and at noon (native toast when `was_delivered = false`), `/today` page rendering the four briefing sections |
| Wave Goal | Surface the briefing row produced by Wave 4.4.1 to the owner: via a native tray toast fired once on the morning the briefing exists, and via the `/today` page for browser-side review |

**Wave Philosophy.** Delivery is thin by design — per Architecture §Tauri Tray, the tray contains no business logic and no DB access; all content originates from the `GET /api/briefing/today` API. The `/today` page is read-first with zero required decisions (UX Foundations Pass 4).

**Dependency.** This wave requires Wave 4.4.1 (Briefing Generation) to be complete and in production. The `daily_briefings` rows, the `BriefingContent` type, and the data contract below are all produced by Wave 4.4.1.

---

## Wave Goals

1. **Morning delivery reliability** — the tray fires a briefing toast within the user's morning window; `daily_briefings.was_delivered` transitions from `false` to `true` on first successful delivery, preventing re-firing on subsequent polls.
2. **Thin tray** — the tray contains no briefing computation; it polls `GET /api/briefing/today`, renders counts from the `BriefingContent` JSON, and marks delivered. Nothing more.
3. **Browser fallback** — the `/today` page renders the same briefing for users who are not running the tray, with full section detail and empty/loading/error states per UX Pass 5.

---

## User Stories

### Story 4.4.2.1 — `GET /api/briefing/today` Endpoint

**As** the tray daemon and the Today/Briefing page,
**I want** a `GET /api/briefing/today` endpoint that returns today's briefing for the authenticated user,
**so that** the tray can poll it on startup and at noon, and the UI can render the briefing sections.

**Acceptance Criteria:**

- Endpoint requires a valid Supabase user session (cookie-based or `Authorization: Bearer <access_token>`); returns HTTP 401 for unauthenticated requests.
- Queries `daily_briefings WHERE user_id = auth.uid() AND briefing_date = today` and returns the row's `content`, `was_delivered`, `delivered_at`, and `briefing_date`.
- Returns HTTP 404 with `{ briefing: null }` if no row exists for today (briefing not yet generated — the tray must not fire a toast).
- Returns HTTP 200 with `{ briefing: BriefingRow }` when the row is found.
- If `was_delivered = false` and the caller includes the header `X-Mark-Delivered: true`, the endpoint atomically updates `was_delivered = true, delivered_at = now()` before returning the row.
- No LLM call. The only DB write is the optional `was_delivered` update.
- Response time is at or below 200ms (single primary-key lookup).

**Priority:** High
**Estimated Hours:** 4h
**References:** Business Requirements Feature 5; UC-8; Architecture §Tauri Tray.

#### Task 4.4.2.1.1 — `GET /api/briefing/today` Route

**Parent Story:** 4.4.2.1
**Agent:** Backend
**Estimation:** 4h
**Dependencies:** Wave 4.4.1 complete (`daily_briefings` schema and `BriefingContent` type from `lib/jobs/briefing.ts` available); auth-server Supabase client.
**Deliverables:** `apps/web/src/app/api/briefing/today/route.ts`.
**Acceptance Criteria:**
- Uses `createServerClient` (auth-aware) to get the user session; does not use service role for user-facing reads.
- `briefing_date` compared as a date value; for simplicity in this wave the comparison uses UTC date — acceptable personal-scale approximation; timezone-correct date comparison can be refined in Epic 6.
- `X-Mark-Delivered: true` header: if present and `was_delivered = false`, atomically sets `was_delivered = true` and `delivered_at = now()` in a single `UPDATE` before returning the row.
- Response body: `{ briefing: { id, user_id, briefing_date, content: BriefingContent, was_delivered, delivered_at, created_at } | null }`.
- All DB errors return HTTP 500 with `{ error: 'Internal error' }`.
- `npm run typecheck` passes.

---

### Story 4.4.2.2 — Tray Briefing Polling and Toast

**As** the owner,
**I want** the tray to check for an undelivered briefing on startup and again at noon each day, and fire a native toast if `was_delivered = false`,
**so that** I receive the daily briefing without opening a browser.

**Acceptance Criteria:**

- On tray startup, after authentication, the tray calls `GET /api/briefing/today`.
- If the response contains a briefing with `was_delivered = false`, the tray fires a native notification with title "Coriven Morning Briefing" and a body derived from the `content` JSON: `"Goals in motion: N | Upcoming: N | Stalled: N"`.
- After firing the toast, the tray calls `GET /api/briefing/today` with `X-Mark-Delivered: true` to mark the briefing delivered; failure to mark is logged but does not crash the tray.
- At noon, the tray re-polls; if a briefing is now available that was not at startup (or was previously undelivered), it fires.
- The noon poll is implemented as a `setInterval` of 6 hours from startup, placed alongside the existing reminder poll intervals in `main()`.
- If the API returns HTTP 404 (no briefing yet) or the tray is offline, the function returns without action and without entering a retry loop; the next scheduled poll covers it.
- The tray does not re-fire the toast when `was_delivered = true` (idempotent delivery).
- Tray business logic remains thin: all content comes from the API; no computation or DB access in the tray.

**Priority:** High
**Estimated Hours:** 6h
**References:** Business Requirements Feature 5; UC-8; Architecture §Tauri Tray; UX §Reminders (tray).

#### Task 4.4.2.2.1 — Briefing Poll and Notification in the Tray

**Parent Story:** 4.4.2.2
**Agent:** Backend (tray)
**Estimation:** 6h
**Dependencies:** Task 4.4.2.1.1 (`GET /api/briefing/today` endpoint deployed and reachable); existing tray auth pattern (`apps/tray/src/auth.ts`); existing notification pattern (`apps/tray/src/notifier.ts`).
**Deliverables:** `apps/tray/src/briefing.ts` (new module exporting `pollBriefing()` and `notifyBriefing(content: BriefingContent)`); updated `apps/tray/src/index.ts`.
**Acceptance Criteria:**
- `pollBriefing()` calls `GET /api/briefing/today` using the same authenticated HTTP pattern as `getDueReminders()` in `apps/tray/src/db.ts`.
- `notifyBriefing(content)` constructs the body string `"Goals in motion: N | Upcoming: N | Stalled: N"` from `BriefingContent` counts; uses `node-notifier` (or the existing notification library) consistent with `notifier.ts` — no new notification dependency.
- After notification, calls the API with `X-Mark-Delivered: true`; failure to mark is caught, logged to stdout, and does not throw.
- Noon check: `setInterval(pollBriefing, 6 * 60 * 60 * 1000)` added in `main()`.
- If `briefing` is `null` (404 or `was_delivered = true`), `pollBriefing` returns without action — no error thrown.
- `npm run tray:dev` starts without errors after this change.

---

### Story 4.4.2.3 — Today / Briefing Page (`/today`)

**As** the owner,
**I want** a `/today` page that displays the current day's briefing in a structured, read-first layout,
**so that** I can review my morning context from the browser when the tray is not running.

**Acceptance Criteria:**

- `/today` fetches the briefing via the auth-server Supabase client (server component) and renders it in four sections matching the UX wireframe: Goals in Motion, Upcoming (7 days), Stalled, Approvals Pending.
- If no briefing exists for today, shows: "Your first briefing arrives tomorrow at 7am" (UX Pass 5 empty state).
- The page is read-first with zero required decisions (UX Foundations Pass 4).
- "Approvals Pending: N → Review" links to `/approvals` (renders the count even if that page is Phase 4).
- Each Goal in Motion links to `/goals/[id]`; each task in Upcoming links to `/tasks` or the task detail.
- WCAG AA: semantic headings per section; readable font size; no motion required.
- The docked chat pane is co-present (shell layout).
- Tray morning delivery confirmation: after this wave is complete, a user who has the tray running will receive a startup toast mentioning at least one goal in motion and at least one upcoming task (verifying end-to-end from Wave 4.4.1 generation through Wave 4.4.2 delivery).

**Priority:** Medium
**Estimated Hours:** 5h
**References:** Business Requirements Feature 5; UC-8; UX §Today/Briefing screen wireframe; UX Foundations Pass 4 (zero decisions on briefing); UX Foundations Pass 5 (empty/loading/error states).

#### Task 4.4.2.3.1 — `/today` Page and Briefing Section Components

**Parent Story:** 4.4.2.3
**Agent:** Frontend
**Estimation:** 5h
**Dependencies:** Task 4.4.2.1.1 (`GET /api/briefing/today` endpoint or equivalent server query available); `BriefingContent` type from Wave 4.4.1 Task 4.4.1.1.1.
**Deliverables:** `apps/web/src/app/today/page.tsx`; `apps/web/src/app/today/loading.tsx`; `apps/web/src/components/briefing/briefing-section.tsx`; primary nav updated.
**Acceptance Criteria:**
- Server component; fetches today's `daily_briefings` row using the auth-server Supabase client.
- `BriefingSection` component accepts `title: string` and `items: ReactNode[]`; renders a titled section with a list of items.
- Empty briefing (no row for today) renders the "first briefing" empty state.
- "Today" is added to the primary nav above "Chat" per the UX Pass 2 IA order.
- `loading.tsx` renders a skeleton with four section placeholders.
- `npm run typecheck` passes.

---

## Task Dependencies

```
Wave 4.4.1 (all tasks complete)
    └──► Task 4.4.2.1.1  (GET /api/briefing/today — needs daily_briefings + BriefingContent type)
              ├──► Task 4.4.2.2.1  (tray poll — endpoint must be reachable)
              └──► Task 4.4.2.3.1  (Today page — endpoint or DB query must be available)
```

**Critical path:** Wave 4.4.1 complete → `GET /api/briefing/today` route → tray polling and Today page in parallel.
**Parallelizable:** Task 4.4.2.2.1 (tray) and Task 4.4.2.3.1 (Today page) can proceed in parallel once Task 4.4.2.1.1 is done.
**Prerequisite waves:** Wave 4.4.1 must be fully complete (cron generating rows, `BriefingContent` type exported) before any task in this wave begins.

---

## Definition of Done

- [ ] `GET /api/briefing/today` (authenticated) returns HTTP 200 with `content` containing non-null `goalsInMotion`, `upcoming`, `stalled`, and `approvalsPending` fields.
- [ ] `GET /api/briefing/today` (unauthenticated) returns HTTP 401.
- [ ] `GET /api/briefing/today` when no briefing exists for today returns HTTP 404 with `{ briefing: null }`.
- [ ] Calling `GET /api/briefing/today` with `X-Mark-Delivered: true` when `was_delivered = false` sets `was_delivered = true` in `daily_briefings` and returns the updated row.
- [ ] The tray fires a native toast on startup when a briefing with `was_delivered = false` exists; re-polling after the toast does not fire again (`was_delivered = true`).
- [ ] If the API returns HTTP 404, the tray returns without error and without firing a toast.
- [ ] The noon poll (`setInterval` 6h) is confirmed in `apps/tray/src/index.ts`.
- [ ] `/today` page renders all four briefing sections with real data.
- [ ] `/today` empty state ("Your first briefing arrives tomorrow at 7am") displays when no row exists.
- [ ] "Today" appears in the primary nav above "Chat".
- [ ] End-to-end acceptance: tray startup toast mentions at least one goal in motion and one upcoming task (requires Wave 4.4.1 cron to have run and produced a row).
- [ ] `npm run typecheck` passes across the monorepo.
- [ ] `npm run tray:dev` starts without errors.

---

## Infrastructure Specifications

### Database

**`daily_briefings` table (created in Wave 4.1.1; rows produced by Wave 4.4.1):**
```
id uuid PK, user_id uuid, briefing_date date, content jsonb NOT NULL,
was_delivered boolean NOT NULL DEFAULT false, delivered_at timestamptz, created_at timestamptz
UNIQUE (user_id, briefing_date)
```

**Key queries (delivery side):**
- Tray/UI read — `daily_briefings.select('*').eq('user_id', uid).eq('briefing_date', today).single()`.
- Mark delivered — `daily_briefings.update({ was_delivered: true, delivered_at: new Date().toISOString() }).eq('id', row.id)`.

No new migrations in this wave. All schema changes were applied in Wave 4.1.1 and Wave 4.4.1.

### API

**`GET /api/briefing/today`**
- Method: GET
- Path: `/api/briefing/today`
- Auth: Supabase user session (cookie) or `Authorization: Bearer <access_token>`.
- Request headers (optional): `X-Mark-Delivered: true` — atomically marks `was_delivered = true, delivered_at = now()`.
- Response (200): `{ briefing: { id, user_id, briefing_date, content: BriefingContent, was_delivered, delivered_at, created_at } }`.
- Response (404): `{ briefing: null }`.
- Response (401): `{ error: 'Unauthorized' }`.
- Response (500): `{ error: 'Internal error' }`.
- Performance target: at or below 200ms (single PK lookup).

**No new environment variables** in this wave. `CRON_SECRET` (from Wave 4.4.1) is not used here.

### UI

**`/today` page sections (from UX wireframe):**
1. **Goals in Motion** — list of `{ title, momentum }` from `goalsInMotion`.
2. **Upcoming (7 days)** — list of `{ title, dueAt }` from `upcoming`, sorted ascending.
3. **Stalled (needs attention)** — list of `{ title, daysSinceActivity }` from `stalled`.
4. **Approvals Pending** — count with "→ Review" link to `/approvals`.

**State design (UX Pass 5):**
- Empty (no briefing today): "Your first briefing arrives tomorrow at 7am."
- Loading: 4 skeleton section blocks (`loading.tsx`).
- Error: "Couldn't load your briefing — Retry" inline.

**Tray notification body format:**
```
Goals in motion: 2 | Upcoming tasks: 3 | Stalled: 1
```
Plain text; no markdown; derived from `BriefingContent` counts in `notifyBriefing`.

### Testing

- **Unit:** tray `pollBriefing` — mock HTTP response returning `was_delivered: false`; assert toast fires. Mock `was_delivered: true`; assert no toast. Mock 404; assert no crash and no toast.
- **Integration:** `GET /api/briefing/today` — seed a `daily_briefings` row with `was_delivered: false`; assert correct 200 response; call with `X-Mark-Delivered: true`; assert `was_delivered = true` in DB.
- **Integration:** `GET /api/briefing/today` with no row for today → assert 404.
- **Security:** `GET /api/briefing/today` without session → 401.
- **E2E (Playwright):** authenticated user visits `/today`; sees all four briefing sections; "Today" is present in the nav.
- **Coverage target:** `GET /api/briefing/today` route ≥ 80% branch coverage; tray `briefing.ts` ≥ 80% line coverage.

### Deployment

- No new Vercel Cron entries in this wave.
- No new environment variables in this wave.
- Wave 4.4.1 must be deployed and the cron must have produced at least one `daily_briefings` row before end-to-end tray delivery can be verified.
- Tray rebuild and reinstall required after `apps/tray/src/briefing.ts` is added.

### Monitoring

- Track `was_delivered` ratio: if a high fraction of rows remain `false` for more than 24 hours, tray delivery may be broken.
- Monitor tray poll errors in tray stdout logs.
- Alert on HTTP 500 from `GET /api/briefing/today` (Vercel function log monitoring).

---

## Handoff Requirements

- Epic 5 (Communications) will add real data to `approval_queue`; the `approvalsPending` count in the briefing and the "→ Review" link on `/today` will become meaningful without changes to this wave's code.
- Epic 6 (Proactive) will extend `/today` with a weekly review section and pattern detection insights; the `BriefingSection` component must support additional sections without visual regression.
- Once this wave is complete, the full Feature 4.4 end-to-end is verified: cron generates → `daily_briefings` row stored → tray polls → toast fired → `was_delivered = true` → `/today` page renders.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Wave 4.4.1 cron has not run by the time this wave is tested — no `daily_briefings` rows available | Medium | Medium | Seed a test row manually in the dev DB to unblock tray and UI testing independent of the cron schedule |
| Tray `was_delivered` mark fails silently (network error) — toast re-fires on next poll | Low | Low | Log the failure; the toast re-fires at most once per poll interval (acceptable degradation at personal scale) |
| `/today` briefing date mismatch (UTC vs. user timezone) causes "no briefing" false negative | Low | Low | Documented in Task 4.4.2.1.1 as a known approximation; timezone-correct date comparison deferred to Epic 6 |
| Node.js tray does not support the notification library used on a fresh Windows install | Low | Low | `node-notifier` is already used in `notifier.ts`; no new dependency introduced |

---

## Related Documentation

- ADR-008: deterministic briefing (no LLM); on-demand elaboration via chat.
- ADR-010: scheduled jobs; momentum and briefing on cron, not request path.
- UX §Today/Briefing wireframe: four-section layout; zero required decisions.
- UX Foundations Pass 4: briefing is read-first; zero decisions required.
- UX Foundations Pass 5: briefing empty/loading/error/fallback states.
- Business Requirements Feature 5 (deterministic briefing); UC-8 (receive daily briefing).
- Architecture §Tauri Tray: thin shell, polls endpoints, no business logic, no DB access.
- Existing tray pattern: `apps/tray/src/db.ts`, `apps/tray/src/notifier.ts`, `apps/tray/src/index.ts`.
- Wave 4.4.1 (prerequisite): Briefing Generation — `assembleBriefing`, cron endpoint, `daily_briefings` rows, `BriefingContent` type.
