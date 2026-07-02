---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-008"
deciders: "Roy Love"
product:
  - "coriven"
tags: [briefing, cost, determinism]
relateddocuments:
  - "docs/implementation/_main/epic-4-goal-driven-organization.md"
---

# ADR-008: Deterministic Daily Briefing (No LLM Generation)

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Epic 4 (Goal-Driven Organization); blueprint §10.1

---

## Context

The daily briefing summarizes goals in motion, upcoming items, stalled goals, and pending approvals. An earlier design generated it with an LLM prompt. The recency rule in the blueprint (§0.4, §10.1) favors a deterministic template: assemble from structured data, no model call. We must decide how the briefing is produced.

## Considered Options

- **Option 1: LLM-generated briefing** — a prompt turns data into prose each morning.
- **Option 2: Deterministic template** — assemble the briefing from structured queries; no LLM.
- **Option 3: Hybrid** — deterministic data with optional light LLM phrasing.

## Decision

**We will generate the daily briefing deterministically from structured data, with no LLM call.** On-demand "tell me more about my week" remains a normal LLM chat query.

### Why This Choice

**Key factors:**
1. **Faster, cheaper, predictable** — no per-user model call every morning; no token cost or latency.
2. **Reliability** — the briefing cannot hallucinate or vary; it reflects the database exactly.
3. **Recency** — the 2026-06-24 blueprint supersedes the earlier LLM-generation design.

## Consequences

### Positive
- Zero LLM cost/latency for a daily, every-user job.
- Stable, testable output; trivially correct.

### Negative
- Less "natural language" warmth than generated prose.

### Mitigation Strategies
- Keep the template human and well-formatted; offer on-demand LLM elaboration via chat. The weekly review (Epic 6) follows the same deterministic-assembly ethos, with optional light phrasing.

---

## Implementation Outcome (Epic 4, 2026-07-02)

**Actual vs predicted:** as predicted. `assembleBriefing()` (`apps/web/src/lib/jobs/briefing.ts`) makes zero model calls — Supabase queries only — and the cost/latency/reliability consequences held.

Decisions made during implementation, not anticipated here:
1. **Structured JSON, not a prose template.** The briefing is stored as a `BriefingContent` JSON object (goals in motion, upcoming 7 days, stalled, approvals pending) in `daily_briefings.content` and rendered as sections by the `/today` page — the "template" is UI-side, not text assembly. Same determinism, better reuse (tray polls `/api/briefing/today` for the same payload).
2. **On-demand assembly exposed as a chat tool.** `generate_daily_briefing` reuses the same deterministic function inside chat; the LLM only narrates the returned data. This preserves the no-LLM-generation invariant while giving the "tell me about my day" affordance.

---

## References
- Master blueprint §10 (Daily Briefing), §10.1
- Epic 4: `docs/implementation/_main/epic-4-goal-driven-organization.md`

---
**Last Updated**: 2026-07-02
