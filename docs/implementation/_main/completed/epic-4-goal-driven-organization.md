---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: epic
status: Completed
domain: implementation
product:
  - "coriven"
epic: "4"
priority: "High"
branch: "epic/4-goal-driven-organization"
architecture: ["ADR-008"]
tags: [coriven, goals, momentum, briefing, life-os]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 4: Goal-Driven Organization

## Epic Overview
- **Epic ID:** Epic-4
- **Status:** Planning
- **Duration:** Medium
- **Team:** Solo (owner/developer)
- **Priority:** High (the "organize by *why*" differentiator)

## Problem Statement

A task list tells you *what*; it never tells you *why*, or whether your actions are serving your intentions. This Epic installs the goal hierarchy (Life Area → Goal → Project → Task → Reminder), computes goal momentum, surfaces stalled goals, and delivers a deterministic daily briefing — turning Coriven from a task app into a Life-OS dashboard. See Product Vision §1.1 and blueprint §7, §10.

## Goals and Success Criteria

The user organizes around goals, sees momentum at a glance, gets nudged when goals stall, and receives a useful morning briefing without opening a browser.

**Success Metrics:**
- Create Health → "Lose 100 lbs" with why + metrics → link a gym task → `/goals` shows momentum.
- Next morning, a tray briefing mentions the goal and today's linked task.
- A goal with no task activity for 14 days fires a stale-goal nudge.
- Momentum (improving/stable/declining) recalculated nightly and stored on `goals.momentum`.

## Scope

### In Scope
- Tables: `life_areas`, `goals`, `projects`, `daily_briefings`; `project_id`/`goal_id` on tasks.
- `/goals` (life areas as columns, goal cards with momentum), `/goals/[id]`, `/projects/[id]`.
- Goal tools: `create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project`, `generate_daily_briefing`.
- Momentum formula (blueprint §7.3); stale-goal nudge (14 days).
- **Deterministic** daily briefing (no LLM) + timezone-aware Vercel Cron (7am default); tray delivery.

### Out of Scope
- Weekly review and pattern detection (Epic 6 — Proactive).
- LLM-generated briefings (deterministic template per blueprint §10.1; on-demand "tell me about my week" is a normal chat query).

## Features & Waves

> Waves finalized in `/design-waves`.

### Feature 4.1: Goal Hierarchy Schema & Tools
- **Scope:** Create `life_areas`, `goals` (why_it_matters, success_metrics, status/confidence/momentum), `projects`, and add nullable `project_id`/`goal_id` to tasks; add goal tools.
- **Key Technical Approach:** SQL-first migration with goal enums (`goal_status`, `goal_confidence`, `goal_momentum`); tools follow the existing registry/handlers pattern. See Architecture data model §14.3.
- **Requirements:** Business Requirements Feature 1; blueprint §7.
- **Dependencies:** Epic 1; tasks table (built).
- **Wave Planning:** Migration wave + tools wave.

### Feature 4.2: Goals UI (Life-OS Dashboard)
- **Scope:** `/goals` with life areas as columns and goal cards (momentum badge, why, linked-task count); goal and project detail pages.
- **Key Technical Approach:** Server components + `GoalCard` component (UX §"Component Library"); ≤3 decisions/screen (UX Foundations Pass 4). See UX §"Goals" screen.
- **Requirements:** Business Requirements Feature 1; UX Foundations Pass 2 (IA).
- **Dependencies:** Feature 4.1.
- **Wave Planning:** List/dashboard wave + detail-pages wave.

### Feature 4.3: Momentum & Stale-Goal Nudge
- **Scope:** Nightly momentum recompute and the 14-day stale-goal nudge.
- **Key Technical Approach:** `lib/jobs/` momentum job using the §7.3 formula `(completed_7d − created_7d)/max(created_7d,1)` → improving/stable/declining; write to `goals.momentum`; nudge fires once per 7-day period. Runs in the nightly/briefing cron. See blueprint §7.3, §12.2.
- **Requirements:** Business Requirements Feature 1, UC-40; momentum acceptance.
- **Dependencies:** Feature 4.1.
- **Wave Planning:** One wave (job + nudge).

### Feature 4.4: Deterministic Daily Briefing
- **Scope:** Assemble the briefing from structured data (goals in motion, upcoming 7 days, stalled, approvals pending) with no LLM; store one row per user/day; deliver via tray.
- **Key Technical Approach:** `POST /api/cron/daily-briefing` protected by `CRON_SECRET`; timezone-aware windowing (timezone in `user_context`/`profiles`, cron runs UTC, skips users outside their window); tray polls `/api/briefing/today` on startup + noon, fires toast if `was_delivered = false`. See blueprint §10.
- **Requirements:** Business Requirements Feature 5; UC-8; NFR (CRON_SECRET).
- **Dependencies:** Features 4.1–4.3; Epic 1 (deploy/cron).
- **Wave Planning:** Briefing-generation wave + delivery wave.

## Dependencies

**Prerequisites:** Epic 1 (deploy + cron). Soft: Epic 2 (memory enriches goal context but not required).
**Enables:** Epic 6 (Proactive weekly review, pattern detection build on goals); briefing extended by Epic 5 (comms).
**External Dependencies:** Vercel Cron.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Timezone/cron windowing bugs (briefing at wrong time) | Med | Med | Store timezone; UTC cron with window skip; test across zones |
| Momentum formula feels wrong | Low | Med | Use the defined §7.3 formula; tune thresholds with real data |
| Briefing noise (too much/too little) | Med | Low | Deterministic template; ≤ a few items per section |

## Technical Considerations

Deterministic briefing (no LLM) is faster, cheaper, predictable (blueprint §10.1). Momentum is recomputed nightly, never in real time. Goals/tasks/life-areas are first-class tables, NOT entity-profile rows (avoids duplication with Epic 2).

## Compliance and Security

Per-user RLS on all new tables; cron endpoints gated by `CRON_SECRET`. No external systems touched.

## Related Documentation
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Features 1, 5)
- Architecture: docs/architecture/_main/04-Architecture.md (data model §14.3)
- UX: docs/architecture/_main/05-User-Experience.md (Goals, Briefing screens)

## Architecture Decision Records (ADRs)
- ADR-008: Deterministic daily briefing (no LLM generation)

---
**Template Version:** 2.0 (3-layer, embedded features)
