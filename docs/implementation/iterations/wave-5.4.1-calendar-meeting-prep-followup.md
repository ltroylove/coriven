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
epic: "5"
feature: "5.4"
wave: "5.4.1"
agents: []
tags: [coriven, calendar, meeting-prep, follow-up, cron, briefing, tray]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
---

# Wave 5.4.1: Calendar Sync, Meeting Prep & Follow-Up Detection

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 5.4.1 |
| Feature | 5.4 — Calendar, Meeting Prep & Follow-Up |
| Epic | 5 — Communications Intelligence |
| Status | Planning |
| Scope | Hourly Google Calendar sync to `calendar_events`; meeting-prep brief assembled 15 minutes before each event from emails, tasks, memories, and entity profiles (cross-context, leveraging Epic 2 memory); nightly follow-up detection (threads where the user sent the last message more than 3 days ago); calendar writes through the approval queue; Tauri tray notification for meeting prep; `list_calendar_events` and `get_meeting_prep` tool handlers completed. |
| Wave Goal | Coriven fires a meeting-prep toast 15 minutes before each calendar event; nightly follow-up detection surfaces threads needing a reply; all calendar writes go through the approval queue; calendar events are kept in sync hourly from Google Calendar. |

**Wave Philosophy:** Scheduled intelligence, not real-time computation — every proactive signal is pre-computed by a cron job and stored, so the tray and chat read a pre-built result (ADR-010).

## Wave Goals

1. The hourly calendar sync cron imports new and updated events from Google Calendar into `calendar_events`; a meeting-prep cron fires 15 minutes before each event, assembles a cross-context brief (emails + tasks + memories + entity profiles), stores it, and notifies the tray (Business Requirements Feature 6, UC-33, UC-41).
2. A nightly follow-up detection cron identifies `email_metadata` threads where the user sent the last message more than 3 days ago and surfaces them as actionable follow-ups in the `/email` inbox or a dedicated section (Business Requirements Feature 6).
3. All calendar writes (create event, cancel event) proposed by Claude go through `submit_for_approval` and the approval queue, enforcing the zero-trust invariant (ADR-009); the wave includes an acceptance test for this path (UC-16).

## User Stories

---

### Story 5.4.1.1 — Hourly Calendar Sync

**As the** Calendar-Sync Cron actor,
**I want** to sync Google Calendar events into `calendar_events` every hour,
**So that** Coriven has an up-to-date snapshot of upcoming events to use for meeting prep, briefings, and chat queries.

**Reference:** Business Requirements Feature 6, UC-33; Architecture §"Cron Jobs"; ADR-010.

**Priority:** Critical
**Estimated hours:** 14

**Acceptance Criteria:**
- A Vercel Cron job fires every hour, protected by `CRON_SECRET`; unauthenticated requests receive 401.
- The cron uses Google Calendar `events.list` with `updatedMin` (sync token or timestamp watermark) to fetch only changed events since the last sync; the watermark is stored per user.
- Each event is upserted into `calendar_events` by `(user_id, provider, provider_event_id)`; deleted or cancelled events in Google are marked `status = 'cancelled'` in the table (not hard-deleted).
- Fetched fields: `provider_event_id`, `title`, `description` (truncated to 500 chars; not a verbatim copy), `start_at`, `end_at`, `attendees` (display names + emails), `location`, `status`, `google_meet_link`.
- No event body content beyond the fields above is stored; AI does not own calendar truth — Google Calendar remains authoritative.
- `ensureFreshToken` is called before each Calendar API request; on `IntegrationAuthError`, sets `needs_reauth` and continues to next user.
- Cron is idempotent; running twice does not duplicate events.

#### Task 5.4.1.1.1 — `calendar_events` Table Migration

| Field | Value |
|---|---|
| Parent Story | 5.4.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 5.1.1 (`integration_provider` enum) |
| Deliverables | `supabase/migrations/<timestamp>_add_calendar_events_table.sql` |

**Acceptance Criteria:**
- `calendar_events` table: `id uuid PK`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `provider integration_provider NOT NULL`, `provider_event_id text NOT NULL`, `title text`, `description text`, `start_at timestamptz NOT NULL`, `end_at timestamptz NOT NULL`, `attendees jsonb DEFAULT '[]'`, `location text`, `status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','tentative','cancelled'))`, `google_meet_link text`, `prep_brief text`, `prep_brief_generated_at timestamptz`, `last_synced_at timestamptz DEFAULT now()`, `created_at timestamptz DEFAULT now()`.
- Unique constraint on `(user_id, provider, provider_event_id)`.
- RLS: `SELECT/INSERT/UPDATE` policy `USING (user_id = auth.uid())`; service-role for cron writes.
- Index on `(user_id, start_at)` for upcoming-events queries.
- TypeScript types regenerated.

