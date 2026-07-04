---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven"
epic: "5"
feature: "5.4"
wave: "5.4.1"
agents: []
tags: [coriven, calendar, sync, cron, nango, google-calendar, outlook, microsoft-graph]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md"
---

# Wave 5.4.1: Calendar Sync

## Wave Overview
- **Wave ID:** Wave-5.4.1
- **Feature:** Feature 5.4 - Calendar Intelligence, Meeting Prep & Follow-Up
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Hourly synchronization of Google Calendar and Outlook Calendar events into a local `calendar_events` store — provider tokens retrieved through Nango, idempotent upserts, per-user isolation via RLS.
- **Wave Goal:** Coriven holds a fresh, deduplicated, per-user copy of upcoming calendar events from both providers within one hour of any change, giving downstream waves (meeting prep, follow-up context) a reliable local source of calendar truth.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. Calendar events from every connected provider (Google Calendar, Outlook Calendar) are synced hourly into local storage with no duplicates across repeated runs.
2. All provider API calls obtain tokens exclusively via Nango (ADR-013) — no raw tokens touch Coriven's database or logs.
3. The sync is resilient and isolated: one provider or one user failing does not block the rest of the batch, and every user's events are protected by row-level security.

## User Stories

### User Story 1: Calendar Events Synced Locally

**As a** user with a connected calendar
**I want** my upcoming events automatically synced into Coriven every hour
**So that** the assistant has current calendar awareness without me pasting my schedule in

**Acceptance Criteria:**
- [ ] Events created, updated, or deleted in the provider calendar are reflected locally within one sync cycle (one hour).
- [ ] Each stored event carries title, start/end times, attendees, location, description, and all-day flag, scoped to the owning user.
- [ ] Running the sync repeatedly produces no duplicate events — re-synced events update in place.
- [ ] Users with no connected calendar are skipped cleanly with no errors.

**Priority:** High

---

### User Story 2: Both Providers, One Pipeline

**As a** user with Google Calendar and/or Outlook Calendar connected
**I want** both providers synced through the same pipeline
**So that** my full schedule is visible to Coriven regardless of which calendar an event lives in

**Acceptance Criteria:**
- [ ] Google Calendar and Outlook Calendar events both land in the same local store, distinguished by provider.
- [ ] Provider access tokens are obtained per call through the Nango token wrapper — never read from Coriven's database.
- [ ] A user connected to only one provider syncs that provider without errors from the missing one.
- [ ] The same event ID from different providers never collides — uniqueness is per user, per provider, per event.

**Priority:** High

---

### User Story 3: Secure, Resilient Scheduled Sync

**As** the system operator
**I want** the hourly sync to run unattended, authenticated, and fault-isolated
**So that** a single bad token, rate limit, or provider outage never silently halts calendar intelligence for everyone

**Acceptance Criteria:**
- [ ] The sync endpoint rejects unauthenticated invocations (cron secret required) and is scheduled hourly.
- [ ] A failure syncing one user or one provider is logged and the batch continues with the next connection.
- [ ] Each run reports a structured summary (connections processed, events upserted, errors) for monitoring.
- [ ] Event descriptions are stored as untrusted content — never passed to Claude as instructions (zero-trust spine).

**Priority:** High

---

## Logical Unit Test Cases

### Test Case 1: Unauthorized Cron Invocation Rejected
- **Endpoint:** `/api/cron/calendar-sync`
- **Method:** GET
- **Test Data:** Request with missing or incorrect cron secret
- **Expected Result:** HTTP 401, no sync performed
- **Verification:** No new or updated `calendar_events` rows; error response body contains no sensitive detail

### Test Case 2: Hourly Sync Upserts Events
- **Endpoint:** `/api/cron/calendar-sync`
- **Method:** GET
- **Test Data:** Valid cron secret; a user with a connected Google Calendar containing known test events
- **Expected Result:** HTTP 200 with summary counts; test events present in `calendar_events` with correct fields
- **Verification:** Row count matches provider event count; attendees/location/all-day flag populated; `synced_at` current

### Test Case 3: Re-Sync Is Idempotent
- **Endpoint:** `/api/cron/calendar-sync`
- **Method:** GET
- **Test Data:** Valid cron secret; same provider state as Test Case 2, run twice
- **Expected Result:** HTTP 200 both runs; identical event count after second run
- **Verification:** No duplicate rows for the same user/provider/event; updated provider titles overwrite local titles

### Test Case 4: Partial Failure Isolation
- **Endpoint:** `/api/cron/calendar-sync`
- **Method:** GET
- **Test Data:** Two users — one with a valid connection, one whose provider call fails (revoked connection)
- **Expected Result:** HTTP 200; healthy user's events synced; failure recorded in the run summary
- **Verification:** Healthy user's rows present; errors array names the failed connection without leaking token material

## Technical Tasks

### Task 1: `calendar_events` Migration
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (Feature 5.1 `integrations` table already exists)
- **Priority:** High

**Deliverables:**
- Supabase migration creating `calendar_events` (id, user_id, provider, event_id, title, start_at, end_at, attendees jsonb, location, description, is_all_day, synced_at)
- UNIQUE constraint on (user_id, provider, event_id); indexes supporting time-window and user lookups
- RLS policies (user reads own rows; service role writes) and regenerated Supabase TypeScript types

**Acceptance Criteria:**
- [ ] Migration applies cleanly on a fresh and an existing database.
- [ ] A user session can read only their own events; cross-user reads return nothing.
- [ ] Upsert on the unique key updates rather than duplicates.

