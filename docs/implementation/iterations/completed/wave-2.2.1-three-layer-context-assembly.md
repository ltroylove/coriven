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
epic: "2"
feature: "2.2"
wave: "2.2.1"
agents: []
tags: [coriven, memory, context-assembly, mem0, supersession, chat-engine]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/02-Product-Plan.md"
---

# Wave 2.2.1: Three-Layer Context Assembly (MVP)

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.2.1 |
| Feature | 2.2 — Three-Layer Context Assembly (MVP) |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Assemble entity profiles + semantic memories + conversation summaries into the chat system prompt synchronously; implement Mem0 ADD/UPDATE/DELETE/NOOP write classification; handle contradiction via `superseded_by` |

**Wave Philosophy:** Scope-based — this wave is complete when the chat engine assembles all three memory layers before every Claude call and the sister/Coke/Pepsi acceptance scenarios pass end-to-end, regardless of calendar time.

## Wave Goals

1. **Sister and Coke/Pepsi problems solved.** The chat engine injects entity profiles (always-in-context, <~500 tokens), top-k semantic memories, and the last 2–3 summaries into the system prompt before each Claude call — satisfying the primary Product Plan Phase 2a success criterion for cross-session recall.
2. **Memory writes are classified correctly.** New facts are classified using the Mem0 ADD/UPDATE/DELETE/NOOP pattern via a Haiku call against top-k similar memories; contradictions trigger `superseded_by` chaining rather than destructive deletion — satisfying Business Requirements Feature 4 "superseded excluded from default retrieval, still queryable."
3. **Context assembly is a testable, independent library.** `lib/memory/context.ts` and `lib/memory/writer.ts` are independently exercisable and consumed by `lib/chat/engine.ts` without coupling the two modules directly.

## User Stories

### Story 2.2.1.1 — Chat system prompt includes entity profiles always in context

**As the** primary user,
**I want** Coriven to always know about the people, places, and projects I've told it about without me restating them,
**So that** I can say "I'm visiting my sister" and it replies with relevant detail (like her city) without prompting.

**Acceptance Criteria:**
- All non-superseded `entity_profiles` for the user are formatted into a "What I know about your people and projects" block injected into the system prompt, capped at approximately 500 tokens.
- If no entities exist the block is omitted (no empty placeholder).
- Token budget logic truncates the entity block rather than crashing when profiles are large.
- Acceptance scenario: teach "my sister Sarah lives in Denver" in session A; start session B; say "I'm visiting my sister" → Coriven mentions Denver without re-teaching.
- Unit tests verify the formatting function against known fixture data.
- >80% coverage on `lib/memory/context.ts` formatting logic.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4 (UC-10); Architecture §"AI Architecture / Memory pipeline layer 1"

#### Task 2.2.1.1.1 — Implement entity profile loader and formatter

| Field | Value |
|---|---|
| Parent Story | 2.2.1.1 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 2.1.1 complete (entity_profiles table + RLS) |
| Deliverables | `apps/web/src/lib/memory/context.ts` — `loadEntityProfiles(userId)` and `formatEntityBlock(profiles)` |

**Acceptance Criteria:**
- `loadEntityProfiles` queries `entity_profiles` using the service client; filters `superseded_by IS NULL` on entities (a future-proofing guard — not applicable in Wave 2.1.1 schema, but harmless).
- `formatEntityBlock` serializes profiles to a readable markdown-ish block; truncates to ~500 tokens using a character-count heuristic (1 token ≈ 4 chars).
- Returns empty string when no profiles exist.
- `updated_at`-based ordering (most recently mentioned first via `last_mentioned DESC`).
- No hardcoded user IDs; `OPENAI_API_KEY` not touched here.

#### Task 2.2.1.1.2 — Integrate entity block into `engine.ts` system prompt

| Field | Value |
|---|---|
| Parent Story | 2.2.1.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.2.1.1.1 |
| Deliverables | Modified `apps/web/src/lib/chat/engine.ts` — `buildSystemPrompt` becomes async, accepts memory context |

