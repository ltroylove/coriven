---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "3"
feature: "3.2"
wave: "3.2.1"
agents: []
tags: [coriven, constraints, engine-gate, pre-action, trust, adr-007]
relateddocuments:
  - "docs/implementation/_main/epic-3-behavioral-constraint-layer.md"
  - "docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-007-behavioral-constraint-pre-action-gate.md"
  - "apps/web/src/lib/chat/engine.ts"
---

# Wave 3.2.1: Pre-Action Engine Gate

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 3.2.1 |
| Feature | 3.2 — Pre-Action Check (Engine Gate) |
| Epic | 3 — Behavioral-Constraint Layer |
| Status | Planning |
| Scope | An engine-level gate inserted into `apps/web/src/lib/chat/engine.ts` that evaluates every proposed tool call + args against the user's locked and unlocked constraints before the handler executes; blocks on violation and surfaces the matched rule and rationale to the user |
| Wave Goal | Materially exceed the ~42.5% constraint-adherence research baseline by enforcing constraints at the engine level — a check the model cannot choose to skip — before any tool handler executes |

**Wave Philosophy.** Reliable enforcement requires a gate the model cannot route around: this wave inserts that gate directly into the tool-dispatch loop in `engine.ts`, turning a soft suggestion into a hard stop with a surfaced reason.

---

## Wave Goals

1. Every tool call proposed by Claude passes through the constraint gate before its handler is invoked; no tool call executes without this check, regardless of which tool is called.
2. When the gate detects a violation against a locked constraint, the tool call is blocked, a structured violation reason is sent to the user via SSE, and the model receives a `tool_result` explaining the block — preventing silent failures.
3. A gate-enforcement test demonstrates that a tool call violating a stored locked constraint is blocked with ≥95% reliability across repeated executions, measured against a controlled test scenario (the MealPrepForge pattern), materially above the ~42.5% research baseline.

---

## User Stories

### Story 3.2.1.1 — Blocked tool call surfaced to the user

**As the owner, I want Coriven to block any tool call that violates one of my locked constraints and immediately tell me which rule was matched and why, so that I have visible confirmation the constraint system is working.**

**Acceptance Criteria:**
- When Claude proposes a tool call that would violate a locked constraint, the tool does not execute and the user receives a message identifying: which constraint was matched, the constraint's rule text, and the rationale.
- The assistant's next response acknowledges the block and does not retry the blocked action.
- A blocked action is logged with `{ event: "constraint_block", userId, toolName, matchedConstraintId, isLocked: true }` — no PII from rule/rationale in the log.
- Non-locked constraints that are matched surface a warning but allow the action to proceed (the model is informed and may reconsider).
- The gate adds no perceptible latency to the user (DB query for constraints is ≤50ms P95; cached locally within a single engine turn).

**Priority:** High
**Estimated Hours:** 14h
**Requirements Reference:** Business Requirements Feature 10; UC-30; AI-specific business rule 3; ADR-007

#### Task 3.2.1.1.1 — Constraint evaluator module

| Field | Value |
|---|---|
| Parent Story | 3.2.1.1 |
| Agent | backend |
| Estimation | 6h |
| Dependencies | Wave 3.1.1 complete (`loadConstraintsForUser` available; `behavioral_constraints` table live) |
| Deliverables | `apps/web/src/lib/chat/constraints/evaluator.ts` |

**Acceptance Criteria:**
- Exports `evaluateConstraint(toolName: string, toolInput: Record<string, unknown>, constraints: BehavioralConstraint[]): ConstraintEvalResult`.
- `ConstraintEvalResult` is a discriminated union: `{ matched: false }` or `{ matched: true; constraint: BehavioralConstraint; isLocked: boolean }`.
- Evaluation logic: for each constraint, check whether `toolName` or any string representation of `toolInput` contains terms that match the constraint's `rule` text (case-insensitive substring match at minimum; scope filtering applied first).
- Scope filtering: a constraint with `scope = 'all'` is always evaluated; a constraint with a specific scope is only evaluated when the scope value appears in `toolName` or `JSON.stringify(toolInput)` (case-insensitive).
- Locked constraints (`is_locked = true`) are evaluated first; the first match returns immediately.
- The evaluator is a pure function — no DB calls, no side effects. The caller loads constraints once per engine turn (not per tool call).
- Exported from `apps/web/src/lib/chat/constraints/index.ts`.
- All branches covered by unit tests; TypeScript strict mode; no `any`.

#### Task 3.2.1.1.2 — Gate integration in `engine.ts`

