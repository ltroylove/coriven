---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
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
feature: "3.4"
wave: "3.4.1"
agents: []
tags: [coriven, constraints, post-generation, haiku, violation-detection, optional]
relateddocuments:
  - "docs/implementation/_main/epic-3-behavioral-constraint-layer.md"
  - "docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md"
  - "docs/implementation/iterations/wave-3.2.1-pre-action-engine-gate.md"
  - "docs/implementation/iterations/wave-3.3.1-constraint-registry-ui.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Wave 3.4.1: Post-Generation Violation Detection (Optional)

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 3.4.1 |
| Feature | 3.4 — Post-Generation Violation Detection |
| Epic | 3 — Behavioral-Constraint Layer |
| Status | Planning — OPTIONAL / DEFERRABLE |
| Scope | A lightweight secondary check run after Claude's response is generated — using a Haiku-class model to evaluate whether the response text or completed actions may have violated a stored constraint — with a flag surfaced to the user for review rather than a hard block |
| Wave Goal | Add a second-layer signal that catches semantic violations the string-based pre-action gate may miss, without introducing latency into the primary response path — positioned as a quality layer on top of the gate, not a replacement for it |

> **Scope note:** This wave is explicitly optional and deferrable per Epic 3 §Feature 3.4 and Plan §19.1. The pre-action gate (Wave 3.2.1) is the primary enforcement mechanism. This wave ships only if the gate is proven and there is evidence of residual violation categories worth addressing. Do not build this wave before Waves 3.1.1–3.3.1 are complete and the gate's adherence rate is measured.

**Wave Philosophy.** The gate stops what it can identify structurally; post-generation detection catches what leaked past — a secondary net, not a primary wall. Haiku-class speed keeps cost negligible; flag-for-review (not block) keeps the secondary check honest about its confidence level.

---

## Wave Goals

1. After every chat turn that involves tool use or a substantive assistant response, a lightweight Haiku-class check evaluates the response and any completed actions against the user's active constraints — asynchronously, so the user receives their response without waiting.
2. When the secondary check detects a probable violation, a flag is recorded and surfaced to the user in the next chat turn or in a dedicated review surface — clearly labeled as a secondary signal, not a hard finding.
3. The post-generation detection cost is negligible (Haiku-class per turn; input tokens bounded to constraint list + response summary) and the check never blocks the primary response path under any failure condition.

---

## User Stories

### Story 3.4.1.1 — Post-generation check runs asynchronously after each turn

**As the owner, I want Coriven to silently check after each response whether it may have violated one of my constraints, so that I have a second layer of assurance beyond the pre-action gate — without any added wait time in the chat.**

**Acceptance Criteria:**
- After `runChatEngine` completes and the SSE stream is closed, a post-generation check is triggered asynchronously (non-blocking; the user has already received their response).
- The check uses a Haiku-class model (configured via `CHAT_MODEL_FAST` or equivalent constant, consistent with how Haiku is used in the Sentinel).
- The check input is bounded: the active constraint list (rules and rationales only) + a summary/excerpt of the assistant's response (not the full conversation history).
- If no active constraints exist for the user, the check is skipped entirely (fast path; no Haiku call made).
- A Haiku failure (API error, timeout) is caught, logged, and silently discarded — the post-generation check must never surface an error to the user or affect the primary chat response.
- The check completes within a budget of ~2s for the Haiku round-trip; this is acceptable given it is async.

**Priority:** Medium (optional wave)
**Estimated Hours:** 12h
**Requirements Reference:** Business Requirements Feature 10 (optional component); Epic 3 §Feature 3.4; blueprint §6.7

#### Task 3.4.1.1.1 — Post-generation violation checker module

| Field | Value |
|---|---|
| Parent Story | 3.4.1.1 |
| Agent | backend |
| Estimation | 6h |
| Dependencies | Wave 3.1.1 (`loadConstraintsForUser` available); Wave 3.2.1 (gate in place as primary layer) |
| Deliverables | `apps/web/src/lib/chat/constraints/post-gen-checker.ts` |