**Acceptance Criteria:**
- `runChatEngine` calls `loadEntityProfiles` and `loadSemanticMemories` (Task 2.2.1.2.1) before the first Claude API call.
- Assembled context prepended to the system prompt after the existing task-management instructions.
- When both entity block and memory block are empty (new user) the system prompt is unchanged from today.
- No changes to the tool loop or SSE send logic.
- TypeScript strict-mode: no `any` introduced.

---

### Story 2.2.1.2 — Top-k semantic memories retrieved and injected per turn

**As the** primary user,
**I want** Coriven to surface relevant past facts from our conversations (not just entities) when I say something related,
**So that** it can recall preferences like "I prefer Coke over Pepsi" without those preferences being in entity profiles.

**Acceptance Criteria:**
- `loadSemanticMemories(userId, queryText, topK)` embeds the user's current message (via `generateEmbedding`) and calls `match_memories` RPC to retrieve top-k non-superseded memories.
- Retrieved memories are formatted into a "Relevant memories" block injected into the system prompt.
- Default top-k is 8; configurable via a named constant.
- Coke/Pepsi acceptance scenario: teach preference in session A; ask "what drink should I order?" in session B → Coriven recommends Coke.
- If the embedding service is unavailable the function logs the error and returns an empty block (no crash, chat continues).
- >80% coverage on retrieval logic.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4 (UC-10); Architecture §"AI Architecture / Memory pipeline layer 2"; ADR-001

#### Task 2.2.1.2.1 — Implement semantic memory loader

| Field | Value |
|---|---|
| Parent Story | 2.2.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Wave 2.1.1 complete (`match_memories` RPC, `generateEmbedding`) |
| Deliverables | `apps/web/src/lib/memory/context.ts` — `loadSemanticMemories(userId, queryText, topK?)` |

**Acceptance Criteria:**
- Calls `generateEmbedding(queryText)` then `supabase.rpc('match_memories', {...})`.
- On embedding error: catches exception, logs `{level:'warn', source:'loadSemanticMemories', error}`, returns `[]`.
- Returns typed `Memory[]` sorted by similarity.
- Service client used (not anon client); RLS enforced server-side.

#### Task 2.2.1.2.2 — Format and inject memory block

| Field | Value |
|---|---|
| Parent Story | 2.2.1.2 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.2.1.2.1 |
| Deliverables | `formatMemoryBlock(memories: Memory[])` in `context.ts`; integration into `engine.ts` |

**Acceptance Criteria:**
- Block lists memories as a bulleted list under a "What I remember" heading.
- Empty-block guard: omitted when `memories.length === 0`.
- Combined entity + memory block fits within model `max_tokens` budget (4096 for output; context window enforced by Anthropic SDK).

---

### Story 2.2.1.3 — Last 2–3 conversation summaries injected for continuity

**As the** primary user,
**I want** Coriven to reference the gist of our recent past conversations,
**So that** I don't need to re-establish context at the start of every session.

**Acceptance Criteria:**
- `loadConversationSummaries(userId, limit=3)` fetches the most recent `conversation_summaries` rows ordered by `created_at DESC`.
- Summaries are formatted into a "Recent conversation context" block appended to the system prompt.
- If no summaries exist the block is omitted.
- Unit tests verify ordering and empty-state behaviour.

**Priority:** High
**Estimated hours:** 4h
**References:** Business Requirements Feature 4; Architecture §"AI Architecture / Memory pipeline layer 3"

#### Task 2.2.1.3.1 — Implement summary loader and formatter

| Field | Value |
|---|---|
| Parent Story | 2.2.1.3 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Wave 2.1.1 complete (`conversation_summaries` table) |
| Deliverables | `loadConversationSummaries` and `formatSummaryBlock` in `context.ts` |

**Acceptance Criteria:**
- Queries `conversation_summaries` for `user_id = userId ORDER BY created_at DESC LIMIT 3`.
- Formats summaries with the most recent first.
- Graceful empty-state: returns `''` when no rows exist.

#### Task 2.2.1.3.2 — Integrate summary block into `engine.ts`

