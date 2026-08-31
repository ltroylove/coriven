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
feature: "2.5"
wave: "2.5.1"
agents: []
tags: [coriven, sentinel, upstash, redis, haiku, async, extraction, context-package]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/02-Product-Plan.md"
---

# Wave 2.5.1: Sentinel — Cache & Async Extraction

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.5.1 |
| Feature | 2.5 — The Sentinel (2b) |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Implement the async Sentinel: Haiku extraction of entities/facts from each message, embedding + pgvector search, package assembly, write to Upstash (`sentinel:context:{user_id}`, TTL-bounded) with `sentinel_context` Supabase fallback; fires on both user and assistant messages |

**Wave Philosophy:** Scope-based — this wave is complete when the Sentinel reliably builds and persists a context package after every chat message (user and assistant), using Upstash as the primary store and Supabase as the durable fallback, regardless of calendar time.

## Wave Goals

1. **Async extraction runs without blocking chat.** The Sentinel is triggered post-turn (after both the user message is persisted and the assistant response is saved) and runs asynchronously — never in the chat response critical path — satisfying ADR-002 and the Architecture's "never blocks" requirement.
2. **Context package written to Upstash with Supabase fallback.** After extraction and assembly the Sentinel writes a JSON package to `sentinel:context:{user_id}` in Upstash with a bounded TTL, and simultaneously writes to `sentinel_context` in Supabase — providing the durable fallback required by UC-20.
3. **Rapid-fire resilience.** When a new Sentinel run fires before the previous one completes, the prior package is not evicted until the new one is ready; rapid-fire messages fall back to the most recent committed package, satisfying UC-21.

## User Stories

### Story 2.5.1.1 — Sentinel fires asynchronously after each user message is persisted

**As the** system,
**I want** the Sentinel to begin extracting context from the user's message as soon as it is persisted, without waiting for or blocking the Claude response,
**So that** the context package is updated in the background while the user reads the assistant's reply.

**Acceptance Criteria:**
- `runChatEngine` in `engine.ts` triggers `runSentinel(userId, messageText, 'user')` as a non-awaited background call after persisting the user message.
- `runSentinel` never throws into the chat engine; all errors are caught internally and logged.
- Sentinel trigger adds zero perceptible latency to the chat response (no awaiting in the hot path).
- Unit test: mock `runSentinel`; assert it is called once with the user message text after `saveMessage`; assert the SSE stream is not blocked by the sentinel call.
- >80% coverage on the trigger path in `engine.ts`.

**Priority:** Critical
**Estimated hours:** 4h
**References:** Business Requirements Feature 4 (UC-9), UC-36; Architecture §"Sentinel flow"; ADR-002

#### Task 2.5.1.1.1 — Create `lib/memory/sentinel.ts` module scaffold

| Field | Value |
|---|---|
| Parent Story | 2.5.1.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Waves 2.1.1–2.3.1 complete; `@upstash/redis` package added to `apps/web` |
| Deliverables | `apps/web/src/lib/memory/sentinel.ts` — skeleton with `runSentinel(userId, messageText, role)` export |