#### Task 5.4.1.1.2 — Calendar Client Service

| Field | Value |
|---|---|
| Parent Story | 5.4.1.1 |
| Agent | Backend Engineer |
| Estimation | 5h |
| Dependencies | Wave 5.1.1 (`ensureFreshToken`); Task 5.4.1.1.1 |
| Deliverables | `apps/web/src/lib/integrations/calendar-client.ts` (supplement from Wave 5.3.2 with `listEvents`) |

**Acceptance Criteria:**
- `listEvents(userId, updatedMin)` calls `calendar.events.list` with the user's access token and `updatedMin`; returns typed event objects.
- `createEvent(userId, payload)` and `cancelEvent(userId, eventId)` are already defined from Wave 5.3.2 (reuse without re-implementing).
- Sync token management: after each successful `listEvents` call, the `nextSyncToken` (or `nextPageToken` for pagination) is stored in `integrations` metadata and used on the next call.
- Unit tests: event list paginated correctly; sync token stored after each call; auth error propagated.

#### Task 5.4.1.1.3 — Calendar Sync Cron Route

| Field | Value |
|---|---|
| Parent Story | 5.4.1.1 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Tasks 5.4.1.1.1, 5.4.1.1.2 |
| Deliverables | `apps/web/src/app/api/cron/calendar-sync/route.ts`; `apps/web/src/lib/jobs/calendar-sync.ts` |

**Acceptance Criteria:**
- Route validates `CRON_SECRET`; returns 401 on mismatch.
- Job iterates all users with an active `google_calendar` integration; upserts events into `calendar_events`; stores sync token/watermark.
- Vercel `vercel.json` cron schedule: `"0 * * * *"` (hourly).
- Returns `{ synced: n, updated: n, cancelled: n, errors: n }`.
- Integration test: run sync with mocked Calendar API → `calendar_events` rows created; run again → no duplicates.

---

### Story 5.4.1.2 — Meeting-Prep Brief (15 Minutes Before)

**As the** owner,
**I want** a meeting-prep toast 15 minutes before each calendar event, summarizing relevant emails, tasks, and what Coriven knows about the attendees,
**So that** I walk into every meeting already briefed without manually pulling context together.

**Reference:** Business Requirements Feature 6, UC-41; Architecture §"Cron Jobs"; ADR-010.

**Priority:** High
**Estimated hours:** 18

**Acceptance Criteria:**
- A meeting-prep cron runs every 5 minutes (to catch events within the 15-minute window); for each event with `start_at` between `now()` and `now() + 15 minutes` and no `prep_brief_generated_at` in the last 24 hours, it generates and stores a prep brief.
- The prep brief is assembled by querying: recent `email_metadata` rows involving attendee email addresses; `tasks` linked to attendee names or event title (fuzzy match); `entity_profiles` for each attendee; `memories` relevant to the attendee or topic (via pgvector similarity if available, else keyword search).
- The assembled context (not raw content — summaries and metadata only) is passed to Haiku to produce a structured prep brief: `{ attendee_summaries: string[], recent_email_context: string, relevant_tasks: string[], talking_points: string[] }`.
- The brief is stored in `calendar_events.prep_brief` (JSON string) and `prep_brief_generated_at = now()`.
- The cron calls the Tauri tray API endpoint to trigger a native notification: "Meeting in 15 min: [event title] — View prep."
- `ANTHROPIC_API_KEY` is the model key; `claude-haiku-4-5-20251001` is the designated model for prep brief assembly.
- If Haiku fails, the event is marked with a minimal brief ("Meeting in 15 min — no prep available") and the error is logged; the tray notification still fires.
- Calendar write proposals (e.g., "move the meeting to 4pm") go through `submit_for_approval` — the prep cron never writes to Google Calendar.

#### Task 5.4.1.2.1 — Meeting-Prep Assembly Service

| Field | Value |
|---|---|
| Parent Story | 5.4.1.2 |
| Agent | Backend Engineer |
| Estimation | 10h |
| Dependencies | Tasks 5.4.1.1.1 (calendar_events); Wave 5.2.1 (email_metadata); Epic 2 memory tables (entity_profiles, memories) — stubs if Epic 2 not yet complete |
| Deliverables | `apps/web/src/lib/jobs/meeting-prep.ts` |

