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
feature: "2.1"
wave: "2.1.1"
agents: []
tags: [coriven, memory, pgvector, embeddings, schema, migration, openai]
relateddocuments:
  - "docs/implementation/_main/epic-2-persistent-memory.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/02-Product-Plan.md"
---

# Wave 2.1.1: Memory Schema & Embedding Service

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 2.1.1 |
| Feature | 2.1 — Memory Schema & Embedding Service |
| Epic | 2 — Persistent Memory |
| Status | Planning |
| Scope | Enable pgvector; create the five memory tables with full RLS; implement the OpenAI embedding service; deploy the `match_memories` RPC |

**Wave Philosophy:** Scope-based — this wave is complete when the memory data layer is fully in place and the embedding service is independently testable, regardless of calendar time.

## Wave Goals

1. **Foundation for recall.** Deliver a production-ready schema (`entity_profiles`, `memories`, `user_context`, `conversation_summaries`, `sentinel_context`) that satisfies Architecture §14.2, with per-user RLS enforced on every table — directly enabling the Product Plan goal of cross-session recall (sister problem, Coke/Pepsi problem).
2. **Embedding service operational.** Ship a `lib/memory/embedding.ts` service wrapping OpenAI `text-embedding-3-small` that generates 1536-dim vectors; API key sourced from `OPENAI_API_KEY` env var — enabling the semantic retrieval that Product Plan Phase 2a requires.
3. **Semantic retrieval proven.** Deploy the `match_memories` Postgres RPC that performs cosine similarity search against `memories.embedding`, excludes superseded rows, and is reachable from application code — enabling context assembly in Wave 2.2.1.

## User Stories

### Story 2.1.1.1 — Memory tables exist with correct schema and RLS

**As the** system,
**I want** the five memory tables created with the exact fields described in Architecture §14.2 and per-user RLS enforced,
**So that** user memory data is isolated by owner and downstream features can be built on a stable schema.

**Acceptance Criteria:**
- `entity_profiles` exists with fields for type enum (person/place/project/thing/resource), `aliases text[]`, `last_mentioned timestamptz`, `mention_count int`, `recency_weight float`, `user_id`, `created_at`, `updated_at`.
- `memories` exists with `content text`, `embedding vector(1536)`, `superseded_by uuid` (self-ref nullable), `user_id`, timestamps.
- `user_context`, `conversation_summaries`, `sentinel_context` exist with appropriate fields and `user_id`.
- ivfflat index with `lists = 50` created on `memories.embedding`.
- RLS enabled on all five tables; policies enforce `user_id = auth.uid()`.
- `pgvector` extension enabled in the migration.
- Migration applied cleanly via `npx supabase db push`; rollback is safe.
- TypeScript types regenerated and committed (`apps/web/src/types/supabase.ts`).
- >80% unit test coverage of migration correctness assertions.

**Priority:** Critical
**Estimated hours:** 8h
**References:** Business Requirements Feature 4, Data Dictionary (Appendix B); ADR-001

#### Task 2.1.1.1.1 — Write and apply the memory schema migration

| Field | Value |
|---|---|
| Parent Story | 2.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 6h |
| Dependencies | Epic 1 deployed; Supabase project accessible |
| Deliverables | `supabase/migrations/<timestamp>_memory_schema.sql` |

