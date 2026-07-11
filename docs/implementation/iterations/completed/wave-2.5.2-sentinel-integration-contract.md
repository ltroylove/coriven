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
feature: "2.5"
wave: "2.5.2"
agents: []
tags: [coriven, sentinel, integration-contract, graceful-degradation, upstash, chat-engine]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/02-Product-Plan.md"
---

# Wave 2.5.2: Sentinel — Integration Contract & Graceful Degradation

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.5.2 |
| Feature | 2.5 — The Sentinel (2b) |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Migrate the chat engine to read the pre-built Sentinel package (~1ms Upstash fetch) instead of assembling context inline; implement three-tier graceful degradation (Upstash → Supabase → session context); verify the integration contract with an explicit automated test; retire the synchronous Wave 2.2.1 inline assembly from the hot path |

**Wave Philosophy:** Scope-based — this wave is complete when the chat engine provably reads the Sentinel package before calling Claude, with the integration-contract test green, and the graceful-degradation chain verified for every failure mode.

## Wave Goals

1. **Integration contract enforced and tested.** The chat engine MUST read the Sentinel package from Upstash before generating a response — and this is verified by an explicit automated integration-contract test that fails if the package is not consumed. This directly mitigates the highest-impact Epic 2 risk: "Sentinel writes context the chat never reads (dead code)."
2. **Chat read path is ~1ms.** By replacing synchronous inline context assembly with a pre-built Upstash fetch, the memory subsystem contributes ~1ms to chat latency (the Upstash REST call), not the ~300–500ms of inline embedding + DB queries — satisfying the Architecture non-functional performance target.
3. **Graceful degradation never blocks chat.** Upstash unavailable → read `sentinel_context` from Supabase → fall back to session-assembled context; every failure mode is tested and documented, satisfying UC-20 and the Architecture reliability requirement.

## User Stories

### Story 2.5.2.1 — Chat engine reads the Sentinel package from Upstash before each Claude call

**As the** primary user,
**I want** Coriven to use a pre-built memory package so its responses are informed by everything it knows about me without adding perceptible latency,
**So that** memory recall is fast and the chat experience remains snappy.

