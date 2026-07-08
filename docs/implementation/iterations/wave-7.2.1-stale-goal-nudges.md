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
epic: "7"
feature: "7.2"
wave: "7.2.1"
agents: []
tags: [coriven, proactive, stale-goal, nudge, tray, notifications, momentum, goals]
relateddocuments:
  - "docs/implementation/_main/epic-7-proactive-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 7.2.1: Stale-Goal Nudges

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 7.2.1 |
| Feature | 7.2 — Stale-Goal Nudges (Proactive Delivery) |
| Epic | 7 — Proactive Intelligence |
| Status | Planning |
| Scope | Extend the nightly cron (or add a dedicated job) to detect goals with no linked task activity for 14 days; deliver a single tray nudge per stale goal per 7-day window; surface stale goals in the daily briefing; expose the `push_notification` tool for chat-driven nudges |

**Wave Philosophy:** Scope-based — this wave is complete when a goal that has seen no task-completion activity for 14 days (per blueprint §7.3) produces exactly one proactive tray nudge per 7-day window, the nudge reaches the user via the existing tray poll mechanism, and the `push_notification` tool is available for chat-driven surfacing — regardless of calendar time.

## Wave Goals

1. **Stale-goal detection integrated into the cron pipeline.** The nightly job identifies goals whose last linked task-completion timestamp is more than 14 days ago (or have never had a completion), writes a `stale_goal` entry to `detected_patterns`, and deactivates it if activity resumes — fully reusing the pattern store from Wave 7.1.1.
2. **Tray nudge delivered per stale goal within the frequency cap.** The tray poll receives and fires one native notification per stale goal per 7-day window ("Your [goal] goal hasn't had activity in N days"); the message is generated server-side with the actual day count; silence after user activity resumes.
3. **`push_notification` tool available in chat.** The tool allows the chat engine to surface a stale-goal reminder on demand (e.g., user asks "remind me about my gym goal"); the tool inserts a notification entry that the tray picks up on its next poll cycle.

## User Stories

### Story 7.2.1.1 — Stale goals are detected nightly and stored as patterns

**As the** Pattern-Detection Cron actor,
**I want** to identify goals with no linked task-completion activity for 14 days and write them to `detected_patterns` as `stale_goal` entries,
**So that** the system can proactively surface goals the user has silently abandoned, consistent with the goal-health model from Epic 4.

**Acceptance Criteria:**
- The nightly detection job (from Wave 7.1.1 or a co-located extension) queries `goals` joined with `tasks` to find goals where the most recent task `completed_at` is older than 14 days, or where the goal has no linked completed tasks at all.
- Goals with `status = 'completed'` or `status = 'cancelled'` are excluded from staleness checks.
- For each stale goal, a `detected_patterns` row is upserted with `pattern_type = 'stale_goal'`, a description including the goal title and exact inactivity count in days (e.g., "No activity on 'Read 12 books' for 18 days"), and `is_active = true`.
- When a stale goal resumes task activity (a linked task is completed), the corresponding `stale_goal` pattern is set to `is_active = false` on the next nightly run.
- The staleness threshold is sourced from a named constant (not hardcoded to 14); default value is 14 days per blueprint §7.3 and §12.2.
- The acceptance scenario from epic success criteria is satisfied: stop completing a goal's tasks for 7 days (configurable for test environments) and the pattern entry exists in the database.

**Priority:** Critical
**Estimated hours:** 5h
**Business Requirements:** Feature 8, UC-40 (Stale-goal nudge)

#### Task 7.2.1.1.1 — Extend pattern-detection job with stale-goal analysis

- **Parent Story:** 7.2.1.1
- **Agent:** Backend Engineer
- **Estimation:** 5h
- **Dependencies:** Wave 7.1.1 complete (`detected_patterns` table and job framework); Epic 4 `goals` and `tasks` tables with `completed_at` and goal-task linkage
- **Deliverables:** Updated `apps/web/src/lib/jobs/detect-patterns.ts` with `detectStaleGoals(userId: string)` function; exported `STALE_GOAL_THRESHOLD_DAYS` constant
- **Acceptance Criteria:** Function queries goals not in terminal status with no linked task completion in the threshold window; upsert to `detected_patterns` is idempotent; resumption of activity deactivates the pattern on subsequent runs; unit tests cover the staleness calculation, the resumption path, and the exclusion of completed/cancelled goals.

