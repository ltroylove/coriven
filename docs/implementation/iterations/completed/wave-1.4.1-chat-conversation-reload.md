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
epic: "1"
feature: "1.4"
wave: "1.4.1"
agents: []
tags: [coriven, chat, conversation-history, reload, ux, frontend]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/architecture/_main/04-Architecture.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 1.4.1: Chat Conversation Reload

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 1.4.1 |
| Feature | 1.4 — Chat Conversation Reload |
| Epic | 1 — Foundation Closeout |
| Status | Planning |
| Scope | Load prior `conversation_messages` into the chat UI on page refresh, so conversations persist across browser sessions. |
| Wave Goal | On any page load, the chat pane displays the full prior conversation for the active `conversation_id` before the user can type, giving the owner a continuous conversation experience rather than a fresh slate every visit. |

**Wave Philosophy:** Scope-based — this wave closes when prior conversation history loads correctly on refresh, not on a schedule.

## Wave Goals

1. The chat pane displays all prior messages for the active `conversation_id` on mount, with a loading skeleton shown while the server action fetches history — satisfying Business Requirements Appendix D item 3 and UX Pass 5 (State Design: Chat loading state).
2. Tool-use blocks (tool calls and tool results) stored in `conversation_messages` are rendered correctly in the history view, not stripped — preserving the full fidelity of the conversation record per Architecture §"Frontend."
3. The history load path is covered by a unit test and is accessible (WCAG 2.1 AA: chat history is keyboard-navigable and screen-reader-compatible, per UX §"Accessibility Design").

## User Stories

---

### Story 1.4.1.1 — Conversation History Loads on Refresh

**As the** owner,  
**I want** my prior chat messages to appear when I refresh or return to the chat page,  
**So that** I can pick up exactly where I left off without re-explaining context.

**Reference:** Business Requirements Appendix D item 3; Architecture §"Frontend"; UX Pass 5 (Chat states: loading → success).

**Priority:** High  
**Estimated hours:** 5

**Acceptance Criteria:**
- On page load, the chat pane shows a loading skeleton (or equivalent non-blank state) while history is being fetched.
- After fetching, all messages previously sent in the active `conversation_id` appear in chronological order.
- User messages appear with user styling; assistant messages appear with assistant styling — matching the live-stream rendering.
- The chat input is disabled while history is loading and enabled after.
- An empty conversation shows the existing empty-state prompt ("Ask me to create tasks…"), not a blank screen.
- History does not duplicate messages that arrive via the SSE stream in the same session.

---

#### Task 1.4.1.1.1 — Verify and Harden `getChatHistory` Server Action

| Field | Value |
|---|---|
| Parent Story | 1.4.1.1 |
| Agent | backend-specialist |
| Estimation | 2h |
| Dependencies | None |
| Deliverables | Verified or updated `apps/web/src/app/actions/chat.ts` `getChatHistory` function |

**Acceptance Criteria:**
- `getChatHistory` queries `conversation_messages` ordered by `created_at` ascending, filtered to `user_id = auth.uid()` and `conversation_id = input`.
- The function returns an empty array (not an error) for unauthenticated calls — the `ChatPane` handles empty gracefully.
- The 200-message `limit` is present and documented (prevents unbounded fetches).
- `npm run typecheck` exits 0 with no changes to the return type `ChatMessage[]`.
- Existing `tool_calls` column content is preserved in the returned rows (even if not yet rendered — Story 1.4.1.2 handles rendering).

---

#### Task 1.4.1.1.2 — Wire History Load into `ChatPane` Mount

| Field | Value |
|---|---|
| Parent Story | 1.4.1.1 |
| Agent | frontend-specialist |
| Estimation | 3h |
| Dependencies | Task 1.4.1.1.1 |
| Deliverables | Updated `apps/web/src/components/chat/chat-pane.tsx` with confirmed history-load behavior |