**Acceptance Criteria:**
- Assembly function signature: `generateMeetingPrep(userId, eventId): Promise<string>` — returns the stored JSON brief string.
- Attendee email addresses extracted from `calendar_events.attendees` jsonb; used to query `email_metadata.from_address` and `to_addresses` for recent threads (last 7 days).
- Entity profiles fetched from `entity_profiles` by alias/name match on each attendee display name; if no profile exists, the attendee section is "No prior context."
- Memory retrieval: if Epic 2 memory tables exist, run a keyword search on attendee names and event title; otherwise skip (graceful degradation).
- Haiku prompt constructed from structured fields only — no raw email bodies, no verbatim message text.
- Prep brief JSON schema validated before storing; falls back to minimal brief on parse failure.
- Unit tests: brief generated with all context sources; brief generated with no prior entity profile; Haiku failure → minimal brief fallback.

#### Task 5.4.1.2.2 — Meeting-Prep Cron Route

| Field | Value |
|---|---|
| Parent Story | 5.4.1.2 |
| Agent | Backend Engineer |
| Estimation | 5h |
| Dependencies | Task 5.4.1.2.1; Tray polling endpoint pattern from Wave 5.3.1 |
| Deliverables | `apps/web/src/app/api/cron/meeting-prep/route.ts`; `apps/web/src/lib/jobs/meeting-prep.ts` (add cron runner) |

**Acceptance Criteria:**
- Route validates `CRON_SECRET`; 401 on mismatch.
- Cron queries `calendar_events WHERE start_at BETWEEN now() AND now() + interval '15 minutes' AND (prep_brief_generated_at IS NULL OR prep_brief_generated_at < now() - interval '24 hours')`.
- For each matching event, calls `generateMeetingPrep`; stores result; triggers tray notification via `POST /api/tray/notify` (or equivalent).
- Vercel `vercel.json` cron schedule: `"*/5 * * * *"` (every 5 minutes; required for the 15-minute window; Vercel Pro plan required).
- Returns `{ prepared: n, errors: n }`.

#### Task 5.4.1.2.3 — Tray Meeting-Prep Notification Endpoint

| Field | Value |
|---|---|
| Parent Story | 5.4.1.2 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 5.4.1.2.2; existing tray polling pattern |
| Deliverables | `apps/web/src/app/api/tray/meeting-prep/pending/route.ts` |

**Acceptance Criteria:**
- `GET /api/tray/meeting-prep/pending` (session-authenticated) returns events in the next 15 minutes with a generated prep brief: `{ items: [{ event_id, title, start_at, prep_brief }] }`.
- Tray polls this endpoint; on a non-empty response, fires a native notification with the event title and a "View Prep" action.
- Empty response = no notification.

---

### Story 5.4.1.3 — Nightly Follow-Up Detection

**As the** owner,
**I want** Coriven to detect email threads where I sent the last message more than 3 days ago and haven't received a reply,
**So that** I'm reminded to follow up before things slip.

**Reference:** Business Requirements Feature 6; Architecture §"Cron Jobs"; ADR-010.

**Priority:** Medium
**Estimated hours:** 10

**Acceptance Criteria:**
- A nightly cron identifies `email_metadata` rows where the user is the most recent sender (`from_address` matches the user's Gmail address from `integrations.email`) and `received_at < now() - interval '3 days'`.
- Only threads with no inbound message after the user's last sent message are flagged (requires grouping by `thread_id` and checking if any inbound message arrived after the user's last send).
- Flagged threads are surfaced in the `/email` inbox with a "Follow Up" badge (a new `needs_followup boolean DEFAULT false` column on `email_metadata`, set by the cron via service-role).
- The cron is idempotent; re-running it does not re-flag already-flagged threads unless the condition is newly met.
- If the user sends a follow-up (a new outbound message appears in the thread), the flag is cleared on the next nightly run.

#### Task 5.4.1.3.1 — Follow-Up Detection Migration and Job

| Field | Value |
|---|---|
| Parent Story | 5.4.1.3 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 5.2.1 (email_metadata); Task 5.4.1.1.1 |
| Deliverables | `supabase/migrations/<timestamp>_add_followup_flag.sql`; `apps/web/src/lib/jobs/followup-detection.ts` |