---

### Story 7.2.1.2 — Tray delivers one proactive nudge per stale goal per 7 days

**As the** Primary User,
**I want** to receive a tray notification when a goal I care about has had no activity for two weeks,
**So that** I'm reminded before the goal silently drifts without ever choosing to abandon it.

**Acceptance Criteria:**
- The tray polls `/api/patterns/new` (from Wave 7.1.1) and receives `stale_goal` patterns along with other pattern types; no new endpoint required.
- The notification message is assembled server-side and includes the goal title and inactivity day count, sourced from the pattern's `description` field.
- Frequency cap: a stale-goal notification for the same goal fires at most once per 7 days per user; enforced via `last_notified_at` on the `detected_patterns` row (from Wave 7.1.1).
- Notification tone is matter-of-fact, not alarming: "Your 'Read 12 books' goal hasn't had activity in 18 days."
- Notification carries no action buttons (informational); dismissing it on the OS clears it.
- A goal that receives a nudge and then has a task completed within the next poll cycle stops receiving nudges (pattern deactivated by the next nightly run).
- No notification fires for goals with fewer than 14 days of inactivity.
- The UX calm-proactivity principle is satisfied: a user managing multiple stale goals at once receives at most one notification per poll cycle per goal, not a flood.

**Priority:** High
**Estimated hours:** 3h
**Business Requirements:** Feature 8, UC-40; UX calm-proactivity principle (§4.1)

#### Task 7.2.1.2.1 — Verify stale-goal patterns flow through the existing tray notification path

- **Parent Story:** 7.2.1.2
- **Agent:** Backend / Tray Engineer
- **Estimation:** 3h
- **Dependencies:** Task 7.2.1.1.1; Wave 7.1.1 tray integration (Task 6.1.1.4.2)
- **Deliverables:** End-to-end integration test or manual test log confirming a stale-goal pattern fires a tray notification with the correct message; any required updates to the tray's `notifyPattern` call to handle `stale_goal` type specifically (e.g., no sound, specific icon if applicable)
- **Acceptance Criteria:** A synthetic `stale_goal` pattern row with `last_notified_at = null` causes the tray to fire a notification on the next poll; the notification text matches the `description` field; `last_notified_at` is set after firing; re-polling within 7 days does not re-fire.

---

### Story 7.2.1.3 — Stale goals surface in the daily briefing

**As the** Primary User,
**I want** stale goals listed in the "Stalled" section of my daily briefing,
**So that** the daily briefing provides a complete picture of goals needing attention without requiring a separate notification channel.

