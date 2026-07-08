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
epic: "2"
feature: "2.3"
wave: "2.3.1"
agents: []
tags: [coriven, memory, tools, registry, entity-resolution, tool-permissions]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
---

# Wave 2.3.1: Memory Tools

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.3.1 |
| Feature | 2.3 — Memory Tools |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Add five memory tools to the registry and handlers (`save_memory`, `recall_memories`, `upsert_entity`, `update_user_context`, `summarize_conversation`), gated by `tool_permissions`, with entity resolution (exact → alias → fuzzy ≤2 → disambiguation) |

**Wave Philosophy:** Scope-based — this wave is complete when all five memory tools are registered, handle every defined input path, and are gated by `tool_permissions` so disabled tools are never passed to the model.

## Wave Goals

1. **Claude can explicitly save and recall facts.** The `save_memory` and `recall_memories` tools enable the model to write new facts and query the memory store directly from within a chat turn — building on the passive context assembly from Wave 2.2.1 with active memory management.
2. **Entity management is robust.** `upsert_entity` handles creation, aliasing, and fuzzy matching (Levenshtein ≤ 2) so a reference to "sis" resolves to the existing "Sarah" profile; ambiguous matches surface a disambiguation prompt rather than creating duplicates.
3. **All tools respect `tool_permissions`.** Memory tools follow the existing gate pattern exactly: only tools with `enabled = true` in `tool_permissions` are passed to the model; disabled tools can never be called, consistent with Business Requirements AI Rule 1.

## User Stories

### Story 2.3.1.1 — Claude can save a memory and recall memories via tools

**As the** primary user,
**I want** to be able to say "remember that I prefer dark roast coffee" and have Coriven confirm it saved,
**So that** future sessions recall this preference automatically through the context assembly layer.

