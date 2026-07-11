---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: epic
status: Completed
domain: implementation
product:
  - "coriven"
epic: "2"
priority: "CRITICAL"
branch: "epic/2-persistent-memory"
architecture: ["ADR-001", "ADR-002", "ADR-006"]
tags: [coriven, memory, sentinel, pgvector, entities]
relateddocuments:
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/04-Architecture.md"
---

# Epic 2: Persistent Memory

## Epic Overview
- **Epic ID:** Epic-2
- **Status:** Planning
- **Duration:** Medium (two stages: MVP then Sentinel)
- **Team:** Solo (owner/developer)
- **Priority:** CRITICAL (the core differentiator; gates the Constraint layer)

## Problem Statement

Coriven's entire thesis is memory that compounds — yet today it forgets everything between sessions. This Epic makes Coriven remember the people, projects, and preferences in the user's life and recall them at the right moment regardless of how long ago they were learned. It solves the three canonical problems from the blueprint: the **sister problem**, the **Coke/Pepsi problem**, and the **context cliff**. See Product Vision §1.3 and Architecture §"AI Architecture / memory pipeline."

## Goals and Success Criteria

Coriven remembers across conversations, the memory is user-visible and correctable, and (stage 2b) the context cliff is removed via the async Sentinel — all without ever blocking the chat response.

**Success Metrics:**
- Sister problem solved: teach "my sister Sarah lives in Denver" in session A → "I'm visiting my sister" in session B → Coriven mentions Denver and offers flights.
- Coke/Pepsi problem solved across many turns.
- Contradiction handled: "Sarah moved to Austin" supersedes Denver; superseded facts stop surfacing but remain queryable.
- `/memory` shows and can correct entities and memories.
- (2b) Chat reads the pre-built Sentinel package (integration contract verified); Upstash failure degrades gracefully and never blocks chat.

## Scope

### In Scope
- Enable pgvector; memory tables (`entity_profiles`, `memories`, `user_context`, `conversation_summaries`, `sentinel_context`).
- Embedding service (OpenAI `text-embedding-3-small`); semantic retrieval (`match_memories` RPC).
- Context assembly into the chat engine (synchronous MVP).
- Memory tools: `save_memory`, `recall_memories`, `upsert_entity`, `update_user_context`, `summarize_conversation`.
- `/memory` management page (entities + memories, view/edit/delete).
- (2b) Async Sentinel: Haiku extraction, Upstash cache + Supabase fallback, fires on user AND assistant messages; chat reads the package.

### Out of Scope
- Behavioral-constraint layer (Epic 3 — depends on this Epic).
- Bi-temporal / graph memory (deferred, blueprint §18.5); only `superseded_by` now.
- Tier-based memory-window enforcement (lands in Productization, Epic 7).

## Features & Waves

> The MVP/Sentinel split maps to waves within this Epic (per the "one epic, two waves" decision). Waves finalized in `/design-waves`.

### Feature 2.1: Memory Schema & Embedding Service
- **Scope:** Create the memory tables with RLS; enable pgvector; stand up the OpenAI embedding service and the `match_memories` RPC (excludes superseded rows).
- **Key Technical Approach:** SQL-first migration; `memories.embedding vector(1536)`, ivfflat `(lists=50)`; entity fields incl. `aliases[]`, `last_mentioned`, `mention_count`, `recency_weight`. See Architecture §"Vector Store" and §14 of the blueprint. Anti-hardcoding: `OPENAI_API_KEY` via env.
- **Requirements:** Business Requirements Feature 4; Data Dictionary.
- **Dependencies:** Epic 1 (deployed base).
- **Wave Planning:** Migration wave + embedding-service wave.

### Feature 2.2: Three-Layer Context Assembly (MVP)
- **Scope:** Assemble entity profiles (always-in-context, <~500 tokens) + top-k semantic memories + last 2–3 summaries into the chat system prompt, synchronously, before each Claude call.
- **Key Technical Approach:** Inline assembly in `lib/memory/` consumed by `lib/chat/engine.ts`; Mem0 ADD/UPDATE/DELETE/NOOP on writes; contradiction → `superseded_by`. See Architecture §"AI Architecture."
- **Requirements:** Business Requirements Feature 4 (sister/Coke acceptance).
- **Dependencies:** Feature 2.1.
- **Wave Planning:** Assembly wave + retrieval-tuning wave.

