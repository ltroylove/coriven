---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-010"
deciders: "Roy Love"
product:
  - "coriven"
tags: [proactive, cron, jobs]
relateddocuments:
  - "docs/implementation/_main/epic-6-proactive-intelligence.md"
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
  - "docs/reports/architecture/conformance-epic-4-goal-driven-organization.md"
---

# ADR-010: Scheduled Proactive Jobs (Cron) Over Real-Time Computation

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Epic 6 (Proactive Intelligence), Epic 4 (momentum); blueprint §7.3, §12

---

## Context

Coriven's proactive features — momentum recalculation, stale-goal nudges, pattern detection, weekly review, follow-up detection, meeting prep — analyze history and surface signals. We must decide whether these run in real time (on each relevant event) or on schedules.

## Considered Options

- **Option 1: Real-time computation** — recompute momentum/patterns on every task change, etc.
- **Option 2: Scheduled jobs (cron)** — nightly/periodic jobs compute and store results.
- **Option 3: Hybrid** — some real-time, some scheduled.

## Decision

**We will run proactive intelligence as scheduled Vercel Cron jobs**, writing results to storage (e.g., `goals.momentum`, `detected_patterns`, `daily_briefings`). Momentum is recalculated nightly, not on the request path.

### Why This Choice

**Key factors:**
1. **Cost & simplicity** — batch analysis off the request path; no per-event recompute storms.
2. **Predictable cadence** — briefings (7am, timezone-aware), patterns (nightly), weekly review (Fri 5pm), meeting prep (15 min before), follow-ups (nightly).
3. **Blueprint alignment** — §7.3 states momentum is "recalculated nightly… no real-time computation."

## Consequences

### Positive
- Cheap, predictable, easy to reason about and test.
- Keeps the chat/request path fast.

### Negative
- Signals can be stale between runs (e.g., momentum up to a day old).

### Mitigation Strategies
- Choose cadences matched to the signal's natural rate of change; cron endpoints gated by `CRON_SECRET`; idempotent jobs (unique constraints, `was_delivered`, `last_fired_at`).

---

## Implementation Outcome (Epic 4, 2026-07-02)

**Actual vs predicted:** the design held — momentum computation (`apps/web/src/lib/jobs/momentum.ts`) and briefing assembly run only from `/api/cron/*`; nothing recomputes on the request path. Refinements and learnings from the Epic 4 build:

1. **Briefing cadence refined.** "7am, timezone-aware" became a user-configurable `profiles.briefing_time` + `profiles.timezone`, with a `*/30 * * * *` cron and a ±30-minute window check (`isInBriefingWindow`). Double-fire across adjacent runs is absorbed by the `UNIQUE (user_id, briefing_date)` constraint with `ignoreDuplicates` — the exact idempotency mitigation predicted above, and it worked.
2. **Learning: Vercel Cron invokes via HTTP GET.** Cron route handlers must export `GET`; the Epic 4 routes shipped POST-only and would return 405 to the scheduler (conformance review finding C-1, open at review time).
3. **Learning: idempotency guards must use dedicated markers, not `updated_at` heuristics.** The nightly route's "skip if any goal was updated today" guard is defeated by ordinary user edits (the `updated_at` trigger fires on every update, any user) and silently cancels the run (finding C-2). Unique constraints / `was_delivered` / explicit `last_fired_at` markers remain the sanctioned pattern; naturally idempotent jobs (momentum recompute) may need no guard at all.
4. **Open tension: `set_goal_momentum` chat tool.** Implementation added a tool letting the model set momentum directly in chat; the nightly job overwrites it on the next run. Either remove the tool or formalize a user-override that the job respects — to be resolved before Epic 6 builds on the momentum signal.

Conformance review: `docs/reports/architecture/conformance-epic-4-goal-driven-organization.md`.

---

## References
- Master blueprint §7.3 (momentum), §12 (proactive intelligence)
- Epic 6: `docs/implementation/_main/epic-6-proactive-intelligence.md`

---
**Last Updated**: 2026-07-02
