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
epic: "6"
feature: "7.4"
wave: "7.4.1"
agents: []
tags: [coriven, proactive, cross-context, chat, memory, goals, email, sentinel]
relateddocuments:
  - "docs/implementation/_main/epic-6-proactive-intelligence.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Wave 7.4.1: Cross-Context Queries

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 6.4.1 |
| Feature | 6.4 — Cross-Context Queries |
| Epic | 6 — Proactive Intelligence |
| Status | Planning |
| Scope | Enable the chat engine to answer questions that span tasks, goals, memory (entities + semantic memories), and email metadata (when Epic 5 is connected) in a single response; no new storage required — compose context across existing stores by extending the system prompt assembly and enabling coordinated tool calls |

**Wave Philosophy:** Scope-based — this wave is complete when a user can ask a question like "What's been happening with my gym project?" and the chat engine draws on tasks, goals, memory entities, and (if connected) email metadata to produce a unified answer — without requiring the user to specify which store to check — regardless of calendar time.

## Wave Goals

1. **Context composition spans all available stores.** The chat system prompt and context-loading path are extended so that a cross-context question activates relevant data from tasks, goals, entity profiles, semantic memories, and (conditionally) email metadata in a single chat turn — using coordinated tool calls, not a hand-rolled JOIN query.
2. **Chat engine coordinates multi-store tool calls correctly.** The existing tool-use loop (up to 10 turns) is sufficient for multi-step cross-context queries; the engine's system prompt explicitly tells Claude to combine data from multiple tools when answering holistic questions, and to prioritize accuracy over speed (call `list_tasks`, `detect_patterns`, memory tools, and `search_email_metadata` when they are all enabled and relevant).
3. **Cross-context answers are accurate and do not fabricate.** The engine returns "I don't have information about that" rather than hallucinated data when a store is empty or a tool is disabled; email context is surfaced only when the Epic 5 integration is connected and the relevant tool is enabled in `tool_permissions`.

## User Stories

### Story 6.4.1.1 — System prompt directs Claude to compose cross-context answers

**As the** Chat Engine actor,
**I want** a system prompt that explicitly instructs Claude to combine data from multiple enabled tools when answering holistic questions about a goal, project, or person,
**So that** a user asking "What's been happening with my gym project?" gets a unified answer drawing on tasks, goals, memories, and email — not a response limited to whichever store Claude arbitrarily checks first.

**Acceptance Criteria:**
- The `buildSystemPrompt` function in `engine.ts` (or a dedicated context-assembly module) is updated to include a cross-context reasoning section explaining that holistic questions ("what's been happening with X", "tell me about Y", "catch me up on Z") require consulting multiple tools in sequence before answering.
- The prompt instructs Claude to use `list_tasks` (for task history), goal-related tools from Epic 4 (for goal status and momentum), memory tools from Epic 2 (entity profiles + semantic search), and `search_email_metadata` from Epic 5 (if enabled) when those tools are relevant to the question.
- The prompt explicitly prohibits fabricating data from stores that are disabled or empty.
- The instruction is concise (no more than 150 words added to the system prompt) to avoid token waste.
- The cross-context section is only injected when at least two store-types are enabled in `tool_permissions` for the user; for users with only task tools enabled, no change to behavior.

**Priority:** Critical
**Estimated hours:** 4h
**Business Requirements:** Feature 8 (cross-context); UC-42; Blueprint §12 intro

#### Task 6.4.1.1.1 — Extend system prompt with cross-context reasoning instructions

- **Parent Story:** 6.4.1.1
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Existing `buildSystemPrompt` in `apps/web/src/lib/chat/engine.ts`; Epic 2 memory tools; Epic 4 goal tools (must be registered to detect enabled count)
- **Deliverables:** Updated `apps/web/src/lib/chat/engine.ts` `buildSystemPrompt` function; updated `loadToolPermissions` to return a count of enabled store-types (tasks, goals, memory, email) alongside the tool list
- **Acceptance Criteria:** System prompt is extended only when two or more store-types are enabled; the cross-context instruction fits within 150 words; TypeScript strict-mode passes; existing task-only behavior is unchanged; the instruction references tool names that actually appear in the enabled tool list (no phantom tool names in the prompt).