**Acceptance Criteria:**
- Exports `checkPostGeneration({ userId, responseText, toolCallSummary }: PostGenInput): Promise<PostGenResult>`.
- `PostGenResult` is: `{ violated: false }` or `{ violated: true; confidence: 'low' | 'medium' | 'high'; matchedConstraintId: string; reason: string }`.
- Internally calls `loadConstraintsForUser(userId)` to fetch active constraints; if empty, returns `{ violated: false }` immediately.
- Constructs a bounded prompt for Haiku: constraints listed as numbered rules + rationales; response excerpt (first 500 characters of `responseText`); tool call summary (tool names called, not full args); asks the model to identify if any constraint was violated and at what confidence.
- Parses the Haiku response; maps to `PostGenResult`; defaults to `{ violated: false }` on any parse failure.
- All Haiku API errors caught and returned as `{ violated: false }` (fail-safe; secondary check must not propagate errors).
- Structured log emitted: `{ event: "post_gen_check", userId, violated, confidence? }`.
- No PII from rule/rationale in the structured log (IDs only).
- TypeScript strict mode; no `any`; exported from `apps/web/src/lib/chat/constraints/index.ts`.

#### Task 3.4.1.1.2 — Async trigger in `engine.ts`

| Field | Value |
|---|---|
| Parent Story | 3.4.1.1 |
| Agent | backend |
| Estimation | 3h |
| Dependencies | Task 3.4.1.1.1 (checker module exists) |
| Deliverables | Modified `apps/web/src/lib/chat/engine.ts` — async fire-and-forget trigger at the end of `runChatEngine` |

**Acceptance Criteria:**
- After `saveMessage` and before the engine function returns, `checkPostGeneration` is called with `void` (fire-and-forget): `void checkPostGeneration({ userId, responseText: assistantText, toolCallSummary: ... })`.
- The trigger does NOT `await` the checker — the engine returns immediately and the check runs in the background.
- If the trigger itself throws synchronously (before the async chain starts), it is caught and logged; the engine still returns normally.
- `assistantText` is the full response text; `toolCallSummary` is an array of tool names that were called in the turn (e.g., `["create_task", "add_reminder"]`).
- No new SSE events are emitted from this trigger — the post-gen result is recorded and surfaced separately (Story 3.4.1.2).

---

### Story 3.4.1.2 — Violation flags stored and surfaced for review

**As the owner, I want any post-generation violation flags to be stored and surfaced to me clearly — with a "secondary signal" label so I understand this is a probabilistic check, not a guaranteed finding — so I can review and decide whether to tighten a constraint or dismiss the flag.**

**Acceptance Criteria:**
- A `constraint_violation_flags` table stores flags: `id`, `user_id`, `constraint_id`, `conversation_id`, `confidence` (`low`/`medium`/`high`), `reason` (the Haiku explanation), `status` (`pending`/`reviewed`/`dismissed`), `created_at`.
- When `checkPostGeneration` returns `violated: true`, a row is inserted into `constraint_violation_flags`.
- Flags are surfaced to the user — either as a notice in the next chat response ("A secondary check flagged a possible constraint concern — review in Constraints") or as an indicator on the `/constraints` page (e.g., a badge showing pending flags).
- Flags are clearly labeled as secondary / probabilistic, not as definitive violations.
- The user can mark a flag as reviewed or dismissed; dismissed flags do not re-surface.
- Only the authenticated user's flags are visible (RLS on `constraint_violation_flags`).

**Priority:** Medium (optional wave)
**Estimated Hours:** 10h
**Requirements Reference:** Business Requirements Feature 10 (optional); transparency principle

#### Task 3.4.1.2.1 — `constraint_violation_flags` migration

| Field | Value |
|---|---|
| Parent Story | 3.4.1.2 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Wave 3.1.1 (behavioral_constraints table exists) |
| Deliverables | SQL migration in `supabase/migrations/`; regenerated Supabase types |

