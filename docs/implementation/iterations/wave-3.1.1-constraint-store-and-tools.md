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
epic: "3"
feature: "3.1"
wave: "3.1.1"
agents: []
tags: [coriven, constraints, database, tools, rls, supabase]
relateddocuments:
  - "docs/implementation/_main/epic-3-behavioral-constraint-layer.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/decisions/ADR-007-behavioral-constraint-pre-action-gate.md"
  - "apps/web/src/lib/chat/tools/registry.ts"
  - "apps/web/src/lib/chat/tools/handlers.ts"
---

# Wave 3.1.1: Constraint Store & Tools

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 3.1.1 |
| Feature | 3.1 — Constraint Store & Tools |
| Epic | 3 — Behavioral-Constraint Layer |
| Status | Planning |
| Scope | `behavioral_constraints` table with RLS; `add_constraint` and `list_constraints` tools registered in the chat engine |
| Wave Goal | Provide a durable, user-owned, RLS-isolated store for behavioral constraints and expose two tool-use primitives that let Claude help users author constraints via conversation — establishing the data foundation that the engine gate (Wave 3.2.1) and the UI (Wave 3.3.1) build on |

**Wave Philosophy.** A rule the model cannot locate is a rule the model cannot honor — this wave ensures constraints are stored durably and separately from factual memories, with richly-encoded rationale that makes each rule harder to rationalize around.

---

## Wave Goals

1. The `behavioral_constraints` table is live in Supabase with RLS such that every SELECT, INSERT, UPDATE, and DELETE is limited to the authenticated user's own rows — zero cross-user data exposure.
2. The `add_constraint` and `list_constraints` tools are registered in `TOOL_REGISTRY`, handled in `HANDLERS`, and gated by `tool_permissions` identically to existing tools — no special-cased access paths.
3. Constraints are stored with `rule`, `rationale`, `scope`, and `is_locked` columns; the `rationale` field is required and non-nullable, enforcing the richly-encoded WHY pattern identified in the research baseline as meaningful for reducing utility-induced drift.

---

## User Stories

### Story 3.1.1.1 — Add a constraint through conversation

**As the owner, I want to teach Coriven a behavioral constraint (e.g., "never modify MealPrepForge code") through natural conversation with a required rationale, so that the constraint is durably stored and available for the engine gate to enforce.**

**Acceptance Criteria:**
- When I say "never modify MealPrepForge code because it is a separate business" in chat, the assistant calls `add_constraint` and confirms the constraint was saved with my rationale.
- The `rationale` field is populated; the tool refuses (returns an error result) when the rationale is absent or empty.
- The `is_locked` field defaults to `false`; I can specify `is_locked: true` to prevent future override.
- The `scope` field accepts a free-text string (e.g., "MealPrepForge", "all") and defaults to `"all"` when omitted.
- The stored row is only visible to my user account — another user's session cannot read or write my constraints.
- The tool appears in the list of available tools only when enabled in `tool_permissions`.

**Priority:** High
**Estimated Hours:** 10h
**Requirements Reference:** Business Requirements Feature 10; UC-15; ADR-007

#### Task 3.1.1.1.1 — Supabase migration: `behavioral_constraints` table

| Field | Value |
|---|---|
| Parent Story | 3.1.1.1 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | None (foundational) |
| Deliverables | SQL migration file in `supabase/migrations/` named `<timestamp>_add_behavioral_constraints.sql` |

**Acceptance Criteria:**
- Migration creates `behavioral_constraints` with columns: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `rule text NOT NULL`, `rationale text NOT NULL`, `scope text NOT NULL DEFAULT 'all'`, `is_locked boolean NOT NULL DEFAULT false`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- A `CHECK` constraint enforces `length(trim(rationale)) > 0`.
- An index exists on `(user_id, is_locked)` for gate-query performance.
- RLS is enabled; a policy `USING (user_id = auth.uid())` covers SELECT, INSERT, UPDATE, DELETE.
- The service-role client is exempt from RLS (consistent with existing tables).
- Running `npx supabase db push` applies the migration without error against a local Supabase instance.
- TypeScript types are regenerated to `apps/web/src/types/supabase.ts` after the migration.
- No secrets, no hardcoded UUIDs, no environment-specific values in the migration file.

#### Task 3.1.1.1.2 — Register `add_constraint` tool in `TOOL_REGISTRY`