---

### Story 6.4.1.2 — Multi-store tool orchestration works within the existing loop

**As the** Primary User,
**I want** Coriven to answer a question like "What's been happening with my gym project?" by combining task history, goal momentum, and memory in one response,
**So that** I get a complete picture without having to ask separate questions or specify which data source to check.

**Acceptance Criteria:**
- Given a question about a specific project or goal, the chat engine calls `list_tasks` (filtered by title or goal), a goal-detail tool (if Epic 4 is deployed), and a memory search tool (if Epic 2 is deployed) within the same turn's tool-use loop.
- The final assistant response synthesizes the results: task count and status, goal momentum, any relevant memories about the project or related entities.
- If Epic 5 email is connected and `search_email_metadata` is enabled, it is also called and email threads related to the query are mentioned in the response.
- The response does not hallucinate data from a store that returned empty results.
- The answer is produced within the existing 10-turn cap in `engine.ts`; no cap increase is required.
- The response is conversational and coherent — not a raw dump of tool results concatenated.

**Priority:** High
**Estimated hours:** 5h
**Business Requirements:** Feature 8 (cross-context); Blueprint §12 intro ("What's been happening with my gym project?")

#### Task 6.4.1.2.1 — Validate and harden multi-tool orchestration in the chat loop

- **Parent Story:** 6.4.1.2
- **Agent:** Backend Engineer
- **Estimation:** 5h
- **Dependencies:** Task 6.4.1.1.1; Epic 2 memory tools registered; Epic 4 goal tools registered; existing tool-use loop in `engine.ts`
- **Deliverables:** Integration test (`apps/web/src/__tests__/cross-context.test.ts`) that mocks tool results for tasks, goals, and memory and verifies the system prompt drives Claude to call all three; documented tool-call ordering guidelines in a code comment in `engine.ts`
- **Acceptance Criteria:** Integration test passes with a mocked Claude response that exercises multi-tool orchestration; the test verifies at minimum two different store-type tools are called in a single turn; real end-to-end smoke test (manually run) confirms a cross-context question produces a response that mentions both task and goal data; no regression to single-store behavior for task-only users.

---

### Story 6.4.1.3 — Email metadata is included in cross-context answers when Epic 5 is connected

**As the** Primary User (with Gmail integration active),
**I want** a question like "What's been happening with my gym project?" to also surface relevant email threads,
**So that** my answer is complete even when some context only exists in email.

**Acceptance Criteria:**
- When `search_email_metadata` is enabled in `tool_permissions` and Epic 5 is connected, the cross-context system prompt instructs Claude to call it alongside task and goal tools for holistic queries.
- The tool call uses keywords from the user's query (e.g., "gym") to filter `email_metadata` by subject or sender.
- Results surface as a "related emails" component in the chat response: sender, subject, urgency classification, and approximate date.
- If Epic 5 is not connected or `search_email_metadata` is disabled, this component is absent; no error is raised and the response is complete without email data.
- Email bodies are never fetched or surfaced in this tool call — only metadata (per the privacy invariant in Architecture §data-protection).

**Priority:** Medium (soft dependency on Epic 5)
**Estimated hours:** 4h
**Business Requirements:** Feature 8; Architecture email-privacy invariant

#### Task 6.4.1.3.1 — Add `search_email_metadata` to the cross-context tool suite

- **Parent Story:** 6.4.1.3
- **Agent:** Backend Engineer
- **Estimation:** 4h
- **Dependencies:** Epic 5 `email_metadata` table and integration; existing tool registry pattern; Task 6.4.1.1.1
- **Deliverables:** `search_email_metadata` tool entry in `registry.ts`; handler in `handlers.ts` querying `email_metadata` with keyword filter; `ToolName` type updated; `tool_permissions` seed for the new tool
- **Acceptance Criteria:** Tool queries `email_metadata` for the authenticated user filtered by a `query` string against subject/sender fields; returns at most 10 results ordered by date descending; email bodies are not fetched (handler queries `email_metadata` only, never `email_body`); handler returns empty array when no results; `is_error: true` on DB failure; tool is absent from system prompt when disabled in `tool_permissions`; RLS enforced.