**Acceptance Criteria:**
- Migration creates `constraint_violation_flags`: `id uuid PK`, `user_id uuid NOT NULL FK auth.users(id) ON DELETE CASCADE`, `constraint_id uuid NOT NULL FK behavioral_constraints(id) ON DELETE CASCADE`, `conversation_id uuid` (nullable — for context), `confidence text CHECK (confidence IN ('low', 'medium', 'high'))`, `reason text NOT NULL`, `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed'))`, `created_at timestamptz NOT NULL DEFAULT now()`.
- RLS enabled; policy `USING (user_id = auth.uid())` for SELECT, UPDATE; INSERT via service-role only (system writes).
- Index on `(user_id, status)` for pending-flags queries.
- Migration applies without error; types regenerated.
- No secrets or hardcoded values in the migration file.

#### Task 3.4.1.2.2 — Flag insert in `post-gen-checker.ts` and UI indicator

| Field | Value |
|---|---|
| Parent Story | 3.4.1.2 |
| Agent | backend + frontend |
| Estimation | 5h |
| Dependencies | Task 3.4.1.2.1 (table live); Task 3.4.1.1.1 (checker returns a result) |
| Deliverables | Updated `post-gen-checker.ts`; updated `apps/web/src/app/constraints/page.tsx` to show pending-flags count |

**Acceptance Criteria:**
- When `checkPostGeneration` returns `violated: true`, the checker inserts a row into `constraint_violation_flags` using the service-role client with `user_id`, `constraint_id` (from the matched constraint), `confidence`, and `reason`.
- If the insert fails, the error is logged and the checker returns normally — violation flags are best-effort, never blocking.
- The `/constraints` page displays a count of pending flags (e.g., a badge or notice); zero pending flags shows nothing.
- A "Pending violation flags" section on the page lists flags with: the matched constraint rule, confidence level, reason, and Dismiss / Mark Reviewed actions backed by Server Actions (`dismissViolationFlagAction`, `reviewViolationFlagAction`).
- Flag actions require authentication; `user_id` always from session.
- "Secondary signal" label is visible adjacent to every flag item.

---

### Story 3.4.1.3 — Cost and quality controls for the Haiku check

**As the developer, I want the post-generation Haiku check to operate within defined cost and quality boundaries, so that the optional feature does not unexpectedly inflate Anthropic API costs or produce noisy flags that erode trust.**

**Acceptance Criteria:**
- The Haiku prompt is bounded: constraint list capped at 10 constraints (most recently created); response excerpt capped at 500 characters; tool call summary is a string list of tool names only (no args).
- A feature flag (`CONSTRAINT_POST_GEN_ENABLED` env var, default `false`) controls whether the check runs — it is opt-in, not on by default.
- When the flag is `false`, `checkPostGeneration` returns `{ violated: false }` immediately without any API call.
- Per-turn Haiku cost is logged as a structured metric `{ event: "post_gen_check_cost", userId, inputTokens, outputTokens }` so spend can be tracked.
- If the `confidence` returned by Haiku is `'low'`, the flag is stored but the surfacing in the UI is visually de-emphasized (e.g., shown in a collapsed "low-confidence flags" section).

**Priority:** Medium (optional wave)
**Estimated Hours:** 4h
**Requirements Reference:** Architecture §AI-Specific Monitoring (token/cost tracking); Architecture §Haiku vs Sonnet split

#### Task 3.4.1.3.1 — Feature flag, prompt bounding, cost logging

| Field | Value |
|---|---|
| Parent Story | 3.4.1.3 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Task 3.4.1.1.1 (checker module) |
| Deliverables | Updated `post-gen-checker.ts`; `CONSTRAINT_POST_GEN_ENABLED` added to `.env.example` |

**Acceptance Criteria:**
- `process.env.CONSTRAINT_POST_GEN_ENABLED` checked at the start of `checkPostGeneration`; if not `'true'`, return `{ violated: false }` immediately.
- Constraint list sliced to the 10 most recent before prompt construction.
- Response excerpt truncated to 500 characters.
- Haiku API call logs `inputTokens` and `outputTokens` from the response's `usage` field.
- `.env.example` documents `CONSTRAINT_POST_GEN_ENABLED=false` with a comment explaining the feature.
- `npm run typecheck` passes; no new `any`.

---