**Acceptance Criteria:**
- Migration adds `needs_followup boolean NOT NULL DEFAULT false` to `email_metadata`.
- `detectFollowUps(userId)` queries threads where the user's last message is the most recent and is older than 3 days; sets `needs_followup = true` for matching rows; clears `needs_followup = false` for rows that no longer meet the condition.
- Unit tests: thread flagged correctly; thread cleared after inbound reply appears; idempotent on re-run.

#### Task 5.4.1.3.2 — Follow-Up Cron Route

| Field | Value |
|---|---|
| Parent Story | 5.4.1.3 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 5.4.1.3.1 |
| Deliverables | `apps/web/src/app/api/cron/followup-detection/route.ts` |

**Acceptance Criteria:**
- Route validates `CRON_SECRET`; 401 on mismatch.
- Cron runs nightly (e.g., `"0 2 * * *"` — 2am UTC); calls `detectFollowUps` for all users with a Gmail integration.
- Returns `{ flagged: n, cleared: n, errors: n }`.

#### Task 5.4.1.3.3 — Follow-Up UI in `/email`

| Field | Value |
|---|---|
| Parent Story | 5.4.1.3 |
| Agent | Frontend Engineer |
| Estimation | 3h |
| Dependencies | Tasks 5.4.1.3.1; Wave 5.2.1 inbox page |
| Deliverables | Updated `apps/web/src/app/email/page.tsx` and `email-row.tsx` |

**Acceptance Criteria:**
- Email rows with `needs_followup = true` display a "Follow Up" badge alongside the urgency badge.
- A "Needs Follow-Up" filter option is added to the urgency filter tabs.
- The badge has a non-color differentiator (icon or label); WCAG AA contrast.

---

### Story 5.4.1.4 — Calendar Writes Through Approval Queue

**As the** owner,
**I want** any calendar event creation or cancellation proposed by Coriven to go through the approval queue,
**So that** I maintain control over my calendar and the zero-trust invariant is enforced for calendar writes.

**Reference:** Business Requirements Feature 7, UC-16, UC-27; ADR-009; Epic 5 §"Feature 5.4."

**Priority:** High
**Estimated hours:** 8

**Acceptance Criteria:**
- When Claude proposes creating or cancelling a calendar event, it calls `submit_for_approval` with `action_type = 'create_calendar_event'` or `action_type = 'cancel_calendar_event'` and a validated payload.
- The executor (Wave 5.3.2) handles these action types via `calendar-client.ts`; the `create_calendar_event` path calls `createEvent`; the `cancel_calendar_event` path calls `cancelEvent`.
- The meeting-prep cron never writes to Google Calendar; it only reads.
- An acceptance test verifies: "schedule a meeting with Sarah tomorrow at 3pm" (chat message) → `approval_queue` row with `action_type = 'create_calendar_event'` and `status = 'pending'`; no Calendar API call made; user approves → event created; `audit_log` records `action_executed`.

#### Task 5.4.1.4.1 — Calendar Write Acceptance Test

| Field | Value |
|---|---|
| Parent Story | 5.4.1.4 |
| Agent | Backend Engineer |
| Estimation | 5h |
| Dependencies | Wave 5.3.2 (executor, `create_calendar_event` handler); Wave 5.3.1 (submit_for_approval) |
| Deliverables | `apps/web/src/__tests__/calendar-write-approval.test.ts` |

**Acceptance Criteria:**
- Test 1: chat tool call `submit_for_approval` with `action_type = 'create_calendar_event'` → `approval_queue` row `pending`; no Calendar API called.
- Test 2: `approveAction` on the pending row → executor calls `createEvent` mock → `audit_log` records `action_executed`.
- Test 3: meeting-prep job with mocked Calendar API → assert no `events.insert` or `events.delete` call is made by the prep job.
- All three tests required to pass before this wave merges.

#### Task 5.4.1.4.2 — Complete `list_calendar_events` and `get_meeting_prep` Tool Handlers

| Field | Value |
|---|---|
| Parent Story | 5.4.1.4 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Tasks 5.4.1.1.1, 5.4.1.2.1 |
| Deliverables | Updated `apps/web/src/lib/chat/tools/handlers.ts` (replacing stubs from Wave 5.3.2) |

**Acceptance Criteria:**
- `handleListCalendarEvents`: queries `calendar_events` by `(user_id, start_at >= from_date, start_at <= to_date, status != 'cancelled')`; returns event list with title, start/end, attendees, location.
- `handleGetMeetingPrep`: queries `calendar_events` by `(user_id, provider_event_id)`; returns `prep_brief` JSON if `prep_brief_generated_at IS NOT NULL`, else returns "Prep brief not yet available — check back shortly."
- Both handlers replace the stubs from Wave 5.3.2 with real DB reads.

