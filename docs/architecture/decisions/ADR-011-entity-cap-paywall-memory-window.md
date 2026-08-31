---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-011"
deciders: "Roy Love"
product:
  - "coriven"
tags: [monetization, paywall, memory-window, tiers]
relateddocuments:
  - "docs/implementation/_main/epic-7-productization.md"
---

# ADR-011: Entity Cap as Primary Paywall; Memory Window Enforced at Retrieval

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Epic 7 (Productization); blueprint §16, §19.5, §19.6

---

## Context

Coriven monetizes via freemium. The product promise is "it remembers you," so the conversion mechanism should align with that promise. We must decide the primary paywall and how the tiered "memory window" (Free 24h / Core 7d / Pro 30d) is technically enforced so it degrades gracefully rather than feeling broken.

## Considered Options

- **Option 1: Entity cap as the primary paywall** — Free tier capped at 10 entities; upgrade prompt at the cap.
- **Option 2: Feature-gating** (e.g., lock goals/comms behind paid) as primary.
- **Option 3: Usage/seat-based pricing.**

For memory-window enforcement: (a) delete old memories by tier, (b) filter by age at retrieval time, (c) hard-block writes after the window.

## Decision

**The entity cap is the primary paywall** (Free = 10 entities), with contextual upgrade prompts at the cap. **The memory window is enforced at retrieval** by filtering memory age per tier — never by deleting data — so it degrades gracefully (older memories simply stop surfacing). Launch with the stated tiers ($12 Core / $22 Pro); revisit with beta data.

### Why This Choice

**Key factors:**
1. **Promise alignment** — the conversion trigger fires exactly when the user feels the value most: the moment Coriven "can't remember any more."
2. **Graceful degradation** — age-filtered retrieval means upgrading instantly restores older memories; nothing is destroyed, nothing breaks (Plan §19.6).
3. **Reversible & honest** — data is retained; a tier change changes what surfaces, not what exists.

## Consequences

### Positive
- Conversion mechanism is the core value moment, not an arbitrary gate.
- Upgrades feel like unlocking, not repurchasing; no data loss.

### Negative
- Pricing/cap values are unvalidated assumptions.
- Retrieval must consistently apply the tier age filter everywhere memory is read.

### Mitigation Strategies
- Treat tiers as a launch hypothesis; instrument conversion and revisit (§19.5).
- Centralize the age filter in the retrieval path (single source) so the Sentinel and inline assembly both honor it.

---

## References
- Master blueprint §16 (Monetization), §19.5 (pricing), §19.6 (memory window)
- Epic 7: `docs/implementation/_main/epic-7-productization.md`

---
**Last Updated**: 2026-06-29
