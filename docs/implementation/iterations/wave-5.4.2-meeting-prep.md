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
wave: "5.4.2"
agents: []
tags: [coriven, calendar, meeting-prep, cron, deterministic, cross-context]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-008-deterministic-daily-briefing.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 5.4.2: Meeting Prep

## Wave Overview
- **Wave ID:** Wave-5.4.2
- **Feature:** Feature 5.4 - Calendar Intelligence, Meeting Prep & Follow-Up
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Deterministic meeting-prep briefs assembled roughly 15 minutes before each synced event — cross-context pull of related emails, tasks, memories, and entity profiles for the attendees — persisted idempotently and delivered as a notification/chat message.
- **Wave Goal:** Before every meeting, the user receives a brief that gathers everything Coriven already knows about the event and its attendees, assembled from structured data with zero LLM calls (ADR-008 pattern).

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A prep brief exists for every event starting within the next 15 minutes, assembled once per event (idempotent) and never for events without an audience for prep (all-day events, events already started).
2. Assembly is fully deterministic — email metadata, tasks, memories, and entity profiles are pulled by structured queries only; no model call anywhere in the pipeline (ADR-008).
3. The brief reaches the user through an in-app delivery channel (notification/chat message) in time to be useful; tray delivery remains a future phase.

## User Stories

### User Story 1: Prep Brief Before Each Meeting

**As a** user with meetings on my synced calendar
**I want** a prep brief assembled shortly before each meeting starts
**So that** I walk in already knowing the relevant context instead of scrambling to search for it

**Acceptance Criteria:**
- [ ] A brief is generated for each timed event starting within approximately the next 15 minutes.
- [ ] Each event produces exactly one brief no matter how many scheduler runs overlap its window.
- [ ] All-day events and events that already started do not generate briefs.
- [ ] The brief identifies the event (title, time, location, attendees) at the top.

**Priority:** High

---

### User Story 2: Cross-Context Content

**As a** user
**I want** the brief to gather related emails, open tasks, memories, and what Coriven knows about each attendee
**So that** the prep reflects my actual working context with these people, not just the calendar entry

**Acceptance Criteria:**
- [ ] Recent email threads involving the event's attendees are listed (metadata only — sender, subject, summary; no bodies).
- [ ] Open tasks related to the attendees or the event topic are included.
- [ ] Relevant memories and entity profile facts for each attendee are included when they exist.
- [ ] Sections with no matching data render as explicitly empty — never omitted or fabricated.

**Priority:** High

---

### User Story 3: Deterministic Assembly (No LLM)

**As** the system owner
**I want** prep briefs assembled purely from database queries
**So that** briefs are fast, free, cannot hallucinate, and cannot be steered by untrusted email or calendar content

**Acceptance Criteria:**
- [ ] No LLM call occurs anywhere in brief assembly or delivery (verified by review and test).
- [ ] Brief content is a structured object rendered by the UI — reproducible from the same database state.
- [ ] Untrusted content (email subjects/summaries, calendar descriptions) appears only as displayed data, never as instructions.

**Priority:** High

---

### User Story 4: Brief Delivery

**As a** user
**I want** the brief delivered to me in the app when it is ready
**So that** I actually see it before the meeting rather than discovering it afterward

**Acceptance Criteria:**
- [ ] A generated brief is delivered as an in-app notification/chat message tied to the event.
- [ ] The delivered brief is readable in full from the chat/notification surface.
- [ ] Delivery failures are recorded and visible in run monitoring; the brief itself is still persisted.

**Priority:** Medium

---

## Logical Unit Test Cases

### Test Case 1: Brief Generated for Imminent Event
- **Endpoint:** `/api/cron/meeting-prep`
- **Method:** GET
- **Test Data:** Valid cron secret; a synced event starting in 10 minutes with two attendees who have email metadata and entity profiles
- **Expected Result:** HTTP 200; one brief persisted for the event; delivery record created
- **Verification:** Brief contains event header, related email metadata, tasks, memories, attendee profile sections

### Test Case 2: Idempotency Across Overlapping Runs
- **Endpoint:** `/api/cron/meeting-prep`
- **Method:** GET
- **Test Data:** Valid cron secret; same imminent event; endpoint invoked twice within the window
- **Expected Result:** HTTP 200 both runs; exactly one brief for the event
- **Verification:** Brief count for the event equals one after both runs; single delivery

### Test Case 3: Empty-Context Brief
- **Endpoint:** `/api/cron/meeting-prep`
- **Method:** GET
- **Test Data:** Valid cron secret; imminent event whose attendees match no emails, tasks, memories, or profiles
- **Expected Result:** HTTP 200; brief generated with explicitly empty sections
- **Verification:** All sections present as empty arrays; no nulls/undefined; no fabricated content

### Test Case 4: Unauthorized Invocation Rejected
- **Endpoint:** `/api/cron/meeting-prep`
- **Method:** GET
- **Test Data:** Missing or wrong cron secret
- **Expected Result:** HTTP 401; no briefs generated
- **Verification:** Brief count unchanged; no delivery records created

## Technical Tasks

### Task 1: Prep Brief Storage
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Wave 5.4.1 (`calendar_events` table)
- **Priority:** High

**Deliverables:**
- Migration for a meeting-prep brief store keyed to the calendar event, with a uniqueness guard (one brief per event) and structured jsonb content
- RLS (user reads own briefs; service role writes) and regenerated types

**Acceptance Criteria:**
- [ ] A second insert for the same event conflicts harmlessly (idempotency at the storage layer).
- [ ] Users can read only their own briefs.

