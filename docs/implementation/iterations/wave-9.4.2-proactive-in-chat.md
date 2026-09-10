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
wave: "9.4.2"
agents: [backend-specialist, frontend-specialist, quality-control]
tags: [coriven, chat, proactive, briefing, nudges, weekly-review, dedupe, context-chips, C7]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.4.2: Proactive-in-Chat Delivery + Panel→Chat Context Chips

## Wave Overview
- **Wave ID:** Wave-9.4.2
- **Feature:** Feature 9.4 - Assistant–Workspace Integration
- **Epic:** Epic 9 - Experience Redesign — The Conversational Workspace
- **Status:** Planning
- **Scope:** Build the proactive half of shared contract **C7**: the daily briefing (every morning — design §8.3 resolved decision), stale-goal nudges, and the weekly review are posted as **system-authored assistant messages** into the active conversation in compact card form, with **idempotent dedupe** on `(user_id, briefing_date)` (and equivalent keys) so cron re-runs and multi-device opens never double-post. Strictly reuses Epic 7 job **output** (`daily_briefings` rows, `detected_patterns` rows) — **no new job logic**. Also delivers the panel→chat direction: "Ask Coriven" context chips that drop an entity reference into the composer.
- **Wave Goal:** *If Coriven has something to say, it says it where you talk* — proactive output lands in the conversation exactly once, and any panel row can feed the conversation.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Shared-Contract Position

| Contract | Role in this wave |
|---|---|
| **C7 (proactive half)** | **OWNED & BUILT here.** (The inline approval card half of C7 belongs to 9.1.3 — untouched.) Proactive delivery = system-authored assistant messages, compact card form, idempotent dedupe. |
| **C1** — conversation model | **CONSUMED unchanged.** Proactive messages post into the active conversation (`conversations` table + single active-conversation store from 9.1.2). This wave adds message-row bookkeeping columns but does not alter the `conversations` schema or the store. |
| **C6** — `open_surface` bridge | **CONSUMED.** Proactive cards deep-link/open surfaces ("Open Today board", "View goal") through the 9.4.1 helpers. |
| **C4 / C8** — tokens + component library | **CONSUMED.** Compact cards compose C8 `Card`/`Badge` primitives with C4 tokens (amber = attention, emerald = assistant); no parallel primitives hand-rolled. |

## Wave Goals

1. Post the daily briefing into the conversation every morning via the existing briefing cron, deduped on `(user_id, briefing_date)` — exactly-once regardless of cron re-runs, retries, or multi-device opens (design §8.3).
2. Post stale-goal nudges and the weekly review the same way, with equivalent dedupe keys (per-pattern-activation; per-ISO-week).
3. Render proactive messages as **compact cards** in the message stream (C8/C4), each deep-linking to its full surface (C6/C2) — board remains the at-rest form, chat the delivery.
4. Ship "Ask Coriven" context chips: panel rows feed a reference ("about *Renew passport*: …") into the composer.
5. Proactive messages appear in an open chat session without a manual reload.

**UX grounding (existing foundations — referenced, not created):** `docs/architecture/_main/05a-UX-Foundations.md` **Pass 1** (mental model: a chief of staff *briefs you* unprompted — proactive delivery is the anticipate half of the analogy; briefing is read-first, zero required decisions per Pass 4 budget) and **Pass 5** (state design & feedback: Briefing element states — "Your first briefing arrives tomorrow at 7am" empty state, fallback to last briefing on error; toast-free, in-stream delivery as background-completion feedback).

## User Stories

### User Story 1: Morning briefing arrives in chat, exactly once

**As a** Coriven user
**I want** my daily briefing to appear in my conversation every morning automatically
**So that** I start the day where I already talk to Coriven, without opening the board or asking

**Estimated hours:** 15

