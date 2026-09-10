# Epic 9 — Shared Contracts (Cross-Wave Compatibility Backbone)

**Status:** Authoritative for wave design
**Date:** 2026-07-11
**Purpose:** Every wave in Epic 9 touches shared surface (the panel, the conversation model, the token system, the tool→panel bridge). This document pins the cross-cutting interfaces **once** so the ~12 waves are compatible by construction. Each wave plan must conform to these contracts; a wave that needs to change one must update this doc and flag the dependent waves.

> Rule: **the wave that OWNS a contract builds it; every other wave CONSUMES it unchanged.** Ownership is listed per contract. Consuming waves must not redefine an owned contract.

---

## C1 — Conversation model  ·  owner: Wave 9.1.2  ·  consumers: 9.1.1, 9.3.1, 9.4.2

Current state: `conversation_messages` (`id`, `conversation_id nullable`, `user_id`, `role`, `content`, `tool_calls jsonb`, `created_at`) and `conversation_summaries` exist. There is **no** `conversations` table; the UI tracks the active conversation in two divergent localStorage keys (`chat-panel-conversation-id`, `chat-tab-active-id`).

**New table `conversations`:**
| column | type | notes |
|---|---|---|
| `id` | uuid pk | client may generate (matches existing `conversation_id` usage) |
| `user_id` | uuid | FK `auth.users.id`, RLS on `user_id` (project convention) |
| `title` | text | null until first user message; then first message truncated |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | bumped on each new message |
| `pinned_at` | timestamptz null | schema-ready for pin (UI later) |
| `archived_at` | timestamptz null | schema-ready for archive (UI later) |

- RLS: full CRUD limited to `auth.uid() = user_id` (mirror existing message policies).
- Backfill migration: derive one `conversations` row per distinct `conversation_messages.conversation_id`, `title` = first user message (truncated), `created_at` = earliest message, `updated_at` = latest.
- **Single active-conversation store** (client): one source of truth (replace both localStorage keys). Shape: `{ activeConversationId: string }`. Addressable from the panel, the (retired) full view, and the future tray. Server list read via a `listConversations()` server action returning `{ id, title, updated_at, pinned_at }[]` ordered by `pinned_at desc nulls last, updated_at desc`.
- `conversation_messages.conversation_id` becomes effectively non-null for new rows (FK to `conversations.id`); do not drop the column's nullability in this epic (avoid breaking historical rows).

---

## C2 — Panel controller & surface registry  ·  owner: Wave 9.1.1  ·  consumers: ALL

The panel is one slot that renders one surface at a time. A single client controller owns panel state.

**Panel state:** `{ openSurface: SurfaceId | null, widthPct: number /*25–60*/ }`. `null` ⇒ chat full-width.
**Controller API (client):** `openPanel(surface: SurfaceId, opts?: { focusId?: string })`, `closePanel()`, `togglePanel()`, `setWidth(pct)`. Exposed via React context (`usePanel()`), mirroring the existing `TimezoneProvider` pattern.

**Registry module must be isomorphic** (reconciliation, Finding 2): `lib/surfaces/registry.ts` — the surface list AND the tool→surface mapping table (below) — MUST be a plain module with **no `'use client'` and no client-only imports**, so both the client `usePanel` controller and **server-side `engine.ts`** (which emits `open_surface`, C6) can import it. The `'use client'` controller lives in a separate `panel-provider.tsx` that imports this registry. (9.1.1 acceptance criterion.)

**Surface registry** — the canonical list. Rail order = declaration order. `null`-rail surfaces are reachable by URL/command but have no rail icon.
| SurfaceId | rail? | route | opened by tools (C6) |
|---|---|---|---|
| `overview` | ✅ (Today) | `/` (panel home) | `generate_daily_briefing`, `generate_weekly_review` |
| `tasks` | ✅ | `/tasks` | `create_task`, `update_task`, `list_tasks`, `add_reminder`, `snooze_reminder` |
| `goals` | ✅ | `/goals`, `/goals/[id]` | `create_goal`, `update_goal`, `list_goals`, `set_goal_momentum`, `create_project` |
| `email` | ✅ | `/email` | `get_email_thread`, `search_email_metadata` |
| `settings` | ✅ (gear, bottom) | `/settings` | — |
| `activity` | ❌ | `/activity` | `submit_for_approval` (approvals audit/history) |

