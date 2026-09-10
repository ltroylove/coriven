---
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven"
epic: "9"
feature: "9.4"
wave: "9.4.1"
agents: [backend-specialist, frontend-specialist, quality-control]
tags: [coriven, chat, panel, open-surface, sse, deep-links, C6]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.4.1: Tool→Panel Bridge (Deep Links + Assistant-Opened Panels)

## Wave Overview
- **Wave ID:** Wave-9.4.1
- **Feature:** Feature 9.4 - Assistant–Workspace Integration
- **Epic:** Epic 9 - Experience Redesign — The Conversational Workspace
- **Status:** Planning
- **Scope:** Build shared contract **C6** — the `open_surface` tool→panel bridge. When the assistant uses a tool that touches a workspace surface, the panel opens/focuses to the right spot (assistant-opened panels), and the tool card in chat gains a static deep link ("View in Tasks") derived from the **C2** surface-registry mapping. UI-layer only: **no new tools, no tool-schema changes, no new backend capabilities.**
- **Wave Goal:** The assistant visibly *shows its work* — "create a task" or "show me my tasks" answers in chat **and** opens the matching panel surface, focused on the affected entity.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Shared-Contract Position

| Contract | Role in this wave |
|---|---|
| **C6** — `open_surface` bridge | **OWNED & BUILT here.** Exact event shape (verbatim from the contract): `\| { type: 'open_surface'; surface: SurfaceId; focusId?: string }` appended to the existing `SSEEvent` union in `apps/web/src/lib/chat/engine.ts` (current variants: `text_delta`, `tool_use`, `tool_result`, `context_building`, `done`, `error`). |
| **C2** — panel controller + surface registry | **CONSUMED unchanged.** The tool→surface mapping table lives in the C2 registry (built in Wave 9.1.1); this wave reads it, never redefines it. Client handler calls `usePanel().openPanel(surface, { focusId })`. Surfaces honoring `focusId` (scroll/highlight) is a C2 obligation on each surface. |
| **C4 / C8** — tokens + primitives | **CONSUMED.** Deep-link affordance on tool cards uses token-backed styles (no raw palette values post-9.2.2). |
| **C9** — command registry | Downstream consumer (9.3.1 navigate commands share the C2 mapping); no work here. |

## Wave Goals

1. Extend the `SSEEvent` union with the C6 `open_surface` variant and emit it from the chat engine for tools mapped in the C2 registry — at most **one** emission per assistant turn (no panel thrash).
2. Handle `open_surface` in the chat client: call `usePanel().openPanel(surface, { focusId })`; tolerate unknown event types so old/new clients never break on stream shape.
3. Render a static deep link on every mapped tool card ("View in Tasks", "Open review") from the C2 mapping — works from persisted history with **no backend involvement**.
4. Derive `focusId` (the created/updated entity id) from tool results best-effort, so the panel lands on the exact row.

**UX grounding (existing foundations — referenced, not created):** `docs/architecture/_main/05a-UX-Foundations.md` **Pass 1** (mental model: chief of staff who *acts* — the panel opening is the visible proof of delegation, correcting the "it's just a chatbot" misconception) and **Pass 5** (state design & feedback: tool success feedback within the streaming reply; immediate <100ms panel response to the event; AI-touched content stays labeled on the tool card).

## User Stories

### User Story 1: Assistant-opened panels (`open_surface` end-to-end)

**As a** Coriven user
**I want** the workspace panel to open on the relevant surface when the assistant acts ("show me my tasks" → Tasks panel opens alongside the answer)
**So that** I see the assistant working in its workspace without navigating myself

**Estimated hours:** 12