| Field | Value |
|---|---|
| Parent Story | 3.1.1.1 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Task 3.1.1.1.1 (table must exist for the handler to write to) |
| Deliverables | Updated `registry.ts` and `ALL_TOOL_NAMES`; handler in `handlers.ts`; `tool_permissions` seed row |

**Acceptance Criteria:**
- `add_constraint` is added to `ALL_TOOL_NAMES` and `TOOL_REGISTRY` with a JSON-Schema input: `{ rule: string (required), rationale: string (required), scope?: string, is_locked?: boolean }`.
- The handler inserts a row into `behavioral_constraints` using the service-role client with `user_id` set to the caller's `userId` (never from input).
- If `rationale` is missing or empty, the handler returns `{ is_error: true, content: "rationale is required..." }` — no DB write occurs.
- A default seed row for `add_constraint` is added to `tool_permissions` with `enabled = true` for new users (consistent with existing seed pattern for task tools).
- The handler is covered by the existing `executeToolHandler` dispatch — no engine changes required in this wave.
- All error branches log a structured message and return `is_error: true` without leaking internal stack traces to the model.
- TypeScript strict mode passes with no `any` types introduced.

---

### Story 3.1.1.2 — List active constraints through conversation

**As the owner, I want to ask Coriven to show me my current constraints, so that I can review what rules are in effect and decide whether to lock or remove any.**

**Acceptance Criteria:**
- Saying "what constraints have I set?" causes the assistant to call `list_constraints` and display the results in a human-readable format.
- The returned list includes each constraint's rule, rationale, scope, and locked status.
- Only the authenticated user's constraints are returned — the tool never returns another user's constraints.
- If no constraints exist, the tool returns an empty list and the assistant communicates this clearly rather than hallucinating constraints.
- The tool is gated by `tool_permissions` and only appears when enabled.

**Priority:** High
**Estimated Hours:** 6h
**Requirements Reference:** Business Requirements Feature 10; UC-15

#### Task 3.1.1.2.1 — Register `list_constraints` tool in `TOOL_REGISTRY`

| Field | Value |
|---|---|
| Parent Story | 3.1.1.2 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Task 3.1.1.1.1 (table must exist) |
| Deliverables | Updated `registry.ts` and `ALL_TOOL_NAMES`; handler in `handlers.ts`; `tool_permissions` seed row |

**Acceptance Criteria:**
- `list_constraints` is added to `ALL_TOOL_NAMES` and `TOOL_REGISTRY` with an optional `scope` filter parameter (string).
- The handler queries `behavioral_constraints` scoped to `user_id = userId`; optionally filters by `scope`; orders by `created_at DESC`.
- If `scope` is provided, the query returns constraints where `scope = provided_scope OR scope = 'all'` so global constraints are always included.
- Result is serialized as JSON and returned as `content`; empty array is valid.
- A seed row for `list_constraints` is added to `tool_permissions` with `enabled = true`.
- TypeScript strict mode passes.

---

### Story 3.1.1.3 — Constraints are isolated from semantic memory retrieval

**As the owner, I want my behavioral constraints stored completely separately from factual memories, so that the engine gate can retrieve them reliably without going through the semantic similarity pipeline (which the research baseline shows is insufficient for enforcement).**

**Acceptance Criteria:**
- The `behavioral_constraints` table is a standalone relation — no foreign key or join dependency on the `memories` table.
- Constraints are not included in any vector search or pgvector retrieval path.
- The handler that loads constraints for the engine gate queries `behavioral_constraints` directly by `user_id` (and optionally `scope`) — not via embedding similarity.
- This isolation is documented in a code comment in the gate loader so future contributors understand the architectural intent.

**Priority:** High
**Estimated Hours:** 4h
**Requirements Reference:** Business Requirements Feature 10; ADR-007 §"Constraints ≠ facts"

#### Task 3.1.1.3.1 — Constraint loader utility

| Field | Value |
|---|---|
| Parent Story | 3.1.1.3 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | Task 3.1.1.1.1 |
| Deliverables | `apps/web/src/lib/chat/constraints/loader.ts` — exported `loadConstraintsForUser(userId, scope?)` function |