---

### Story 6.4.1.4 — Cross-context answers are honest about missing or disabled data

**As the** Primary User,
**I want** Coriven to tell me clearly when it lacks data to answer a cross-context question,
**So that** I am never misled by a confident-sounding but fabricated answer.

**Acceptance Criteria:**
- When a cross-context question is asked and all relevant tools return empty results, the assistant response acknowledges the lack of data explicitly (e.g., "I don't have any tasks, goals, or emails related to your gym project yet").
- When a relevant tool (e.g., memory search) is disabled, the assistant does not pretend to have searched it; it optionally mentions "Enable memory tools to include that context."
- The assistant never constructs a plausible-sounding answer by interpolating across empty tool results.
- These behaviors are enforced by the system prompt instructions added in Task 6.4.1.1.1.
- Validated by a unit test that mocks all tools to return empty results and asserts the response contains no fabricated task or goal data.

**Priority:** High
**Estimated hours:** 3h
**Business Requirements:** AI-Specific Business Rule: "untrusted content cannot trigger actions"; by extension, the system must not fabricate trust-critical data

#### Task 6.4.1.4.1 — Write honesty-enforcement tests for cross-context queries

- **Parent Story:** 6.4.1.4
- **Agent:** Backend Engineer
- **Estimation:** 3h
- **Dependencies:** Task 6.4.1.1.1; Task 6.4.1.2.1 (test infrastructure)
- **Deliverables:** Test cases in `cross-context.test.ts` covering: (a) all tools return empty → response contains acknowledgment string; (b) memory tool disabled → system prompt does not mention memory results; (c) partial results (tasks found, goals empty) → response accurately reflects partial data
- **Acceptance Criteria:** All three test cases pass; tests use realistic mocked Claude responses; no test fabricates data in mock responses used as inputs; test file is part of the standard `npm test` run.

---

### Story 6.4.1.5 — Cross-context query performance is acceptable within the chat turn budget

**As the** Primary User,
**I want** cross-context queries to complete within a reasonable time frame,
**So that** a holistic question does not feel noticeably slower than a simple task query.

**Acceptance Criteria:**
- Multi-store tool calls within a single turn add no more than ~2 additional round-trips to the Anthropic API (one for the initial tool-call request, one for the synthesis response after results are fed back).
- Database queries in tool handlers complete within 500ms each under normal load (per-user data is always small).
- Total chat turn latency for a cross-context query is documented as expected (approximately: 1 × Sonnet call + N × tool executions + 1 × Sonnet synthesis call); no new latency budget is mandated beyond documenting the profile.
- The tool-use loop cap remains at 10 turns; no change required.
- Tool handlers do not perform N+1 queries; each handler fetches results in a single Supabase query with appropriate joins or separate efficient queries.

**Priority:** Low
**Estimated hours:** 2h

#### Task 6.4.1.5.1 — Review and document cross-context query latency profile

- **Parent Story:** 6.4.1.5
- **Agent:** Backend Engineer
- **Estimation:** 2h
- **Dependencies:** Task 6.4.1.2.1 (multi-store orchestration working)
- **Deliverables:** A comment block in `engine.ts` documenting the expected latency profile for a 3-store cross-context query; any N+1 fixes identified in existing tool handlers during the review
- **Acceptance Criteria:** Comment documents the turn structure (calls to Anthropic API, DB round-trips); any N+1 queries in memory or goal tool handlers are resolved before this wave closes; no new performance regressions vs. single-store queries.

---

## Task Dependencies