**Acceptance Criteria:**
- `CREATE EXTENSION IF NOT EXISTS vector` included.
- `entity_profile_type` enum created (`person`, `place`, `project`, `thing`, `resource`).
- All five tables created with `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
- `memories.embedding vector(1536)` column present.
- `memories.superseded_by uuid REFERENCES memories(id)` nullable self-reference.
- `entity_profiles.aliases text[]` with `[]` default, `mention_count int DEFAULT 0`, `recency_weight float DEFAULT 1.0`, `last_mentioned timestamptz`.
- `sentinel_context.package jsonb` column for the pre-built Sentinel payload.
- `conversation_summaries.summary text`, `turn_range int4range` or equivalent range columns.
- ivfflat index: `CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)`.
- RLS `ENABLE ROW LEVEL SECURITY` plus SELECT/INSERT/UPDATE/DELETE policies for each table using `USING (user_id = auth.uid())`.
- Service-role bypass policy on `sentinel_context` for async Sentinel writes.
- `updated_at` trigger extended to `entity_profiles` and `memories`.
- Migration applies idempotently; `npx supabase db push` exits 0.

#### Task 2.1.1.1.2 — Regenerate and commit TypeScript types

| Field | Value |
|---|---|
| Parent Story | 2.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.1.1.1.1 complete |
| Deliverables | Updated `apps/web/src/types/supabase.ts` |

**Acceptance Criteria:**
- `npx supabase gen types typescript --linked` runs without error.
- Generated file reflects all five new tables and the `entity_profile_type` enum.
- TypeScript strict-mode check (`npm run typecheck`) passes.

#### Task 2.1.1.1.3 — Add memory-specific shared types to `packages/types`

| Field | Value |
|---|---|
| Parent Story | 2.1.1.1 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.1.1.1.2 |
| Deliverables | `packages/types/src/memory.ts` exported from `packages/types/src/index.ts` |

**Acceptance Criteria:**
- `EntityProfileType`, `EntityProfile`, `Memory`, `UserContext`, `ConversationSummary`, `SentinelContext` interfaces defined in strict TypeScript.
- `ToolName` union in `packages/types/src/tool.ts` extended with the five new memory tool names (placeholders; handlers land in Wave 2.3.1).
- No circular imports; `npm run typecheck` clean.

---

### Story 2.1.1.2 — OpenAI embedding service generates vectors for memory content

**As the** system,
**I want** a service that accepts a string and returns a 1536-dimensional embedding vector using OpenAI `text-embedding-3-small`,
**So that** new memories can be vectorized and stored for later semantic retrieval.

**Acceptance Criteria:**
- `lib/memory/embedding.ts` exports `generateEmbedding(text: string): Promise<number[]>`.
- Uses `OPENAI_API_KEY` from environment — never hardcoded.
- Returns a 1536-element array on success.
- Throws a typed `EmbeddingError` with a structured log entry on API failure.
- Batch variant `generateEmbeddings(texts: string[]): Promise<number[][]>` available for bulk use.
- Unit tests mock the OpenAI client and cover success, API error, and empty-string edge cases.
- >80% coverage on the embedding module.

**Priority:** Critical
**Estimated hours:** 5h
**References:** Business Requirements Feature 4, UC-36; ADR-006; Architecture Appendix C (`OPENAI_API_KEY`)

#### Task 2.1.1.2.1 — Implement embedding service

| Field | Value |
|---|---|
| Parent Story | 2.1.1.2 |
| Agent | Backend Engineer |
| Estimation | 4h |
| Dependencies | `openai` npm package added to `apps/web`; `OPENAI_API_KEY` env var documented in `.env.example` |
| Deliverables | `apps/web/src/lib/memory/embedding.ts`, `.env.example` updated |

**Acceptance Criteria:**
- `openai` client instantiated with `process.env.OPENAI_API_KEY` — throws at module load if missing.
- Model string `text-embedding-3-small` sourced from a named constant, not a literal in the call site.
- Single and batch embedding functions exported.
- Structured error logging on failure (log-and-rethrow pattern consistent with Architecture monitoring strategy).
- No secrets committed; `.env.example` has `OPENAI_API_KEY=your_key_here`.

#### Task 2.1.1.2.2 — Unit-test the embedding service

| Field | Value |
|---|---|
| Parent Story | 2.1.1.2 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.1.1.2.1 |
| Deliverables | `apps/web/src/lib/memory/__tests__/embedding.test.ts` |

**Acceptance Criteria:**
- OpenAI client mocked; no real API calls in tests.
- Tests cover: successful single embed returns 1536-element array; API error throws `EmbeddingError`; batch returns parallel arrays; empty string handled gracefully.
- Coverage report shows >80% on `embedding.ts`.

---

### Story 2.1.1.3 — `match_memories` RPC performs cosine semantic search excluding superseded rows

**As the** system,
**I want** a Postgres RPC `match_memories(query_embedding, match_user_id, match_count)` that returns the top-k semantically similar memories for a user,
**So that** context assembly in Wave 2.2.1 can retrieve relevant facts without surfacing overwritten information.

**Acceptance Criteria:**
- RPC deployed via migration; callable as `supabase.rpc('match_memories', {...})` from application code.
- Returns rows ordered by cosine similarity descending, limited to `match_count`.
- Excludes rows where `superseded_by IS NOT NULL`.
- Respects RLS — only returns rows for `match_user_id`.
- Integration test verifies: insert 3 memories (1 superseded) for user A and 1 for user B; query as user A returns the 2 non-superseded rows in similarity order; user B's row is absent.
- `NEXT_PUBLIC_APP_URL` not required for this story; no browser-side usage.

**Priority:** Critical
**Estimated hours:** 4h
**References:** Business Requirements Feature 4; Architecture §"Vector Store"; ADR-001

#### Task 2.1.1.3.1 — Write `match_memories` RPC migration

| Field | Value |
|---|---|
| Parent Story | 2.1.1.3 |
| Agent | Backend Engineer |
| Estimation | 3h |
| Dependencies | Task 2.1.1.1.1 (tables and ivfflat index in place) |
| Deliverables | `supabase/migrations/<timestamp>_match_memories_rpc.sql` |

**Acceptance Criteria:**
- `CREATE OR REPLACE FUNCTION match_memories(query_embedding vector(1536), match_user_id uuid, match_count int DEFAULT 10)` defined with `RETURNS TABLE(id uuid, content text, similarity float)`.
- Uses `<=>` (cosine distance) operator; orders by similarity ascending (lower distance = more similar).
- `WHERE user_id = match_user_id AND superseded_by IS NULL` guard in place.
- Function set `SECURITY DEFINER` with explicit `SEARCH_PATH` set (no SQL injection via schema).
- Migration applies without error.

#### Task 2.1.1.3.2 — Integration-test the RPC

| Field | Value |
|---|---|
| Parent Story | 2.1.1.3 |
| Agent | Backend Engineer |
| Estimation | 1h |
| Dependencies | Task 2.1.1.3.1 |
| Deliverables | `apps/web/src/lib/memory/__tests__/match-memories.integration.test.ts` |

**Acceptance Criteria:**
- Test seeds two users with memories including one superseded row; calls `match_memories` via the Supabase service client.
- Asserts: result count matches only non-superseded rows; no cross-user data leaked; ordering is by similarity.
- Runs against a local Supabase instance in CI.

## Task Dependencies

```
2.1.1.1.1 (migration: tables + indexes + RLS)
  └─► 2.1.1.1.2 (regenerate TS types)
        └─► 2.1.1.1.3 (shared types in packages/types)
  └─► 2.1.1.3.1 (match_memories RPC) ──► 2.1.1.3.2 (integration test)