**Acceptance Criteria:**
- `loadConstraintsForUser` accepts `userId: string` and an optional `scope?: string`; returns `BehavioralConstraint[]` typed against the generated Supabase types.
- Query uses the service-role client (consistent with other engine-level reads) and is RLS-enforced at the DB layer as a secondary control.
- When `scope` is provided, returns rows where `scope = scope OR scope = 'all'`.
- A comment block at the top of the file states: "Constraints are loaded by exact DB query, not vector similarity — this is intentional per ADR-007. Do not route through the memory/embedding pipeline."
- Function is exported from `apps/web/src/lib/chat/constraints/index.ts` for clean import paths.
- No secrets hardcoded; uses `SUPABASE_SERVICE_ROLE_KEY` via the existing `createServiceClient` factory.
- Error from Supabase is caught, logged with a structured message, and re-thrown so the caller (the gate) can decide how to handle it.

---

### Story 3.1.1.4 — Type definitions for constraints

**As the developer, I want shared TypeScript types for behavioral constraints in `@personal-assistant/types`, so that the tool registry, handlers, gate, UI, and tests all share a single type contract with no drift.**

**Acceptance Criteria:**
- A `BehavioralConstraint` type (or interface) is exported from `packages/types` with fields matching the DB schema: `id`, `user_id`, `rule`, `rationale`, `scope`, `is_locked`, `created_at`, `updated_at`.
- A `ToolName` union in `packages/types` is extended to include `"add_constraint"` and `"list_constraints"`.
- `npm run typecheck` passes with no new errors across the monorepo.
- Types are not duplicated in `apps/web` — the single source is `@personal-assistant/types`.

**Priority:** Medium
**Estimated Hours:** 3h
**Requirements Reference:** Architecture §Data Model §14.6

#### Task 3.1.1.4.1 — Extend shared types package

| Field | Value |
|---|---|
| Parent Story | 3.1.1.4 |
| Agent | backend |
| Estimation | 4h |
| Dependencies | None (types are independent of DB) |
| Deliverables | Updated `packages/types/src/index.ts` (or appropriate sub-file) |

**Acceptance Criteria:**
- `BehavioralConstraint` interface exported with all required fields; all fields typed strictly (no `any`).
- `ToolName` union updated; existing references in `registry.ts` and `handlers.ts` continue to compile without changes.
- `npm run typecheck` passes across the monorepo.

---

## Task Dependencies

```
Task 3.1.1.4.1 (shared types)
      │
      ├── Task 3.1.1.1.1 (migration)
      │         │
      │         ├── Task 3.1.1.1.2 (add_constraint tool + handler)
      │         ├── Task 3.1.1.2.1 (list_constraints tool + handler)
      │         └── Task 3.1.1.3.1 (constraint loader utility)
```

Types can be authored in parallel with the migration; all tool/handler/loader work depends on both. The gate (Wave 3.2.1) and UI (Wave 3.3.1) depend on this wave completing in full.

**Critical path:** types → migration → loader → tool handlers.
**Parallelizable:** `add_constraint` handler and `list_constraints` handler can be built concurrently once the migration is applied.

---

## Definition of Done

- [ ] Migration applied to local Supabase; `npx supabase db push` exits 0.
- [ ] TypeScript types regenerated; `npm run typecheck` passes.
- [ ] `add_constraint` tool: calling it with a valid rule + rationale inserts a row; calling it without a rationale returns `is_error: true` and writes no row.
- [ ] `list_constraints` tool: returns only the authenticated user's constraints; empty array when none exist.
- [ ] `loadConstraintsForUser` utility is present and exports correctly.
- [ ] RLS verified: a service-role query directly against the DB can read rows; a client-role query scoped to a different `user_id` returns zero rows.
- [ ] `ToolName` union includes `"add_constraint"` and `"list_constraints"`.
- [ ] No secrets hardcoded anywhere in new files.
- [ ] All new code passes TypeScript strict mode.
- [ ] Unit tests cover: happy-path insert, missing-rationale rejection, list-empty, list-scoped filter.

---

## Infrastructure Specifications

### Database

**Table:** `behavioral_constraints`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id) ON DELETE CASCADE` | RLS anchor |
| `rule` | `text` | NOT NULL | The behavioral rule (e.g., "never modify MealPrepForge code") |
| `rationale` | `text` | NOT NULL, `CHECK (length(trim(rationale)) > 0)` | The richly-encoded WHY; required by design |
| `scope` | `text` | NOT NULL, `DEFAULT 'all'` | Free-text scope tag; `'all'` = applies to every tool call |
| `is_locked` | `boolean` | NOT NULL, `DEFAULT false` | Locked constraints cannot be overridden by the model |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | |
| `updated_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Trigger or app-level update on modify |

