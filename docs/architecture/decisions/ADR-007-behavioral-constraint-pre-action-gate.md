---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-007"
deciders: "Roy Love"
product:
  - "coriven"
tags: [constraints, trust, safety]
relateddocuments:
  - "docs/implementation/_main/epic-3-behavioral-constraint-layer.md"
---

# ADR-007: Behavioral Constraints as an Engine-Level Pre-Action Gate (Lightweight v1)

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Epic 3 (Behavioral-Constraint Layer); blueprint §6.7, §19.1

---

## Context

Research in the master blueprint found that "never do X" rules achieve only **~42.5% compliance even when the rule is successfully retrieved**. The model reads the rule and still violates it more than half the time, due to utility-induced drift (constraints treated as soft costs to route around). This is the MealPrepForge problem ("don't modify my website code"). Coriven's premise is trust that compounds, so reliable constraint adherence is strategically important — but the approaches research suggests are theoretical and unvalidated. We must decide whether and how to build a constraint layer now.

## Considered Options

- **Option 1: Headline feature immediately after Memory** — full constraint system as a flagship.
- **Option 2: Lightweight v1 now (user-authored registry + engine-level pre-action check), sophistication later.**
- **Option 3: Defer entirely** — rely on `tool_permissions` and prompting.
- **Option 4: Do nothing** — accept the 42.5% reality.

## Decision

**We will build a lightweight v1: a user-authored, lockable constraint registry plus an engine-level pre-action check that runs before any tool call** (Plan §19.1 option b).

### Why This Choice

**Key factors:**
1. **Enforcement, not memory.** The check is an engine gate the model cannot choose to skip — this directly attacks utility-induced drift, which better retrieval alone does not fix.
2. **Low cost, high signal.** A registry + pre-action check is cheap to build and directly addresses the real trust problem.
3. **Constraints ≠ facts.** Storing/retrieving rules separately, with richly-encoded rationale (the *why*), is what research suggests actually helps.

```text
proposed tool call + args → pre-action check vs locked constraints (scope-aware)
   → violation? block + surface reason : proceed to handler
```

## Consequences

### Positive
- Reliable enforcement independent of model "remembering."
- Directly addresses the MealPrepForge trust case; potential headline differentiator.
- Complements `tool_permissions` (wholesale enable/disable) with nuanced rules.

### Negative
- Possible false positives blocking valid actions.
- Adherence remains a best-effort research bet, not a guarantee.

### Mitigation Strategies
- Scope-aware rules; clear surfaced reasons; override path for non-locked constraints.
- Honest framing in UX/marketing; measure adherence against the 42.5% baseline before promoting it.

---

## References
- Master blueprint §6.7 (behavioral-constraint layer), §19.1 (open decision)
- Epic 3: `docs/implementation/_main/epic-3-behavioral-constraint-layer.md`
- Architecture §"Application Security" (pre-action constraint gate)

---
**Last Updated**: 2026-06-29