- `focusId` = an entity id to scroll/highlight within the surface (e.g. a task id). **Ownership split (reconciliation, Finding 1):** the *mechanism* (query param + `openPanel` opts + delivery to the rendered surface) ships in **9.1.1**; the *honoring* (scroll-into-view + highlight the row) is IMPLEMENTED by **9.4.1** for the three list surfaces `tasks`/`goals`/`email`, and by **9.2.3** for `overview` (via `BoardRow.id`). 9.4.1 does NOT merely verify — it adds the scroll/highlight to each mapped list surface. No wave may leave this as "verify only," or deep-links silently no-op.
- **URL ↔ panel:** deep links open the matching surface; `Esc`/✕ closes to chat. Back button switches panel content. `/chat` and `/today` 301-redirect to `/` (C5).

---

## C3 — Rail component  ·  owner: Wave 9.1.1  ·  consumers: 9.1.3, 9.5.1

- Rail renders the C2 registry's rail-visible surfaces (top group) + Settings (bottom); Coriven mark, New chat, History flyout trigger at top.
- Nav item shape: `{ surface: SurfaceId, icon, label }`. Active state from `usePanel().openSurface`. Tooltip = label. `aria-current="page"` on active.
- Rail is **not** where Approvals/Memory/Constraints live (C5 de-rails approvals; §6 folds Memory/Constraints into Settings).
- 9.5.1 owns the responsive collapse (rail → menu button < 768px) but must not change the item shape.

---

## C4 — Design tokens  ·  owner: Wave 9.2.1  ·  consumers: ALL UI waves

Tailwind 4 (CSS-first). Tokens defined via `@theme` in `apps/web/src/app/globals.css`. **No raw palette values (`gray-900`, `emerald-500`, …) in components** after 9.2.2 — reference token-backed utilities.