---

## Task Dependencies

```
Wave 5.1.1 (token refresh, calendar-client base)
Wave 5.2.1 (email_metadata, gmail-client)
Wave 5.3.1 (approval_queue, submit_for_approval)
Wave 5.3.2 (executor, create_calendar_event/cancel_calendar_event handlers)
  │
  ├─> 5.4.1.1.1 (calendar_events migration)
  │     ├─> 5.4.1.1.2 (calendar client — listEvents)
  │     │     └─> 5.4.1.1.3 (calendar sync cron)
  │     │
  │     ├─> 5.4.1.2.1 (meeting-prep assembly service)
  │     │     ├─> 5.4.1.2.2 (meeting-prep cron)
  │     │     └─> 5.4.1.2.3 (tray notification endpoint)
  │     │
  │     └─> 5.4.1.3.1 (follow-up detection migration + job)
  │           ├─> 5.4.1.3.2 (follow-up cron)
  │           └─> 5.4.1.3.3 (follow-up UI)
  │
  └─> 5.4.1.4.1 (calendar write acceptance test) — parallel once executor exists
  └─> 5.4.1.4.2 (complete tool handler stubs) — depends on 5.4.1.1.1 + 5.4.1.2.1
```

Critical path: migration → calendar client → sync cron → meeting-prep service → meeting-prep cron.
Parallel: follow-up detection and calendar write acceptance test can run alongside meeting-prep development.

## Definition of Done

- Hourly calendar sync runs; `calendar_events` table stays in sync with Google Calendar; cancelled events are soft-deleted.
- Meeting-prep toast fires via tray 15 minutes before each event; `prep_brief` stored in `calendar_events`.
- Nightly follow-up detection flags threads where the user sent last > 3 days ago; `/email` shows "Follow Up" badge.
- `list_calendar_events` and `get_meeting_prep` chat tools return real data (no stubs).
- Calendar write acceptance test passes: "schedule a meeting" → `approval_queue pending` → no Calendar API call; approve → event created; `audit_log` records `action_executed`.
- All cron routes return 401 on bad `CRON_SECRET`; all cron schedules documented in `vercel.json`.
- Meeting-prep cron never writes to Google Calendar (verified by acceptance test).
- WCAG AA: follow-up badge non-color-only; tray notification action "View Prep" reachable.
- `vercel.json` updated with cron entries for `0 * * * *` (calendar sync), `*/5 * * * *` (meeting prep), `0 2 * * *` (follow-up detection).

## Infrastructure Specifications

### Database

**Tables:**

- `calendar_events` — see Task 5.4.1.1.1 for full column spec. `prep_brief` (text, stored JSON string); `prep_brief_generated_at` (timestamptz).
- `email_metadata` — add `needs_followup boolean NOT NULL DEFAULT false` (migration Task 5.4.1.3.1).

**RLS:**

- `calendar_events`: SELECT/INSERT/UPDATE `USING (user_id = auth.uid())`; service-role for cron writes.
- `email_metadata.needs_followup`: updated via service-role by the nightly cron.

**Indexes:**

- `calendar_events (user_id, start_at)` — upcoming events queries.
- `calendar_events (user_id, provider, provider_event_id)` UNIQUE — idempotent sync.
- `email_metadata (user_id, needs_followup)` — follow-up filter.

**Migrations:**

- `<timestamp>_add_calendar_events_table.sql`
- `<timestamp>_add_followup_flag.sql`

### API

| Method | Path | Auth | Purpose | Key Validation |
|---|---|---|---|---|
| POST | `/api/cron/calendar-sync` | `CRON_SECRET` | Hourly calendar sync | 401 on mismatch |
| POST | `/api/cron/meeting-prep` | `CRON_SECRET` | Meeting-prep brief generation | 401 on mismatch |
| POST | `/api/cron/followup-detection` | `CRON_SECRET` | Nightly follow-up flagging | 401 on mismatch |
| GET | `/api/tray/meeting-prep/pending` | Session (auth-server) | Tray polls for imminent events with prep | 401 if unauthenticated |

**Cron schedules (vercel.json):**

```json
{ "path": "/api/cron/calendar-sync", "schedule": "0 * * * *" },
{ "path": "/api/cron/meeting-prep", "schedule": "*/5 * * * *" },
{ "path": "/api/cron/followup-detection", "schedule": "0 2 * * *" }
```

### UI