**Acceptance Criteria:**
- `ChatPane` calls `getChatHistory` on mount using the resolved `conversation_id` (from `localStorage` or prop).
- `isLoadingHistory` state shows a loading indicator while the server action is in flight; input/send is disabled.
- After the server action resolves, `messages` state is populated with the returned history.
- The loading path is tested: a mock returning 3 messages populates the message list; a mock returning `[]` shows the empty state.
- No duplicate messages if the user sends a message immediately after history loads in the same session.
- `npm run typecheck` exits 0.

---

### Story 1.4.1.2 — Tool-Use Blocks Render Correctly in History

**As the** owner,  
**I want** tool calls and tool results from prior turns to be visible in the reloaded conversation,  
**So that** I can see what actions the assistant took in past sessions.

**Reference:** Architecture §"Frontend"; UX §"Component Library" (Message component renders tool actions taken); Business Requirements Feature 3 (tool calls persisted to `conversation_messages`).

**Priority:** Medium  
**Estimated hours:** 4

**Acceptance Criteria:**
- When `getChatHistory` returns a message that has `tool_calls` data, the rendered `Message` component shows the tool call (name and summary of input) in the assistant message — not just the text portion.
- Tool results are rendered inline under the tool call that produced them, matching the live-stream rendering.
- If `tool_calls` is `null` (text-only message), the message renders as text only — no regression.
- WCAG 2.1 AA: tool-call blocks have `aria-label` or descriptive text readable by a screen reader.

---

#### Task 1.4.1.2.1 — Extend `getChatHistory` to Return Tool-Call Content

| Field | Value |
|---|---|
| Parent Story | 1.4.1.2 |
| Agent | backend-specialist |
| Estimation | 2h |
| Dependencies | Task 1.4.1.1.1 |
| Deliverables | Updated `getChatHistory` that maps `tool_calls` JSONB column into the `ChatMessage` content array |

**Acceptance Criteria:**
- The server action reads the `tool_calls` column from `conversation_messages`.
- If `tool_calls` is non-null, the returned `ChatMessage` content array includes `ToolUseBlock` entries reconstructed from the stored JSON.
- The `ChatMessage` type from `@/components/chat/types` is satisfied — no type assertions that bypass the schema.
- `npm run typecheck` exits 0.
- Existing text-only messages (null `tool_calls`) continue to return correctly.

---

#### Task 1.4.1.2.2 — Render Tool Blocks in `Message` Component from History

| Field | Value |
|---|---|
| Parent Story | 1.4.1.2 |
| Agent | frontend-specialist |
| Estimation | 2h |
| Dependencies | Task 1.4.1.2.1 |
| Deliverables | Updated `apps/web/src/components/chat/message.tsx` that renders tool-use blocks from loaded history |

**Acceptance Criteria:**
- `Message` renders `tool_use` content blocks with the tool name and a summary of the input (e.g., "Used create_task").
- `Message` renders `tool_result` content blocks with the result summary inline.
- Rendering is consistent between live-streamed and history-loaded messages — same visual treatment.
- Each tool block has an `aria-label` such as "Tool used: create_task" for screen-reader compatibility.
- Visual treatment of tool blocks does not use color alone to convey meaning (WCAG 1.4.1).
- `npm run typecheck` exits 0.

---

### Story 1.4.1.3 — Accessibility and State Completeness

**As the** owner using keyboard navigation,  
**I want** the chat history and loading states to be fully keyboard-navigable and screen-reader-compatible,  
**So that** the chat pane meets WCAG 2.1 AA even after the history-reload change.

**Reference:** UX §"Accessibility Design" (WCAG 2.1 AA); UX Pass 6 hard constraint #7; Architecture §"Quality Attributes" (accessibility).

**Priority:** High  
**Estimated hours:** 3