Token namespaces (names are the contract; values tuned in 9.2.1):
- Color: `--color-canvas`, `--color-surface`, `--color-raised`, `--color-border`, `--color-assistant` (emerald — the assistant's color), `--color-attention` (amber — "needs your judgment"), `--color-danger`, `--color-text`, `--color-text-secondary`, `--color-text-muted`.
- Space: `--space-*` (4px grid). Radius: `--radius-interactive`, `--radius-container`. Motion: `--duration-fast` (120ms), `--duration-base` (200ms), `--duration-slow` (300ms) + standard ease.
- Type: 5 sizes with fixed line-heights; **mono for user messages** is a token (`--font-user`), prose for assistant — keep as signature.
- All motion behind `motion-safe:` (existing habit). Contrast: every text/canvas pair ≥ 4.5:1 (9.2.1 fixes failing `text-gray-600`-on-canvas pairings).

---

## C5 — Route map  ·  owner: Wave 9.1.3  ·  consumers: 9.1.1, 9.3.1

- `/` = chat (left) + overview board (panel home). Canonical home.
- `/chat` → 301 `/`. `/today` → 301 `/`.
- `/tasks`, `/goals`, `/goals/[id]`, `/email`, `/settings`, `/activity` = open that surface in the panel (deep-linkable).
- `/projects` and `/projects/[id]` = retained legacy aliases of the `goals` surface (reconciliation, Finding 5) — kept for existing deep links; not new routes.
- Approvals: **no route of its own except `/activity`** (audit/history). Live approvals surface inline in chat (C7) + attention card on the board.
- Memory & Constraints: **no top-level routes**; become sections under `/settings` (§6).

---

## C6 — `open_surface` tool→panel bridge  ·  owner: Wave 9.4.1  ·  depends on: C2, existing SSE flow

Extends the existing `SSEEvent` union in `apps/web/src/lib/chat/engine.ts` (current variants: `text_delta`, `tool_use`, `tool_result`, `context_building`, `done`, `error`):
```ts
| { type: 'open_surface'; surface: SurfaceId; focusId?: string }
```
- Emitted (optionally) after a `tool_result` for tools mapped in the C2 registry. Client handler calls `usePanel().openPanel(surface, { focusId })`.
- Tool cards in chat also render a static deep link ("View in Tasks") using the same C2 mapping — no backend needed for the link, only for the auto-open event.
- Assistant-opened panels ("show me my tasks") reuse this event. **No new tools, no tool-schema changes** — this is a UI-layer event only.

---

## C7 — Inline approval card & proactive-in-chat  ·  owner: 9.1.3 (inline card) + 9.4.2 (proactive)  ·  consumers of C1, C4

- Inline approval card renders in the conversation when an action is gated; preserves ADR-013 raw-payload-primary rendering (reuse existing approval-card logic, not a re-summary).
- Proactive delivery (9.4.2): daily briefing, stale-goal nudges, weekly review posted as **system-authored assistant messages** into the active conversation (compact card form). Idempotent dedupe on `(user_id, briefing_date)` (and equivalent keys for nudges/review) so cron re-runs / multi-device opens never double-post. Reuses Epic 7 jobs' output — no new job logic.

---

## C8 — Component library  ·  owner: Wave 9.2.2  ·  consumers: 9.2.3, 9.3.1, 9.4.x, 9.5.x

`apps/web/src/components/ui/`: `Button` (3 variants), `Input`/`Select`/`Textarea`, `Card`, `Badge`/`Chip`, `Toast`, `Modal`/`Sheet`, `EmptyState`, `Skeleton`, `PanelHeader`. Token-backed (C4). The palette (C9), board cards (9.2.3), and responsive sheets (9.5.1) build on `Modal`/`Sheet` and `Card` — they must not hand-roll parallel primitives.

---

## C9 — Command registry  ·  owner: Wave 9.3.1  ·  consumers: 9.3.2

- Command shape: `{ id, title, group: 'navigate'|'act'|'ask', run(ctx) }`.
- Navigate commands are generated from the C2 surface registry + C1 conversation list + entity search (tasks/goals by name).
- Act commands wrap **existing server actions** (new task, remind, snooze) — no new backend.
- v3 "ask": unmatched input → post as a chat message to the active conversation (C1).
- Shortcut map is 9.3.2's: `⌘K` palette · `⌘/` composer · `Esc` close panel (C2) · `[` toggle panel (C2) · `g t/g g/g e` go-to (C2 surfaces).

---

## Ownership summary (who builds what)

| Contract | Owner wave | Must exist before |
|---|---|---|
| C1 conversations table + store | 9.1.2 | 9.3.1, 9.4.2 |
| C2 panel controller + surface registry | 9.1.1 | everything |
| C3 rail | 9.1.1 | 9.1.3, 9.5.1 |
| C4 design tokens | 9.2.1 | all UI polish, 9.2.2 |
| C5 route map | 9.1.3 | 9.3.1 |
| C6 open_surface bridge | 9.4.1 | 9.4.2 |
| C7 inline approval + proactive | 9.1.3 / 9.4.2 | — |
| C8 component library | 9.2.2 | 9.2.3, 9.3.1, 9.4.x, 9.5.x |
| C9 command registry | 9.3.1 | 9.3.2 |

**Global build order implied:** 9.1.1 → 9.1.2 → 9.1.3 → 9.2.1 → 9.2.2 → 9.2.3 → (9.3.x, then 9.4.x) → 9.5.1 → 9.5.2.

**Serialization note (reconciliation, Finding 3):** 9.3 and 9.4 are NOT freely parallel. `chat-pane.tsx` / `composer.tsx` are edited by 9.3.2 (extract the single `sendChatMessage` send-controller + focus handle) and by 9.4.1/9.4.2 (open_surface handling, proactive rendering). Serialize the chat path **9.3.2 → 9.4.1 → 9.4.2** so 9.4.x builds on 9.3.2's extracted controller. C9 is NOT a 9.4.1 dependency — this serialization is a file-scope constraint, not a contract one.
