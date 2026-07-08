---
lastupdated: "2026-07-08"
type: brainstorming
status: Complete
product:
  - coriven
area: "Epic 2 / Feature 2.5 — Sentinel"
enhancement: "BL-001 — Sentinel sync/async toggle"
---

# BL-001 Brainstorming — Sentinel Sync/Async Mode Toggle

## What we're solving

The Sentinel currently runs exclusively in **async mode**: after a message is sent, it fires
fire-and-forget in the background (extract → persist → assemble → write to cache). The next
chat call reads the pre-built cache. This is fast but the context may be one message stale.

We want to be able to switch to **sync mode**: the Sentinel runs and completes *before* the
LLM call, so context is always current. This costs latency (Haiku extraction + embedding pass
blocks the response) but guarantees freshness.

The goal is to A/B test which mode produces better response quality in practice.

---

## Current code map

| File | Role |
|---|---|
| `apps/web/src/lib/memory/sentinel.ts` | `runSentinel(userId, text, role)` — extraction + persist + assemble + write. Always fire-and-forget today. |
| `apps/web/src/lib/memory/context-loader.ts` | `loadMemoryContext(userId, query)` — reads Upstash → Supabase → inline assembly. Called before LLM. |
| `apps/web/src/lib/chat/engine.ts` line 275 | `loadMemoryContext` called before the LLM call |
| `apps/web/src/lib/chat/engine.ts` line 292 | `runSentinel` called fire-and-forget on user message |
| `apps/web/src/lib/chat/engine.ts` line 406 | `runSentinel` called fire-and-forget on assistant message |
| `apps/web/src/app/(app)/chat/chat-client.tsx` | Chat UI — toggle button will live here |
| `supabase/migrations/` | `profiles` table already has `timezone` — `sentinel_mode` column is new |

---

## Decisions made

| Decision | Choice | Reason |
|---|---|---|
| Toggle surface | Button at top of chat | Immediately accessible during testing; no need to navigate to settings |
| Persistence | Saved to `profiles.sentinel_mode` | Survives reloads and new sessions — mode stays where you left it |
| Sync failure behavior | Fall back to cached context + show warning | Never block the user; transparency about context staleness |
| Warning visibility | Small indicator near chat input (⚠️ Context: cached) | Visible but unobtrusive — useful during A/B testing |

---

## How sync mode works

In sync mode, `engine.ts` awaits `runSentinel` for the **user message** before calling the LLM.
The `loadMemoryContext` call that follows then reads the freshly written cache — Upstash hit,
~1ms — so the LLM gets up-to-date context.

The assistant message Sentinel call remains fire-and-forget in both modes (the assistant's own
output doesn't need to be in context before it's generated).

Timeout: 8 seconds. If the Sentinel hasn't finished, fall back to whatever is in cache and set
a `contextFallback: true` flag in the SSE `done` event. The chat UI reads this and shows the
⚠️ indicator.

---

## What we're building

1. **Migration** — add `sentinel_mode text NOT NULL DEFAULT 'async' CHECK (sentinel_mode IN ('async', 'sync'))` to `profiles`
2. **Server action** — `updateSentinelMode(mode)` updates `profiles.sentinel_mode`
3. **Engine change** — read `sentinel_mode` from profiles at the start of the chat turn; in sync mode, `await runSentinel(userId, text, 'user')` before `loadMemoryContext`
4. **SSE event** — extend the `done` event with `contextFallback: boolean`
5. **Chat UI toggle** — button at the top of `chat-client.tsx`; calls the server action on toggle; persists to DB
6. **Fallback indicator** — small `⚠️ Context: cached` message shown near the chat input when `contextFallback` is true

---

## What we are NOT building

- An env-var toggle (the UI toggle + DB persistence covers it)
- Quiet-hours or per-request overrides
- Changes to the assistant message Sentinel call (stays async in both modes)
- Changes to `context-loader.ts` (sync mode just ensures the cache is fresh before `loadMemoryContext` runs)