**Acceptance Criteria:**
- The loading skeleton/indicator has an accessible `aria-busy="true"` or `role="status"` label.
- Loaded messages are within an `aria-live="polite"` region so a screen reader announces new content.
- All interactive elements (Send button, Stop button) have visible focus rings and accessible labels.
- Tab order flows logically: message list → composer → send button.
- `prefers-reduced-motion` is respected — the loading animation is suppressed when the user prefers reduced motion.

---

#### Task 1.4.1.3.1 — Accessibility Audit and Fixes for Chat Pane

| Field | Value |
|---|---|
| Parent Story | 1.4.1.3 |
| Agent | frontend-specialist |
| Estimation | 3h |
| Dependencies | Task 1.4.1.1.2, Task 1.4.1.2.2 |
| Deliverables | Accessibility fixes in `chat-pane.tsx`, `message.tsx`, `composer.tsx` (where needed); brief audit note |

**Acceptance Criteria:**
- Loading indicator has `role="status"` or `aria-busy`.
- Message list container has `aria-live="polite"`.
- Send and Stop buttons have `aria-label` attributes.
- Tab order is logical in keyboard testing.
- `prefers-reduced-motion` media query suppresses the blinking cursor animation.
- Manual keyboard-nav test passes: tab to composer, type, Enter to send, Escape to stop streaming.

---

### Story 1.4.1.4 — Unit Test Coverage for History Load Path

**As the** developer,  
**I want** the history-load flow covered by automated tests,  
**So that** future refactors do not silently break conversation reload.

**Reference:** Epic-1 Definition of Done (tests passing); Architecture §"Quality Attributes" (maintainability).

**Priority:** High  
**Estimated hours:** 3

**Acceptance Criteria:**
- A unit test covers `ChatPane` mount behavior: mock `getChatHistory` returns 3 messages → `messages` state is populated.
- A unit test covers the empty-conversation case: mock returns `[]` → empty-state UI renders.
- A unit test covers the loading state: before `getChatHistory` resolves → loading indicator is visible; after → indicator is gone.
- Tests pass in `npm test`.
- No new `any` casts introduced beyond what pre-exists.

---

#### Task 1.4.1.4.1 — Write Unit Tests for `ChatPane` History Load

| Field | Value |
|---|---|
| Parent Story | 1.4.1.4 |
| Agent | quality-control |
| Estimation | 3h |
| Dependencies | Task 1.4.1.1.2 |
| Deliverables | `apps/web/src/components/chat/__tests__/chat-pane.test.tsx` |