**Acceptance Criteria:**
- `save_memory` tool registered in `TOOL_REGISTRY`; handler calls `classifyAndWriteMemory` (from Wave 2.2.1 `writer.ts`); returns confirmation string.
- `recall_memories` tool registered; handler calls `generateEmbedding` + `match_memories` RPC; returns top-k matching memories as a JSON array string.
- Both tools appear in `ALL_TOOL_NAMES` and in `tool_permissions` default rows.
- When `save_memory` is disabled in `tool_permissions`, the tool is absent from the tools list passed to Claude.
- Unit tests for both handlers cover success, DB error, and disabled-tool-gating (the latter verified via the engine's `loadToolPermissions` logic).
- >80% coverage on the two new handlers.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4, Feature 3 (AI Rule 1 — disabled tools never exposed); Architecture §"Tool Registry & Handlers"

#### Task 2.3.1.1.1 — Register `save_memory` and `recall_memories` in the tool registry

| Field | Value |
|---|---|
| Parent Story | 2.3.1.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Wave 2.2.1 complete (`writer.ts`, `context.ts`) |
| Deliverables | Updated `apps/web/src/lib/chat/tools/registry.ts`; updated `packages/types/src/tool.ts` (`ToolName` union) |

**Acceptance Criteria:**
- `save_memory` JSON-Schema input: `{ content: string, source?: string }`. Required: `content`.
- `recall_memories` JSON-Schema input: `{ query: string, top_k?: number }`. Required: `query`.
- Both added to `ALL_TOOL_NAMES` array and `TOOL_REGISTRY` record.
- `ToolName` union in `packages/types/src/tool.ts` extended with `'save_memory' | 'recall_memories' | 'upsert_entity' | 'update_user_context' | 'summarize_conversation'`.
- `npm run typecheck` passes with zero errors.

#### Task 2.3.1.1.2 — Implement handlers for `save_memory` and `recall_memories`

| Field | Value |
|---|---|
| Parent Story | 2.3.1.1 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.3.1.1.1 |
| Deliverables | Two new handler functions in `apps/web/src/lib/chat/tools/handlers.ts`; `HANDLERS` record extended |

**Acceptance Criteria:**
- `handleSaveMemory`: validates `content` is non-empty string; calls `classifyAndWriteMemory(userId, content)`; returns `{ content: 'Memory saved.', is_error: false }` on success; structured error string on failure.
- `handleRecallMemories`: validates `query`; calls `generateEmbedding(query)` then `match_memories` RPC with `top_k ?? 8`; returns JSON-serialized memory array.
- Both handlers added to `HANDLERS` record keyed by `ToolName`.
- On error both return `{ content: '<descriptive message>', is_error: true }` — consistent with existing handler pattern.

#### Task 2.3.1.1.3 — Unit-test `save_memory` and `recall_memories` handlers

| Field | Value |
|---|---|
| Parent Story | 2.3.1.1 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.3.1.1.2 |
| Deliverables | Handler tests appended to `apps/web/src/lib/chat/tools/__tests__/handlers.test.ts` |

**Acceptance Criteria:**
- Supabase service client mocked; embedding service mocked.
- Save: success path returns confirmation; DB error returns `is_error: true`.
- Recall: success returns JSON array; embedding failure returns `is_error: true`.
- Coverage >80% on the two new handlers.

---

### Story 2.3.1.2 — Claude can upsert entity profiles with entity resolution

**As the** primary user,
**I want** to say "my sis Sarah is moving to Austin" and have Coriven update the existing Sarah entity (not create a duplicate),
**So that** entity profiles stay clean regardless of how I refer to people.

**Acceptance Criteria:**
- `upsert_entity` tool registered; handler resolves name via: exact match on `name` → alias match in `aliases[]` → fuzzy Levenshtein distance ≤ 2 → if >1 candidate at fuzzy distance, returns a disambiguation prompt (not an entity write).
- On unambiguous resolution: `UPDATE entity_profiles SET ... WHERE id = resolved_id`.
- On no match: `INSERT` new entity profile.
- `aliases` array is merged (not replaced) on update.
- `mention_count` incremented and `last_mentioned` set on every upsert (insert or update).
- Ambiguity scenario: two entities "Sara" and "Sarah" at Levenshtein distance 1 each → disambiguation response returned; no write.
- RLS enforced: handler uses service client; `user_id` always set from the authenticated `userId` parameter.
- >80% coverage on resolution logic.

**Priority:** Critical
**Estimated hours:** 8h
**References:** Business Requirements Feature 4 (UC-25 — ambiguous entity); Architecture §"Tool Registry & Handlers" (entity resolution); UC-10

#### Task 2.3.1.2.1 — Implement entity resolution utility

| Field | Value |
|---|---|
| Parent Story | 2.3.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 2.1.1 (`entity_profiles` table) |
| Deliverables | `apps/web/src/lib/memory/entity-resolver.ts` |

**Acceptance Criteria:**
- `resolveEntity(userId: string, name: string): Promise<ResolveResult>` where `ResolveResult` is `{ match: EntityProfile } | { ambiguous: EntityProfile[] } | { none: true }`.
- Resolution order: exact name match → alias array contains match → Levenshtein ≤ 2 (against both `name` and each alias).
- Levenshtein implementation must not import a non-approved package without owner sign-off; a simple O(m×n) inline implementation is acceptable at the record counts expected.
- Returns `ambiguous` only when two or more candidates are within distance ≤ 2.
- No RLS-bypass; always scoped to `userId`.

#### Task 2.3.1.2.2 — Implement `upsert_entity` tool registration and handler

| Field | Value |
|---|---|
| Parent Story | 2.3.1.2 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.3.1.2.1, Task 2.3.1.1.1 (ToolName extended) |
| Deliverables | Registry entry + `handleUpsertEntity` in `handlers.ts` |

**Acceptance Criteria:**
- JSON-Schema input: `{ name: string, type?: entity_profile_type, description?: string, aliases?: string[] }`. Required: `name`.
- Handler calls `resolveEntity`; on ambiguity returns disambiguation prompt as non-error content; on match UPDATEs; on none INSERTs.
- `mention_count += 1`, `last_mentioned = NOW()` on every path (insert + update).
- Aliases merged: `array_append` or client-side union — no duplicate aliases.
- Returns serialized entity JSON on success.

#### Task 2.3.1.2.3 — Unit-test entity resolution and handler

| Field | Value |
|---|---|
| Parent Story | 2.3.1.2 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.3.1.2.2 |
| Deliverables | `apps/web/src/lib/memory/__tests__/entity-resolver.test.ts` |

**Acceptance Criteria:**
- Tests cover: exact match, alias match, fuzzy match (distance 1 and 2), ambiguous (two candidates at distance ≤ 2), no match.
- Handler test: disambiguation input → returns disambiguation string without writing; valid input → correct upsert path.
- Coverage >80% on `entity-resolver.ts`.

---

### Story 2.3.1.3 — Claude can update user-level context and summarize conversations

**As the** primary user,
**I want** Coriven to maintain a single structured record of my preferences and to periodically summarize conversations,
**So that** the most stable facts and recent context are always available in the system prompt efficiently.

**Acceptance Criteria:**
- `update_user_context` tool registered; handler does an upsert on `user_context` for the authenticated user; merges `preferences` and `facts` jsonb fields (JSON merge patch semantics — new keys added, existing keys overwritten).
- `summarize_conversation` tool registered; handler inserts a new row in `conversation_summaries` with the provided `summary` text and optional `conversation_id`.
- Both tools respect `tool_permissions` gate.
- Unit tests for both handlers; >80% coverage.

**Priority:** High
**Estimated hours:** 5h
**References:** Business Requirements Feature 4; Architecture §14.2 (`user_context`, `conversation_summaries`)

#### Task 2.3.1.3.1 — Implement `update_user_context` and `summarize_conversation`

| Field | Value |
|---|---|
| Parent Story | 2.3.1.3 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 2.3.1.1.1 (ToolName extended); Wave 2.1.1 (tables) |
| Deliverables | Registry entries + two handlers in `handlers.ts` |

**Acceptance Criteria:**
- `update_user_context` input: `{ preferences?: object, facts?: object }`.
  - Handler: `INSERT INTO user_context (...) ON CONFLICT (user_id) DO UPDATE SET preferences = user_context.preferences || $preferences, facts = user_context.facts || $facts, updated_at = NOW()`.
- `summarize_conversation` input: `{ summary: string, conversation_id?: string }`.
  - Handler: inserts row in `conversation_summaries`; returns the inserted row id.
- Both handlers follow the `{ content: string, is_error: boolean }` return contract.

#### Task 2.3.1.3.2 — Unit-test both handlers

| Field | Value |
|---|---|
| Parent Story | 2.3.1.3 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.3.1.3.1 |
| Deliverables | Handler tests added to the handlers test file |

**Acceptance Criteria:**
- Supabase client mocked.
- `update_user_context`: merge semantics verified (existing key overwritten; new key added).
- `summarize_conversation`: insertion verified; missing `summary` returns error.
- Coverage >80% on both handlers.

---

### Story 2.3.1.4 — Memory tool permissions seeded for existing and new users

**As the** system,
**I want** the five memory tools to have `tool_permissions` rows created for every user (defaulting to `enabled = true` for memory tools),
**So that** Claude can use them immediately without manual configuration for the primary user.

**Acceptance Criteria:**
- A Supabase migration or server-side seed upserts `tool_permissions` rows for all five memory tool names for the authenticated user on first use (or via a migration that back-fills existing users).
- Memory tools default to `enabled = true` (matching the intent for the primary-user phase; productization may change defaults by tier in Epic 7).
- Settings → Tool Permissions page (built in Epic 1) displays the five new tool toggles without code change (relies on the generic toggle rendering).

**Priority:** High
**Estimated hours:** 3h
**References:** Business Requirements Feature 3 (AI Rule 1); Architecture §"Tool Registry"

#### Task 2.3.1.4.1 — Migration to seed memory tool permissions defaults

| Field | Value |
|---|---|
| Parent Story | 2.3.1.4 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.3.1.1.1 (tool names finalized) |
| Deliverables | `supabase/migrations/<timestamp>_seed_memory_tool_permissions.sql` |

**Acceptance Criteria:**
- Migration inserts (`user_id`, `tool_name`, `enabled = true`) for each of the five memory tools for all existing `auth.users` rows via a `DO $$ BEGIN ... END $$` block using `INSERT ... ON CONFLICT DO NOTHING`.
- New-user path: application code (or a Supabase trigger on profile creation) seeds these rows for new users; if via trigger, trigger added in this migration.
- Migration applies without error; `npx supabase db push` exits 0.

#### Task 2.3.1.4.2 — Verify tool-permissions gate for memory tools

| Field | Value |
|---|---|
| Parent Story | 2.3.1.4 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.3.1.4.1 |
| Deliverables | Integration test or manual verification notes |

**Acceptance Criteria:**
- Set `save_memory.enabled = false` in `tool_permissions`; run chat turn → `save_memory` absent from the tools list sent to Claude (verified via the engine's `loadToolPermissions` logic or a mock-based test).
- Re-enable → tool present in subsequent call.

## Task Dependencies

```
Wave 2.2.1 (complete)
  └─► 2.3.1.1.1 (registry + ToolName)
        ├─► 2.3.1.1.2 (save/recall handlers) ──► 2.3.1.1.3 (tests)
        ├─► 2.3.1.2.2 (upsert_entity handler) ──► 2.3.1.2.3 (tests)
        └─► 2.3.1.3.1 (context + summary handlers) ──► 2.3.1.3.2 (tests)

2.3.1.2.1 (entity resolver) ──► 2.3.1.2.2 (can run parallel to 2.3.1.1.x)

2.3.1.4.1 (permissions migration) depends only on 2.3.1.1.1 (tool names known)
```

**Critical path:** 2.3.1.1.1 → 2.3.1.1.2 → end-to-end tool call verification.

## Definition of Done

- [ ] All five memory tools registered in `TOOL_REGISTRY`; `ToolName` union updated.
- [ ] All five handlers implemented following the `{ content, is_error }` contract.
- [ ] Disabled-tool gate verified: disabled memory tool absent from Claude API call.
- [ ] Entity resolution covers exact, alias, fuzzy ≤ 2, and ambiguity paths — all tested.
- [ ] No entity duplicates created when aliased/fuzzy reference resolves to an existing profile.
- [ ] `update_user_context` merges jsonb fields without overwriting unrelated keys.
- [ ] `summarize_conversation` inserts rows to `conversation_summaries`.
- [ ] Memory tool `tool_permissions` rows seeded; Settings toggle page shows five new tools.
- [ ] Coverage >80% on all new handler and resolver modules.
- [ ] `npm run typecheck` clean; lint passes.

## Infrastructure Specifications

### Database

- Reads/writes to `entity_profiles`, `memories`, `user_context`, `conversation_summaries` (all from Wave 2.1.1).
- New migration: seed `tool_permissions` rows for five memory tools.
- Possible trigger: `on_profile_created` seeds memory tool permissions for new users.

### API

No new HTTP routes. Tool handlers are invoked from `executeToolHandler` inside `lib/chat/engine.ts` during the tool-use loop (existing architecture).

### UI

No new pages. The existing Settings → Tool Permissions page renders the five new tool rows automatically via the generic toggle component, as tool names are read from `tool_permissions` rows.

### Testing

- Unit: all five handlers (success, error, edge cases); entity resolver (all resolution paths); coverage >80%.
- Integration: tool-permissions gate (disable → absent; enable → present).
- Typecheck: `npm run typecheck` exits 0.
- Migration: `npx supabase db push` exits 0.

### Deployment

No new environment variables beyond those introduced in Waves 2.1.1 and 2.2.1.

### Monitoring

- Log tool invocations at `info` level: `{ event: 'tool_call', tool: 'save_memory|...', user_id }`.
- Log entity resolution outcome: `{ event: 'entity_resolve', result: 'exact|alias|fuzzy|ambiguous|none' }`.
- Log Mem0 classification action (from `writer.ts` in Wave 2.2.1 — already in place).

## Handoff Requirements

Wave 2.4.1 (Memory UI) may begin when:
- `upsert_entity` handler is complete and tested (UI will call it via Server Action).
- `entity_profiles` and `memories` are writable via the service client with RLS.
- `save_memory` handler available for UI-driven corrections.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Levenshtein fuzzy match creates false positives at ≤ 2 distance for short names | Medium | Medium | Add minimum name length guard (e.g., skip fuzzy for names < 4 chars); unit-test with short names |
| `tool_permissions` seed migration fails for users who have already toggled tools | Low | Low | `ON CONFLICT DO NOTHING` guard in migration |
| Five new tools balloon the tool list token budget | Low | Low | Tool descriptions are concise; Anthropic SDK handles the tool list serialization |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.3 scope
- `docs/architecture/_main/04-Architecture.md` — §"Tool Registry & Handlers"; §"AI Architecture"
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 4, UC-25; AI Rule 1
- `apps/web/src/lib/chat/tools/registry.ts` — existing tool pattern to follow
- `apps/web/src/lib/chat/tools/handlers.ts` — existing handler pattern to follow
- `apps/web/src/lib/memory/writer.ts` — introduced in Wave 2.2.1