| Field | Value |
|---|---|
| Parent Story | 3.2.1.1 |
| Agent | backend |
| Estimation | 6h |
| Dependencies | Task 3.2.1.1.1 (evaluator must exist) |
| Deliverables | Modified `apps/web/src/lib/chat/engine.ts` |

**Acceptance Criteria:**
- At the start of `runChatEngine`, `loadConstraintsForUser(userId)` is called once and the result is held for the duration of the turn (not re-queried per tool call).
- Inside the tool-dispatch loop (the `for (const block of finalMsg.content)` block), before `executeToolHandler` is called, `evaluateConstraint(block.name, block.input, constraints)` is invoked.
- If `matched = true` and `isLocked = true`: the tool is NOT executed; instead `send({ type: 'tool_result', tool_use_id: block.id, content: <violation message>, is_error: true })` is emitted; a structured log entry is written; the model's `toolResults` array receives the blocking message so it can respond intelligently.
- If `matched = true` and `isLocked = false`: a warning `tool_result` is emitted noting the constraint match, but `executeToolHandler` proceeds; the model can reconsider.
- If `matched = false`: `executeToolHandler` proceeds unchanged.
- The violation message format: `"Action blocked by constraint: '<rule>'. Reason: '<rationale>'. This constraint is locked and cannot be overridden."`.
- If `loadConstraintsForUser` throws (DB error), the gate logs the error and proceeds with `executeToolHandler` (fail-open for the non-locked path; constraint errors must not break chat entirely). A structured error log is emitted.
- The gate does not change the tool-use loop's turn limit or SSE event types introduced in Wave 3.1.1.
- `npm run typecheck` passes; existing behavior for users with zero constraints is identical to before.

#### Task 3.2.1.1.3 — System prompt update for constraint awareness

| Field | Value |
|---|---|
| Parent Story | 3.2.1.1 |
| Agent | backend |
| Estimation | 2h |
| Dependencies | Task 3.2.1.1.2 (gate integrated) |
| Deliverables | Updated `buildSystemPrompt` in `engine.ts` |