**Acceptance Criteria:**
- Three test cases as described in Story 1.4.1.4 acceptance criteria.
- Tests use React Testing Library (or the project's existing test utilities).
- `getChatHistory` is mocked at the module level — no real Supabase calls in unit tests.
- All three tests pass in `npm test`.
- `npm run typecheck` exits 0.

---

## Task Dependencies

```
Task 1.4.1.1.1 (verify getChatHistory)
    ├── Task 1.4.1.1.2 (wire into ChatPane)
    │       ├── Task 1.4.1.4.1 (unit tests)
    │       └── Task 1.4.1.3.1 (a11y audit)   ← also needs 1.4.1.2.2
    └── Task 1.4.1.2.1 (extend history for tool blocks)
            └── Task 1.4.1.2.2 (render tool blocks in Message)
                    └── Task 1.4.1.3.1 (a11y audit)
```

Tasks 1.4.1.1.2 and 1.4.1.2.1 can proceed in parallel after 1.4.1.1.1.

**Critical path:** 1.4.1.1.1 → 1.4.1.2.1 → 1.4.1.2.2 → 1.4.1.3.1 (longest chain: ~9h serial).

## Definition of Done

- [ ] Refreshing the chat page shows prior messages in correct chronological order.
- [ ] Tool-use blocks from prior turns render in the history view consistently with live-stream rendering.
- [ ] Loading skeleton is visible during history fetch; input is disabled while loading.
- [ ] Empty conversation shows the empty-state prompt, not a blank screen.
- [ ] `npm run typecheck` exits 0 across the monorepo.
- [ ] Unit tests for the history-load path pass in `npm test`.
- [ ] Accessibility audit passes: `aria-live`, `role="status"`, focus-visible, reduced-motion respected.
- [ ] Manual smoke test in production: refresh mid-conversation; prior messages appear.

## Infrastructure Specifications

### API

**Server Action: `getChatHistory(conversationId: string): Promise<ChatMessage[]>`**

| Field | Value |
|---|---|
| Location | `apps/web/src/app/actions/chat.ts` |
| Auth | `createAuthServerClient()` — returns `[]` if unauthenticated |
| Query | `conversation_messages` SELECT `id, role, content, tool_calls, created_at` WHERE `user_id = auth.uid()` AND `conversation_id = input` ORDER BY `created_at ASC` LIMIT 200 |
| Returns | `ChatMessage[]` with content array including text blocks and (if present) tool-use/tool-result blocks |
| Error handling | Returns `[]` on any error; does not throw to the client |

No new API routes. No schema changes. No new env vars.

### UI

**`ChatPane` component (`apps/web/src/components/chat/chat-pane.tsx`):**

| State | Behavior |
|---|---|
| `isLoadingHistory = true` | Loading skeleton or spinner; composer disabled; `aria-busy="true"` on container |
| History loaded, messages present | Message list rendered; composer enabled |
| History loaded, no messages | Empty-state prompt; composer enabled |
| Streaming (new message) | Appended to history; no duplication |

**`Message` component (`apps/web/src/components/chat/message.tsx`):**
- Handles `tool_use` blocks: render tool name + input summary with `aria-label="Tool used: {name}"`.
- Handles `tool_result` blocks: render result summary inline below the tool call.
- Existing text-block rendering is unchanged.

**UX references:**
- Implements UX Pass 5 Chat state design (loading → success → empty).
- Implements UX Pass 3 affordance: AI-generated content is identifiable (tool-use label).
- Implements UX Pass 6 hard constraint #7 (WCAG 2.1 AA).

### Testing

| Level | Approach | Target |
|---|---|---|
| Unit | `ChatPane` mount with mocked `getChatHistory` — 3 cases (messages, empty, loading) | All 3 pass |
| Unit | `Message` renders tool-use block correctly | Pass |
| Typecheck | `npm run typecheck` monorepo-wide | Exit 0 |
| Manual smoke | Refresh mid-conversation in production; history appears | Pass |
| Accessibility | Manual keyboard-nav + ARIA audit | WCAG 2.1 AA |

**Test framework:** Vitest + React Testing Library (or existing project test setup). Mock `@/app/actions/chat` at module level.

## Handoff Requirements

Epic 2 (Memory) requires:
- A stable, reloading chat UI — memory context injected into the conversation must persist across refreshes.
- The `ChatPane` history-load mechanism is the foundation for loading enriched conversation history (with Sentinel context) in later phases.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| `tool_calls` JSONB shape stored in DB differs from `ChatMessage` type | Medium | Low | Inspect an actual stored row before writing the mapping code in Task 1.4.1.2.1 |
| History load causes duplicate messages if SSE stream arrives before `getChatHistory` resolves | Medium | Low | Implement deduplication by message `id`; history always wins for already-persisted messages |
| `getChatHistory` 200-message limit causes truncation for power users | Low | Low | Acceptable for Phase 1; pagination can be added in a later wave |
| React Testing Library not yet installed in the web app | Medium | Low | Install as a dev dependency; it does not affect the production bundle |

## Related Documentation

- Epic: `docs/implementation/_main/epic-1-foundation-closeout.md`
- Architecture: `docs/architecture/_main/04-Architecture.md` (§"Frontend", Appendix D item 3)
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md` (§"Current System Limitations")
- User Experience: `docs/architecture/_main/05-User-Experience.md` (§"Component Library", §"Accessibility Design", Pass 5 state design)
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Pass 5 Chat state table, Pass 6 hard constraint #7)