| Field | Value |
|---|---|
| Parent Story | 2.2.1.3 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.2.1.3.1, Task 2.2.1.1.2 |
| Deliverables | `engine.ts` updated; no other file changes |

**Acceptance Criteria:**
- All three blocks (entity, memory, summary) assembled in order before the first Claude call.
- Assembly order: entities first, then memories, then summaries (most stable to most ephemeral).
- If all three loaders return empty strings the system prompt is identical to the pre-memory baseline.

---

### Story 2.2.1.4 — Memory writes classified via Mem0 pattern; contradictions use `superseded_by`

**As the** primary user,
**I want** Coriven to update what it knows when I correct it (e.g., "Sarah moved to Austin") rather than duplicating conflicting facts,
**So that** its knowledge evolves correctly and the old fact is preserved but no longer surfaced by default.

**Acceptance Criteria:**
- `classifyAndWriteMemory(userId, candidateText)` calls Haiku with the candidate fact and the top-k most similar existing memories; Haiku returns ADD / UPDATE / DELETE / NOOP.
- ADD: new `memories` row inserted with a fresh embedding.
- UPDATE: existing row's `content` replaced; old row's `superseded_by` set to the new row's `id`.
- DELETE: existing row's `superseded_by` set to a tombstone sentinel (or the id of a deleted-marker row).
- NOOP: nothing written.
- Supersession scenario: "Sarah moved to Austin" → old Denver memory has `superseded_by` set → `match_memories` no longer returns it → future recall says Austin.
- `superseded_by IS NOT NULL` rows remain queryable via direct DB access (not destructively removed).
- >80% coverage on classification logic (Haiku mocked in unit tests).

**Priority:** Critical
**Estimated hours:** 8h
**References:** Business Requirements Feature 4 (UC-13); Architecture §"AI Architecture / Mem0"; ADR-001

#### Task 2.2.1.4.1 — Implement `lib/memory/writer.ts` with Mem0 classification

| Field | Value |
|---|---|
| Parent Story | 2.2.1.4 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Wave 2.1.1 (memories table, generateEmbedding, match_memories); Anthropic SDK (Haiku model constant available) |
| Deliverables | `apps/web/src/lib/memory/writer.ts` |

**Acceptance Criteria:**
- Haiku called with a structured prompt containing the candidate fact and up to 5 top-k existing memories; response parsed into `ADD | UPDATE | DELETE | NOOP`.
- Haiku model ID sourced from an env-safe constant (e.g., `EXTRACTION_MODEL` in `lib/anthropic.ts`); not hardcoded in the writer.
- On Haiku error: logs error and falls back to ADD (conservative default).
- `superseded_by` updated atomically using a Supabase transaction or sequential guarded writes.
- No destructive `DELETE` from the `memories` table — only `superseded_by` chaining.
- `generateEmbedding` called only on ADD/UPDATE (not NOOP/DELETE).

#### Task 2.2.1.4.2 — Unit-test Mem0 classification paths

| Field | Value |
|---|---|
| Parent Story | 2.2.1.4 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.2.1.4.1 |
| Deliverables | `apps/web/src/lib/memory/__tests__/writer.test.ts` |

**Acceptance Criteria:**
- Haiku client mocked; OpenAI embedding client mocked.
- Tests cover all four Mem0 outcomes: ADD inserts new row + embedding; UPDATE inserts new + chains superseded_by on old; DELETE sets superseded_by; NOOP writes nothing.
- Test for Haiku error → ADD fallback.
- Coverage >80% on `writer.ts`.

## Task Dependencies

```
Wave 2.1.1 (all done)
  ├─► 2.2.1.1.1 (entity loader) ──► 2.2.1.1.2 (engine integration)
  ├─► 2.2.1.2.1 (semantic loader) ──► 2.2.1.2.2 (memory block injection)
  ├─► 2.2.1.3.1 (summary loader) ──► 2.2.1.3.2 (summary block injection)
  └─► 2.2.1.4.1 (writer/Mem0) ──► 2.2.1.4.2 (Mem0 unit tests)

[2.2.1.1.2 + 2.2.1.2.2 + 2.2.1.3.2] must complete before engine integration is done.
[2.2.1.4.x] can run in parallel with the loader/formatter tasks.
```