### Feature 2.3: Memory Tools
- **Scope:** Add `save_memory`, `recall_memories`, `upsert_entity`, `update_user_context`, `summarize_conversation` to the registry + handlers, gated by `tool_permissions`.
- **Key Technical Approach:** One handler per tool (JSON-Schema inputs) following the existing `tools/registry.ts` + `handlers.ts` pattern; entity resolution (exact → alias → fuzzy ≤2 → disambiguation). See Architecture §"Tool Registry & Handlers."
- **Requirements:** Business Requirements §"Tool Registry"; AI-specific rules (disabled tools never exposed).
- **Dependencies:** Features 2.1, 2.2.
- **Wave Planning:** One wave (tools + entity resolution).

### Feature 2.4: `/memory` Management Page
- **Scope:** A page with Entities and Memories tabs: list, edit, delete; show supersession history (not destructive).
- **Key Technical Approach:** Server components + client edit forms reusing UI patterns; corrections use supersession. See UX §"Memory" screen and UX Foundations Pass 5 (states).
- **Requirements:** Business Requirements UC-12/UC-13; transparency principle.
- **Dependencies:** Features 2.1–2.3.
- **Wave Planning:** One wave.

### Feature 2.5: The Sentinel (2b)
- **Scope:** Async extraction (Haiku), pre-built context packages to Upstash with `sentinel_context` Supabase fallback, firing on user AND assistant messages; chat reads the cache (~1ms). Main model stops seeing raw history.
- **Key Technical Approach:** Sentinel in `lib/memory/`; key `sentinel:context:{user_id}` (TTL); compression AND expansion; rapid-fire fallback to previous package. **Integration contract:** chat MUST read the package before generating — verified with an explicit test. Fail gracefully: Upstash down → Supabase → session context. See Architecture ADR-002 and §"Sentinel."
- **Requirements:** Business Requirements Feature 4 (2b acceptance), UC-20/UC-21/UC-36.
- **Dependencies:** Features 2.1–2.4; `UPSTASH_*` env.
- **Wave Planning:** Cache+fallback wave; extraction wave; integration-contract-test wave.

## Dependencies

**Prerequisites:** Epic 1 (deployed, reliable base).
**Enables:** Epic 3 (Behavioral Constraints), Epic 4 (Comms cross-context), Epic 6 (Proactive), tier memory-window (Epic 7).
**External Dependencies:** OpenAI (embeddings), Upstash Redis (Sentinel), Anthropic Haiku.

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Sentinel writes context chat never reads (dead code) | High | Med | Explicit integration-contract test (Feature 2.5) |
| Async complexity before value proven | Med | Med | Ship MVP (2.2–2.4) first; Sentinel as 2.5 |
| Retrieval surfaces noise / misses | Med | Med | Tune top-k; entity profiles always-in-context for reasoning |
| Second AI vendor (OpenAI) dependency | Low | Low | Accepted (ADR-006); isolate behind embedding service |

## Technical Considerations

Three-layer model + Sentinel; pgvector at per-user scale (ADR-001). No LLM in the chat read path — the Sentinel does extraction async. Graceful degradation is a hard requirement.

## Compliance and Security

Per-user RLS on all memory tables; memory is user-correctable (transparency). No third-party PII beyond the user's own notes. Tier-based memory windows deferred to Epic 7.

## Related Documentation
- Business Requirements: docs/architecture/_main/03-Business-Requirements.md (Feature 4)
- Architecture: docs/architecture/_main/04-Architecture.md (§AI Architecture, ADR-002)
- UX: docs/architecture/_main/05-User-Experience.md (Memory screen)

## Architecture Decision Records (ADRs)
- ADR-001: Supabase + pgvector from day one
- ADR-002: The Sentinel context architecture; MVP first
- ADR-006: OpenAI embeddings alongside Anthropic

---
**Template Version:** 2.0 (3-layer, embedded features)