**Acceptance Criteria:**
- [ ] `SSEEvent` union in `engine.ts` includes exactly `| { type: 'open_surface'; surface: SurfaceId; focusId?: string }` (C6 verbatim); `SurfaceId` imported from the C2 registry module
- [ ] Engine emits `open_surface` only for tools present in the C2 mapping and only when the tool result is not an error; **one emission max per assistant turn** (last mapped successful tool wins, emitted immediately before `done`)
- [ ] `chat-pane.tsx` handles the event by calling `usePanel().openPanel(surface, { focusId })`; all other SSE handling is unchanged
- [ ] Unknown/unrecognized SSE event types are explicitly ignored by the client (forward-compatibility guard)
- [ ] No tool schemas, tool names, or `TOOL_REGISTRY` entries change; no new tools

**Priority:** High

---

### User Story 2: Tool-card deep links

**As a** Coriven user
**I want** every workspace-touching tool card in chat to carry a deep link ("View in Tasks", "Open review")
**So that** I can jump from any past conversation turn to the surface it affected — including from persisted history

**Estimated hours:** 8

**Acceptance Criteria:**
- [ ] `ToolCallCard` (`message.tsx`) renders a link for tools mapped in C2; unmapped tools (e.g. `save_memory`, `push_notification`) render no link
- [ ] Link is **static and client-derived** from the C2 mapping (surface → route) — it requires no SSE event and works on messages loaded from history
- [ ] Clicking the link opens the surface in the panel via `usePanel().openPanel(...)` (in-app navigation, no full page load), passing `focusId` when derivable from the persisted tool call
- [ ] Link label names the destination surface ("View in Tasks", "View in Goals", "Open in Email", "Open Today board", "View activity") — clickable-looks-clickable per UX Pass 3 conventions
- [ ] Styling uses design tokens (C4) — no raw palette values introduced

**Priority:** High

---

### User Story 3: Focus the right spot (`focusId`)

**As a** Coriven user
**I want** the opened panel to scroll to and highlight the exact task/goal the assistant just touched
**So that** the panel confirms *what* changed, not just *where*

**Estimated hours:** 12  *(revised +4 per compatibility report Finding 1 — this wave IMPLEMENTS focusId honoring, not just verifies it)*

**Acceptance Criteria:**
- [ ] A pure helper derives `focusId` from `(toolName, toolInput, toolResultContent)` best-effort: entity id from the result JSON for creates, `input.id`/`input.task_id` for updates; returns `undefined` (never throws) when not derivable — list tools open the surface with no `focusId`
- [ ] `focusId` is threaded through the SSE event and through tool-card deep links identically
- [ ] **This wave IMPLEMENTS `focusId` honoring in each C2-mapped list surface** (`tasks`, `goals`, `email`): `openPanel(surface, { focusId })` scrolls the matching row into view and applies a transient highlight. (The `overview` surface already honors it via `BoardRow.id` in 9.2.3; this wave covers the three list surfaces — per contracts doc C2, reconciliation Finding 1. It is NOT "verify only.")
- [ ] Highlight/scroll motion respects `motion-safe:` conventions (UX Pass 5 feedback timing; C4 motion tokens)

**Priority:** Medium

---

### User Story 4: Observability & regression safety

**As the** developer/operator
**I want** structured logs for every `open_surface` emission and regression coverage on the SSE stream shape
**So that** the bridge is debuggable and the union extension cannot silently break existing chat streaming

**Estimated hours:** 6

**Acceptance Criteria:**
- [ ] Engine logs one structured JSON line per emission: `{ event: 'open_surface_emitted', userId, toolName, surface, hasFocusId }` (mirrors existing `cross_context_*` log style)
- [ ] Integration tests assert stream ordering: `tool_use` → `tool_result` → (optional) `open_surface` → `done`
- [ ] Regression tests confirm all six pre-existing SSE variants stream and render exactly as before
- [ ] Test asserting **no** `open_surface` is emitted for unmapped tools or errored tool results

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: `open_surface` emitted after a mapped mutating tool
- **Endpoint:** `POST /api/chat`
- **Method:** POST (SSE response)
- **Test Data:** `{ messages: [user: "create a task to renew my passport"], conversationId }` with `create_task` enabled (mock Anthropic stream returning one `create_task` tool_use)
- **Expected Result:** SSE stream contains exactly one `data: {"type":"open_surface","surface":"tasks","focusId":"<task-uuid>"}` after the `tool_result` and before `done`
- **Verification:** Event order; `surface === 'tasks'` per C2 mapping; `focusId` equals the id in the tool result; single emission