---

### Task 2: Deterministic Assembly Function
- **Agent:** backend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 1; Feature 5.2 (`email_metadata`); Epic 2 (memories, entity profiles); Epic 4 (tasks)
- **Priority:** High

**Deliverables:**
- Assembly function producing a structured brief from an event: attendee-matched email metadata, related open tasks, memories, and entity profile facts
- Defensive queries — any missing source table or empty result yields an explicitly empty section

**Acceptance Criteria:**
- [ ] No Anthropic SDK usage in the assembly call graph (ADR-008 invariant).
- [ ] Attendee matching works from the synced attendees jsonb against email participants and entity profiles.
- [ ] Assembly completes quickly enough to run inside a cron invocation for multiple simultaneous events.

---

### Task 3: Prep Trigger Cron Endpoint
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- `GET /api/cron/meeting-prep` route — cron-secret protected, runs every 5 minutes, finds timed events starting in the next ~15 minutes without an existing brief, assembles and persists briefs
- Vercel Cron entry and structured per-run summary log

**Acceptance Criteria:**
- [ ] Fails closed without a valid cron secret.
- [ ] Only events in the look-ahead window without an existing brief are processed.
- [ ] One event's assembly failure does not block briefs for other events in the same run.

---

### Task 4: In-App Delivery
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 3
- **Priority:** Medium

**Deliverables:**
- Delivery of each new brief as an in-app notification/chat message referencing the event
- Delivery status tracked on the brief record

**Acceptance Criteria:**
- [ ] Brief appears in the user's chat/notification surface when generated.
- [ ] A brief is never delivered twice for the same event.
- [ ] Failed delivery is recorded without losing the persisted brief.

---

### Task 5: Prep Pipeline Test Coverage
- **Agent:** quality-control
- **Estimation:** 5 hours
- **Dependencies:** Task 4
- **Priority:** Medium

**Deliverables:**
- Unit tests for attendee matching and section assembly (populated and empty contexts)
- Integration tests covering the four logical test cases, including the no-LLM assertion

**Acceptance Criteria:**
- [ ] All logical test cases pass; idempotency verified by count assertions.
- [ ] A test asserts the assembly path makes no model calls.

---

## Task Dependencies

```
Task 1 (brief storage)
  ↓
Task 2 (deterministic assembly)
  ↓
Task 3 (cron trigger)
  ↓
Task 4 (delivery)
  ↓
Task 5 (test coverage)
```

Sequential critical path; Task 4 UI-side rendering can be prepared in parallel with Task 3 if desired.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3, Task 4 | 23 |
| quality-control | Task 5 | 5 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] No LLM call in the prep pipeline (verified by review and test)
- [ ] Documentation updated
- [ ] Deployed to staging with the prep cron active; a real brief observed before a test meeting

## Infrastructure Specifications

### Database

Meeting-prep brief store (indicative shape):

```sql
CREATE TABLE meeting_prep_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (calendar_event_id)
);
```

RLS: user reads own rows; service role writes. Brief `content` sections: event header, related emails (metadata only), open tasks, memories, attendee profiles — all arrays, never undefined.

### API

- **`GET /api/cron/meeting-prep`** — cron-secret protected; 200 response `{ eventsChecked, briefsGenerated, delivered, errors[] }`; 401 on auth failure. Vercel Cron schedule: `*/5 * * * *` (every 5 minutes; Vercel plan permitting — fall back to every 15 minutes with a widened look-ahead if not).
- Look-ahead window: events with a start time in (now, now + ~15 minutes], timed events only, no existing brief.
- No provider API calls in this wave — assembly reads only local tables (calendar sync already localized the events).

### Monitoring

- Structured log per run with events checked, briefs generated, delivery outcomes.
- Alert condition: briefs generated but repeated delivery failures across runs.

## Handoff Requirements

**For next wave (5.4.3):**
- No hard dependency — follow-up detection is independent — but shared cron conventions (secret auth, structured run summaries, per-item fault isolation) established here carry forward.

**For other Features/Epics:**
- Future tray phase (Tauri) will poll/receive the same persisted brief payload — the structured `content` object is the contract; delivery surface changes, assembly does not.
- Epic 6 weekly review may reference generated briefs as evidence of meeting activity.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Vercel plan does not allow 5-minute crons | Med | Run every 15 minutes with a 15–20 minute look-ahead; brief may arrive slightly earlier than 15 minutes out |
| Attendee matching misses (email alias vs. calendar address) | Med | Match on normalized email addresses first, display-name fallback; entity profiles improve matching over time (Epic 2) |
| Sparse context makes briefs feel empty early on | Low | Explicitly empty sections set honest expectations; value grows as email/memory data accumulates |
| Cron timing drift means a brief lands after the meeting starts | Med | Look-ahead window sized to cron cadence; events already started are excluded rather than delivered late |

## Notes and Assumptions

- Meeting prep follows the ADR-008 deterministic-assembly pattern exactly: structured JSON content, UI-side rendering, on-demand LLM elaboration available in normal chat only.
- Delivery in this wave is in-app (notification/chat message). Tray delivery is a future Tauri-phase concern — never a Node tray.
- Wave 5.4.1 must be live: briefs are only as fresh as the hourly calendar sync.
- Email bodies are never pulled into briefs — metadata and summaries only (Feature 5.2 contract).

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.4)
- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture: docs/architecture/decisions/ADR-008-deterministic-daily-briefing.md (pattern); docs/architecture/decisions/ADR-013-integration-token-authority.md
- Blueprint §11.3–§11.5 (meeting prep)

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