**Acceptance Criteria:**
- [ ] After the existing daily-briefing cron upserts a `daily_briefings` row, a system-authored assistant message containing the briefing (compact card payload) is inserted into the user's active conversation
- [ ] Dedupe key `(user_id, source='briefing', dedupe_key=briefing_date)` enforced **in the database** (unique index) — re-running the cron, a Vercel retry, or two devices opening simultaneously produces exactly one message (verified by test)
- [ ] Posting reuses the already-assembled `daily_briefings.content` — `assembleBriefing` is **not** called again and no job logic is added or changed
- [ ] Posting failure never fails the briefing cron run (logged, retried next window)
- [ ] Message is attributed as system-authored (distinguishable from model-generated assistant turns) and is excluded from the Anthropic message history sent to the model (or safely serialized as plain text) so it cannot corrupt `toAnthropicMessages`

**Priority:** High

---

### User Story 2: Proactive messages render as compact cards

**As a** Coriven user
**I want** briefings, nudges, and reviews to render as scannable compact cards in the conversation — not walls of text
**So that** proactive output is glanceable in chat, with one click to the full surface

**Estimated hours:** 8

**Acceptance Criteria:**
- [ ] A `ProactiveCard` component renders three variants (briefing / stale-goal nudge / weekly review) from the stored structured payload, composed from C8 `Card`/`Badge` + C4 tokens (no raw palette values)
- [ ] Card is compact: header + ≤5 summary rows (mirrors the board's hard row cap, design §8.4); it is a summary, not the full dashboard
- [ ] Card header/footer deep-links open the matching surface via C6/C2 (`overview` for briefing/review, `goals` with `focusId` for a nudged goal)
- [ ] Renders correctly from live delivery and from history reload; malformed/legacy payloads degrade to plain text, never crash the message list
- [ ] Accessible: card labeled ("Daily briefing, July 11"), links keyboard-operable; system-authored origin visually indicated (assistant emerald presence, quiet "briefing" tag)

**Priority:** High

---

### User Story 3: Stale-goal nudges and weekly review delivered in chat

**As a** Coriven user
**I want** stale-goal nudges and my weekly review to arrive in the conversation like the briefing does
**So that** all of Coriven's proactive output has one consistent home

**Estimated hours:** 8

**Acceptance Criteria:**
- [ ] Weekly-review cron posts the stored review (`daily_briefings` row, `type='weekly'`) as a system-authored message; dedupe key = ISO week (`(user_id, 'weekly_review', '2026-W28')`)
- [ ] Stale-goal nudges post from the existing pattern-detection cron output (`detected_patterns`, `pattern_type='stale_goal'`, `is_active=true`); dedupe key = pattern id (`(user_id, 'stale_goal_nudge', pattern_id)`) — one post per pattern **activation**, not per day (no daily nag)
- [ ] Both strictly read existing job output — no changes to `detect-patterns.ts` / `weekly-review.ts` assembly logic; only a post-step after each cron's existing persistence
- [ ] Tray notifications (Epic 6/7) remain an independent channel — both may fire for the same event, consistent with the existing briefing/tray dual-channel behavior

**Priority:** High

---

### User Story 4: Proactive messages appear without a reload

**As a** Coriven user with the app already open
**I want** a proactive message to show up in my conversation shortly after it posts
**So that** the "Coriven speaks first" moment actually lands while I'm looking at the screen

**Estimated hours:** 5

**Acceptance Criteria:**
- [ ] Chat pane refetches conversation history on window focus and on a modest interval (~60s) while visible, merging by message id (no duplicates, no scroll-jank on unchanged data)
- [ ] New proactive messages announce via the existing `aria-live="polite"` region
- [ ] No refetch while streaming a response (no interference with SSE)
- [ ] Approach documented; Supabase Realtime noted as the follow-up upgrade path if polling proves insufficient (not built in this wave)

**Priority:** Medium

---

### User Story 5: "Ask Coriven" context chips (panel → chat)

**As a** Coriven user
**I want** an "Ask Coriven" affordance on panel rows (task, goal, email) that drops a reference chip into the composer
**So that** the panel feeds the conversation — I ask about the thing I'm looking at without retyping its name

**Estimated hours:** 7

**Acceptance Criteria:**
- [ ] A composer-context client API (context/provider alongside `usePanel`, e.g. `useComposerContext().addReference({ type, id, label })`) focuses the composer and shows a removable chip ("about *Renew passport*")
- [ ] Sending includes the reference as structured prefix text in the user message (e.g. `about task "Renew passport" (id): …`) — no API/schema changes, plain message content
- [ ] "Ask Coriven" affordance added to task rows, goal rows/detail, and email triage rows in the panel surfaces
- [ ] Chip is keyboard-accessible (added, focused, removable via keyboard); works when the panel is open or after it closes

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: Briefing posts exactly once across double cron runs
- **Endpoint:** `GET /api/cron/daily-briefing`
- **Method:** GET (Bearer `CRON_SECRET`), invoked **twice** in the same briefing window for a seeded user in-window
- **Test Data:** Seeded profile (timezone/briefing_time in-window), active goals/tasks; existing `conversations` row
- **Expected Result:** One `daily_briefings` row (existing behavior) AND exactly one `conversation_messages` row with `source='briefing'`, `dedupe_key=<today>`; second run reports `posted: 0, deduped: 1`
- **Verification:** Row counts; unique-index conflict handled silently (`ON CONFLICT DO NOTHING` path); cron returns 200 both times

### Test Case 2: Weekly review + nudge dedupe keys
- **Endpoint:** `GET /api/cron/weekly-review`, `GET /api/cron/detect-patterns`
- **Method:** GET (Bearer), each invoked twice
- **Test Data:** Stored weekly review row for current ISO week; one active `stale_goal` pattern
- **Expected Result:** Exactly one message with `source='weekly_review'`, `dedupe_key='<ISO week>'`; exactly one with `source='stale_goal_nudge'`, `dedupe_key='<pattern_id>'`; a *different* pattern id yields a second nudge message
- **Verification:** Row counts per `(user_id, source, dedupe_key)`; assembly functions not re-invoked (spy)

### Test Case 3: Target-conversation resolution
- **Endpoint:** internal `postProactiveMessage()` (unit/integration)
- **Method:** n/a
- **Test Data:** (a) user with 3 conversations (distinct `updated_at`); (b) user with zero conversations
- **Expected Result:** (a) message lands in the most recently updated non-archived conversation and bumps its `updated_at`; (b) a new conversation is created (C1-conformant row) and the message lands there
- **Verification:** `conversation_id` of inserted message; conversations row created with valid `user_id`/RLS-conformant shape

### Test Case 4: Chat history renders proactive cards
- **Endpoint:** `getChatHistory` server action → `chat-pane.tsx` render (component test)
- **Method:** n/a
- **Test Data:** History containing a briefing message (structured payload), a nudge, a weekly review, and one malformed proactive payload
- **Expected Result:** Three compact cards render with correct variants and deep links; malformed payload degrades to plain text; no crash
- **Verification:** Rendered variant per `source`; link targets match C2 routes; error boundary not triggered

## Infrastructure Specifications

### Testing (always)
- **Unit:** `postProactiveMessage` (conversation resolution, payload shaping, conflict handling); dedupe-key builders (briefing date in user timezone, ISO week, pattern id); `ProactiveCard` payload parsing/degradation.
- **Integration:** double-invocation cron tests (Test Cases 1–2) against a local Supabase instance; concurrency test (two parallel inserts, one row survives).
- **Component:** `ProactiveCard` variants, chip add/remove/send flow in the composer.
- **Type-level:** regenerated `apps/web/src/types/supabase.ts` after migration; `npm run typecheck` clean.

### UI
- `ProactiveCard` in `apps/web/src/components/chat/` — three variants over C8 primitives; ≤5 rows; deep links via C6/C2.
- `message.tsx`: branch on message `source` to render `ProactiveCard` for proactive rows; unchanged rendering otherwise.
- `chat-pane.tsx`: focus/interval refetch with id-merge (extends the existing history-merge logic, Story 1.4.1.1 pattern).
- Composer: reference-chip UI (removable chip above the input), token-backed, keyboard-accessible.
- Panel surfaces: "Ask Coriven" row affordance (quiet secondary action per UX Pass 3 — primary row actions stay dominant).

### API / Engine
- New shared lib `apps/web/src/lib/proactive/post-message.ts` (service-role, cron context only): resolve target conversation → insert message with `ON CONFLICT DO NOTHING` on the dedupe index → bump `conversations.updated_at`.
- Post-steps appended to three existing cron routes (`/api/cron/daily-briefing`, `/api/cron/weekly-review`, `/api/cron/detect-patterns`) **after** their existing persistence; failures logged, never fail the cron response. No new routes; no chat-engine changes; no tool changes.
- Engine safety: `toAnthropicMessages` treatment of proactive rows verified — structured payloads serialize to a short plain-text summary when included in model history (they are ordinary `conversation_messages` rows and will be loaded by `getChatHistory`).

### Database (proactive dedupe bookkeeping)
- Migration (via `npx supabase migration new proactive_message_dedupe`):
  - `conversation_messages` + `source text null` (values: `briefing` | `stale_goal_nudge` | `weekly_review`; null = normal message) and `dedupe_key text null`
  - **Partial unique index**: `unique (user_id, source, dedupe_key) where source is not null` — the idempotency guarantee lives in Postgres, not application code
  - No RLS changes (existing message policies cover the new columns); inserts use the service client from cron
- Regenerate Supabase types.

### Monitoring (double-post guard)
- Structured JSON logs from `postProactiveMessage`: `proactive.post.inserted`, `proactive.post.deduped` (conflict hit — the guard firing), `proactive.post.error` with `{ userId, source, dedupeKey, conversationId }`.
- Cron JSON responses extended with `proactivePosted` / `proactiveDeduped` / `proactiveErrors` counters (matches existing `briefingsGenerated`-style reporting).
- Watch condition: `proactive.post.deduped` at low background rates is healthy (retries/multi-window); a spike indicates a scheduling bug — noted in the runbook comment on the route.

## Technical Tasks

### Task 9.4.2.1.1: Dedupe migration + regenerated types
- **Agent:** backend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Wave 9.1.2 delivered (C1 `conversations` table exists — the target of conversation resolution)
- **Priority:** High

**Deliverables:**
- `supabase/migrations/*_proactive_message_dedupe.sql`: `source`, `dedupe_key` columns + partial unique index on `conversation_messages`
- Regenerated `apps/web/src/types/supabase.ts`

**Acceptance Criteria:**
- [ ] Duplicate proactive insert fails at the index; normal messages (null source) unaffected
- [ ] Migration applies cleanly on a DB with existing message rows

---

### Task 9.4.2.1.2: `postProactiveMessage` shared lib
- **Agent:** backend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.4.2.1.1
- **Priority:** High

**Deliverables:**
- `apps/web/src/lib/proactive/post-message.ts`: `postProactiveMessage({ userId, source, dedupeKey, payload })` — resolves active conversation (most recently updated, non-archived; creates a C1-conformant conversation if none), inserts role `assistant` message with structured payload, `ON CONFLICT DO NOTHING`, bumps `conversations.updated_at`; returns `inserted | deduped | error`
- Structured logs (`proactive.post.*`); unit + concurrency tests

**Acceptance Criteria:**
- [ ] Test Case 3 passes; parallel double-insert leaves exactly one row
- [ ] Never throws into the caller (cron-safe)

---

### Task 9.4.2.1.3: Briefing post-step in the daily-briefing cron
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.4.2.1.2
- **Priority:** High

**Deliverables:**
- `apps/web/src/app/api/cron/daily-briefing/route.ts`: after the existing `daily_briefings` upsert, call `postProactiveMessage` with `source='briefing'`, `dedupe_key = briefing_date` (already computed via `getTodayInTimezone`), payload = the assembled `BriefingContent` in compact-card shape; counters added to the cron response
- No change to `assembleBriefing`, windows, or upsert behavior

**Acceptance Criteria:**
- [ ] Test Case 1 passes (double run → one message)
- [ ] A posting error does not affect `briefingsGenerated` or the 200 response

---

### Task 9.4.2.1.4: Idempotency + cron QC suite
- **Agent:** quality-control
- **Estimation:** 3 hours
- **Dependencies:** Tasks 9.4.2.1.3, 9.4.2.3.1, 9.4.2.3.2
- **Priority:** High

**Deliverables:**
- Integration tests for Test Cases 1–3 across all three crons, including the concurrency case and the no-conversations case

**Acceptance Criteria:**
- [ ] All idempotency tests pass against local Supabase; monitoring counters verified in responses

---

### Task 9.4.2.2.1: `ProactiveCard` component (3 variants)
- **Agent:** frontend-specialist
- **Estimation:** 6 hours
- **Dependencies:** Wave 9.2.2 (C8 `Card`/`Badge`); Wave 9.4.1 (C6 deep-link helpers); payload shape from Task 9.4.2.1.2
- **Priority:** High

**Deliverables:**
- `apps/web/src/components/chat/proactive-card.tsx`: briefing / nudge / weekly-review variants; ≤5 summary rows; header deep link (`overview`; `goals`+`focusId` for nudges) via `usePanel().openPanel`; graceful plain-text degradation for unparseable payloads
- Component tests per variant + degradation case

**Acceptance Criteria:**
- [ ] Composed from C8 primitives + C4 tokens only (no raw palette values)
- [ ] Test Case 4 passes; accessible labels present

---

### Task 9.4.2.2.2: Render proactive rows in the message stream
- **Agent:** frontend-specialist
- **Estimation:** 2 hours
- **Dependencies:** Task 9.4.2.2.1; `source` exposed through `getChatHistory` / `ChatMessage` type
- **Priority:** High

**Deliverables:**
- `message.tsx` (+ `types.ts`, `getChatHistory`): proactive messages route to `ProactiveCard`; normal rendering untouched; quiet origin tag ("briefing" / "nudge" / "weekly review")

**Acceptance Criteria:**
- [ ] History reload renders cards identically to fresh delivery; non-proactive rendering byte-identical

---

### Task 9.4.2.3.1: Weekly-review post-step
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.4.2.1.2
- **Priority:** Medium

**Deliverables:**
- `apps/web/src/app/api/cron/weekly-review/route.ts`: post stored review (`daily_briefings`, `type='weekly'`) with `source='weekly_review'`, `dedupe_key=<ISO week>`; counters in response; no assembly-logic changes in `weekly-review.ts`

**Acceptance Criteria:**
- [ ] Test Case 2 (review half) passes; re-run deduped

---

### Task 9.4.2.3.2: Stale-goal nudge post-step
- **Agent:** backend-specialist
- **Estimation:** 4 hours
- **Dependencies:** Task 9.4.2.1.2
- **Priority:** Medium

**Deliverables:**
- `apps/web/src/app/api/cron/detect-patterns/route.ts` (post-persistence step): for each newly active `stale_goal` pattern, post with `source='stale_goal_nudge'`, `dedupe_key=pattern_id`, payload carrying goal id/title/days-stale (from the pattern row); no changes to `detect-patterns.ts` detection logic

**Acceptance Criteria:**
- [ ] One message per pattern activation (Test Case 2 nudge half); daily re-detection of the same active pattern posts nothing

---

### Task 9.4.2.4.1: Focus/interval history refetch
- **Agent:** frontend-specialist
- **Estimation:** 5 hours
- **Dependencies:** Task 9.4.2.2.2
- **Priority:** Medium

**Deliverables:**
- `chat-pane.tsx`: refetch on window focus + ~60s visible-interval, merged by message id (extends existing dedupe merge); suppressed while `isStreaming`; scroll position preserved when nothing new
- Note in code + this doc: Supabase Realtime is the upgrade path if polling proves insufficient (out of scope here)

**Acceptance Criteria:**
- [ ] Story 4 acceptance criteria pass; no duplicate rows, no SSE interference, aria-live announcement verified

---

### Task 9.4.2.5.1: Composer reference-chip API + UI
- **Agent:** frontend-specialist
- **Estimation:** 4 hours
- **Dependencies:** None within this wave (parallel stream); Wave 9.1.1 layout (persistent composer)
- **Priority:** Medium

**Deliverables:**
- Composer-context provider + `useComposerContext().addReference({ type, id, label })`; removable chip UI above the input; reference serialized as structured prefix text on send (no API changes)

**Acceptance Criteria:**
- [ ] Chip add/focus/remove keyboard-operable; sent message carries the reference text; token-backed styling

---

### Task 9.4.2.5.2: "Ask Coriven" affordances on panel rows
- **Agent:** frontend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 9.4.2.5.1
- **Priority:** Medium

**Deliverables:**
- Quiet "Ask Coriven" action on task rows, goal rows/detail, and email triage rows calling `addReference(...)` with the row's entity

**Acceptance Criteria:**
- [ ] Works from all three surfaces; composer focused with chip present; row primary actions remain visually dominant (UX Pass 3)

## Task Dependencies

```
9.4.2.1.1 migration
   └─> 9.4.2.1.2 postProactiveMessage lib
          ├─> 9.4.2.1.3 briefing post-step ──┐
          ├─> 9.4.2.3.1 weekly-review step ──┼─> 9.4.2.1.4 idempotency QC
          └─> 9.4.2.3.2 nudge post-step ─────┘
9.4.2.2.1 ProactiveCard ──> 9.4.2.2.2 message-stream rendering ──> 9.4.2.4.1 live refetch
9.4.2.5.1 composer chips ──> 9.4.2.5.2 panel affordances            (parallel stream)
```

**Critical path:** 9.4.2.1.1 → 9.4.2.1.2 → 9.4.2.1.3 → 9.4.2.1.4 (the exactly-once guarantee).
**Parallel streams:** the card-rendering stream (9.4.2.2.x → 9.4.2.4.1) needs only the payload shape from 9.4.2.1.2; the chips stream (9.4.2.5.x) is fully independent.
**Bottleneck:** 9.4.2.1.2 — three post-steps and the card payload shape all hang off it; land it first.

## Agent Assignment & File Scope

| Agent | Tasks | Hours | File scope (owns changes to) |
|---|---|---|---|
| backend-specialist | 9.4.2.1.1, 9.4.2.1.2, 9.4.2.1.3, 9.4.2.3.1, 9.4.2.3.2 | 20 | `supabase/migrations/*`, `apps/web/src/lib/proactive/**`, `apps/web/src/app/api/cron/{daily-briefing,weekly-review,detect-patterns}/route.ts`, `apps/web/src/types/supabase.ts` (regen) |
| frontend-specialist | 9.4.2.2.1, 9.4.2.2.2, 9.4.2.4.1, 9.4.2.5.1, 9.4.2.5.2 | 20 | `apps/web/src/components/chat/{proactive-card.tsx,message.tsx,chat-pane.tsx,composer.tsx,types.ts}`, `apps/web/src/app/actions/chat.ts` (`getChatHistory` source pass-through), panel surface row components (affordance only) |
| quality-control | 9.4.2.1.4 | 3 | test files only |

**Out of scope for everyone:** `apps/web/src/lib/jobs/**` assembly logic (briefing.ts, detect-patterns.ts, weekly-review.ts — read their output only), tool registry, `conversations` schema (C1 — consume only), chat engine SSE flow (C6 — consume only), inline approval card (9.1.3's half of C7).

**Total: 43 hours** (stories: 15 + 8 + 8 + 5 + 7 = 43; task-level sum 43 — no hidden buffer).

## Dependencies

**Depends on (hard):**
- **Wave 9.1.2** — C1: `conversations` table + single active-conversation store (target-conversation resolution and `updated_at` bump require it)
- **Wave 9.2.2** — C8: `Card`/`Badge` primitives (+ C4 tokens from 9.2.1) for `ProactiveCard`
- **Wave 9.4.1** — C6: `open_surface`/deep-link helpers consumed by card links (contract ownership table: C6 before 9.4.2)
- **Epic 7 jobs (already exist, complete):** daily-briefing cron + `daily_briefings` table, weekly-review cron (`type='weekly'` rows), detect-patterns cron + `detected_patterns` — this wave adds delivery only

**Blocks:**
- **Wave 9.5.x** — responsive/WCAG audit covers proactive cards and chips
- Board briefing-card "compacts after read" refinements (9.2.3 follow-ups) that want a shared read-state — out of scope here, flagged as a future coordination point

**External:** none (no new services or credentials; Vercel Cron schedules unchanged).

## Definition of Done

- [ ] All 5 user stories completed; all acceptance criteria met
- [ ] Exactly-once delivery proven by tests: double cron run, concurrent insert, and multi-device open scenarios all yield one message per `(user_id, source, dedupe_key)`
- [ ] Migration applied locally (`npx supabase db push`); Supabase types regenerated; `npm run typecheck` clean
- [ ] No changes to Epic 7 job assembly logic (diff-reviewed against `lib/jobs/**`)
- [ ] Monitoring counters (`proactivePosted`/`proactiveDeduped`/`proactiveErrors`) visible in cron responses and logs
- [ ] Proactive cards render from live delivery and history reload; degradation path verified
- [ ] Contract check: C1/C6/C8 consumed unchanged; C7-proactive delivered as specified in `epic-9-shared-contracts.md`
- [ ] PR from `development` branch flow; code reviewed; docs (this file) status updated

## Handoff Requirements

**For Wave 9.5.x:**
- Proactive cards + chips included in the responsive/WCAG audit surface inventory
- Polling refetch behavior documented for the tablet/mobile breakpoints (sheet-over-chat may change focus semantics)

**For other Features/Epics:**
- `postProactiveMessage` is the single entry point for any future proactive channel (meeting prep, follow-up detection) — new sources add a `source` value + dedupe key, nothing else
- Future Tauri tray shares the conversation: proactive messages appear there automatically via C1; tray notifications remain the independent OS channel

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Double-post across cron retries / multi-device opens | Med | Idempotency enforced by a Postgres partial unique index, not app logic; `ON CONFLICT DO NOTHING`; concurrency test in 9.4.2.1.4; `proactive.post.deduped` monitoring |
| "Active conversation" ambiguity for server-side posting | Med | Documented proxy: most recently updated non-archived conversation (create if none). Aligns with the client store in the common case; posting into the latest conversation is acceptable per design ("says it where you talk"). Flagged as a cross-wave assumption below |
| Structured payload rows corrupt model history (`toAnthropicMessages`) | Med | Proactive rows serialize to short plain-text summaries in model history; explicit test in 9.4.2.2.2 |
| Nudge fatigue (daily re-posts of the same stale goal) | Med | Dedupe key = pattern id → once per activation; pattern deactivation/reactivation (Epic 7 logic, unchanged) naturally rate-limits |
| Polling refetch causes scroll-jank or SSE interference | Low-Med | Id-merge on unchanged data is a no-op; refetch suppressed while streaming; scroll preserved unless new rows append |
| Briefing cron ~30-min window re-entry double-fires the post | Low | Same dedupe index catches it; `briefing_date` computed in user timezone via existing `getTodayInTimezone` |

## Notes and Assumptions

- **Assumption (cross-wave):** server-side "active conversation" = most recently updated non-archived `conversations` row for the user; a new conversation is created if none exists. Consumers of C1 (9.3.1 palette conversation list, history flyout) must tolerate conversations whose latest message is system-authored (title derivation still uses the first *user* message per C1 — a proactive-only conversation keeps a placeholder title until the user replies).
- **Assumption (cross-wave):** proactive messages are ordinary `conversation_messages` rows (`role='assistant'`, non-null `source`); anything that reads messages (summaries, Sentinel, exports) must treat non-null `source` rows as system-authored, not model output.
- Dedupe bookkeeping lives on `conversation_messages` (`source` + `dedupe_key` + partial unique index) rather than a separate table — the message insert itself is the idempotent operation ("upsert-guarded" per the epic risk table), eliminating a two-write race.
- Briefing posts **every morning** on schedule, independent of app-open state — resolved decision, design doc §8.3; do not re-litigate cadence in implementation.
- Supabase Realtime is deliberately deferred (polling suffices for a solo-user daily cadence); revisit at productization scale.
- Tray notifications remain an independent, unchanged channel.

## Related Documentation

- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` (§4.4 chat↔panel integration, §8.3 briefing cadence decision, §8.4 card row cap)
- Shared contracts: `docs/planning/epic-9-shared-contracts.md` (C7-proactive owned; C1, C4, C6, C8 consumed)
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