## Task Dependencies

```
Wave 3.1.1 (constraint store + loadConstraintsForUser)
Wave 3.2.1 (gate — primary enforcement must exist before secondary)
Wave 3.3.1 (UI — flags surfaced on constraints page)
      │
      ├── Task 3.4.1.1.1 (post-gen checker module)
      │         │
      │         ├── Task 3.4.1.1.2 (async trigger in engine.ts)
      │         └── Task 3.4.1.3.1 (feature flag + cost controls)
      │
      └── Task 3.4.1.2.1 (violation_flags migration)
                │
                └── Task 3.4.1.2.2 (flag insert + UI indicator)
```

**Critical path:** Waves 3.1.1–3.3.1 → checker module → async trigger AND migration → flag insert + UI.
**Parallelizable:** feature flag/cost controls can be layered onto the checker concurrently with the migration.

---

## Definition of Done

- [ ] `CONSTRAINT_POST_GEN_ENABLED` env var controls the check; default `false`; `false` → zero Haiku calls.
- [ ] `checkPostGeneration` runs asynchronously after `runChatEngine`; never blocks or errors the primary response.
- [ ] Haiku API errors silently discarded; fail-safe always returns `{ violated: false }`.
- [ ] `constraint_violation_flags` table exists with RLS; migration applied; types regenerated.
- [ ] When `violated: true` is returned, a row is inserted into `constraint_violation_flags`.
- [ ] `/constraints` page shows pending flag count and a list with Dismiss / Mark Reviewed actions.
- [ ] Flags labeled "secondary signal" in the UI.
- [ ] Cost logging emitted per Haiku call: `inputTokens`, `outputTokens`.
- [ ] Prompt bounded: max 10 constraints, 500-char response excerpt, tool names only.
- [ ] Gate-enforcement acceptance test from Wave 3.2.1 still passes (no regression).
- [ ] `npm run typecheck` passes; no new `any`.

---

## Infrastructure Specifications

### Database

**New table:** `constraint_violation_flags`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id) ON DELETE CASCADE` | RLS anchor |
| `constraint_id` | `uuid` | NOT NULL, FK → `behavioral_constraints(id) ON DELETE CASCADE` | If constraint is removed, flags cascade |
| `conversation_id` | `uuid` | nullable | Context linkage |
| `confidence` | `text` | `CHECK (confidence IN ('low', 'medium', 'high'))` | Haiku's stated confidence |
| `reason` | `text` | NOT NULL | Haiku's explanation |
| `status` | `text` | NOT NULL DEFAULT `'pending'`, `CHECK (status IN ('pending', 'reviewed', 'dismissed'))` | Review lifecycle |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` | |

**RLS:**
- SELECT, UPDATE: `USING (user_id = auth.uid())`
- INSERT: service-role only (system writes via `post-gen-checker.ts`)

**Index:** `(user_id, status)` — pending-flags query.

**Migration name:** `<timestamp>_add_constraint_violation_flags.sql`

### API / Engine Integration

**Post-generation check is NOT an HTTP endpoint.** It is an internal async call at the end of `runChatEngine`. The integration contract:

```
runChatEngine completes (saveMessage called, SSE closed)
  └── void checkPostGeneration({ userId, responseText, toolCallSummary })
        ├── feature flag off → return immediately
        ├── no constraints → return immediately
        ├── call Haiku with bounded prompt
        │     ├── violated: false → return
        │     └── violated: true → insert constraint_violation_flags row
        └── any error → log + return (never propagate)
```