**Critical path:** entity loader → engine integration → end-to-end acceptance test.

## Definition of Done

- [ ] Sister problem acceptance scenario passes: fact taught session A; recalled correctly session B without re-teaching.
- [ ] Coke/Pepsi problem acceptance scenario passes: preference taught; recalled in an unrelated follow-up session.
- [ ] Supersession scenario passes: "Sarah moved to Austin" → Denver memory has `superseded_by` set; `match_memories` returns Austin only; Denver queryable via direct access.
- [ ] All three context layers (entity, semantic, summary) assembled and injected into the system prompt before every Claude call.
- [ ] Entity block capped at ~500 tokens; gracefully truncates.
- [ ] Memory loaders degrade gracefully on embedding/DB failure (log + empty block; chat continues).
- [ ] Mem0 writer: all four outcomes (ADD/UPDATE/DELETE/NOOP) tested; no destructive deletes from `memories`.
- [ ] Coverage >80% on `context.ts` and `writer.ts`.
- [ ] `npm run typecheck` clean; lint passes.
- [ ] No new `any` types introduced; strict TypeScript throughout.

## Infrastructure Specifications

### Database

No new tables in this wave. Reads from `entity_profiles`, `memories`, `user_context`, `conversation_summaries` created in Wave 2.1.1. Writes to `memories` (INSERT on ADD; UPDATE `superseded_by` on UPDATE/DELETE).

### API

No new HTTP routes. Context assembly is an internal `lib/memory/` function consumed by `lib/chat/engine.ts`.

### UI

No UI changes. Memory display lands in Wave 2.4.1.

### Testing

- Unit: `context.ts` formatters — fixture-based; verify token truncation, empty-state guards, ordering.
- Unit: `writer.ts` — Haiku + OpenAI mocked; all four Mem0 paths; fallback on Haiku error.
- Integration: end-to-end chat scenario (local Supabase + mocked AI) — teach fact in one conversation, query in a second, assert recall; teach contradiction, assert supersession.
- Coverage: >80% on all new `lib/memory/` modules.
- Typecheck: `npm run typecheck` exits 0.

### Deployment

No new environment variables beyond `OPENAI_API_KEY` (introduced in Wave 2.1.1). The Haiku model constant (`claude-haiku-4-5-20251001`) is a code constant, not an env var.

### Monitoring

- Log structured events: `{level:'info', event:'memory_context_assembled', entity_count, memory_count, summary_count, user_id}` per chat turn.
- Log Mem0 classification outcome: `{event:'mem0_write', action:'ADD|UPDATE|DELETE|NOOP', user_id}`.
- Log graceful embedding failures at `warn` level with error details.

## Handoff Requirements

Wave 2.3.1 (Memory Tools) may begin when:
- `lib/memory/writer.ts` (`classifyAndWriteMemory`) is exported and tested.
- `lib/memory/context.ts` (all three loaders) is exported and tested.
- `entity_profiles` table writable via the service client with RLS.

Wave 2.4.1 (Memory UI) may begin when Wave 2.3.1 is complete (tools provide the write path the UI exposes).

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Haiku misclassifies edge cases (e.g., UPDATE when ADD is correct) | Medium | Medium | Prompt engineering + unit tests; fallback to ADD on parse error |
| Token budget exceeded with many entities | Medium | Low | ~500-token cap with character heuristic; truncation tested |
| Embedding latency adds perceptible delay to chat turns | Medium | Low | Embedding call is <200ms typical; async Sentinel (Wave 2.5) eliminates this from the read path |
| `match_memories` returns irrelevant memories for short messages | Medium | Medium | Short-message guard: if query < 10 chars skip semantic retrieval; tunable top-k constant |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.2 scope
- `docs/architecture/_main/04-Architecture.md` — §"AI Architecture", ADR-002, §14.2
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 4, UC-10, UC-13
- `apps/web/src/lib/chat/engine.ts` — existing engine (extend `buildSystemPrompt`)
- `apps/web/src/lib/memory/embedding.ts` — introduced in Wave 2.1.1
