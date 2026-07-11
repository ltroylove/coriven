---
lastupdated: "2026-07-08"
type: enhancement-plan
status: Active
product:
  - coriven
relatedbacklog: BL-001
brainstorming: docs/planning/sentinel-sync-async-brainstorming.md
---

# Enhancement Plan — Sentinel Sync/Async Toggle (BL-001)

## Overview

Add a per-user toggle between two Sentinel context-build modes. Both modes share the same context schema and tool registry — only the timing of the Sentinel extraction + embedding pass differs.

| Mode | Behavior | Trade-off |
|---|---|---|
| **Async** (default) | Sentinel runs in background after each message; LLM reads previous turn's Upstash cache (~1ms) | Lowest latency; context may be one message stale |
| **Sync** | Sentinel awaits completion before LLM call; LLM reads freshly written cache | Always-current context; user waits for extraction + embedding pass (~2–6s) |

**Scope:** Enhancement — no new Epic/Feature structure. Four phases, all within existing files plus one migration.

---

## Current Engine Flow (reference)

```
loadMemoryContext()              ← reads Upstash cache from previous turn
buildSystemPrompt()
saveMessage(user)
runSentinel(user) → fire-and-forget
─── LLM call ───
saveMessage(assistant)
runSentinel(assistant) → fire-and-forget
```

**Sync mode reordering:**

```
saveMessage(user)               ← moved up: sentinel needs the message persisted
await runSentinel(user)         ← blocks here (8s timeout → contextFallback)
loadMemoryContext()             ← now hits freshly written Upstash cache
buildSystemPrompt()
─── LLM call ───
saveMessage(assistant)
runSentinel(assistant) → fire-and-forget  ← stays async in BOTH modes
```

---

## Phase 1 — Database Migration

**File:** `supabase/migrations/TIMESTAMP_add_sentinel_mode_to_profiles.sql`

```sql
ALTER TABLE profiles
  ADD COLUMN sentinel_mode text NOT NULL DEFAULT 'async'
  CHECK (sentinel_mode IN ('async', 'sync'));
```

- Default `'async'` — all existing users unaffected
- After migration: regenerate TypeScript types
  ```bash
  npx supabase gen types typescript --linked > apps/web/src/types/supabase.ts
  ```

---

## Phase 2 — Chat Engine

**File:** `apps/web/src/lib/chat/engine.ts`

### 2.1 — Extend SSE done event

```ts
// Before
| { type: 'done' }

// After
| { type: 'done'; contextFallback?: boolean }
```

`contextFallback: true` is sent when sync mode times out and falls back to the existing Upstash cache.

### 2.2 — Load profile sentinel_mode at turn start

Add a profile fetch inside `runChatEngine` alongside the existing `loadToolPermissions` call:

```ts
const supabase = createServiceClient()
const { data: profile } = await supabase
  .from('profiles')
  .select('sentinel_mode')
  .eq('id', userId)
  .single()

const sentinelMode = profile?.sentinel_mode ?? 'async'
```

Fail-safe: if the profile fetch fails, default to `'async'` so sync errors never break chat.

### 2.3 — Reorder and conditionally await Sentinel

Replace the current fire-and-forget user-message Sentinel block with mode-aware logic:

```ts
// Always save the user message first (sentinel may need it in DB)
await saveMessage(userId, conversationId, 'user', text)

let contextFallback = false

if (sentinelMode === 'sync') {
  const TIMEOUT = parseInt(process.env.SENTINEL_SYNC_TIMEOUT_MS ?? '8000', 10)
  try {
    await Promise.race([
      runSentinel(userId, text, 'user'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sentinel_timeout')), TIMEOUT)
      ),
    ])
  } catch (err) {
    contextFallback = true
    console.warn('[engine] Sync sentinel timed out or failed; falling back to cached context', err)
  }
}

// In sync mode: reads freshly written cache. In async mode: reads previous-turn cache.
memoryContext = await loadMemoryContext(userId, lastText)

if (sentinelMode === 'async') {
  // Fire-and-forget for async mode (original behavior)
  runSentinel(userId, text, 'user').catch(() => {})
}
```

### 2.4 — Pass contextFallback to done event

```ts
send({ type: 'done', contextFallback: contextFallback || undefined })
```

### 2.5 — Environment variable

Add to `.env.example`:
```
# Timeout (ms) before sync Sentinel falls back to cached context (default: 8000)
SENTINEL_SYNC_TIMEOUT_MS=8000
```

---

## Phase 3 — Settings UI

**File:** `apps/web/src/app/(app)/settings/page.tsx`
**Server action:** `apps/web/src/app/actions/profile.ts` (or wherever profile updates live)

Add a "Context mode" control to the settings page beneath the existing settings sections:

```
Context Mode
  ○ Fast (default) — Responses start immediately. Context may be one message behind.
  ● Always current — Slight delay while context is built. Every response sees the latest.
```

- On change: server action updates `profiles.sentinel_mode` for the current user
- No page reload needed — optimistic update via React state, confirmed on server response
- Label copy should be user-friendly ("Fast" / "Always current"), not technical ("async" / "sync")

---

## Phase 4 — Chat UI Indicator

**File:** `apps/web/src/components/chat/chat-pane.tsx` (or `composer.tsx`)

### 4.1 — "Building context…" status while sync Sentinel runs

When the user sends a message in sync mode, show a subtle status line above the composer while waiting for the first streamed token:

```
Building context…
```

Trigger: message sent → no tokens received yet → show indicator.
Dismiss: first token arrives from the stream.

Implementation: the chat pane already tracks streaming state. Add a `prebuildingContext` boolean that is `true` from message send until the first `delta` SSE event arrives. Render a small muted text line (not a spinner, not a banner — subtle).

### 4.2 — Fallback toast

When `done` event arrives with `contextFallback: true`, show a one-time dismissible toast:

```
Context timed out — used previous snapshot
```

Use the existing toast/notification system in the app. Do not block the UI.

---

## Files Changed Summary

| File | Change |
|---|---|
| `supabase/migrations/TIMESTAMP_add_sentinel_mode_to_profiles.sql` | New migration |
| `apps/web/src/types/supabase.ts` | Regenerated (sentinel_mode column) |
| `apps/web/src/lib/chat/engine.ts` | Profile fetch, mode-aware Sentinel, done event payload |
| `apps/web/src/app/(app)/settings/page.tsx` | Context mode control |
| `apps/web/src/app/actions/profile.ts` | Save sentinel_mode server action (or extend existing) |
| `apps/web/src/components/chat/chat-pane.tsx` | "Building context…" indicator + fallback toast |
| `.env.example` | SENTINEL_SYNC_TIMEOUT_MS |

---

## Acceptance Criteria

- [ ] All existing users default to async mode — no behavior change on migration
- [ ] User can switch mode in Settings; change persists across sessions
- [ ] In sync mode: `loadMemoryContext` is called after `runSentinel` completes for the user message
- [ ] In async mode: behavior is identical to pre-enhancement (no regression)
- [ ] Sync Sentinel timeout defaults to 8s; configurable via env var
- [ ] On timeout: `contextFallback: true` in done event; toast shown; chat continues normally
- [ ] "Building context…" indicator appears only in sync mode, only before first token
- [ ] Assistant-message Sentinel is fire-and-forget in both modes
- [ ] TypeScript strict-mode passes; no new lint errors
- [ ] Existing chat engine tests pass

---

## No ADRs Required

This enhancement extends an existing pattern (Sentinel, ADR-referenced in Epic 2) without introducing new technology choices or reversing prior decisions. The mode toggle is additive — async remains the default and the existing code path is unchanged.