**Acceptance Criteria:**
- `buildSystemPrompt` is updated to include a section explaining the constraint system to the model: constraints exist, are loaded per turn, blocking tool calls return an error result, and the model must not retry a blocked action.
- The prompt includes the instruction: "When adding a constraint on behalf of the user, always include the user's stated reason as the `rationale` — this field is required."
- The prompt does not expose the raw constraint data (that is the gate's job); it only explains the behavioral contract.
- System prompt is tested for length — it must not exceed a token budget that would crowd out user context (flag if >500 tokens added by this change).

---

### Story 3.2.1.2 — Gate is transparent to users without constraints

**As the owner with no constraints set yet, I want the engine to behave identically to before the gate was introduced, so that the constraint feature has zero cost for users who have not authored any rules.**

**Acceptance Criteria:**
- When `behavioral_constraints` returns zero rows for the user, the engine turn completes normally with no added latency beyond the DB round-trip.
- No SSE events are emitted about constraints when there are no constraints to evaluate.
- If the constraint loader fails (DB unavailable), the engine continues without blocking any tools and logs the failure — chat is never degraded by a constraint-system error.

**Priority:** High
**Estimated Hours:** 4h
**Requirements Reference:** Architecture §Reliability (graceful degradation); ADR-007 §Consequences

#### Task 3.2.1.2.1 — Fail-open behavior and zero-constraint fast path

| Field | Value |
|---|---|
| Parent Story | 3.2.1.2 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Task 3.2.1.1.2 |
| Deliverables | Fail-open handling in `engine.ts`; fast-path when `constraints.length === 0` |

**Acceptance Criteria:**
- When `loadConstraintsForUser` resolves with an empty array, the evaluator is not invoked (short-circuit for performance).
- When `loadConstraintsForUser` rejects, the error is caught, a structured log is emitted `{ event: "constraint_load_error" }`, and the tool-dispatch loop continues without the gate — tools execute normally.
- A unit test demonstrates: given a mock loader that throws, the engine still calls `executeToolHandler` for all tool blocks.
- A unit test demonstrates: given an empty constraint array, `evaluateConstraint` is never called (spy/mock-based test).

---

### Story 3.2.1.3 — Constraint-adherence measurement baseline

**As the owner and developer, I want a repeatable test scenario that measures the gate's constraint-adherence rate against the ~42.5% research baseline, so that I have objective evidence the gate is working before promoting this as a differentiator.**

**Acceptance Criteria:**
- A test script or automated test executes the MealPrepForge scenario: a locked constraint "never modify MealPrepForge code" is stored; a tool call that would modify code is proposed; the gate must block it.
- The test runs the scenario 20 times (or a statistically meaningful count) and reports the block rate.
- The block rate is expected to be ≥95% (vs. the ~42.5% prompt-only baseline).
- Test results are written to a structured log or a test output file that can be reviewed; they are not buried in a pass/fail CI signal alone.
- The test scenario is maintained as a documented acceptance test, not a one-off script.

**Priority:** High
**Estimated Hours:** 6h
**Requirements Reference:** Business Requirements Feature 10 acceptance criteria; Epic 3 success metrics

#### Task 3.2.1.3.1 — Gate-enforcement acceptance test

| Field | Value |
|---|---|
| Parent Story | 3.2.1.3 |
| Agent | backend |
| Estimation | 6h |
| Dependencies | Task 3.2.1.1.2 (gate integrated) |
| Deliverables | Test file in the appropriate test directory; documented test scenario |

**Acceptance Criteria:**
- A test named "gate blocks locked constraint violation" mocks `loadConstraintsForUser` to return a single locked constraint `{ rule: "never modify MealPrepForge code", rationale: "separate business", scope: "all", is_locked: true }`.
- The test invokes the engine with a message that leads the model to propose a tool call touching "MealPrepForge" content.
- The test asserts: `executeToolHandler` was NOT called for the violating tool block; `send` received a `tool_result` event with `is_error: true` and content containing the constraint rule.
- The test is deterministic (mock-based, not live LLM-dependent) and runs in CI.
- A separate integration note documents how to run the scenario against a live Anthropic API to measure actual adherence rates; this is flagged as a manual measurement step, not a CI gate.

---

## Task Dependencies

```
Wave 3.1.1 (complete)
  └── loadConstraintsForUser available
        │
        ├── Task 3.2.1.1.1 (evaluator)
        │         │
        │         └── Task 3.2.1.1.2 (gate in engine.ts)
        │                   │
        │                   ├── Task 3.2.1.1.3 (system prompt update)
        │                   ├── Task 3.2.1.2.1 (fail-open + fast path)
        │                   └── Task 3.2.1.3.1 (gate-enforcement test)
```

**Critical path:** Wave 3.1.1 → evaluator → gate integration → all downstream tasks.
**Parallelizable after gate integration:** system prompt update, fail-open handling, and acceptance test can be authored concurrently once Task 3.2.1.1.2 is complete.

---

## Definition of Done

- [ ] `evaluateConstraint` function exists, is a pure function, and is fully unit-tested.
- [ ] Gate is inserted in `engine.ts` before every `executeToolHandler` call.
- [ ] Locked-constraint violations produce a `tool_result` with `is_error: true` and DO NOT invoke `executeToolHandler`.
- [ ] Non-locked-constraint matches invoke `executeToolHandler` but emit a warning result.
- [ ] Zero-constraint fast-path: evaluator not called when constraint list is empty.
- [ ] Fail-open: loader error causes gate to skip (log + continue), not to block all tools.
- [ ] Gate-enforcement test passes: violating tool call blocked deterministically in the mock-based test.
- [ ] System prompt updated with constraint behavioral contract.
- [ ] `npm run typecheck` passes; no new `any` types.
- [ ] Structured logs emitted for: constraint block (locked), constraint warning (unlocked), constraint load error.
- [ ] No secrets hardcoded; `SUPABASE_SERVICE_ROLE_KEY` accessed only through existing factory.

---

## Infrastructure Specifications

### Database

No new tables. Reads from `behavioral_constraints` (Wave 3.1.1). The gate-level query pattern is:

```sql
SELECT id, rule, rationale, scope, is_locked
FROM behavioral_constraints
WHERE user_id = $1
ORDER BY is_locked DESC, created_at ASC;
```

Locked constraints sort first so they are evaluated before unlocked ones. The index on `(user_id, is_locked)` supports this query efficiently.

### API / Engine Integration

The pre-action gate is NOT an HTTP endpoint. It is an in-process function call within `runChatEngine` in `apps/web/src/lib/chat/engine.ts`.

**Integration contract:**

```
for each tool_use block proposed by Claude:
  1. evaluateConstraint(toolName, toolInput, constraints)
  2. if matched AND isLocked:
       - emit tool_result { is_error: true, content: violation message }
       - log { event: "constraint_block", userId, toolName, constraintId }
       - skip executeToolHandler
  3. elif matched AND NOT isLocked:
       - emit tool_result { is_error: false, content: warning message }
       - log { event: "constraint_warning", userId, toolName, constraintId }
       - call executeToolHandler (proceeds)
  4. else:
       - call executeToolHandler (unchanged behavior)
```

The gate runs synchronously within the existing tool-dispatch `for` loop. No new SSE event types are required — the violation is surfaced as a `tool_result` event (already supported by the client).

**Violation message format (surfaced to model and logged to client):**
`"Action blocked by constraint: '<rule>'. Reason: '<rationale>'. This constraint is locked and cannot be overridden."`

**Warning message format (unlocked match):**
`"Note: this action may relate to a standing constraint: '<rule>'. Reason: '<rationale>'. Proceeding as the constraint is not locked."`

### UI

No new UI in this wave. The blocked action is surfaced through the existing `tool_result` SSE event — the chat message component already renders tool results with `is_error` styling. The constraint registry UI is built in Wave 3.3.1.

### Testing

- **Unit tests (evaluator):** matched locked, matched unlocked, no match, scope filter active, scope filter excluded, empty constraint list.
- **Unit tests (gate in engine):** blocked call does not invoke handler; warning call invokes handler; zero constraints skips evaluator; loader error skips gate (fail-open).
- **Gate-enforcement acceptance test:** mock-based scenario — locked MealPrepForge constraint + tool call touching that content → `executeToolHandler` not called, `is_error: true` result emitted.
- **Regression:** existing task tool tests (create, list, update, delete, reminders) continue to pass with zero constraints present.
- **Coverage target:** 85% line coverage on `evaluator.ts`; 75% on the gate additions in `engine.ts`.

### Monitoring

- `{ event: "constraint_block", userId, toolName, matchedConstraintId, isLocked: true }` — every hard block.
- `{ event: "constraint_warning", userId, toolName, matchedConstraintId, isLocked: false }` — every soft warning.
- `{ event: "constraint_load_error", userId, error: string }` — loader failure.
- **Adherence metric:** track `constraint_block` events; compute block rate per user per day. Compare against the 42.5% baseline as the denominator is "actions that should have been blocked." Tie into the audit trail when Epic 5 (audit log) lands.
- **Performance:** log the constraint-load duration per turn; alert if P95 exceeds 50ms.

---

## Handoff Requirements

This wave hands off to:
- **Wave 3.3.1** (Constraint Registry UI): requires the gate to be operational and the `behavioral_constraints` table stable so UI actions (add, view, lock) have visible enforcement to demonstrate.
- **Wave 3.4.1** (optional post-generation detection): requires the gate to be in place as the primary enforcement layer; post-generation detection is a secondary signal on top of the gate.
- **Epic 4** (Comms): constraints can gate `send_email` / `create_event` tool calls — the gate is already in place; constraints simply need to reference those tool names in their `scope` or `rule`.

Deliverables required before Wave 3.3.1 begins:
- Gate integrated and passing all tests.
- Gate-enforcement acceptance test documented and passing.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Evaluator false positives block valid actions | Medium — user experiences unexpected blocks | Medium | Scope-aware rules narrow the match domain; unlocked constraints warn rather than block; clear surfaced reason lets user understand and adjust |
| DB latency on constraint load adds noticeable delay | Medium — degrades chat UX | Low | Single query per turn (not per tool); index on `(user_id, is_locked)`; P95 budget 50ms; fail-open if slow |
| Model retries blocked tool call, causing a loop | Medium — wastes tokens; confuses user | Medium | System prompt explicitly instructs model not to retry blocked actions; `tool_result` content makes the reason unambiguous |
| Rule/string matching too naive (substring) produces false positives | Medium — erodes trust | Medium | Scope filtering narrows applicability; unlocked path warns without blocking; Wave 3.4.1 (optional) adds a secondary semantic check |
| Gate implementation drifts from ADR-007 intent | Low | Low | Code comment in `engine.ts` references ADR-007; gate is tested with the MealPrepForge scenario |

---

## Related Documentation

- `docs/implementation/_main/epic-3-behavioral-constraint-layer.md` — Feature 3.2 definition
- `docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md` — prerequisite wave
- `docs/architecture/_main/04-Architecture.md` — §Application Security (pre-action constraint gate); §AI Architecture
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 10; UC-30; AI-specific business rule 3
- `docs/architecture/decisions/ADR-007-behavioral-constraint-pre-action-gate.md` — decision rationale
- `apps/web/src/lib/chat/engine.ts` — integration target