**Acceptance Criteria:**
- `runSentinel` is `async` and exported.
- Top-level try/catch: any unhandled error logs `{ level: 'error', source: 'sentinel', userId, error }` and returns without rethrowing.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` read from `process.env`; Upstash Redis client instantiated lazily (on first call, not at module load — avoids breaking builds in environments without the vars).
- `.env.example` updated with `UPSTASH_REDIS_REST_URL=` and `UPSTASH_REDIS_REST_TOKEN=`.

#### Task 2.5.1.1.2 — Wire Sentinel trigger into `engine.ts`

| Field | Value |
|---|---|
| Parent Story | 2.5.1.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.5.1.1.1 |
| Deliverables | Modified `apps/web/src/lib/chat/engine.ts` |

**Acceptance Criteria:**
- After `saveMessage(userId, conversationId, 'user', text)` completes: `runSentinel(userId, text, 'user')` is called without `await` (fire-and-forget).
- After `saveMessage(userId, conversationId, 'assistant', ...)` completes: `runSentinel(userId, assistantText, 'assistant')` called without `await`.
- If `assistantText` is empty (tool-only turn), Sentinel still fires with an empty string (Haiku will NOOP).
- No new `await` in the hot path; existing SSE send order unchanged.
- `npm run typecheck` clean.

---

### Story 2.5.1.2 — Sentinel extracts entities and facts from each message via Haiku

**As the** system,
**I want** the Sentinel to use Claude Haiku to extract structured entities and discrete facts from each chat message,
**So that** the context package is built from distilled knowledge rather than raw conversation text.

**Acceptance Criteria:**
- Haiku called with a structured extraction prompt; response parsed into: `{ entities: Array<{name, type, description}>, facts: string[] }`.
- Haiku model ID sourced from the `EXTRACTION_MODEL` constant in `lib/anthropic.ts` (not hardcoded in the sentinel).
- On Haiku error or JSON parse failure: logs the error; returns `{ entities: [], facts: [] }` (empty extraction, no crash).
- Extracted entities are upserted via `resolveEntity` + the entity-profile upsert logic from Wave 2.3.1 (reuse, don't duplicate).
- Extracted facts are passed through `classifyAndWriteMemory` from Wave 2.2.1 (Mem0 classification).
- Unit test: Haiku mocked; test extraction parsing for valid JSON, malformed JSON, and API error.
- >80% coverage on extraction logic.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4, UC-9, UC-36; Architecture §"Sentinel flow"

#### Task 2.5.1.2.1 — Implement Haiku extraction in `sentinel.ts`

| Field | Value |
|---|---|
| Parent Story | 2.5.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 2.5.1.1.1; Wave 2.2.1 (`classifyAndWriteMemory`); Wave 2.3.1 (`resolveEntity`) |
| Deliverables | `extractFromMessage(messageText, role)` function in `sentinel.ts` |

**Acceptance Criteria:**
- Haiku prompt is a structured system + user message pair requesting JSON output with `entities` and `facts` arrays.
- JSON extracted safely (`JSON.parse` in try/catch); on parse error returns empty extraction.
- Skips extraction if `messageText.trim().length < 10` (short-message guard) to avoid wasted Haiku calls.
- `role` parameter passed through for potential future routing (user vs assistant extractions can be weighted differently).
- No hardcoded model string; uses constant from `lib/anthropic.ts`.

#### Task 2.5.1.2.2 — Wire extracted entities/facts into memory writers

| Field | Value |
|---|---|
| Parent Story | 2.5.1.2 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.5.1.2.1 |
| Deliverables | Updated `runSentinel` flow in `sentinel.ts` |

**Acceptance Criteria:**
- For each extracted entity: call `resolveEntity`; if `none` result, call `upsertEntityProfile` (direct DB insert, not the tool handler); if `match`, update `mention_count` and `last_mentioned`.
- For each extracted fact: call `classifyAndWriteMemory(userId, fact)` — reuses the Mem0 writer from Wave 2.2.1.
- All writes wrapped in individual try/catch; one failure doesn't abort the others.

#### Task 2.5.1.2.3 — Unit-test extraction and write flow

| Field | Value |
|---|---|
| Parent Story | 2.5.1.2 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.5.1.2.2 |
| Deliverables | `apps/web/src/lib/memory/__tests__/sentinel.test.ts` — extraction tests |

**Acceptance Criteria:**
- Haiku client mocked; Supabase client mocked; embedding client mocked.
- Test: valid extraction JSON → entities upserted, facts classified.
- Test: malformed JSON → empty extraction, no crash.
- Test: Haiku API error → logs error, continues.
- Test: short message (< 10 chars) → extraction skipped.
- Coverage >80% on `extractFromMessage`.

---

### Story 2.5.1.3 — Sentinel assembles and writes a context package to Upstash with Supabase fallback

**As the** system,
**I want** the Sentinel to build a complete context package from the current memory stores and write it to Upstash (with a fallback write to Supabase),
**So that** the chat route can read a pre-built package in ~1ms rather than assembling it on every turn.

**Acceptance Criteria:**
- After extraction and memory writes, the Sentinel assembles a package by calling the same three-layer loaders from Wave 2.2.1 (`loadEntityProfiles`, `loadSemanticMemories` with the current message as query, `loadConversationSummaries`).
- Package structure: `{ entities: string, memories: string, summaries: string, built_at: string }` (the already-formatted blocks, not raw rows — ready for direct injection).
- Package written to Upstash key `sentinel:context:{userId}` using `SET ... EX <ttl>` where TTL is sourced from a named constant (default 86400s / 24h); `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from env.
- Package simultaneously written to `sentinel_context.package` in Supabase (upsert on `user_id`); service client used (bypasses RLS for system writes).
- If Upstash write fails: logs `{ level: 'warn', event: 'sentinel_upstash_write_fail' }`; Supabase write still attempted.
- If both writes fail: logs `{ level: 'error', event: 'sentinel_write_fail_both' }`; returns without rethrowing.
- Unit test: Upstash client mocked; Supabase client mocked; assert package structure; assert both writes called; assert Supabase write still called when Upstash fails.
- >80% coverage on package assembly and write logic.

