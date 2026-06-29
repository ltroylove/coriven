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
epic: "3"
priority: "High"
branch: "epic/3-behavioral-constraints"
architecture: ["ADR-007"]
tags: [coriven, constraints, trust, pre-action-check]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 3: Behavioral-Constraint Layer

## Epic Overview
- **Epic ID:** Epic-3
- **Status:** Planning
- **Duration:** Small–Medium (lightweight v1)
- **Team:** Solo (owner/developer)
- **Priority:** High (the trust differentiator; conditional per Plan §19.1)

## Problem Statement

The single most important research finding in the blueprint: "never do X" rules have **~42.5% compliance even when the rule is retrieved** — the AI reads the rule and still violates it more than half the time (utility-induced drift). This is the MealPrepForge problem stated scientifically ("don't modify my website code"). Coriven's premise is trust that compounds; a system that reliably respects user-authored constraints would be a genuine first. This Epic builds the lightweight v1 (option (b) from Plan §19.1): a user-authored registry plus an engine-level pre-action check. See Business Requirements Feature 10 and Architecture (constraint layer).

## Goals and Success Criteria

Coriven respects user-authored, locked constraints far more reliably than the research baseline, enforced by a check that runs before any tool call — not by hoping the model "remembers."

**Success Metrics:**
- Constraint adherence in test scenarios materially above the ~42.5% baseline (e.g., "never modify MealPrepForge code" is blocked reliably).
- Constraints are user-authored, user-visible, and lockable (`is_locked`).
- Pre-action check blocks violating tool calls and surfaces the reason; no silent overrides.

## Scope

### In Scope
- `behavioral_constraints` table (`rule`, `rationale`, `scope`, `is_locked`).
- Constraint registry UI (author, view, lock; required rationale).
- Engine-level pre-action check before tool execution (NOT a normal tool — a gate).
- Tools `add_constraint` / `list_constraints`.
- (Optional) lightweight post-generation violation detection.

### Out of Scope
- Fully validated/guaranteed adherence (this is a research bet shipped as best-effort v1).
- Reworking `tool_permissions` (complement, not replacement).

## Features & Waves

> Conditional Epic (Plan §19.1, option b). Waves finalized in `/design-waves`.

### Feature 3.1: Constraint Store & Tools
- **Scope:** `behavioral_constraints` table with RLS; `add_constraint` / `list_constraints` tools.
- **Key Technical Approach:** SQL-first migration; constraints stored/retrieved **separately** from factual memories (a rule is not a fact); richly-encoded `rationale` (the *why* is harder to rationalize around). See blueprint §6.7, §14.6 and Architecture data model.
- **Requirements:** Business Requirements Feature 10; AI-specific business rule (pre-action check).
- **Dependencies:** Epic 2 (memory layer exists).
- **Wave Planning:** One wave.

### Feature 3.2: Pre-Action Check (Engine Gate)
- **Scope:** Before any tool call, an explicit check — "does this action violate a stored constraint?" — separate from semantic retrieval. Block + surface on match.
- **Key Technical Approach:** A gate in `lib/chat/engine.ts` invoked before handler execution; evaluates the proposed tool call + args against locked constraints (scope-aware). See Architecture §"Application Security" (pre-action constraint gate).
- **Requirements:** Business Requirements UC-30; Feature 10 acceptance.
- **Dependencies:** Feature 3.1.
- **Wave Planning:** Gate wave + evaluation-logic wave.

### Feature 3.3: Constraint Registry UI
- **Scope:** A surface to author, view, and lock constraints, with a required rationale field and a lock indicator.
- **Key Technical Approach:** Page reusing form/list patterns; explicit "Add constraint" affordance (UX Foundations Pass 3). See UX §"Constraints."
- **Requirements:** Business Requirements UC-15; transparency principle.
- **Dependencies:** Feature 3.1.
- **Wave Planning:** One wave.

### Feature 3.4: Post-Generation Violation Detection (Optional)
- **Scope:** A lightweight secondary check — "did I just violate a known constraint?" — after generation.
- **Key Technical Approach:** Cheap Haiku-class check over the response/action against active constraints; flag for review. See blueprint §6.7.
- **Requirements:** Business Requirements Feature 10 (optional component).
- **Dependencies:** Features 3.1, 3.2.
- **Wave Planning:** Optional wave (may defer).

## Dependencies

**Prerequisites:** Epic 2 (memory layer must exist).
**Enables:** Higher-trust external actions in Epic 4 (Comms) — constraints can gate sends/writes.
**External Dependencies:** Anthropic Haiku (optional post-gen check).

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Adherence stays unreliable | High | Med | Pre-action *gate* (not model memory); measure before marketing it |
| False positives block valid actions | Med | Med | Scope-aware rules; clear surfaced reason + override path for non-locked |
| Over-promising a research bet | Med | Med | Ship as best-effort v1; honest framing in UX/marketing |

## Technical Considerations

The check is an **engine-level gate**, not a tool the model can choose to skip. Constraints are a complement to `tool_permissions` (which enable/disable wholesale but can't encode nuanced rules). Richly-encoded rationale and user-authored locking are the levers research suggests matter.

## Compliance and Security

Per-user RLS; constraints are user-owned and locked. The gate is a safety control; violations are logged (ties into the audit trail in Epic 4).

## Related Documentation
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Feature 10, UC-15/UC-30)
- Architecture: docs/architecture/_main/04-Architecture.md (Application Security; data model §14.6)
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§6.7)

## Architecture Decision Records (ADRs)
- ADR-007: Behavioral constraints as an engine-level pre-action gate (lightweight v1)

---
**Template Version:** 2.0 (3-layer, embedded features)