**Indexes:**
- `(user_id, is_locked)` — supports gate query: "give me this user's locked constraints"
- `(user_id, scope)` — supports scoped listing

**RLS Policies (on `behavioral_constraints`):**
- `ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY "user_own_constraints" ON behavioral_constraints FOR ALL USING (user_id = auth.uid())`

**Migration naming convention:** `<timestamp>_add_behavioral_constraints.sql` in `supabase/migrations/`.

### API / Tool Integration

**`add_constraint` tool** — registered in `TOOL_REGISTRY`; dispatched via `executeToolHandler`; writes to `behavioral_constraints` using the service-role client. The `user_id` is always taken from the authenticated session, never from tool input.

**`list_constraints` tool** — registered in `TOOL_REGISTRY`; reads from `behavioral_constraints` for the authenticated user; optional `scope` filter.

**`loadConstraintsForUser` utility** — not an HTTP endpoint; an internal function called by the engine gate in Wave 3.2.1. Lives in `apps/web/src/lib/chat/constraints/loader.ts`. Uses the service-role client; queries by `user_id` and optionally `scope`.

**Note:** The pre-action gate is an engine hook, not an HTTP endpoint — it is introduced in Wave 3.2.1. This wave delivers only the data layer and tool-use primitives.

### Testing

- **Unit tests:** `add_constraint` handler — happy path, missing rationale, empty rationale string; `list_constraints` handler — empty result, filtered by scope, unfiltered.
- **Integration test:** insert a constraint as user A; query as user B (different `user_id`) via the client role → zero rows returned (RLS enforcement).
- **Type test:** `npm run typecheck` passes across monorepo with updated `ToolName`.
- **Coverage target:** 80% line coverage on new handler and loader files.

### Monitoring

- Structured log on every `add_constraint` insert: `{ event: "constraint_added", userId, scope, isLocked }` — no PII from `rule` or `rationale` in logs.
- Structured log on loader errors: `{ event: "constraint_load_error", userId, error }`.
- Constraint count per user tracked as an application metric (baseline for adherence reporting in Wave 3.2.1).

---

## Handoff Requirements

This wave hands off to:
- **Wave 3.2.1** (engine gate): requires `loadConstraintsForUser` utility and `behavioral_constraints` schema to be stable.
- **Wave 3.3.1** (UI): requires the Supabase types and the `add_constraint`/`list_constraints` tool behavior to be stable so the UI can query the same table via Server Actions.

Deliverables that must be present before Wave 3.2.1 begins:
- Migration applied and types regenerated.
- `loadConstraintsForUser` exported and tested.
- `add_constraint` and `list_constraints` handlers registered and passing tests.

---

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Epic 2 (memory layer) not complete | High — `loadConstraintsForUser` borrows the service-client pattern established in Epic 2 | Medium | Constraint loader is independent of memory tables; only the client pattern is shared — can proceed if `createServiceClient` exists |
| Rationale-required constraint creates friction for the model | Low — the model may omit rationale and get an error | Medium | System prompt update in Wave 3.2.1 instructs the model to always include rationale; handler error message is clear |
| TypeScript `ToolName` union drift between packages | Medium — mismatches cause compile failures | Low | Single source in `packages/types`; typecheck in CI catches it |
| RLS bypass via service-role in tests | Low | Low | Tests that verify isolation must use the anon/user-role client, not service role |

---

## Related Documentation

- `docs/implementation/_main/epic-3-behavioral-constraint-layer.md` — Epic scope and Feature 3.1 definition
- `docs/architecture/_main/04-Architecture.md` — §Data Model §14.6 (`behavioral_constraints` schema); §Application Security
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 10; UC-15; AI-specific business rule 3
- `docs/architecture/decisions/ADR-007-behavioral-constraint-pre-action-gate.md` — architectural rationale
- `apps/web/src/lib/chat/tools/registry.ts` — existing tool registry pattern
- `apps/web/src/lib/chat/tools/handlers.ts` — existing handler pattern
- `apps/web/src/lib/chat/engine.ts` — engine context (gate introduced in Wave 3.2.1)