**Acceptance Criteria:**
- `runChatEngine` fetches `sentinel:context:{userId}` from Upstash before the first Claude API call; the returned package fields (`entities`, `memories`, `summaries`) are used to build the system prompt.
- The synchronous Wave 2.2.1 inline assembly calls (`loadEntityProfiles`, `loadSemanticMemories`, `loadConversationSummaries`) are removed from the chat hot path after this wave (they remain available for the Sentinel's own use and for testing).
- When a package is present: `buildSystemPrompt` receives the pre-built blocks; prompt construction is otherwise unchanged.
- When no package exists yet (first turn for a new user): falls back to inline assembly (graceful degradation, Story 2.5.2.2).
- Integration-contract test: see Story 2.5.2.3.
- Unit test: Upstash client mocked to return a valid package; assert the package fields are injected into the system prompt; assert `loadEntityProfiles` et al. are NOT called.
- >80% coverage on the package-read path in `engine.ts`.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4 (2b acceptance criteria); Architecture §"AI Architecture", §"Chat read path ~1ms"; ADR-002

#### Task 2.5.2.1.1 — Implement `readSentinelPackage(userId)` in `lib/memory/sentinel.ts`

| Field | Value |
|---|---|
| Parent Story | 2.5.2.1 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Wave 2.5.1 complete (Upstash client instantiated; key format established) |
| Deliverables | `readSentinelPackage(userId: string): Promise<SentinelPackage | null>` exported from `sentinel.ts` |

**Acceptance Criteria:**
- Reads `sentinel:context:{userId}` from Upstash using `redis.get(key)`.
- Parses the JSON value; validates it has `entities`, `memories`, `summaries`, `built_at` fields.
- Returns `null` if the key is missing, expired, or unparseable (so callers can fall back).
- On Upstash connection error: catches, logs `{ level: 'warn', event: 'sentinel_read_upstash_fail', userId, error }`, returns `null`.
- No side effects; pure read.

#### Task 2.5.2.1.2 — Replace inline context assembly in `engine.ts` with package read

| Field | Value |
|---|---|
| Parent Story | 2.5.2.1 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.5.2.1.1; Wave 2.2.1 inline assembly still in place |
| Deliverables | Modified `apps/web/src/lib/chat/engine.ts` |

**Acceptance Criteria:**
- `runChatEngine` calls `readSentinelPackage(userId)` before the first Claude call; if non-null, its fields are passed to `buildSystemPrompt`.
- `buildSystemPrompt` accepts an optional `MemoryContext` parameter (`{ entities?: string, memories?: string, summaries?: string }`); when provided, appends the pre-built blocks; when absent or empty, falls back to the inline assembly path.
- No calls to `loadEntityProfiles`, `loadSemanticMemories`, or `loadConversationSummaries` remain in `runChatEngine` when a package is returned (these calls move to the fallback path only).
- The Sentinel trigger (fire-and-forget after message persist) from Wave 2.5.1 remains in place.
- TypeScript strict-mode: no new `any` types.

#### Task 2.5.2.1.3 — Unit-test the package-read path

| Field | Value |
|---|---|
| Parent Story | 2.5.2.1 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.5.2.1.2 |
| Deliverables | Tests in `apps/web/src/lib/chat/__tests__/engine.test.ts` |

**Acceptance Criteria:**
- Mock Upstash to return a valid package: assert the package fields appear in `system`; assert inline loaders NOT called.
- Mock Upstash to return `null` (miss): assert fallback path runs inline assembly.
- Mock Upstash to throw (connection error): assert fallback path runs; no unhandled error propagated.
- Coverage >80% on the modified engine lines.

---

### Story 2.5.2.2 — Graceful degradation: Upstash miss → Supabase → session context

**As the** system,
**I want** the chat engine to have a three-tier fallback so memory enrichment degrades gracefully without ever blocking a response,
**So that** Coriven remains functional even when Upstash is unavailable, a new user has no package yet, or the Sentinel hasn't had time to build a package.

**Acceptance Criteria:**
- **Tier 1 (Upstash hit):** `readSentinelPackage` returns non-null → use it. ~1ms.
- **Tier 2 (Upstash miss/fail, Supabase hit):** `readSentinelPackage` returns null → try `readSentinelPackageFromSupabase(userId)` → if non-null and `built_at` is within the last 24h, use it. ~10ms.
- **Tier 3 (both miss):** Both return null → run inline context assembly (Wave 2.2.1 loaders). ~300ms.
- Chat response is returned in all three tiers; no tier blocks with an error.
- Structured log emitted for each tier: `{ event: 'context_source', source: 'upstash'|'supabase'|'inline', userId }`.
- Test: each tier exercised independently; assert correct source log emitted and correct context used.
- >80% coverage on the degradation chain.

**Priority:** Critical
**Estimated hours:** 6h
**References:** Business Requirements Feature 4 (2b), UC-20; Architecture §"Graceful degradation", §"Reliability"; ADR-002

#### Task 2.5.2.2.1 — Implement `readSentinelPackageFromSupabase(userId)`

| Field | Value |
|---|---|
| Parent Story | 2.5.2.2 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.5.2.1.1; Wave 2.1.1 (`sentinel_context` table) |
| Deliverables | `readSentinelPackageFromSupabase(userId: string): Promise<SentinelPackage | null>` in `sentinel.ts` |

**Acceptance Criteria:**
- Queries `SELECT package, built_at FROM sentinel_context WHERE user_id = $userId` using the service client.
- Returns `null` if no row or if `built_at < NOW() - INTERVAL '24 hours'` (stale package rejected).
- Validates the `package` jsonb has the expected fields before returning.
- On Supabase error: logs warning; returns `null`.
- Staleness threshold (`24h`) sourced from a named constant.

#### Task 2.5.2.2.2 — Implement the three-tier degradation chain in `engine.ts`

| Field | Value |
|---|---|
| Parent Story | 2.5.2.2 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Tasks 2.5.2.1.2, 2.5.2.2.1 |
| Deliverables | `loadMemoryContext(userId, queryText)` helper in `engine.ts` or a new `lib/memory/context-loader.ts` |

**Acceptance Criteria:**
- `loadMemoryContext` implements the three-tier chain: try Upstash → try Supabase → inline assembly.
- Returns a `MemoryContext` object regardless of which tier succeeded.
- Emits a structured log identifying which tier was used.
- `runChatEngine` calls `loadMemoryContext` once; result passed to `buildSystemPrompt`.
- No `await` chains that can hang: each tier has a timeout guard (e.g., 2s for Upstash, 5s for Supabase) implemented via `Promise.race` with a rejection; on timeout the next tier is tried.

#### Task 2.5.2.2.3 — Unit-test all three degradation tiers

| Field | Value |
|---|---|
| Parent Story | 2.5.2.2 |
| Agent | Backend Engineer |
| Estimation | 2h |
| Dependencies | Task 2.5.2.2.2 |
| Deliverables | Tests in `engine.test.ts` and/or `context-loader.test.ts` |

**Acceptance Criteria:**
- Tier 1: Upstash returns package → system prompt contains package content; log source='upstash'.
- Tier 2: Upstash null, Supabase returns package → system prompt contains package; log source='supabase'.
- Tier 3: both null → inline assembly runs; log source='inline'; chat is not blocked.
- Tier 2 stale (built_at >24h): Supabase returns null; falls through to Tier 3.
- Upstash timeout: Tier 1 times out; Tier 2 attempted.
- Coverage >80% on `loadMemoryContext`.

---

### Story 2.5.2.3 — Integration-contract test: chat MUST read the Sentinel package before generating

**As the** engineering team,
**I want** an explicit, named integration-contract test that fails if the chat engine generates a response without reading a Sentinel package (when one is available),
**So that** the highest-impact Epic 2 risk — "Sentinel writes context the chat never reads (dead code)" — is permanently caught by the test suite.

**Acceptance Criteria:**
- A test file named `sentinel-integration-contract.test.ts` contains a test named "chat engine reads sentinel package before generating" that:
  1. Seeds a `sentinel:context:{userId}` key in a mocked Upstash client with a known package containing a distinctive marker string.
  2. Runs `runChatEngine` with a mocked Anthropic client that records the `system` prompt it received.
  3. Asserts the marker string is present in the recorded `system` prompt.
  4. The test FAILS if the system prompt does not contain the marker (proving the package was not read).
- The test also verifies that when Upstash returns null and Supabase returns a package, the Supabase package's marker appears in the system prompt (fallback contract).
- The test file is in `apps/web/src/lib/chat/__tests__/` and is run as part of `npm test`.
- The test is documented with a comment: "This is the Sentinel integration-contract test. It exists to prevent the failure mode where the Sentinel writes a package that the chat engine never reads."

**Priority:** Critical
**Estimated hours:** 5h
**References:** Architecture §"Integration contract check", ADR-002; Business Requirements Feature 4 (2b acceptance criterion: "integration contract verified"); Epic 2 Risks table row 1

#### Task 2.5.2.3.1 — Write the integration-contract test

| Field | Value |
|---|---|
| Parent Story | 2.5.2.3 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 2.5.2.1.2 (engine reads package); Task 2.5.2.2.2 (degradation chain) |
| Deliverables | `apps/web/src/lib/chat/__tests__/sentinel-integration-contract.test.ts` |

**Acceptance Criteria:**
- Test 1 — "Upstash package injected into system prompt":
  - Mocked Upstash returns `{ entities: 'SENTINEL_MARKER_ENTITY', memories: '', summaries: '', built_at: new Date().toISOString() }`.
  - Mocked Anthropic records system prompt from the `messages.stream` call.
  - Assert `system.includes('SENTINEL_MARKER_ENTITY')`.
  - Test FAILS if assertion is false — this is the contract.
- Test 2 — "Supabase fallback package injected when Upstash misses":
  - Upstash mocked to return null; Supabase `sentinel_context` mocked to return `{ package: { entities: 'SUPABASE_MARKER', ... }, built_at: new Date().toISOString() }`.
  - Assert `system.includes('SUPABASE_MARKER')`.
- Test 3 — "inline assembly used when both miss":
  - Both mocked to return null; assert inline loaders are called (spy).
- Named comment block at top of file identifying the test's purpose.
- Test runs in <3s (all IO mocked).

#### Task 2.5.2.3.2 — Add contract test to CI gate

| Field | Value |
|---|---|
| Parent Story | 2.5.2.3 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.5.2.3.1 |
| Deliverables | CI configuration updated (or confirmation that `npm test` already includes the file) |

**Acceptance Criteria:**
- `npm test` runs `sentinel-integration-contract.test.ts` as part of the standard test suite.
- A failing integration-contract test blocks the CI build (not just a warning).
- Test output clearly names the failed assertion so future engineers understand what broke.

---

### Story 2.5.2.4 — End-to-end Epic 2 acceptance scenarios pass

**As the** primary user and developer,
**I want** all three canonical Epic 2 acceptance scenarios verified with the Sentinel-powered chat engine,
**So that** Epic 2 is fully closed out and the Sentinel is proven to improve recall over the synchronous MVP.

**Acceptance Criteria:**
- **Sister problem with Sentinel:** teach "my sister Sarah lives in Denver" in session A; Sentinel runs; start session B (Upstash has the package); say "I'm visiting my sister" → Coriven mentions Denver. Verified with a mocked Anthropic client that captures the system prompt.
- **Coke/Pepsi with Sentinel:** teach preference session A; session B system prompt (from Sentinel package) contains the preference.
- **Supersession with Sentinel:** "Sarah moved to Austin" in session A; Sentinel runs Mem0 UPDATE → Denver memory superseded; Austin in package; session B → Coriven says Austin.
- These scenarios are documented as acceptance-test cases in `sentinel-integration-contract.test.ts` or a companion file.
- All tests pass; `npm run typecheck` clean; lint passes.

**Priority:** Critical
**Estimated hours:** 4h
**References:** Epic 2 "Goals and Success Criteria"; Business Requirements Feature 4; Architecture §"Integration contract check"

#### Task 2.5.2.4.1 — Acceptance scenario tests

| Field | Value |
|---|---|
| Parent Story | 2.5.2.4 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | Task 2.5.2.3.1; all memory writers and readers in place |
| Deliverables | `apps/web/src/lib/chat/__tests__/sentinel-acceptance.test.ts` |

**Acceptance Criteria:**
- Three named test cases (sister, Coke/Pepsi, supersession) each:
  - Seed memory state (mock Supabase service client with fixture data).
  - Pre-load Upstash mock with a Sentinel package built from that state.
  - Run `runChatEngine` with the trigger message.
  - Assert the system prompt contains the expected contextual detail.
- Supersession test additionally asserts the old (superseded) memory does NOT appear in the system prompt.
- All three pass in CI; <5s total runtime.

## Task Dependencies

```
Wave 2.5.1 (complete — Sentinel writes packages)
  └─► 2.5.2.1.1 (readSentinelPackage) ──► 2.5.2.1.2 (engine reads package) ──► 2.5.2.1.3 (unit tests)
        └─► 2.5.2.2.1 (Supabase fallback reader)
              └─► 2.5.2.2.2 (three-tier chain) ──► 2.5.2.2.3 (degradation tests)
                    └─► 2.5.2.3.1 (integration-contract test) ──► 2.5.2.3.2 (CI gate)
                          └─► 2.5.2.4.1 (acceptance scenarios)
```

**Critical path:** package reader → engine integration → integration-contract test → acceptance scenarios.
**Bottleneck:** 2.5.2.1.2 (engine change) gates everything downstream.

## Definition of Done

- [ ] Integration-contract test (`sentinel-integration-contract.test.ts`) is green: chat engine demonstrably reads the Sentinel package before calling Claude.
- [ ] Upstash miss falls through to Supabase fallback; Supabase miss falls through to inline assembly; none block chat.
- [ ] Three-tier source logged on every chat turn (`upstash`/`supabase`/`inline`).
- [ ] Sister, Coke/Pepsi, and supersession acceptance scenarios pass with the Sentinel-powered engine.
- [ ] Synchronous inline assembly removed from the hot path when Sentinel package is available.
- [ ] Upstash timeout guard in place (no hung `await` in the hot path).
- [ ] Integration-contract test blocks CI on failure.
- [ ] `npm run typecheck` clean; lint passes; all new code in strict TypeScript.
- [ ] Epic 2 "Goals and Success Criteria" checklist fully satisfied.

## Infrastructure Specifications

### Database

No new tables. Reads `sentinel_context` (from Wave 2.1.1) via `readSentinelPackageFromSupabase`. Staleness threshold (`24h`) is a named constant, not hardcoded.

### API

No new HTTP routes. The read path is internal to `runChatEngine`.

### UI

No UI changes. The Sentinel is invisible to the user (UX Pass 6 — "Can be implied: the Sentinel/async memory machinery").

Pass 5 partial state: "Chat — Partial — Reply with stale context (Sentinel fallback) — invisible to user." This is satisfied by the graceful-degradation chain; the user sees no error in any tier.

### Testing

**Integration-contract test (mandatory):**

| Test | Input | Expected |
|---|---|---|
| Upstash package → system prompt | Mock Upstash returns package with marker | `system.includes(marker)` — FAILS if not |
| Supabase fallback → system prompt | Upstash null; Supabase returns package with marker | `system.includes(marker)` |
| Inline fallback | Both null | Inline loaders called; chat not blocked |

**Acceptance scenarios:**

| Scenario | Setup | Assertion |
|---|---|---|
| Sister problem | Entity "Sarah / Denver" in package | System prompt contains "Denver" |
| Coke/Pepsi | Memory "prefers Coke" in package | System prompt contains "Coke" |
| Supersession | Denver superseded; Austin in package | System prompt contains "Austin"; "Denver" absent |

**Degradation tests:**
- Upstash timeout: `Promise.race` triggers; Tier 2 tried.
- Supabase stale (>24h): returns null; Tier 3 runs.
- All tiers fail: inline assembly runs; no error to the user.

Coverage: >80% on all modified/new files. All tests run in CI; contract test is a blocking gate.

### Deployment

No new environment variables beyond `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (introduced in Wave 2.5.1).

### Monitoring

- Per-turn log: `{ event: 'context_source', source: 'upstash'|'supabase'|'inline', userId, latency_ms }`.
- Alert threshold: if `source='inline'` rate exceeds 5% of turns over 1 hour → alert (indicates Sentinel or Upstash degradation).
- Cache hit rate: `source='upstash'` / total turns — target >95% in steady state.
- Sentinel build latency histogram (`sentinel_complete.duration_ms`) — target p95 < 5000ms.
- Token cost tracking: Haiku extraction tokens per turn (from Wave 2.5.1 Sentinel runs) — visible in structured logs.
- Integration-contract check: the monitoring strategy in Architecture §"AI-Specific Monitoring" is satisfied by the explicit test in CI rather than a runtime metric.

## Handoff Requirements

When this wave's Definition of Done is checked:
- Epic 2 (Persistent Memory) is fully complete.
- Epic 3 (Behavioral Constraints) is unblocked.
- Epic 4 (Goal-Driven Organization / Comms cross-context) is unblocked — Sentinel provides the memory substrate.
- The integration-contract test remains in the test suite and must never be removed without owner approval.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Integration-contract test is too tightly coupled to implementation details and becomes brittle | Medium | Medium | Test via the public `runChatEngine` interface; mock at the Upstash client level, not at internal function level; documented contract in comments |
| Upstash timeout guard adds complexity; race condition in tests | Medium | Low | Use `Promise.race` with a reject-after timeout; test timeout path with mock that delays >2s |
| Inline assembly fallback (Tier 3) is slower than the Sentinel-powered path — user notices on first turn | Low | High | Accepted per ADR-002 "MVP first"; first-turn latency acceptable; Sentinel builds the package asynchronously after the first response |
| Removing inline assembly from hot path breaks tests that relied on it | Medium | Low | Inline assembly remains as the Tier 3 fallback; no code is deleted, only deprioritized in the call order |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.5 scope; Epic 2 risks row 1
- `docs/architecture/_main/04-Architecture.md` — §"Sentinel", §"Chat read path ~1ms", §"Integration contract check", ADR-002, §"Graceful degradation"
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 4 (2b acceptance), UC-20, UC-21
- `docs/architecture/_main/02-Product-Plan.md` — Phase 2b deliverables; Success Criterion 2
- `apps/web/src/lib/chat/engine.ts` — primary modification target
- `apps/web/src/lib/memory/sentinel.ts` — introduced in Wave 2.5.1
- `apps/web/src/lib/memory/context.ts` — inline assembly (Tier 3 fallback)
