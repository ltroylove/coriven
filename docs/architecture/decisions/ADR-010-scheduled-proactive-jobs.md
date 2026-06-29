---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
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

## References
- Master blueprint §7.3 (momentum), §12 (proactive intelligence)
- Epic 6: `docs/implementation/_main/epic-6-proactive-intelligence.md`

---
**Last Updated**: 2026-06-29