**Priority:** Critical
**Estimated hours:** 8h
**References:** Business Requirements Feature 4, UC-20, UC-21; Architecture §"Sentinel"; Architecture §"Cache (Upstash Redis)"; ADR-002

#### Task 2.5.1.3.1 — Implement package assembly in `sentinel.ts`

| Field | Value |
|---|---|
| Parent Story | 2.5.1.3 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.5.1.2.2; Wave 2.2.1 (all three loaders) |
| Deliverables | `assembleContextPackage(userId, queryText)` in `sentinel.ts` |

**Acceptance Criteria:**
- Calls `loadEntityProfiles`, `loadSemanticMemories(userId, queryText, 10)`, `loadConversationSummaries` from `lib/memory/context.ts`.
- Formats each into its respective block string (reuses formatters from Wave 2.2.1).
- Returns `SentinelPackage` typed object with `entities`, `memories`, `summaries`, `built_at` fields.
- On any loader error: that layer returns an empty string; assembly continues with available layers (partial package is still useful).

#### Task 2.5.1.3.2 — Implement Upstash write with TTL

| Field | Value |
|---|---|
| Parent Story | 2.5.1.3 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.5.1.3.1; `@upstash/redis` client available (Task 2.5.1.1.1) |
| Deliverables | `writePackageToUpstash(userId, package)` in `sentinel.ts` |

**Acceptance Criteria:**
- Uses `redis.set(`sentinel:context:${userId}`, JSON.stringify(package), { ex: SENTINEL_TTL_SECONDS })`.
- `SENTINEL_TTL_SECONDS` is a named constant (default 86400); not hardcoded in the set call.
- On Redis error: logs warning with error details; does NOT rethrow.
- Key format matches exactly `sentinel:context:{userId}` (no variations) — this is the contract that Wave 2.5.2 reads.

#### Task 2.5.1.3.3 — Implement Supabase fallback write

| Field | Value |
|---|---|
| Parent Story | 2.5.1.3 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.5.1.3.1 |
| Deliverables | `writePackageToSupabase(userId, package)` in `sentinel.ts` |

**Acceptance Criteria:**
- Uses service-role client (`createServiceClient`): `UPSERT INTO sentinel_context (user_id, package, built_at, updated_at) VALUES (...) ON CONFLICT (user_id) DO UPDATE SET package = $package, built_at = $built_at, updated_at = NOW()`.
- On Supabase error: logs error; does NOT rethrow.
- Service client used (not SSR client) — this is a system write, not a user-initiated write.
- Called regardless of Upstash write outcome (dual write, not fallback-on-failure).

#### Task 2.5.1.3.4 — Unit-test package assembly and write paths

