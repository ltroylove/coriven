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
wave: "5.4.3"
agents: []
tags: [coriven, email, follow-up, cron, nightly, inbox]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
---

# Wave 5.4.3: Follow-Up Detection

## Wave Overview
- **Wave ID:** Wave-5.4.3
- **Feature:** Feature 5.4 - Calendar Intelligence, Meeting Prep & Follow-Up
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: Nightly detection of email threads where the user sent the last message more than 3 days ago with no reply, and surfacing of those threads as follow-up candidates in the `/email` inbox view.
- **Wave Goal:** Threads the user is waiting on never silently go cold — every unanswered outbound thread older than 3 days is flagged and visible in one place, and clears itself when a reply arrives or the user dismisses it.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A nightly job deterministically identifies threads where the user sent the last message more than 3 days ago and no reply has arrived, from email metadata already synced by Feature 5.2 — no LLM, no email bodies.
2. Follow-up candidates appear in the `/email` view as a distinct, clearly-labeled section (or badge) with enough context to act on.
3. Candidates resolve honestly: an incoming reply clears the flag automatically on the next detection run, and the user can dismiss a candidate manually.

## User Stories

### User Story 1: Unanswered Threads Detected Nightly

**As a** user who sends emails that need answers
**I want** Coriven to detect threads where I sent the last message over 3 days ago with no reply
**So that** things I'm waiting on don't slip through the cracks

**Acceptance Criteria:**
- [ ] A nightly job flags threads whose most recent message is from the user, sent more than 3 days ago, with no subsequent reply.
- [ ] Threads where the other party replied — even after the flag was set — are cleared on the next run.
- [ ] Detection uses synced email metadata only; no provider fetches of message bodies and no LLM calls.
- [ ] Running the job repeatedly does not duplicate flags or notifications.

**Priority:** High

---

### User Story 2: Follow-Up Candidates Visible in /email

**As a** user
**I want** flagged threads surfaced in the email view as a distinct follow-up section
**So that** I can review everything awaiting a reply in one glance

**Acceptance Criteria:**
- [ ] The `/email` page shows follow-up candidates in a visually distinct section or with a clear badge.
- [ ] Each candidate shows recipient, subject, one-line summary, and how many days it has been waiting.
- [ ] Candidates are ordered with the longest-waiting first.
- [ ] The section states clearly when there are no follow-up candidates.

**Priority:** High

---

### User Story 3: Dismiss and Auto-Resolve

**As a** user
**I want** to dismiss a follow-up candidate that no longer needs chasing, and have replies clear candidates automatically
**So that** the list stays trustworthy instead of filling with noise

**Acceptance Criteria:**
- [ ] Dismissing a candidate removes it from the follow-up section and it is not re-flagged on subsequent runs.
- [ ] A reply arriving on a flagged thread clears the candidate automatically at the next detection run.
- [ ] Dismissal affects only the acting user's own candidates.

**Priority:** Medium

---

### User Story 4: Secure, Observable Nightly Job

**As** the system operator
**I want** the detection job authenticated, fault-isolated, and summarized per run
**So that** it runs unattended and problems are visible without digging

**Acceptance Criteria:**
- [ ] The detection endpoint rejects unauthenticated invocations and runs on a nightly schedule.
- [ ] A failure for one user does not block detection for others.
- [ ] Each run reports a structured summary (threads scanned, candidates flagged, candidates cleared, errors).

**Priority:** Medium

---

## Logical Unit Test Cases

### Test Case 1: Stale Outbound Thread Flagged
- **Endpoint:** `/api/cron/followup-detection`
- **Method:** GET
- **Test Data:** Valid cron secret; metadata for a thread where the user's message is the latest, sent 4 days ago
- **Expected Result:** HTTP 200; the thread is flagged as a follow-up candidate
- **Verification:** Candidate record exists for the thread with correct waiting-days derivation