- `/email` — add "Follow Up" badge and filter tab; existing inbox page updated.
- No new full page for this wave; meeting-prep content surfaced via tray notification and the `get_meeting_prep` chat tool.
- Follow-up badge: `role="status"` label "Needs follow-up"; icon + text, not color alone.

### Testing

- **Unit:** `calendar-sync.ts` (upsert idempotency; sync token storage; auth error handling); `meeting-prep.ts` (brief generated with all context; graceful degradation without entity profiles; Haiku failure → minimal brief); `followup-detection.ts` (flagging logic; clearing logic; idempotency).
- **Integration:** Calendar sync cron with mocked Calendar API → rows created; run twice → no duplicates. Meeting-prep cron → `prep_brief` stored; tray endpoint returns event.
- **Calendar write acceptance test (required CI gate):** `apps/web/src/__tests__/calendar-write-approval.test.ts` — all 3 tests (Task 5.4.1.4.1).
- **E2E:** connect Calendar → sync fires → event appears → meeting-prep toast fires 15 min before; chat "schedule meeting" → approval queue → approve → event in Google Calendar.
- **Coverage target:** >80% on `calendar-sync.ts`, `meeting-prep.ts`, `followup-detection.ts`.

### Deployment

**New cron entries in `vercel.json`:** calendar-sync (hourly), meeting-prep (every 5 min), follow-up (nightly).

**Vercel plan note:** `*/5 * * * *` and `*/15 * * * *` schedules require Vercel Pro. Confirm plan tier covers all Epic 5 cron schedules before deploying.

**No new environment variables** beyond those established in Waves 5.1.1 and 5.2.1 (`CRON_SECRET`, `DATA_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, Google OAuth credentials).

### Monitoring

- Structured log per cron run for each job: `{ event, user_id, synced/prepared/flagged, errors, duration_ms }`.
- Alert: calendar sync failure on 2+ consecutive runs per user.
- Alert: meeting-prep cron not firing (check for events in the next 15-min window that have no `prep_brief_generated_at`).
- Track: meeting-prep Haiku success rate; minimal-brief fallback rate.
- Track: follow-up flag rate per user (% of threads flagged); useful signal for inbox health.
- AI cost: meeting-prep Haiku calls; alert if daily prep cost exceeds a threshold.

## Handoff Requirements

- Calendar sync cron tested in preview environment with a real Google Calendar (test account).
- Meeting-prep brief quality reviewed manually for at least one real event before production deployment.
- Calendar write acceptance tests passing in CI.
- `vercel.json` updated with all three new cron entries; Vercel plan confirmed to support the schedules.
- Epic 5 security review completed (covers all waves: token encryption, zero-trust, audit); sign-off recorded before this wave ships to `main`.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Vercel Pro required for 5-min cron — if plan isn't upgraded, meeting-prep fires at most hourly | High | High | Confirm plan before wave starts; hourly fallback acceptable if Pro unavailable temporarily |
| Google Calendar sync token invalidation (token expires, requires full re-sync) | Medium | Medium | Full re-sync fallback: if sync token invalid, clear token and re-fetch last 30 days of events |
| Epic 2 memory tables not yet available (wave ships before Epic 2) | Low | Medium | Graceful degradation: meeting-prep omits memory context with "No prior context available"; wave is independent |
| Meeting-prep Haiku cost spike on users with many upcoming events | Medium | Low | Cap to 5 events per cron run per user; `prep_brief_generated_at` guard prevents re-generation within 24h |
| Calendar write accidentally triggered by meeting-prep cron | High | Low | Calendar write acceptance test (Task 5.4.1.4.1) explicitly asserts prep job makes no Calendar API write calls |

## Related Documentation

- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- ADR-009 (approval queue): `docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md`
- ADR-010 (scheduled proactive jobs): `docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md`
- Architecture §"Cron Jobs," §"AI Architecture": `docs/architecture/_main/04-Architecture.md`
- Business Requirements Feature 6, UC-33, UC-41: `docs/architecture/_main/03-Business-Requirements.md`
- Wave 5.1.1 (token refresh): `docs/implementation/iterations/wave-5.1.1-integrations-encrypted-tokens.md`
- Wave 5.2.1 (email triage, email_metadata): `docs/implementation/iterations/wave-5.2.1-email-triage.md`
- Wave 5.3.1 (approval queue, audit): `docs/implementation/iterations/wave-5.3.1-approval-queue-audit.md`
- Wave 5.3.2 (executor, comms tools): `docs/implementation/iterations/wave-5.3.2-execution-zero-trust.md`