### Test Case 2: One emission per turn on multi-tool responses
- **Endpoint:** `POST /api/chat`
- **Method:** POST (SSE response)
- **Test Data:** Mock stream where the assistant calls `list_tasks` then `create_goal` in one turn
- **Expected Result:** Exactly one `open_surface` event with `surface: "goals"` (last mapped successful tool wins)
- **Verification:** Count of `open_surface` events in the stream === 1; surface value

### Test Case 3: No emission for unmapped or failed tools
- **Endpoint:** `POST /api/chat`
- **Method:** POST (SSE response)
- **Test Data:** (a) `save_memory` call; (b) `create_task` returning `is_error: true`; (c) tool blocked by a locked constraint
- **Expected Result:** Zero `open_surface` events in all three streams; `done` still emitted
- **Verification:** Absence of the event; no change to error/constraint handling paths

### Test Case 4: Client handler + forward compatibility (component test)
- **Endpoint:** n/a (React Testing Library on `chat-pane.tsx` with a mocked `usePanel`)
- **Method:** n/a
- **Test Data:** Simulated SSE frames including `open_surface` and an unknown `{"type":"future_event"}`
- **Expected Result:** `openPanel('tasks', { focusId: 'abc' })` called once; unknown event ignored with no state corruption or thrown error
- **Verification:** Mock call args; message list unchanged by unknown events

## Infrastructure Specifications

### Testing (always)
- **Unit:** `deriveFocusId` helper (per-tool table-driven cases, malformed JSON, missing ids); emission-policy reducer (mapped/unmapped/error/multi-tool matrix). Jest/Vitest per existing `apps/web` test setup (`lib/jobs/__tests__` pattern → `lib/chat/__tests__`).
- **Integration:** SSE contract tests against `runChatEngine` with a mocked Anthropic stream and mocked handlers (Test Cases 1–3).
- **Component:** `chat-pane.tsx` handler + `ToolCallCard` deep-link rendering (Test Case 4; link presence/absence per tool name).
- **Type-level:** `npm run typecheck` gates that the union extension compiles across every `SSEEvent` consumer.

### UI
- `chat-pane.tsx`: `applySSEEvent` gains the `open_surface` branch (calls `usePanel().openPanel`) and an explicit default-ignore for unknown types.
- `message.tsx` / `ToolCallCard`: deep-link affordance in the card header row; token-backed (C4); `aria-label` names the destination ("View in Tasks"); keyboard-focusable with visible focus ring.
- Panel open/highlight transitions use C4 motion durations behind `motion-safe:` (UX Pass 5).

### API / Engine (small change only)
- `engine.ts`: extend `SSEEvent`; track last-mapped-successful tool through the tool-use loop; emit once before `send({ type: 'done', ... })`. No route changes, no request-shape changes, no persistence changes — `open_surface` is **transient** (never saved to `conversation_messages`; history relies on the static deep links instead).
- Shared mapping consumption: import the tool→surface map and `SurfaceId` type from the C2 registry module (owned by 9.1.1). Requirement on that module: the mapping data must be importable server-side (plain data, no React) — see Dependencies.

### Database
- **None.** No migrations, no schema changes, no new tables.

### Monitoring
- Structured JSON log `open_surface_emitted` (fields above) per emission — grep-able in Vercel logs alongside existing `cross_context_*` events.
- No new alerting; volume is bounded at ≤1 per chat turn.

## Technical Tasks