### Test Case 2: Replied Thread Not Flagged / Cleared
- **Endpoint:** `/api/cron/followup-detection`
- **Method:** GET
- **Test Data:** Valid cron secret; a previously flagged thread that now has an incoming reply newer than the user's last message
- **Expected Result:** HTTP 200; the candidate is cleared
- **Verification:** Thread no longer appears as a candidate; run summary counts it as cleared

### Test Case 3: Boundary — Exactly 3 Days
- **Endpoint:** `/api/cron/followup-detection`
- **Method:** GET
- **Test Data:** Valid cron secret; threads with the user's last message 2.9 days and 3.1 days old
- **Expected Result:** HTTP 200; only the >3-day thread is flagged
- **Verification:** 2.9-day thread absent from candidates; 3.1-day thread present

### Test Case 4: Dismissed Candidate Stays Dismissed
- **Endpoint:** `/api/cron/followup-detection`
- **Method:** GET
- **Test Data:** Valid cron secret; a candidate the user dismissed, thread still unanswered
- **Expected Result:** HTTP 200; the dismissed thread is not re-flagged
- **Verification:** No new candidate record for the dismissed thread; dismissal state intact

### Test Case 5: Unauthorized Invocation Rejected
- **Endpoint:** `/api/cron/followup-detection`
- **Method:** GET
- **Test Data:** Missing or wrong cron secret
- **Expected Result:** HTTP 401; no detection performed
- **Verification:** Candidate records unchanged

## Technical Tasks

### Task 1: Follow-Up Candidate State
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Feature 5.2 (`email_metadata` with thread and direction data)
- **Priority:** High

**Deliverables:**
- Migration adding follow-up candidate state (flagged/dismissed/cleared with timestamps) keyed to user + thread — either columns on the email metadata store or a small candidates table, decided at implementation
- RLS consistent with existing email metadata policies; regenerated types

**Acceptance Criteria:**
- [ ] Candidate state is queryable per user and per thread without scanning message bodies.
- [ ] Dismissal state persists across detection runs.

---

### Task 2: Detection Logic
- **Agent:** backend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- Deterministic detection function: per user, find threads whose latest message is outbound and older than 3 days with no reply; flag new candidates, clear replied ones, respect dismissals
- Boundary handling for the 3-day threshold and for threads with only outbound messages

**Acceptance Criteria:**
- [ ] Flag, clear, and dismissal-respect behaviors match the logical test cases.
- [ ] Function operates on local metadata only — no provider API calls, no LLM.

---

### Task 3: Nightly Cron Endpoint
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 2
- **Priority:** High

**Deliverables:**
- `GET /api/cron/followup-detection` route — cron-secret protected, iterates users, runs detection, records per-run summary
- Vercel Cron entry on a nightly schedule

**Acceptance Criteria:**
- [ ] Fails closed without a valid cron secret.
- [ ] Per-user failures are isolated; the batch completes.
- [ ] Structured summary logged per run (scanned, flagged, cleared, errors).

---

### Task 4: /email Follow-Up Section
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Task 1 (candidate state readable); can start against seeded data in parallel with Tasks 2–3
- **Priority:** High

**Deliverables:**
- Follow-up candidates section (or badge treatment) on the `/email` page: recipient, subject, summary, days waiting, longest-waiting first
- Dismiss control wired to a Server Action updating candidate state; empty state messaging

**Acceptance Criteria:**
- [ ] Section is visually distinct from the triaged inbox and accessible (keyboard-operable dismiss, labeled controls).
- [ ] Dismissing updates the view without a full reload and survives refresh.
- [ ] Only the signed-in user's candidates are ever shown.

---

### Task 5: Detection and UI Test Coverage
- **Agent:** quality-control
- **Estimation:** 4 hours
- **Dependencies:** Task 3, Task 4
- **Priority:** Medium

**Deliverables:**
- Unit tests for detection logic including the 3-day boundary, reply-clears, and dismissal cases
- Integration tests for the five logical test cases and the dismiss action

