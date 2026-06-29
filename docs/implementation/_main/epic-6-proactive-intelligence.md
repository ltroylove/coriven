---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: epic
status: Planning
domain: implementation
product:
  - "coriven"
epic: "6"
priority: "Medium"
branch: "epic/6-proactive-intelligence"
architecture: ["ADR-010"]
tags: [coriven, proactive, patterns, weekly-review, cross-context]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 6: Proactive Intelligence

## Epic Overview
- **Epic ID:** Epic-6
- **Status:** Planning
- **Duration:** Medium
- **Team:** Solo (owner/developer)
- **Priority:** Medium (the "assistant initiates" shift)

## Problem Statement

Up to now Coriven mostly responds. This Epic makes it initiate — detecting patterns in behavior, surfacing stalled goals, generating a weekly review, and answering cross-context questions that pull from tasks, goals, memory, and (if present) email. The shift is from "what task next?" to "what is blocking this goal?" See blueprint §12.

## Goals and Success Criteria

Coriven proactively surfaces useful signals the user didn't ask for, and can answer questions that span its whole knowledge.

**Success Metrics:**
- Stop completing a goal's tasks for 7 days → receive a nudge (ties to Epic 4's stale-goal model).
- Friday 5pm → an accurate weekly review (wins, blockers, next-week focus) delivered via tray.
- A newly detected habit (e.g., gym frequency) fires a subtle informational notification.
- "What's been happening with my gym project?" pulls email + tasks + memory into one answer.

## Scope

### In Scope
- `detected_patterns` table; nightly pattern detection.
- Stale-goal nudges (proactive surfacing tied to Epic 4's momentum/stale model).
- Friday 5pm weekly review (stored in `daily_briefings` type `weekly`); tray delivery.
- Cross-context queries (combine tasks + goals + memory + email).
- Proactive tools: `generate_weekly_review`, `detect_patterns`, `push_notification`.

### Out of Scope
- Demand detection / silent-vs-intervention λ-dial (blueprint §12.4 — deferred, needs more data).
- Long-horizon decision modeling (blueprint §12.5/§18.6 — direction, not a feature).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 6.1: Pattern Detection
- **Scope:** Nightly analysis of task-completion history to identify habits and recurring blockers; store in `detected_patterns`; subtle tray notice on new detections.
- **Key Technical Approach:** `lib/jobs/` nightly cron; pattern types (gym_days, weekly_review_time, stale_goal, follow_up_needed); `detect_patterns` tool exposes results to chat. See blueprint §12.1.
- **Requirements:** Business Requirements Feature 8, UC-42.
- **Dependencies:** Epic 4 (tasks/goals history); Epic 1 (cron).
- **Wave Planning:** Detection-job wave + tool/notification wave.

### Feature 6.2: Stale-Goal Nudges (Proactive Delivery)
- **Scope:** Deliver proactive nudges for goals with no activity (14 days per §7.3; the 7-day acceptance scenario tests the surfacing path).
- **Key Technical Approach:** Builds on Epic 4's momentum/stale computation; routes nudges via tray (`push_notification`). See blueprint §12.2.
- **Requirements:** Business Requirements UC-40; proactive principle.
- **Dependencies:** Epic 4 (Feature 4.3).
- **Wave Planning:** One wave.

### Feature 6.3: Weekly Review
- **Scope:** Friday 5pm structured week-in-review (wins, blockers, next-week focus) from task + goal history; stored as `daily_briefings` (type `weekly`); delivered via tray.
- **Key Technical Approach:** Vercel Cron (`CRON_SECRET`); assembled from structured data (consistent with the deterministic-briefing approach, ADR-008) with optional light LLM phrasing for narrative. See blueprint §12.3.
- **Requirements:** Business Requirements Feature 8, UC-38.
- **Dependencies:** Epic 4.
- **Wave Planning:** One wave.

### Feature 6.4: Cross-Context Queries
- **Scope:** Answer questions that span tasks, goals, memory, and email in one response.
- **Key Technical Approach:** Chat engine composes context across stores (leverages Epic 2 memory + Epic 5 email metadata when present); no new storage. See blueprint §12 intro.
- **Requirements:** Business Requirements Feature 8 (cross-context).
- **Dependencies:** Epic 2 (memory); soft: Epic 5 (email) for richer answers.
- **Wave Planning:** One wave.

## Dependencies

**Prerequisites:** Epic 4 (goals/tasks history), Epic 1 (cron). Strong: Epic 2 (memory).
**Enables:** Mature proactivity; sets up the deferred demand-detection direction (§12.4).
**External Dependencies:** Vercel Cron; (cross-context) Epic 5 data if connected.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Nudges feel naggy | Med | Med | Calm-proactivity principle; frequency caps (once/7-day) |
| Cold-start (no behavioral data) | Med | High (early) | Acknowledge; patterns improve with use; don't fabricate |
| Pattern false signals | Low | Med | Conservative thresholds; user-visible, dismissible |

## Technical Considerations

Proactive jobs are scheduled (cron), not real-time. Weekly review follows the deterministic-assembly ethos (ADR-008). The richer demand-detection model is deliberately deferred until the profile/Sentinel layer has enough data (blueprint §12.4).

## Compliance and Security

Per-user RLS on `detected_patterns`; cron gated by `CRON_SECRET`; notifications via the tray (no external sends — no approval gate needed for internal nudges).

## Related Documentation
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Feature 8)
- Architecture: docs/architecture/_main/04-Architecture.md (jobs/cron)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§12)

## Architecture Decision Records (ADRs)
- ADR-010: Scheduled proactive jobs (cron) over real-time computation

---
**Template Version:** 2.0 (3-layer, embedded features)