**Acceptance Criteria:**
- The daily briefing assembly (from Epic 4 / Phase 3) queries `detected_patterns` for active `stale_goal` entries for the user and includes them in the briefing's stalled-goals section.
- Each stale goal listed in the briefing includes the goal title and inactivity day count.
- Stale goals that already appear in the briefing do not fire a separate tray notification on the same day (the briefing delivery counts as the notification event for that day's frequency-cap window, or the briefing and the stale-goal nudge are considered independent channels and both may appear — the behavior must be explicitly documented in the code; the default is that both can appear, since one is the briefing and one is a proactive alert).
- The briefing section is absent if no stale goals exist.
- This story does not require building the full briefing from scratch; it assumes the briefing assembly service from Epic 4 is in place and adds the stale-goal query as an additional data source.

**Priority:** Medium
**Estimated hours:** 4h
**Business Requirements:** Feature 8 (daily briefing, stalled goals); UX Today/Briefing screen (§screen "Today / Briefing")

#### Task 7.2.1.3.1 — Add stale-goal section to briefing assembly

- **Parent Story:** 7.2.1.3
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Task 7.2.1.1.1 (stale-goal patterns exist); Epic 4 briefing assembly service
- **Deliverables:** Updated `apps/web/src/lib/jobs/briefing.ts` (or equivalent briefing assembly module) to include `detected_patterns WHERE pattern_type = 'stale_goal' AND is_active = true` in the stalled-goals section
- **Acceptance Criteria:** Briefing row's stalled-goals section includes goal titles and inactivity counts from active `stale_goal` patterns; empty section is omitted from the briefing output; the query is user-scoped; no duplicate goals appear if a goal appears in both the momentum-stall model and the pattern model.

---

### Story 7.2.1.4 — `push_notification` tool allows chat to surface a stale-goal nudge on demand

**As the** Primary User,
**I want** to ask Coriven in chat to remind me about a specific goal,
**So that** I can trigger a proactive nudge manually when I want to be held accountable.

**Acceptance Criteria:**
- A `push_notification` tool is registered in `TOOL_REGISTRY` with a JSON-Schema input: `{ title: string, body: string, pattern_type?: string }`.
- The tool handler writes a record to `detected_patterns` (or a lightweight notifications queue) that the tray picks up on the next poll cycle and fires as a native notification.
- The tool is usable by the chat engine without any additional user approval (it creates a notification, not an external action); it does not go through the approval queue.
- The tool is included in `ALL_TOOL_NAMES` and gated by `tool_permissions`.
- The notification fired by this tool respects the same OS notification constraints (≤ 100 character body).
- When a user says "remind me about my gym goal in the next tray check", the chat calls `push_notification` and confirms it will fire on the next poll.

**Priority:** Medium
**Estimated hours:** 5h
**Business Requirements:** Feature 8; UC-42 (proactive tool)

#### Task 7.2.1.4.1 — Implement `push_notification` tool and pending-notification poll endpoint

- **Parent Story:** 7.2.1.4
- **Agent:** Backend Engineer
- **Estimation:** 5h
- **Dependencies:** Task 6.1.1.1.1 (DB); existing tool registry pattern
- **Deliverables:** Updated `registry.ts` and `handlers.ts`; `apps/web/src/app/api/notifications/pending/route.ts` or merged into `/api/patterns/new`; updated `ToolName` type
- **Acceptance Criteria:** Tool handler inserts a notification record with correct `user_id`; the tray poll endpoint returns it on the next cycle; after firing, the record is acknowledged; tool returns `is_error: false` with a confirmation message; tool entry is seeded into `tool_permissions` for existing users; body length validated server-side (truncated or rejected if > 100 chars with a clear error message).

---

## Task Dependencies

```
Wave 7.1.1 (detected_patterns table, job framework, tray path) — prerequisite
Epic 4 (goals, tasks with completed_at, briefing assembly) — prerequisite
    │
7.2.1.1.1  (stale-goal analysis in detection job)
    ├─► 7.2.1.2.1  (tray notification path verification)
    └─► 7.2.1.3.1  (briefing integration)

7.2.1.4.1  (push_notification tool) — independent; needs only DB and tool registry
```

**Critical path:** Wave 7.1.1 complete + Epic 4 deployed → stale-goal analysis (7.2.1.1.1) → tray path (7.2.1.2.1). Briefing integration and `push_notification` tool parallelize after 7.2.1.1.1.

## Definition of Done

- A goal with no linked task completions for 14 days has an active `stale_goal` entry in `detected_patterns` after the next nightly run.
- Acceptance scenario verified: stop completing a goal's tasks for 7 days (threshold lowered for test environment) → nudge appears in `detected_patterns` with correct description.
- The tray fires exactly one notification per stale goal per 7-day window; re-running the nightly job does not produce duplicate notifications.
- The daily briefing's stalled-goals section lists stale goals with title and inactivity day count when any are active.
- `push_notification` tool is available in chat, callable, and produces a tray notification on the next poll cycle.
- Unit tests cover: stale-goal detection query (threshold boundary, completed-goal exclusion, resumption path), frequency-cap verification (< 7 days → no notify, >= 7 days → notify), briefing-section population.
- Integration test verifies: nightly cron writes a stale-goal pattern; the pattern is returned by `/api/patterns/new`; acknowledge endpoint updates `last_notified_at`.
- TypeScript strict-mode passes with no new errors.
- `STALE_GOAL_THRESHOLD_DAYS` constant is exported and not hardcoded at call sites.

## Infrastructure Specifications

### Database

**Reuses `detected_patterns` from Wave 7.1.1.** No new tables required.

**Key query (stale-goal detection):**
```sql
SELECT g.id, g.title, MAX(t.completed_at) AS last_activity
FROM goals g
LEFT JOIN tasks t ON t.goal_id = g.id AND t.completed_at IS NOT NULL
WHERE g.user_id = $1
  AND g.status NOT IN ('completed', 'cancelled')
GROUP BY g.id, g.title
HAVING MAX(t.completed_at) < NOW() - INTERVAL '14 days'
   OR MAX(t.completed_at) IS NULL
```

Threshold (14 days) sourced from `STALE_GOAL_THRESHOLD_DAYS` constant. Parameterized for test overrides.

**RLS:** All queries user-scoped; cron writes via service-role client.

### API

**`push_notification` tool handler:**

| Attribute | Value |
|---|---|
| Input | `{ title: string, body: string, pattern_type?: string }` |
| Auth | `userId` from chat engine session |
| Side effect | Upserts a `detected_patterns` row with `last_notified_at = null` (tray will pick it up) |
| Response | `is_error: false` + confirmation string, or `is_error: true` with message |
| Body validation | Server-side length check ≤ 100 chars; returns error if exceeded |

**No new cron endpoints** — stale-goal detection is part of the existing `/api/cron/detect-patterns` job extended in Task 7.2.1.1.1.

**No new tray endpoints** — stale-goal patterns flow through `/api/patterns/new` from Wave 7.1.1.

### UI

No new UI screens required. The briefing's stalled-goals section is an update to the existing briefing assembly data, rendered in the existing `BriefingSection` component. The section is absent when no stale goals exist (no empty-state UI needed at this wave).

### Testing

- **Unit — stale-goal detection:** Goal with `completed_at` exactly 13 days ago → not stale. Goal with `completed_at` exactly 14 days ago → stale. Goal with no completions → stale. Goal with `status = 'completed'` → excluded.
- **Unit — resumption:** Goal previously stale, task completed yesterday → `is_active` set to false.
- **Unit — frequency cap:** Pattern with `last_notified_at = now() - 6 days` → not returned by `/api/patterns/new`. Pattern with `last_notified_at = now() - 8 days` → returned.
- **Unit — briefing section:** Active stale-goal patterns included; inactive excluded; correct day count in description.
- **Integration — push_notification tool:** Tool handler inserts record; poll endpoint returns it; acknowledge endpoint clears it.
- **Coverage target:** 80% line coverage on stale-goal detection logic and `push_notification` handler.

### Deployment

- No new Vercel Cron entries — stale-goal detection is part of the existing nightly job from Wave 7.1.1.
- `CRON_SECRET` already required from Wave 7.1.1.
- No new environment variables introduced.

### Monitoring

- **Stale-goal detection rate:** Count of active `stale_goal` patterns per nightly run; useful for monitoring goal engagement.
- **Nudge delivery rate:** Count of stale-goal notifications fired per week; if zero for an active user with known stale goals, investigate.
- **Briefing coverage:** Verify stale goals in `detected_patterns` match stalled-goals section in the generated briefing.

## Handoff Requirements

- Wave 7.1.1 must be fully deployed (`detected_patterns` table, nightly job, tray path, frequency-cap mechanism).
- Epic 4 goals and tasks tables must be populated with real goal-task linkage and `completed_at` timestamps.
- Epic 4 briefing assembly service must exist before Task 7.2.1.3.1 can be implemented.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Epic 4 not deployed (no goals/tasks data) | High | Med | Wave is blocked on Epic 4; explicit prerequisite |
| Nudges feel naggy if threshold too low | Med | Med | Default 14-day threshold; frequency cap enforced; user can see/dismiss in briefing |
| Goal-task linkage not implemented in Epic 4 | High | Low | Stale-goal query depends on `tasks.goal_id`; verify this column exists before starting 7.2.1.1.1 |
| `push_notification` misused to create noisy notification flood | Low | Low | Tool is gated by `tool_permissions`; frequency cap still applies |

## Related Documentation

- Epic: `docs/implementation/_main/epic-7-proactive-intelligence.md` — Feature 7.2
- Architecture: `docs/architecture/_main/04-Architecture.md` — §14.5, jobs/cron, §7.3 (momentum/stale model)
- ADR-010: `docs/architecture/decisions/ADR-010-scheduled-proactive-jobs.md`
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` — Feature 8, UC-40
- UX: `docs/architecture/_main/05-User-Experience.md` — calm proactivity, Today/Briefing screen
- Blueprint: `docs/planning/2026-06-24-coriven-master-blueprint.md` — §12.2, §7.3
- Preceding wave: `docs/implementation/iterations/wave-7.1.1-pattern-detection.md`