**Haiku model:** `CHAT_MODEL_FAST` constant (consistent with Sentinel's Haiku usage — currently `claude-haiku-4-5-20251001` per Architecture Appendix C).

**Prompt structure (bounded):**

```
You are a constraint-compliance checker. The user has the following behavioral constraints:
1. [rule] — Reason: [rationale]
... (max 10)

The assistant just completed a turn. Response excerpt: "[first 500 chars]"
Tools called: [tool names list]

Did the assistant's response or actions violate any listed constraint?
Reply with JSON: { "violated": boolean, "confidence": "low"|"medium"|"high", "constraint_number": integer|null, "reason": string }
```

### UI

**Constraint violation flags section on `/constraints` page:**
- Pending flag count badge on page heading or navigation link.
- "Violation Flags" section (collapsed by default if all flags are low-confidence).
- Per flag: constraint rule text, confidence badge (`low` / `medium` / `high`), Haiku's reason, "Secondary signal" label, Dismiss button, Mark Reviewed button.
- Dismissed / reviewed flags are hidden by default; a "Show all" toggle reveals them.

**Server Actions in `apps/web/src/app/actions/constraints.ts` (extensions):**
- `dismissViolationFlagAction(id: string)` — sets `status = 'dismissed'`
- `reviewViolationFlagAction(id: string)` — sets `status = 'reviewed'`

### Testing

- **Unit tests (checker):** feature flag off → no Haiku call; empty constraints → `{ violated: false }`; Haiku returns violated → correct `PostGenResult`; Haiku throws → `{ violated: false }`.
- **Integration test:** checker returns `violated: true` → row inserted in `constraint_violation_flags`; checker error → no row inserted.
- **Engine test:** async trigger present; engine returns before trigger completes; trigger error does not propagate.
- **UI test:** pending flags render; dismiss action sets status; reviewed action sets status.
- **Regression:** Wave 3.2.1 gate test still passes; existing engine behavior unchanged.
- **Coverage target:** 80% on `post-gen-checker.ts`.

### Monitoring

- `{ event: "post_gen_check", userId, violated, confidence }` — per check run.
- `{ event: "post_gen_check_cost", userId, inputTokens, outputTokens }` — per Haiku call.
- `{ event: "post_gen_check_error", userId, error }` — per Haiku failure (silent but logged).
- `{ event: "violation_flag_dismissed", userId, flagId }` and `{ event: "violation_flag_reviewed", userId, flagId }` — user interactions.
- Track false-positive rate: flags dismissed without a corresponding gate block = likely false positive; useful for tuning the prompt.

---

## Handoff Requirements

This wave is self-contained and optional. It requires Waves 3.1.1, 3.2.1, and 3.3.1 to be complete. No downstream epic explicitly depends on this wave — it is an enhancement layer.

If deferred indefinitely, the constraint system remains fully functional via the gate alone. The decision to ship or defer this wave should be driven by:
1. Measuring the gate's adherence rate post-Wave 3.2.1 (is there a residual gap worth closing?).
2. Whether Haiku API cost at real usage volume is acceptable.
3. Whether low-confidence flag noise erodes user trust more than it helps.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Haiku produces noisy low-confidence flags and erodes trust | Medium — user sees false positives constantly | Medium | Feature flag off by default; low-confidence flags de-emphasized in UI; dismiss action easy to use; measure false-positive rate before promoting |
| Async trigger adds unexpected behavior to engine under test | Low | Low | Fire-and-forget `void` call; engine tests mock the checker; no SSE events from the trigger |
| Anthropic Haiku cost at scale exceeds budget | Medium | Low | Prompt bounded (10 constraints, 500 chars); feature flag allows instant kill; per-turn cost logged |
| `constraint_violation_flags` table cascade delete removes evidence | Low | Low | Acceptable — if user deletes a constraint, associated flags are no longer meaningful |
| This wave never ships because gate adherence is already sufficient | Low risk — this is a feature, not a bug | Medium | By design: this wave is optional; do not ship unless the gate data shows residual gaps |

---

## Related Documentation

- `docs/implementation/_main/epic-3-behavioral-constraint-layer.md` — Feature 3.4 definition (optional)
- `docs/implementation/iterations/wave-3.1.1-constraint-store-and-tools.md` — data foundation
- `docs/implementation/iterations/wave-3.2.1-pre-action-engine-gate.md` — primary enforcement layer
- `docs/implementation/iterations/wave-3.3.1-constraint-registry-ui.md` — UI surface where flags appear
- `docs/architecture/_main/04-Architecture.md` — §AI-Specific Monitoring; §Haiku routing; §Reliability (fail gracefully)
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 10 optional component; blueprint §6.7