```
Epic 2 (memory tools: entity profiles, semantic search) — prerequisite
Epic 4 (goal tools: list_goals, goal detail) — prerequisite
Epic 5 (email_metadata, search_email_metadata) — soft prerequisite (Story 6.4.1.3 blocked; others proceed)

6.4.1.1.1  (extend system prompt)
    └─► 6.4.1.2.1  (multi-tool orchestration + integration test)
           └─► 6.4.1.4.1  (honesty-enforcement tests)
           └─► 6.4.1.5.1  (latency profile review)

6.4.1.3.1  (search_email_metadata tool) — independent; needs only Epic 5 and tool registry
```

**Critical path:** System prompt extension (6.4.1.1.1) → multi-tool orchestration (6.4.1.2.1) → honesty tests (6.4.1.4.1). Email tool and latency review parallelize after orchestration is done.

**Parallelizable:** 6.4.1.3.1 (email tool) can be implemented in parallel with 6.4.1.1.1 if Epic 5 is deployed.

## Definition of Done

- A user with tasks, goals, and memories enabled can ask "What's been happening with my gym project?" and receive a response that mentions task status, goal momentum, and any stored memories about the project — in a single conversational answer.
- All relevant tool handlers are called within the 10-turn loop; no regression to single-store behavior for existing users.
- All tool results return empty → assistant response explicitly acknowledges the lack of data; no fabrication.
- Email metadata is surfaced in cross-context answers when Epic 5 is connected and the tool is enabled; absent otherwise without error.
- Integration and unit tests pass: multi-tool orchestration test, honesty-enforcement test (three scenarios), latency profile documented.
- `search_email_metadata` tool is registered and seeded into `tool_permissions` for users with Epic 5 connected.
- TypeScript strict-mode passes with no new errors.
- System prompt addition is ≤ 150 words and does not appear for task-only users.

## Infrastructure Specifications

### Database

No new tables required. Cross-context queries compose data from existing stores:
- `tasks` + `task_reminders` (Epic 1, built)
- `entity_profiles`, `memories` (Epic 2)
- `goals`, `projects`, `life_areas` (Epic 4)
- `email_metadata` (Epic 5, conditional)
- `detected_patterns` (Wave 7.1.1)

**Query efficiency:** All tool handlers must use a single Supabase query with appropriate filters (no N+1 loops over results). Any handler that currently performs N+1 queries (e.g., fetching related entities per-memory) must be refactored before this wave closes.

**RLS:** All existing RLS policies apply. No new tables → no new RLS policies required.

### API

No new API routes required. Cross-context behavior lives entirely within the chat engine and tool handlers.

**`search_email_metadata` tool handler:**

| Attribute | Value |
|---|---|
| Input schema | `{ query: string, limit?: number }` |
| Auth | `userId` from chat engine session |
| Query | `email_metadata WHERE user_id = $1 AND (subject ILIKE $2 OR sender ILIKE $2)` |
| Result | Array of `{ id, subject, sender, urgency, received_at }` — no body fields |
| Limit | Default 10, max 20 |
| Privacy | Email bodies never fetched; `email_metadata` only |
| Errors | `is_error: true` on DB failure or Epic 5 not connected |

**Chat engine system prompt extension (injected when ≥ 2 store-types enabled):**

The injected section instructs Claude to: answer holistic questions about a goal, project, or person by calling all relevant enabled tools (tasks, goals, memory search, email metadata) before synthesizing; not fabricate results from disabled or empty stores; state explicitly when data is absent; treat tool results as the ground truth.

### UI

No new UI components required. Cross-context answers are rendered by the existing `Message` component in the chat interface. No changes to the chat UI are needed at this wave.

Accessibility: the existing `aria-live="polite"` region on the chat response area handles screen-reader delivery of cross-context answers; no new a11y work required.

### Testing

- **Unit — system prompt injection:** Verify the cross-context section is added when 2+ store-types are enabled; verify it is absent for task-only users; verify it does not reference tool names not in the enabled list.
- **Integration — multi-tool orchestration:** Mock Claude to return tool calls for `list_tasks`, a goal tool, and a memory tool in sequence; verify all three handlers execute; verify the final synthesized response is coherent (not raw JSON concatenation).
- **Integration — honesty enforcement (3 cases):**
  - All tools return empty → response contains acknowledgment; no invented data.
  - Memory tool disabled → system prompt section does not mention memory search in tool names offered.
  - Partial results → response accurately reflects partial data.