| Field | Value |
|---|---|
| Parent Story | 2.5.1.3 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Tasks 2.5.1.3.1–2.5.1.3.3 |
| Deliverables | Tests added to `sentinel.test.ts` |

**Acceptance Criteria:**
- Package assembly: all three loaders mocked; assert package has correct fields and `built_at` is a valid ISO string.
- Upstash write: mocked Redis client; assert `set` called with correct key, serialized package, and TTL.
- Supabase write: mocked service client; assert upsert called.
- Upstash failure: Redis throws; assert Supabase write still called; no error propagated.
- Both fail: assert error logged; `runSentinel` returns cleanly.
- Coverage >80% on `sentinel.ts` write functions.

---

### Story 2.5.1.4 — Rapid-fire messages use the prior package without stale eviction

**As the** system,
**I want** the Sentinel to protect the previous package during a new build so rapid-fire user messages never serve an empty context,
**So that** the chat engine always has at least the last committed package available even when messages come faster than the Sentinel can rebuild.

**Acceptance Criteria:**
- Sentinel build is idempotent: if a package already exists in Upstash, it is overwritten only after a new package is successfully assembled — not cleared at the start of a build.
- If the Sentinel errors mid-build (Haiku or embedding failure) the existing Upstash package is preserved (not deleted).
- UC-21 scenario: two messages sent within 2 seconds — the second Sentinel run starts while the first is still in progress; the second run produces a valid package and writes it; both runs complete without corrupting the key.
- Unit test: two concurrent `runSentinel` calls (simulated via parallel test invocations); assert the final Upstash value is one of the two valid packages (no empty or corrupt state).

**Priority:** High
**Estimated hours:** 3h
**References:** Business Requirements UC-21; Architecture §"Sentinel" (rapid-fire fallback); ADR-002

#### Task 2.5.1.4.1 — Rapid-fire safety audit and test

| Field | Value |
|---|---|
| Parent Story | 2.5.1.4 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.5.1.3.2 |
| Deliverables | Audit notes in code comments; `sentinel.test.ts` — concurrent run tests |

**Acceptance Criteria:**
- Code review confirms the Sentinel never issues a `DEL` or `SET` with empty value before the new package is ready.
- The write is always `SET key newPackage EX ttl` — atomic in Redis; no read-then-delete-then-write pattern.
- Unit test: mocked Redis client; two concurrent `runSentinel` invocations; assert `set` called twice with non-empty values; no `del` calls.
- Comments in `sentinel.ts` document the "write-after-assemble, never before" invariant.

## Task Dependencies

```
Waves 2.1.1–2.4.1 (all complete)
  └─► 2.5.1.1.1 (sentinel.ts scaffold + Upstash client) ──► 2.5.1.1.2 (wire into engine.ts)
        └─► 2.5.1.2.1 (Haiku extraction) ──► 2.5.1.2.2 (wire writers) ──► 2.5.1.2.3 (tests)
              └─► 2.5.1.3.1 (package assembly)
                    ├─► 2.5.1.3.2 (Upstash write) ──► 2.5.1.3.4 (write tests)
                    └─► 2.5.1.3.3 (Supabase fallback write)
                          └─► 2.5.1.4.1 (rapid-fire safety test)
```

**Critical path:** scaffold → extraction → assembly → Upstash write → rapid-fire test.
**Parallelizable:** Upstash write (2.5.1.3.2) and Supabase write (2.5.1.3.3) can be developed in parallel after assembly (2.5.1.3.1).

## Definition of Done

