---
lastupdated: "2026-07-08"
type: brainstorming
status: Active
product:
  - coriven
relatedbacklog: BL-001
---

# BL-001 Brainstorming — Sentinel Sync/Async Toggle

## Enhancement Summary

Add a per-user toggle between two Sentinel context-build modes:

- **Async (default):** Sentinel runs in the background after each message. The next LLM call reads whatever context package is already in Upstash (~1ms). May be one message stale.
- **Sync:** Sentinel runs and completes *before* the LLM call. Context is always current. User waits for the extraction + embedding pass to finish first.

Both modes share the same context schema — only the timing differs.

---

## Decisions Captured

| Decision | Choice | Rationale |
|---|---|---|
| Goal | Keep both modes long-term | Users who prefer always-current context can opt in permanently; async remains the default for everyone else |
| Toggle location | Settings UI, per-user | Stored in `profiles.sentinel_mode`; no deploy needed to switch |
| Latency indicator | Subtle UI indicator in chat | User should know the delay is intentional when sync is active, not a broken app |

---

## Key Technical Insight

In sync mode, only the **user-message Sentinel** needs to be awaited before the LLM call. The flow becomes:

```
[user sends message]
  → await Sentinel(userMessage)   ← blocks here in sync mode only
  → loadMemoryContext()           ← hits the freshly written Upstash cache
  → LLM call
  → stream response
  → Sentinel(assistantMessage)    ← fire-and-forget in BOTH modes
```

In async mode the first await is skipped — `loadMemoryContext` reads the previous turn's cache. This keeps the implementation change minimal: one conditional await in the engine, everything else unchanged.

---

## Implementation Phases

### Phase 1 — DB migration
- Add `sentinel_mode` column to `profiles`: enum `'async' | 'sync'`, default `'async'`, not null
- Regenerate Supabase TypeScript types

### Phase 2 — Engine
- Read `profile.sentinel_mode` at the start of each chat turn
- In sync path: `await runSentinel(userMessage)` before `loadMemoryContext()`
- Add `contextFallback: boolean` to the SSE `done` event payload — set `true` if sync Sentinel times out and we fall back to the existing cache (prevents a hung response if embedding is slow)
- Sentinel timeout threshold: 8 seconds (Haiku extraction + embedding; configurable via `SENTINEL_SYNC_TIMEOUT_MS` env var)

### Phase 3 — Settings UI
- Add "Context mode" field to the settings page
- Two options: Async (faster, may be one message stale) / Sync (always current, slight delay)
- Saves to `profiles.sentinel_mode` via existing settings server action

### Phase 4 — Chat UI indicator
- When sync mode is active, show a subtle "Building context…" status line in the chat input area while the Sentinel is running
- Disappears when the LLM starts streaming
- If `contextFallback: true` arrives in the SSE done event, show a one-time toast: "Context timed out — used previous snapshot"

---

## Open Questions

None — scope is clear. Ready to generate the implementation plan.
