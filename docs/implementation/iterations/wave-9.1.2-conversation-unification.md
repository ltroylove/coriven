---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - coriven
epic: "9"
feature: "9.1"
wave: "9.1.2"
agents: [backend-specialist, frontend-specialist]
tags: [coriven, conversations, migration, rls, history-flyout, split-brain, epic-9]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.1.2: Conversation Unification + Server History

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 9.1.2 |
| Feature | 9.1 — Layout Inversion & Conversation Unification |
| Epic | 9 — Experience Redesign |
| Status | Planning |
| Scope | Create the `conversations` table (contract **C1**) with RLS + backfill migration; make the server the source of truth for conversation lifecycle (create-on-first-message, title, `updated_at`); replace the dual-localStorage split brain with one active-conversation store; ship the real history flyout (titles, timezone-correct times, search) |

**Wave Philosophy:** Scope-based — complete when one conversation model, persisted server-side, is shared by every entry point (panel chat, rail New chat, history flyout, and — by shape — the future tray), the two legacy localStorage keys have zero code references, and existing message history is backfilled into real conversation rows.

**Wave Goal:** Kill the split brain (design doc §1.1 #2, §4.3): one conversation, one store, everywhere — with server-persisted, listable, searchable history.

## Wave Goals

1. **Contract C1 built exactly as pinned.** `conversations` table with the exact C1 columns (`id`, `user_id`, `title`, `created_at`, `updated_at`, `pinned_at`, `archived_at`), RLS mirroring the message policies, backfill deriving one row per distinct `conversation_messages.conversation_id`, and an FK from `conversation_messages.conversation_id` → `conversations.id` **without** dropping the column's nullability.
2. **Server-owned lifecycle.** A conversation row is created (client-generated UUID honored) when its first message is persisted; `title` = first user message truncated; `updated_at` bumped on every new message; `listConversations()` server action returns `{ id, title, updated_at, pinned_at }[]` ordered `pinned_at desc nulls last, updated_at desc`.
3. **One client store.** A single active-conversation store `{ activeConversationId: string }` replaces `chat-panel-conversation-id` and `chat-tab-active-id`, with a one-time migration so no in-flight local chat is lost (epic risk mitigation).
4. **Real history.** The rail's History trigger (stubbed in 9.1.1) opens a flyout listing server-side conversations with relative, timezone-correct times (BL-004 utilities) and client-side search; selecting one switches the persistent chat to it.

## User Stories

### Story 9.1.2.1 — Conversations are persisted server-side with correct schema, RLS, and backfill

**As the** system,
**I want** a `conversations` table matching contract C1 exactly, with every existing conversation derived into it,
**So that** conversation history survives localStorage, is isolated per user, and rename/pin/archive are schema-ready without a second migration (design doc §8.2).

*Implements contract **C1** (conversations model) — owner: this wave; consumers: 9.1.1 (New chat), 9.3.1 (⌘K conversation search), 9.4.2 (proactive-in-chat).*

**Acceptance Criteria:**
- [ ] `conversations` exists with exactly: `id uuid PK` (client-generated UUIDs accepted — no server-side-only default dependency), `user_id uuid NOT NULL` FK → `auth.users(id)`, `title text` (nullable until first user message), `created_at timestamptz default now()`, `updated_at timestamptz default now()`, `pinned_at timestamptz null`, `archived_at timestamptz null`.
- [ ] RLS enabled; full CRUD limited to `auth.uid() = user_id`, mirroring the existing `conversation_messages` policies; table grants match project convention.
- [ ] Backfill: one row per distinct non-null `conversation_messages.conversation_id` — `title` = first user message content truncated (~80 chars), `created_at` = earliest message time, `updated_at` = latest message time; runs idempotently.
- [ ] After backfill, `conversation_messages.conversation_id` carries an FK to `conversations.id`; the column **remains nullable** (historical rows untouched per C1).
- [ ] An index supports the list ordering (`user_id, pinned_at desc nulls last, updated_at desc` access pattern).
- [ ] Migration applies cleanly via `npx supabase db push`; TypeScript types regenerated into `apps/web/src/types/supabase.ts` and committed.

**Priority:** Critical (blocks every other story in this wave; blocks 9.3.1 and 9.4.2)
**Estimated hours:** 5h

#### Task 9.1.2.1.1 — Create `conversations` migration (table + RLS + backfill + FK)
- **Parent Story:** 9.1.2.1
- **Agent:** backend-specialist
- **Estimation:** 4h
- **Dependencies:** None
- **Deliverables:**
  - `supabase/migrations/<timestamp>_create_conversations.sql` — table, RLS policies, grants, backfill (INSERT…SELECT with `ON CONFLICT DO NOTHING`), FK added after backfill, index.
- **Acceptance Criteria:**
  - [ ] Running the migration twice is safe; a DB with zero messages backfills zero rows without error.
  - [ ] Messages with null `conversation_id` are untouched and don't block the FK.

#### Task 9.1.2.1.2 — Regenerate and commit Supabase types
- **Parent Story:** 9.1.2.1
- **Agent:** backend-specialist
- **Estimation:** 1h
- **Dependencies:** Task 9.1.2.1.1
- **Deliverables:**
  - Updated `apps/web/src/types/supabase.ts` via `npx supabase gen types typescript --linked`; `npm run typecheck` clean.
- **Acceptance Criteria:**
  - [ ] `conversations` row/insert/update types available to server actions.

---

### Story 9.1.2.2 — The server owns conversation lifecycle: create, title, freshness

**As a** Coriven user,
**I want** every conversation I start to exist server-side automatically, titled from what I first said,
**So that** my history is real and listable everywhere (web now; tray later) without me managing anything.

*UX Foundations Pass 1: "an assistant that remembers" — the UI must stop forgetting mid-session; the system, not the user, keeps the ledger.*

**Acceptance Criteria:**
- [ ] When the chat API persists the first message of a conversation, a `conversations` row is upserted with that id (client-generated UUID honored per C1), owned by the authenticated user.
- [ ] `title` is set from the first **user** message (truncated ~80 chars) if currently null; subsequent messages never overwrite an existing title.
- [ ] Every persisted message bumps the conversation's `updated_at`.
- [ ] `listConversations()` server action returns `{ id, title, updated_at, pinned_at }[]` ordered `pinned_at desc nulls last, updated_at desc` (exact C1 shape — 9.3.1's palette consumes it unchanged); archived conversations (`archived_at` not null) are excluded.
- [ ] Upsert/bump is idempotent — a retried request or double-persist produces one row, no duplicate-key failures.

**Priority:** Critical
**Estimated hours:** 5h

#### Task 9.1.2.2.1 — Conversation upsert + title + `updated_at` in the message-persistence path
- **Parent Story:** 9.1.2.2
- **Agent:** backend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.1.2.1.2
- **Deliverables:**
  - Bounded change where `/api/chat` (`apps/web/src/app/api/chat/route.ts` / `apps/web/src/lib/chat/engine.ts` persistence path) writes `conversation_messages`: upsert `conversations` row, set title-if-null from first user message, bump `updated_at`. No changes to the SSE event union, tool schemas, or engine behavior otherwise (C6 extends `SSEEvent` later — leave it pristine).
- **Acceptance Criteria:**
  - [ ] Unit tests: first message creates row + title; second message bumps `updated_at` only; assistant-first edge case leaves title null until a user message arrives.

#### Task 9.1.2.2.2 — `listConversations()` server action
- **Parent Story:** 9.1.2.2
- **Agent:** backend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.1.2.1.2
- **Deliverables:**
  - `listConversations()` in `apps/web/src/app/actions/chat.ts` (alongside existing `getChatHistory`) with the C1 return shape and ordering; auth-scoped via the RLS client.
- **Acceptance Criteria:**
  - [ ] Unit tests: ordering with mixed pinned/unpinned; archived excluded; empty list for a new user.

---

### Story 9.1.2.3 — One active-conversation store replaces the split brain

**As a** Coriven user,
**I want** exactly one active conversation shared by every entry point,
**So that** asking the assistant something and then navigating never lands me in a different conversation — the assistant's UI stops "forgetting" mid-session (design doc §1.1 #2).

*Implements the C1 single active-conversation store `{ activeConversationId: string }`.*
*UX Foundations Pass 2: the conversation is one concept, not two.*

**Acceptance Criteria:**
- [ ] A single client store (context provider, one localStorage key) holds `{ activeConversationId: string }`; `ChatPane`, the rail's New chat, and the history flyout all read/write only this store.
- [ ] One-time migration on first load: adopt `chat-panel-conversation-id` if present (the docked panel was the primary daily surface), else `chat-tab-active-id`, else generate a new UUID; both legacy keys are then removed.
- [ ] Zero references to `chat-panel-conversation-id` or `chat-tab-active-id` remain anywhere in the codebase (including the 9.1.1 New-chat interim handler and the legacy `ChatClient`).
- [ ] New chat: generates a UUID, sets it active, `ChatPane` shows the empty state; the conversation row appears server-side on first message (Story 9.1.2.2) — no orphan rows for never-used new chats.
- [ ] Switching the active conversation loads that conversation's history via the existing `getChatHistory` path; streaming in-progress is not corrupted by a switch (abort or isolate cleanly).

**Priority:** Critical
**Estimated hours:** 5h

#### Task 9.1.2.3.1 — Conversation provider + legacy-key migration
- **Parent Story:** 9.1.2.3
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** None (parallel with backend tasks)
- **Deliverables:**
  - `apps/web/src/components/providers/conversation-provider.tsx` — `useActiveConversation()` returning `{ activeConversationId, setActiveConversation, newConversation }`; single storage key (`coriven-active-conversation`); one-time legacy migration + cleanup; mounted in `AppShell`'s provider stack (composition via the shell's existing provider slot — no re-edit of 9.1.1 internals).
- **Acceptance Criteria:**
  - [ ] Unit tests: migration precedence (panel key > tab key > new UUID); legacy keys deleted after adoption.

#### Task 9.1.2.3.2 — Rewire ChatPane, New chat, and retire legacy conversation code
- **Parent Story:** 9.1.2.3
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.1.2.3.1
- **Deliverables:**
  - `apps/web/src/components/chat/chat-pane.tsx` consumes `useActiveConversation()` (drop `PANEL_CONV_KEY` + `getOrCreatePanelConvId`); rail New-chat handler swapped to `newConversation()` (removing the 9.1.1 `TODO(9.1.2)` call site); `apps/web/src/app/(app)/chat/chat-client.tsx` and `apps/web/src/components/chat/conversation-list.tsx` reduced to remove `CHAT_ACTIVE_KEY` and localStorage conversation logic (files are deleted with the `/chat` route in 9.1.3 — this wave only guarantees no legacy-key references).
- **Acceptance Criteria:**
  - [ ] `ChatPane` behavior (history load, dedupe, streaming, a11y) otherwise unchanged; remount-on-switch via `key={activeConversationId}`.

---

### Story 9.1.2.4 — Conversation history is browsable from the rail flyout

**As a** Coriven user,
**I want** a summoned history flyout with my real conversations — titles, when they were last active in my timezone, and search,
**So that** I can return to any prior thread in seconds without permanent sidebar chrome stealing space from chat and the panel (design doc §4.3).

*UX Foundations Pass 2 (secondary surfaces one level in) and Pass 5 (designed loading/empty states).*

**Acceptance Criteria:**
- [ ] Clicking the rail History icon (9.1.1 stub) opens a flyout anchored to the rail listing conversations from `listConversations()` — title (or "New conversation" for untitled), relative last-activity time rendered timezone-correct via the existing BL-004 timezone utilities/provider.
- [ ] A search input filters the list client-side by title as the user types; no results shows a designed empty state; a brand-new user sees a designed first-run empty state pointing at New chat.
- [ ] Selecting a conversation sets it active (Story 9.1.2.3 store), closes the flyout, and the persistent chat shows that thread; the active conversation is visually indicated in the list.
- [ ] Flyout is focus-trapped, closes on `Esc` and outside-click, restores focus to the trigger, and is fully keyboard-navigable (existing a11y habits carried forward).
- [ ] Loading state is a skeleton/quiet indicator, not a spinner flash; list refreshes when reopened (fresh `updated_at` ordering after new messages).

**Priority:** High
**Estimated hours:** 6h

#### Task 9.1.2.4.1 — Build the history flyout component
- **Parent Story:** 9.1.2.4
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** Tasks 9.1.2.2.2, 9.1.2.3.1
- **Deliverables:**
  - `apps/web/src/components/chat/history-flyout.tsx` — list + search + empty/loading states + focus management; fills the 9.1.1 flyout shell; uses `useTimezone()` + timezone utils for relative times.
- **Acceptance Criteria:**
  - [ ] Component tests: render list, filter, select-sets-active, focus trap, Esc close.

#### Task 9.1.2.4.2 — Integration verification: one conversation everywhere
- **Parent Story:** 9.1.2.4
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Tasks 9.1.2.2.1, 9.1.2.3.2, 9.1.2.4.1
- **Deliverables:**
  - Integration test + manual checklist proving the epic success metric: send a message, navigate every surface, open history, switch conversations, New chat, reload — one conversation state throughout; backfilled pre-wave conversations appear in the flyout.
- **Acceptance Criteria:**
  - [ ] The design-doc failure case ("ask on /chat, click Tasks, docked chat has no memory of it") is impossible to reproduce.

## Task Dependencies

```
9.1.2.1.1 (migration) ─► 9.1.2.1.2 (types)
                              ├─► 9.1.2.2.1 (lifecycle upsert)
                              └─► 9.1.2.2.2 (listConversations)
9.1.2.3.1 (provider, parallel from start)
    └─► 9.1.2.3.2 (rewire ChatPane/New chat)
{9.1.2.2.2, 9.1.2.3.1} ─► 9.1.2.4.1 (flyout)
{9.1.2.2.1, 9.1.2.3.2, 9.1.2.4.1} ─► 9.1.2.4.2 (integration verification)
```

**Critical path:** migration → types → listConversations → flyout → verification. The client store (9.1.2.3.x) is a parallel stream that merges at the flyout.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| backend-specialist | 9.1.2.1.1, 9.1.2.1.2, 9.1.2.2.1, 9.1.2.2.2 | 10h |
| frontend-specialist | 9.1.2.3.1, 9.1.2.3.2, 9.1.2.4.1, 9.1.2.4.2 | 11h |

**Files/directories this wave may touch (exclusive scope):**
- `supabase/migrations/<timestamp>_create_conversations.sql` (new)
- `apps/web/src/types/supabase.ts` (regenerated)
- `apps/web/src/app/actions/chat.ts` (add `listConversations`; `getChatHistory` untouched)
- `apps/web/src/app/api/chat/route.ts` and/or `apps/web/src/lib/chat/engine.ts` — **bounded to the message-persistence path only** (conversation upsert/title/`updated_at`); the `SSEEvent` union and tool handling are off-limits (C6/9.4.1 territory)
- `apps/web/src/components/providers/conversation-provider.tsx` (new)
- `apps/web/src/components/chat/` — `chat-pane.tsx` (store rewire), `history-flyout.tsx` (new), `conversation-list.tsx` (legacy-key removal), `types.ts` (Conversation type alignment); **not** `message.tsx` / `composer.tsx` (9.1.3 and later waves own those)
- `apps/web/src/app/(app)/chat/chat-client.tsx` (legacy-key removal only — directory is deleted in 9.1.3)
- `apps/web/src/components/layout/rail.tsx` — **single-call-site edit only**: swap the New-chat interim handler and History stub for the provider/flyout
- Tests colocated with the above

## Dependencies

- **Depends on:** Wave 9.1.1 (shell, rail trigger mount points, provider composition slot).
- **Blocks:** Wave 9.1.3 (deletes the `/chat` route this wave defuses), Wave 9.3.1 (⌘K conversation search reads `listConversations()`/C1), Wave 9.4.2 (proactive messages post into the C1 active conversation).

## Definition of Done

- Contract C1 implemented exactly: table columns/RLS/backfill/FK-with-nullability, store shape `{ activeConversationId }`, `listConversations()` return shape and ordering.
- Migration applied to the linked project; types regenerated; `npm run typecheck` clean.
- Zero codebase references to `chat-panel-conversation-id` / `chat-tab-active-id` (grep-verified in CI or PR review).
- Pre-wave message history appears as titled conversations in the flyout (backfill verified against real data).
- Unit + component + integration tests passing per task ACs; the split-brain repro case demonstrably dead.
- Idempotency verified: double-persist / retried request creates no duplicate conversation rows.
- PR from `development`; wave demo (history flyout + cross-surface continuity) in the PR description.

## Infrastructure Specifications

### Database

**Table:** `conversations` (contract C1 — exact)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | Client-generated UUIDs accepted (matches existing `conversation_id` usage) |
| `user_id` | `uuid NOT NULL` | FK → `auth.users(id)` | RLS anchor (project convention) |
| `title` | `text` | nullable | Null until first user message; then first message truncated (~80 chars) |
| `created_at` | `timestamptz` | DEFAULT `now()` | Backfill: earliest message |
| `updated_at` | `timestamptz` | DEFAULT `now()` | Bumped on each new message; backfill: latest message |
| `pinned_at` | `timestamptz` | nullable | Schema-ready for pin (UI later) |
| `archived_at` | `timestamptz` | nullable | Schema-ready for archive (UI later) |

**RLS:** enable; `SELECT/INSERT/UPDATE/DELETE` gated by `auth.uid() = user_id` (mirror `conversation_messages` policies); grants per project convention.

**Backfill:** `INSERT INTO conversations (id, user_id, title, created_at, updated_at) SELECT` per distinct non-null `conversation_messages.conversation_id`, joined to the first user message for `title`, `min/max(created_at)` for timestamps, `ON CONFLICT (id) DO NOTHING`.

**FK:** after backfill, `ALTER TABLE conversation_messages ADD CONSTRAINT … FOREIGN KEY (conversation_id) REFERENCES conversations(id)`; column stays nullable.

**Index:** supporting `(user_id, pinned_at DESC NULLS LAST, updated_at DESC)` list ordering.

**Migration name:** `<timestamp>_create_conversations` via `npx supabase migration new`.

### API

**Server action — `listConversations()`** (`apps/web/src/app/actions/chat.ts`):

| Attribute | Value |
|---|---|
| Auth | Supabase SSR session; RLS-scoped client |
| Returns | `{ id, title, updated_at, pinned_at }[]` ordered `pinned_at desc nulls last, updated_at desc`; `archived_at` rows excluded |
| Errors | Empty array + logged error (UI shows empty state), consistent with existing action conventions |

**Chat persistence path (bounded change):** on message persist — `upsert conversations (id, user_id)`; `title = COALESCE(title, <first user message truncated>)`; `updated_at = now()`. Idempotent under retries. No SSE/tool/response-shape changes.

### Testing

- **Unit (backend):** backfill idempotency; title-once semantics; `updated_at` bump; `listConversations` ordering (pinned/unpinned mix), archived exclusion.
- **Unit (frontend):** legacy-key migration precedence + cleanup; provider state transitions; flyout filter logic.
- **Component:** history flyout (list/search/empty/loading/select/focus-trap/Esc).
- **Integration:** send message → conversation row exists with title; switch/new/reload continuity; backfilled data renders.
- **Coverage target:** ≥80% on the provider, flyout, and lifecycle/list actions.

### Deployment

- Migration applied via `npx supabase db push` **before** the web deploy (code tolerates the table existing with no readers; readers must not deploy before the table).
- No new environment variables. Normal PR → `development` flow.

### Monitoring

- Post-deploy check: count of `conversations` rows ≈ count of distinct non-null `conversation_messages.conversation_id` (backfill completeness).
- Watch for FK violations in Supabase logs during the first days (would indicate a persistence path writing message rows without the upsert).

## Handoff Requirements

**For Wave 9.1.3:**
- The `/chat` route's `ChatClient` is legacy-key-free and unreachable; 9.1.3 deletes `apps/web/src/app/(app)/chat/` and `conversation-list.tsx` outright.

**For other Features:**
- 9.3.1: `listConversations()` is the palette's conversation-search source (C1 shape frozen).
- 9.4.2: proactive jobs insert system-authored assistant messages against `conversations.id`; `updated_at` bump semantics defined here apply to those inserts too.
- Future Tauri tray: the store shape `{ activeConversationId }` + server list is the tray-compatible contract — no web-only assumptions (no window-scoped singletons beyond localStorage).

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Backfill mis-titles or misses conversations (odd first messages, assistant-first threads) | Low | Med | Title falls back to null → "New conversation" in UI; backfill is idempotent and re-runnable after a fix |
| In-flight local chat lost during store migration | Med | Low | One-time legacy-key adoption (panel key preferred) before any key deletion; C1/epic-mandated fallback |
| Double-write race creates duplicate conversation rows | Low | Low | PK upsert (`ON CONFLICT (id)`); unit-tested retry path |
| FK addition fails on orphaned `conversation_id` values | Med | Low | Backfill derives rows from the very same column first, in the same migration, so every non-null value has a parent |
| Persistence-path edit destabilizes chat streaming | Med | Low | Change bounded to post-persist bookkeeping; SSE/tool code untouched; integration test streams end-to-end |

## Notes and Assumptions

- **Legacy-key precedence decision:** `chat-panel-conversation-id` wins over `chat-tab-active-id` when both exist — the docked panel was the primary daily surface. Flagged here as the one C1 detail the contract leaves open.
- Rename/pin/archive get **schema only** in this wave (per C1); their UI is deliberately deferred.
- New chat creates no server row until the first message — avoids orphan rows and matches "client may generate id" in C1.
- `conversation_summaries` is untouched; it already keys by conversation and needs no change.

## Related Documentation

- Shared contracts (C1 owned here): `docs/planning/epic-9-shared-contracts.md`
- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` §4.3, §8.2
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` — Feature 9.1
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — Pass 1, Pass 2