2.1.1.2.1 (embedding service) ──► 2.1.1.2.2 (unit tests)

[2.1.1.1.x, 2.1.1.2.x, 2.1.1.3.x all converge as Wave 2.2.1 prerequisites]
```

**Critical path:** 2.1.1.1.1 → 2.1.1.3.1 (RPC needs the tables). The embedding service (2.1.1.2.x) is independent and can run in parallel.

## Definition of Done

- [ ] All five memory tables exist in production Supabase with the exact schema from Architecture §14.2.
- [ ] RLS policies verified: a query as user A cannot retrieve user B's memories (tested).
- [ ] ivfflat index with `lists = 50` present on `memories.embedding`.
- [ ] `match_memories` RPC deployed; integration test passes (superseded rows excluded; no cross-user leakage).
- [ ] `generateEmbedding` returns a 1536-element array; unit tests pass.
- [ ] `OPENAI_API_KEY` read from environment; `.env.example` updated.
- [ ] `packages/types` extended with memory types; `npm run typecheck` clean.
- [ ] No secrets committed; `.env.local` absent from version control.
- [ ] All new code passes lint; zero TypeScript errors in strict mode.
- [ ] Coverage >80% on `embedding.ts` and the RPC integration test passes.

## Infrastructure Specifications

### Database

**New tables (all `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`):**

| Table | Key Columns |
|---|---|
| `entity_profiles` | `id uuid PK`, `name text`, `type entity_profile_type`, `description text`, `aliases text[] DEFAULT '{}'`, `last_mentioned timestamptz`, `mention_count int DEFAULT 0`, `recency_weight float DEFAULT 1.0`, `user_id`, `created_at`, `updated_at` |
| `memories` | `id uuid PK`, `content text`, `embedding vector(1536)`, `superseded_by uuid REFERENCES memories(id)`, `source text`, `user_id`, `created_at`, `updated_at` |
| `user_context` | `id uuid PK`, `user_id UNIQUE`, `preferences jsonb DEFAULT '{}'`, `facts jsonb DEFAULT '{}'`, `updated_at` |
| `conversation_summaries` | `id uuid PK`, `user_id`, `conversation_id uuid`, `summary text`, `message_range int4range`, `created_at` |
| `sentinel_context` | `id uuid PK`, `user_id UNIQUE`, `package jsonb`, `built_at timestamptz`, `updated_at` |

**Enum:** `CREATE TYPE entity_profile_type AS ENUM ('person', 'place', 'project', 'thing', 'resource')`.

**Index:** `CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)`.

**RLS:** All tables `ENABLE ROW LEVEL SECURITY`; policies use `USING (user_id = auth.uid())`. `sentinel_context` additionally allows service-role bypass for async Sentinel writes.

**RPC:** `match_memories(query_embedding vector(1536), match_user_id uuid, match_count int DEFAULT 10) RETURNS TABLE(id uuid, content text, similarity float)` — cosine, excludes `superseded_by IS NOT NULL`.

**Migration names:** `<timestamp>_memory_schema.sql`, `<timestamp>_match_memories_rpc.sql`.

### API

No new HTTP routes in this wave. The embedding service and RPC are consumed internally by subsequent waves.

### UI

No UI changes in this wave.

### Testing

- Unit: `embedding.ts` — mock OpenAI client; success, error, batch, empty-string cases; >80% coverage.
- Integration: `match_memories` RPC — local Supabase; seed two users; assert supersession exclusion and cross-user isolation.
- TypeScript: `npm run typecheck` must pass with zero errors.
- Migration: `npx supabase db push` exits 0 in CI.

### Deployment

**New environment variables introduced:**

| Variable | Scope | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Server-only | Authenticate OpenAI embedding API calls |

Add to `.env.example`, Vercel project settings (production), and any local dev `.env.local` file.

### Monitoring

- Log structured errors from the OpenAI client (model, input length, error code) at `warn` level; let callers decide to continue or fail.
- Track embedding API latency per call in structured logs for cost visibility.
- No alerting rules in this wave; metrics baseline established for later Sentinel monitoring (Wave 2.5.1).

## Handoff Requirements

Wave 2.2.1 (Context Assembly) may begin as soon as this wave's Definition of Done is fully checked. Specifically:
- `match_memories` RPC callable via Supabase client.
- `generateEmbedding` importable from `@/lib/memory/embedding`.
- `entity_profiles`, `memories`, `user_context`, `conversation_summaries` tables present with RLS.
- `packages/types` memory types available.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| pgvector extension not enabled on the Supabase project | High | Low | First line of migration is `CREATE EXTENSION IF NOT EXISTS vector`; verify in Supabase dashboard pre-push |
| ivfflat index requires minimum row count for effective use | Low | High | Expected at initial deploy — index still created; performance degrades gracefully at low row counts |
| OpenAI API key invalid or quota exceeded during dev | Medium | Low | Unit tests mock the client; integration tests use a test key; structured error logging surfaces failures immediately |
| TypeScript types drift from actual schema | Medium | Low | Types auto-generated post-migration; `typecheck` in CI enforces alignment |

## Related Documentation

- `docs/implementation/_main/epic-2-persistent-memory.md` — Feature 2.1 scope
- `docs/architecture/_main/04-Architecture.md` — §14.2 data model, §"Vector Store", ADR-001, ADR-006
- `docs/architecture/_main/03-Business-Requirements.md` — Feature 4, UC-36, Appendix B data dictionary
- `docs/architecture/_main/02-Product-Plan.md` — Phase 2a deliverables
- `supabase/migrations/` — existing migration style reference