- [ ] `runSentinel` fires (fire-and-forget) after both user and assistant messages are persisted.
- [ ] Sentinel never blocks or throws into the chat engine; all errors caught and logged.
- [ ] Haiku extraction parses entities and facts; empty extraction on API error (no crash).
- [ ] Extracted entities upserted to `entity_profiles`; extracted facts classified via Mem0.
- [ ] Context package assembled from all three memory layers.
- [ ] Package written to Upstash `sentinel:context:{userId}` with TTL.
- [ ] Package simultaneously written to `sentinel_context` (Supabase) as durable fallback.
- [ ] Upstash write failure does not prevent Supabase write.
- [ ] Rapid-fire scenario: existing package preserved until new one is ready; no corrupt state.
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` read from env; `.env.example` updated.
- [ ] Coverage >80% on all `sentinel.ts` functions.
- [ ] `npm run typecheck` clean; lint passes.
- [ ] No new `any` types; no secrets committed.

## Infrastructure Specifications

### Database

**Table:** `sentinel_context` (from Wave 2.1.1 schema):
- `id uuid PK`, `user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `package jsonb`, `built_at timestamptz`, `updated_at timestamptz`.
- Upsert on `user_id` conflict.
- Service-role bypass RLS policy: `CREATE POLICY "service_role_sentinel_context" ON sentinel_context FOR ALL TO service_role USING (true) WITH CHECK (true)`.

### API

No new HTTP routes in this wave. The Sentinel is a background library function triggered from within `engine.ts`.

### UI

No UI changes. The Sentinel operates entirely in the background.

### Testing

- Unit: `sentinel.ts` — all functions; Haiku, OpenAI, Upstash, Supabase clients all mocked; covers success, each failure mode, partial package, rapid-fire.
- Integration: `runSentinel` end-to-end against local Supabase + mocked Upstash; assert `sentinel_context` row upserted after a complete run.
- Coverage: >80% on `sentinel.ts`.
- Typecheck: `npm run typecheck` exits 0.

### Deployment

**New environment variables introduced:**

| Variable | Scope | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Server-only | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only | Upstash Redis authentication token |

Both added to `.env.example` and required in Vercel production environment.

### Monitoring

- Structured log per Sentinel run: `{ event: 'sentinel_complete', userId, entity_count, fact_count, upstash_ok: bool, supabase_ok: bool, duration_ms }`.
- Warn log on Upstash write failure; error log on both-write failure.
- Track Haiku token usage per extraction call for cost monitoring.
- Track total Sentinel build latency; target <5000ms per Architecture non-functional requirement.
- No new alerting rules in this wave; alert thresholds established in Wave 2.5.2 monitoring setup.

## Handoff Requirements

Wave 2.5.2 (integration contract — chat reads the package) may begin as soon as:
- `sentinel:context:{userId}` key is verifiably written to Upstash after a chat turn.
- `sentinel_context` table contains a valid package row after a full Sentinel run.
- `runSentinel` is exported from `lib/memory/sentinel.ts`.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Upstash account not provisioned / env vars missing | High | Low | Document setup in `CONTRIBUTING.md`; scaffold verifies env vars at instantiation |
| Haiku extraction produces hallucinated entities | Medium | Medium | Extraction prompt explicitly instructs extraction only (not inference); unit test validates prompt structure |
| Sentinel build takes >5s (embedding + Haiku latency stack) | Medium | Low | Steps run sequentially but async from chat; monitor `duration_ms`; short-circuit if message < 10 chars |
| Concurrent Sentinel runs create a race on the Upstash key | Low | Low | Redis `SET` is atomic; write-after-assemble pattern prevents empty writes; documented invariant |
| `sentinel_context` table missing service-role bypass policy | High | Low | Policy added in this wave's migration or confirmed in Wave 2.1.1 migration |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.5 scope; ADR-002
- `docs/architecture/_main/04-Architecture.md` — §"Sentinel", §"Cache (Upstash Redis)", §"AI Architecture", ADR-002, Appendix C (env vars)
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 4, UC-9, UC-20, UC-21, UC-36
- `apps/web/src/lib/chat/engine.ts` — trigger integration point
- `apps/web/src/lib/memory/writer.ts` — Mem0 writer (reused by Sentinel)
- `apps/web/src/lib/memory/entity-resolver.ts` — entity resolver (reused by Sentinel)
- `apps/web/src/lib/memory/context.ts` — three-layer loaders (reused by Sentinel)