### Task 9.4.1.1.1: Extend `SSEEvent` union + engine emission logic
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Wave 9.1.1 delivered (C2 registry module with tool→surface map, importable server-side)
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/chat/engine.ts`: `SSEEvent` union extended with the exact C6 variant; loop tracks last mapped successful tool `{ surface, focusId }`; single emission before `done`
- Emission policy: mapped tool + `is_error === false` only; constraint-blocked and failed tools never emit
- Structured log `open_surface_emitted`

**Acceptance Criteria:**
- [ ] Union variant matches C6 byte-for-byte; `SurfaceId` imported (not redeclared)
- [ ] ≤1 emission per turn, ordered after the final `tool_result`, before `done`
- [ ] `npm run typecheck` clean

---

### Task 9.4.1.1.2: Client `open_surface` handler in chat-pane
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.4.1.1.1 (event shape final); Wave 9.1.1 (`usePanel()` context)
- **Priority:** High

**Deliverables:**
- `apps/web/src/components/chat/chat-pane.tsx`: `applySSEEvent` branch calling `usePanel().openPanel(event.surface, { focusId: event.focusId })`; explicit ignore of unknown event types
- `open_surface` never mutates the message list (it is not message content)

**Acceptance Criteria:**
- [ ] Panel opens/focuses on receipt; chat streaming continues uninterrupted
- [ ] Unknown event types are dropped without state churn or errors

---

### Task 9.4.1.1.3: Engine SSE integration tests
- **Agent:** quality-control
- **Estimation:** 3 hours
- **Dependencies:** Tasks 9.4.1.1.1, 9.4.1.1.2
- **Priority:** High

**Deliverables:**
- Integration tests covering Test Cases 1–3 (mapped, multi-tool, unmapped/error/constraint-blocked)
- Regression assertions on the six pre-existing SSE variants

**Acceptance Criteria:**
- [ ] All test cases pass; existing chat streaming tests remain green

---

### Task 9.4.1.2.1: Tool→link mapping helper (shared, client-safe)
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Wave 9.1.1 (C2 registry as the single mapping source)
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/surfaces/tool-links.ts` (or colocated with the C2 registry, per 9.1.1's layout): `getToolLink(toolName, input, resultContent): { surface: SurfaceId; label: string; focusId?: string } | null` — a thin projection over the C2 map plus the shared `deriveFocusId` helper; returns `null` for unmapped tools
- Unit tests: every C2-mapped tool yields a link; every unmapped registry tool yields `null`

**Acceptance Criteria:**
- [ ] Zero duplicated mapping data — reads the C2 registry export only
- [ ] Pure/isomorphic (usable by both `message.tsx` and `engine.ts`)

---

### Task 9.4.1.2.2: Deep-link affordance on `ToolCallCard`
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.4.1.2.1; Wave 9.2.2 (C8/C4 token-backed styling available)
- **Priority:** High

**Deliverables:**
- `apps/web/src/components/chat/message.tsx`: link rendered in the tool-card header row when `getToolLink(...)` is non-null; click calls `usePanel().openPanel(surface, { focusId })`
- Works identically for live-streamed and history-loaded messages (derives from persisted `tool_calls`)
- Accessible: labeled, keyboard-operable, visible focus ring; token-backed styles

**Acceptance Criteria:**
- [ ] Link appears for mapped tools only; correct label per surface
- [ ] History messages (page reload) show working links with no SSE involvement

---

### Task 9.4.1.3.1: `deriveFocusId` extraction helper
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None (pure function; parallel with 9.4.1.1.x)
- **Priority:** Medium

**Deliverables:**
- Pure helper: creates → id parsed from result content JSON; updates/snoozes → `input.id` / `input.task_id`; lists/briefing/review → `undefined`; malformed content → `undefined`, never throws
- Table-driven unit tests across all C2-mapped tools

**Acceptance Criteria:**
- [ ] Correct id for `create_task`, `update_task`, `create_goal`, `update_goal`, `set_goal_momentum`, `create_project`, `add_reminder`, `snooze_reminder`, `get_email_thread` (message id), `submit_for_approval` (approval id)
- [ ] Never throws on arbitrary input

---

### Task 9.4.1.3.2: `focusId` honoring verification across surfaces
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Tasks 9.4.1.1.2, 9.4.1.2.2; C2 surfaces honoring `focusId` (9.1.1 obligation)
- **Priority:** Medium

**Deliverables:**
- Manual + component verification matrix: each mapped surface scrolls/highlights on `openPanel(surface, { focusId })`
- Gap reports filed against Wave 9.1.1 for any surface not honoring `focusId` (fixing surfaces is C2 scope, not this wave's)

**Acceptance Criteria:**
- [ ] Matrix complete for `overview`, `tasks`, `goals`, `email`, `activity`
- [ ] Highlight respects `motion-safe:`

---

### Task 9.4.1.4.1: End-to-end QC + accessibility pass
- **Agent:** quality-control
- **Estimation:** 3 hours
- **Dependencies:** All previous tasks
- **Priority:** Medium

**Deliverables:**
- E2E script: "create a task…" in chat → panel opens on Tasks focused on the new row; "show me my goals" → Goals panel opens; reload → deep links still work
- Keyboard/screen-reader spot check on the new link affordance (aria-label, focus ring)

**Acceptance Criteria:**
- [ ] E2E flows pass on the development branch build
- [ ] No new axe-core violations on the chat pane

## Task Dependencies

```
9.4.1.3.1 deriveFocusId (pure, no deps) ──┐
                                          ├─> 9.4.1.1.1 engine emit ──> 9.4.1.1.2 client handler ──> 9.4.1.1.3 SSE tests
9.4.1.2.1 tool-link helper ───────────────┘                                   │
        │                                                                     │
        └─> 9.4.1.2.2 tool-card deep links ──────────────┬───────────────────┘
                                                          v
                                    9.4.1.3.2 focusId verification ──> 9.4.1.4.1 E2E QC
```

**Critical path:** 9.4.1.2.1/9.4.1.3.1 → 9.4.1.1.1 → 9.4.1.1.2 → 9.4.1.3.2 → 9.4.1.4.1.
**Parallel streams:** the deep-link stream (9.4.1.2.x) and the SSE stream (9.4.1.1.x) can proceed concurrently once the mapping helper exists.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope (owns changes to) |
|---|---|---|---|
| backend-specialist | 9.4.1.1.1, 9.4.1.3.1 | 9 | `apps/web/src/lib/chat/engine.ts`, `apps/web/src/lib/surfaces/tool-links.ts` (focusId helper half), `apps/web/src/lib/chat/__tests__/**` |
| frontend-specialist | 9.4.1.1.2, 9.4.1.2.1, 9.4.1.2.2, 9.4.1.3.2 | 16 | `apps/web/src/components/chat/chat-pane.tsx`, `apps/web/src/components/chat/message.tsx`, `apps/web/src/lib/surfaces/tool-links.ts` (link projection half) |
| quality-control | 9.4.1.1.3, 9.4.1.4.1 | 6 | test files only; no production-code ownership |

**Out of scope for everyone:** `apps/web/src/lib/chat/tools/registry.ts` (no tool changes — C6 rule), the C2 registry module contents (consume only), job files.
**In scope (added per compat report Finding 1):** minimal `focusId` scroll-into-view + transient highlight in the three list surfaces — the `tasks`, `goals`, and `email` panel home components (the row-list container accepts an optional `focusId` and scrolls/highlights). This lands after 9.2.2 refactors those surfaces (sequential — no parallel conflict). No structural changes to those surfaces beyond the focus affordance.

**Total: 31 hours** (stories: 12 + 8 + 8 + 6 = 34 story-level hours including verification slack; task-level sum 31 — the 3h delta is story-level integration buffer, flagged rather than padded into tasks).

## Dependencies

**Depends on (hard):**
- **Wave 9.1.1** — C2 panel controller (`usePanel`), surface registry **including the tool→surface mapping table**, and per-surface `focusId` honoring. Additional requirement surfaced by this wave: the mapping table must be exported as plain isomorphic data (importable from `engine.ts` server-side). If 9.1.1 shipped it client-only, that export split is a 9.1.1 follow-up, not a redefinition here.
- **Wave 9.2.2** — C8/C4 token-backed styling for the link affordance (soft-hard: the affordance can land with interim classes if 9.2.2 slips, then conform).

**Blocks:**
- **Wave 9.4.2** — proactive-in-chat cards deep-link/open surfaces via C6 (ownership table: C6 must exist before 9.4.2).
- **Wave 9.5.x** — responsive/WCAG audit covers the finished chat↔panel integration.

**External:** none (no new services, tools, or schema).

## Definition of Done

- [ ] All 4 user stories completed; all acceptance criteria met
- [ ] C6 event shape shipped exactly as specified in `epic-9-shared-contracts.md` (no drift; if drift were required, the contracts doc must be updated first and 9.4.2 flagged)
- [ ] Unit + integration + component tests written and passing; existing chat tests green
- [ ] No TypeScript/linter errors (`npm run typecheck`)
- [ ] No tool schemas or backend capabilities changed (diff-reviewed)
- [ ] Deep links verified working from persisted history after reload
- [ ] `open_surface_emitted` logs visible in dev
- [ ] PR from `development` branch flow; code reviewed; docs (this file) status updated

## Handoff Requirements

**For Wave 9.4.2:**
- C6 event + client handler live: proactive cards can call `usePanel().openPanel(...)` and reuse `getToolLink`-style deep-link rendering
- `deriveFocusId` and the tool-link projection helpers exported for reuse

**For other Features/Epics:**
- 9.3.1 (C9 palette): navigate commands and tool links share the same C2 mapping — no divergence introduced here
- Future Tauri tray: `open_surface` remains a web-client UI event; tray deep-linking would consume the same C2 routes

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|---|---|---|
| C2 mapping table not importable server-side | Med | Flag to 9.1.1 early (Task 9.4.1.1.1 dependency check on day one); worst case, engine imports a data-only re-export added in 9.1.1's module |
| Panel thrash on multi-tool turns | Med | Single-emission-per-turn policy (last mapped successful tool), tested in Test Case 2 |
| Auto-open feels intrusive for read tools mid-typing | Low-Med | Policy is centralized in one engine function; if user feedback says so, demote specific tools to link-only by editing the C2 map (one-line change) |
| `focusId` unparseable from free-text tool results | Low | Best-effort helper returns `undefined` — surface still opens; never blocks the stream |
| Union extension breaks an unnoticed `SSEEvent` consumer | Low | Typecheck gate + repo-wide search for `SSEEvent` consumers in 9.4.1.1.1 |

## Notes and Assumptions

- `open_surface` is **transient** — intentionally not persisted to `conversation_messages`; replaying history must not re-open panels. Deep links (Story 2) are the durable affordance.
- Emission policy "last mapped successful tool wins, once per turn" is this wave's design decision within C6's latitude ("emitted (optionally) after a `tool_result`"); it does not alter the contract shape.
- Surfaces honoring `focusId` is C2's obligation (contract line: "Surfaces must accept and honor it"); this wave verifies and files gaps, it does not modify surface internals.
- No estimates are fabricated beyond scope-derived task sizing; the 3h story-vs-task delta is explicit integration buffer.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§4.4 chat↔panel integration)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C6 owned; C2, C4, C8 consumed)
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` (Feature 9.4)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 1, Pass 5)

## Wave Retrospective

{To be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