- **Integration — email tool:** Mock `email_metadata` rows; verify `search_email_metadata` handler returns metadata fields only; verify body fields are never present in the result.
- **Performance review:** Document turn count for a 3-store query; verify no N+1 in handlers.
- **Coverage target:** 80% line coverage on the system prompt injection logic and the `search_email_metadata` handler.

### Deployment

No new Vercel Cron entries — cross-context is a real-time chat feature.

**Environment variables:** No new env vars introduced; uses existing `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SUPABASE_*` keys.

**Epic 5 conditionality:** The `search_email_metadata` tool is registered in the registry but only injected into system prompts and tool calls when `tool_permissions.enabled = true` for the user — the same gating mechanism used for all other tools. No code-level Epic 5 feature flag required.

### Monitoring

- **Cross-context query detection:** Log a structured event when the system prompt cross-context section is injected and when more than one store-type tool is called in a single turn; enables measurement of how often users ask holistic questions.
- **Tool call distribution:** Track which tool combinations appear most frequently in multi-tool turns; surfaced in Vercel logs.
- **Hallucination signals (manual):** Owner reviews a sample of cross-context responses weekly during the first month to verify no fabrication is occurring; no automated signal exists at this stage.
- **Email tool call rate:** Count of `search_email_metadata` calls per day; useful for understanding Epic 5 integration engagement.

## Handoff Requirements

- Epic 2 memory tools (`search_memories`, `get_entity_profiles` or equivalent) must be registered in `TOOL_REGISTRY` and deployed before cross-context orchestration produces useful answers.
- Epic 4 goal tools (at minimum a `list_goals` or `get_goal` tool) must be registered before cross-context queries span goals.
- Epic 5 `email_metadata` table and the `search_email_metadata` tool (Task 6.4.1.3.1) are required only for Story 6.4.1.3; the rest of the wave proceeds without them.
- The `search_email_metadata` tool must be seeded into `tool_permissions` for users who have connected their Gmail integration (Epic 5 connection status determines default enablement).

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Epic 2 or Epic 4 tools not yet registered | High | Med | Wave 7.4.1 is blocked on those tool registrations; document as prerequisites; Stories 6.4.1.1 and 6.4.1.2 can be partially implemented against stubs |
| Multi-tool turn count exceeds the 10-turn cap | Med | Low | Three-store query requires ~2 Anthropic round-trips (tool call + synthesis); well within cap; monitor turn counts in production |
| Claude ignores cross-context system prompt instruction | Med | Low | System prompt extension is concise and direct; integration test validates the behavior against a mocked Claude response; real model behavior verified in manual smoke test |
| Email tool surfaces sensitive metadata | Med | Low | Handler is strictly limited to `email_metadata` table; no body fields; privacy invariant enforced at the handler level; reviewed in code review |
| Cross-context answers feel slow to users | Low | Med | Latency profile documented (Task 6.4.1.5.1); no new hard budgets imposed at this wave; real-time streaming still covers the user-facing wait |
| Hallucination in synthesized cross-context answer | High | Low | Honesty-enforcement instruction in system prompt; empty-result tests; manual spot-check monitoring in first month |

## Related Documentation

- Epic: `docs/implementation/_main/epic-6-proactive-intelligence.md` — Feature 7.4
- Architecture: `docs/architecture/_main/04-Architecture.md` — Chat Engine, Tool Registry, data model (§14)
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` — Feature 8, AI-Specific Business Rules
- UX: `docs/architecture/_main/05-User-Experience.md` — AI transparency, explainability, error recovery
- Blueprint: `docs/planning/2026-06-24-coriven-master-blueprint.md` — §12 intro (cross-context), §6 (tool registry), §14
- Preceding waves: `docs/implementation/iterations/wave-7.1.1-pattern-detection.md`, `wave-7.2.1-stale-goal-nudges.md`, `wave-7.3.1-weekly-review.md`