**Acceptance Criteria:**
- [ ] All logical test cases pass without external provider calls.
- [ ] Boundary and idempotency behavior verified by assertions, not inspection.

---

## Task Dependencies

```
Task 1 (candidate state)
  ├─> Task 2 (detection logic)
  │       ↓
  │   Task 3 (nightly cron)
  └─> Task 4 (/email UI — parallel with Tasks 2–3)
          ↓
      Task 5 (test coverage — after Tasks 3 & 4)
```

Critical path: Task 1 → Task 2 → Task 3 → Task 5. Task 4 runs in parallel after Task 1.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| backend-specialist | Task 1, Task 2, Task 3 | 14 |
| frontend-specialist | Task 4 | 6 |
| quality-control | Task 5 | 4 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors
- [ ] Detection makes no provider or LLM calls (verified by review)
- [ ] Documentation updated
- [ ] Deployed to staging with the nightly cron active; a seeded stale thread observed in `/email`

## Infrastructure Specifications

### API

- **`GET /api/cron/followup-detection`** — cron-secret protected; 200 response `{ usersProcessed, threadsScanned, candidatesFlagged, candidatesCleared, errors[] }`; 401 on auth failure. Vercel Cron schedule: nightly (e.g., `0 6 * * *` UTC — off-peak relative to the user base).
- Detection input: `email_metadata` thread grouping with message direction and sent timestamps (Feature 5.2 contract). No token retrieval needed — this job never calls a provider.

### Database

- Candidate state per (user, thread): flagged_at, dismissed_at, cleared_at (or equivalent status enum). Implementation may extend `email_metadata` or add a small table; either way RLS mirrors the email metadata policies (user reads own rows, service role writes from cron, user-initiated dismiss via Server Action).

### Monitoring

- Structured log per run with scan/flag/clear counts and per-user errors.
- Alert condition: nightly run absent or erroring for more than one consecutive night.

## Handoff Requirements

**For next wave / Feature completion:**
- This is the final Feature 5.4 wave. With 5.4.1–5.4.3 done, the feature's success metric set (calendar synced, prep brief fires 15 minutes before events, follow-ups surfaced) is fully demonstrable.

**For other Features/Epics:**
- Epic 6 proactive engine can consume follow-up candidates as nudge material ("you're still waiting on Sarah — want a follow-up draft?"); a drafted follow-up reply routes through the Feature 5.3 approval queue like any external send.
- Daily briefing (Epic 4) may later include a follow-up count — the candidate state added here is queryable for that without change.

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Thread direction/participant data in email metadata insufficient to identify "user sent last" | High | Verify Feature 5.2 stores direction and thread IDs before starting; extend the poller's stored metadata first if not |
| Mailing-list or no-reply threads flood the candidate list | Med | Exclude threads where the counterpart is a no-reply/list address; dismissal covers the remainder; refine heuristics over time |
| Reply detection lags because polling is 15-minute metadata sync | Low | Acceptable — candidates clear on the next nightly run; document the latency in the UI copy if needed |
| Dismissed items re-flagged after new outbound message on same thread | Low | Define dismissal as thread-scoped until a new outbound message post-dismissal restarts the clock; covered by tests |

## Notes and Assumptions

- Detection is deterministic and metadata-only — no email bodies fetched, no LLM, nothing from the thread content is ever passed to Claude as instructions (zero-trust spine).
- The 3-day threshold is fixed for this wave; making it user-configurable is a future settings enhancement, not in scope.
- Follow-up candidates are surfaced only — drafting an actual follow-up email is a chat/approval-queue flow (Feature 5.3), not part of this wave.
- Feature 5.2 must be live and populating `email_metadata` for both providers before this wave delivers value.

## Related Documentation

- Feature Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.4)
- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md
- Architecture: docs/architecture/decisions/ADR-013-integration-token-authority.md; docs/architecture/decisions/ADR-009-approval-queue-audit-gate.md
- Blueprint §11.3–§11.5 (follow-up detection)

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