---

### Task 2: Calendar Provider Clients (Google + Microsoft Graph)
- **Agent:** backend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Feature 5.1 (Nango token wrapper)
- **Priority:** High

**Deliverables:**
- Server-side Google Calendar client fetching events for a configurable upcoming window via a Nango-retrieved token
- Server-side Outlook Calendar (Microsoft Graph) client with the same normalized output shape
- Shared normalized event type mapping both providers to the `calendar_events` columns

**Acceptance Criteria:**
- [ ] Both clients return the same normalized event shape (attendees, times, all-day handling included).
- [ ] Tokens are requested from Nango per call and never persisted or logged.
- [ ] Provider errors surface as typed failures the caller can catch per connection.

---

### Task 3: Hourly Sync Cron Endpoint
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1, Task 2
- **Priority:** High

**Deliverables:**
- `GET /api/cron/calendar-sync` route — cron-secret protected, iterates calendar connections, fetches via provider clients, upserts to `calendar_events`
- Vercel Cron entry scheduling the route hourly
- Structured per-run summary log (connections processed, events upserted, errors)

**Acceptance Criteria:**
- [ ] Endpoint fails closed without a valid cron secret.
- [ ] Per-connection failures are isolated; the batch always completes.
- [ ] Deleted or moved provider events do not linger stale beyond the sync window strategy documented in the run summary.

---

### Task 4: Sync Test Coverage
- **Agent:** quality-control
- **Estimation:** 5 hours
- **Dependencies:** Task 3
- **Priority:** Medium

**Deliverables:**
- Unit tests for event normalization (both providers, all-day and timed events, attendee mapping)
- Integration tests covering the four logical test cases above (auth, upsert, idempotency, partial failure)

**Acceptance Criteria:**
- [ ] All logical unit test cases pass without external provider calls (mocked clients).
- [ ] Idempotency verified by row-count assertion across repeated runs.

---

## Task Dependencies

```
Task 1 (migration)          Task 2 (provider clients)
        └──────────┬──────────────┘
                   ↓
          Task 3 (cron endpoint)
                   ↓
          Task 4 (test coverage)
```

Tasks 1 and 2 run in parallel; the critical path is Task 2 → Task 3 → Task 4.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3 | 18 |
| quality-control | Task 4 | 5 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] No raw provider tokens in database, logs, or source (security check)
- [ ] Documentation updated
- [ ] Deployed to staging environment with the hourly cron active

## Infrastructure Specifications

### Database

```sql
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_id text NOT NULL,
  title text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  attendees jsonb NOT NULL DEFAULT '[]',
  location text,
  description text,
  is_all_day boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, event_id)
);
CREATE INDEX ON calendar_events (user_id, start_at);
```

RLS: enable; `SELECT` policy for `auth.uid() = user_id`; writes via service role only (cron context).

### API

- **`GET /api/cron/calendar-sync`** — auth via cron secret header; empty request; 200 response `{ connectionsProcessed, eventsUpserted, errors[] }`; 401 on auth failure. Vercel Cron schedule: `0 * * * *` (hourly).
- Token retrieval: `nango.getToken(userId, provider)` per connection, per run — Nango handles refresh (ADR-013).
- Sync window: events from now through a fixed upcoming horizon (e.g., 30 days); window documented in the route.

### Deployment

- Migration applied and Supabase types regenerated before the cron route ships.
- Cron secret present in Vercel env; `.env.example` updated if new variables are introduced.
- Nango (Feature 5.1) must have Google Calendar and Outlook provider configs live with calendar read scopes.

### Monitoring

- Structured log per run with counts and per-connection errors.
- Alert condition: consecutive runs with zero connections processed while calendar integrations exist.

## Handoff Requirements

**For next wave (5.4.2):**
- Populated `calendar_events` table with reliable start times and attendee lists — meeting prep queries events starting soon.
- Normalized attendee shape (names/emails in `attendees` jsonb) that prep assembly can match against email metadata and entity profiles.

**For other Features/Epics:**
- Feature 5.3 execution routing reuses this wave's provider clients for approved calendar writes (create/update event) — calendar writes always go through the approval queue, never direct from this wave.
- Epic 6 cross-context queries read `calendar_events` for schedule-aware answers.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Google OAuth verification delays block calendar scope | Med | Use test accounts during development; verification started early (Epic 5 risk register) |
| Provider rate limits on hourly full-window fetch | Med | Bounded sync window; incremental sync tokens as a follow-on optimization if limits bite |
| Deleted provider events left stale locally | Low | Window-scoped reconciliation (remove local events in window absent from provider response); documented in Task 3 |
| Recurring-event expansion differs between providers | Med | Fetch expanded instances (single events) from both APIs rather than recurrence rules |

## Notes and Assumptions

- Calendar reads only in this wave. Calendar writes (create/update event) are executed by Feature 5.3's approval-queue execution path — never directly here (ADR-009).
- Event descriptions are untrusted external content (zero-trust): stored and displayed, never fed to Claude as instructions.
- Feature 5.1 (Nango + connect UI) is complete; Google Calendar and Outlook connections exist for the test user.
- Personal-scale assumption: full-window fetch per hour is acceptable; delta sync is deferred.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.4)
- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture: docs/architecture/decisions/ADR-013-integration-token-authority.md; docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md
- Blueprint §11.3–§11.5 (calendar intelligence)

## Wave Retrospective

{This section will be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
